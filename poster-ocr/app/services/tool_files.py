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
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any, TypeVar

from fastapi import UploadFile
from starlette.concurrency import run_in_threadpool

from app.services import cdr

MAX_TOOL_BYTES = 100 * 1024 * 1024
WAIT_SECONDS = 60
_slots = threading.BoundedSemaphore(2)

T = TypeVar("T")


class ToolFileError(ValueError):
    """Файл не принят: не тот тип, слишком большой, сервер занят."""


@contextmanager
def temp_dir() -> Iterator[Path]:
    with tempfile.TemporaryDirectory(prefix="poster-tool-") as name:
        yield Path(name)


def _in_slot(fn: Callable[..., T], *args: Any) -> T:
    if not _slots.acquire(timeout=WAIT_SECONDS):
        raise ToolFileError("Сервер занят другими файлами — повторите через минуту")
    try:
        return fn(*args)
    finally:
        _slots.release()


async def limited(fn: Callable[..., T], *args: Any) -> T:
    """Тяжёлая работа с файлом — в рабочем потоке и в очереди из двух мест.

    Место ждём тоже в рабочем потоке, а не в обработчике запроса: цикл
    событий у сервера один на всех, и если ждать места в нём, встаёт вся
    CRM, а занятые места не могут освободиться — их задачам некуда вернуться."""
    return await run_in_threadpool(_in_slot, fn, *args)


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
