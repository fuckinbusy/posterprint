"""Раскладка PDF под печать: страница-источник на листе, метки реза.

Главное — цвет. Печать идёт только в CMYK, поэтому страница макета не
перерисовывается и не перекодируется: её содержимое целиком становится
Form XObject (так PDF хранит «вставленный рисунок»), и лист вызывает его
столько раз, сколько копий, — каждый раз со своим сдвигом, поворотом и
обрезкой. Операторы цвета, плашки, наложения, шрифты и растры остаются
байт в байт как в файле; растр при этом хранится один раз, сколько бы
копий ни было.

Координаты. Движок раскладки (impose.py) считает в мм от левого верхнего
угла листа; PDF — в пунктах от левого нижнего. Рамка обрезного формата
приходит в собственных координатах страницы PDF (так их показывает pdf.js
в браузере), а /Rotate страницы учитывается при установке копии: на листе
она стоит так, как её видели на экране.

Опора на pypdf: PdfWriter._add_object — внутренний метод, публичного
способа добавить свой поток в pypdf 6 нет. Версия прибита в requirements.txt.
"""

from __future__ import annotations

import io
from dataclasses import dataclass

from pypdf import PdfReader, PdfWriter
from pypdf.errors import PdfReadError
from pypdf.generic import ArrayObject, DecodedStreamObject, DictionaryObject, FloatObject, NameObject

from app.services.impose import ImposeError, Job, Layout, Placement, impose

MM = 72 / 25.4
MAX_PAGES_INFO = 200
MARK_WIDTH_PT = 0.25


class PdfError(ValueError):
    """PDF не годится для раскладки — с понятной причиной."""


@dataclass(frozen=True)
class SheetRequest:
    page: int
    back_page: int | None
    flip: str
    trim: tuple[float, float, float, float]
    bleed: float
    sheet_w: float
    sheet_h: float
    margin: float
    gap: float
    rotate: bool
    marks: bool
    mark_offset: float
    mark_length: float


def _open(data: bytes) -> PdfReader:
    if not data.lstrip()[:5].startswith(b"%PDF"):
        raise PdfError("Это не PDF. Выгрузите макет из CorelDRAW в PDF")
    try:
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted and not reader.decrypt(""):
            raise PdfError("PDF защищён паролем — выгрузите его без защиты")
        _ = len(reader.pages)
    except PdfReadError as exc:
        raise PdfError(f"PDF не читается: {exc}") from None
    return reader


def _box(value) -> list[float] | None:
    return [round(float(v), 3) for v in value] if value is not None else None


def pdf_info(data: bytes) -> dict:
    """Страницы: рамки (в пунктах PDF), поворот, видимый размер в мм."""
    reader = _open(data)
    pages = []
    for index, page in enumerate(reader.pages[:MAX_PAGES_INFO], start=1):
        rotate = int(page.get("/Rotate", 0) or 0) % 360
        media = _box(page.mediabox) or [0, 0, 0, 0]
        w, h = (media[2] - media[0]) / MM, (media[3] - media[1]) / MM
        if rotate in (90, 270):
            w, h = h, w
        pages.append({
            "index": index,
            "rotate": rotate,
            "media": media,
            "trim": _box(page["/TrimBox"]) if "/TrimBox" in page else None,
            "bleed": _box(page["/BleedBox"]) if "/BleedBox" in page else None,
            "width_mm": round(w, 2),
            "height_mm": round(h, 2),
        })
    return {"pages": pages, "total": len(reader.pages)}


def item_size(page_rotate: int, trim: tuple[float, float, float, float]) -> tuple[float, float]:
    """Видимый размер обрезного формата в мм (как на экране)."""
    w = round(abs(trim[2] - trim[0]) / MM, 2)
    h = round(abs(trim[3] - trim[1]) / MM, 2)
    return (h, w) if page_rotate % 180 == 90 else (w, h)


def _matrix(theta: int, trim: tuple[float, float, float, float], x: float, y: float) -> list[float]:
    """cm, который ставит рамку trim страницы-источника (пункты PDF) левым
    нижним углом в точку (x, y) листа, повернув на theta° по часовой."""
    sx, sy = min(trim[0], trim[2]), min(trim[1], trim[3])
    sw, sh = abs(trim[2] - trim[0]), abs(trim[3] - trim[1])
    if theta == 0:
        return [1, 0, 0, 1, x - sx, y - sy]
    if theta == 90:
        return [0, -1, 1, 0, x - sy, y + sx + sw]
    if theta == 180:
        return [-1, 0, 0, -1, x + sx + sw, y + sy + sh]
    return [0, 1, -1, 0, x + sy + sh, y - sx]  # 270


def _form(page, writer: PdfWriter):
    """Страница-источник как Form XObject — её содержимое без изменений."""
    form = DecodedStreamObject()
    contents = page.get_contents()
    form.set_data(contents.get_data() if contents is not None else b"")
    form.update({
        NameObject("/Type"): NameObject("/XObject"),
        NameObject("/Subtype"): NameObject("/Form"),
        NameObject("/BBox"): ArrayObject([FloatObject(v) for v in page.mediabox]),
    })
    if "/Resources" in page:
        form[NameObject("/Resources")] = page["/Resources"].clone(writer)
    if "/Group" in page:  # прозрачность и её цветовое пространство — как у страницы
        form[NameObject("/Group")] = page["/Group"].clone(writer)
    return writer._add_object(form)


