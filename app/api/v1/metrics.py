"""Метрики. Все ручки здесь доступны только тем, у кого есть право metrics.view.

Сам расчёт — в app/services/metrics.py; здесь только разбор периода.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import require_perm
from app.services import metrics as metrics_logic

router = APIRouter(prefix="/api", tags=["metrics"], dependencies=[Depends(require_perm("metrics.view"))])

MAX_RANGE_DAYS = 400


def _parse(value: str, name: str) -> datetime:
    """Момент в ISO из запроса → UTC. Границы месяца считает браузер: только
    он знает часовой пояс компьютера за стойкой (как и у кассы за день)."""
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(422, f"Неверная дата в параметре {name}") from None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


@router.get("/metrics")
def metrics(
    days: int = Query(default=30, ge=0, le=3660, description="7, 30, 90, 365 или 0 — за всё время"),
    start: str | None = Query(default=None, alias="from", description="начало периода в ISO — вместо days"),
    end: str | None = Query(default=None, alias="to", description="конец периода в ISO (не включая)"),
    top: int = Query(default=8, ge=1, le=200, description="Сколько клиентов вернуть в топе"),
    tz: int = Query(default=0, ge=-840, le=840, description="Смещение местного времени от UTC, минут"),
    db: Session = Depends(get_db),
) -> dict:
    """Сводка за период. Либо последние `days` дней (0 — всё время), либо
    произвольный отрезок `from`…`to` — так выбирают календарный месяц."""
    now = datetime.now(timezone.utc)
    if start or end:
        if not (start and end):
            raise HTTPException(422, "Нужны оба параметра: from и to")
        frm, until = _parse(start, "from"), _parse(end, "to")
        if until <= frm:
            raise HTTPException(422, "Конец периода раньше начала")
        if (until - frm).days > MAX_RANGE_DAYS:
            raise HTTPException(422, f"Период больше {MAX_RANGE_DAYS} дней — возьмите «всё время»")
        # будущее не считаем: у месяца, который ещё идёт, конец — сейчас
        until = min(until, now)
        result = metrics_logic.build(db, frm, until, top=top, tz=tz)
        result["period"]["label"] = _range_label(frm, until, tz)
        result["period"]["kind"] = "range"
        return result

    since = now - timedelta(days=days) if days > 0 else None
    result = metrics_logic.build(db, since, now, top=top, tz=tz)
    result["period"]["kind"] = "days"
    return result


def _range_label(since: datetime, until: datetime, tz: int) -> str:
    """«01.09.2026 — 30.09.2026» — для шапки отчёта, в местных датах. until не включается."""
    shift = timedelta(minutes=tz)
    last = (until - timedelta(seconds=1) + shift).date()
    first = (since + shift).date()
    if first == last:
        return f"{first:%d.%m.%Y}"
    return f"{first:%d.%m.%Y} — {last:%d.%m.%Y}"
