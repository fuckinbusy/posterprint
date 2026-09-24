"""Файлы инструментов: приняли, поработали, удалили.

Утилиты раздела «Инструменты» не привязаны к заказу и ничего не хранят:
файл пишется во временную папку, ручка с ним работает, папка удаляется при
выходе из `with` — и после ответа, и после ошибки. В `designs/` и в кэш сцен
не попадает ничего.

Разбор и сборка тяжёлые (секунды процессора и сотни мегабайт памяти на
большом макете), поэтому одновременно работают не больше двух файлов;
остальные ждут очереди, а если ждать дольше минуты — получают понятный отказ.
"""

from __future__ import annotations

import tempfile
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from fastapi import UploadFile

from app.services import cdr

MAX_TOOL_BYTES = 100 * 1024 * 1024
WAIT_SECONDS = 60
_slots = threading.BoundedSemaphore(2)


class ToolFileError(ValueError):
    """Файл не принят: не тот тип, слишком большой, сервер занят."""


@contextmanager
def temp_dir() -> Iterator[Path]:
    with tempfile.TemporaryDirectory(prefix="poster-tool-") as name:
        yield Path(name)


@contextmanager
def slot() -> Iterator[None]:
    if not _slots.acquire(timeout=WAIT_SECONDS):
        raise ToolFileError("Сервер занят другими файлами — повторите через минуту")
    try:
        yield
    finally:
        _slots.release()


async def save_upload(file: UploadFile, folder: Path, suffixes: tuple[str, ...]) -> Path:
    """Пишет загрузку кусками на диск, пока не перешагнула предел.

    Имя берётся только ради расширения: сам файл ложится под нейтральным
    именем — так кириллица и пробелы в имени не доходят до внешних утилит."""
    suffix = Path(cdr.safe_filename(file.filename or "")).suffix.lower()
    if suffix not in suffixes:
        raise ToolFileError("Принимаются только файлы " + ", ".join(suffixes))
    target = folder / f"upload{suffix}"
    size = 0
    with open(target, "wb") as out:
        while chunk := await file.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_TOOL_BYTES:
                raise ToolFileError(f"Файл больше {MAX_TOOL_BYTES // 1024 // 1024} МБ")
            out.write(chunk)
    if size == 0:
        raise ToolFileError("Файл пустой")
    return target
