"""Стартовый каталог: разделы прайса, позиции и виды работ.

Одно место на всё. Раньше данные лежали в двух файлах — разделы и виды работ
здесь, цены в `price_catalog.py`, — и правка в одном месте оставляла второе
со старыми цифрами. Тот файл убран, всё описано ниже.

Заливается в **пустую** базу при первом запуске (`app/main.py`, `seed_if_empty`)
и вручную скриптом:

    python -m scripts.seed_workshop          # дозалить недостающее
    python -m scripts.seed_workshop --wipe   # стереть всё и залить заново

Отсюда же берёт данные кнопка «Восстановить недостающие» на странице прайса:
позиция, удалённая по ошибке, возвращается с прежним ключом, и расчёт снова
её находит.

Цены здесь — образец, а не прайс мастерской: их правят в интерфейсе, и
перезапускать сервер для этого не нужно.

Структура прайса
----------------
Разделы вложены на два уровня — по тому, как о них думают в цеху:

    Материалы        → Баннер · Самоклейка            (₽/м², для печати)
    Обработка        → Баннер · Самоклейка            (что делаем с готовым)
    Фрезеровка                                        (₽/пог.м реза)
    Продажа          → Баннер в рулоне · Самоклейка в рулоне · Листовые
    Визитки          → Тираж · Бумага · Стороны · Доп работы

Как из ролей полей собираются разные работы
--------------------------------------------
Формул под виды работ нет, расчёт один на всех (`app/pricing.py`), разницу
задаёт роль поля:

* печать баннера — площадь × цена материала, плюс периметр на проклейку
  и обрезку, плюс люверсы поштучно;
* печать самоклейки — площадь, плюс длина контурного реза (её вводят: из
  ширины и высоты она не выводится) и ручная обрезка по периметру;
* фрезеровка и продажа рулонов — длина × цена за погонный метр;
* продажа листов — цена листа × количество;
* визитки — цена по ступеням тиража, а бумага и стороны идут коэффициентами.

Порядок полей значим: коэффициент умножает всё, что стоит ВЫШЕ него. У визиток
поэтому бумага и стороны идут сразу за тиражом (умножают печать), а доплаты за
скругление и ламинацию — ниже, их коэффициенты уже не трогают.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import PriceGroup, PriceItem, Template, TemplateField

# ---------------------------------------------------------------- прайс
# (ключ, название, подсказка, единица по умолчанию, иконка, родитель, позиции)
# позиция: (ключ, название, цена, единица)
#
# Ключ позиции — то, по чему расчёт находит цену; он же попадает в данные
# заказа. Название рядом можно править свободно, ключ — нет.
PRICE_GROUPS: list[tuple] = [
    # ---- материалы для печати
    ("materialy", "Материалы", "Из чего печатаем", "₽/м²", "roll", "", []),
    (
        "banner_print", "Баннер", "Баннерная ткань для печати", "₽/м²", "roll", "materialy",
        [
            ("Баннер 440г", "Баннер 440 г, литой", 100, "₽/м²"),
            ("Баннер 580г", "Баннер 580 г, литой", 120, "₽/м²"),
            ("Сетка 370г", "Баннерная сетка 370 г", 140, "₽/м²"),
        ],
    ),
    (
        "samokleyka_print", "Самоклейка", "Плёнка для печати", "₽/м²", "roll", "materialy",
        [
            ("Oracal 641 глянец", "Oracal 641 глянец", 250, "₽/м²"),
            ("Oracal 641 мат", "Oracal 641 матовая", 250, "₽/м²"),
            ("Oracal 3641 литая", "Oracal 3641 литая", 450, "₽/м²"),
            ("Перфорированная", "Перфорированная (сетка на стекло)", 380, "₽/м²"),
            ("Прозрачная", "Прозрачная", 320, "₽/м²"),
        ],
    ),
    # ---- обработка готовой печати
    ("obrabotka", "Обработка", "Что делаем с готовой печатью", "₽/пог.м", "blade", "", []),
    (
        # раздел намеренно смешанный: проклейка идёт за погонный метр,
        # а люверсы за штуку — единица у каждой позиции своя
        "obrabotka_banner", "Баннер", "Проклейка, обрезка, люверсы",
        "₽/пог.м", "blade", "obrabotka",
        [
            ("Проклейка", "Проклейка по периметру", 80, "₽/пог.м"),
            ("Обрезка", "Обрезка по периметру", 25, "₽/пог.м"),
            ("Люверсы", "Люверсы", 30, "₽/шт"),
        ],
    ),
    (
        "obrabotka_samokleyka", "Самоклейка", "Резка плёнки",
        "₽/пог.м", "blade", "obrabotka",
        [
            ("Плоттерная резка", "Плоттерная резка, за метр реза", 15, "₽/пог.м"),
            ("Ручная обрезка", "Ручная обрезка по периметру", 30, "₽/пог.м"),
            ("Ламинация", "Ламинация плёнки", 180, "₽/м²"),
        ],
    ),
    # ---- фрезеровка
    (
        "frezerovka", "Фрезеровка", "Рез по погонному метру", "₽/пог.м", "blade", "",
        [
            ("Дерево", "Дерево (фанера, МДФ)", 150, "₽/пог.м"),
            ("ПВХ", "ПВХ", 200, "₽/пог.м"),
            ("Акрил", "Акрил", 250, "₽/пог.м"),
            ("Металл", "Металл", 400, "₽/пог.м"),
        ],
    ),
    # ---- продажа материалов
    ("prodazha", "Продажа материалов", "Материал без работы", "₽/пог.м", "roll", "", []),
    (
        "banner_rulon", "Баннер в рулоне", "Продажа метражом", "₽/пог.м", "roll", "prodazha",
        [
            ("Баннер 440г", "Баннер 440 г, ширина 3.2 м", 220, "₽/пог.м"),
            ("Баннер 580г", "Баннер 580 г, ширина 3.2 м", 280, "₽/пог.м"),
        ],
    ),
    (
        "samokleyka_rulon", "Самоклейка в рулоне", "Продажа метражом",
        "₽/пог.м", "roll", "prodazha",
        [
            ("Oracal 641 глянец", "Oracal 641 глянец, 1.0 м", 190, "₽/пог.м"),
            ("Oracal 641 мат", "Oracal 641 матовая, 1.0 м", 190, "₽/пог.м"),
            ("Oracal 3641 литая", "Oracal 3641 литая, 1.37 м", 340, "₽/пог.м"),
            ("Прозрачная", "Прозрачная, 1.0 м", 240, "₽/пог.м"),
        ],
    ),
    (
        "listovye", "Листовые материалы", "Продажа листами", "₽/лист", "doc", "prodazha",
        [
            ("Фанера 6 мм", "Фанера 6 мм, 1520×1520", 1400, "₽/лист"),
            ("МДФ 3 мм", "МДФ 3 мм, 2070×1400", 900, "₽/лист"),
            ("ПВХ 3 мм", "ПВХ вспененный 3 мм, 2050×3050", 2600, "₽/лист"),
            ("ПВХ 5 мм", "ПВХ вспененный 5 мм, 2050×3050", 3900, "₽/лист"),
            ("Акрил 3 мм", "Акрил прозрачный 3 мм, 2050×3050", 7200, "₽/лист"),
            ("Оцинковка 0.5 мм", "Оцинковка 0.5 мм, 1250×2500", 2100, "₽/лист"),
        ],
    ),
    # ---- визитки
    ("vizitki", "Визитки", "Печать визиток и доработка", "₽/шт", "card", "", []),
    (
        # ключи-числа: по ним расчёт выбирает ступень под тираж заказа
        "vizitki_tirazh", "Тираж", "Чем больше тираж, тем дешевле штука",
        "₽/шт", "card", "vizitki",
        [
            ("100", "от 100 шт", 12, "₽/шт"),
            ("500", "от 500 шт", 6, "₽/шт"),
            ("1000", "от 1000 шт", 4, "₽/шт"),
            ("5000", "от 5000 шт", 3, "₽/шт"),
        ],
    ),
    (
        "vizitki_bumaga", "Бумага", "Коэффициент к печати", "×", "card", "vizitki",
        [
            ("Мелованная 300", "Мелованная 300 г", 1, "×"),
            ("Дизайнерская", "Дизайнерская", 1.6, "×"),
            ("Крафт", "Крафт", 1.3, "×"),
            ("Тач-кавер", "Touch cover, бархатистая", 1.9, "×"),
        ],
    ),
    (
        "vizitki_storony", "Стороны", "Коэффициент к печати", "×", "card", "vizitki",
        [
            ("Односторонняя", "Односторонняя", 1, "×"),
            ("Двусторонняя", "Двусторонняя", 1.8, "×"),
        ],
    ),
    (
        "vizitki_dop", "Доп работы", "Считается за каждую визитку",
        "₽/шт", "card", "vizitki",
        [
            ("Скругление углов", "Скругление углов", 1.5, "₽/шт"),
            ("Ламинация", "Ламинация матовая", 2, "₽/шт"),
            ("Тиснение", "Тиснение фольгой", 4, "₽/шт"),
        ],
    ),
]

# ---------------------------------------------------------------- виды работ
# поле: (ключ, подпись, тип, источник, раздел, роль, умолчание, обязательное, extra)
F = dict  # extra: price_item, unit, options, source_field

TEMPLATES: list[dict] = [
    {
        "key": "banner_print",
        "title": "Печать баннера",
        "short": "Баннер",
        "hint": "Печать на баннерной ткани с обработкой",
        "icon": "printer",
        "quantity_label": "Количество, шт",
        "fields": [
            ("material", "Материал", "select", "price", "banner_print", "per_sqm",
             "Баннер 440г", True, F()),
            ("width", "Ширина", "number", "list", "", "width", "0", True, F(unit="м")),
            ("height", "Высота", "number", "list", "", "height", "0", True, F(unit="м")),
            ("gluing", "Проклейка по периметру", "bool", "price", "obrabotka_banner", "per_m",
             "", False, F(price_item="Проклейка")),
            ("cutting", "Обрезка по периметру", "bool", "price", "obrabotka_banner", "per_m",
             "", False, F(price_item="Обрезка")),
            ("grommets", "Люверсы, шт", "number", "price", "obrabotka_banner", "per_unit",
             "0", False, F(price_item="Люверсы")),
        ],
    },
    {
        "key": "sticker_print",
        "title": "Печать самоклейки",
        "short": "Самоклейка",
        "hint": "Печать на плёнке, при необходимости с резкой",
        "icon": "printer",
        "quantity_label": "Количество, шт",
        "fields": [
            ("material", "Материал", "select", "price", "samokleyka_print", "per_sqm",
             "Oracal 641 глянец", True, F()),
            ("width", "Ширина", "number", "list", "", "width", "0", True, F(unit="м")),
            ("height", "Высота", "number", "list", "", "height", "0", True, F(unit="м")),
            # Плоттерная режет по контуру: длина реза от габаритов изделия не
            # зависит вовсе. Наклейка сложной формы или полсотни мелких на
            # одном листе дают метраж, который знает только программа
            # плоттера, — поэтому его вводят, а не считают из ширины с высотой.
            ("plotter_cut", "Плоттерная резка", "bool", "price", "obrabotka_samokleyka",
             "per_length", "", False, F(price_item="Плоттерная резка", source_field="cut_length")),
            ("cut_length", "Длина реза на изделие", "number", "list", "", "length",
             "0", False, F(unit="м")),
            # Ручная — рез по краю прямоугольника, тут длина реза и есть
            # периметр: считаем сами, вводить нечего.
            ("hand_cut", "Ручная обрезка по периметру", "bool", "price", "obrabotka_samokleyka",
             "per_m", "", False, F(price_item="Ручная обрезка")),
            ("lamination", "Ламинация", "bool", "price", "obrabotka_samokleyka", "per_sqm",
             "", False, F(price_item="Ламинация")),
        ],
    },
    {
        "key": "milling",
        "title": "Фрезеровка",
        "short": "Фрезер",
        "hint": "Рез на фрезерном станке, считается по длине реза",
        "icon": "blade",
        "quantity_label": "Количество деталей, шт",
        "fields": [
            ("material", "Материал", "select", "price", "frezerovka", "per_length",
             "Дерево", True, F()),
            ("cut_length", "Длина реза", "number", "list", "", "length", "0", True, F(unit="м")),
        ],
    },
    {
        "key": "banner_roll",
        "title": "Баннер на продажу",
        "short": "Баннер м",
        "hint": "Материал метражом, без печати",
        "icon": "roll",
        "quantity_label": "Количество отрезов, шт",
        "fields": [
            ("material", "Вид баннера", "select", "price", "banner_rulon", "per_length",
             "Баннер 440г", True, F()),
            ("length", "Длина отреза", "number", "list", "", "length", "0", True, F(unit="м")),
        ],
    },
    {
        "key": "sticker_roll",
        "title": "Самоклейка на продажу",
        "short": "Плёнка м",
        "hint": "Плёнка метражом, без печати",
        "icon": "roll",
        "quantity_label": "Количество отрезов, шт",
        "fields": [
            ("material", "Вид плёнки", "select", "price", "samokleyka_rulon", "per_length",
             "Oracal 641 глянец", True, F()),
            ("length", "Длина отреза", "number", "list", "", "length", "0", True, F(unit="м")),
        ],
    },
    {
        "key": "sheet_sale",
        "title": "Листовой материал на продажу",
        "short": "Лист",
        "hint": "Фанера, ПВХ, акрил, металл — целыми листами",
        "icon": "doc",
        "quantity_label": "Количество листов, шт",
        "fields": [
            ("material", "Материал", "select", "price", "listovye", "per_unit",
             "ПВХ 3 мм", True, F()),
        ],
    },
    {
        "key": "cards",
        "title": "Визитки",
        "short": "Визитки",
        "hint": "Стандарт 90×50, цена зависит от тиража",
        "icon": "card",
        "quantity_label": "Тираж, шт",
        "fields": [
            # порядок значим: коэффициенты умножают то, что выше них
            ("tier", "Цена по тиражу", "select", "price", "vizitki_tirazh", "step_per_unit",
             "100", True, F()),
            ("paper", "Бумага", "select", "price", "vizitki_bumaga", "multiplier",
             "Мелованная 300", True, F()),
            ("sides", "Стороны", "select", "price", "vizitki_storony", "multiplier",
             "Односторонняя", True, F()),
            # ниже коэффициентов: доплаты за штуку, умножать их на бумагу незачем
            ("corners", "Скругление углов", "bool", "price", "vizitki_dop", "per_unit",
             "", False, F(price_item="Скругление углов")),
            ("lamination", "Ламинация", "bool", "price", "vizitki_dop", "per_unit",
             "", False, F(price_item="Ламинация")),
            ("foil", "Тиснение фольгой", "bool", "price", "vizitki_dop", "per_unit",
             "", False, F(price_item="Тиснение")),
            ("size", "Размер", "select", "list", "", "none", "90×50 мм", False,
             F(options=["90×50 мм", "85×55 мм", "50×50 мм"])),
        ],
    },
]


def default_items() -> dict[str, list[tuple[str, str, float, str]]]:
    """Позиции по разделам — то, что восстанавливает кнопка «Восстановить
    недостающие» и заливает первый запуск."""
    return {group[0]: group[6] for group in PRICE_GROUPS if group[6]}


def seed_price_groups(db: Session) -> int:
    """Заводит разделы прайса. Существующие не трогает."""
    existing = {g.key for g in db.scalars(select(PriceGroup)).all()}
    added = 0
    for order, (key, title, hint, unit, icon, parent, _items) in enumerate(PRICE_GROUPS):
        if key in existing:
            continue
        db.add(PriceGroup(
            key=key, title=title, hint=hint, unit=unit, icon=icon,
            parent_key=parent, sort_order=order,
            # раздел-коэффициент рисуется иначе: там не рубли, а множитель
            kind="factor" if unit == "×" else "money",
        ))
        added += 1
    if added:
        db.commit()
    return added


def seed_price_items(db: Session) -> int:
    """Заводит позиции. Цены существующих не трогает — их правил человек."""
    existing = {(i.group_key, i.item_key) for i in db.scalars(select(PriceItem)).all()}
    added = 0
    for group_key, rows in default_items().items():
        for pos, (item_key, title, value, unit) in enumerate(rows):
            if (group_key, item_key) in existing:
                continue
            db.add(PriceItem(
                group_key=group_key, item_key=item_key, title=title,
                value=float(value), unit=unit, sort_order=pos,
            ))
            added += 1
    if added:
        db.commit()
    return added


def seed_templates(db: Session) -> int:
    """Заводит виды работ вместе с полями."""
    existing = {t.key for t in db.scalars(select(Template)).all()}
    added = 0
    for order, item in enumerate(TEMPLATES):
        if item["key"] in existing:
            continue
        template = Template(
            key=item["key"], title=item["title"], short=item["short"],
            hint=item["hint"], icon=item["icon"],
            quantity_label=item["quantity_label"], sort_order=order,
        )
        db.add(template)
        db.flush()

        for pos, (key, label, ftype, source, group, role, default, required, extra) in enumerate(
            item["fields"]
        ):
            db.add(TemplateField(
                template_id=template.id,
                key=key, label=label, type=ftype, source=source,
                price_group=group, pricing_role=role, default_value=default,
                required=required, sort_order=pos,
                price_item=extra.get("price_item", ""),
                # по какому полю-длине считать: длин в шаблоне может быть
                # несколько, и «умножить на длину» должно знать, на какую
                source_field=extra.get("source_field", ""),
                unit=extra.get("unit", "мм"),
                options=extra.get("options", []),
            ))
        added += 1
    if added:
        db.commit()
    return added
