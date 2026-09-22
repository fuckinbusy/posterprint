"""Макеты заказов: хранение файлов и кэш превью.

Где лежат
---------
Папка задаётся в .env через POSTER_DESIGNS_DIR, по умолчанию — `designs/`
рядом с проектом. Когда переедете на сетевую папку сервера, достаточно
поменять переменную.

Файл называется по номеру заказа: `ЗК-2026-000042.cdr`. Так макет можно найти
и без системы — просто открыв папку.

Превью
------
Извлечённая из CDR картинка кладётся в `designs/_previews/` и переиспользуется,
пока сам файл не изменился (сверяем размер и время правки). Разбирать
многомегабайтный CDR на каждое открытие карточки заказа было бы расточительно.
"""

from __future__ import annotations

import contextlib
import shutil
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from app.core.paths import data_dir
from app.services import cdr

# только strip: в пути к сетевой папке пробелы вполне бывают
DESIGNS_DIR = data_dir("POSTER_DESIGNS_DIR", "designs")
# без точки в начале: на Windows скрытая папка только сбивает с толку,
# да и некоторые файловые системы не дают её создать
PREVIEW_DIR = DESIGNS_DIR / "_previews"

# CDR с растровыми вставками легко весит десятки мегабайт
MAX_UPLOAD_BYTES = 300 * 1024 * 1024
ALLOWED_SUFFIXES = (".cdr",)


@dataclass
class DesignInfo:
    """Сведения о макете заказа для интерфейса."""

    exists: bool
    filename: str = ""
    size: int = 0
    uploaded_at: datetime | None = None
    has_preview: bool = False
    preview_note: str = ""

    def as_dict(self) -> dict:
        return {
            "exists": self.exists,
            "filename": self.filename,
            "size": self.size,
            "uploaded_at": self.uploaded_at.isoformat() if self.uploaded_at else None,
            "has_preview": self.has_preview,
            "preview_note": self.preview_note,
        }


def ensure_dirs() -> None:
    DESIGNS_DIR.mkdir(parents=True, exist_ok=True)
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)


def design_path(order_number: str) -> Path:
    """Путь к макету заказа. Имя — номер заказа, расширение .cdr."""
    return DESIGNS_DIR / f"{cdr.safe_filename(order_number)}.cdr"


def _preview_path(order_number: str) -> Path:
    return PREVIEW_DIR / f"{cdr.safe_filename(order_number)}.png"


def _stamp_path(order_number: str) -> Path:
    """Отпечаток исходника: по нему понимаем, не устарело ли превью."""
    return PREVIEW_DIR / f"{cdr.safe_filename(order_number)}.stamp"


def scene_cache_path(order_number: str) -> Path:
    """Разобранное содержимое макета (app/services/cdr_scene.py) — рядом с эскизом."""
    return PREVIEW_DIR / f"{cdr.safe_filename(order_number)}.scene.json.gz"


def _stamp(path: Path) -> str:
    stat = path.stat()
    return f"{stat.st_size}:{int(stat.st_mtime)}"


def info(order_number: str) -> DesignInfo:
    path = design_path(order_number)
    if not path.exists():
        return DesignInfo(exists=False)

    stat = path.stat()
    preview, note = get_preview(order_number)
    return DesignInfo(
        exists=True,
        filename=path.name,
        size=stat.st_size,
        uploaded_at=datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc),
        has_preview=preview is not None,
        preview_note=note,
    )


def get_preview(order_number: str) -> tuple[bytes | None, str]:
    """Превью заказа: из кэша или из файла. Возвращает (PNG, пояснение)."""
    source = design_path(order_number)
    if not source.exists():
        return None, "макет не загружен"

    ensure_dirs()
    cached = _preview_path(order_number)
    stamp_file = _stamp_path(order_number)
    current = _stamp(source)

    # кэш годен, пока исходник не менялся
    if stamp_file.exists():
        try:
            if stamp_file.read_text(encoding="utf-8").strip() == current:
                if cached.exists():
                    return cached.read_bytes(), "из кэша"
                return None, "внутри файла нет эскиза"
        except OSError:
            pass

    data, note = cdr.extract_preview(source)
    try:
        stamp_file.write_text(current, encoding="utf-8")
        if data is not None:
            cached.write_bytes(data)
        elif cached.exists():
            cached.unlink()      # исходник заменили на файл без превью
    except OSError:
        pass                     # кэш не критичен, отдадим и без него

    return data, note


def check_name(filename: str) -> None:
    """Проверка имени до чтения файла: не стоит принимать 300 МБ, чтобы отказать."""
    suffix = Path(cdr.safe_filename(filename)).suffix.lower()
    if suffix not in ALLOWED_SUFFIXES:
        raise ValueError("Принимаются только файлы .cdr")


def upload_target(order_number: str) -> Path:
    """Временный файл, в который льётся загрузка. Прежний макет живёт до commit()."""
    ensure_dirs()
    target = design_path(order_number)
    return target.with_name(target.name + ".part")


def commit(order_number: str, temp: Path) -> DesignInfo:
    """Делает загруженный файл макетом заказа, заменяя прежний."""
    if not temp.exists() or temp.stat().st_size == 0:
        temp.unlink(missing_ok=True)
        raise ValueError("Файл пустой")
    temp.replace(design_path(order_number))
    _drop_cache(order_number)
    return info(order_number)


def save(order_number: str, filename: str, data: bytes) -> DesignInfo:
    """Сохраняет макет из памяти — для скриптов и тестов; ручка льёт потоком."""
    check_name(filename)
    if len(data) > MAX_UPLOAD_BYTES:
        raise ValueError(f"Файл больше {MAX_UPLOAD_BYTES // 1024 // 1024} МБ")
    temp = upload_target(order_number)
    temp.write_bytes(data)
    return commit(order_number, temp)


def delete(order_number: str) -> bool:
    path = design_path(order_number)
    if not path.exists():
        return False
    path.unlink()
    _drop_cache(order_number)
    return True


def _drop_cache(order_number: str) -> None:
    for path in (_preview_path(order_number), _stamp_path(order_number), scene_cache_path(order_number)):
        with contextlib.suppress(OSError):
            path.unlink(missing_ok=True)


def rename(old_number: str, new_number: str) -> None:
    """Если номер заказа изменится, макет должен переехать вместе с ним."""
    source = design_path(old_number)
    if source.exists():
        shutil.move(str(source), str(design_path(new_number)))
    _drop_cache(old_number)


def storage_stats() -> dict:
    """Сколько места занято — для диагностики."""
    ensure_dirs()
    files = [p for p in DESIGNS_DIR.glob("*.cdr") if p.is_file()]
    return {
        "dir": str(DESIGNS_DIR),
        "count": len(files),
        "bytes": sum(p.stat().st_size for p in files),
    }
