"""Виды работ и их поля. Настройка доступна с правом prices.edit.

Логика сборки — в app/catalog.py, расчёт — в app/pricing.py.
"""

from __future__ import annotations

import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app import catalog
from app.database import get_db
from app.logs import log as applog
from app.models import Order, PriceGroup, PriceItem, Template, TemplateField
from app.security import CurrentUser, require_perm

router = APIRouter(
    prefix="/api/templates",
    tags=["templates"],
    dependencies=[Depends(require_perm("prices.view"))],
)
EDIT = Depends(require_perm("prices.edit"))

ICONS = ["printer", "doc", "blade", "roll", "card"]


def slugify(value: str) -> str:
    """«Лазерная резка» → «lazernaya-rezka». Ключ нужен латиницей: он попадает
    в данные заказов и в API."""
    table = {
        "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "e",
        "ж": "zh", "з": "z", "и": "i", "й": "y", "к": "k", "л": "l", "м": "m",
        "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u",
        "ф": "f", "х": "h", "ц": "c", "ч": "ch", "ш": "sh", "щ": "sch",
        "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu", "я": "ya",
    }
    text = "".join(table.get(ch, ch) for ch in (value or "").lower())
    text = re.sub(r"[^a-z0-9]+", "_", text).strip("_")
    return text[:40] or "template"


class FieldIn(BaseModel):
    key: str = Field(min_length=1, max_length=40)
    label: str = ""
    type: str = "select"
    source: str = "price"
    price_group: str = ""
    options: list[str] = []
    default_value: str = ""
    pricing_role: str = "none"
    price_item: str = ""
    unit: str = "мм"
    source_field: str = ""
    required: bool = False


class FieldOut(FieldIn):
    model_config = ConfigDict(from_attributes=True)

    id: int


