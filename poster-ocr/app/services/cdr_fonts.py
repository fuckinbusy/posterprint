"""Имена шрифтов, которые нужны макету CorelDRAW, — без libcdr.

Зачем без libcdr. На сервере в мастерской (NAS) разборщика нет, а узнать,
какие шрифты поставить дизайнеру или печатнику, нужно прямо из макета.
Имена лежат в файле открытым текстом (UTF-16), их можно достать чистым
Python из трёх мест — по убыванию надёжности:

* ``font/fontTable.dat`` внутри zip (CorelDRAW 2017+): таблица шрифтов
  документа. Запись — набор символов (4), флаги (4), PANOSE (10), нули, затем
  строки UTF-16 с нулевым концом: семейство, письменность, PostScript-имя,
  версия, начертание. Одно семейство повторяется на каждый набор символов
  (Western, Cyrillic, …) — берём без повторов.
* чанки ``font`` в RIFF ``content/root.dat`` (X4–X6): тело либо сама запись
  (та же раскладка), либо 16-байтовая ссылка в ``content/data/*.dat``
  (индекс файла из dataFileList.dat, размер, смещение).
* чанки ``font`` в RIFF-файле без zip (до X4): id (2), кодировка (2), имя —
  UTF-16 с X2, раньше однобайтовое. Проверено по описанию формата, живого
  файла этих версий под рукой не было.

Сжатые чанки ``cmpr`` (zlib) разворачиваются по возможности. Что не
разобралось — пропускается: лучше неполный список, чем ошибка.

Эталон: libcdr на designs/ЗК-2026-000014.cdr отдал ['Arial'] — здесь то же
плюс MS Gothic (запасной шрифт японского набора в таблице документа).
"""

from __future__ import annotations

import io
import re
import struct
import zipfile
import zlib
from collections.abc import Callable, Iterable
from pathlib import Path

from app.services import fonts_catalog

Resolver = Callable[[bytes], "bytes | None"]

_PRINTABLE = re.compile(r"^[\w .,'&+\-!()]+$", re.UNICODE)


def _utf16_strings(buf: bytes, start: int, limit: int = 6) -> list[str]:
    """Строки UTF-16LE с нулевым концом, начиная с первого ненулевого байта после start."""
    pos = start
    while pos < len(buf) and buf[pos] == 0:
        pos += 1
    out: list[str] = []
    while pos + 1 < len(buf) and len(out) < limit:
        end = pos
        while end + 1 < len(buf) and not (buf[end] == 0 and buf[end + 1] == 0):
            end += 2
        try:
            text = buf[pos:end].decode("utf-16le")
        except UnicodeDecodeError:
            break
        if not text:
            break
        out.append(text)
        pos = end + 2
    return out


def _record_family(body: bytes) -> str:
    # charset(4) + flags(4) + PANOSE(11) + нули → семейство; на живом файле
    # строка начинается с 22-го байта, ищем её с 20-го, пропуская нули
    strings = _utf16_strings(body, 20, limit=1)
    return strings[0].strip() if strings else ""


def _parse_font_table(data: bytes) -> list[str]:
    if len(data) < 12:
        return []
    count = struct.unpack_from("<I", data, 8)[0]
    pos = 12
    names = []
    for _ in range(min(count, 10_000)):
        if pos + 8 > len(data):
            break
        size = struct.unpack_from("<I", data, pos + 4)[0]
        body = data[pos + 8:pos + 8 + size]
        name = _record_family(body)
        if name:
            names.append(name)
        pos += 8 + size
    return names


def _old_font_name(body: bytes) -> str:
    """Чанк font до X4: id(2) + кодировка(2) + имя."""
    if len(body) < 6:
        return ""
    rest = body[4:]
    if len(rest) >= 2 and rest[1] == 0 and rest[0] != 0:
        strings = _utf16_strings(rest, 0, limit=1)
        return strings[0].strip() if strings else ""
    raw = rest.split(b"\x00", 1)[0]
    return raw.decode("cp1251", "replace").strip()


