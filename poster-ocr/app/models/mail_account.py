"""Почтовые ящики мастерской."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import utcnow


class MailAccount(Base):
    """Подключённый ящик: адрес, пароль приложения, серверы.

    Ящиков может быть несколько — общий для заказов, личный бухгалтера.
    Кому какой виден, решает администратор: у сотрудника в профиле список
    номеров ящиков (Employee.mail_accounts), не больше двух.

    Пароль лежит зашифрованным (app/core/crypto.py) и наружу не отдаётся —
    только «задан / не задан».
    """

    __tablename__ = "mail_accounts"

    id: Mapped[int] = mapped_column(primary_key=True)
    # как ящик называется в переключателе: «Заказы», «Бухгалтерия»
    title: Mapped[str] = mapped_column(String(60), default="")
    # yandex | mailru | custom — от него зависят серверы по умолчанию и подсказки
    provider: Mapped[str] = mapped_column(String(20), default="yandex")
    user: Mapped[str] = mapped_column(String(200), default="")
    password: Mapped[str] = mapped_column(Text, default="")
    imap: Mapped[str] = mapped_column(String(120), default="")
    smtp: Mapped[str] = mapped_column(String(120), default="")
    sender_name: Mapped[str] = mapped_column(String(120), default="")
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    position: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
