"""Почтовые ящики: кто какой видит, серверы по почтовой службе, перенос старой настройки.

Раньше ящик был один и жил в «Настройках» парой ключей. Теперь ящиков
несколько, у каждого своя запись; администратор назначает сотруднику один
или два. Сам администратор видит все — ему их и настраивать.
"""

from __future__ import annotations

import os

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import crypto
from app.core.security import CurrentUser
from app.models import Employee, MailAccount, Setting
from app.services import mail
from app.services import settings as settings_logic

# сколько ящиков можно назначить одному сотруднику
MAX_PER_EMPLOYEE = 2
# и сколько всего подключить: каждый ящик — постоянное соединение с почтой
MAX_ACCOUNTS = 12

# Почтовые службы: серверы по умолчанию и что подсказать про пароль.
# Обе требуют отдельный пароль для почтовых программ — обычный пароль от
# аккаунта по IMAP/SMTP не принимается.
PROVIDERS: dict[str, dict] = {
    "yandex": {
        "title": "Яндекс",
        "imap": "imap.yandex.ru:993",
        "smtp": "smtp.yandex.ru:465",
        "domains": ("yandex.ru", "yandex.com", "ya.ru", "yandex.by", "yandex.kz"),
        "hint": (
            "Яндекс ID → Безопасность → Пароли приложений → «Почта». В настройках ящика "
            "(Почтовые программы) включите доступ по IMAP."
        ),
    },
    "mailru": {
        "title": "Mail.ru",
        "imap": "imap.mail.ru:993",
        "smtp": "smtp.mail.ru:465",
        "domains": ("mail.ru", "inbox.ru", "list.ru", "bk.ru", "internet.ru", "xmail.ru"),
        "hint": (
            "Mail.ru: Настройки → Безопасность → Пароли для внешних приложений → добавить, "
            "доступ «Полный доступ к почте (IMAP, POP, SMTP)». Обычный пароль не подойдёт."
        ),
    },
    "custom": {
        "title": "Другая почта",
        "imap": "",
        "smtp": "",
        "domains": (),
        "hint": "Укажите серверы IMAP и SMTP с портами (SSL): например imap.example.ru:993 и smtp.example.ru:465.",
    },
}


def guess_provider(address: str) -> str:
    """Служба по домену адреса; незнакомый домен — «другая почта»."""
    domain = (address or "").rsplit("@", 1)[-1].strip().lower()
    for key, meta in PROVIDERS.items():
        if domain and domain in meta["domains"]:
            return key
    return "custom"


def providers_public() -> list[dict]:
    return [
        {"key": key, "title": meta["title"], "imap": meta["imap"], "smtp": meta["smtp"], "hint": meta["hint"]}
        for key, meta in PROVIDERS.items()
    ]


# ---------------------------------------------------------------- настройки соединения
def to_config(account: MailAccount, overrides: dict[str, str] | None = None) -> mail.MailConfig:
    """Запись ящика → настройки соединения. Пустой сервер — по службе."""
    preset = PROVIDERS.get(account.provider) or PROVIDERS["custom"]
    imap_host, imap_port = mail._host_port(account.imap or preset["imap"], mail.DEFAULT_IMAP)
    smtp_host, smtp_port = mail._host_port(account.smtp or preset["smtp"], mail.DEFAULT_SMTP)
    shop = settings_logic.pick(overrides, "shop_name", (os.getenv("POSTER_SHOP_NAME") or "").strip())
    return mail.MailConfig(
        user=(account.user or "").strip(),
        password=crypto.decrypt(account.password or ""),
        imap_host=imap_host,
        imap_port=imap_port,
        smtp_host=smtp_host,
        smtp_port=smtp_port,
        sender_name=(account.sender_name or "").strip() or shop or "ПОСТЕР",
        provider=account.provider or "custom",
        account_id=account.id,
    )


def public(account: MailAccount) -> dict:
    """Что видит сотрудник в переключателе ящиков: без серверов и пароля."""
    return {
        "id": account.id,
        "title": account.title or account.user,
        "user": account.user,
        "provider": account.provider,
    }


# ---------------------------------------------------------------- кто что видит
def all_accounts(db: Session) -> list[MailAccount]:
    return list(db.scalars(select(MailAccount).order_by(MailAccount.position, MailAccount.id)).all())


