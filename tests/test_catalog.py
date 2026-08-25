"""Стартовый каталог — app/seed_catalog.py.

Проверяем не цены (их правят руками), а связность: ссылается ли поле вида
работ на существующий раздел прайса и на существующую позицию, есть ли
измерения, без которых роль не посчитается.

Зачем машинно. Опечатка в `price_item` не падает и ничего не подсвечивает —
строка просто исчезает из сметы, и заказ считается дешевле. На этом уже
обжигались: удалённая «Срочность» месяц уходила в минус незаметно.

База не нужна: каталог — обычные списки, читаем их как есть.
"""

from __future__ import annotations

import conftest  # noqa: F401 — добавляет корень проекта в sys.path
import pytest

from app.seed_catalog import PRICE_GROUPS, TEMPLATES

GROUPS = {group[0]: group for group in PRICE_GROUPS}
ITEMS = {
    (group[0], item[0]): item
    for group in PRICE_GROUPS
    for item in group[6]
}

# роль → какие измерения обязаны быть в шаблоне
NEEDS_SIZE = {
    "per_sqm": ("width", "height"),
    "per_m": ("width", "height"),
    "per_length": ("length",),
}

# роль → единицы, в которых осмысленна цена
ROLE_UNITS = {
    "per_unit": {"₽/шт", "₽/лист", "₽"},
    "step_per_unit": {"₽/шт", "₽"},
    "per_sqm": {"₽/м²"},
    "per_m": {"₽/пог.м", "₽/м"},
    "per_length": {"₽/пог.м", "₽/м"},
    "per_order": {"₽"},
    "multiplier": {"×"},
}

MONEY_ROLES = set(ROLE_UNITS)


def fields_of(template: dict) -> list[tuple]:
    return template["fields"]


def roles_of(template: dict) -> set[str]:
    return {field[5] for field in fields_of(template)}


ALL_FIELDS = [
    (template, field)
    for template in TEMPLATES
    for field in fields_of(template)
]

CASES = [
    pytest.param(t, f, id=f"{t['key']}.{f[0]}")
    for t, f in ALL_FIELDS
]


# ------------------------------------------------------------------ прайс
def test_ключи_разделов_и_позиций_уникальны():
    keys = [group[0] for group in PRICE_GROUPS]
    assert len(keys) == len(set(keys)), "повторяются ключи разделов"

    for group in PRICE_GROUPS:
        item_keys = [item[0] for item in group[6]]
        assert len(item_keys) == len(set(item_keys)), f"повторы позиций в «{group[0]}»"


def test_подраздел_ссылается_на_существующего_родителя():
    for key, _title, _hint, _unit, _icon, parent, _items in PRICE_GROUPS:
        if not parent:
            continue
        assert parent in GROUPS, f"«{key}» вложен в несуществующий «{parent}»"
        # уровня ровно два: у родителя своего родителя быть не может
        assert not GROUPS[parent][5], f"«{key}» даёт третий уровень вложенности"


def test_цены_положительные():
    for group in PRICE_GROUPS:
        for item_key, _title, value, _unit in group[6]:
            assert value > 0, f"«{group[0]}/{item_key}» с ценой {value}"


# ------------------------------------------------------------------ виды работ
def test_ключи_видов_работ_уникальны():
    keys = [t["key"] for t in TEMPLATES]
    assert len(keys) == len(set(keys))


def test_ключи_полей_уникальны_внутри_вида_работ():
    for template in TEMPLATES:
        keys = [field[0] for field in fields_of(template)]
        assert len(keys) == len(set(keys)), f"повторы полей в «{template['key']}»"


@pytest.mark.parametrize("template, field", CASES)
def test_поле_ссылается_на_существующий_прайс(template, field):
    key, _label, _type, source, group, role, _default, _required, extra = field
    if source != "price":
        assert not group, f"поле «{key}» не из прайса, но раздел указан"
        return

    assert group in GROUPS, f"поле «{key}» ссылается на несуществующий раздел «{group}»"

    item = extra.get("price_item")
    if item:
        assert (group, item) in ITEMS, (
            f"поле «{key}» ссылается на позицию «{item}», которой нет в «{group}». "
            "Такая строка молча выпадет из сметы"
        )
    else:
        # список берёт варианты из раздела — в нём должно быть что выбрать
        assert GROUPS[group][6], f"раздел «{group}» для поля «{key}» пуст"


