"""Отчёты для тех, кто закрывает смену. Пока один — касса за период."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app import ledger
from app.database import get_db
from app.models import Payment
from app.security import require_perm

router = APIRouter(prefix="/api/reports", tags=["reports"])


def _parse(value: str, name: str) -> datetime:
    """Момент времени из запроса — в UTC без пояса, как хранит SQLite.

    Границы дня считает клиент: только он знает, в каком часовом поясе
    стоит компьютер за стойкой. Сюда приходят два момента в ISO — начало
    и конец — а не дата.
    """
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(422, f"Неверная дата в параметре {name}") from None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).replace(tzinfo=None)


@router.get("/cash")
def cash_report(
    start: str = Query(alias="from"),
    end: str = Query(alias="to"),
    db: Session = Depends(get_db),
    _: object = Depends(require_perm("finance.totals")),
) -> dict:
    """Все движения денег за период: строки, итоги по способу и по сотруднику.

    Право то же, что у сумм в шапке: кто видит, сколько денег в работе,
    тот сверяет и кассу.
    """
    frm, to = _parse(start, "from"), _parse(end, "to")
    if to <= frm:
        raise HTTPException(422, "Конец периода раньше начала")

    rows = db.scalars(
        select(Payment)
        .options(selectinload(Payment.order))
        .where(Payment.created_at >= frm, Payment.created_at < to)
        .order_by(Payment.created_at.desc())
    ).all()

    entries = [
        {
            "id": row.id,
            "at": (row.created_at if row.created_at.tzinfo else row.created_at.replace(tzinfo=timezone.utc)).isoformat(),
            "order_id": row.order_id,
            "order_number": row.order.number if row.order else "",
            "client_name": row.order.client_name if row.order else "",
            "title": row.order.title if row.order else "",
            "amount": row.amount,
            "method": row.method,
            "author": row.author,
        }
        for row in rows
    ]
    return {"entries": entries, **ledger.summarize(rows), "methods": ledger.METHODS}
