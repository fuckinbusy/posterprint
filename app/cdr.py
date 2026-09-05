"""Извлечение превью из файла CorelDRAW (.cdr).

Как это работает
----------------
CorelDRAW сохраняет внутри документа готовую картинку-эскиз. Мы её достаём —
это быстро и не требует ничего, кроме стандартной библиотеки и Pillow.
Полноценный рендер векторного содержимого потребовал бы Inkscape или libcdr,
работал бы секундами на файл и на Windows ставится тяжело.

Форматы контейнера
------------------
* CorelDRAW X4 и новее (версии 14+, включая X6 = версия 16) — zip-архив.
  Внутри данные документа и картинка эскиза. Точное имя различается между
  версиями, поэтому ищем широко: сначала по «говорящим» именам
  (thumbnail, preview), потом любое изображение, и берём самое крупное.
* CorelDRAW X3 и старше — контейнер RIFF, как у WAV и AVI. Идём по чанкам
  и ищем те, что содержат картинку.
* Незнакомая структура — сканируем байты на сигнатуры PNG и JPEG.

Когда превью нет
----------------
CorelDRAW сохраняет эскиз, только если включена соответствующая настройка.
Если её выключили, доставать нечего — вернём None, а интерфейс честно скажет,
что превью недоступно. Это не ошибка и не повод чинить.
"""

from __future__ import annotations

import io
import re
import struct
import zipfile
from pathlib import Path

# Ограничение для картинки, которую отдаём в браузер: эскизы внутри CDR
# небольшие, но встречаются документы с крупными растровыми превью.
MAX_SIDE = 1600

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
JPEG_SIGNATURE = b"\xff\xd8\xff"

# имена, под которыми CorelDRAW обычно кладёт эскиз
THUMB_HINTS = ("thumbnail", "preview", "thumb")
IMAGE_SUFFIXES = (".png", ".jpg", ".jpeg", ".bmp", ".gif", ".tif", ".tiff")


def safe_filename(name: str) -> str:
    """Имя файла без путей и опасных символов — приходит от пользователя."""
    name = Path(name or "").name
    name = re.sub(r"[^\w\s.\-№()]", "_", name, flags=re.UNICODE).strip()
    return name[:120] or "file.cdr"


def _looks_like_image(raw: bytes) -> bool:
    """Проверяем через Pillow: картинка ли это на самом деле."""
    try:
        from PIL import Image

        Image.open(io.BytesIO(raw)).verify()
        return True
    except Exception:  # noqa: BLE001 — любые сбои означают «не картинка»
        return False


# ---------------------------------------------------------------- zip (X4+)
def _from_zip(path: Path) -> tuple[bytes | None, str]:
    try:
        with zipfile.ZipFile(path) as archive:
            candidates: list[tuple[int, str]] = []
            for name in archive.namelist():
                lower = name.lower()
                if lower.endswith("/"):
                    continue
                is_image = lower.endswith(IMAGE_SUFFIXES)
                is_hinted = any(hint in lower for hint in THUMB_HINTS)
                if not (is_image or is_hinted):
                    continue
                size = archive.getinfo(name).file_size
                if size < 200:            # слишком мелкое — не эскиз
                    continue
                # приоритет «говорящим» именам, дальше по размеру
                candidates.append((size + (10_000_000 if is_hinted else 0), name))

            if not candidates:
                return None, "внутри архива нет изображений"

            candidates.sort(reverse=True)
            for _, name in candidates[:5]:
                raw = archive.read(name)
                if _looks_like_image(raw):
                    return raw, f"zip:{name}"
            return None, "изображения в архиве не читаются"
    except zipfile.BadZipFile:
        return None, ""
    except Exception as exc:  # noqa: BLE001 — файл может быть битым
        return None, f"ошибка чтения архива: {exc}"


