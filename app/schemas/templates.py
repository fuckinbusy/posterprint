"""Виды работ и их поля; предпросмотр расчёта."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.orders import check_params


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
    short: str = Field(default="", max_length=40)
    hint: str = Field(default="", max_length=300)
    icon: str = Field(default="printer", max_length=30)
    quantity_label: str = Field(default="Количество, шт", max_length=80)
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
    quantity: int = Field(default=1, ge=0, le=1_000_000)
    params: dict = Field(default_factory=dict)
    _check_params = field_validator("params")(check_params)
    fields: list[FieldIn] = []
