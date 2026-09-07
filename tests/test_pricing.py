"""Расчёт цены — app/pricing.py.

Формула одна на все виды работ, разницу задают роли полей. Ошибка здесь не
падает, а тихо отдаёт неверную сумму: заказ считается дешевле или дороже, и
заметить это можно только сверив с прайсом руками. Поэтому проверяем каждую
роль и каждое сочетание, на котором система уже спотыкалась.
"""

from __future__ import annotations

from conftest import field

from app.pricing import contributes, estimate_from_fields, needed_dimensions

# прайс для всех тестов: раздел -> позиция -> ставка
RATES = {
    "material": {"Баннер 440г": 800.0, "Сетка": 500.0},
    "handling": {"Проклейка": 100.0, "Люверсы": 30.0, "Обрезка": 30.0},
    "work": {"min_order": 0.0, "urgent": 1000.0},
    "cards": {"100": 12.0, "500": 6.0, "1000": 4.0},
    "koeff": {"Двусторонняя": 1.8},
}


def price(fields, params, quantity=1, rates=None):
    """Короткая обёртка: вернуть только сумму."""
    return estimate_from_fields(rates or RATES, fields, quantity, params)["price"]


# ------------------------------------------------------------------ площадь
def test_площадь_умножается_на_ставку():
    fields = [
        field("material", "per_sqm", group="material"),
        field("w", "width", type="number", source="list", unit="м"),
        field("h", "height", type="number", source="list", unit="м"),
    ]
    # 2 × 3 м = 6 м² × 800 ₽
    assert price(fields, {"material": "Баннер 440г", "w": 2, "h": 3}) == 4800


def test_площадь_умножается_на_тираж():
    fields = [
        field("material", "per_sqm", group="material"),
        field("w", "width", type="number", source="list", unit="м"),
        field("h", "height", type="number", source="list", unit="м"),
    ]
    assert price(fields, {"material": "Баннер 440г", "w": 2, "h": 3}, quantity=3) == 14400


def test_единицы_измерения_приводятся_к_метрам():
    """Одна и та же площадь, введённая в мм, см и м, стоит одинаково."""
    def build(unit, value_w, value_h):
        fields = [
            field("material", "per_sqm", group="material"),
            field("w", "width", type="number", source="list", unit=unit),
            field("h", "height", type="number", source="list", unit=unit),
        ]
        return price(fields, {"material": "Баннер 440г", "w": value_w, "h": value_h})

    assert build("м", 2, 3) == build("см", 200, 300) == build("мм", 2000, 3000) == 4800


# ------------------------------------------------------------------ периметр и длина
def test_периметр_считается_по_обеим_сторонам():
    fields = [
        field("w", "width", type="number", source="list", unit="м"),
        field("h", "height", type="number", source="list", unit="м"),
        field("glue", "per_m", type="bool", group="handling", item="Проклейка"),
    ]
    # периметр 2×(2+3) = 10 пог. м × 100 ₽
    assert price(fields, {"w": 2, "h": 3, "glue": True}) == 1000


def test_длина_берётся_из_своего_поля():
    """У поля-длины может быть указано, на какое измерение оно смотрит."""
    fields = [
        field("len_cut", "length", type="number", source="list", unit="м"),
        field("len_edge", "length", type="number", source="list", unit="м"),
        field("cut", "per_length", type="bool", group="handling", item="Обрезка",
              source_field="len_edge"),
    ]
    # берётся len_edge (5 м), а не первое поле длины (99 м)
    assert price(fields, {"len_cut": 99, "len_edge": 5, "cut": True}) == 150


# ------------------------------------------------------------------ количество
def test_платное_количество_умножается_на_тираж():
    """8 люверсов на каждом из 3 баннеров по 30 ₽."""
    fields = [
        field("grommets", "per_unit", type="number", source="price",
              group="handling", item="Люверсы"),
    ]
    assert price(fields, {"grommets": 8}, quantity=3) == 720


def test_разово_за_заказ_не_зависит_от_тиража():
    fields = [field("urgent", "per_order", type="bool", group="work", item="urgent")]
    assert price(fields, {"urgent": True}, quantity=10) == 1000


def test_разово_за_заказ_умножается_на_введённое_количество():
    """Люверсы на весь заказ, а не на каждое изделие: цена × количество."""
    fields = [
        field("grommets", "per_order", type="number", source="price",
              group="handling", item="Люверсы"),
    ]
    assert price(fields, {"grommets": 8}, quantity=3) == 240


def test_ступени_тиража():
    """Ставку выбирает тираж, а не то, что сотрудник ткнул в списке."""
    fields = [field("tier", "step_per_unit", group="cards")]
    chosen = {"tier": "100"}
    assert price(fields, chosen, quantity=100) == 1200    # от 100 по 12 ₽
    assert price(fields, chosen, quantity=499) == 5988    # ступень ещё та же
    assert price(fields, chosen, quantity=500) == 3000    # от 500 по 6 ₽
    assert price(fields, chosen, quantity=2000) == 8000   # от 1000 по 4 ₽


