"""Расчёт стоимости — общий для всех видов работ.

Раньше под каждый вид работ была своя функция с зашитой формулой. Теперь
формула одна, а разницу задают сами поля шаблона: у каждого поля есть роль
(pricing_role), которая говорит, как выбранное значение влияет на цену.
Поэтому администратор может завести новый вид работ через интерфейс, и он
сразу считается — править код не нужно.

Роли полей
----------
    none        поле не участвует в цене (например, комментарий)
    per_unit    ставка × количество         (цена оттиска, цена визитки)
                у поля-счётчика — ставка × введённое число × тираж
                (восемь люверсов на каждом из трёх баннеров)
    per_sqm     ставка × общая площадь      (плёнка, баннер)
    per_m       ставка × периметр           (проклейка и люверсы по контуру)
    per_length  ставка × длина               (резка ленты, кант, профиль —
                                              когда важна только длина)
    per_order   ставка один раз за заказ    (приладка, скрепление)
    multiplier  умножает то, что накопилось ВЫШЕ него по списку полей
                (двусторонняя ×1.8). Порядок полей важен: коэффициент,
                стоящий сразу после «Формата», удвоит только печать, а
                поднятый выше «Бумаги» — ещё и бумагу
    width       ширина в мм — для площади и периметра
    height      высота в мм
    length      длина в мм — для расчёта по длине, второе измерение не нужно
    length      длина в мм — для расчёта по погонному метру

Откуда берётся ставка
---------------------
    source="price"  поле-список: выбранное значение — это ключ позиции в
                    разделе прайса, её цена и есть ставка;
                    поле-галочка: ставка берётся из позиции price_item
                    (или из позиции с ключом самого поля);
                    поле-число: ставка тоже из price_item, а введённое
                    число — это количество, на которое её умножают.
    source="list"   свой список вариантов, в цене не участвует
                    (роль обычно none). У поля-числа без прайса введённое
                    значение считается самой ставкой.

Цены живут в базе и правятся администратором на странице «Прайс» — здесь
только арифметика. Расчёт всегда лишь подсказывает: итоговую цену менеджер
вбивает руками, и хранится она в поле price заказа.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import PriceItem

# служебный раздел с общими правилами расчёта
WORK_GROUP = "work"
MIN_ORDER_KEY = "min_order"

# внутри всё считается в миллиметрах; человек вводит в удобных ему единицах
UNIT_TO_MM = {"мм": 1.0, "см": 10.0, "м": 1000.0}


def load_rates(db: Session) -> dict[str, dict[str, float]]:
    """Все активные тарифы: {раздел: {ключ позиции: значение}}."""
    rates: dict[str, dict[str, float]] = {}
    for item in db.scalars(select(PriceItem).where(PriceItem.active.is_(True))).all():
        rates.setdefault(item.group_key, {})[item.item_key] = item.value
    return rates


def seed_defaults(db: Session) -> int:
    """Возвращает в прайс позиции, которых в нём нет.

    Стоит за кнопкой «Восстановить недостающие»: позиция, удалённая по
    ошибке, возвращается с прежним ключом — и расчёт снова её находит.
    Цены уже существующих позиций не трогает, их правил человек.

    Данные — те же, что заливаются в пустую базу (app/seed_catalog.py).
    Раньше у кнопки был свой список в price_catalog.py, и она возвращала
    цены, которых в каталоге давно не было.
    """
    from app.seed_catalog import seed_price_items

    return seed_price_items(db)


# ---------------------------------------------------------------- помощники
def _num(value, fallback: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return fallback


def _rate(rates: dict, group: str, key, fallback: float = 0.0) -> float:
    """Ставка из прайса. Если позицию удалили или отключили — запасное значение."""
    if not group:
        return fallback
    return rates.get(group, {}).get(str(key), fallback)


def contributes(field: dict, params: dict) -> bool:
    """Участвует ли поле в цене ПРИ ЭТИХ значениях заказа.

    Ключевое слово — «при этих». Роль поля описывает, как оно считается,
    если его выбрали, но не говорит, выбрали ли его сейчас. Снятая галочка
    «Обрезка» ничего не добавляет к цене — и требовать ради неё длину
    нельзя, иначе простая печать без обрезки вообще не считается.
    """
    role = field.get("pricing_role", "none")
    if role in ("none", "width", "height", "length"):
        return False

    value = params.get(field["key"], field.get("default"))
    if field.get("type") == "bool":
        return bool(value)
    if field.get("type") == "number":
        return _num(value) != 0
    return value not in (None, "", "Нет")


def needed_dimensions(fields: list[dict], params: dict | None) -> set[str]:
    """Ключи полей-измерений, без которых цену не посчитать.

    Нужно и расчёту, и форме заказа: поле, которое ни на что не влияет,
    в форме показывается погашенным, а не требует заполнения.
    """
    params = params or {}
    paying = [f for f in fields if contributes(f, params)]
    roles = {f.get("pricing_role") for f in paying}

    dimensions = [f for f in fields if f.get("pricing_role") in ("width", "height", "length")]
    first: dict[str, str] = {}
    for field in dimensions:
        first.setdefault(field["pricing_role"], field["key"])

    needed: set[str] = set()
    # площадь и периметр строятся на обеих сторонах
    if {"per_sqm", "per_m"} & roles:
        for role in ("width", "height"):
            if role in first:
                needed.add(first[role])
    # у расчёта по длине каждое поле может смотреть на свою длину
    for field in paying:
        if field.get("pricing_role") != "per_length":
            continue
        source = field.get("source_field") or ""
        needed.add(source if any(d["key"] == source for d in dimensions) else first.get("length", ""))

    needed.discard("")
    return needed


def _step_rate(rates: dict, group: str, quantity: int) -> float:
    """Ставка по ступеням тиража: ключи-числа, берём наибольшую подходящую.

    Так устроены визитки: от 100 шт одна цена, от 500 — другая.
    """
    steps = sorted(
        ((int(k), v) for k, v in rates.get(group, {}).items() if str(k).isdigit()),
        key=lambda pair: pair[0],
    )
    if not steps:
        return 0.0
    value = steps[0][1]
    for edge, rate in steps:
        if quantity >= edge:
            value = rate
    return value


# ---------------------------------------------------------------- расчёт
def estimate_from_fields(
    rates: dict,
    fields: list[dict],
    quantity: int,
    params: dict | None,
) -> dict:
    """Считает цену по описанию полей шаблона. fields — то же, что отдаёт каталог."""
    params = params or {}
    qty = max(int(quantity or 1), 1)
    lines: list[dict] = []

    # Измерения собираем по ключам полей, а не в три переменные: длин в шаблоне
    # может быть несколько — например погонаж материала и длина реза, — и каждое
    # денежное поле считается по своему (см. source_field).
    dims: dict[str, float] = {}      # ключ поля -> значение в мм
    first: dict[str, str] = {}       # роль -> ключ первого такого поля
    for field in fields:
        role = field.get("pricing_role")
        if role not in ("width", "height", "length"):
            continue
        raw = _num(params.get(field["key"]), _num(field.get("default")))
        dims[field["key"]] = raw * UNIT_TO_MM.get(field.get("unit") or "мм", 1.0)
        first.setdefault(role, field["key"])

    def dim(role: str, source: str = "") -> float:
        """Значение измерения: по указанному полю, иначе по первому такому."""
        if source and source in dims:
            return dims[source]
        key = first.get(role)
        return dims.get(key, 0.0) if key else 0.0

    width = dim("width")
    height = dim("height")
    length = dim("length")

    area_one = max(width * height / 1_000_000, 0.0)
    total_area = area_one * qty
    perimeter_m = 2 * (width + height) / 1000 * qty if (width and height) else 0.0
    length_m = length / 1000 * qty

    # Требуем размеры только у того, что реально выбрано в этом заказе.
    # Раньше здесь стоял набор ролей всего шаблона, и снятая галочка
    # «Обрезка» продолжала требовать длину: печать без обрезки не считалась
    # вовсе, хотя длина ей не нужна.
    paying = [f for f in fields if contributes(f, params)]
    needed = needed_dimensions(fields, params)

    # Называем поля так, как их назвал администратор: «Укажите: Длина резки»
    # понятнее, чем «Укажите длину», когда длин в шаблоне несколько.
    missing = [f for f in fields if f["key"] in needed and dims.get(f["key"], 0.0) <= 0]
    if missing:
        return {
            "price": None,
            "breakdown": [],
            "note": "Укажите: " + ", ".join(f.get("label") or f["key"] for f in missing),
        }

    subtotal = 0.0
    # Позиции, которые поле требует, а прайс их не даёт: удалили или
    # отключили «глазом». Раньше такая строка молча выпадала из сметы —
    # заказ считался дешевле, и заметить это было нечем.
    lost: list[str] = []

    for field in fields:
        role = field.get("pricing_role", "none")
        if role in ("none", "width", "height", "length"):
            continue

        key = field["key"]
        value = params.get(key, field.get("default"))
        group = field.get("price_group") or ""
        label = field.get("label", key)

        # Сколько «штук» даёт поле. Галочка и список дают одну, поле-счётчик —
        # столько, сколько ввели: люверсов на баннере может быть восемь.
        count = 1.0

        # чем платим: галочка берёт ставку по фиксированному ключу,
        # список — по выбранному значению
        if field.get("type") == "bool":
            if not value:
                continue
            item_key = field.get("price_item") or key
            rate = _rate(rates, group, item_key)
        elif field.get("type") == "number":
            entered = _num(value)
            if field.get("source") == "price":
                # платное количество: введённое — это сколько штук,
                # а цена штуки лежит в прайсе
                if entered <= 0:
                    continue
                count = entered
                rate = _rate(rates, group, field.get("price_item") or key)
            else:
                # поле без прайса: введённое считается самой ставкой
                rate = entered
        else:
            if value in (None, "", "Нет"):
                continue
            item_key = value
            rate = _rate(rates, group, item_key)

        if not rate:
            wanted = field.get("price_item") or (value if field.get("type") == "select" else "")
            if group and wanted:
                lost.append(f"{label} → «{wanted}»")
            continue

        if role == "multiplier":
            # применяем сразу: коэффициент действует на то, что выше него
            addition = subtotal * (rate - 1)
            if abs(addition) >= 0.005:
                subtotal += addition
                shown = label if field.get("type") == "bool" else f"{label}: {value}"
                lines.append({"label": f"{shown} (×{rate:g})", "amount": addition})
            continue

        if role == "per_unit":
            # штук всего: сколько на изделии × сколько изделий.
            # У галочки и списка count = 1, и строка выглядит как прежде.
            units = count * qty
            amount = rate * units
            text = f"{label} · {units:g} × {rate:g} ₽"
        elif role == "per_sqm":
            amount = rate * total_area
            text = f"{label} · {total_area:.2f} м² × {rate:g} ₽"
        elif role == "per_m":
            amount = rate * perimeter_m
            text = f"{label} · периметр {perimeter_m:.2f} м × {rate:g} ₽"
        elif role == "per_length":
            own = dim("length", field.get("source_field", "")) / 1000 * qty
            if own <= 0:
                continue
            amount = rate * own
            text = f"{label} · {own:.2f} м × {rate:g} ₽"
        elif role == "per_order":
            # разово за заказ: тираж не влияет, а введённое количество — да
            amount = rate * count
            text = label if count == 1 else f"{label} · {count:g} × {rate:g} ₽"
        elif role == "step_per_unit":
            step = _step_rate(rates, group, qty)
            amount = step * qty
            text = f"{label} · {qty} × {step:g} ₽"
        else:
            continue

        subtotal += amount
        lines.append({"label": text, "amount": amount})

    notes: list[str] = []
    min_order = _rate(rates, WORK_GROUP, MIN_ORDER_KEY, 0)
    if min_order and subtotal < min_order:
        lines.append({"label": "Минимальный заказ", "amount": min_order - subtotal})
        subtotal = min_order
        notes.append("Применён минимальный заказ")

    if lost:
        notes.append(
            "Нет цены в прайсе: "
            + "; ".join(lost)
            + ". Эти позиции в сумму не вошли — проверьте прайс."
        )
    note = " · ".join(notes)

    if not lines:
        return {
            "price": None,
            "breakdown": [],
            # разные причины пустого расчёта — разные подсказки: «цены не
            # настроены» при ненастроенном прайсе сбивает с толку, если на
            # самом деле в заказе просто ничего платного не выбрано
            "note": (
                "Для этого вида работ цены пока не настроены"
                if paying
                else "Выберите хотя бы один параметр, влияющий на цену"
            ),
        }

    return {
        "price": round(subtotal, 2),
        "breakdown": [{"label": x["label"], "amount": round(x["amount"], 2)} for x in lines],
        "note": note,
    }


def estimate(db: Session, template_key: str, quantity: int, params: dict | None) -> dict:
    """Точка входа: находит шаблон и считает по его полям."""
    from app import catalog

    template = catalog.get_template(db, template_key)
    if template is None:
        return {"price": None, "breakdown": [], "note": "Неизвестный вид работ"}
    return estimate_from_fields(load_rates(db), template["fields"], quantity, params)