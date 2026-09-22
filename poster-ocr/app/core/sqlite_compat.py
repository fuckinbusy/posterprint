"""SQLite там, где у Python нет модуля sqlite3.

На обычном Linux и Windows sqlite3 входит в стандартную библиотеку. Но на
сетевых хранилищах (TerraMaster, часть Synology) Python собран без него:
``import sqlite3`` падает с ModuleNotFoundError, а вместе с ним SQLAlchemy и
вся система. Лечится пакетом ``pysqlite3-binary`` — это тот же sqlite3 с
вшитой библиотекой SQLite. Здесь он подставляется под привычным именем, и
остальной код (SQLAlchemy, резервные копии) ничего не замечает.

Модуль импортируется самым первым — из ``app/__init__.py``.
"""

from __future__ import annotations

import importlib
import sys

HINT = (
    "У этого Python нет модуля sqlite3 (так бывает на NAS). Поставьте замену: "
    ".venv/bin/python -m pip install pysqlite3-binary — и запустите снова. "
    "deploy/install.sh делает это сам."
)


def ensure() -> str:
    """Возвращает, какой sqlite используется: «stdlib» или «pysqlite3»."""
    try:
        importlib.import_module("sqlite3")
        return "stdlib"
    except ModuleNotFoundError:
        pass
    try:
        replacement = importlib.import_module("pysqlite3")
    except ModuleNotFoundError:
        raise ModuleNotFoundError(HINT) from None
    sys.modules["sqlite3"] = replacement
    sys.modules["sqlite3.dbapi2"] = importlib.import_module("pysqlite3.dbapi2")
    return "pysqlite3"


BACKEND = ensure()
