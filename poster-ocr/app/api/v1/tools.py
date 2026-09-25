"""Инструменты: утилиты, не привязанные к заказу (раздел «Инструменты»).

Файлы сюда приходят на время запроса и не хранятся — см.
app/services/tool_files.py. План и границы — TODO.md, раздел 16.
"""

from __future__ import annotations

import base64
from dataclasses import asdict
from pathlib import Path
from typing import Literal
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile
from pydantic import BaseModel, Field, ValidationError
from starlette.concurrency import run_in_threadpool

from app.core.logs import log as applog
from app.core.security import CurrentUser, current_user, require_perm
from app.services import cdr, cdr_scene, fonts_catalog, fonts_download, impose_pdf, rates, tool_files
from app.services import impose as impose_engine

router = APIRouter(prefix="/api/tools", tags=["tools"])


TOOL_PERMISSIONS = ("tools.viewer", "tools.impose", "tools.fonts", "tools.calc")


def tools_user(user: CurrentUser = Depends(current_user)) -> CurrentUser:
    """Вошедший с правом хотя бы на одну утилиту; право на конкретную проверяет её ручка."""
    if user.kind == "guest":
        raise HTTPException(401, "Нужно войти в систему")
    if not any(user.can(key) for key in TOOL_PERMISSIONS):
        raise HTTPException(403, "Недостаточно прав для этого действия")
    return user


@router.get("")
def availability(user: CurrentUser = Depends(tools_user)) -> dict:
    """Какие утилиты работают на этом сервере. Просмотр .cdr требует разборщика
    (libcdr-tools или Inkscape) — на NAS его обычно нет; остальное — чистый Python."""
    scene_tools = cdr_scene.tools()
    viewer = {"available": bool(scene_tools.get("can_view")), "reason": ""}
    if not viewer["available"]:
        viewer["reason"] = "на этом сервере нет разборщика .cdr (libcdr-tools или Inkscape)"
    always = {"available": True, "reason": ""}
    return {"tools": {"viewer": viewer, "impose": dict(always), "fonts": dict(always), "calc": dict(always)}}


@router.get("/fonts")
def fonts_search(
    q: str = "",
    cyrillic: bool = True,
    category: str = "",
    limit: int = 60,
    user: CurrentUser = Depends(require_perm("tools.fonts")),
) -> dict:
    """Поиск по снимку каталога Google Fonts — без интернета, по популярности."""
    limit = max(1, min(limit, 300))
    return {
        "families": fonts_catalog.search(q, cyrillic, category, limit),
        "total": fonts_catalog.count(q, cyrillic, category),
    }


@router.get("/fonts/download")
async def fonts_download_zip(
    family: str,
    styles: str = "400,700",
    user: CurrentUser = Depends(require_perm("tools.fonts")),
) -> Response:
    """Zip с TTF выбранных начертаний, установить.cmd и лицензией. Файлы кэшируются."""
    item = fonts_catalog.family(family)
    if item is None:
        raise HTTPException(404, f"«{family}» нет в каталоге Google Fonts")
    wanted = [s.strip() for s in styles.split(",") if s.strip()]
    try:
        payload = await run_in_threadpool(fonts_download.build_zip, item["family"], wanted)
    except fonts_download.FontsError as exc:
        text = str(exc)
        raise HTTPException(502 if "недоступен" in text or "не отдал" in text else 422, text) from None
    applog.info("Инструменты: шрифт %s (%s) · %s", item["family"], ",".join(wanted), user.name)
    name = f"{item['family']}.zip"
    return Response(
        content=payload,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(name)}"},
    )


