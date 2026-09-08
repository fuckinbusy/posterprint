"""Компьютеры: карточка и правка."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class DeviceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    note: str
    last_ip: str
    first_ip: str
    browser: str = ""
    display_name: str = ""
    bound_to: list[str] = []          # имена профилей, привязанных к устройству
    is_current: bool = False
    first_seen_at: object | None = None
    last_seen_at: object | None = None


class DeviceUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, max_length=80)
    note: str | None = Field(default=None, max_length=200)
