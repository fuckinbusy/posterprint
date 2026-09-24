"""Сборка листа из PDF: CMYK не трогается, копии там, где сказал движок."""

from __future__ import annotations

import io
import re

import pytest
from pdf_helpers import MM, make_pdf
from pypdf import PdfReader

from app.services import impose_pdf
from app.services.impose import impose
from app.services.impose_pdf import PdfError, SheetRequest

CARD = {"w": 94, "h": 54, "bleed": 2}  # визитка 90×50 с вылетами по 2 мм
TRIM = (2 * MM, 2 * MM, 92 * MM, 52 * MM)


def _req(**kw) -> SheetRequest:
    base = {"page": 1, "back_page": None, "flip": "long", "trim": TRIM, "bleed": 2.0, "sheet_w": 320.0,
            "sheet_h": 450.0, "margin": 5.0, "gap": 0.0, "rotate": True, "marks": True,
            "mark_offset": 2.5, "mark_length": 3.0}
    base.update(kw)
    return SheetRequest(**base)


def _ops(page) -> bytes:
    return page.get_contents().get_data()


def _cms(data: bytes) -> list[list[float]]:
    return [[float(v) for v in m.groups()] for m in re.finditer(rb"([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) cm", data)]


def test_сведения_о_страницах():
    info = impose_pdf.pdf_info(make_pdf([CARD, {"w": 210, "h": 297, "bleed": None, "rotate": 90}]))
    assert info["total"] == 2
    first, second = info["pages"]
    assert first["trim"] == pytest.approx(list(TRIM), abs=0.01)
    assert first["bleed"] is not None
    assert (first["width_mm"], first["height_mm"]) == pytest.approx((94, 54), abs=0.01)
    assert second["trim"] is None and second["rotate"] == 90
    assert (second["width_mm"], second["height_mm"]) == pytest.approx((297, 210), abs=0.01)  # видимые, «лёжа»


def test_cmyk_и_одна_форма_на_все_копии():
    pdf, layout = impose_pdf.build(make_pdf([CARD]), _req())
    reader = PdfReader(io.BytesIO(pdf))
    assert len(reader.pages) == 1
    sheet = reader.pages[0]
    assert (float(sheet.mediabox.width) / MM, float(sheet.mediabox.height) / MM) == pytest.approx((320, 450), abs=0.01)
    xobjects = sheet["/Resources"]["/XObject"]
    assert list(xobjects.keys()) == ["/P1"]             # одна форма, сколько бы ни было копий
    form = xobjects["/P1"].get_object().get_data()
    assert b"0 0 0 1 k" in form and b"0.6 0 1 0 k" in form  # цвета как в исходнике
    assert _ops(sheet).count(b"/P1 Do") == layout.count == 24
    assert b"1 1 1 1 K" in _ops(sheet)                 # метки — цветом «регистрация»


def test_копия_обрезана_по_формату_и_вылетам():
    pdf, layout = impose_pdf.build(make_pdf([CARD]), _req(gap=4))
    sheet = PdfReader(io.BytesIO(pdf)).pages[0]
    clips = [[float(v) for v in m.groups()] for m in re.finditer(rb"([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) re W n", _ops(sheet))]
    assert len(clips) == layout.count
    p = layout.placements[0]
    x, y, w, h = clips[0]
    assert x / MM == pytest.approx(p.x - p.clip[0], abs=0.01)
    assert (450 - (y + h) / MM) == pytest.approx(p.y - p.clip[1], abs=0.01)
    assert w / MM == pytest.approx(p.w + p.clip[0] + p.clip[2], abs=0.01)


def test_повернутая_копия_по_часовой():
    # визитки на SRA3 без меток: часть копий повёрнута
    pdf, layout = impose_pdf.build(make_pdf([CARD]), _req(marks=False))
    cms = _cms(_ops(PdfReader(io.BytesIO(pdf)).pages[0]))
    rotated = [cm for cm, p in zip(cms, layout.placements, strict=True) if p.rotated]
    assert rotated and all(cm[:4] == [0, -1, 1, 0] for cm in rotated)


