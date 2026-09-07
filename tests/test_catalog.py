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
    if source != "price" and role == "step_per_unit":
        # список из своего набора называет таблицу прайса — раздел обязан быть
        assert group in GROUPS and GROUPS[group][6], f"у ступеней «{key}» нет раздела с ценами"
        return
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
        # «500» или «Лён:4+4:500» — последняя часть ключа обязана быть числом
        assert all(k.rsplit(":", 1)[-1].isdigit() for k in keys), (
            f"в разделе «{field[4]}» есть ключи без числа тиража: {keys[:5]}"
        )
        # у списка из своего набора каждый вариант должен иметь свою таблицу
        if field[3] == "list":
            for option in field[8].get("options", []):
                assert any(k.startswith(option + ":") for k in keys), (
                    f"в «{field[4]}» нет таблицы для варианта «{option}»"
                )


@pytest.mark.parametrize("template", TEMPLATES, ids=[t["key"] for t in TEMPLATES])
def test_в_каждом_виде_работ_есть_на_чём_считать(template):
    """Вид работ, где ни одно поле не влияет на цену, посчитать нельзя."""
    assert roles_of(template) & MONEY_ROLES, f"«{template['key']}» ничего не считает"


# ------------------------------------------------------------------ то, что уже путали
def test_плоттерная_резка_по_площади_как_в_прайсе():
    """Регрессия наоборот. Раньше плоттерную резку считали по длине реза, и
    метраж вводили руками. В настоящем прайсе мастерской резка стоит за м²
    отпечатка (15 ₽/м²), поэтому теперь это галочка по площади: ни длины,
    ни отдельного поля для неё быть не должно."""
    film = next(t for t in TEMPLATES if t["key"] == "film_print")
    plotter = next(f for f in fields_of(film) if f[0] == "plotter")
    assert plotter[5] == "per_sqm", "плоттерная резка снова считается не по площади"
    assert plotter[8].get("price_item") == "Плоттерная резка"
    assert not any(f[5] == "length" for f in fields_of(film)), "лишнее поле длины у самоклейки"


def test_визитки_считаются_по_таблицам_прайса():
    """Бумага называет таблицу, цветность — колонку. Ключи в разделе —
    «Лён:4+4:500», как строки бумажного прайса."""
    cards = next(t for t in TEMPLATES if t["key"] == "cards_poly")
    paper = next(f for f in fields_of(cards) if f[0] == "paper")
    color = next(f for f in fields_of(cards) if f[0] == "color")
    assert paper[5] == "step_per_unit" and paper[3] == "price"  # таблица — из прайса, не из своего списка
    assert color[5] == "step_key"
    keys = {item[0] for item in GROUPS["viz_poly"][6]}
    assert "Лён:4+4:500" in keys and "Бумага 300 г:1+0:100" in keys


def test_варианты_таблиц_читаются_из_ключей_прайса():
    """Так вид работ собирает администратор: указал раздел — варианты бумаги
    и цветности появились сами, из ключей позиций."""
    from app.catalog import tier_variants

    keys = ["Лён:4+0:100", "Лён:4+4:500", "300 г:4+0:100", "300 г:1+1:1500", "мусор", "100"]
    assert tier_variants(keys, 0) == ["Лён", "300 г"]
    assert tier_variants(keys, 1) == ["4+0", "4+4", "1+1"]
    assert tier_variants(["100", "500"], 0) == []


def test_поля_таблиц_тиража_собраны_из_прайса_а_не_из_своего_списка():
    """Регрессия: поле «Бумага» у визиток было списком из своего набора с
    приклеенным разделом прайса — редактор показывал его как «без цены»,
    а цена шла. Теперь источник — прайс, вариантов руками нет."""
    for template in TEMPLATES:
        for field in fields_of(template):
            if field[5] in ("step_per_unit", "step_key"):
                assert field[3] == "price", f"{template['key']}.{field[0]} собран не из прайса"
                assert field[4], f"{template['key']}.{field[0]} без раздела"
                assert not field[8].get("options"), f"{template['key']}.{field[0]} с ручными вариантами"


@pytest.mark.parametrize("template", TEMPLATES, ids=[t["key"] for t in TEMPLATES])
def test_список_из_прайса_владеет_разделом_один(template):
    """Регрессия. Список берёт варианты из ВСЕГО раздела: когда «Копирка» и
    «Скрепление» смотрели в один раздел, в копирке предлагалось скрепление.
    Поэтому раздел списка не делит никто другой в этом виде работ — ни второй
    список, ни галочка. Исключение — таблица тиража и её уточнения: они по
    устройству читают один раздел."""
    by_group: dict[str, list[tuple]] = {}
    for field in fields_of(template):
        if field[3] == "price" and field[4] and field[5] not in ("step_per_unit", "step_key"):
            by_group.setdefault(field[4], []).append(field)
    for group, fields in by_group.items():
        selects = [f for f in fields if f[2] == "select"]
        if not selects:
            continue
        others = [f[0] for f in fields if f is not selects[0]]
        assert not others, (
            f"«{template['key']}»: список «{selects[0][0]}» делит раздел «{group}» с {others} — "
            "в его вариантах окажутся чужие позиции"
        )

