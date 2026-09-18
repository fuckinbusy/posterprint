"""Почтовые ящики: подключение, правка, проверка, удаление.

Только тому, кто управляет сотрудниками (staff.manage): здесь пароли от
почты и решение, кто какую переписку видит. Пароль наружу не отдаётся —
в ответе только «задан / не задан».
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core import crypto
from app.core.database import get_db
from app.core.logs import log as applog
from app.core.security import CurrentUser, require_perm
from app.models import MailAccount
from app.schemas.mail import MailAccountIn, MailAccountUpdate
from app.services import mail
from app.services import mail_accounts as accounts_logic
from app.services import settings as settings_logic

router = APIRouter(
    prefix="/api/mail-accounts",
    tags=["mail"],
    dependencies=[Depends(require_perm("staff.manage"))],
)
Manager = Depends(require_perm("staff.manage"))


def _out(account: MailAccount, users: dict[int, list[str]]) -> dict:
    preset = accounts_logic.PROVIDERS.get(account.provider) or accounts_logic.PROVIDERS["custom"]
    return {
        **accounts_logic.public(account),
        "title": account.title,
        "imap": account.imap,
        "smtp": account.smtp,
        # что будет использовано на деле, если поле сервера пустое
        "imap_effective": account.imap or preset["imap"],
        "smtp_effective": account.smtp or preset["smtp"],
        "sender_name": account.sender_name,
        "active": account.active,
        "has_password": bool(account.password),
        "employees": users.get(account.id, []),
    }


def _listing(db: Session) -> dict:
    users = accounts_logic.users_of(db)
    return {
        "accounts": [_out(a, users) for a in accounts_logic.all_accounts(db)],
        "providers": accounts_logic.providers_public(),
        "max_per_employee": accounts_logic.MAX_PER_EMPLOYEE,
        "max_accounts": accounts_logic.MAX_ACCOUNTS,
    }


def _provider(value: str | None, address: str) -> str:
    value = (value or "").strip()
    if not value:
        return accounts_logic.guess_provider(address)
    if value not in accounts_logic.PROVIDERS:
        raise HTTPException(422, f"Неизвестная почтовая служба: {value}")
    return value


def _require_servers(account: MailAccount) -> None:
    if account.provider == "custom" and not (account.imap and account.smtp):
        raise HTTPException(422, "Для другой почты укажите оба сервера: IMAP и SMTP, с портами")


def _no_duplicate(db: Session, address: str, except_id: int | None = None) -> None:
    for other in accounts_logic.all_accounts(db):
        if other.id != except_id and other.user.lower() == address.lower():
            raise HTTPException(409, f"Ящик {address} уже подключён")


@router.get("")
def list_accounts(db: Session = Depends(get_db)) -> dict:
    return _listing(db)


@router.post("", status_code=201)
def create_account(payload: MailAccountIn, db: Session = Depends(get_db), user: CurrentUser = Manager) -> dict:
    existing = accounts_logic.all_accounts(db)
    if len(existing) >= accounts_logic.MAX_ACCOUNTS:
        raise HTTPException(409, f"Подключено уже {len(existing)} ящиков — больше нельзя")
    _no_duplicate(db, payload.user)
    account = MailAccount(
        title=payload.title.strip(),
        provider=_provider(payload.provider, payload.user),
        user=payload.user,
        password=crypto.encrypt(payload.password.strip()),
        imap=payload.imap,
        smtp=payload.smtp,
        sender_name=payload.sender_name.strip(),
        active=payload.active,
        position=max((a.position for a in existing), default=0) + 1,
    )
    _require_servers(account)
    db.add(account)
    db.commit()
    applog.warning("Почта: подключён ящик %s (%s) · %s", account.user, account.provider, user.name)
    return _listing(db)


@router.patch("/{account_id}")
def update_account(
    account_id: int,
    payload: MailAccountUpdate,
    db: Session = Depends(get_db),
    user: CurrentUser = Manager,
) -> dict:
    account = db.get(MailAccount, account_id)
    if account is None:
        raise HTTPException(404, "Ящик не найден")
    changes = {k: v for k, v in payload.model_dump(exclude_unset=True).items() if v is not None}
    if "user" in changes:
        _no_duplicate(db, changes["user"], account_id)
        account.user = changes["user"]
    if "provider" in changes:
        account.provider = _provider(changes["provider"], account.user)
    if changes.get("password", "").strip():
        account.password = crypto.encrypt(changes["password"].strip())
    for key in ("title", "sender_name", "imap", "smtp"):
        if key in changes:
            setattr(account, key, changes[key].strip())
    if "active" in changes:
        account.active = changes["active"]
    _require_servers(account)
    db.commit()
    mail.forget_mailbox(account.id)  # адрес, пароль или сервер поменялись — старое соединение забыть
    applog.warning(
        "Почта: ящик %s изменён (%s) · %s", account.user, ", ".join(sorted(changes)) or "—", user.name
    )
    return _listing(db)


@router.delete("/{account_id}")
def delete_account(account_id: int, db: Session = Depends(get_db), user: CurrentUser = Manager) -> dict:
    """Отключает ящик от системы. Письма на почтовом сервере не трогаются."""
    account = db.get(MailAccount, account_id)
    if account is None:
        raise HTTPException(404, "Ящик не найден")
    address = account.user
    touched = accounts_logic.forget(db, account_id)
    db.delete(account)
    db.commit()
    mail.forget_mailbox(account_id)
    applog.warning("Почта: ящик %s отключён, убран у %s сотрудников · %s", address, touched, user.name)
    return _listing(db)


@router.post("/{account_id}/check")
def check_account(account_id: int, db: Session = Depends(get_db)) -> dict:
    """Кнопка «Проверить»: IMAP и SMTP по очереди, с подсказкой по службе."""
    account = db.get(MailAccount, account_id)
    if account is None:
        raise HTTPException(404, "Ящик не найден")
    cfg = accounts_logic.to_config(account, settings_logic.overrides(db))
    result = mail.mailbox_for(account.id).check(cfg)
    # подсказка уже бывает внутри ответа IMAP — второй раз её не показываем
    if not result["ok"] and mail.auth_hint(cfg) not in result["imap"]:
        result["hint"] = mail.auth_hint(cfg)
    return result
