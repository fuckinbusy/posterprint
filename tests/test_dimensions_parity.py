"""Сверка двух копий одного правила.

`contributes()` и `needed_dimensions()` живут в двух местах: в app/services/pricing.py
и в web/src/features/orders/dimensions.ts. Копия на фронте нужна потому, что
форма пересчитывает правило на каждое нажатие галочки и ходить за ответом на
сервер по десять раз в секунду нельзя.

Расхождение между копиями — тупик для сотрудника: форма гасит поле как
ненужное, а сервер отказывается считать без него, и заказ не оформить вовсе.
Поэтому сверяем машинно и на всех сочетаниях выбора, а не глазами.

Тест пропускается, если рядом нет Node.js: на компьютере, где систему только
запускают, его может не быть — фронтенд там уже собран.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
from itertools import product
from pathlib import Path

import pytest
from conftest import ROOT, field

from app.services.pricing import contributes, needed_dimensions

HARNESS = Path(__file__).parent / "js" / "needed_dimensions.mjs"

# Вид работ со всеми ловушками сразу: площадь, периметр, две разные длины
# (одна из них выбрана явно через source_field), счётчик и бесплатное поле.
FIELDS = [
    field("material", "per_sqm", group="material"),
    field("w", "width", type="number", source="list", unit="м"),
    field("h", "height", type="number", source="list", unit="м"),
    field("glue", "per_m", type="bool", group="handling", item="Проклейка"),
    field("cut", "per_length", type="bool", group="handling", item="Обрезка",
          source_field="cut_len"),
    field("edge", "per_length", type="bool", group="handling", item="Кант"),
    field("cut_len", "length", type="number", source="list", unit="м"),
    field("edge_len", "length", type="number", source="list", unit="м"),
    field("grommets", "per_unit", type="number", source="price",
          group="handling", item="Люверсы"),
    field("note", "none", type="text", source="list"),
]

# Все сочетания выбора: 2×2×2×3×2 = 48 случаев.
VALUES = {
    "material": ["Баннер 440г", ""],
    "glue": [True, False],
    "cut": [True, False],
    "edge": [True, False],
    "grommets": [0, 8],
}


def build_cases() -> list[dict]:
    keys = list(VALUES)
    cases = []
    for combo in product(*(VALUES[k] for k in keys)):
        params = dict(zip(keys, combo, strict=True))
        # размеры всегда заполнены: правило смотрит не на них, а на то,
        # что выбрано из платного
        params.update({"w": 2, "h": 3, "cut_len": 5, "edge_len": 7, "note": "текст"})
        cases.append(params)
    return cases


def python_answer(cases: list[dict]) -> list[dict]:
    return [
        {
            "needed": sorted(needed_dimensions(FIELDS, params)),
            "contributes": [contributes(f, params) for f in FIELDS],
        }
        for params in cases
    ]


def node_answer(cases: list[dict]) -> list[dict]:
    node = shutil.which("node") or r"C:\Program Files\nodejs\node.exe"
    if not Path(node).exists():
        pytest.skip("Node.js не найден — сверку с фронтендом пропускаем")

    with tempfile.TemporaryDirectory() as tmp:
        payload = Path(tmp) / "cases.json"
        payload.write_text(
            json.dumps({"fields": FIELDS, "cases": cases}, ensure_ascii=False),
            encoding="utf-8",
        )
        result = subprocess.run(
            [node, str(HARNESS), str(payload)],
            capture_output=True,
            text=True,
            encoding="utf-8",
            cwd=ROOT,
        )
    if result.returncode != 0:
        pytest.fail(f"Node не смог прочитать dimensions.ts:\n{result.stderr}")
    return json.loads(result.stdout)


def test_правило_совпадает_на_всех_сочетаниях():
    cases = build_cases()
    mine = python_answer(cases)
    theirs = node_answer(cases)

    assert len(mine) == len(theirs) == len(cases)
    for params, left, right in zip(cases, mine, theirs, strict=True):
        chosen = {k: params[k] for k in VALUES}
        assert left["needed"] == right["needed"], (
            f"расходится список нужных размеров при выборе {chosen}: "
            f"сервер {left['needed']}, форма {right['needed']}"
        )
        assert left["contributes"] == right["contributes"], (
            f"расходится участие полей в цене при выборе {chosen}"
        )


def test_случаи_вообще_различаются():
    """Страховка от самообмана: если бы обе стороны всегда возвращали пусто,
    тест выше проходил бы, ничего не проверяя."""
    answers = {tuple(row["needed"]) for row in python_answer(build_cases())}
    assert len(answers) > 1
    assert any(answer for answer in answers), "ни в одном случае размеры не понадобились"
