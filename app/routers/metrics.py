"""Метрики. Все ручки здесь доступны только администратору."""

from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app import catalog
from app.security import require_perm
from app.database import get_db
from app.models import Client, Order, OrderStatus

router = APIRouter(prefix="/api", tags=["metrics"], dependencies=[Depends(require_perm("metrics.view"))])

ACTIVE = {OrderStatus.new.value, OrderStatus.confirmed.value, OrderStatus.in_work.value, OrderStatus.ready.value}

PERIODS = {
    7: "неделя",
    30: "месяц",
    90: "квартал",
    365: "год",
    0: "всё время",
}


def _aware(dt: datetime) -> datetime:
    """SQLite отдаёт время без часового пояса — приводим к UTC."""
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _aware_or_none(dt: datetime | None) -> datetime | None:
    """То же, но допускает пустое значение."""
    return None if dt is None else _aware(dt)


def received(order: Order) -> float:
    """Сколько денег по заказу реально получено.

    Выручка считается по кассе, а не по прайсу. Заказ можно выдать с
    недоплатой — тогда в выручку идёт только внесённое, а остаток висит
    долгом. Возврат обнуляет: деньги ушли обратно клиенту.

    Даты платежей система не хранит, поэтому вся внесённая сумма относится
    к моменту выдачи заказа. Для месячных итогов это точно, для дневного
    графика предоплата, внесённая заранее, сдвигается на день выдачи.
    """
    if order.refunded:
        return 0.0
    return float(order.prepaid or 0)


def held(order: Order) -> float:
    """Сколько денег клиента сейчас у нас. После возврата — ничего."""
    if order.refunded:
        return 0.0
    return float(order.prepaid or 0)


def unpaid(order: Order) -> float:
    """Сколько по заказу не доплатили. Возврат долгом не считается."""
    if order.refunded:
        return 0.0
    return max(float(order.price or 0) - float(order.prepaid or 0), 0.0)


