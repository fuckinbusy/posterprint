"""Прайс: позиции и разделы."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class PriceItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    group_key: str
    item_key: str
    title: str
    value: float
    # за что берётся цена: ₽/шт, ₽/м², ₽/пог.м. Пусто = как у раздела
    unit: str = ""
    # виды работ, которые ссылаются на позицию поимённо — её нельзя удалять
    used_by: list[str] = Field(default_factory=list)
    active: bool
    note: str
    updated_at: datetime
    updated_by: str


class PriceItemCreate(BaseModel):
    group_key: str
    item_key: str = Field(min_length=1, max_length=80)
    title: str = ""
    value: float = Field(default=0.0, ge=0)
    # не передали — возьмём единицу раздела
    unit: str = Field(default="", max_length=20)
    note: str = ""
    author: str = ""


class PriceItemUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str | None = None
    value: float | None = Field(default=None, ge=0)
    unit: str | None = Field(default=None, max_length=20)
    active: bool | None = None
    note: str | None = None
    author: str | None = None


# ---------------------------------------------------------------- разделы
class GroupIn(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    hint: str = ""
    unit: str = "₽"
    kind: str = "money"
    icon: str = "printer"
    active: bool = True
    # пусто — раздел верхнего уровня
    parent_key: str = Field(default="", max_length=40)


class MoveIn(BaseModel):
    group_key: str = Field(min_length=1, max_length=40)
