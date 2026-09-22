"""Токен сотрудника привязан ко времени появления профиля.

SQLite отдаёт номер удалённой строки следующей новой: без этой проверки
токен уволенного сотрудника (живёт 14 дней) подошёл бы тому, кого завели
после него под тем же номером.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import conftest  # noqa: F401 — добавляет корень проекта в sys.path

from app.core import security


def test_токен_выданный_после_создания_профиля_подходит():
    token, _ = security.make_token("emp:7")
    created = datetime.now(timezone.utc) - timedelta(days=30)
    assert security.token_fits_profile(token, created)


def test_токен_старше_профиля_не_подходит():
    token, _ = security.make_token("emp:7")
    created = datetime.now(timezone.utc) + timedelta(minutes=10)  # профиль завели позже
    assert not security.token_fits_profile(token, created)


def test_время_без_пояса_считается_utc():
    token, _ = security.make_token("emp:7")
    naive = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=1)
    assert security.token_fits_profile(token, naive)


def test_мусор_вместо_токена_не_подходит():
    created = datetime.now(timezone.utc)
    assert not security.token_fits_profile("abc", created)
    assert not security.token_fits_profile(None, created)


def test_профиль_без_даты_не_ломает_вход():
    token, _ = security.make_token("emp:7")
    assert security.token_fits_profile(token, None)
