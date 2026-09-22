"""Общее для тестов: путь к проекту и конструктор полей вида работ.

Тесты намеренно не трогают базу. Расчёт цены — чистая функция от словарей
(`estimate_from_fields`), поэтому его можно проверять без сервера, без
SQLite и без фикстур: секунда на весь прогон.
"""

from __future__ import annotations

import sys
from pathlib import Path

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
