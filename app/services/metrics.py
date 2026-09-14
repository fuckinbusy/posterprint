"""Аналитика мастерской: что заработали, кто принёс, где висят деньги.

Всё считается от заказов и журнала кассы за период [since, until). Деньги —
по факту: выручка периода это внесённое по заказам, выданным за период;
касса периода — движения денег по датам платежей (они точнее: предоплата,
внесённая в прошлом месяце, в кассе прошлого месяца и останется).

Чистые функции (без базы) вынесены отдельно, чтобы их проверяли тесты:
сравнение периодов, новые и повторные клиенты, сроки, должники.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Any

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.models import Client, Order, OrderStatus, Payment
from app.services import catalog, ledger

ACTIVE = {OrderStatus.new.value, OrderStatus.confirmed.value, OrderStatus.in_work.value, OrderStatus.ready.value}

# подпись периода в шапке отчёта: «месяц» путался с календарным, который
# теперь выбирается отдельно, поэтому — честные «последние N дней»
PERIODS = {
    7: "последние 7 дней",
    30: "последние 30 дней",
    90: "последние 90 дней",
    365: "последние 365 дней",
    0: "всё время",
}

WEEKDAYS = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"]

# заказ в работе, который никто не трогал столько дней, — повод спросить, что с ним
STALE_DAYS = 7
# сколько должников и зависших заказов показывать: список для обзвона, а не реестр
TOP_ROWS = 15


def _aware(dt: datetime) -> datetime:
    """SQLite отдаёт время без часового пояса — приводим к UTC."""
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _aware_or_none(dt: datetime | None) -> datetime | None:
    return None if dt is None else _aware(dt)


def _local(dt: datetime, tz: int) -> datetime:
    """Момент в местном времени мастерской: tz — смещение от UTC в минутах,
    его присылает браузер. Без этого день на графике и «выдан в срок»
    считались бы по Гринвичу: заказ, выданный в 23:30 по Москве, уезжал бы
    на следующий день, а выданный 1-го числа в 01:00 — в прошлый месяц."""
    return _aware(dt) + timedelta(minutes=tz)


# ---------------------------------------------------------------- деньги по заказу
def received(order: Order) -> float:
    """Сколько денег по заказу реально получено.

    Выручка считается по кассе, а не по прайсу. Заказ можно выдать с
    недоплатой — тогда в выручку идёт только внесённое, а остаток висит
    долгом. Возврат обнуляет: деньги ушли обратно клиенту.
    """
    if order.refunded:
        return 0.0
    return float(order.prepaid or 0)


def unpaid(order: Order) -> float:
    """Сколько по заказу не доплатили. Возврат долгом не считается."""
    if order.refunded:
        return 0.0
    return max(float(order.price or 0) - float(order.prepaid or 0), 0.0)


def extras_sum(order: Order) -> float:
    """Сколько в цене заказа занимают доп. услуги — по снимку ставок в заказе."""
    total = 0.0
    for item in order.extras or []:
        try:
            total += float(item.get("rate") or 0) * float(item.get("qty") or 1)
        except (TypeError, ValueError, AttributeError):
            continue
    return total


# ---------------------------------------------------------------- чистые расчёты
def delta(current: float, previous: float | None) -> float | None:
    """Изменение к прошлому периоду в процентах. Нет базы — нет сравнения."""
    if previous is None or previous == 0:
        return None
    return round((current - previous) / previous * 100, 1)


def on_time_stats(done: list[Order], tz: int = 0) -> dict:
    """Сколько выданных уложились в срок. Заказы без срока не считаются —
    их не с чем сравнивать. Срок — дата, поэтому день выдачи берём местный."""
    with_due = [(o.due_date, _local(o.completed_at, tz)) for o in done if o.due_date and o.completed_at]
    hit = sum(1 for due, finished in with_due if finished.date() <= due)
    return {
        "count": hit,
        "total": len(with_due),
        "rate": round(hit / len(with_due) * 100, 1) if with_due else None,
    }


def split_clients(
    created: list[Order], done: list[Order], first_order_at: dict[int, datetime], since: datetime | None
) -> dict:
    """Новые и повторные клиенты периода.

    Новый — тот, чей самый первый заказ оформлен в этом периоде; считается
    по принятым заказам, потому что «пришёл» — это оформил, а не забрал.
    Для мастерской это главная цифра про рекламу. Повторные и деньги — по
    выданным заказам периода: выручка есть только у выданных. Заказы без
    карточки клиента — ни туда, ни сюда.
    """

    def is_new(client_id: int) -> bool:
        first = _aware_or_none(first_order_at.get(client_id))
        return since is None or (first is not None and first >= since)

    new_ids = {o.client_id for o in created if o.client_id and is_new(o.client_id)}
    returning_ids: set[int] = set()
    new_sum = returning_sum = 0.0
    for o in done:
        if not o.client_id:
            continue
        if is_new(o.client_id):
            new_sum += received(o)
        else:
            returning_ids.add(o.client_id)
            returning_sum += received(o)
    total = new_sum + returning_sum
    return {
        "new": len(new_ids),
        "returning": len(returning_ids),
        "new_sum": round(new_sum, 2),
        "returning_sum": round(returning_sum, 2),
        "returning_share": round(returning_sum / total * 100, 1) if total else None,
    }


def debtors(orders: list[Order], today: date, limit: int = TOP_ROWS) -> list[dict]:
    """Кому звонить за деньгами: выданные с недоплатой — в первую очередь,
    потом заказы в работе, по которым срок прошёл, а внесено не всё."""
    rows: list[dict[str, Any]] = []
    for o in orders:
        owed = unpaid(o)
        if owed <= 0:
            continue
        if o.status == OrderStatus.done.value:
            since_day = _aware_or_none(o.completed_at or o.updated_at)
            days = (today - since_day.date()).days if since_day else 0
            kind = "done"
        elif o.status in ACTIVE and o.due_date and o.due_date < today:
            days = (today - o.due_date).days
            kind = "overdue"
        else:
            continue
        rows.append(
            {
                "order_id": o.id,
                "number": o.number,
                "title": o.title,
                "client": (o.client_name or "").strip() or "без клиента",
                "kind": kind,
                "price": round(float(o.price or 0), 2),
                "prepaid": round(float(o.prepaid or 0), 2),
                "debt": round(owed, 2),
                "days": max(days, 0),
            }
        )
    rows.sort(key=lambda r: (r["kind"] != "done", -r["debt"]))
    return rows[:limit]


def stale_orders(active: list[Order], now: datetime, limit: int = TOP_ROWS) -> list[dict]:
    """Заказы в работе, к которым давно не прикасались: не просроченные по
    сроку, а забытые — их не видно ни в одном фильтре доски."""
    rows: list[dict[str, Any]] = []
    for o in active:
        touched = _aware_or_none(o.updated_at or o.created_at)
        if touched is None:
            continue
        idle = (now - touched).days
        if idle >= STALE_DAYS:
            rows.append(
                {
                    "order_id": o.id,
                    "number": o.number,
                    "title": o.title,
                    "client": (o.client_name or "").strip(),
                    "status": o.status,
                    "days": idle,
                    "price": round(float(o.price or 0), 2),
                }
            )
    rows.sort(key=lambda r: -r["days"])
    return rows[:limit]


def cancel_reasons(cancelled: list[Order], limit: int = 6) -> list[dict]:
    """Почему отказываются: причины из карточек, самые частые сверху."""
    counter: dict[str, int] = defaultdict(int)
    for o in cancelled:
        reason = (o.cancel_reason or "").strip()
        counter[reason or "без причины"] += 1
    rows: list[dict[str, Any]] = [{"reason": k, "count": v} for k, v in counter.items()]
    rows.sort(key=lambda r: (-r["count"], r["reason"]))
    return rows[:limit]


def weekday_load(created: list[Order], tz: int = 0) -> list[dict]:
    """В какие дни недели приходят заказы — чтобы понимать, когда нужны руки."""
    counts = [0] * 7
    sums = [0.0] * 7
    for o in created:
        if o.created_at is None:
            continue
        moment = _local(o.created_at, tz)
        counts[moment.weekday()] += 1
        sums[moment.weekday()] += float(o.price or 0)
    return [{"label": WEEKDAYS[i], "count": counts[i], "sum": round(sums[i], 2)} for i in range(7)]


def by_manager(created: list[Order], done: list[Order]) -> list[dict]:
    """Кто сколько принял и выдал. «Принял» — по заказам, созданным за
    период; «получено» — по выданным за период. Это разные множества заказов,
    поэтому и колонки разные."""
    rows: dict[str, dict] = {}

    def row(name: str) -> dict:
        return rows.setdefault(name or "—", {"name": name or "—", "created": 0, "done": 0, "sum": 0.0})

    for o in created:
        row((o.manager or "").strip())["created"] += 1
    for o in done:
        r = row((o.manager or "").strip())
        r["done"] += 1
        r["sum"] += received(o)
    out = list(rows.values())
    for r in out:
        r["sum"] = round(r["sum"], 2)
    out.sort(key=lambda r: (-r["sum"], -r["created"]))
    return out


def series_of(
    done: list[Order], since: datetime | None, until: datetime, by_month: bool, tz: int = 0
) -> list[dict]:
    """Динамика полученного: по дням для коротких периодов, по месяцам для длинных.
    Дни — местные (см. _local)."""
    buckets: dict[str, dict] = {}

    def bucket(key: str) -> dict:
        return buckets.setdefault(key, {"label": key, "sum": 0.0, "count": 0})

    for o in done:
        raw = o.completed_at or o.updated_at
        if raw is None:
            continue
        moment = _local(raw, tz)
        key = moment.strftime("%Y-%m") if by_month else moment.strftime("%Y-%m-%d")
        b = bucket(key)
        b["sum"] += received(o)
        b["count"] += 1

    if not by_month and since is not None:
        # добиваем пустые дни нулями, чтобы график не «сжимался»; оба края
        # включительно — период «30 дней» задевает 31 календарный день
        day = _local(since, tz).date()
        last = _local(until - timedelta(seconds=1), tz).date()
        while day <= last:
            bucket(day.strftime("%Y-%m-%d"))
            day += timedelta(days=1)

    out = sorted(buckets.values(), key=lambda b: b["label"])
    for b in out:
        b["sum"] = round(b["sum"], 2)
    return out


# ---------------------------------------------------------------- выборки
def _orders_touching(db: Session, since: datetime | None, until: datetime) -> list[Order]:
    """Заказы, которые нужны отчёту: в работе (всегда), всё, что происходило
    за период — создали, выдали, отменили, правили, — и выданные с недоплатой
    за всё время: долг висит независимо от того, когда заказ выдали.
    Не вся история."""
    stmt = select(Order)
    if since is not None:
        stmt = stmt.where(
            or_(
                Order.status.in_(ACTIVE),
                Order.completed_at >= since,
                Order.updated_at >= since,
                Order.created_at >= since,
                and_(
                    Order.status == OrderStatus.done.value,
                    Order.refunded.is_(False),
                    Order.prepaid < Order.price,
                ),
            )
        )
    return list(db.scalars(stmt).all())


def _first_orders(db: Session, client_ids: set[int]) -> dict[int, datetime]:
    if not client_ids:
        return {}
    rows = db.execute(
        select(Order.client_id, func.min(Order.created_at))
        .where(Order.client_id.in_(client_ids))
        .group_by(Order.client_id)
    ).all()
    return {cid: first for cid, first in rows if first is not None}


def _client_names(db: Session, client_ids: set[int]) -> dict[int, str]:
    if not client_ids:
        return {}
    rows = db.execute(select(Client.id, Client.name).where(Client.id.in_(client_ids))).all()
    return {cid: (name or "").strip() for cid, name in rows}


def _cash(db: Session, since: datetime | None, until: datetime) -> dict:
    """Касса за период из журнала движений — по датам платежей."""
    stmt = select(Payment).where(Payment.created_at < until.replace(tzinfo=None))
    if since is not None:
        stmt = stmt.where(Payment.created_at >= since.replace(tzinfo=None))
    rows = db.scalars(stmt).all()
    summary = ledger.summarize(rows)
    return {
        "by_method": summary["by_method"],
        "by_author": summary["by_author"],
        "total_in": summary["total_in"],
        "total_out": summary["total_out"],
        "total": summary["total"],
        "entries": len(rows),
    }


# ---------------------------------------------------------------- сводка
def summary(db: Session, since: datetime | None, until: datetime) -> dict:
    """Ключевые цифры периода — то, что сравнивается с прошлым периодом."""
    orders = _orders_touching(db, since, until)

    def in_period(dt: datetime | None) -> bool:
        moment = _aware_or_none(dt)
        if moment is None:
            return False
        return (since is None or moment >= since) and moment < until

    done = [o for o in orders if o.status == OrderStatus.done.value and in_period(o.completed_at or o.updated_at)]
    created = [o for o in orders if in_period(o.created_at)]
    cancelled = [o for o in orders if o.status == OrderStatus.cancelled.value and in_period(o.updated_at)]
    revenue = sum(received(o) for o in done)

    first_orders = _first_orders(db, {o.client_id for o in created + done if o.client_id})
    clients = split_clients(created, done, first_orders, since)

    return {
        "orders": orders,
        "done": done,
        "created": created,
        "cancelled": cancelled,
        "revenue": round(revenue, 2),
        "orders_done": len(done),
        "avg_check": round(revenue / len(done), 2) if done else 0,
        "created_count": len(created),
        "cancelled_count": len(cancelled),
        "clients_new": clients["new"],
        "clients": clients,
    }


def build(
    db: Session, since: datetime | None, until: datetime, *, top: int = 50, compare: bool = True, tz: int = 0
) -> dict:
    """Полная сводка за период. compare — считать ли прошлый период той же
    длины; tz — смещение местного времени от UTC в минутах."""
    now = datetime.now(timezone.utc)
    today = date.today()
    current = summary(db, since, until)
    orders, done, created, cancelled = current["orders"], current["done"], current["created"], current["cancelled"]

    previous: dict | None = None
    if compare and since is not None:
        span = until - since
        prev = summary(db, since - span, since)
        previous = {
            "revenue": prev["revenue"],
            "orders_done": prev["orders_done"],
            "avg_check": prev["avg_check"],
            "created_count": prev["created_count"],
            "cancelled_count": prev["cancelled_count"],
            "clients_new": prev["clients_new"],
        }

    # ---- что сейчас в работе
    active = [o for o in orders if o.status in ACTIVE]
    active_sum = sum(o.price or 0 for o in active)
    debt = sum(unpaid(o) for o in active)
    prepaid_held = sum(received(o) for o in active)
    overdue = [o for o in active if o.due_date and o.due_date < today]
    due_today = [o for o in active if o.due_date == today]
    no_price = [o for o in active if not o.price]

    # выдали, но деньги забрали не все — по всем выданным, а не только за период
    all_done = [o for o in orders if o.status == OrderStatus.done.value]
    done_debt = sum(unpaid(o) for o in done)
    done_debt_all = sum(unpaid(o) for o in all_done)

    # ---- разбивка по видам работ, со сроком выполнения
    titles = {t["key"]: t["title"] for t in catalog.all_templates(db, include_hidden=True)}
    by_template: dict[str, dict] = {}
    lead_all: list[float] = []
    for o in done:
        row = by_template.setdefault(
            o.template_key,
            {"key": o.template_key, "title": titles.get(o.template_key, o.template_key), "count": 0, "sum": 0.0, "_lead": []},
        )
        row["count"] += 1
        row["sum"] += received(o)
        if o.completed_at is not None and o.created_at is not None:
            days = (_aware(o.completed_at) - _aware(o.created_at)).total_seconds() / 86400
            row["_lead"].append(days)
            lead_all.append(days)
    template_rows = []
    for row in by_template.values():
        lead = row.pop("_lead")
        row["sum"] = round(row["sum"], 2)
        row["avg_lead_days"] = round(sum(lead) / len(lead), 1) if lead else None
        row["share"] = round(row["sum"] / current["revenue"] * 100, 1) if current["revenue"] else 0
        template_rows.append(row)
    template_rows.sort(key=lambda r: -r["sum"])

    # ---- топ клиентов: по карточке, а не по строке имени (см. историю в TODO)
    client_names = _client_names(db, {o.client_id for o in done if o.client_id})
    clients: dict[object, dict] = {}
    for o in done:
        key = o.client_id or "—"
        if o.client_id:
            name = client_names.get(o.client_id) or (o.client_name or "").strip() or "без имени"
        else:
            name = "без клиента"
        row = clients.setdefault(key, {"client_id": o.client_id, "name": name, "count": 0, "sum": 0.0})
        row["count"] += 1
        row["sum"] += received(o)
    top_clients = sorted(clients.values(), key=lambda r: -r["sum"])[:top]
    for row in top_clients:
        row["sum"] = round(row["sum"], 2)

    # ---- доп. услуги в выданных
    extras_total = sum(extras_sum(o) for o in done)
    extras_orders = sum(1 for o in done if o.extras)

    by_month = since is None or (until - since).days > 92
    days = (until - since).days if since is not None else 0

    return {
        "period": {
            "days": days,
            "label": PERIODS.get(days, f"{days} дн.") if since is not None else PERIODS[0],
            "since": since.isoformat() if since else None,
            "until": until.isoformat(),
        },
        "revenue": current["revenue"],
        "done_debt": round(done_debt, 2),
        "done_debt_all": round(done_debt_all, 2),
        "orders_done": current["orders_done"],
        "avg_check": current["avg_check"],
        "created_count": current["created_count"],
        "cancelled_count": current["cancelled_count"],
        "cancel_rate": round(len(cancelled) / len(created) * 100, 1) if created else 0,
        "avg_lead_days": round(sum(lead_all) / len(lead_all), 1) if lead_all else None,
        "on_time": on_time_stats(done, tz),
        "active_count": len(active),
        "active_sum": round(active_sum, 2),
        "debt": round(debt, 2),
        "prepaid_held": round(prepaid_held, 2),
        "overdue_count": len(overdue),
        "due_today_count": len(due_today),
        "no_price_count": len(no_price),
        "by_template": template_rows,
        "top_clients": top_clients,
        "clients_total": len(clients),
        "clients": current["clients"],
        "by_manager": by_manager(created, done),
        "cash": _cash(db, since, until),
        "debtors": debtors(orders, today),
        "stale": stale_orders(active, now),
        "stale_days": STALE_DAYS,
        "cancel_reasons": cancel_reasons(cancelled),
        "weekday_load": weekday_load(created, tz),
        "extras_sum": round(extras_total, 2),
        "extras_orders": extras_orders,
        "extras_share": round(extras_total / current["revenue"] * 100, 1) if current["revenue"] else 0,
        "series": series_of(done, since, until, by_month, tz),
        "by_month": by_month,
        "previous": previous,
        "compare": {
            "revenue": delta(current["revenue"], previous["revenue"]) if previous else None,
            "orders_done": delta(current["orders_done"], previous["orders_done"]) if previous else None,
            "avg_check": delta(current["avg_check"], previous["avg_check"]) if previous else None,
            "created_count": delta(current["created_count"], previous["created_count"]) if previous else None,
            "cancelled_count": delta(current["cancelled_count"], previous["cancelled_count"]) if previous else None,
            "clients_new": delta(current["clients_new"], previous["clients_new"]) if previous else None,
        },
    }
