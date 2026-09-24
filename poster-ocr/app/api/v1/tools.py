"""Инструменты: утилиты, не привязанные к заказу (раздел «Инструменты»).

Файлы сюда приходят на время запроса и не хранятся — см.
app/services/tool_files.py. План и границы — TODO.md, раздел 16.
"""

from __future__ import annotations

import base64
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from starlette.concurrency import run_in_threadpool

from app.core.logs import log as applog
from app.core.security import CurrentUser, require_perm
from app.services import cdr, cdr_scene, tool_files

router = APIRouter(prefix="/api/tools", tags=["tools"])


def _scene(path: Path) -> dict:
    """Как GET /orders/{id}/design/scene, только без кэша: файл сейчас удалят."""
    base: dict = {"available": False, "reason": "", "version": cdr_scene.version(path), "tools": cdr_scene.tools()}
    png, _note = cdr.extract_preview(path)
    base["thumbnail"] = "data:image/png;base64," + base64.b64encode(png).decode("ascii") if png else None
    try:
        scene = cdr_scene.scene(path, cache=None)
    except cdr_scene.SceneError as exc:
        return {**base, "reason": str(exc)}
    return {**base, **scene, "available": True}


@router.post("/design-scene")
async def design_scene(
    file: UploadFile = File(...),
    user: CurrentUser = Depends(require_perm("tools.viewer")),
) -> dict:
    """16.1: содержимое любого .cdr для просмотра. Файл не сохраняется."""
    try:
        with tool_files.temp_dir() as folder:
            path = await tool_files.save_upload(file, folder, (".cdr",))
            size = path.stat().st_size
            with tool_files.slot():
                result = await run_in_threadpool(_scene, path)
    except tool_files.ToolFileError as exc:
        raise HTTPException(422, str(exc)) from None
    applog.info("Инструменты: просмотр макета, %s КБ · %s", size // 1024, user.name)
    return result
