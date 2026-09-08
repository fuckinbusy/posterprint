"""Заказ: создание, правка, статус, события, расчёт, доп. услуги."""

from __future__ import annotations

import json
from collections.abc import Sequence
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models import OrderStatus

# Длины повторяют колонки моделей (app/models/). SQLite длину не проверяет и
# молча примет мегабайт в поле телефона, Postgres — упадёт с 500; проверяем сами.

# params — JSON-колонка без ограничений на уровне базы: полей у вида работ
# десятки, а не тысячи, и значения в них — короткие строки и числа
MAX_PARAM_KEYS = 100
MAX_PARAMS_BYTES = 20_000
MAX_EXTRAS = 50


def check_params(value: dict | None) -> dict | None:
    if value is None:
        return None
    if len(value) > MAX_PARAM_KEYS:
        raise ValueError(f"Слишком много полей в параметрах: больше {MAX_PARAM_KEYS}")
    if len(json.dumps(value, ensure_ascii=False)) > MAX_PARAMS_BYTES:
        raise ValueError("Параметры заказа слишком велики")
    return value


class ExtraIn(BaseModel):
    """Доп. услуга к заказу: ключ позиции раздела «Услуги» и сколько раз."""

    key: str = Field(min_length=1, max_length=80)
    qty: float = Field(default=1, gt=0, le=100_000)


class ExtraOut(ExtraIn):
    title: str = ""
    rate: float = 0.0


class OrderBase(BaseModel):
    title: str = Field(default="", max_length=160)
    client_id: int | None = None
    client_name: str = Field(default="", max_length=120)
    client_phone: str = Field(default="", max_length=40)
    client_contact: str = Field(default="", max_length=120)
    quantity: int = Field(default=1, ge=1)
    params: dict = Field(default_factory=dict)
    extras: Sequence[ExtraIn] = Field(default_factory=list, max_length=MAX_EXTRAS)
    _check_params = field_validator("params")(check_params)
    price: float = Field(default=0.0, ge=0)
    prepaid: float = Field(default=0.0, ge=0)
    refunded: bool = False
    due_date: date | None = None
    manager: str = Field(default="", max_length=80)
    notes: str = Field(default="", max_length=4000)


class OrderCreate(OrderBase):
    # Статус при создании не принимается: заказ всегда начинается с «Новый».
    # Раньше поле было, и профиль без права на смену статуса мог завести
    # заказ сразу «Выданным» — мимо таблицы переходов и без completed_at.
    template_key: str
    # Как приняли внесённое: cash | transfer. Не хранится в заказе — уходит
    # строкой в журнал кассы (app/ledger.py). Пусто — наличные.
    pay_method: str | None = Field(default=None, max_length=20)


class OrderUpdate(BaseModel):
    """Все поля необязательны — приходит только то, что реально поменяли."""

    model_config = ConfigDict(extra="forbid")

    template_key: str | None = None
    title: str | None = Field(default=None, max_length=160)
    client_id: int | None = None
    client_name: str | None = Field(default=None, max_length=120)
    client_phone: str | None = Field(default=None, max_length=40)
    client_contact: str | None = Field(default=None, max_length=120)
    quantity: int | None = Field(default=None, ge=1)
    params: dict | None = None
    extras: list[ExtraIn] | None = Field(default=None, max_length=MAX_EXTRAS)
    _check_params = field_validator("params")(check_params)
    price: float | None = Field(default=None, ge=0)
    prepaid: float | None = Field(default=None, ge=0)
    refunded: bool | None = None
    due_date: date | None = None
    manager: str | None = Field(default=None, max_length=80)
    notes: str | None = Field(default=None, max_length=4000)
    # как приняли (или вернули) деньги, если внесённое изменилось
    pay_method: str | None = Field(default=None, max_length=20)


class StatusUpdate(BaseModel):
    """Автор события не принимается от клиента — берётся из профиля."""

    status: OrderStatus
    # причина нужна только при отмене; для остальных переходов игнорируется
    reason: str = Field(default="", max_length=300)


class NoteCreate(BaseModel):
    text: str = Field(min_length=1, max_length=400)


class EventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    kind: str
    text: str
    author: str
    created_at: datetime


class OrderOut(OrderBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    number: str
    template_key: str
    status: OrderStatus
    extras: list[ExtraOut] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime
    summary: str = ""
    payment: str = "none"   # paid | partial | none | refunded | overpaid | unset | hidden
    debt: float = 0.0       # сколько ещё должен клиент
    surplus: float = 0.0    # переплата: внесли больше стоимости
    cancel_reason: str = ""
    events: list[EventOut] = Field(default_factory=list)


class EstimateRequest(BaseModel):
    template_key: str
    quantity: int = Field(default=1, ge=1)
    params: dict = Field(default_factory=dict)
    extras: list[ExtraIn] = Field(default_factory=list, max_length=MAX_EXTRAS)
    _check_params = field_validator("params")(check_params)


class EstimateLine(BaseModel):
    label: str
    amount: float


class EstimateResponse(BaseModel):
    price: float | None
    breakdown: list[EstimateLine] = Field(default_factory=list)
    note: str = ""
