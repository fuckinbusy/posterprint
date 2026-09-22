"""Почта: список частями, письмо, вложения, ответ, что нового.

Право одно — mail.access «Работать с почтой». Ящиков может быть несколько:
какие из них видит сотрудник, назначает администратор (не больше двух на
человека), а запрос называет ящик параметром account. Не назвал — берётся
первый доступный. Чужой ящик — 403: номер в адресе не должен открывать
переписку, которую человеку не назначали.

Подключение и проверка ящиков — в mail_accounts.py, только тому, кто
управляет сотрудниками.
"""

from __future__ import annotations

from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.logs import log as applog
from app.core.security import CurrentUser, require_perm
from app.models import MailAccount
from app.schemas.mail import ReplyIn, SeenIn, SendIn
from app.services import mail
from app.services import mail_accounts as accounts_logic
from app.services import settings as settings_logic

router = APIRouter(
    prefix="/api/mail",
    tags=["mail"],
    dependencies=[Depends(require_perm("mail.access"))],
)

ACCOUNT = Query(default=None, ge=1, description="номер ящика; не указан — первый доступный")
FOLDER = Query(default=mail.INBOX, max_length=200, description="папка; по умолчанию входящие")
Perm = Depends(require_perm("mail.access"))

NOT_CONNECTED = "Почта не настроена: администратор ещё не подключил ни одного ящика."
NOT_ASSIGNED = "Вам не назначен почтовый ящик — попросите администратора."


class Box:
    """Ящик запроса: запись, настройки соединения и его собственное соединение."""

    def __init__(self, account: MailAccount, cfg: mail.MailConfig):
        self.account = account
        self.cfg = cfg
        self.mailbox = mail.mailbox_for(account.id)


def _pick(db: Session, user: CurrentUser, account_id: int | None) -> MailAccount | None:
    try:
        return accounts_logic.pick(db, user, account_id)
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from None


def _box(db: Session, user: CurrentUser, account_id: int | None) -> Box:
    account = _pick(db, user, account_id)
    if account is None:
        nothing = not accounts_logic.all_accounts(db)
        raise HTTPException(503, NOT_CONNECTED if nothing else NOT_ASSIGNED)
    return Box(account, accounts_logic.to_config(account, settings_logic.overrides(db)))


def _guard(fn, *args, **kwargs):
    """MailError → понятный ответ: 503 «не настроено», 502 «сервер почты»."""
    try:
        return fn(*args, **kwargs)
    except mail.MailError as exc:
        text = str(exc)
        raise HTTPException(503 if "не настроена" in text else 502, text) from None
    except ValueError as exc:
        # библиотека почты не приняла заголовок (например, адрес с переносом строки)
        raise HTTPException(422, f"Письмо не собралось: {exc}") from None


@router.get("/contacts")
def contacts(db: Session = Depends(get_db)) -> dict:
    """Свои адресаты для окна «Написать»: имя и адрес. Задаются в настройках."""
    return {"contacts": mail.contacts(settings_logic.overrides(db))}


@router.get("/accounts")
def my_accounts(db: Session = Depends(get_db), user: CurrentUser = Perm) -> dict:
    """Ящики, с которыми работает этот человек, — для переключателя."""
    return {"accounts": [accounts_logic.public(a) for a in accounts_logic.visible(db, user)]}


@router.get("/status")
def status(account: int | None = ACCOUNT, db: Session = Depends(get_db), user: CurrentUser = Perm) -> dict:
    """Подключена ли почта, какие ящики доступны и сколько непрочитанных в выбранном."""
    listing = [accounts_logic.public(a) for a in accounts_logic.visible(db, user)]
    chosen = _pick(db, user, account)
    if chosen is None:
        reason = "none" if not accounts_logic.all_accounts(db) else "unassigned"
        return {
            "configured": False, "reason": reason, "account": None, "user": "",
            "unseen": 0, "latest_uid": 0, "accounts": listing, "error": "",
        }
    box = Box(chosen, accounts_logic.to_config(chosen, settings_logic.overrides(db)))
    # Ящик не ответил — это не повод прятать страницу: рядом может быть второй,
    # рабочий. Отдаём ошибку полем, переключатель остаётся на месте.
    error = ""
    fresh_now = {"unseen": 0, "latest_uid": 0}
    try:
        fresh_now = box.mailbox.fresh(box.cfg)
    except mail.MailError as exc:
        error = str(exc)
    return {
        "configured": True, "reason": "", "account": chosen.id, "user": chosen.user,
        "unseen": fresh_now["unseen"], "latest_uid": fresh_now["latest_uid"], "accounts": listing,
        "error": error,
    }


@router.get("/messages")
def messages(
    before: int | None = Query(default=None, ge=1, description="письма старше этого UID"),
    after: int | None = Query(default=None, ge=0, description="письма новее этого UID"),
    limit: int = Query(default=mail.PAGE_SIZE, ge=1, le=mail.MAX_PAGE),
    account: int | None = ACCOUNT,
    db: Session = Depends(get_db),
    user: CurrentUser = Perm,
) -> dict:
    """Страница списка. Интерфейс листает частями: вниз — before, вверх — after."""
    box = _box(db, user, account)
    return _guard(box.mailbox.page, box.cfg, before, after, limit)