# ---------------------------------------------------------------- riff (X3-)
def _from_riff(path: Path, max_bytes: int = 64 * 1024 * 1024) -> tuple[bytes | None, str]:
    """Обходит чанки RIFF и ищет тот, что содержит картинку."""
    try:
        data = path.read_bytes()[:max_bytes]
    except OSError as exc:
        return None, f"файл не читается: {exc}"

    if not data.startswith(b"RIFF"):
        return None, ""

    best: tuple[bytes, str] | None = None
    pos = 12  # пропускаем "RIFF", размер и тип формы

    while pos + 8 <= len(data):
        chunk_id = data[pos:pos + 4]
        try:
            size = struct.unpack("<I", data[pos + 4:pos + 8])[0]
        except struct.error:
            break
        if size > len(data):
            break

        if chunk_id == b"LIST":
            pos += 12          # заходим внутрь списка
            continue

        body = data[pos + 8:pos + 8 + size]
        if len(body) > 200 and _looks_like_image(body):
            name = chunk_id.decode("ascii", "replace").strip()
            if best is None or len(body) > len(best[0]):
                best = (body, f"riff:{name}")

        pos += 8 + size + (size & 1)   # чанки выровнены по чётной границе

    if best:
        return best
    return None, "в чанках RIFF нет картинки"


# ---------------------------------------------------------------- сканирование
def _from_raw(path: Path, max_bytes: int = 32 * 1024 * 1024) -> tuple[bytes | None, str]:
    """Последняя попытка: ищем сигнатуры PNG и JPEG прямо в байтах."""
    try:
        data = path.read_bytes()[:max_bytes]
    except OSError:
        return None, "файл не читается"

    start = data.find(PNG_SIGNATURE)
    if start != -1:
        end = data.find(b"IEND", start)
        if end != -1 and _looks_like_image(data[start:end + 8]):
            return data[start:end + 8], "scan:png"

    start = data.find(JPEG_SIGNATURE)
    if start != -1:
        end = data.find(b"\xff\xd9", start)
        if end != -1 and _looks_like_image(data[start:end + 2]):
            return data[start:end + 2], "scan:jpeg"

    return None, "сигнатур картинок не найдено"


# ---------------------------------------------------------------- общее
def normalize(raw: bytes) -> tuple[bytes, int, int] | None:
    """Приводит найденную картинку к PNG разумного размера.

    Возвращает (данные, ширина, высота) или None, если картинка не читается.
    """
    try:
        from PIL import Image

        # аннотация ради mypy: open() отдаёт ImageFile, а convert() — Image
        image: Image.Image = Image.open(io.BytesIO(raw))
        image.load()

        # эскизы CDR бывают в палитре или с альфой — приводим к обычному виду
        if image.mode not in ("RGB", "RGBA"):
            image = image.convert("RGBA" if "A" in image.mode else "RGB")

        if max(image.size) > MAX_SIDE:
            # в новых версиях Pillow фильтры лежат в Image.Resampling
            image.thumbnail((MAX_SIDE, MAX_SIDE), Image.Resampling.LANCZOS)

        out = io.BytesIO()
        image.save(out, "PNG", optimize=True)
        return out.getvalue(), image.width, image.height
    except Exception:  # noqa: BLE001
        return None


def extract_preview(path: Path) -> tuple[bytes | None, str]:
    """Достаёт превью из CDR. Возвращает (PNG или None, откуда взято/почему нет)."""
    if not path.exists():
        return None, "файл не найден"

    for finder in (_from_zip, _from_riff, _from_raw):
        raw, note = finder(path)
        if raw is not None:
            normalized = normalize(raw)
            if normalized is not None:
                return normalized[0], note

    return None, "внутри файла нет эскиза — вероятно, он сохранён без превью"


def inspect(path: Path) -> dict:
    """Что внутри файла — для диагностики, когда превью не находится."""
    if not path.exists():
        return {"error": "файл не найден"}

    info: dict = {"name": path.name, "size": path.stat().st_size}
    with path.open("rb") as fh:
        head = fh.read(16)
    info["head"] = head[:8].hex(" ")

    if head.startswith(b"PK"):
        info["container"] = "zip (CorelDRAW X4 и новее)"
        try:
            with zipfile.ZipFile(path) as archive:
                info["entries"] = [
                    {"name": n, "size": archive.getinfo(n).file_size}
                    for n in archive.namelist()[:60]
                ]
        except Exception as exc:  # noqa: BLE001
            info["error"] = str(exc)
    elif head.startswith(b"RIFF"):
        info["container"] = "riff (CorelDRAW X3 и старше)"
        info["form"] = head[8:12].decode("ascii", "replace")
    else:
        info["container"] = "неизвестный"

    data, note = extract_preview(path)
    info["preview_found"] = data is not None
    info["preview_note"] = note
    if data is not None:
        size = normalize(data)
        if size:
            info["preview_size"] = f"{size[1]}×{size[2]}"
    return info