def test_страница_с_rotate_ставится_прямо():
    # страница «лёжа»: 54×94 в файле, /Rotate 90 — на экране визитка 94×54
    src = make_pdf([{"w": 54, "h": 94, "bleed": 2, "rotate": 90}])
    trim = (2 * MM, 2 * MM, 52 * MM, 92 * MM)
    assert impose_pdf.item_size(90, trim) == (90.0, 50.0)
    pdf, layout = impose_pdf.build(src, _req(trim=trim, marks=True))
    cms = _cms(_ops(PdfReader(io.BytesIO(pdf)).pages[0]))
    plain = [cm for cm, p in zip(cms, layout.placements, strict=True) if not p.rotated]
    assert plain and all(cm[:4] == [0, -1, 1, 0] for cm in plain)  # поворот страницы учтён


def test_без_trimbox_формат_по_странице():
    info = impose_pdf.pdf_info(make_pdf([{"w": 90, "h": 50, "bleed": None}]))
    media = info["pages"][0]["media"]
    _, layout = impose_pdf.build(make_pdf([{"w": 90, "h": 50, "bleed": None}]), _req(trim=tuple(media), bleed=0.0))
    assert layout.count == 24


def test_оборот_зеркально_по_длинной_стороне():
    src = make_pdf([CARD, CARD])
    pdf, layout = impose_pdf.build(src, _req(back_page=2, gap=4))
    reader = PdfReader(io.BytesIO(pdf))
    assert len(reader.pages) == 2
    back = reader.pages[1]
    assert list(back["/Resources"]["/XObject"].keys()) == ["/P2"]
    clips = [[float(v) for v in m.groups()] for m in re.finditer(rb"([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) re W n", _ops(back))]
    p = layout.placements[0]
    assert clips[0][0] / MM == pytest.approx(320 - (p.x + p.w + p.clip[2]), abs=0.01)  # x зеркально


def test_формат_за_пределами_страницы():
    with pytest.raises(PdfError, match="за пределами"):
        impose_pdf.build(make_pdf([CARD]), _req(trim=(0, 0, 500 * MM, 50 * MM)))
    with pytest.raises(PdfError, match="нулевой"):
        impose_pdf.build(make_pdf([CARD]), _req(trim=(10, 10, 10, 50)))


def test_не_pdf_и_зашифрованный():
    with pytest.raises(PdfError, match="не PDF"):
        impose_pdf.pdf_info(b"RIFF\x00\x00CDR")
    with pytest.raises(PdfError, match="паролем"):
        impose_pdf.pdf_info(make_pdf([CARD], password="secret"))


def test_нет_такой_страницы():
    with pytest.raises(PdfError, match="страниц"):
        impose_pdf.build(make_pdf([CARD]), _req(page=3))


def test_раскладка_совпадает_с_движком():
    # PDF-ручка и превью в браузере считают через один движок — числа одни
    _, layout = impose_pdf.build(make_pdf([CARD]), _req())
    assert layout == impose(layout.job)


def test_лицо_и_оборот_разного_формата():
    with pytest.raises(PdfError, match="разного формата"):
        impose_pdf.build(make_pdf([CARD, {"w": 210, "h": 297, "bleed": 2}]), _req(back_page=2))


def test_без_bleedbox_вылеты_по_странице():
    # многие программы пишут только TrimBox, а вылеты — это просто страница
    # больше обрезного формата. По стандарту PDF рамка вылетов тогда — CropBox,
    # а без него — вся страница; «вылетов нет» здесь было бы неправдой
    info = impose_pdf.pdf_info(make_pdf([{"w": 96, "h": 56, "bleed": 3, "bleedbox": False}]))
    page = info["pages"][0]
    assert page["trim"] is not None
    assert page["bleed"] == page["media"]


def test_оборот_на_альбомном_листе_по_длинной_стороне():
    # лист 450×320 лежит длинной стороной горизонтально: перевернуть его по
    # длинной стороне — значит сверху вниз, и оборот зеркалится по вертикали
    def clips(page):
        return [[float(v) for v in m.groups()] for m in re.finditer(rb"([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) re W n", _ops(page))]

    pdf, _ = impose_pdf.build(make_pdf([CARD, CARD]), _req(back_page=2, gap=4, sheet_w=450.0, sheet_h=320.0))
    reader = PdfReader(io.BytesIO(pdf))
    front, back = clips(reader.pages[0]), clips(reader.pages[1])
    sheet_h_pt = 320 * MM
    for f, b in zip(front, back, strict=True):
        assert b[0] == pytest.approx(f[0], abs=0.01)                      # по горизонтали — на месте
        assert b[1] == pytest.approx(sheet_h_pt - f[1] - f[3], abs=0.01)  # по вертикали — зеркально
