"""Обратная связь от сотрудников разработчику: ошибки, идеи, вопросы."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import utcnow


class Feedback(Base):
    """Одно сообщение. Живёт в базе всегда — почта и вебхук только дублируют
    его наружу, и если они не настроены, ничего не теряется."""

    __tablename__ = "feedback"

    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(String(20), default="bug")       # bug | idea | question
    title: Mapped[str] = mapped_column(String(120), default="")
    text: Mapped[str] = mapped_column(Text, default="")
    # где это случилось: раздел интерфейса и браузер — чтобы не переспрашивать
    page: Mapped[str] = mapped_column(String(200), default="")
    user_agent: Mapped[str] = mapped_column(String(300), default="")
    author: Mapped[str] = mapped_column(String(80), default="")
    employee_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    # new — не смотрели; seen — прочитано; done — сделано; declined — не будет
    status: Mapped[str] = mapped_column(String(20), default="new", index=True)
    # ответ разработчика — виден автору в его списке
    reply: Mapped[str] = mapped_column(Text, default="")
    # куда ушло уведомление: mail, webhook — через запятую; пусто — только база
    delivered: Mapped[str] = mapped_column(String(40), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
