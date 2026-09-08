"""Почта: ответ, новое письмо, отметка «прочитано»."""

from __future__ import annotations

from pydantic import BaseModel, Field, field_validator


class ReplyIn(BaseModel):
    text: str = Field(min_length=1, max_length=20_000)


class SendIn(BaseModel):
    to: str = Field(min_length=3, max_length=200)
    subject: str = Field(default="", max_length=300)
    text: str = Field(min_length=1, max_length=20_000)

    @field_validator("to", "subject")
    @classmethod
    def _single_line(cls, value: str) -> str:
        # перенос строки в заголовке письма stdlib отвергает исключением —
        # отвечаем 422 сами, а не 500
        if "\r" in value or "\n" in value:
            raise ValueError("Адрес и тема — одной строкой")
        return value.strip()


class SeenIn(BaseModel):
    seen: bool = True
