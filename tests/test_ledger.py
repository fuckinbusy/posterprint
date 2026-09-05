"""Касса: движения денег между состояниями заказа и итоги за день.

Заказ хранит только итог «внесено», а журнал строится из разницы между
тем, что было, и тем, что стало. Здесь проверяется сама арифметика.
"""

from __future__ import annotations

from dataclasses import dataclass

import conftest  # noqa: F401 — добавляет корень проекта в sys.path

from app.ledger import movement, summarize


def test_первый_взнос_целиком_в_плюс():
    assert movement((0, False), (2000, False)) == 2000


def test_доплата_только_разница():
    assert movement((2000, False), (5000, False)) == 3000


def test_уменьшили_внесённое_руками_это_минус():
    """Ошиблись в сумме и поправили — деньги, выходит, отдали."""
    assert movement((2000, False), (500, False)) == -1500


def test_возврат_это_минус_всего_внесённого():
    assert movement((2000, False), (2000, True)) == -2000


def test_сняли_галочку_возврата_деньги_снова_у_нас():
    assert movement((2000, True), (2000, False)) == 2000


def test_правка_суммы_после_возврата_движения_не_даёт():
    """Денег на руках как не было, так и нет."""
    assert movement((2000, True), (3000, True)) == 0


def test_копейки_не_расползаются():
    assert movement((0.1, False), (0.3, False)) == 0.2


@dataclass
class Row:
    amount: float
    method: str
    author: str


def test_итоги_по_способу_и_по_сотруднику():
    rows = [
        Row(3000, "cash", "Аня"),
        Row(1500, "transfer", "Аня"),
        Row(-500, "cash", "Аня"),
        Row(2000, "cash", "Олег"),
    ]
    out = summarize(rows)
    assert out["by_method"]["cash"] == {"in": 5000, "out": 500, "net": 4500}
    assert out["by_method"]["transfer"] == {"in": 1500, "out": 0, "net": 1500}
    assert out["total_in"] == 6500
    assert out["total_out"] == 500
    assert out["total"] == 6000
    # сотрудники — по убыванию суммы
    assert [a["author"] for a in out["by_author"]] == ["Аня", "Олег"]
    assert out["by_author"][0] == {"author": "Аня", "cash": 2500, "transfer": 1500, "total": 4000}


def test_неизвестный_способ_считается_наличными():
    """Старые строки или сбой — деньги не должны пропасть из итогов."""
    out = summarize([Row(100, "", "")])
    assert out["by_method"]["cash"]["in"] == 100
    assert out["by_author"][0]["author"] == "—"


def test_пустой_день():
    out = summarize([])
    assert out["total"] == 0
    assert out["by_author"] == []
