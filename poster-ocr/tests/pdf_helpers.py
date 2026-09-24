"""PDF для тестов раскладки — собирается тут же, без файлов в репозитории."""

from __future__ import annotations

import io

from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, NameObject, NumberObject, RectangleObject

MM = 72 / 25.4
# чистый чёрный K и составной зелёный — чтобы проверить, что CMYK доехал как был
CMYK_CONTENT = b"0 0 0 1 k 0 0 1000 1000 re f 0.6 0 1 0 k 20 20 100 40 re f"


def make_pdf(pages: list[dict], password: str | None = None) -> bytes:
    """pages: [{"w": мм, "h": мм, "bleed": мм или None (нет TrimBox), "rotate": 0}]"""
    writer = PdfWriter()
    for spec in pages:
        w, h = spec["w"] * MM, spec["h"] * MM
        page = writer.add_blank_page(w, h)
        content = DecodedStreamObject()
        content.set_data(spec.get("content", CMYK_CONTENT))
        page[NameObject("/Contents")] = writer._add_object(content)
        bleed = spec.get("bleed")
        if bleed is not None:
            b = bleed * MM
            page.trimbox = RectangleObject([b, b, w - b, h - b])
            page.bleedbox = RectangleObject([0, 0, w, h])
        if spec.get("rotate"):
            page[NameObject("/Rotate")] = NumberObject(spec["rotate"])
    if password:
        writer.encrypt(password)
    buf = io.BytesIO()
    writer.write(buf)
    return buf.getvalue()
