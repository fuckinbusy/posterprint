"""Почта: список частями, письмо, вложения, ответ, что нового.

Право одно — mail.access «Работать с почтой», по умолчанию включено:
ящик общий рабочий, читать и отвечать клиентам — часть работы приёмки.
Проверка соединения — только тому, кто правит настройки.
"""

from __future__ import annotations

from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.logs import log as applog
from app.core.security import CurrentUser, require_perm
from app.schemas.mail import ReplyIn, SeenIn, SendIn
from app.services import mail
from app.services import settings as settings_logic

router = APIRouter(
    prefix="/api/mail",
    tags=["mail"],
    dependencies=[Depends(require_perm("mail.access"))],
)


def _cfg(db: Session) -> mail.MailConfig:
    return mail.config(settings_logic.overrides(db))


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


@router.get("/status")
def status(db: Session = Depends(get_db)) -> dict:
    """Настроен ли ящик и сколько непрочитанных — для значка в шапке."""
    cfg = _cfg(db)
    if not cfg.configured:
        return {"configured": False, "user": "", "unseen": 0, "latest_uid": 0}
    fresh = _guard(mail.mailbox.fresh, cfg)
    return {"configured": True, "user": cfg.user, "unseen": fresh["unseen"], "latest_uid": fresh["latest_uid"]}


@router.get("/messages")
def messages(
    before: int | None = Query(default=None, ge=1, description="письма старше этого UID"),
    after: int | None = Query(default=None, ge=0, description="письма новее этого UID"),
    limit: int = Query(default=mail.PAGE_SIZE, ge=1, le=mail.MAX_PAGE),
    db: Session = Depends(get_db),
) -> dict:
    """Страница списка. Интерфейс листает частями: вниз — before, вверх — after."""
    return _guard(mail.mailbox.page, _cfg(db), before, after, limit)


@router.get("/fresh")
def fresh(
    after: int | None = Query(default=None, ge=0, description="последний виденный UID"),
    db: Session = Depends(get_db),
) -> dict:
    """Что нового — для всплывающих уведомлений и значка. Ответ кэшируется на
    сервере на 20 с, так что частый опрос с нескольких мест ящик не мучает."""
    cfg = _cfg(db)
    if not cfg.configured:
        return {"configured": False, "latest_uid": 0, "unseen": 0, "messages": []}
    return {"configured": True, **_guard(mail.mailbox.fresh_since, cfg, after)}


FOLDER = Query(default=mail.INBOX, max_length=200, description="папка; по умолчанию входящие")


@router.get("/ref")
def referenced(
    id: str = Query(min_length=3, max_length=300, description="Message-ID письма, на которое ссылаются"),
    db: Session = Depends(get_db),
) -> dict:
    """Письмо, на которое отвечает открытое: ищется во входящих и отправленных.
    Так по ответу клиента можно одним наведением увидеть, что мы ему писали."""
    return _guard(mail.mailbox.referenced, _cfg(db), id)


@router.get("/messages/{uid}")
def message(uid: int, folder: str = FOLDER, db: Session = Depends(get_db)) -> dict:
    """Письмо целиком. Открыли — значит прочитали: снимаем «непрочитанное»,
    как любая почтовая программа (только во входящих: отправленные и так
    свои)."""
    cfg = _cfg(db)
    detail = _guard(mail.mailbox.message, cfg, uid, folder)
    if folder == mail.INBOX and not detail.get("seen"):
        try:
            mail.mailbox.set_seen(cfg, uid, True)
            detail["seen"] = True
        except mail.MailError:
            pass  # не смогли отметить — не страшно, письмо показали
    return detail


@router.post("/messages/{uid}/seen")
def set_seen(uid: int, payload: SeenIn, db: Session = Depends(get_db)) -> dict:
    _guard(mail.mailbox.set_seen, _cfg(db), uid, payload.seen)
    return {"uid": uid, "seen": payload.seen}


@router.get("/messages/{uid}/attachments/{index}")
def attachment(uid: int, index: int, folder: str = FOLDER, db: Session = Depends(get_db)) -> Response:
    filename, ctype, payload = _guard(mail.mailbox.attachment, _cfg(db), uid, index, folder)
    # имя с кириллицей — через RFC 5987, иначе браузер сохранит «attachment»
    disposition = f"attachment; filename*=UTF-8''{quote(filename)}"
    return Response(content=payload, media_type=ctype, headers={"Content-Disposition": disposition})


@router.post("/messages/{uid}/reply", status_code=201)
def reply(
    uid: int,
    payload: ReplyIn,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_perm("mail.access")),
) -> dict:
    result = _guard(mail.mailbox.reply, _cfg(db), uid, payload.text.strip(), user.name)
    applog.info("Почта: ответ на письмо %s → %s · %s", uid, result["to"]["email"], user.name)
    return result


@router.post("/send", status_code=201)
def send(
    payload: SendIn,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_perm("mail.access")),
) -> dict:
    cfg = _cfg(db)
    to = [a.strip() for a in payload.to.replace(";", ",").split(",") if a.strip()]
    text = payload.text.strip() + f"\n\n— {user.name}, {cfg.sender_name}"
    message_id = _guard(mail.mailbox.send, cfg, to, payload.subject.strip() or "(без темы)", text)
    applog.info("Почта: письмо → %s · %s", ", ".join(to), user.name)
    return {"to": to, "message_id": message_id}


@router.post("/check")
def check(
    db: Session = Depends(get_db),
    _: CurrentUser = Depends(require_perm("staff.manage")),
) -> dict:
    """Кнопка «Проверить соединение» в настройках: IMAP и SMTP по очереди."""
    return mail.mailbox.check(_cfg(db))
