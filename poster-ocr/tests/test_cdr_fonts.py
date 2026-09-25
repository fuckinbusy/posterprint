"""Имена шрифтов из .cdr без libcdr: fontTable.dat, ссылки в data-файлы, старый RIFF.

Синтетические файлы собираются по той же раскладке, что у настоящих макетов
CorelDRAW 2021/2025 (проверено на designs/*.cdr: запись — набор символов,
флаги, PANOSE, затем строки UTF-16: семейство, письменность, PostScript-имя,
версия, начертание). Настоящий файл, если он есть рядом, тоже проверяется.
"""

from __future__ import annotations

import io
import struct
import zipfile
from pathlib import Path

import pytest
from api_helpers import staff

from app.services import cdr_fonts

DESIGNS = Path(__file__).resolve().parent.parent / "designs"


def _utf16(*strings: str) -> bytes:
    return b"".join(s.encode("utf-16le") + b"\x00\x00" for s in strings)


def _font_body(family: str, script: str = "Cyrillic", ps: str | None = None, style: str = "Regular") -> bytes:
    """Тело записи шрифта как в настоящем файле: charset(4) + flags(4) + PANOSE(11) + 3 нуля + строки."""
    panose = bytes([2, 11, 6, 4, 2, 2, 2, 2, 2, 4, 6])
    return struct.pack("<II", 0xCC, 0x40) + panose + bytes(3) + _utf16(family, script, ps or family.replace(" ", ""), "Version 1.0", style)


def _font_table(*families: str) -> bytes:
    records = b""
    for i, fam in enumerate(families):
        body = _font_body(fam)
        records += struct.pack("<II", i, len(body)) + body
    # как в настоящем файле: 0, размер всего после первых 8 байт, число записей
    return struct.pack("<III", 0, 4 + len(records), len(families)) + records


def _riff(chunks: bytes, kind: bytes = b"CDRG") -> bytes:
    return b"RIFF" + struct.pack("<I", 4 + len(chunks)) + kind + chunks


def _chunk(cid: bytes, body: bytes) -> bytes:
    return cid + struct.pack("<I", len(body)) + body + (b"\x00" if len(body) % 2 else b"")


def _zip_cdr(files: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("mimetype", "application/x-vnd.corel.draw.document+zip")
        for name, data in files.items():
            z.writestr(name, data)
    return buf.getvalue()


def test_fonttable_в_zip():
    cdr = _zip_cdr({"font/fontTable.dat": _font_table("Montserrat", "Arial", "Montserrat", "Lobster"),
                    "content/root.dat": _riff(b"")})
    assert cdr_fonts.families(cdr) == ["Montserrat", "Arial", "Lobster"]   # порядок появления, без повторов


def test_ссылки_в_data_файлы_без_fonttable():
    # чанк font в root.dat — 16 байт: индекс data-файла, размер, смещение, 0
    body = _font_body("Roboto", "Western", "Roboto-Regular")
    data1 = b"\xff" * 100 + body + b"\xff" * 10
    ref = struct.pack("<IIII", 1, len(body), 100, 0)
    root = _riff(_chunk(b"LIST", b"fntt" + _chunk(b"font", ref)))
    cdr = _zip_cdr({"content/root.dat": root, "content/dataFileList.dat": b"Bitmaps.dat\ndata1.dat\npage1.dat",
                    "content/data/data1.dat": data1, "content/data/Bitmaps.dat": b"", "content/data/page1.dat": b""})
    assert cdr_fonts.families(cdr) == ["Roboto"]


def test_старый_riff_без_zip():
    # до X4 файл — сам RIFF; font: id(2) + кодировка(2) + имя UTF-16 (с X2) или 8-битное
    new_style = _chunk(b"font", struct.pack("<HH", 1, 0) + _utf16("Open Sans"))
    old_style = _chunk(b"font", struct.pack("<HH", 2, 0) + b"Tahoma\x00")
    raw = _riff(_chunk(b"LIST", b"fntt" + new_style + old_style), kind=b"CDR9")
    assert cdr_fonts.families(raw) == ["Open Sans", "Tahoma"]


def test_мусор_и_пустота_не_роняют():
    assert cdr_fonts.families(b"not a cdr at all") == []
    assert cdr_fonts.families(_zip_cdr({"content/root.dat": _riff(b"")})) == []


def test_статусы_семейств():
    rows = cdr_fonts.classify(["Arial", "Montserrat", "Шрифт Которого Нет"])
    assert [r["status"] for r in rows] == ["system", "google", "unknown"]
    assert rows[1]["google"]["family"] == "Montserrat" and "700" in rows[1]["google"]["variants"]


@pytest.mark.skipif(not (DESIGNS / "ЗК-2026-000014.cdr").exists(), reason="настоящего макета рядом нет")
def test_настоящий_макет():
    # эталон — libcdr на том же файле: ['Arial'] (24.09.2026); MS Gothic в таблице
    # тоже есть — запасной шрифт для японского набора, libcdr его не считает
    found = cdr_fonts.families((DESIGNS / "ЗК-2026-000014.cdr").read_bytes())
    assert "Arial" in found


def test_ручка_из_cdr(db, client):
    _, key = staff(db, "Дизайнер", ["tools.fonts"])
    cdr = _zip_cdr({"font/fontTable.dat": _font_table("Arial", "Montserrat"), "content/root.dat": _riff(b"")})
    reply = client.post("/api/tools/fonts/from-cdr", headers={"X-API-Key": key},
                        files={"file": ("макет.cdr", cdr, "application/octet-stream")})
    assert reply.status_code == 200, reply.text
    data = reply.json()
    assert [f["name"] for f in data["fonts"]] == ["Arial", "Montserrat"]
    assert data["fonts"][0]["status"] == "system" and data["fonts"][1]["status"] == "google"
    empty = client.post("/api/tools/fonts/from-cdr", headers={"X-API-Key": key},
                        files={"file": ("кривые.cdr", _zip_cdr({"content/root.dat": _riff(b"")}), "application/octet-stream")})
    assert empty.status_code == 200 and empty.json()["fonts"] == [] and "кривые" in empty.json()["note"]
    wrong = client.post("/api/tools/fonts/from-cdr", headers={"X-API-Key": key},
                        files={"file": ("a.pdf", b"%PDF", "application/pdf")})
    assert wrong.status_code == 422
