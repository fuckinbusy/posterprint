"""Python без sqlite3 (сетевые хранилища): замена подставляется под привычным именем."""

from __future__ import annotations

import importlib
import sys
import types

import conftest  # noqa: F401 — добавляет корень проекта в sys.path
import pytest

from app.core import sqlite_compat


def _no_stdlib(monkeypatch, replacement_available: bool):
    """Изображаем Python, у которого sqlite3 нет, а pysqlite3 есть или тоже нет."""
    fake = types.ModuleType("pysqlite3")
    fake_dbapi = types.ModuleType("pysqlite3.dbapi2")
    real = importlib.import_module

    def fake_import(name, *args, **kwargs):
        if name == "sqlite3":
            raise ModuleNotFoundError("No module named 'sqlite3'")
        if name == "pysqlite3":
            if not replacement_available:
                raise ModuleNotFoundError("No module named 'pysqlite3'")
            return fake
        if name == "pysqlite3.dbapi2":
            return fake_dbapi
        return real(name, *args, **kwargs)

    monkeypatch.setattr(sqlite_compat.importlib, "import_module", fake_import)
    # подмену sys.modules после теста вернёт monkeypatch
    monkeypatch.setitem(sys.modules, "sqlite3", sys.modules.get("sqlite3"))
    monkeypatch.setitem(sys.modules, "sqlite3.dbapi2", sys.modules.get("sqlite3.dbapi2"))
    return fake, fake_dbapi


def test_обычный_python_берёт_стандартный_модуль():
    assert sqlite_compat.ensure() == "stdlib"


def test_без_sqlite3_подставляется_pysqlite3(monkeypatch):
    fake, fake_dbapi = _no_stdlib(monkeypatch, replacement_available=True)
    assert sqlite_compat.ensure() == "pysqlite3"
    assert sys.modules["sqlite3"] is fake
    assert sys.modules["sqlite3.dbapi2"] is fake_dbapi


def test_без_замены_понятная_подсказка(monkeypatch):
    _no_stdlib(monkeypatch, replacement_available=False)
    with pytest.raises(ModuleNotFoundError, match="pysqlite3-binary"):
        sqlite_compat.ensure()