@pytest.mark.parametrize("template, field", CASES)
def test_единица_цены_подходит_роли(template, field):
    key, _label, _type, source, group, role, _default, _required, extra = field
    if source != "price" or role not in ROLE_UNITS:
        return

    item = extra.get("price_item")
    if item and (group, item) not in ITEMS:
        # о самой пропаже скажет тест выше — здесь незачем падать второй раз
        return
    units = (
        {ITEMS[(group, item)][3]}
        if item
        else {row[3] for row in GROUPS[group][6]}
    )
    allowed = ROLE_UNITS[role]
    assert units & allowed, (
        f"«{template['key']}.{key}»: роль {role} ждёт цену в {sorted(allowed)}, "
        f"а в прайсе {sorted(units)}"
    )


@pytest.mark.parametrize("template", TEMPLATES, ids=[t["key"] for t in TEMPLATES])
def test_ролям_хватает_измерений(template):
    """per_sqm без ширины с высотой не посчитается — расчёт просто встанет."""
    present = roles_of(template)
    for field in fields_of(template):
        role = field[5]
        for needed in NEEDS_SIZE.get(role, ()):
            assert needed in present, (
                f"«{template['key']}.{field[0]}» считается по {role}, "
                f"а поля с ролью «{needed}» в виде работ нет"
            )


@pytest.mark.parametrize("template, field", CASES)
def test_ссылка_на_поле_длины_ведёт_куда_надо(template, field):
    """source_field указывает, по какой длине считать. Опечатка в нём —
    и расчёт молча возьмёт первую попавшуюся длину."""
    source_field = field[8].get("source_field")
    if not source_field:
        return
    target = next((f for f in fields_of(template) if f[0] == source_field), None)
    assert target is not None, (
        f"«{template['key']}.{field[0]}» ссылается на поле «{source_field}», которого нет"
    )
    assert target[5] in ("width", "height", "length"), (
        f"«{source_field}» не измерение, по нему нельзя считать длину"
    )


@pytest.mark.parametrize("template", TEMPLATES, ids=[t["key"] for t in TEMPLATES])
def test_коэффициент_не_стоит_первым(template):
    """Коэффициент умножает то, что выше него. Первым — умножать нечего."""
    fields = fields_of(template)
    if fields and fields[0][5] == "multiplier":
        pytest.fail(f"в «{template['key']}» коэффициент стоит первым полем")


@pytest.mark.parametrize("template", TEMPLATES, ids=[t["key"] for t in TEMPLATES])
def test_ступени_тиража_это_числа(template):
    """Ступени ищутся по ключам-числам: «от 500» вместо «500» не сработает."""
    for field in fields_of(template):
        if field[5] != "step_per_unit":
            continue
        keys = [item[0] for item in GROUPS[field[4]][6]]
        assert all(k.isdigit() for k in keys), (
            f"в разделе «{field[4]}» есть нечисловые ключи: {keys}"
        )


@pytest.mark.parametrize("template", TEMPLATES, ids=[t["key"] for t in TEMPLATES])
def test_в_каждом_виде_работ_есть_на_чём_считать(template):
    """Вид работ, где ни одно поле не влияет на цену, посчитать нельзя."""
    assert roles_of(template) & MONEY_ROLES, f"«{template['key']}» ничего не считает"


# ------------------------------------------------------------------ то, что уже путали
def test_плоттерная_резка_считается_по_длине_реза():
    """Регрессия. Сначала она считалась по периметру изделия — но плоттер
    режет по контуру: длина реза не выводится из ширины и высоты. Полсотни
    мелких наклеек на одном листе дают метраж, который знает только
    программа плоттера, поэтому его вводят руками."""
    sticker = next(t for t in TEMPLATES if t["key"] == "sticker_print")
    plotter = next(f for f in fields_of(sticker) if f[0] == "plotter_cut")

    assert plotter[5] == "per_length", "плоттерная резка снова считается не по длине реза"
    assert plotter[8].get("source_field") == "cut_length"

    # а ручная режет прямоугольник по краю — там длина реза и есть периметр
    hand = next(f for f in fields_of(sticker) if f[0] == "hand_cut")
    assert hand[5] == "per_m"