@router.get("/rates")
def currency_rates(user: CurrentUser = Depends(require_perm("tools.calc"))) -> dict:
    """Курсы ЦБ за единицу валюты в рублях; без сети — последний сохранённый (stale)."""
    try:
        return rates.get()
    except rates.RatesError as exc:
        raise HTTPException(503, str(exc)) from None


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
            path = await tool_files.save_upload(file, folder, (".cdr",), tool_files.MAX_VIEW_BYTES)
            size = path.stat().st_size
            result = await tool_files.limited(_scene, path)
    except tool_files.ToolFileError as exc:
        raise HTTPException(422, str(exc)) from None
    applog.info("Инструменты: просмотр макета, %s КБ · %s", size // 1024, user.name)
    return result


class LayoutIn(BaseModel):
    """Параметры раскладки в мм — то же, что impose.Job."""

    item_w: float = Field(gt=0, le=5000)
    item_h: float = Field(gt=0, le=5000)
    bleed: float = Field(default=2.0, ge=0, le=20)
    sheet_w: float = Field(default=320.0, gt=0, le=5000)
    sheet_h: float = Field(default=450.0, gt=0, le=5000)
    margin: float = Field(default=5.0, ge=0, le=100)
    gap: float = Field(default=0.0, ge=0, le=100)
    rotate: bool = True
    marks: bool = True
    mark_offset: float = Field(default=2.5, ge=0, le=50)
    mark_length: float = Field(default=3.0, ge=0, le=50)


class SheetIn(BaseModel):
    """Сборка листа из PDF: страница, рамка обрезного формата (пункты PDF), параметры."""

    page: int = Field(default=1, ge=1)
    back_page: int | None = Field(default=None, ge=1)
    flip: Literal["long", "short"] = "long"
    trim: tuple[float, float, float, float]
    bleed: float = Field(default=2.0, ge=0, le=20)
    sheet_w: float = Field(default=320.0, gt=0, le=5000)
    sheet_h: float = Field(default=450.0, gt=0, le=5000)
    margin: float = Field(default=5.0, ge=0, le=100)
    gap: float = Field(default=0.0, ge=0, le=100)
    rotate: bool = True
    marks: bool = True
    mark_offset: float = Field(default=2.5, ge=0, le=50)
    mark_length: float = Field(default=3.0, ge=0, le=50)


def _layout_json(layout: impose_engine.Layout) -> dict:
    return {
        "count": layout.count,
        "sheet_w": layout.job.sheet_w,
        "sheet_h": layout.job.sheet_h,
        "placements": [asdict(p) for p in layout.placements],
        "cuts": [asdict(c) for c in layout.cuts],
        "marks": [asdict(m) for m in layout.marks],
    }


@router.post("/impose/info")
async def impose_info(
    file: UploadFile = File(...),
    user: CurrentUser = Depends(require_perm("tools.impose")),
) -> dict:
    """16.5: страницы PDF — рамки и размеры, чтобы выбрать обрезной формат."""
    try:
        with tool_files.temp_dir() as folder:
            path = await tool_files.save_upload(file, folder, (".pdf",), tool_files.MAX_PDF_BYTES)
            return await tool_files.limited(impose_pdf.pdf_info, path.read_bytes())
    except (tool_files.ToolFileError, impose_pdf.PdfError) as exc:
        raise HTTPException(422, str(exc)) from None


@router.post("/impose/layout")
def impose_layout(
    body: LayoutIn,
    user: CurrentUser = Depends(require_perm("tools.impose")),
) -> dict:
    """16.5: сколько встанет и как — для превью, без файла."""
    try:
        layout = impose_engine.impose(impose_engine.Job(**body.model_dump()))
    except impose_engine.ImposeError as exc:
        raise HTTPException(422, str(exc)) from None
    return _layout_json(layout)


@router.post("/impose/pdf")
async def impose_pdf_sheet(
    file: UploadFile = File(...),
    params: str = Form(...),
    user: CurrentUser = Depends(require_perm("tools.impose")),
) -> Response:
    """16.5: готовый лист PDF для печати. Файл не сохраняется."""
    try:
        sheet = SheetIn.model_validate_json(params)
    except ValidationError as exc:
        raise HTTPException(422, "Параметры раскладки не разобраны: " + exc.errors()[0]["msg"]) from None
    try:
        with tool_files.temp_dir() as folder:
            path = await tool_files.save_upload(file, folder, (".pdf",), tool_files.MAX_PDF_BYTES)
            size = path.stat().st_size
            request = impose_pdf.SheetRequest(**sheet.model_dump())
            pdf, layout = await tool_files.limited(impose_pdf.build, path.read_bytes(), request)
    except (tool_files.ToolFileError, impose_pdf.PdfError) as exc:
        raise HTTPException(422, str(exc)) from None
    stem = cdr.safe_filename(file.filename or "макет").rsplit(".", 1)[0]
    name = f"{stem}-раскладка-{layout.count}шт.pdf"
    applog.info("Инструменты: раскладка %s шт., лист %s×%s, %s КБ · %s",
                layout.count, sheet.sheet_w, sheet.sheet_h, size // 1024, user.name)
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(name)}",
            "X-Impose-Count": str(layout.count),
        },
    )
