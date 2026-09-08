"""Настройки владельца."""

from __future__ import annotations

from pydantic import BaseModel


class SettingsIn(BaseModel):
    values: dict[str, str]