def test_ступени_ниже_первой_считаются_по_первой():
    fields = [field("tier", "step_per_unit", group="cards")]
    assert price(fields, {"tier": "100"}, quantity=50) == 600


# ------------------------------------------------------------------ коэффициент
def test_коэффициент_умножает_только_то_что_выше():
    """Порядок полей значим — на этом держится вся настройка видов работ."""
    fields = [
        field("material", "per_sqm", group="material"),
        field("sides", "multiplier", group="koeff"),
        field("grommets", "per_unit", type="number", source="price",
              group="handling", item="Люверсы"),
        field("w", "width", type="number", source="list", unit="м"),
        field("h", "height", type="number", source="list", unit="м"),
    ]
    params = {"material": "Баннер 440г", "sides": "Двусторонняя", "grommets": 4, "w": 2, "h": 3}
    # 4800 × 1.8 = 8640, люверсы стоят ниже коэффициента: + 4 × 30
    assert price(fields, params) == 8760


def test_коэффициент_первым_полем_ничего_не_ломает():
    fields = [
        field("sides", "multiplier", group="koeff"),
        field("material", "per_sqm", group="material"),
        field("w", "width", type="number", source="list", unit="м"),
        field("h", "height", type="number", source="list", unit="м"),
    ]
    params = {"sides": "Двусторонняя", "material": "Баннер 440г", "w": 2, "h": 3}
    # умножать нечего — коэффициент просто не срабатывает
    assert price(fields, params) == 4800


# ------------------------------------------------------------------ минимальный заказ
def test_минимальный_заказ_поднимает_сумму():
    rates = {**RATES, "work": {**RATES["work"], "min_order": 500.0}}
    fields = [
        field("grommets", "per_unit", type="number", source="price",
              group="handling", item="Люверсы"),
    ]
    result = estimate_from_fields(rates, fields, 1, {"grommets": 2})
    assert result["price"] == 500                        # вместо 60
    assert "минимальный заказ" in result["note"].lower()


# ------------------------------------------------------------------ то, что уже ломалось
def test_снятая_галочка_не_требует_своей_длины():
    """Регрессия: печать без обрезки вообще не считалась.

    Проверка размеров смотрела на роли, объявленные в виде работ, а не на то,
    что выбрано в заказе, — и снятая «Обрезка» продолжала требовать длину.
    """
    fields = [
        field("material", "per_sqm", group="material"),
        field("w", "width", type="number", source="list", unit="м"),
        field("h", "height", type="number", source="list", unit="м"),
        field("cut", "per_length", type="bool", group="handling", item="Обрезка"),
        field("cut_len", "length", type="number", source="list", unit="м"),
    ]
    params = {"material": "Баннер 440г", "w": 2, "h": 3, "cut": False, "cut_len": 0}
    assert price(fields, params) == 4800


def test_включённая_галочка_с_пустой_длиной_останавливает_расчёт():
    """Обратная сторона того же правила: молча считать дешевле нельзя."""
    fields = [
        field("material", "per_sqm", group="material"),
        field("w", "width", type="number", source="list", unit="м"),
        field("h", "height", type="number", source="list", unit="м"),
        field("cut", "per_length", type="bool", group="handling", item="Обрезка"),
        field("cut_len", "length", type="number", source="list", unit="м",
              label="Длина резки"),
    ]
    params = {"material": "Баннер 440г", "w": 2, "h": 3, "cut": True, "cut_len": 0}
    result = estimate_from_fields(RATES, fields, 1, params)
    assert result["price"] is None
    assert "Длина резки" in result["note"]


def test_удалённая_позиция_прайса_не_пропадает_молча():
    """Регрессия: «Печать самоклейки» считалась на 1000 ₽ дешевле.

    Позицию удалили из прайса, строка выпала из сметы, и заметить это было
    нечем. Теперь сумма меньше, но расчёт об этом говорит.
    """
    rates = {**RATES, "work": {}}
    fields = [
        field("material", "per_sqm", group="material"),
        field("w", "width", type="number", source="list", unit="м"),
        field("h", "height", type="number", source="list", unit="м"),
        field("urgent", "per_order", type="bool", group="work", item="urgent",
              label="Срочность"),
    ]
    params = {"material": "Баннер 440г", "w": 2, "h": 3, "urgent": True}
    result = estimate_from_fields(rates, fields, 1, params)
    assert result["price"] == 4800
    assert "Нет цены в прайсе" in result["note"]
    assert "Срочность" in result["note"]


