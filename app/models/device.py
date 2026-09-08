"""Компьютеры, с которых заходят в систему."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import utcnow


class Device(Base):
    """Компьютер (точнее — браузер на нём), с которого заходят в систему.

    Ключ генерируется браузером один раз и хранится у него же. Сервер только
    запоминает, что такой ключ существует, с какого IP приходил и когда.
    Администратор даёт устройствам понятные имена и привязывает к ним профили.

    Честно о границах: браузер не умеет читать MAC-адрес или серийник диска —
    таких API просто нет. Ключ живёт в хранилище браузера, поэтому очистка
    данных сайта или другой браузер на том же компьютере = новое устройство,
    его придётся привязать заново. Зато с чужого компьютера ключа нет вовсе.
    """

    __tablename__ = "devices"

    id: Mapped[int] = mapped_column(primary_key=True)
    key: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(80), default="")
    note: Mapped[str] = mapped_column(String(200), default="")

    first_ip: Mapped[str] = mapped_column(String(45), default="")
    last_ip: Mapped[str] = mapped_column(String(45), default="")
    user_agent: Mapped[str] = mapped_column(String(300), default="")

    first_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
