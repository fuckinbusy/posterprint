"""Обратная связь: что присылает сотрудник, что видит он и разработчик."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Kind = Literal["bug", "idea", "question"]
Status = Literal["new", "seen", "done", "declined"]


class FeedbackIn(BaseModel):
    kind: Kind = "bug"
    title: str = Field(min_length=3, max_length=120)
    text: str = Field(min_length=10, max_length=4000)
    # раздел, где сотрудник был, когда нажал «Написать» — подставляет интерфейс
    page: str = Field(default="", max_length=200)


class FeedbackUpdate(BaseModel):
    """Разработчик: сменить состояние и ответить автору."""

    model_config = ConfigDict(extra="forbid")

    status: Status | None = None
    reply: str | None = Field(default=None, max_length=2000)


class FeedbackOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    kind: str
    title: str
    text: str
    page: str
    user_agent: str
    author: str
    status: str
    reply: str
    delivered: str
    created_at: datetime
    updated_at: datetime
