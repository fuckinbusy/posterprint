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
    group_key: str = Field(min_length=1, max_length=40)
    item_key: str = Field(min_length=1, max_length=80)
    title: str = Field(default="", max_length=120)
    value: float = Field(default=0.0, ge=0)
    # не передали — возьмём единицу раздела
    unit: str = Field(default="", max_length=20)
    note: str = Field(default="", max_length=200)


class PriceItemUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, max_length=120)
    value: float | None = Field(default=None, ge=0)
    unit: str | None = Field(default=None, max_length=20)
    active: bool | None = None
    note: str | None = Field(default=None, max_length=200)


# ---------------------------------------------------------------- разделы
class GroupIn(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    hint: str = Field(default="", max_length=300)
    unit: str = Field(default="₽", max_length=20)
    kind: str = Field(default="money", max_length=20)
    icon: str = Field(default="printer", max_length=30)
    active: bool = True
    # пусто — раздел верхнего уровня
    parent_key: str = Field(default="", max_length=40)


class GroupUpdate(BaseModel):
    """Правка раздела: меняется только присланное. Раньше правка шла той же
    схемой, что создание, и не присланные поля сбрасывались к умолчаниям —
    бот, поменявший подсказку, заодно возвращал разделу значок «printer»."""

    title: str | None = Field(default=None, min_length=1, max_length=120)
    hint: str | None = Field(default=None, max_length=300)
    unit: str | None = Field(default=None, max_length=20)
    kind: str | None = Field(default=None, max_length=20)
    icon: str | None = Field(default=None, max_length=30)
    active: bool | None = None
    parent_key: str | None = Field(default=None, max_length=40)


class MoveIn(BaseModel):
    group_key: str = Field(min_length=1, max_length=40)