class TemplateIn(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    short: str = ""
    hint: str = ""
    icon: str = "printer"
    quantity_label: str = "Количество, шт"
    active: bool = True
    fields: list[FieldIn] = []


class TemplateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    key: str
    title: str
    short: str
    hint: str
    icon: str
    quantity_label: str
    active: bool
    sort_order: int
    fields: list[FieldOut] = []
    orders_count: int = 0


def to_out(db: Session, template: Template) -> TemplateOut:
    data = TemplateOut.model_validate(template)
    data.orders_count = db.scalar(
        select(func.count(Order.id)).where(Order.template_key == template.key)
    ) or 0
    return data


def apply_fields(db: Session, template: Template, fields: list[FieldIn]) -> None:
    """Перезаписывает поля шаблона целиком — так проще, чем сверять по одному.

    Ключи полей приходят с клиента и сохраняются как есть: под ними лежат
    значения в уже созданных заказах, менять их при переименовании подписи
    нельзя.
    """
    # Ссылки на прайс проверяем ДО того, как что-то стирать: поле, смотрящее в
    # несуществующий раздел, в форме даёт пустой список, а в расчёте — тихо
    # пропавшую строку. Опечатка в ключе позиции обходилась дороже всего.
    groups = {g.key for g in db.scalars(select(PriceGroup)).all()}
    items = {(i.group_key, i.item_key) for i in db.scalars(select(PriceItem)).all()}
    for item in fields:
        if item.source != "price" or not item.price_group:
            continue
        if item.price_group not in groups:
            raise HTTPException(
                422, f"Поле «{item.label or item.key}» ссылается на раздел прайса "
                     f"«{item.price_group}», которого нет"
            )
        if item.price_item and (item.price_group, item.price_item) not in items:
            raise HTTPException(
                422, f"Поле «{item.label or item.key}» ссылается на позицию "
                     f"«{item.price_item}», которой нет в разделе «{item.price_group}»"
            )

    template.fields.clear()
    db.flush()
    used_keys: set[str] = set()
    for pos, item in enumerate(fields):
        if item.type not in catalog.FIELD_TYPES:
            raise HTTPException(422, f"Неизвестный тип поля: {item.type}")
        if item.pricing_role not in catalog.PRICING_ROLES:
            raise HTTPException(422, f"Неизвестная роль поля: {item.pricing_role}")
        # ключи разводим: одинаковые затирали бы значения друг друга в заказе
        key = slugify(item.key) or f"field_{pos}"
        base, n = key, 2
        while key in used_keys:
            key = f"{base}_{n}"
            n += 1
        used_keys.add(key)

        template.fields.append(
            TemplateField(
                key=key,
                label=item.label.strip() or item.key,
                type=item.type,
                source=item.source if item.source in ("price", "list") else "list",
                price_group=item.price_group,
                options=[o for o in (item.options or []) if str(o).strip()],
                default_value=str(item.default_value or ""),
                pricing_role=item.pricing_role,
                price_item=item.price_item,
                unit=item.unit if item.unit in ("мм", "см", "м") else "мм",
                source_field=item.source_field or "",
                sort_order=pos,
                required=item.required,
            )
        )


@router.get("/meta")
def meta() -> dict:
    """Справочник для конструктора: типы полей, роли, иконки."""
    return {
        "field_types": [
            {"key": "select", "title": "Список", "hint": "Выбор одного варианта"},
            {"key": "number", "title": "Число", "hint": "Размеры, количество"},
            {"key": "bool", "title": "Галочка", "hint": "Да или нет"},
            {"key": "text", "title": "Текст", "hint": "Произвольная строка"},
        ],
        "roles": [
            {"key": "none", "title": "Не влияет на цену",
             "hint": "Просто информация для производства"},
            {"key": "per_unit", "title": "Цена за единицу × количество",
             "hint": "Оттиск, штука изделия"},
            {"key": "step_per_unit", "title": "Цена по ступеням тиража",
             "hint": "От 100 шт одна цена, от 500 — другая"},
            {"key": "per_sqm", "title": "Цена за м² × площадь",
             "hint": "Плёнка, баннер. Нужны поля ширины и высоты"},
            {"key": "per_m", "title": "Цена за пог. м × периметр",
             "hint": "Проклейка, люверсы по краю прямоугольника"},
            {"key": "per_length", "title": "Цена за метр × длина",
             "hint": "Резка по длине, кант. Нужно поле длины, второе измерение не требуется"},
            {"key": "per_order", "title": "Разово за заказ",
             "hint": "Приладка, скрепление"},
            {"key": "multiplier", "title": "Коэффициент",
             "hint": "Умножает всё, что накопилось: например ×1.8"},
            # Единицу в названии не пишем: она у каждого поля своя
            # (template_fields.unit — мм, см или м). Раньше здесь стояло
            # «Ширина, мм», и подпись врала про поля, заведённые в метрах.
            {"key": "width", "title": "Ширина", "hint": "Для площади и периметра"},
            {"key": "height", "title": "Высота", "hint": "Для площади и периметра"},
            {"key": "length", "title": "Длина", "hint": "Для расчёта по длине"},
        ],
        "icons": ICONS,
    }


class PreviewIn(BaseModel):
    quantity: int = 1
    params: dict = {}
    fields: list[FieldIn] = []


@router.post("/preview", dependencies=[EDIT])
def preview(payload: PreviewIn, db: Session = Depends(get_db)) -> dict:
    """Считает пример по несохранённым полям — чтобы администратор видел
    результат прямо в конструкторе, не сохраняя вид работ."""
    from app import pricing

    fields = [
        {
            "key": f.key or f"field_{i}",
            "label": f.label or f.key,
            "type": f.type,
            # source обязателен: по нему расчёт отличает поле-счётчик, у
            # которого цена лежит в прайсе, от поля, где введённое число и
            # есть ставка. Без него люверсы считались по 4 ₽ вместо 30.
            "source": f.source,
            "price_group": f.price_group,
            "price_item": f.price_item,
            "pricing_role": f.pricing_role,
            "unit": f.unit,
            "source_field": f.source_field,
            "default": f.default_value,
        }
        for i, f in enumerate(payload.fields)
    ]
    return pricing.estimate_from_fields(
        pricing.load_rates(db), fields, payload.quantity, payload.params
    )


@router.get("", response_model=list[TemplateOut])
def list_templates(db: Session = Depends(get_db)) -> list[TemplateOut]:
    rows = db.scalars(
        select(Template).options(selectinload(Template.fields)).order_by(
            Template.sort_order, Template.title
        )
    ).all()
    return [to_out(db, t) for t in rows]


@router.post("", response_model=TemplateOut, status_code=201)
def create_template(
    payload: TemplateIn,
    db: Session = Depends(get_db),
    user: CurrentUser = EDIT,
) -> TemplateOut:
    key = slugify(payload.title)
    # ключ должен быть уникальным — при совпадении добавляем номер
    base, n = key, 2
    while db.scalar(select(Template.id).where(Template.key == key)):
        key = f"{base}_{n}"
        n += 1

    last = db.scalar(select(Template.sort_order).order_by(Template.sort_order.desc()).limit(1))
    template = Template(
        key=key,
        title=payload.title.strip(),
        short=payload.short.strip() or payload.title.strip()[:20],
        hint=payload.hint.strip(),
        icon=payload.icon if payload.icon in ICONS else "printer",
        quantity_label=payload.quantity_label.strip() or "Количество, шт",
        active=payload.active,
        sort_order=(last or 0) + 1,
    )
    db.add(template)
    db.flush()
    apply_fields(db, template, payload.fields)
    db.commit()
    db.refresh(template)
    applog.info(
        "Виды работ: создан «%s» (%s), полей %s · %s",
        template.title, template.key, len(template.fields), user.name,
    )
    return to_out(db, template)


@router.patch("/{template_id}", response_model=TemplateOut)
def update_template(
    template_id: int,
    payload: TemplateIn,
    db: Session = Depends(get_db),
    user: CurrentUser = EDIT,
) -> TemplateOut:
    template = db.get(Template, template_id)
    if template is None:
        raise HTTPException(404, "Вид работ не найден")

    was = (template.title, template.active, len(template.fields))
    template.title = payload.title.strip()
    template.short = payload.short.strip() or template.title[:20]
    template.hint = payload.hint.strip()
    template.icon = payload.icon if payload.icon in ICONS else template.icon
    template.quantity_label = payload.quantity_label.strip() or "Количество, шт"
    template.active = payload.active
    apply_fields(db, template, payload.fields)
    db.commit()
    db.refresh(template)
    # поля переписываются целиком, поэтому пишем итог: было столько — стало
    # столько. По этой строке видно, когда у вида работ «пропало» поле
    applog.info(
        "Виды работ: изменён «%s» (%s) · полей %s → %s%s · %s",
        was[0], template.key, was[2], len(template.fields),
        "" if was[1] == template.active else (", показан" if template.active else ", скрыт"),
        user.name,
    )
    return to_out(db, template)


@router.delete("/{template_id}", status_code=204)
def delete_template(
    template_id: int,
    db: Session = Depends(get_db),
    user: CurrentUser = EDIT,
) -> None:
    """Удалить можно только вид работ без заказов — иначе старые заказы
    потеряют описание. Ненужный вид лучше отключить."""
    template = db.get(Template, template_id)
    if template is None:
        raise HTTPException(404, "Вид работ не найден")

    used = db.scalar(select(func.count(Order.id)).where(Order.template_key == template.key)) or 0
    if used:
        raise HTTPException(
            409,
            f"По этому виду работ есть заказы ({used}). Его можно отключить, но не удалить.",
        )
    applog.warning(
        "Виды работ: удалён «%s» (%s) · %s", template.title, template.key, user.name,
    )
    db.delete(template)
    db.commit()