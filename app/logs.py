"""Логирование: одна строка на запрос, подробности — только для ошибок.

Зачем так
---------
Подробный лог нужен, когда что-то пошло не так. Но писать всё подряд —
значит утопить нужное в шуме и грузить диск. Поэтому:

* обычный запрос → одна короткая строка: метод, путь, код, время, кто;
* ошибка → та же строка плюс полный трейсбек и короткий номер, который
  сотрудник может назвать вам по телефону;
* медленный запрос → отдельная пометка, чтобы видеть, что тормозит;
* статика, превью и картинки не логируются вовсе — их сотни, толку ноль.

Кроме этого роутеры пишут события по существу: что произошло, с чем и кто
это сделал. «POST /api/orders → 201» не отвечает на вопрос «кто поставил
такую цену» — а строка «Создан заказ ЗК-2026-000042 … 15 700 ₽ · Пётр»
отвечает. Пишутся: заказы (создание, правка, смена статуса, удаление),
прайс (цены, разделы, позиции), виды работ, профили и права, устройства,
карточки клиентов, макеты.

То, что можно потерять безвозвратно или что раздаёт доступ, пишется уровнем
WARNING — в интерфейсе (раздел «Журнал», галочка «только проблемы») такие
строки отфильтровываются от обычных. В отдельный errors.log попадают только
ERROR — падения сервера, у которых есть номер ошибки. Раньше туда шли и все
401 на неверный пароль, и каждый 404 — и файл «только с ошибками» был таким
же шумным, как основной.

poster.log ведётся уровнем INFO всегда, независимо от POSTER_LOG_LEVEL: это
аудит — кто создал заказ, кто поменял цену, — и выключать его нельзя.
POSTER_LOG_LEVEL управляет только тем, что печатается в консоль.

Файлы лежат в logs/ и сами обрезаются: пять файлов по 5 МБ, старые
удаляются. Диск не переполнится, даже если про логи забыть на год.

Настройки в .env
----------------
    POSTER_LOG_LEVEL=INFO      что печатать в консоль: DEBUG, INFO, WARNING
    POSTER_LOG_DIR=./logs      куда складывать
    POSTER_LOG_REQUESTS=1      0 — не писать обычные запросы, только ошибки
    POSTER_SLOW_MS=800         с какого времени запрос считается медленным
"""

from __future__ import annotations

import logging
import os
import time
import uuid
from logging.handlers import RotatingFileHandler
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent.parent
def _clean(name: str, default: str) -> str:
    """Значение из .env без хвоста.

    Если рядом со значением остался пояснительный текст (частая опечатка при
    правке .env), берём только первое слово. Приложение из-за такой мелочи
    падать при запуске не должно.
    """
    raw = (os.getenv(name) or default).strip()
    return raw.split("#", 1)[0].split()[0] if raw.split("#", 1)[0].split() else default


def _int(name: str, default: int) -> int:
    try:
        return int(_clean(name, str(default)))
    except ValueError:
        return default


LOG_DIR = Path((os.getenv("POSTER_LOG_DIR") or str(BASE_DIR / "logs")).split("#")[0].strip())
LOG_LEVEL = _clean("POSTER_LOG_LEVEL", "INFO").upper()
LOG_REQUESTS = _clean("POSTER_LOG_REQUESTS", "1") != "0"
SLOW_MS = _int("POSTER_SLOW_MS", 800)

MAX_BYTES = 5 * 1024 * 1024
BACKUP_COUNT = 5

# пути, которые не логируем: их много, а пользы в логе нет
# /.well-known/… дёргает сам Chrome (devtools) при каждом открытии страницы —
# в журнале это выглядело как поток 404, за которым не видно настоящих ошибок
SKIP_PREFIXES = ("/static/", "/favicon", "/.well-known/")
SKIP_SUFFIXES = ("/preview",)

log = logging.getLogger("poster")


def setup() -> None:
    """Настраивает логгер. Вызывается один раз при старте."""
    LOG_DIR.mkdir(parents=True, exist_ok=True)

    console_level = getattr(logging, LOG_LEVEL, logging.INFO)
    # сам логгер пропускает всё до INFO — файл-аудит не должен зависеть от
    # уровня, выбранного для консоли
    log.setLevel(min(console_level, logging.INFO))
    log.handlers.clear()
    log.propagate = False

    fmt = logging.Formatter(
        "%(asctime)s %(levelname)-7s %(message)s",
        datefmt="%d.%m %H:%M:%S",
    )

    # в файл — всё, что разрешено уровнем
    file_handler = RotatingFileHandler(
        LOG_DIR / "poster.log",
        maxBytes=MAX_BYTES,
        backupCount=BACKUP_COUNT,
        encoding="utf-8",
        delay=True,          # файл открывается при первой записи
    )
    file_handler.setLevel(logging.INFO)
    file_handler.setFormatter(fmt)
    log.addHandler(file_handler)

    # отдельный файл только с ошибками — чтобы не искать их среди тысяч строк
    error_handler = RotatingFileHandler(
        LOG_DIR / "errors.log",
        maxBytes=MAX_BYTES,
        backupCount=3,
        encoding="utf-8",
        delay=True,
    )
    error_handler.setLevel(logging.ERROR)
    error_handler.setFormatter(fmt)
    log.addHandler(error_handler)

    # в консоль — то же самое, чтобы при разработке было видно сразу
    console = logging.StreamHandler()
    console.setLevel(console_level)
    console.setFormatter(logging.Formatter("%(levelname)-7s %(message)s"))
    log.addHandler(console)

    log.info("Логи включены: уровень %s, папка %s", LOG_LEVEL, LOG_DIR)


def should_log(path: str) -> bool:
    if path.startswith(SKIP_PREFIXES):
        return False
    return not path.endswith(SKIP_SUFFIXES)


def new_error_id() -> str:
    """Короткий номер ошибки: сотрудник называет его, вы находите в логе."""
    return uuid.uuid4().hex[:6]


class Timer:
    """Замер времени запроса. perf_counter дешевле datetime."""

    def __init__(self) -> None:
        self.start = time.perf_counter()

    @property
    def ms(self) -> int:
        return int((time.perf_counter() - self.start) * 1000)


def tail(name: str = "poster.log", lines: int = 200) -> list[str]:
    """Последние строки лога — для просмотра из интерфейса.

    Читаем с конца, а не весь файл: он может быть на пять мегабайт.
    """
    path = LOG_DIR / name
    if not path.exists():
        return []

    chunk = 64 * 1024
    with path.open("rb") as fh:
        fh.seek(0, os.SEEK_END)
        size = fh.tell()
        data = b""
        while size > 0 and data.count(b"\n") <= lines:
            step = min(chunk, size)
            size -= step
            fh.seek(size)
            data = fh.read(step) + data

    text = data.decode("utf-8", "replace")
    return text.splitlines()[-lines:]


def files() -> list[dict]:
    """Какие файлы логов есть и сколько занимают."""
    if not LOG_DIR.exists():
        return []
    return [
        {"name": p.name, "size": p.stat().st_size, "modified": p.stat().st_mtime}
        for p in sorted(LOG_DIR.glob("*.log*"))
    ]