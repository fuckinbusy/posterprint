"""HTTP-ручки справочника клиентов.

Логика — в app/clients.py.

Права:
    clients.view     видеть контакты (телефон, почту)
    clients.search   подсказки при заполнении заказа
    clients.list     отдельный раздел со списком всех клиентов
    clients.history  история заказов клиента
    clients.edit     править карточку
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import catalog, clients as clients_logic
from app.database import get_db
from app.logs import log as applog
from app.models import Client, Order
from app.schemas import ClientOut, ClientUpdate
from app.security import CurrentUser, current_user, require_perm

router = APIRouter(
    prefix="/api/clients",
    tags=["clients"],
    dependencies=[Depends(require_perm("clients.view"))],
)


def to_out(db: Session, client: Client, user: CurrentUser) -> ClientOut:
    data = ClientOut.model_validate(client)
    stats = clients_logic.stats_for(db, client.id)
    data.orders_count = stats["orders_count"]
    data.last_order_at = stats["last_order_at"]
    data.active_count = stats["active_count"]
    # сумма — сводная цифра, отдаём только с правом видеть итоги
    data.total_sum = stats["total_sum"] if user.can("finance.totals") else None
    if not user.can("clients.view"):
        data.phone = ""
        data.contact = ""
    return data


@router.get("")
def list_clients(
    q: str | None = Query(default=None, description="Имя, телефон или контакт"),
    sort: str = Query(default="recent", description="recent | name | orders | sum"),
    limit: int = Query(default=25, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(current_user),
) -> dict:
    """Список клиентов постранично: {items, total, limit, offset}.

    Подсказки при заполнении заказа требуют clients.search, полный список —
    clients.list: сотруднику можно разрешить искать клиента, но не давать
    выгружать всю базу.
    """
    if q:
        if not user.can("clients.search"):
            raise HTTPException(403, "Нет прав на поиск по базе клиентов")
        found, total = clients_logic.search(db, q, limit=limit, offset=offset)
    else:
        if not user.can("clients.list"):
            raise HTTPException(403, "Нет прав на просмотр списка клиентов")
        found, total = clients_logic.browse(db, sort=sort, limit=limit, offset=offset)

    return {
        "items": [to_out(db, c, user) for c in found],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.get("/summary", dependencies=[Depends(require_perm("clients.list"))])
def clients_summary(
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(current_user),
) -> dict:
    """Сводка для шапки раздела: сколько всего клиентов, сколько с заказами."""
    total = db.scalar(select(func.count(Client.id))) or 0
    with_orders = db.scalar(
        select(func.count(func.distinct(Order.client_id))).where(Order.client_id.is_not(None))
    ) or 0
    result: dict = {"total": total, "with_orders": with_orders}
    if user.can("finance.totals"):
        # та же мерка, что и в карточке клиента: без отменённых и возвратов
        result["revenue"] = float(
            db.scalar(select(func.coalesce(func.sum(clients_logic.COUNTED_PRICE), 0))) or 0
        )
    return result


@router.get("/{client_id}", response_model=ClientOut)
def get_client(
    client_id: int,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(current_user),
) -> ClientOut:
    client = db.get(Client, client_id)
    if client is None:
        raise HTTPException(404, "Клиент не найден")
    return to_out(db, client, user)


@router.get("/{client_id}/orders", dependencies=[Depends(require_perm("clients.history"))])
def client_orders(
    client_id: int,
    limit: int = Query(default=10, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(current_user),
) -> dict:
    """История заказов клиента постранично: {items, total, limit, offset}.

    Без страниц у постоянного клиента карточка растянулась бы на сотни строк.
    """
    if db.get(Client, client_id) is None:
        raise HTTPException(404, "Клиент не найден")

    total = db.scalar(
        select(func.count(Order.id)).where(Order.client_id == client_id)
    ) or 0
    orders = db.scalars(
        select(Order)
        .where(Order.client_id == client_id)
        .order_by(Order.created_at.desc())
        .limit(limit)
        .offset(offset)
    ).all()
    items = [
        {
            "id": o.id,
            "number": o.number,
            "title": o.title,
            "status": o.status,
            "price": o.price if user.can("orders.price.view") else None,
            "quantity": o.quantity,
            "template_key": o.template_key,
            "summary": catalog.describe(db, o.template_key, o.params or {}),
            "created_at": o.created_at,
        }
        for o in orders
    ]
    return {"items": items, "total": total, "limit": limit, "offset": offset}


@router.patch("/{client_id}", response_model=ClientOut, dependencies=[Depends(require_perm("clients.edit"))])
def update_client(
    client_id: int,
    payload: ClientUpdate,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(current_user),
) -> ClientOut:
    client = db.get(Client, client_id)
    if client is None:
        raise HTTPException(404, "Клиент не найден")

    changes = payload.model_dump(exclude_unset=True)
    # null в PATCH — «поле не трогали», а не «запиши пустоту»: колонки NOT NULL
    changes = {k: v for k, v in changes.items() if v is not None}
    for field, value in changes.items():
        setattr(client, field, value)

    if "phone" in changes:
        norm = clients_logic.normalize_phone(changes["phone"])
        # телефон уникален: не даём привязать чужой номер к этой карточке
        if norm:
            clash = db.scalar(
                select(Client).where(Client.phone_norm == norm, Client.id != client_id)
            )
            if clash is not None:
                raise HTTPException(409, f"Этот телефон уже у клиента «{clash.name}»")
        client.phone_norm = norm or None

    db.commit()
    db.refresh(client)
    if changes:
        applog.info(
            "Клиент «%s» (#%s): изменено %s · %s",
            client.name, client.id, ", ".join(changes), user.name,
        )
    return to_out(db, client, user)


@router.delete("/{client_id}", status_code=204, dependencies=[Depends(require_perm("clients.edit"))])
def delete_client(
    client_id: int,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(current_user),
) -> None:
    """Удаляет карточку. Заказы остаются — у них просто отвяжется client_id."""
    client = db.get(Client, client_id)
    if client is None:
        raise HTTPException(404, "Клиент не найден")
    applog.warning(
        "Удалена карточка клиента «%s» (#%s, %s) · %s",
        client.name, client.id, client.phone or "без телефона", user.name,
    )
    db.delete(client)
    db.commit()


class MergeIn(BaseModel):
    into: int


@router.post("/{client_id}/merge", response_model=ClientOut,
             dependencies=[Depends(require_perm("clients.edit"))])
def merge_client(
    client_id: int,
    payload: MergeIn,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(current_user),
) -> ClientOut:
    """Вливает карточку client_id в карточку payload.into.

    Дубли заводятся сами — второй номер, опечатка, номер без кода, — и телефон
    уникальным индексом это не ловит: номера-то разные. Заказы переезжают в
    целевую карточку, её пустые поля дополняются, исходная удаляется.
    Снимки имени и телефона в самих заказах не трогаем — это история.
    """
    if client_id == payload.into:
        raise HTTPException(422, "Карточку нельзя объединить с ней самой")
    source = db.get(Client, client_id)
    target = db.get(Client, payload.into)
    if source is None or target is None:
        raise HTTPException(404, "Клиент не найден")

    moved = db.execute(
        Order.__table__.update()
        .where(Order.client_id == source.id)
        .values(client_id=target.id)
    ).rowcount

    # дополняем только пустое: у целевой карточки свои данные главнее
    if not target.phone and source.phone:
        target.phone = source.phone
    if not target.contact and source.contact:
        target.contact = source.contact
    if source.notes:
        target.notes = (target.notes + "\n" if target.notes else "") + source.notes

    applog.warning(
        "Карточки клиентов объединены: «%s» (#%s, %s) → «%s» (#%s), заказов %s · %s",
        source.name, source.id, source.phone or "без телефона",
        target.name, target.id, moved, user.name,
    )
    # телефон исходной освобождается вместе с ней: уникальный индекс
    db.delete(source)
    db.commit()
    db.refresh(target)
    return to_out(db, target, user)
