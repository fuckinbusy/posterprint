"""Почта: ответ, новое письмо, отметка «прочитано»."""

from __future__ import annotations

from pydantic import BaseModel, Field


class ReplyIn(BaseModel):
    text: str = Field(min_length=1, max_length=20_000)


class SendIn(BaseModel):
    to: str = Field(min_length=3, max_length=200)
    subject: str = Field(default="", max_length=300)
    text: str = Field(min_length=1, max_length=20_000)


class SeenIn(BaseModel):
    seen: bool = True