def parse_after(raw: str | None) -> dict[int, int]:
    """«1:120,2:55» → {1: 120, 2: 55}: последний виденный UID по каждому ящику.
    Мусор пропускается: опрос не должен падать из-за битой строки."""
    out: dict[int, int] = {}
    for chunk in (raw or "").split(","):
        left, _, right = chunk.partition(":")
        if left.strip().isdigit() and right.strip().isdigit():
            out[int(left)] = int(right)
    return out


@router.get("/fresh")
def fresh(
    after: str | None = Query(default=None, max_length=400, description="виденные UID: «ящик:uid,ящик:uid»"),
    db: Session = Depends(get_db),
    user: CurrentUser = Perm,
) -> dict:
    """Что нового во всех ящиках человека — для всплывающих уведомлений и значка.

    Один запрос на все ящики. Недоступный ящик не роняет ответ: у него будет
    error, остальные ответят как обычно. Ответ по каждому ящику кэшируется на
    сервере на 20 с, так что частый опрос с нескольких мест почту не мучает.
    """
    allowed = accounts_logic.visible(db, user)
    if not allowed:
        return {"configured": False, "unseen": 0, "accounts": []}
    seen = parse_after(after)
    overrides = settings_logic.overrides(db)
    out: list[dict] = []
    for account in allowed:
        cfg = accounts_logic.to_config(account, overrides)
        entry = {**accounts_logic.public(account), "unseen": 0, "latest_uid": 0, "messages": [], "error": ""}
        try:
            entry.update(mail.mailbox_for(account.id).fresh_since(cfg, seen.get(account.id)))
        except mail.MailError as exc:
            entry["error"] = str(exc)
        out.append(entry)
    return {"configured": True, "unseen": sum(e["unseen"] for e in out), "accounts": out}


@router.get("/ref")
def referenced(
    id: str = Query(min_length=3, max_length=300, description="Message-ID письма, на которое ссылаются"),
    account: int | None = ACCOUNT,
    db: Session = Depends(get_db),
    user: CurrentUser = Perm,
) -> dict:
    """Письмо, на которое отвечает открытое: ищется во входящих и отправленных.
    Так по ответу клиента можно одним наведением увидеть, что мы ему писали."""
    box = _box(db, user, account)
    return _guard(box.mailbox.referenced, box.cfg, id)


@router.get("/messages/{uid}")
def message(
    uid: int,
    folder: str = FOLDER,
    account: int | None = ACCOUNT,
    db: Session = Depends(get_db),
    user: CurrentUser = Perm,
) -> dict:
    """Письмо целиком. Открыли — значит прочитали: снимаем «непрочитанное»,
    как любая почтовая программа (только во входящих: отправленные и так
    свои)."""
    box = _box(db, user, account)
    detail = _guard(box.mailbox.message, box.cfg, uid, folder)
    if folder == mail.INBOX and not detail.get("seen"):
        try:
            box.mailbox.set_seen(box.cfg, uid, True)
            detail["seen"] = True
        except mail.MailError:
            pass  # не смогли отметить — не страшно, письмо показали
    return detail


@router.post("/messages/{uid}/seen")
def set_seen(
    uid: int,
    payload: SeenIn,
    account: int | None = ACCOUNT,
    db: Session = Depends(get_db),
    user: CurrentUser = Perm,
) -> dict:
    box = _box(db, user, account)
    _guard(box.mailbox.set_seen, box.cfg, uid, payload.seen)
    return {"uid": uid, "seen": payload.seen}


@router.get("/messages/{uid}/attachments/{index}")
def attachment(
    uid: int,
    index: int,
    folder: str = FOLDER,
    account: int | None = ACCOUNT,
    db: Session = Depends(get_db),
    user: CurrentUser = Perm,
) -> Response:
    box = _box(db, user, account)
    filename, ctype, payload = _guard(box.mailbox.attachment, box.cfg, uid, index, folder)
    # имя с кириллицей — через RFC 5987, иначе браузер сохранит «attachment»
    disposition = f"attachment; filename*=UTF-8''{quote(filename)}"
    return Response(content=payload, media_type=ctype, headers={"Content-Disposition": disposition})


@router.post("/messages/{uid}/reply", status_code=201)
def reply(
    uid: int,
    payload: ReplyIn,
    account: int | None = ACCOUNT,
    db: Session = Depends(get_db),
    user: CurrentUser = Perm,
) -> dict:
    box = _box(db, user, account)
    result = _guard(box.mailbox.reply, box.cfg, uid, payload.text.strip(), user.name)
    applog.info(
        "Почта: ответ на письмо %s → %s · с %s · %s", uid, result["to"]["email"], box.cfg.user, user.name
    )
    return result


@router.post("/send", status_code=201)
def send(
    payload: SendIn,
    account: int | None = ACCOUNT,
    db: Session = Depends(get_db),
    user: CurrentUser = Perm,
) -> dict:
    box = _box(db, user, account)
    cfg = box.cfg
    to = [a.strip() for a in payload.to.replace(";", ",").split(",") if a.strip()]
    text = payload.text.strip() + f"\n\n— {user.name}, {cfg.sender_name}"
    message_id = _guard(box.mailbox.send, cfg, to, payload.subject.strip() or "(без темы)", text)
    applog.info("Почта: письмо → %s · с %s · %s", ", ".join(to), cfg.user, user.name)
    return {"to": to, "message_id": message_id, "from": cfg.user}
