"""Заказ, его статусы, лента событий и движения денег."""

from __future__ import annotations

from datetime import date, datetime
from enum import Enum
from typing import TYPE_CHECKING

from sqlalchemy import JSON, Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import utcnow

if TYPE_CHECKING:
    from app.models.client import Client


class OrderStatus(str, Enum):
    """Колонки канбана. Порядок важен — в этом порядке они рисуются."""

    new = "new"                # Новый — принят, но не подтверждён
    confirmed = "confirmed"    # Подтверждён — согласован с клиентом
    in_work = "in_work"        # В работе — печатается/режется
    ready = "ready"            # Готов — ждёт выдачи
    done = "done"              # Выдан — закрыт
    cancelled = "cancelled"    # Отменён

STATUS_META = {
    OrderStatus.new: {"title": "Новый", "hint": "Приняли заявку", "color": "#8d94ff"},
    OrderStatus.confirmed: {"title": "Подтверждён", "hint": "Согласован с клиентом", "color": "#f0b429"},
    OrderStatus.in_work: {"title": "В работе", "hint": "Печать / резка", "color": "#3cc707"},
    OrderStatus.ready: {"title": "Готов", "hint": "Ждёт выдачи", "color": "#22d3ee"},
    OrderStatus.done: {"title": "Выдан", "hint": "Закрыт", "color": "#7a8274"},
    OrderStatus.cancelled: {"title": "Отменён", "hint": "Не выполняем", "color": "#e5484d"},
}

# Какие переходы разрешены. Пусто = переход в любой статус запрещён.
FORWARD: dict[OrderStatus, OrderStatus] = {
    OrderStatus.new: OrderStatus.confirmed,
    OrderStatus.confirmed: OrderStatus.in_work,
    OrderStatus.in_work: OrderStatus.ready,
    OrderStatus.ready: OrderStatus.done,
}

ALLOWED_TRANSITIONS: dict[OrderStatus, set[OrderStatus]] = {
    OrderStatus.new: {OrderStatus.confirmed, OrderStatus.cancelled},
    OrderStatus.confirmed: {OrderStatus.in_work, OrderStatus.new, OrderStatus.cancelled},
    OrderStatus.in_work: {OrderStatus.ready, OrderStatus.confirmed, OrderStatus.cancelled},
    OrderStatus.ready: {OrderStatus.done, OrderStatus.in_work, OrderStatus.cancelled},
    OrderStatus.done: {OrderStatus.ready},
    OrderStatus.cancelled: {OrderStatus.new},
}

class Order(Base):
    __tablename__ = "orders"

    id: Mapped[int] = mapped_column(primary_key=True)
    number: Mapped[str] = mapped_column(String(24), unique=True, index=True)

    template_key: Mapped[str] = mapped_column(String(40), index=True)
    status: Mapped[str] = mapped_column(String(20), default=OrderStatus.new.value, index=True)
    title: Mapped[str] = mapped_column(String(160), default="")

    # клиент: текстовые поля остаются в заказе (снимок на момент заказа),
    # client_id связывает его с карточкой в справочнике
    client_id: Mapped[int | None] = mapped_column(ForeignKey("clients.id", ondelete="SET NULL"), nullable=True, index=True)
    client_name: Mapped[str] = mapped_column(String(120), default="")
    client_phone: Mapped[str] = mapped_column(String(40), default="")
    client_contact: Mapped[str] = mapped_column(String(120), default="")  # почта / телеграм / компания

    # производство
    quantity: Mapped[int] = mapped_column(Integer, default=1)
    params: Mapped[dict] = mapped_column(JSON, default=dict)  # поля конкретного шаблона
    # доп. услуги к любому заказу: макет, замеры, монтаж — [{key, title, qty, rate}].
    # Название и ставка — снимок на момент сохранения: прайс потом меняется,
    # а в квитанции должно быть то, за что платили
    extras: Mapped[list] = mapped_column(JSON, default=list)

    # деньги
    price: Mapped[float] = mapped_column(Float, default=0.0)
    prepaid: Mapped[float] = mapped_column(Float, default=0.0)
    # из цены и предоплаты возврат не вычислить — нужен явный признак
    refunded: Mapped[bool] = mapped_column(Boolean, default=False)

    # прочее
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    manager: Mapped[str] = mapped_column(String(80), default="")
    notes: Mapped[str] = mapped_column(Text, default="")
    # почему заказ отменили. Заполняется при переводе в «Отменён» и
    # очищается, если заказ вернули в работу: иначе у повторно отменённого
    # заказа висела бы причина от прошлого раза
    cancel_reason: Mapped[str] = mapped_column(String(300), default="")

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    # проставляется в момент перехода в «Выдан» — по нему считается выручка за период
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)

    client: Mapped[Client | None] = relationship(back_populates="orders")

    events: Mapped[list[OrderEvent]] = relationship(
        back_populates="order",
        cascade="all, delete-orphan",
        order_by="OrderEvent.created_at.desc()",
    )
    payments: Mapped[list[Payment]] = relationship(
        back_populates="order",
        cascade="all, delete-orphan",
    )

class OrderEvent(Base):
    """Короткая запись в ленте заказа: создан, сменил статус, отредактирован."""

    __tablename__ = "order_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(20))  # created | status | edited | note
    text: Mapped[str] = mapped_column(String(400))
    author: Mapped[str] = mapped_column(String(80), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    order: Mapped[Order] = relationship(back_populates="events")

class Payment(Base):
    """Одно движение денег по заказу: внесли (плюс) или вернули (минус).

    Заказ хранит только итог «внесено». Эта таблица — журнал, из которого
    собирается касса за день: кто, когда, сколько и как — наличными или
    переводом. Строка появляется при каждом изменении внесённого
    (см. app/ledger.py), сама сумма в заказе остаётся источником истины.
    """

    __tablename__ = "payments"

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), index=True)
    amount: Mapped[float] = mapped_column(Float)          # плюс — пришли, минус — ушли
    method: Mapped[str] = mapped_column(String(20), default="cash")  # cash | transfer
    author: Mapped[str] = mapped_column(String(80), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)

    order: Mapped[Order] = relationship(back_populates="payments")
