"""Сотрудники: карточка, создание, правка."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, field_validator


class EmployeeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    permissions: list[str]
    active: bool
    note: str
    access_mode: str = "any"
    allowed_devices: list[int] = []
    mail_accounts: list[int] = []
    has_password: bool = False
    last_login_at: object | None = None
    created_at: object | None = None

    @field_validator("allowed_devices", "mail_accounts", mode="before")
    @classmethod
    def _none_is_empty(cls, value: object) -> object:
        # колонка, дописанная в существующую базу, у старых строк пуста (NULL)
        return [] if value is None else value


class EmployeeCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    password: str = Field(default="", max_length=200)
    permissions: list[str] | None = None
    note: str = ""
    access_mode: str = "any"                  # "any" | "devices"
    allowed_devices: list[int] = []
    # номера почтовых ящиков, с которыми сотрудник работает; не больше двух
    mail_accounts: list[int] = Field(default_factory=list, max_length=2)


class EmployeeUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=80)
    password: str | None = None          # пустая строка = убрать пароль
    permissions: list[str] | None = None
    active: bool | None = None
    note: str | None = None
    access_mode: str | None = None
    allowed_devices: list[int] | None = None
    mail_accounts: list[int] | None = Field(default=None, max_length=2)
