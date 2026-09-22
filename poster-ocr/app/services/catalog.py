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
    "none", "per_unit", "step_per_unit", "step_key", "per_sqm", "per_m", "per_length",
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
    options = _price_options(db, field.price_group) if field.source == "price" else list(field.options or [])

    # тип значения зависит от типа поля: у списка строка, у галочки bool,
    # у числа число — mypy иначе считает всё строкой
    default: str | bool | int | float = field.default_value
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


def tier_variants(keys: list[str], depth: int) -> list[str]:
    """Варианты таблицы тиража из ключей раздела: «Лён:4+4:500» → на глубине 0
    «Лён», на глубине 1 «4+4». Последняя часть ключа — число тиража, она не
    вариант. Порядок — как в прайсе, без повторов."""
    out: list[str] = []
    for key in keys:
        parts = str(key).split(":")
        if len(parts) < depth + 2 or not parts[-1].strip().isdigit():
            continue
        value = parts[depth].strip()
        if value and value not in out:
            out.append(value)
    return out


def apply_tier_options(db: Session, fields: list[dict]) -> None:
    """Поля-таблицы тиража получают варианты из прайса, не из своего списка.

    Поле с ролью step_per_unit: варианты — первая часть ключей раздела
    (бумага, формат, изделие). Если ключи — голые числа, остаётся старое
    поведение: варианты — сами ступени. Поля step_key по порядку берут
    вторую, третью часть. Так вид работ собирается в редакторе: указал
    раздел — варианты появились сами, руками их не набирают."""
    tier = next((f for f in fields if f.get("pricing_role") == "step_per_unit"
                 and f.get("source") == "price"), None)
    keys_cache: dict[str, list[str]] = {}

    def keys_of(group: str) -> list[str]:
        if group not in keys_cache:
            keys_cache[group] = _price_options(db, group)
        return keys_cache[group]

    def set_options(field: dict, options: list[str]) -> None:
        field["options"] = options
        if field.get("default") not in options:
            field["default"] = (options[0] if options else "") if field.get("required") else ""

    if tier is not None:
        variants = tier_variants(keys_of(tier["price_group"]), 0)
        if variants:
            set_options(tier, variants)
    depth = 1
    for field in fields:
        if field.get("pricing_role") != "step_key":
            continue
        group = field.get("price_group") or (tier["price_group"] if tier else "")
        set_options(field, tier_variants(keys_of(group), depth) if group else [])
        depth += 1


def template_to_dict(db: Session, template: Template) -> dict:
    fields = [field_to_dict(db, f) for f in template.fields]
    apply_tier_options(db, fields)
    return {
        "key": template.key,
        "title": template.title,
        "short": template.short or template.title,
        "hint": template.hint,
        "icon": template.icon,
        "quantity_label": template.quantity_label,
        "fields": fields,
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


def defaults_of(template: dict | None) -> dict:
    """Значения полей по умолчанию из уже загруженного шаблона."""
    if not template:
        return {}
    return {f["key"]: f.get("default") for f in template["fields"]}


def default_params(db: Session, template_key: str) -> dict:
    return defaults_of(get_template(db, template_key))


def describe(db: Session, template_key: str, params: dict) -> str:
    """Короткая строка для карточки заказа: «1000×700 мм · Наклейка · Самоклейка»."""
    return describe_template(get_template(db, template_key), params)


def describe_template(template: dict | None, params: dict) -> str:
    """То же, но по уже загруженному шаблону.

    Список заказов зовёт это на каждую карточку; загружать шаблон заново для
    каждой — это отдельный запрос на заказ плюс по запросу на каждое поле
    из прайса. При двухстах заказах на доске выходило больше тысячи запросов
    на одно открытие. Шаблоны читают один раз и раздают сюда.
    """
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
