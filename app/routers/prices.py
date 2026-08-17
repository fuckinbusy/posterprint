"""HTTP-ручки страницы «Прайс»: разделы и позиции.

Разделы и цены живут в базе и настраиваются администратором. Стартовый набор —
в app/seed_catalog.py. Расчёт — в app/pricing.py.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import pricing
from app.database import get_db
from app.logs import log as applog
from app.models import PriceGroup, PriceItem, Template, TemplateField
from app.schemas import PriceItemCreate, PriceItemOut, PriceItemUpdate
from app.routers.templates import slugify
from app.security import CurrentUser, require_perm

router = APIRouter(
    prefix="/api/prices",
    tags=["prices"],
    dependencies=[Depends(require_perm("prices.view"))],
)
# правки прайса требуют отдельного права — просмотр его не даёт
EDIT = Depends(require_perm("prices.edit"))


def _item_out(item: PriceItem, group_unit: str, used_by: list[str] | None = None) -> PriceItemOut:
    """Позиция для ответа. Пустая единица означает «как у раздела» —
    подставляем её здесь, чтобы клиенту не пришлось знать про это правило."""
    data = PriceItemOut.model_validate(item)
    data.unit = item.unit or group_unit
    data.used_by = used_by or []
    return data


def _pinned_fields(db: Session, item: PriceItem) -> list[TemplateField]:
    """Поля видов работ, которые ссылаются на эту позицию поимённо."""
    return list(db.scalars(
        select(TemplateField).where(
            TemplateField.source == "price",
            TemplateField.price_group == item.group_key,
            TemplateField.price_item == item.item_key,
        )
    ).all())


def _titles_of(db: Session, fields: list[TemplateField]) -> list[str]:
    """Названия видов работ, которым принадлежат поля."""
    names: set[str] = set()
    for field in fields:
        template = db.get(Template, field.template_id)
        if template is not None:
            names.add(template.title)
    return sorted(names)


def _pinned_by(db: Session, item: PriceItem) -> list[str]:
    """Виды работ, которые ссылаются на эту позицию поимённо."""
    return _titles_of(db, _pinned_fields(db, item))


def _sort_key(item: PriceItem) -> tuple:
    """Числовые ключи (ступени тиража) сортируем как числа, остальные — по sort_order."""
    if item.item_key.isdigit():
        return (0, int(item.item_key), "")
    return (1, item.sort_order, item.title.lower())


@router.get("")
def list_prices(db: Session = Depends(get_db)) -> dict:
    """Весь прайс по разделам — страница строится по этому ответу."""
    items = db.scalars(select(PriceItem)).all()
    by_group: dict[str, list[PriceItem]] = {}
    for item in items:
        by_group.setdefault(item.group_key, []).append(item)

    groups_db = db.scalars(
        select(PriceGroup).order_by(PriceGroup.sort_order, PriceGroup.title)
    ).all()

    # Какие разделы используются полями видов работ — такие не дадим удалить.
    # Собираем не просто факт, а названия видов работ: администратору нужно
    # знать, что именно править, а не только что «нельзя».
    templates_by_id = {t.id: t.title for t in db.scalars(select(Template)).all()}
    used: dict[str, set[str]] = {}
    # Отдельно — позиции, на которые поле ссылается поимённо (галочка,
    # платное количество). Удаление такой позиции ломает расчёт молча:
    # строка просто исчезает, и заказ считается дешевле.
    pinned: dict[tuple[str, str], set[str]] = {}
    for field in db.scalars(select(TemplateField).where(TemplateField.source == "price")).all():
        if not field.price_group:
            continue
        title = templates_by_id.get(field.template_id)
        if not title:
            continue
        used.setdefault(field.price_group, set()).add(title)
        if field.price_item:
            pinned.setdefault((field.price_group, field.price_item), set()).add(title)

    groups = []
    for group in groups_db:
        rows = sorted(by_group.pop(group.key, []), key=_sort_key)
        groups.append({
            "id": group.id,
            "key": group.key,
            "title": group.title,
            "hint": group.hint,
            "parent_key": group.parent_key,
            "unit": group.unit,
            "kind": group.kind,
            "icon": group.icon,
            "active": group.active,
            "system": group.system,
            "in_use": group.key in used,
            "used_by": sorted(used.get(group.key, ())),
            "items": [
                _item_out(r, group.unit, sorted(pinned.get((r.group_key, r.item_key), ())))
                for r in rows
            ],
        })

    # позиции из разделов, которых нет в справочнике — чтобы не пропали молча
    for group_key, rows in by_group.items():
        groups.append({
            "id": None,
            "key": group_key,
            "title": f"Без раздела: {group_key}",
            "hint": "Раздел удалён, но позиции остались. Их можно перенести или удалить.",
            "parent_key": "",
            "unit": "",
            "kind": "money",
            "icon": "printer",
            "active": True,
            "system": False,
            "in_use": group_key in used,
            "used_by": sorted(used.get(group_key, ())),
            "items": [
                _item_out(r, "", sorted(pinned.get((r.group_key, r.item_key), ())))
                for r in sorted(rows, key=_sort_key)
            ],
        })

    return {"groups": groups}


# ---------------------------------------------------------------- разделы
class GroupIn(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    hint: str = ""
    unit: str = "₽"
    kind: str = "money"
    icon: str = "printer"
    active: bool = True
    # пусто — раздел верхнего уровня
    parent_key: str = Field(default="", max_length=40)


def _check_parent(db: Session, group: PriceGroup | None, parent_key: str) -> str:
    """Проверяет, можно ли вложить раздел в этот родительский.

    Уровня всего два, поэтому правил немного, но каждое из них — про то,
    как дерево могло бы сломаться: раздел внутри себя, три уровня вложенности
    и «родитель, у которого сам есть родитель».
    """
    parent_key = (parent_key or "").strip()
    if not parent_key:
        return ""

    if group is not None and parent_key == group.key:
        raise HTTPException(422, "Раздел не может быть вложен сам в себя")

    parent = db.scalar(select(PriceGroup).where(PriceGroup.key == parent_key))
    if parent is None:
        raise HTTPException(404, "Родительский раздел не найден")
    if parent.parent_key:
        raise HTTPException(
            422,
            f"«{parent.title}» сам вложен в другой раздел. "
            "Уровня всего два: раздел и его подразделы.",
        )

    # у раздела уже есть свои подразделы — вложив его, получим третий уровень
    if group is not None:
        children = db.scalar(
            select(func.count(PriceGroup.id)).where(PriceGroup.parent_key == group.key)
        ) or 0
        if children:
            raise HTTPException(
                422,
                f"У раздела «{group.title}» есть свои подразделы ({children}). "
                "Сначала перенесите их, иначе получится три уровня.",
            )
    return parent_key


@router.post("/groups", status_code=201)
def create_group(
    payload: GroupIn,
    db: Session = Depends(get_db),
    user: CurrentUser = EDIT,
) -> dict:
    key = slugify(payload.title)
    base, n = key, 2
    while db.scalar(select(PriceGroup.id).where(PriceGroup.key == key)):
        key = f"{base}_{n}"
        n += 1

    parent_key = _check_parent(db, None, payload.parent_key)

    last = db.scalar(select(PriceGroup.sort_order).order_by(PriceGroup.sort_order.desc()).limit(1))
    group = PriceGroup(
        key=key,
        title=payload.title.strip(),
        hint=payload.hint.strip(),
        parent_key=parent_key,
        unit=payload.unit.strip() or "₽",
        kind="factor" if payload.kind == "factor" else "money",
        icon=payload.icon,
        active=payload.active,
        sort_order=(last or 0) + 1,
    )
    db.add(group)
    db.commit()
    db.refresh(group)
    applog.info(
        "Прайс: создан раздел «%s» (%s), единица %s · %s",
        group.title, group.key, group.unit, user.name,
    )
    return {"id": group.id, "key": group.key, "title": group.title}


@router.patch("/groups/{group_id}")
def update_group(
    group_id: int,
    payload: GroupIn,
    db: Session = Depends(get_db),
    user: CurrentUser = EDIT,
) -> dict:
    group = db.get(PriceGroup, group_id)
    if group is None:
        raise HTTPException(404, "Раздел не найден")
    was = (group.title, group.unit, group.kind)
    was_parent = group.parent_key
    group.parent_key = _check_parent(db, group, payload.parent_key)
    group.title = payload.title.strip()
    group.hint = payload.hint.strip()
    group.unit = payload.unit.strip() or "₽"
    group.kind = "factor" if payload.kind == "factor" else "money"
    group.icon = payload.icon
    group.active = payload.active
    db.commit()
    if was != (group.title, group.unit, group.kind):
        applog.info(
            "Прайс: раздел «%s» → «%s», единица %s → %s, тип %s → %s · %s",
            was[0], group.title, was[1], group.unit, was[2], group.kind, user.name,
        )
    if was_parent != group.parent_key:
        applog.info(
            "Прайс: раздел «%s» вложенность %s → %s · %s",
            group.title, was_parent or "верхний уровень",
            group.parent_key or "верхний уровень", user.name,
        )
    return {"id": group.id, "key": group.key, "title": group.title}


@router.delete("/groups/{group_id}", status_code=204)
def delete_group(
    group_id: int,
    db: Session = Depends(get_db),
    user: CurrentUser = EDIT,
) -> None:
    """Удаляет раздел вместе с позициями. Нельзя удалить раздел, на который
    ссылаются поля видов работ — сначала поправьте эти поля."""
    group = db.get(PriceGroup, group_id)
    if group is None:
        raise HTTPException(404, "Раздел не найден")

    # подразделы не должны остаться сиротами: сначала их, потом родителя
    children = db.scalars(
        select(PriceGroup).where(PriceGroup.parent_key == group.key)
    ).all()
    if children:
        raise HTTPException(
            409,
            f"В разделе «{group.title}» есть подразделы: "
            + ", ".join(sorted(c.title for c in children))
            + ". Сначала удалите или перенесите их.",
        )

    used = db.scalars(
        select(TemplateField).where(
            TemplateField.source == "price", TemplateField.price_group == group.key
        )
    ).all()
    if used:
        # db.get может вернуть None, если шаблон удалили между запросами —
        # собираем имена через цикл, чтобы не обращаться к атрибуту у пустого
        names: set[str] = set()
        for field in used:
            template = db.get(Template, field.template_id)
            if template is not None:
                names.add(template.title)
        raise HTTPException(
            409,
            "Раздел используется в видах работ: " + ", ".join(sorted(names)),
        )

    items = db.scalars(select(PriceItem).where(PriceItem.group_key == group.key)).all()
    # раздел уносит с собой все позиции — пишем сколько, чтобы потом было
    # понятно, откуда пропали цены
    applog.warning(
        "Прайс: удалён раздел «%s» (%s) вместе с позициями (%s) · %s",
        group.title, group.key, len(items), user.name,
    )
    for item in items:
        db.delete(item)
    db.delete(group)
    db.commit()


@router.post("", response_model=PriceItemOut, status_code=201)
def create_price(
    payload: PriceItemCreate,
    db: Session = Depends(get_db),
    user: CurrentUser = EDIT,
) -> PriceItemOut:
    exists = db.scalar(
        select(PriceItem).where(
            PriceItem.group_key == payload.group_key,
            PriceItem.item_key == payload.item_key.strip(),
        )
    )
    if exists:
        raise HTTPException(409, "Позиция с таким ключом уже есть в этой группе")

    last = db.scalar(
        select(PriceItem.sort_order)
        .where(PriceItem.group_key == payload.group_key)
        .order_by(PriceItem.sort_order.desc())
        .limit(1)
    )
    # единицу не передали — берём у раздела, как было до её переезда на позицию
    group = db.scalar(select(PriceGroup).where(PriceGroup.key == payload.group_key))
    unit = payload.unit.strip() or (group.unit if group else "")

    item = PriceItem(
        group_key=payload.group_key,
        item_key=payload.item_key.strip(),
        title=payload.title.strip() or payload.item_key.strip(),
        value=payload.value,
        unit=unit,
        note=payload.note.strip(),
        sort_order=(last or 0) + 1,
        updated_by=payload.author.strip(),
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    applog.info(
        "Прайс: добавлена позиция «%s» в «%s» = %s %s · %s",
        item.item_key, item.group_key, item.value, item.unit, user.name,
    )
    return _item_out(item, unit)


@router.patch("/{item_id}", response_model=PriceItemOut)
def update_price(
    item_id: int,
    payload: PriceItemUpdate,
    db: Session = Depends(get_db),
    user: CurrentUser = EDIT,
) -> PriceItemOut:
    item = db.get(PriceItem, item_id)
    if item is None:
        raise HTTPException(404, "Позиция не найдена")

    changes = payload.model_dump(exclude_unset=True)
    author = changes.pop("author", "")
    was_value, was_active, was_unit = item.value, item.active, item.unit
    for field, value in changes.items():
        setattr(item, field, value)
    if author:
        item.updated_by = author
    db.commit()
    db.refresh(item)

    # цена — главное, ради чего вообще заводят лог прайса: старое значение
    # из базы уже не достать, а вопрос «почему заказ посчитался иначе»
    # возникает через неделю
    if was_value != item.value:
        applog.info(
            "Прайс: «%s» в «%s» %s → %s · %s",
            item.item_key, item.group_key, was_value, item.value, author or user.name,
        )
    if was_active != item.active:
        applog.info(
            "Прайс: «%s» в «%s» %s · %s",
            item.item_key, item.group_key,
            "включена" if item.active else "отключена", author or user.name,
        )
    if was_unit != item.unit:
        # смена единицы меняет смысл цены, а не только подпись:
        # 30 ₽/шт и 30 ₽/м² — разные деньги
        applog.info(
            "Прайс: «%s» в «%s» единица %s → %s · %s",
            item.item_key, item.group_key, was_unit or "—", item.unit or "—",
            author or user.name,
        )

    group = db.scalar(select(PriceGroup).where(PriceGroup.key == item.group_key))
    return _item_out(item, group.unit if group else "")


class MoveIn(BaseModel):
    group_key: str = Field(min_length=1, max_length=40)


@router.post("/{item_id}/move", response_model=PriceItemOut)
def move_price(
    item_id: int,
    payload: MoveIn,
    db: Session = Depends(get_db),
    user: CurrentUser = EDIT,
) -> PriceItemOut:
    """Переносит позицию в другой раздел.

    Раньше объединить разделы можно было только вручную: завести позицию
    заново, переключить на неё поле вида работ и удалить старую. Забыть
    средний шаг легко, а расплата — тихо пропавшая строка в расчёте.

    Поэтому перенос тянет ссылки за собой: поля, которые ссылались на
    позицию поимённо, переезжают на новый раздел вместе с ней.
    """
    item = db.get(PriceItem, item_id)
    if item is None:
        raise HTTPException(404, "Позиция не найдена")

    target = db.scalar(select(PriceGroup).where(PriceGroup.key == payload.group_key))
    if target is None:
        raise HTTPException(404, "Раздел не найден")

    source_key = item.group_key
    if target.key == source_key:
        return _item_out(item, target.unit, _pinned_by(db, item))

    clash = db.scalar(
        select(PriceItem).where(
            PriceItem.group_key == target.key,
            PriceItem.item_key == item.item_key,
        )
    )
    if clash is not None:
        raise HTTPException(
            409,
            f"В разделе «{target.title}» уже есть позиция «{item.item_key}». "
            "Переименуйте одну из них.",
        )

    # Пустая единица означала «как у раздела». После переезда она молча
    # стала бы означать единицу нового раздела — закрепляем прежнюю явно.
    if not item.unit:
        source = db.scalar(select(PriceGroup).where(PriceGroup.key == source_key))
        item.unit = source.unit if source else ""

    fields = _pinned_fields(db, item)
    followed = _titles_of(db, fields)
    for field in fields:
        field.price_group = target.key

    item.group_key = target.key
    db.commit()
    db.refresh(item)

    applog.info(
        "Прайс: позиция «%s» перенесена из «%s» в «%s»%s · %s",
        item.item_key, source_key, target.key,
        f", за ней переключены виды работ: {', '.join(followed)}" if followed else "",
        user.name,
    )
    return _item_out(item, target.unit, followed)


@router.delete("/{item_id}", status_code=204)
def delete_price(
    item_id: int,
    db: Session = Depends(get_db),
    user: CurrentUser = EDIT,
) -> None:
    item = db.get(PriceItem, item_id)
    if item is None:
        raise HTTPException(404, "Позиция не найдена")

    # На позицию может ссылаться поле вида работ — галочка или счётчик.
    # Удалить её значит сломать расчёт молча: строка просто исчезнет из
    # сметы, и заказ посчитается дешевле. Раздел от такого уже защищён,
    # позиция должна быть защищена так же.
    pinned = _pinned_by(db, item)
    if pinned:
        raise HTTPException(
            409,
            f"Позиция «{item.item_key}» используется в видах работ: "
            + ", ".join(pinned)
            + ". Отключите её «глазом» или сначала поправьте эти поля.",
        )

    applog.warning(
        "Прайс: удалена позиция «%s» из «%s» (была %s) · %s",
        item.item_key, item.group_key, item.value, user.name,
    )
    db.delete(item)
    db.commit()


@router.post("/restore-defaults")
def restore_defaults(db: Session = Depends(get_db), user: CurrentUser = EDIT) -> dict:
    """Возвращает недостающие стандартные позиции. Уже настроенные цены не трогает."""
    added = pricing.seed_defaults(db)
    applog.info("Прайс: восстановлено стандартных позиций: %s · %s", added, user.name)
    return {"added": added}