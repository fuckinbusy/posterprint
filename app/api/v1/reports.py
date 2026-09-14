"""Отчёты для тех, кто закрывает смену. Пока один — касса за период.

Право своё, finance.cash: суммы в работе (finance.totals) видят несколько
человек, а ящик вечером сверяет один.
"""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.database import get_db
from app.core.security import require_perm
from app.models import Payment
from app.services import ledger
from app.services.export import csv_response

router = APIRouter(
    prefix="/api/reports",
    tags=["reports"],
    dependencies=[Depends(require_perm("finance.cash"))],
)


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


def _rows(db: Session, start: str, end: str) -> list[Payment]:
    frm, to = _parse(start, "from"), _parse(end, "to")
    if to <= frm:
        raise HTTPException(422, "Конец периода раньше начала")
    return list(
        db.scalars(
            select(Payment)
            .options(selectinload(Payment.order))
            .where(Payment.created_at >= frm, Payment.created_at < to)
            .order_by(Payment.created_at.desc())
        ).all()
    )


def _at(row: Payment) -> datetime:
    return row.created_at if row.created_at.tzinfo else row.created_at.replace(tzinfo=timezone.utc)


@router.get("/cash")
def cash_report(
    start: str = Query(alias="from"),
    end: str = Query(alias="to"),
    db: Session = Depends(get_db),
) -> dict:
    """Все движения денег за период: строки, итоги по способу и по сотруднику."""
    rows = _rows(db, start, end)

    entries = [
        {
            "id": row.id,
            "at": _at(row).isoformat(),
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


@router.get("/cash.csv")
def cashcsv_response(
    start: str = Query(alias="from"),
    end: str = Query(alias="to"),
    db: Session = Depends(get_db),
) -> Response:
    """Те же движения — файлом для Excel. Время — в UTC, как в базе; в самой
    таблице кассы браузер показывает местное."""
    rows = _rows(db, start, end)
    out: list[list[str]] = [
        ["Время (UTC)", "Заказ", "Клиент", "Название", "Сумма", "Способ", "Сотрудник"]
    ]
    for row in reversed(rows):  # в файле — по порядку дня, старые сверху
        out.append(
            [
                _at(row).strftime("%Y-%m-%d %H:%M"),
                row.order.number if row.order else "",
                row.order.client_name if row.order else "",
                row.order.title if row.order else "",
                f"{row.amount:.2f}".replace(".", ","),
                ledger.METHODS.get(row.method, row.method),
                row.author,
            ]
        )
    return csv_response(out, "cash.csv")

