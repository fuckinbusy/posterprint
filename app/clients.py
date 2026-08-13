"""Справочник клиентов.

Здесь только логика — HTTP-ручки в app/routers/clients.py.

Как это работает в связке с заказами:
  * при создании заказа клиент заводится или обновляется автоматически —
    отдельно «добавлять клиента» сотруднику не нужно;
  * поиск в форме заказа ищет по имени и по телефону, найденное подставляется
    в поля, чтобы не набирать всё заново;
  * текстовые поля клиента остаются и в самом заказе — это снимок на момент
    сделки. Если клиент потом сменит телефон, старые заказы не «поедут».
"""

from __future__ import annotations

import re

from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import phones
from app.models import Client, Order


# Правило переехало в app/phones.py: тот же вид номера понадобился платёжным
# ссылкам, а тянуть ради него логику клиентов с моделями и базой незачем.
# Имя здесь оставлено — по нему функцию зовут из роутера.
normalize_phone = phones.normalize_phone


def find_by_phone(db: Session, phone: str | None) -> Client | None:
    norm = normalize_phone(phone)
    if len(norm) < 7:
        return None
    return db.scalar(select(Client).where(Client.phone_norm == norm))


def find_by_name(db: Session, name: str | None) -> Client | None:
    clean = (name or "").strip()
    if not clean:
        return None
    return db.scalar(select(Client).where(func.lower(Client.name) == clean.lower()))


def search(db: Session, query: str, limit: int = 8, offset: int = 0) -> tuple[list[Client], int]:
    """Поиск по имени, телефону или контакту. Возвращает (страница, всего)."""
    clean = (query or "").strip()
    if len(clean) < 2:
        return [], 0

    conditions = [
        func.lower(Client.name).like(f"%{clean.lower()}%"),
        func.lower(Client.contact).like(f"%{clean.lower()}%"),
    ]
    digits = re.sub(r"\D", "", clean)
    if len(digits) >= 3:
        # ищем по хвосту номера — удобно набрать последние цифры
        conditions.append(Client.phone_norm.like(f"%{digits}%"))

    where = or_(*conditions)
    total = db.scalar(select(func.count(Client.id)).where(where)) or 0
    stmt = (
        select(Client).where(where)
        .order_by(Client.updated_at.desc())
        .limit(limit).offset(offset)
    )
    return list(db.scalars(stmt).all()), int(total)


def upsert(
    db: Session,
    *,
    name: str = "",
    phone: str = "",
    contact: str = "",
    client_id: int | None = None,
) -> Client | None:
    """Находит клиента или заводит нового. Возвращает None, если данных нет.

    Приоритет поиска: явный client_id → телефон → точное совпадение имени.
    Пустыми значениями существующие поля не затираем: если в заказе телефон
    не указали, у клиента он останется прежним.
    """
    name = (name or "").strip()
    phone = (phone or "").strip()
    contact = (contact or "").strip()

    if not name and not phone:
        return None

    client: Client | None = None
    if client_id:
        client = db.get(Client, client_id)
    if client is None:
        client = find_by_phone(db, phone)
    if client is None and not phone:
        # без телефона ориентируемся на имя — иначе плодятся дубли «Иван»
        client = find_by_name(db, name)

    if client is None:
        norm = normalize_phone(phone)
        client = Client(
            name=name,
            phone=phone,
            phone_norm=norm or None,   # пустой телефон не должен мешать другим
            contact=contact,
        )
        db.add(client)
        try:
            db.flush()
        except IntegrityError:
            # Гонка: двое оформляют заказ одному и тому же клиенту одновременно.
            # Первый завёл карточку — второй берёт её, а не плодит дубль.
            db.rollback()
            client = db.scalar(select(Client).where(Client.phone_norm == norm))
            if client is None:
                return None
        return client

    if name:
        client.name = name
    if phone:
        client.phone = phone
        client.phone_norm = normalize_phone(phone)
    if contact:
        client.contact = contact
    return client


ACTIVE_STATUSES = ("new", "confirmed", "in_work", "ready")


def stats_for(db: Session, client_id: int) -> dict:
    """Сводка по клиенту: заказов, сумма, когда был последний, сколько в работе."""
    row = db.execute(
        select(
            func.count(Order.id),
            func.coalesce(func.sum(Order.price), 0),
            func.max(Order.created_at),
        ).where(Order.client_id == client_id)
    ).one()
    active = db.scalar(
        select(func.count(Order.id)).where(
            Order.client_id == client_id, Order.status.in_(ACTIVE_STATUSES)
        )
    ) or 0
    return {
        "orders_count": int(row[0]),
        "total_sum": float(row[1]),
        "last_order_at": row[2],
        "active_count": int(active),
    }


def browse(
    db: Session, *, sort: str = "recent", limit: int = 25, offset: int = 0
) -> tuple[list[Client], int]:
    """Список клиентов для раздела. Сортировки понятны по смыслу:
    последние — кто недавно обращался, по заказам и по сумме — самые важные."""
    counts = (
        select(
            Order.client_id.label("cid"),
            func.count(Order.id).label("cnt"),
            func.coalesce(func.sum(Order.price), 0).label("total"),
            func.max(Order.created_at).label("last"),
        )
        .where(Order.client_id.is_not(None))
        .group_by(Order.client_id)
        .subquery()
    )
    stmt = select(Client).outerjoin(counts, Client.id == counts.c.cid)

    if sort == "name":
        stmt = stmt.order_by(func.lower(Client.name))
    elif sort == "orders":
        stmt = stmt.order_by(func.coalesce(counts.c.cnt, 0).desc(), func.lower(Client.name))
    elif sort == "sum":
        stmt = stmt.order_by(func.coalesce(counts.c.total, 0).desc(), func.lower(Client.name))
    else:  # recent — по дате последнего заказа, новые клиенты без заказов сверху
        stmt = stmt.order_by(
            func.coalesce(counts.c.last, Client.created_at).desc()
        )

    total = db.scalar(select(func.count(Client.id))) or 0
    return list(db.scalars(stmt.limit(limit).offset(offset)).all()), int(total)