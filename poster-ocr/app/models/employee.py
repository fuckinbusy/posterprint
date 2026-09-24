"""Профили сотрудников и их права."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import utcnow


class Employee(Base):
    """Профиль сотрудника: имя, пароль и набор прав.

    Пароль хранится хешем (PBKDF2), в открытом виде нигде не сохраняется —
    администратор может только задать новый, но не подсмотреть текущий.
    Права лежат списком ключей из app/permissions.py.

    API-ключ (для ботов и программ, app/services/api_keys.py) лежит дважды:
    отпечатком SHA-256 — по нему сервер находит сотрудника — и зашифрованной
    копией, чтобы администратор мог его посмотреть. Открытым текстом — нигде.
    """

    __tablename__ = "employees"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(200), default="")
    permissions: Mapped[list] = mapped_column(JSON, default=list)
    active: Mapped[bool] = mapped_column(Boolean, default=True)

    # "any" — вход с любого компьютера; "devices" — только с привязанных
    access_mode: Mapped[str] = mapped_column(String(20), default="any")
    allowed_devices: Mapped[list] = mapped_column(JSON, default=list)  # id устройств
    # номера почтовых ящиков (MailAccount), с которыми сотрудник работает; не больше двух
    mail_accounts: Mapped[list] = mapped_column(JSON, default=list)
    note: Mapped[str] = mapped_column(String(200), default="")

    # NULL, а не пустая строка: уникальный индекс пропускает сколько угодно
    # NULL, а две пустые строки счёл бы одинаковыми ключами
    api_key_hash: Mapped[str | None] = mapped_column(String(64), unique=True, index=True, nullable=True)
    api_key_enc: Mapped[str] = mapped_column(String(300), default="")

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
