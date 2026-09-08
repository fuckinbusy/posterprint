"""Клиенты: карточка, правка, слияние дублей."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class ClientOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    phone: str
    contact: str
    notes: str
    created_at: datetime
    updated_at: datetime
    orders_count: int = 0
    active_count: int = 0
    last_order_at: datetime | None = None
    total_sum: float | None = None  # None без права видеть итоги


class ClientUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, max_length=120)
    phone: str | None = Field(default=None, max_length=40)
    contact: str | None = Field(default=None, max_length=120)
    notes: str | None = Field(default=None, max_length=4000)


class MergeIn(BaseModel):
    into: int
