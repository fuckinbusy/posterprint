"""Резервные копии базы.

Два вида копий в одной папке backups/<дата_время>/:

1. Снимок файла базы (только SQLite) — точная копия целиком, из неё
   восстанавливаются одной командой. Снимается штатным механизмом SQLite,
   поэтому безопасно на работающем сервере: незавершённая запись в копию
   не попадёт, файл не побьётся.
2. Выгрузка в JSON по разделам: заказы (с историей и движениями денег),
   клиенты, прайс. Из неё восстанавливают что-то одно — например прайс,
   не трогая заказы. JSON читается глазами и переживёт переезд на Postgres.

Раньше всё это жило в scripts/backup.py и запускалось только руками с
сервера — и не запускалось никем. Теперь ядро здесь: его зовут и скрипт
(для планировщика Windows), и кнопка в разделе «Журнал».
"""

from __future__ import annotations

import json
import shutil
import sqlite3
from datetime import date, datetime
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import DB_URL, SessionLocal
from app.models import Client, Order, OrderEvent, Payment, PriceItem

BASE_DIR = Path(__file__).resolve().parent.parent
BACKUP_DIR = BASE_DIR / "backups"

SECTIONS = ("orders", "clients", "prices")
STAMP = "%Y-%m-%d_%H-%M-%S"

# ---------------------------------------------------------------- выгрузка в JSON
# Формат файлов — тот же, что читает scripts/restore.py: менять списки полей
# и ключи разделов можно только вместе с ним.
ORDER_FIELDS = [
    "id", "number", "template_key", "status", "title",
    "client_id", "client_name", "client_phone", "client_contact",
    "quantity", "params", "price", "prepaid", "refunded",
    "due_date", "manager", "notes",
    "created_at", "updated_at", "completed_at",
]
EVENT_FIELDS = ["id", "order_id", "kind", "text", "author", "created_at"]
PAYMENT_FIELDS = ["id", "order_id", "amount", "method", "author", "created_at"]
CLIENT_FIELDS = ["id", "name", "phone", "phone_norm", "contact", "notes", "created_at", "updated_at"]
PRICE_FIELDS = [
    "id", "group_key", "item_key", "title", "value",
    "active", "sort_order", "note", "created_at", "updated_at", "updated_by",
]


def jsonable(value):
    """datetime и date — в строки, остальное как есть."""
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return value


def dump_row(obj, fields: list[str]) -> dict:
    return {f: jsonable(getattr(obj, f)) for f in fields}


def export_orders(db: Session) -> dict:
    orders = db.scalars(select(Order).order_by(Order.id)).all()
    events = db.scalars(select(OrderEvent).order_by(OrderEvent.id)).all()
    payments = db.scalars(select(Payment).order_by(Payment.id)).all()
    return {
        "orders": [dump_row(o, ORDER_FIELDS) for o in orders],
        "events": [dump_row(e, EVENT_FIELDS) for e in events],
        # движения денег (касса) — новый раздел, restore их пока не читает
        "payments": [dump_row(p, PAYMENT_FIELDS) for p in payments],
    }


def export_clients(db: Session) -> dict:
    rows = db.scalars(select(Client).order_by(Client.id)).all()
    return {"clients": [dump_row(c, CLIENT_FIELDS) for c in rows]}


def export_prices(db: Session) -> dict:
    rows = db.scalars(select(PriceItem).order_by(PriceItem.group_key, PriceItem.sort_order)).all()
    return {"prices": [dump_row(p, PRICE_FIELDS) for p in rows]}


EXPORTERS = {
    "orders": export_orders,
    "clients": export_clients,
    "prices": export_prices,
}


# ---------------------------------------------------------------- снимок файла
def sqlite_path() -> Path | None:
    """Путь к файлу базы, если используется SQLite."""
    if not DB_URL.startswith("sqlite"):
        return None
    raw = DB_URL.split("///", 1)[-1]
    path = Path(raw)
    return path if path.is_absolute() else (BASE_DIR / raw).resolve()


