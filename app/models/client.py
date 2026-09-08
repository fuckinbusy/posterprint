"""Справочник клиентов."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import utcnow

if TYPE_CHECKING:
    from app.models.order import Order


class Client(Base):
    """Карточка клиента. Заполняется автоматически при создании заказа,
    дальше её можно переиспользовать через поиск, не набирая всё заново."""

    __tablename__ = "clients"
    # телефон уникален: без этого два одновременных заказа одному клиенту
    # заводили две карточки. Пустой телефон не мешает — в SQLite и Postgres
    # NULL/'' в уникальном индексе допускают повторы только для NULL,
    # поэтому пустые храним как NULL
    __table_args__ = (UniqueConstraint("phone_norm", name="uq_client_phone"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120), default="", index=True)
    phone: Mapped[str] = mapped_column(String(40), default="")
    # только цифры — по нему ищем и сверяем, чтобы +7 918, 8918 и 8 (918) были одним клиентом
    phone_norm: Mapped[str | None] = mapped_column(String(20), nullable=True, index=True)
    contact: Mapped[str] = mapped_column(String(120), default="")
    notes: Mapped[str] = mapped_column(Text, default="")

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    orders: Mapped[list[Order]] = relationship(back_populates="client")
