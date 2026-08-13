"""Каталог видов работ.

Шаблоны и их поля лежат в базе и настраиваются администратором в разделе
«Виды работ». Здесь — чтение и сборка того вида, в котором их ждут форма
заказа и расчёт цены.

Главная связка: поле с source="price" не хранит свой список вариантов, а
берёт их из раздела прайса. Добавили в прайс новый материал — он сразу
появился в форме заказа. Убрали — исчез. Никакого дублирования.

Стартовый набор видов работ (то, что раньше было зашито в коде) лежит в
app/catalog_defaults.py и заливается в базу при первом запуске.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models import PriceItem, Template, TemplateField

FIELD_TYPES = ("select", "number", "bool", "text")
PRICING_ROLES = (
    "none", "per_unit", "step_per_unit", "per_sqm", "per_m", "per_length",
    "per_order", "multiplier", "width", "height", "length",
)


def _price_options(db: Session, group_key: str) -> list[str]:
    """Варианты для поля — ключи активных позиций раздела прайса."""
    if not group_key:
        return []
    rows = db.scalars(
        select(PriceItem)
        .where(PriceItem.group_key == group_key, PriceItem.active.is_(True))
        .order_by(PriceItem.sort_order, PriceItem.item_key)
    ).all()
    return [r.item_key for r in rows]


def field_to_dict(db: Session, field: TemplateField) -> dict:
    """Описание поля для формы заказа и расчёта."""
    if field.source == "price":
        options = _price_options(db, field.price_group)
    else:
        options = list(field.options or [])

    default = field.default_value
    if field.type == "select":
        # обязательное поле всегда с ответом; необязательное можно оставить пустым
        # («без ламинации», «без обработки края»)
        if default not in options:
            default = (options[0] if options else "") if field.required else ""
    elif field.type == "bool":
        default = str(default).lower() in ("1", "true", "да")
    elif field.type == "number":
        try:
            default = float(default) if default else 0
            default = int(default) if float(default).is_integer() else default
        except (TypeError, ValueError):
            default = 0

    return {
        "key": field.key,
        "label": field.label or field.key,
        "type": field.type,
        "options": options,
        "default": default,
        "source": field.source,
        "price_group": field.price_group,
        "price_item": field.price_item,
        "pricing_role": field.pricing_role,
        "unit": field.unit or "мм",
        "source_field": field.source_field or "",
        "required": field.required,
    }


def template_to_dict(db: Session, template: Template) -> dict:
    return {
        "key": template.key,
        "title": template.title,
        "short": template.short or template.title,
        "hint": template.hint,
        "icon": template.icon,
        "quantity_label": template.quantity_label,
        "fields": [field_to_dict(db, f) for f in template.fields],
    }


def all_templates(db: Session, include_hidden: bool = False) -> list[dict]:
    stmt = select(Template).options(selectinload(Template.fields)).order_by(
        Template.sort_order, Template.title
    )
    if not include_hidden:
        stmt = stmt.where(Template.active.is_(True))
    return [template_to_dict(db, t) for t in db.scalars(stmt).all()]


def get_template(db: Session, key: str) -> dict | None:
    template = db.scalar(
        select(Template).options(selectinload(Template.fields)).where(Template.key == key)
    )
    return template_to_dict(db, template) if template else None


def exists(db: Session, key: str) -> bool:
    return db.scalar(select(Template.id).where(Template.key == key)) is not None


def default_params(db: Session, template_key: str) -> dict:
    template = get_template(db, template_key)
    if not template:
        return {}
    return {f["key"]: f.get("default") for f in template["fields"]}


def describe(db: Session, template_key: str, params: dict) -> str:
    """Короткая строка для карточки заказа: «1000×700 мм · Наклейка · Самоклейка»."""
    template = get_template(db, template_key)
    if not template:
        return ""

    params = params or {}
    parts: list[str] = []
    width = height = None
    size_unit = "мм"

    for field in template["fields"]:
        value = params.get(field["key"])
        role = field.get("pricing_role")
        if role == "width":
            width = value
            size_unit = field.get("unit") or "мм"
            continue
        if role == "height":
            height = value
            continue
        if role == "length":
            if value:
                parts.insert(0, f"{value} {field.get('unit') or 'мм'}")
            continue
        if value in (None, "", "Нет", False):
            continue
        if field["type"] == "bool":
            parts.append(field["label"].lower())
        elif field["type"] == "number":
            continue
        else:
            parts.append(str(value))

    if width and height:
        parts.insert(0, f"{width}×{height} {size_unit}")
    return " · ".join(parts[:4])