def _mirror(p: Placement, flip: str, sheet_w: float, sheet_h: float) -> tuple[float, float, tuple[float, float, float, float]]:
    """Место копии на обороте: лист переворачивают по длинной стороне
    (слева направо) или по короткой (сверху вниз)."""
    left, top, right, bottom = p.clip
    if flip == "short":
        return p.x, sheet_h - p.y - p.h, (left, bottom, right, top)
    return sheet_w - p.x - p.w, p.y, (right, top, left, bottom)


def _back_theta(rotated: bool, flip: str) -> int:
    """Поворот копии на обороте, чтобы её верх лёг к тому же краю листа, что
    у лица. По длинной стороне: прямая — 0°, повёрнутая — 270°; по короткой:
    прямая — 180°, повёрнутая — 90°."""
    if flip == "short":
        return 90 if rotated else 180
    return 270 if rotated else 0


def _sheet_ops(layout: Layout, req: SheetRequest, name: str, trim, page_rotate: int, back: bool) -> bytes:
    ops: list[bytes] = []
    for p in layout.placements:
        if back:
            x, y, clip = _mirror(p, req.flip, req.sheet_w, req.sheet_h)
            theta = (_back_theta(p.rotated, req.flip) + page_rotate) % 360
        else:
            x, y, clip = p.x, p.y, p.clip
            theta = ((90 if p.rotated else 0) + page_rotate) % 360
        # в PDF: левый нижний угол обрезного формата копии
        X, Y = x * MM, (req.sheet_h - y - p.h) * MM
        left, top, right, bottom = clip
        cx, cy = X - left * MM, Y - bottom * MM
        cw, ch = (p.w + left + right) * MM, (p.h + top + bottom) * MM
        cm = " ".join(f"{v:.4f}".rstrip("0").rstrip(".") for v in _matrix(theta, trim, X, Y))
        ops.append(f"q {cx:.4f} {cy:.4f} {cw:.4f} {ch:.4f} re W n {cm} cm /{name} Do Q".encode())
    if req.marks:
        ops.append(f"q {MARK_WIDTH_PT} w 1 1 1 1 K".encode())
        for m in layout.marks:
            x1, x2 = m.x1, m.x2
            if back and req.flip == "long":
                x1, x2 = req.sheet_w - x1, req.sheet_w - x2
            y1, y2 = m.y1, m.y2
            if back and req.flip == "short":
                y1, y2 = req.sheet_h - y1, req.sheet_h - y2
            ops.append(f"{x1 * MM:.4f} {(req.sheet_h - y1) * MM:.4f} m {x2 * MM:.4f} {(req.sheet_h - y2) * MM:.4f} l S".encode())
        ops.append(b"Q")
    return b"\n".join(ops)


def _check_trim(page, trim) -> None:
    x0, y0, x1, y1 = (float(v) for v in page.mediabox)
    lo_x, hi_x = sorted((trim[0], trim[2]))
    lo_y, hi_y = sorted((trim[1], trim[3]))
    if hi_x - lo_x < 1 or hi_y - lo_y < 1:
        raise PdfError("Обрезной формат нулевой — выберите область на странице")
    if lo_x < x0 - 1 or lo_y < y0 - 1 or hi_x > x1 + 1 or hi_y > y1 + 1:
        raise PdfError("Обрезной формат за пределами страницы")


def build(data: bytes, req: SheetRequest) -> tuple[bytes, Layout]:
    """Лист (и оборот, если задан) — готовый PDF и раскладка, по которой он собран."""
    reader = _open(data)
    total = len(reader.pages)
    for number in (req.page, req.back_page):
        if number is not None and not 1 <= number <= total:
            raise PdfError(f"В файле страниц: {total}")
    front = reader.pages[req.page - 1]
    _check_trim(front, req.trim)
    if req.back_page is not None:
        back_box = reader.pages[req.back_page - 1].mediabox
        if abs(float(back_box.width) - float(front.mediabox.width)) > 1 or \
                abs(float(back_box.height) - float(front.mediabox.height)) > 1:
            raise PdfError("Лицо и оборот разного формата — выберите страницы одного размера")
    front_rotate = int(front.get("/Rotate", 0) or 0) % 360
    item_w, item_h = item_size(front_rotate, req.trim)
    job = Job(item_w, item_h, bleed=req.bleed, sheet_w=req.sheet_w, sheet_h=req.sheet_h, margin=req.margin,
              gap=req.gap, rotate=req.rotate, marks=req.marks, mark_offset=req.mark_offset,
              mark_length=req.mark_length)
    try:
        layout = impose(job)
    except ImposeError as exc:
        raise PdfError(str(exc)) from None

    writer = PdfWriter()
    sides = [(front, "P1", False)]
    if req.back_page is not None:
        sides.append((reader.pages[req.back_page - 1], "P2", True))
    for source, name, back in sides:
        sheet = writer.add_blank_page(req.sheet_w * MM, req.sheet_h * MM)
        sheet[NameObject("/Resources")] = DictionaryObject(
            {NameObject("/XObject"): DictionaryObject({NameObject(f"/{name}"): _form(source, writer)})}
        )
        rotate = int(source.get("/Rotate", 0) or 0) % 360
        content = DecodedStreamObject()
        content.set_data(_sheet_ops(layout, req, name, req.trim, rotate, back))
        sheet[NameObject("/Contents")] = writer._add_object(content)
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue(), layout
