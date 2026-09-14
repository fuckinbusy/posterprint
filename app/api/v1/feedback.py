"""Обратная связь разработчику: сотрудник пишет, разработчик читает и отвечает."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.logs import log as applog
from app.core.security import CurrentUser, current_user, require_perm
from app.models import Feedback
from app.schemas.feedback import FeedbackIn, FeedbackOut, FeedbackUpdate
from app.services import feedback as feedback_logic

router = APIRouter(prefix="/api/feedback", tags=["feedback"])


@router.get("/targets", dependencies=[Depends(require_perm("feedback.send"))])
def targets() -> dict:
    """Куда уходят сообщения — чтобы форма честно сказала, увидит ли их
    кто-то сразу или только когда откроет раздел."""
    where = feedback_logic.targets()
    return {"mail": bool(where["email"]), "webhook": bool(where["webhook"])}


@router.get("", response_model=list[FeedbackOut])
def list_feedback(
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_perm("feedback.send")),
) -> list[FeedbackOut]:
    rows = feedback_logic.listing(db, employee_id=user.employee_id, everything=user.can("staff.manage"))
    return [FeedbackOut.model_validate(r) for r in rows]


@router.post("", response_model=FeedbackOut, status_code=201)
def send_feedback(
    payload: FeedbackIn,
    request: Request,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_perm("feedback.send")),
) -> FeedbackOut:
    item = feedback_logic.create(
        db,
        kind=payload.kind,
        title=payload.title,
        text=payload.text,
        page=payload.page,
        author=user.name,
        employee_id=user.employee_id,
        user_agent=request.headers.get("user-agent", ""),
    )
    applog.info("Обратная связь №%s (%s) от %s: %s", item.id, item.kind, user.name, item.title)
    return FeedbackOut.model_validate(item)


@router.patch("/{feedback_id}", response_model=FeedbackOut)
def update_feedback(
    feedback_id: int,
    payload: FeedbackUpdate,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_perm("staff.manage")),
) -> FeedbackOut:
    item = db.get(Feedback, feedback_id)
    if item is None:
        raise HTTPException(404, "Сообщение не найдено")
    if payload.status is not None:
        item.status = payload.status
    if payload.reply is not None:
        item.reply = payload.reply.strip()
        # ответили — значит прочитали; «новое» с ответом выглядело бы странно
        if item.status == "new":
            item.status = "seen"
    db.commit()
    db.refresh(item)
    applog.info("Обратная связь №%s: %s · %s", item.id, item.status, user.name)
    return FeedbackOut.model_validate(item)


@router.delete("/{feedback_id}", status_code=204)
def delete_feedback(
    feedback_id: int,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(current_user),
) -> None:
    """Автор может убрать своё, пока его не прочитали; разработчик — любое."""
    item = db.get(Feedback, feedback_id)
    if item is None:
        raise HTTPException(404, "Сообщение не найдено")
    mine = item.employee_id == user.employee_id and user.kind != "guest"
    if not user.can("staff.manage") and not (mine and item.status == "new"):
        raise HTTPException(403, "Удалить можно только своё непрочитанное сообщение")
    db.delete(item)
    db.commit()
