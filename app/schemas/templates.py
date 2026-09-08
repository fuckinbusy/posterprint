"""Виды работ и их поля; предпросмотр расчёта."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class FieldIn(BaseModel):
    key: str = Field(min_length=1, max_length=40)
    label: str = ""
    type: str = "select"
    source: str = "price"
    price_group: str = ""
    options: list[str] = []
    default_value: str = ""
    pricing_role: str = "none"
    price_item: str = ""
    unit: str = "мм"
    source_field: str = ""
    required: bool = False


class FieldOut(FieldIn):
    model_config = ConfigDict(from_attributes=True)

    id: int


class TemplateIn(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    short: str = ""
    hint: str = ""
    icon: str = "printer"
    quantity_label: str = "Количество, шт"
    active: bool = True
    fields: list[FieldIn] = []


class TemplateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    key: str
    title: str
    short: str
    hint: str
    icon: str
    quantity_label: str
    active: bool
    sort_order: int
    fields: list[FieldOut] = []
    orders_count: int = 0


class PreviewIn(BaseModel):
    quantity: int = 1
    params: dict = {}
    fields: list[FieldIn] = []
