"""Первичное наполнение: разделы прайса и виды работ.

Заливается в базу при первом запуске. Дальше всё правится через интерфейс —
этот файл только стартовая точка, менять его для новых видов работ не нужно.

Роли полей (pricing_role) описаны в app/pricing.py.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import PriceGroup, Template, TemplateField
from app.price_catalog import PRICE_GROUPS

# ---------------------------------------------------------------- виды работ
# (ключ, заголовок, метка, подсказка, иконка, подпись количества, поля)
# поле: (ключ, подпись, тип, источник, раздел прайса, роль, умолчание, доп.)
TEMPLATES: list[dict] = [
    {
        "key": "print_color",
        "title": "Печать цветная",
        "short": "Цвет",
        "hint": "Листовая цифровая печать в цвете",
        "icon": "printer",
        "quantity_label": "Тираж, оттисков",
        "fields": [
            ("format", "Формат", "select", "price", "print_color_sheet", "per_unit", "A4", {}),
            ("sides", "Стороны", "select", "price", "sides_k", "multiplier", "Односторонняя", {}),
            ("paper", "Бумага", "select", "price", "paper", "per_unit", "Мелованная 130 г", {}),
            ("lamination", "Ламинация", "select", "price", "lamination", "per_unit", "", {}),
            ("trim", "Резка в размер", "bool", "price", "work", "per_order", "",
             {"price_item": "trim"}),
        ],
    },
    {
        "key": "print_bw",
        "title": "Печать Ч/Б",
        "short": "Ч/Б",
        "hint": "Чёрно-белая печать, копии, документы",
        "icon": "doc",
        "quantity_label": "Тираж, оттисков",
        "fields": [
            ("format", "Формат", "select", "price", "print_bw_sheet", "per_unit", "A4", {}),
            ("sides", "Стороны", "select", "price", "sides_k", "multiplier", "Односторонняя", {}),
            ("paper", "Бумага", "select", "price", "paper", "per_unit", "Офисная 80 г", {}),
            ("binding", "Скрепление", "select", "price", "binding", "per_order", "", {}),
        ],
    },
    {
        "key": "plotter_cut",
        "title": "Плоттерная резка",
        "short": "Резка",
        "hint": "Плёнка, буквы, наклейки без печати",
        "icon": "blade",
        "quantity_label": "Количество, шт",
        "fields": [
            ("material", "Материал", "select", "price", "material_sqm", "per_sqm",
             "Oracal 641 глянцевая", {}),
            ("width_mm", "Ширина, мм", "number", "list", "", "width", "300", {}),
            ("height_mm", "Высота, мм", "number", "list", "", "height", "300", {}),
            ("cutting", "Резка", "bool", "price", "work", "per_sqm", "1",
             {"price_item": "cut_sqm"}),
            ("setup", "Приладка", "bool", "price", "work", "per_unit", "1",
             {"price_item": "cut_setup"}),
            ("weeding", "Выборка (прополка)", "bool", "price", "work", "per_sqm", "1",
             {"price_item": "weeding_sqm"}),
            ("transfer", "Монтажная плёнка", "bool", "price", "work", "per_sqm", "1",
             {"price_item": "transfer_sqm"}),
            ("mounting", "Оклейка на объекте", "bool", "price", "work", "per_sqm", "",
             {"price_item": "mounting_sqm"}),
        ],
    },
    {
        "key": "plotter_print",
        "title": "Плоттерная печать",
        "short": "Широкоформат",
        "hint": "Наклейки, баннеры, плёнка на стекло",
        "icon": "roll",
        "quantity_label": "Количество, шт",
        "fields": [
            ("product", "Изделие", "select", "list", "", "none", "Наклейка",
             {"options": ["Наклейка", "Баннер", "Плёнка на стекло", "Постер"]}),
            ("material", "Материал", "select", "price", "material_sqm", "per_sqm",
             "Самоклейка моно", {}),
            ("width_mm", "Ширина, мм", "number", "list", "", "width", "1000", {}),
            ("height_mm", "Высота, мм", "number", "list", "", "height", "700", {}),
            ("finish", "Обработка края", "select", "price", "finish_per_m", "per_m", "", {}),
            ("contour", "Контурная резка", "bool", "price", "work", "per_sqm", "",
             {"price_item": "contour_sqm"}),
            ("lamination", "Ламинация", "bool", "price", "work", "per_sqm", "",
             {"price_item": "wide_lamination_sqm"}),
        ],
    },
    {
        "key": "business_cards",
        "title": "Визитки",
        "short": "Визитки",
        "hint": "Стандарт 90×50 и дизайнерские",
        "icon": "card",
        "quantity_label": "Тираж, шт",
        "fields": [
            ("size", "Размер", "select", "list", "", "none", "90×50 мм",
             {"options": ["90×50 мм", "85×55 мм", "50×50 мм"]}),
            ("tier", "Цена по тиражу", "select", "price", "cards_base", "step_per_unit", "", {}),
            ("paper", "Бумага", "select", "price", "cards_paper_k", "multiplier",
             "Мелованная 300 г", {}),
            ("sides", "Стороны", "select", "price", "cards_sides_k", "multiplier", "Двусторонняя", {}),
            ("lamination", "Ламинация", "select", "price", "cards_lamination", "per_unit", "", {}),
            ("round_corners", "Скругление углов", "bool", "price", "work", "per_unit", "",
             {"price_item": "cards_corners"}),
        ],
    },
]


def seed_price_groups(db: Session) -> int:
    """Заводит разделы прайса. Стартовые помечаются системными —
    их нельзя удалить, потому что на них ссылаются виды работ."""
    existing = {g.key for g in db.scalars(select(PriceGroup)).all()}
    added = 0
    for order, group in enumerate(PRICE_GROUPS):
        if group["key"] in existing:
            continue
        db.add(
            PriceGroup(
                key=group["key"],
                title=group["title"],
                hint=group.get("hint", ""),
                unit=group.get("unit", "₽"),
                kind=group.get("kind", "money"),
                icon=group.get("icon", "printer"),
                sort_order=order,
                system=True,
            )
        )
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
            key=item["key"],
            title=item["title"],
            short=item["short"],
            hint=item["hint"],
            icon=item["icon"],
            quantity_label=item["quantity_label"],
            sort_order=order,
        )
        db.add(template)
        db.flush()

        # обязательные поля — те, без которых заказ бессмысленен (материал, формат).
        # остальные списки можно оставить пустыми: «без ламинации», «без скрепления»
        required_roles = {"per_unit", "per_sqm", "step_per_unit", "multiplier", "width", "height"}
        optional_keys = {"lamination", "finish", "binding"}

        for pos, (key, label, ftype, source, group, role, default, extra) in enumerate(item["fields"]):
            is_required = (
                ftype in ("select", "number")
                and role in required_roles
                and key not in optional_keys
            )
            db.add(
                TemplateField(
                    template_id=template.id,
                    key=key,
                    label=label,
                    type=ftype,
                    source=source,
                    price_group=group,
                    options=extra.get("options", []),
                    default_value=str(default),
                    pricing_role=role,
                    price_item=extra.get("price_item", ""),
                    sort_order=pos,
                    unit="мм",
                    required=is_required,
                )
            )
        added += 1
    if added:
        db.commit()
    return added