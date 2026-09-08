"""Настройки из интерфейса — app/settings.py.

Правило одно: значение из базы главнее .env, а ключа в базе нет — берётся
.env. Пустое значение, сохранённое в базе, — тоже значение: владелец очистил
поле, и .env его подставлять не должен.
"""

from __future__ import annotations

import conftest  # noqa: F401 — добавляет корень проекта в sys.path
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.services import payments, settings, shop


@pytest.fixture
def db():
    engine = create_engine("sqlite://", future=True)
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine, expire_on_commit=False)()
    try:
        yield session
    finally:
        session.close()


def test_база_главнее_env(monkeypatch, db):
    monkeypatch.setenv("POSTER_SHOP_NAME", "Из файла")
    assert shop.details(settings.overrides(db))["name"] == "Из файла"

    settings.save(db, {"shop_name": "Из базы"})
    assert shop.details(settings.overrides(db))["name"] == "Из базы"


def test_пустое_в_базе_тоже_значение(monkeypatch, db):
    """Владелец стёр телефон на странице — .env не должен вернуть его обратно."""
    monkeypatch.setenv("POSTER_SHOP_PHONE", "+7 900 000-00-00")
    settings.save(db, {"shop_phone": ""})
    assert shop.details(settings.overrides(db))["phone"] == ""


def test_платёжные_реквизиты_читаются_из_базы(monkeypatch, db):
    monkeypatch.delenv("POSTER_PAY_LINK", raising=False)
    monkeypatch.delenv("POSTER_PAY_MODE", raising=False)
    settings.save(db, {"pay_link": "https://qr.nspk.ru/AS1", "pay_phone": "+7 988 160-32-18"})
    config = payments.settings(settings.overrides(db))
    assert config["mode"] == "link"
    assert config["link"] == "https://qr.nspk.ru/AS1"
    assert payments.problems(config) == []


def test_неизвестные_ключи_не_пишутся(db):
    settings.save(db, {"shop_name": "X", "хакер": "Y"})
    assert set(settings.overrides(db)) == {"shop_name"}


def test_логотип_ограничен_по_размеру(db):
    with pytest.raises(ValueError):
        settings.save(db, {"shop_logo": "data:image/png;base64," + "A" * (settings.MAX_LOGO_BYTES + 10)})