def test_ноль_в_платном_количестве_означает_не_нужно():
    fields = [
        field("material", "per_sqm", group="material"),
        field("w", "width", type="number", source="list", unit="м"),
        field("h", "height", type="number", source="list", unit="м"),
        field("grommets", "per_unit", type="number", source="price",
              group="handling", item="Люверсы"),
    ]
    params = {"material": "Баннер 440г", "w": 2, "h": 3, "grommets": 0}
    assert price(fields, params) == 4800


def test_пустой_расчёт_объясняет_причину_по_разному():
    """«Цены не настроены» и «ничего не выбрано» — разные беды."""
    fields = [field("lamination", "per_unit", group="handling")]

    nothing_chosen = estimate_from_fields(RATES, fields, 1, {"lamination": ""})
    assert nothing_chosen["price"] is None
    assert "Выберите хотя бы один параметр" in nothing_chosen["note"]

    no_prices = estimate_from_fields({}, fields, 1, {"lamination": "Проклейка"})
    assert no_prices["price"] is None
    assert "цены пока не настроены" in no_prices["note"]


def test_расшифровка_совпадает_с_итогом():
    """Сумма строк сметы должна давать ровно итог — иначе спорят с клиентом."""
    fields = [
        field("material", "per_sqm", group="material"),
        field("w", "width", type="number", source="list", unit="м"),
        field("h", "height", type="number", source="list", unit="м"),
        field("grommets", "per_unit", type="number", source="price",
              group="handling", item="Люверсы"),
        field("glue", "per_m", type="bool", group="handling", item="Проклейка"),
    ]
    params = {"material": "Сетка", "w": 1.37, "h": 2.5, "grommets": 6, "glue": True}
    result = estimate_from_fields(RATES, fields, 3, params)
    assert round(sum(line["amount"] for line in result["breakdown"]), 2) == result["price"]


# ------------------------------------------------------------------ contributes / needed_dimensions
def test_contributes_смотрит_на_значения_а_не_на_роли():
    checkbox = field("cut", "per_length", type="bool", group="handling", item="Обрезка")
    assert contributes(checkbox, {"cut": True}) is True
    assert contributes(checkbox, {"cut": False}) is False

    counter = field("grommets", "per_unit", type="number", source="price",
                    group="handling", item="Люверсы")
    assert contributes(counter, {"grommets": 5}) is True
    assert contributes(counter, {"grommets": 0}) is False

    choice = field("material", "per_sqm", group="material")
    assert contributes(choice, {"material": "Сетка"}) is True
    assert contributes(choice, {"material": ""}) is False
    assert contributes(choice, {"material": "Нет"}) is False

    # сами измерения в цену не входят — они материал для неё
    assert contributes(field("w", "width", type="number"), {"w": 5}) is False


def test_needed_dimensions_зависит_от_выбора():
    fields = [
        field("material", "per_sqm", group="material"),
        field("w", "width", type="number", source="list", unit="м"),
        field("h", "height", type="number", source="list", unit="м"),
        field("cut", "per_length", type="bool", group="handling", item="Обрезка"),
        field("cut_len", "length", type="number", source="list", unit="м"),
    ]
    without_cut = {"material": "Баннер 440г", "cut": False}
    with_cut = {"material": "Баннер 440г", "cut": True}

    assert needed_dimensions(fields, without_cut) == {"w", "h"}
    assert needed_dimensions(fields, with_cut) == {"w", "h", "cut_len"}
    assert needed_dimensions(fields, {"material": "", "cut": False}) == set()


def test_ступени_с_вариантами_таблиц():
    """Настоящий прайс: у каждой бумаги и цветности своя таблица тиража.
    Список «Бумага» называет таблицу, «Цветность» уточняет колонку."""
    table = {
        "cards": {
            "Лён:4+0:100": 9.5, "Лён:4+0:500": 8,
            "Лён:4+4:100": 10.5, "Лён:4+4:500": 9,
            "300 г:4+0:100": 6.5, "300 г:4+0:500": 5,
        },
    }
    fields = [
        field("paper", "step_per_unit", type="select", source="list", group="cards"),
        field("color", "step_key", type="select", source="list"),
    ]
    est = estimate_from_fields(table, fields, 500, {"paper": "Лён", "color": "4+4"})
    assert est["price"] == 4500          # 500 × 9
    est = estimate_from_fields(table, fields, 120, {"paper": "300 г", "color": "4+0"})
    assert est["price"] == 780           # ступень «от 100» по 6,5
    est = estimate_from_fields(table, fields, 100, {"paper": "Лён", "color": "1+1"})
    assert est["price"] is None or est["price"] == 0 or "Нет цены" in (est.get("note") or "")


def test_голые_ступени_не_путаются_с_таблицами():
    """Раздел, где есть и «100», и «Лён:100»: без варианта берутся голые числа."""
    table = {"cards": {"100": 12, "500": 6, "Лён:100": 20}}
    fields = [field("tier", "step_per_unit", group="cards")]
    assert estimate_from_fields(table, fields, 100, {"tier": "100"})["price"] == 1200