def _walk_riff(buf: bytes, on_font: Callable[[bytes], None], depth: int = 0) -> None:
    pos = 0
    while pos + 8 <= len(buf) and depth < 32:
        cid = buf[pos:pos + 4]
        size = struct.unpack_from("<I", buf, pos + 4)[0]
        body = buf[pos + 8:pos + 8 + size]
        if cid in (b"RIFF", b"LIST"):
            _walk_riff(body[4:], on_font, depth + 1)
        elif cid == b"cmpr":
            inflated = _inflate(body)
            if inflated:
                _walk_riff(inflated, on_font, depth + 1)
        elif cid == b"font":
            on_font(body)
        pos += 8 + size + (size & 1)


def _inflate(body: bytes) -> bytes:
    """cmpr: где-то в начале лежит zlib-поток; берём первый, что разжался."""
    for start in range(0, min(len(body), 64)):
        if body[start] == 0x78 and body[start + 1:start + 2] in (b"\x9c", b"\xda", b"\x01", b"\x5e"):
            try:
                return zlib.decompressobj().decompress(body[start:])
            except zlib.error:
                continue
    return b""


def _from_riff(buf: bytes, resolver: Resolver | None) -> list[str]:
    names: list[str] = []

    def on_font(body: bytes) -> None:
        if resolver is not None and len(body) == 16:
            resolved = resolver(body)
            if resolved:
                name = _record_family(resolved)
                if name:
                    names.append(name)
                return
        if len(body) > 24 and resolver is not None:
            name = _record_family(body)
        else:
            name = _old_font_name(body)
        if name:
            names.append(name)

    _walk_riff(buf, on_font)
    return names


def _zip_resolver(z: zipfile.ZipFile) -> Resolver:
    listing = z.read("content/dataFileList.dat").decode("utf-8", "replace") if "content/dataFileList.dat" in z.namelist() else ""
    files = [line.strip() for line in listing.splitlines() if line.strip()]
    cache: dict[str, bytes] = {}

    def resolve(ref: bytes) -> bytes | None:
        index, size, offset, _ = struct.unpack("<IIII", ref)
        if index >= len(files) or size > 1_000_000:
            return None
        name = "content/data/" + files[index]
        if name not in cache:
            try:
                cache[name] = z.read(name)
            except KeyError:
                return None
        return cache[name][offset:offset + size]

    return resolve


def _from_zip(z: zipfile.ZipFile) -> list[str]:
    names: list[str] = []
    if "font/fontTable.dat" in z.namelist():
        names = _parse_font_table(z.read("font/fontTable.dat"))
    if not names:
        root = next((n for n in z.namelist() if n.endswith("root.dat") or n.endswith("riffdata.cdr")), None)
        if root:
            names = _from_riff(z.read(root)[12:], _zip_resolver(z))
    return names


def _clean(names: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    out = []
    for name in names:
        key = name.casefold()
        if not name or len(name) > 80 or not _PRINTABLE.match(name) or key in seen:
            continue
        seen.add(key)
        out.append(name)
    return out


def families(source: bytes | Path) -> list[str]:
    """Семейства шрифтов макета в порядке появления, без повторов. Не разобралось — []."""
    try:
        if isinstance(source, Path):
            with open(source, "rb") as fh:
                head = fh.read(4)
            if head == b"PK\x03\x04":
                with zipfile.ZipFile(source) as z:
                    return _clean(_from_zip(z))
            data = source.read_bytes()
        else:
            data = source
        if data[:4] == b"PK\x03\x04":
            with zipfile.ZipFile(io.BytesIO(data)) as z:
                return _clean(_from_zip(z))
        if data[:4] == b"RIFF":
            return _clean(_from_riff(data[12:], None))
    except Exception:
        return []
    return []


def classify(names: list[str]) -> list[dict]:
    """Что делать с каждым: system — есть в Windows, google — скачать, unknown — искать."""
    rows: list[dict] = []
    for name in names:
        if fonts_catalog.is_system(name):
            rows.append({"name": name, "status": "system", "google": None})
            continue
        item = fonts_catalog.family(name)
        rows.append({"name": name, "status": "google" if item else "unknown", "google": item})
    return rows
