"""Выгрузка в CSV: заказы за период и справочник клиентов.

Бухгалтерия и любое «посчитай мне за квартал» упираются в это в первый же
месяц. Формат — под Excel по-русски: разделитель `;`, десятичная запятая,
BOM в начале, иначе Excel открывает кириллицу крякозябрами и все колонки
в одной ячейке.

Права: заказы — тем, кто видит метрики; деньги внутри — только с правом на
стоимость. Клиенты — тем, кто видит раздел клиентов.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import CurrentUser, require_perm
from app.models import STATUS_META, Client, Order, OrderStatus
from app.services import catalog
from app.services import clients as clients_logic
from app.services.export import csv_response
from app.services.orders import payment_state

router = APIRouter(prefix="/api/export", tags=["export"])

PAYMENT_TITLES = {
    "paid": "оплачен",
    "partial": "частично",
    "none": "не оплачен",
    "refunded": "возврат",
    "overpaid": "переплата",
    "unset": "цена не указана",
}


def _money(value: float | None) -> str:
    """12500.5 → «12500,5»: Excel по-русски ждёт запятую."""
    if value is None:
        return ""
    text = f"{float(value):.2f}".rstrip("0").rstrip(".")
    return text.replace(".", ",")


def _date(value) -> str:
    if not value:
        return ""
    if isinstance(value, datetime):
        return value.strftime("%d.%m.%Y %H:%M")
    return value.strftime("%d.%m.%Y")


@router.get("/orders.csv")
def orderscsv_response(
    days: int = Query(default=30, ge=0, le=3650, description="0 — за всё время"),
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_perm("metrics.view")),
) -> Response:
    """Заказы, созданные за период. Одна строка — один заказ."""
    stmt = select(Order).order_by(Order.created_at)
    if days:
        stmt = stmt.where(Order.created_at >= datetime.now(timezone.utc) - timedelta(days=days))
    orders = db.scalars(stmt).all()

    templates = {t["key"]: t for t in catalog.all_templates(db, include_hidden=True)}
    money = user.can("orders.price.view")
    contacts = user.can("clients.view")

    head = ["Номер", "Создан", "Статус", "Вид работ", "Название", "Клиент"]
    if contacts:
        head += ["Телефон"]
    head += ["Тираж", "Состав"]
    if money:
        head += ["Стоимость", "Внесено", "Остаток", "Оплата"]
    head += ["Срок", "Выдан", "Принял"]

    rows = [head]
    for o in orders:
        template = templates.get(o.template_key)
        payment, debt = payment_state(o)
        row = [
            o.number,
            _date(o.created_at),
            STATUS_META[OrderStatus(o.status)]["title"],
            template["title"] if template else o.template_key,
            o.title,
            o.client_name,
        ]
        if contacts:
            row.append(o.client_phone)
        row += [str(o.quantity), catalog.describe_template(template, o.params or {})]
        if money:
            row += [_money(o.price), _money(o.prepaid), _money(debt), PAYMENT_TITLES.get(payment, payment)]
        row += [_date(o.due_date), _date(o.completed_at), o.manager]
        rows.append(row)

    return csv_response(rows, "orders.csv")


@router.get("/clients.csv")
def clientscsv_response(
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_perm("clients.list")),
) -> Response:
    """Весь справочник: имя, контакты, сколько заказов и на какую сумму."""
    stats = (
        select(
            Order.client_id.label("cid"),
            func.count(Order.id).label("cnt"),
            func.coalesce(func.sum(clients_logic.COUNTED_PRICE), 0).label("total"),
            func.max(Order.created_at).label("last"),
        )
        .where(Order.client_id.is_not(None))
        .group_by(Order.client_id)
        .subquery()
    )
    rows_db = db.execute(
        select(Client, stats.c.cnt, stats.c.total, stats.c.last)
        .outerjoin(stats, Client.id == stats.c.cid)
        .order_by(func.lower(Client.name))
    ).all()

    contacts = user.can("clients.view")
    money = user.can("finance.totals")

    head = ["Имя"]
    if contacts:
        head += ["Телефон", "Контакт"]
    head += ["Заказов"]
    if money:
        head += ["Сумма заказов"]
    head += ["Последний заказ", "Заметка"]

    rows = [head]
    for client, cnt, total, last in rows_db:
        row = [client.name]
        if contacts:
            row += [client.phone, client.contact]
        row.append(str(cnt or 0))
        if money:
            row.append(_money(total or 0))
        row += [_date(last), client.notes.replace("\r", " ").replace("\n", " ")]
        rows.append(row)

    return csv_response(rows, "clients.csv")