@router.get("/metrics")
def metrics(
    days: int = Query(default=30, description="7, 30, 90, 365 или 0 — за всё время"),
    top: int = Query(default=8, ge=1, le=200, description="Сколько клиентов вернуть в топе"),
    db: Session = Depends(get_db),
) -> dict:
    now = datetime.now(timezone.utc)
    since = now - timedelta(days=days) if days > 0 else None

    # Берём из базы только то, что нужно этому отчёту: заказы в работе (они
    # нужны всегда, независимо от периода) и всё, что происходило за период —
    # создали, выдали, отменили. Раньше здесь был select(Order) без единого
    # условия: вся история грузилась в память на каждое открытие раздела и на
    # каждое переключение периода.
    stmt = select(Order)
    if since is not None:
        stmt = stmt.where(
            or_(
                Order.status.in_(ACTIVE),
                Order.completed_at >= since,
                Order.updated_at >= since,
                Order.created_at >= since,
            )
        )
    orders = db.scalars(stmt).all()

    def in_period(dt: datetime | None) -> bool:
        moment = _aware_or_none(dt)
        if moment is None:
            return False
        return since is None or moment >= since

    # ---- выданные за период: это и есть заработанное
    done = [o for o in orders if o.status == OrderStatus.done.value and in_period(o.completed_at or o.updated_at)]
    revenue = sum(received(o) for o in done)
    # выдали, но деньги забрали не все — этот долг больше нигде не виден:
    # счётчик «ждём доплаты» смотрит только на заказы в работе
    done_debt = sum(unpaid(o) for o in done)

    # ---- что сейчас в работе
    active = [o for o in orders if o.status in ACTIVE]
    active_sum = sum(o.price or 0 for o in active)
    # после возврата внесённого нет: в кассе его не считаем, а долг — вся цена
    debt = sum(max((o.price or 0) - held(o), 0) for o in active)
    prepaid_held = sum(held(o) for o in active)

    today = date.today()
    overdue = [o for o in active if o.due_date and o.due_date < today]
    due_today = [o for o in active if o.due_date == today]
    no_price = [o for o in active if not o.price]

    cancelled = [o for o in orders if o.status == OrderStatus.cancelled.value and in_period(o.updated_at)]
    created = [o for o in orders if in_period(o.created_at)]

    # ---- разбивка по видам работ
    titles = {t["key"]: t["title"] for t in catalog.all_templates(db, include_hidden=True)}
    by_template: dict[str, dict] = {}
    for o in done:
        row = by_template.setdefault(
            o.template_key,
            {"key": o.template_key, "title": titles.get(o.template_key, o.template_key), "count": 0, "sum": 0.0},
        )
        row["count"] += 1
        row["sum"] += received(o)

    # ---- топ клиентов
    #
    # Группируем по карточке клиента, а не по строке имени. Имя в заказе —
    # снимок на момент оформления: «Иванова 2» и «Иванова А. Д.» с одним
    # телефоном давали две строки в отчёте, а два разных «ИП Иванов» —
    # наоборот, сливались в одну. Заказы без карточки (приняли без контактов)
    # считаем одной строкой «без клиента»: складывать их по пустому имени
    # смысла нет.
    client_names = {
        c.id: (c.name or "").strip()
        for c in db.scalars(
            select(Client).where(Client.id.in_({o.client_id for o in done if o.client_id}))
        ).all()
    } if any(o.client_id for o in done) else {}

    clients: dict[object, dict] = {}
    for o in done:
        key = o.client_id or "—"
        if o.client_id:
            name = client_names.get(o.client_id) or (o.client_name or "").strip() or "без имени"
        else:
            name = "без клиента"
        row = clients.setdefault(key, {"name": name, "count": 0, "sum": 0.0})
        row["count"] += 1
        row["sum"] += received(o)

    # ---- динамика: по дням для коротких периодов, по месяцам для длинных
    buckets: dict[str, float] = defaultdict(float)
    by_month = days == 0 or days > 90
    for o in done:
        moment = _aware_or_none(o.completed_at or o.updated_at)
        if moment is None:
            continue
        key = moment.strftime("%Y-%m") if by_month else moment.strftime("%Y-%m-%d")
        buckets[key] += received(o)

    if not by_month and days > 0:
        # добиваем пустые дни нулями, чтобы график не «сжимался»
        for i in range(days):
            buckets.setdefault((now - timedelta(days=i)).strftime("%Y-%m-%d"), 0.0)

    series = [{"label": k, "sum": round(v, 2)} for k, v in sorted(buckets.items())]

    # ---- среднее время от создания до выдачи
    lead_times: list[float] = []
    for o in done:
        if o.completed_at is None or o.created_at is None:
            continue
        span = _aware(o.completed_at) - _aware(o.created_at)
        lead_times.append(span.total_seconds() / 86400)

    return {
        "period": {"days": days, "label": PERIODS.get(days, f"{days} дн."), "since": since.isoformat() if since else None},
        "revenue": round(revenue, 2),
        "done_debt": round(done_debt, 2),
        "orders_done": len(done),
        "avg_check": round(revenue / len(done), 2) if done else 0,
        "created_count": len(created),
        "cancelled_count": len(cancelled),
        "cancel_rate": round(len(cancelled) / len(created) * 100, 1) if created else 0,
        "avg_lead_days": round(sum(lead_times) / len(lead_times), 1) if lead_times else None,
        "active_count": len(active),
        "active_sum": round(active_sum, 2),
        "debt": round(debt, 2),
        "prepaid_held": round(prepaid_held, 2),
        "overdue_count": len(overdue),
        "due_today_count": len(due_today),
        "no_price_count": len(no_price),
        "by_template": sorted(by_template.values(), key=lambda r: -r["sum"]),
        "top_clients": sorted(clients.values(), key=lambda r: -r["sum"])[:top],
        "clients_total": len(clients),
        "series": series,
        "by_month": by_month,
    }