def visible(db: Session, user: CurrentUser) -> list[MailAccount]:
    """Ящики, с которыми этот человек может работать, в порядке показа.

    Администратор и тот, кто управляет сотрудниками, видят все включённые:
    им их подключать и проверять. Остальные — только назначенные, не больше двух.
    """
    accounts = [a for a in all_accounts(db) if a.active and a.user]
    if user.is_admin or user.can("staff.manage"):
        return accounts
    employee = db.get(Employee, user.employee_id) if user.employee_id else None
    if employee is None:
        return []
    by_id = {a.id: a for a in accounts}
    return [by_id[i] for i in (employee.mail_accounts or []) if i in by_id][:MAX_PER_EMPLOYEE]


def pick(db: Session, user: CurrentUser, account_id: int | None) -> MailAccount | None:
    """Ящик для запроса: названный, если он доступен, иначе первый доступный.
    None — доступных нет. PermissionError — назван чужой."""
    allowed = visible(db, user)
    if account_id is None:
        return allowed[0] if allowed else None
    for account in allowed:
        if account.id == account_id:
            return account
    raise PermissionError("Этот ящик вам не назначен")


def clean_ids(db: Session, ids: list[int]) -> list[int]:
    """Список ящиков для профиля: существующие, без повторов, не больше двух."""
    unique: list[int] = []
    for value in ids:
        if value not in unique:
            unique.append(value)
    if len(unique) > MAX_PER_EMPLOYEE:
        raise ValueError(f"Одному сотруднику — не больше {MAX_PER_EMPLOYEE} ящиков")
    known = set(db.scalars(select(MailAccount.id).where(MailAccount.id.in_(unique))).all()) if unique else set()
    missing = [i for i in unique if i not in known]
    if missing:
        raise ValueError(f"Ящиков с такими номерами нет: {missing}")
    return unique


def users_of(db: Session) -> dict[int, list[str]]:
    """Номер ящика → имена сотрудников, которым он назначен."""
    out: dict[int, list[str]] = {}
    for employee in db.scalars(select(Employee).order_by(Employee.name)).all():
        for account_id in employee.mail_accounts or []:
            out.setdefault(account_id, []).append(employee.name)
    return out


def forget(db: Session, account_id: int) -> int:
    """Ящик удалён — убрать его из профилей. Возвращает, у скольких убрали."""
    touched = 0
    for employee in db.scalars(select(Employee)).all():
        current = list(employee.mail_accounts or [])
        if account_id in current:
            employee.mail_accounts = [i for i in current if i != account_id]
            touched += 1
    return touched


# ---------------------------------------------------------------- перенос старой настройки
LEGACY_KEYS = ("mail_user", "mail_password", "mail_imap", "mail_smtp", "mail_sender")


def migrate_legacy(db: Session) -> MailAccount | None:
    """Ящик из прежних «Настроек» (или из .env) → первая запись в списке.

    Делается один раз, когда ящиков ещё нет. Ящик назначается всем, у кого
    есть право на почту: для них ничего не должно измениться. Старые ключи
    из таблицы настроек убираются — пароль не должен лежать в двух местах.
    """
    if db.scalar(select(MailAccount.id).limit(1)) is not None:
        return None
    rows = {row.key: row for row in db.scalars(select(Setting).where(Setting.key.in_(LEGACY_KEYS))).all()}
    overrides = {
        key: (crypto.decrypt(row.value) if key == "mail_password" else row.value) for key, row in rows.items()
    }
    legacy = mail.config(overrides)
    if not legacy.configured:
        return None
    account = MailAccount(
        title="Основной ящик",
        provider=guess_provider(legacy.user),
        user=legacy.user,
        password=crypto.encrypt(legacy.password),
        imap=f"{legacy.imap_host}:{legacy.imap_port}",
        smtp=f"{legacy.smtp_host}:{legacy.smtp_port}",
        sender_name=overrides.get("mail_sender", "").strip(),
    )
    db.add(account)
    db.flush()
    for employee in db.scalars(select(Employee)).all():
        if "mail.access" in (employee.permissions or []) and not (employee.mail_accounts or []):
            employee.mail_accounts = [account.id]
    for row in rows.values():
        db.delete(row)
    db.commit()
    return account
