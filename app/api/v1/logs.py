"""Просмотр логов и резервные копии из интерфейса. Только staff.manage."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core import logs
from app.core.database import get_db
from app.core.security import CurrentUser, require_perm
from app.services import backup

applog = logging.getLogger("poster")

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


@router.get("/backups")
def list_backups() -> dict:
    """Какие копии есть, свежие первыми. Из этого же ответа страница понимает,
    давно ли делали последнюю: копия старше суток — повод для красной плашки."""
    items = backup.list_backups()
    return {
        "dir": str(backup.BACKUP_DIR),
        "items": items[:20],
        "total": len(items),
        "last_at": items[0]["created_at"] if items else None,
    }


@router.post("/backup", status_code=201)
def make_backup(
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_perm("staff.manage")),
) -> dict:
    """Копия прямо сейчас — та же, что делает scripts/backup.py.

    Кнопка нужна, потому что скрипт с сервера никто не запускал: копию
    делают тогда, когда о ней вспоминают, а вспоминают в интерфейсе.
    """
    try:
        info = backup.run(db=db)
    except OSError as exc:
        raise HTTPException(500, f"Не удалось записать копию: {exc}") from None
    applog.info("Резервная копия %s · %s", info["name"], user.name)
    return info

