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


# ---------------------------------------------------------------- ящики
def _address(value: str) -> str:
    value = value.strip()
    if value and ("@" not in value or " " in value or "\n" in value or "\r" in value):
        raise ValueError("Адрес ящика — вида name@example.ru, без пробелов")
    return value


def _server(value: str) -> str:
    value = value.strip()
    if value and not all(ch.isalnum() or ch in ".-:" for ch in value):
        raise ValueError("Сервер — имя и порт: imap.mail.ru:993")
    return value


class MailAccountIn(BaseModel):
    """Новый ящик. Серверы можно не указывать — подставятся по службе."""

    title: str = Field(default="", max_length=60)
    provider: str = Field(default="", max_length=20)   # пусто — определить по адресу
    user: str = Field(min_length=3, max_length=200)
    password: str = Field(min_length=1, max_length=300)
    imap: str = Field(default="", max_length=120)
    smtp: str = Field(default="", max_length=120)
    sender_name: str = Field(default="", max_length=120)
    active: bool = True

    _user = field_validator("user")(_address)
    _servers = field_validator("imap", "smtp")(_server)


class MailAccountUpdate(BaseModel):
    """Правка ящика. Пароль пустой или не прислан — оставить прежний: форма
    его не показывает, и стирать по ошибке незачем."""

    title: str | None = Field(default=None, max_length=60)
    provider: str | None = Field(default=None, max_length=20)
    user: str | None = Field(default=None, min_length=3, max_length=200)
    password: str | None = Field(default=None, max_length=300)
    imap: str | None = Field(default=None, max_length=120)
    smtp: str | None = Field(default=None, max_length=120)
    sender_name: str | None = Field(default=None, max_length=120)
    active: bool | None = None

    @field_validator("user")
    @classmethod
    def _check_user(cls, value: str | None) -> str | None:
        return None if value is None else _address(value)

    @field_validator("imap", "smtp")
    @classmethod
    def _check_server(cls, value: str | None) -> str | None:
        return None if value is None else _server(value)
