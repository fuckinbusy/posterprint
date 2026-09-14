"""Обратная связь: сохранить и донести до разработчика.

Куда доносить, если Telegram недоступен. Сообщение всегда остаётся в базе
и видно в разделе «Обратная связь» тому, у кого есть staff.manage. Сверх
этого два необязательных канала, оба настраиваются в .env:

* POSTER_FEEDBACK_EMAIL — письмо на адрес разработчика через рабочий ящик
  мастерской (тот же SMTP, что у раздела «Почта»). Ничего ставить не надо:
  если почта уже настроена, письма пойдут сразу.
* POSTER_FEEDBACK_WEBHOOK — POST с JSON на любой адрес: бот в MAX или VK,
  Mattermost, свой скрипт, Google Apps Script, что угодно с http.

Доставка — в фоновом потоке: сотрудник не должен ждать SMTP, а сбой
доставки не должен ронять сохранение. Результат пишется в поле delivered.
"""

from __future__ import annotations

import json
import logging
import os
import threading
import urllib.request
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.models import Feedback
from app.services import mail
from app.services import settings as settings_logic

log = logging.getLogger("poster")

KIND_TITLES = {"bug": "Ошибка", "idea": "Идея", "question": "Вопрос"}
STATUS_TITLES = {"new": "новое", "seen": "прочитано", "done": "сделано", "declined": "не будет"}
WEBHOOK_TIMEOUT = 10
# сколько сообщений отдаём в список: обратная связь — не журнал, сотен тут не будет
LIST_LIMIT = 300


def targets() -> dict[str, str]:
    return {
        "email": (os.getenv("POSTER_FEEDBACK_EMAIL") or "").strip(),
        "webhook": (os.getenv("POSTER_FEEDBACK_WEBHOOK") or "").strip(),
    }


def create(
    db: Session,
    *,
    kind: str,
    title: str,
    text: str,
    page: str,
    author: str,
    employee_id: int | None,
    user_agent: str,
) -> Feedback:
    item = Feedback(
        kind=kind,
        title=title.strip(),
        text=text.strip(),
        page=page.strip(),
        author=author,
        employee_id=employee_id,
        user_agent=user_agent[:300],
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    # уведомления — уже после commit и в стороне: сотрудник получил «отправлено»,
    # а письмо и вебхук могут идти сколько угодно
    threading.Thread(target=deliver, args=(item.id,), name="poster-feedback", daemon=True).start()
    return item


def render(item: Feedback) -> str:
    """Текст письма и вебхука — одинаковый, читается без интерфейса."""
    when = item.created_at.strftime("%d.%m.%Y %H:%M") if isinstance(item.created_at, datetime) else ""
    return "\n".join(
        [
            f"{KIND_TITLES.get(item.kind, item.kind)}: {item.title}",
            f"Кто: {item.author or '—'} · когда: {when} UTC · где: {item.page or '—'}",
            "",
            item.text,
            "",
            f"Браузер: {item.user_agent or '—'}",
            f"№{item.id} в разделе «Обратная связь»",
        ]
    )


def deliver(feedback_id: int) -> None:
    """Разослать одно сообщение по настроенным каналам. Каждый канал — сам
    по себе: письмо не ушло — вебхук всё равно пробуем."""
    where = targets()
    if not any(where.values()):
        return
    db = SessionLocal()
    try:
        item = db.get(Feedback, feedback_id)
        if item is None:
            return
        done: list[str] = []
        if where["email"]:
            try:
                cfg = mail.config(settings_logic.overrides(db))
                subject = f"[ПОСТЕР] {KIND_TITLES.get(item.kind, item.kind)}: {item.title}"
                mail.mailbox.send(cfg, [where["email"]], subject, render(item))
                done.append("mail")
            except Exception as exc:  # письмо не ушло — это не причина терять сообщение
                log.warning("Обратная связь №%s: письмо не отправилось: %s", item.id, exc)
        if where["webhook"]:
            try:
                post_webhook(where["webhook"], item)
                done.append("webhook")
            except Exception as exc:
                log.warning("Обратная связь №%s: вебхук не ответил: %s", item.id, exc)
        item.delivered = ",".join(done)
        db.commit()
    finally:
        db.close()


def post_webhook(url: str, item: Feedback) -> None:
    payload = {
        "id": item.id,
        "kind": item.kind,
        "kind_title": KIND_TITLES.get(item.kind, item.kind),
        "title": item.title,
        "text": item.text,
        "page": item.page,
        "author": item.author,
        "user_agent": item.user_agent,
        "created_at": item.created_at.isoformat() if item.created_at else "",
        # готовая строка для ботов, которые умеют только «text»
        "message": render(item),
    }
    request = urllib.request.Request(
        url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json; charset=utf-8", "User-Agent": "poster-feedback"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=WEBHOOK_TIMEOUT) as response:
        if response.status >= 300:
            raise RuntimeError(f"HTTP {response.status}")


def listing(db: Session, *, employee_id: int | None, everything: bool) -> list[Feedback]:
    """Свои сообщения — автору; все — тому, кто отвечает."""
    stmt = select(Feedback).order_by(Feedback.created_at.desc()).limit(LIST_LIMIT)
    if not everything:
        if employee_id is None:
            # администратор без профиля: его сообщения помечены пустым employee_id
            stmt = stmt.where(Feedback.employee_id.is_(None))
        else:
            stmt = stmt.where(Feedback.employee_id == employee_id)
    return list(db.scalars(stmt).all())