def make_snapshot(target: Path) -> Path | None:
    """Копия файла базы через механизм SQLite — безопасна на живом сервере."""
    source = sqlite_path()
    if source is None or not source.exists():
        return None
    # открываем источник обычным соединением: механизм копирования дотянет
    # незаписанные изменения из журнала WAL, иначе копия отстала бы на
    # последние операции
    src = sqlite3.connect(source)
    dst = sqlite3.connect(target)
    try:
        src.backup(dst)  # штатное копирование, не ломается при параллельной записи
    finally:
        dst.close()
        src.close()
    return target


def copy_designs(target: Path) -> tuple[int, int]:
    """Копирует макеты заказов. Возвращает (файлов, байт).

    По умолчанию не копируем: это гигабайты, и в обычном бэкапе базы им не
    место. Если макеты лежат на том же диске, что и база, — надёжнее включить
    папку в общий файловый бэкап сервера, а не дублировать её здесь.
    """
    from app.designs import DESIGNS_DIR

    if not DESIGNS_DIR.exists():
        return 0, 0
    files = [p for p in DESIGNS_DIR.glob("*.cdr") if p.is_file()]
    if not files:
        return 0, 0
    dest = target / "designs"
    dest.mkdir(exist_ok=True)
    total = 0
    for path in files:
        shutil.copy2(path, dest / path.name)
        total += path.stat().st_size
    return len(files), total


# ---------------------------------------------------------------- список и ротация
def parse_stamp(name: str) -> datetime | None:
    """Момент создания копии — из имени папки. Чужие папки в backups/ не наши."""
    try:
        return datetime.strptime(name, STAMP)
    except ValueError:
        return None


def folder_size(folder: Path) -> int:
    return sum(f.stat().st_size for f in folder.rglob("*") if f.is_file())


def describe(folder: Path) -> dict:
    created = parse_stamp(folder.name)
    return {
        "name": folder.name,
        "created_at": created.isoformat(timespec="seconds") if created else None,
        "size": folder_size(folder),
        "files": sorted(f.name for f in folder.iterdir() if f.is_file()),
    }


def list_backups() -> list[dict]:
    """Все копии, свежие первыми."""
    if not BACKUP_DIR.exists():
        return []
    folders = [p for p in BACKUP_DIR.iterdir() if p.is_dir() and parse_stamp(p.name)]
    return [describe(p) for p in sorted(folders, key=lambda p: p.name, reverse=True)]


def rotate(keep: int) -> list[str]:
    """Оставляет keep последних копий, остальные удаляет. Возвращает удалённые."""
    if keep <= 0 or not BACKUP_DIR.exists():
        return []
    folders = sorted(
        (p for p in BACKUP_DIR.iterdir() if p.is_dir() and parse_stamp(p.name)),
        key=lambda p: p.name,
    )
    extra = folders[:-keep] if len(folders) > keep else []
    for folder in extra:
        shutil.rmtree(folder, ignore_errors=True)
    return [p.name for p in extra]


# ---------------------------------------------------------------- сама копия
def run(
    sections: tuple[str, ...] | list[str] = SECTIONS,
    *,
    snapshot: bool = True,
    with_designs: bool = False,
    db: Session | None = None,
) -> dict:
    """Делает копию и возвращает её описание: папка, файлы, сколько записей.

    Сессию можно передать свою (ручка в API) или не передавать (скрипт).
    """
    stamp = datetime.now().strftime(STAMP)
    target = BACKUP_DIR / stamp
    target.mkdir(parents=True, exist_ok=True)

    own = db is None
    session = db or SessionLocal()
    counts: dict[str, int] = {}
    try:
        for section in sections:
            data = EXPORTERS[section](session)
            payload = {
                "section": section,
                "created_at": datetime.now().isoformat(timespec="seconds"),
                "source": DB_URL,
                **data,
            }
            (target / f"{section}.json").write_text(
                json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8"
            )
            counts[section] = len(data.get(section, []))
    finally:
        if own:
            session.close()

    snap = make_snapshot(target / "poster.db") if snapshot and set(sections) == set(SECTIONS) else None
    designs = copy_designs(target) if with_designs else (0, 0)

    info = describe(target)
    info["counts"] = counts
    info["snapshot"] = snap is not None
    info["designs"] = {"files": designs[0], "bytes": designs[1]}
    return info
