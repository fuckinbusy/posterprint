"""Схемы запросов и ответов API."""

from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models import OrderStatus


# Длины повторяют колонки в models.py. SQLite длину не проверяет и молча
# примет мегабайт в поле телефона, Postgres — упадёт с 500; проверяем сами.
class OrderBase(BaseModel):
    title: str = Field(default="", max_length=160)
    client_id: int | None = None
    client_name: str = Field(default="", max_length=120)
    client_phone: str = Field(default="", max_length=40)
    client_contact: str = Field(default="", max_length=120)
    quantity: int = Field(default=1, ge=1)
    params: dict = Field(default_factory=dict)
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
    created_at: datetime
    updated_at: datetime
    summary: str = ""
    payment: str = "none"   # paid | partial | none | refunded | overpaid | unset | hidden
    debt: float = 0.0       # сколько ещё должен клиент
    surplus: float = 0.0    # переплата: внесли больше стоимости
    cancel_reason: str = ""
    events: list[EventOut] = Field(default_factory=list)


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


class EstimateRequest(BaseModel):
    template_key: str
    quantity: int = Field(default=1, ge=1)
    params: dict = Field(default_factory=dict)


class EstimateLine(BaseModel):
    label: str
    amount: float


class EstimateResponse(BaseModel):
    price: float | None
    breakdown: list[EstimateLine] = Field(default_factory=list)
    note: str = ""