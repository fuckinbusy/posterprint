"""Сотрудники: карточка, создание, правка."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class EmployeeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    permissions: list[str]
    active: bool
    note: str
    access_mode: str = "any"
    allowed_devices: list[int] = []
    has_password: bool = False
    last_login_at: object | None = None
    created_at: object | None = None


class EmployeeCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    password: str = Field(default="", max_length=200)
    permissions: list[str] | None = None
    note: str = ""
    access_mode: str = "any"                  # "any" | "devices"
    allowed_devices: list[int] = []


class EmployeeUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=80)
    password: str | None = None          # пустая строка = убрать пароль
    permissions: list[str] | None = None
    active: bool | None = None
    note: str | None = None
    access_mode: str | None = None
    allowed_devices: list[int] | None = None
