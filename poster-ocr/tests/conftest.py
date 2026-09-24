"""Общее для тестов: путь к проекту, конструктор полей вида работ и
фикстуры для тестов API.

Настоящую базу тесты не трогают. Расчёт цены — чистая функция от словарей
(`estimate_from_fields`), его проверяют без сервера и без SQLite. Тестам
API нужна база — им фикстура `db` даёт SQLite в памяти, а `client` — запросы
прямо в приложение по ASGI (tests/api_helpers.py). Файл с собственной
фикстурой `db` получает свою, эта его не трогает.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def field(
    key: str,
    role: str = "none",
    *,
    type: str = "select",
    source: str = "price",
    group: str = "",
    item: str = "",
    default=None,
    unit: str = "мм",
    source_field: str = "",
    label: str = "",
) -> dict:
    """Поле вида работ в том виде, в каком его отдаёт app/services/catalog.py.

    Собираем руками, а не через базу: так в тесте видно ровно то, что влияет
    на результат, и не надо заводить шаблон ради одной проверки.
    """
    return {
        "key": key,
        "label": label or key,
        "type": type,
        "options": [],
        "default": default,
        "source": source,
        "price_group": group,
        "price_item": item,
        "pricing_role": role,
        "unit": unit,
        "source_field": source_field,
        "required": False,
    }


# ---------------------------------------------------------------- тесты API
@pytest.fixture
def db():
    """SQLite в памяти со всеми таблицами. StaticPool: одна база на все
    потоки, в которых FastAPI зовёт зависимости."""
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.pool import StaticPool

    from app.core.database import Base

    engine = create_engine(
        "sqlite://", future=True, connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine, expire_on_commit=False)()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def client(db):
    """Запросы прямо в приложение поверх базы из `db`."""
    from api_helpers import AsgiClient

    from app.core import security
    from app.core.database import get_db
    from app.main import app

    app.dependency_overrides[get_db] = lambda: db
    security._failures.clear()  # счётчик неудач живёт в памяти процесса
    try:
        yield AsgiClient()
    finally:
        app.dependency_overrides.clear()
        security._failures.clear()
