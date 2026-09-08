"""Вход: пароль администратора, вход сотрудника, ответ с токеном."""

from __future__ import annotations

from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    password: str = Field(min_length=1, max_length=200)


class EmployeeLogin(BaseModel):
    employee_id: int
    password: str = Field(default="", max_length=200)


class LoginResponse(BaseModel):
    token: str
    expires_at: int
    name: str
    kind: str
    permissions: list[str]
