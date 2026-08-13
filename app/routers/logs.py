"""Просмотр логов из интерфейса. Только для тех, у кого staff.manage."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from app import logs
from app.security import require_perm

router = APIRouter(
    prefix="/api/logs",
    tags=["logs"],
    dependencies=[Depends(require_perm("staff.manage"))],
)


@router.get("")
def read_logs(
    name: str = Query(default="poster.log", pattern=r"^[\w.\-]+$"),
    lines: int = Query(default=200, ge=10, le=2000),
    only_problems: bool = Query(default=False),
) -> dict:
    """Последние строки лога. Читаются с конца файла, не целиком."""
    rows = logs.tail(name, lines)
    if only_problems:
        rows = [r for r in rows if " ERROR " in r or " WARNING " in r or "ОШИБКА" in r]
    return {"name": name, "lines": rows, "files": logs.files()}