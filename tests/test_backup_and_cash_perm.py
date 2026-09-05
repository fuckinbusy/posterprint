"""Право на кассу и резервные копии — то, что проверяется без базы.

Касса получила своё право finance.cash: суммы в работе видят несколько
человек, а ящик вечером сверяет один. Копии переехали из скрипта в
app/backup.py, чтобы их делала и кнопка в «Журнале».
"""

from __future__ import annotations

import conftest  # noqa: F401 — добавляет корень проекта в sys.path

from app import backup
from app.permissions import ALL_KEYS, PERMISSIONS_BY_KEY, default_permissions, normalize


def test_право_на_кассу_есть_и_не_выдаётся_по_умолчанию():
    assert "finance.cash" in PERMISSIONS_BY_KEY
    assert "finance.cash" not in default_permissions()
    assert "finance.cash" in ALL_KEYS  # администратор получает вместе со всеми


def test_касса_тянет_за_собой_право_видеть_цены():
    """Без цен строки кассы бессмысленны — право подразумевается."""
    assert "orders.price.view" in normalize(["finance.cash"])


def test_касса_не_даёт_сумм_в_работе_и_наоборот():
    """Два права независимы: кассир может не видеть счётчик в шапке."""
    assert "finance.totals" not in normalize(["finance.cash"])
    assert "finance.cash" not in normalize(["finance.totals"])


def test_имя_папки_копии_читается_обратно():
    stamp = backup.parse_stamp("2026-09-06_03-15-00")
    assert stamp is not None
    assert (stamp.year, stamp.hour, stamp.minute) == (2026, 3, 15)


def test_чужие_папки_в_backups_не_считаются_копиями():
    assert backup.parse_stamp("designs") is None
    assert backup.parse_stamp("2026-09-06") is None


def test_формат_выгрузки_совпадает_с_restore():
    """restore.py читает именно эти поля — их менять только вместе."""
    assert backup.ORDER_FIELDS[:3] == ["id", "number", "template_key"]
    assert "order_id" in backup.EVENT_FIELDS
    assert "order_id" in backup.PAYMENT_FIELDS
    assert set(backup.EXPORTERS) == set(backup.SECTIONS)
