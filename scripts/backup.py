"""Резервное копирование.

Делает два вида копий:

1. Снимок файла базы (только SQLite) — точная копия целиком, из неё можно
   восстановиться одной командой. Снимается через штатный механизм SQLite,
   поэтому безопасно делать на работающем сервере: незавершённая запись
   в копию не попадёт, файл не побьётся.

2. Выгрузку в JSON по разделам: заказы (вместе с историей), клиенты, прайс.
   Из неё можно восстановить что-то одно — например вернуть прайс, не трогая
   заказы. JSON читается глазами и переживёт переезд на Postgres,
   в отличие от снимка файла.

Использование
-------------
    python -m scripts.backup                 полный бэкап: снимок + все разделы
    python -m scripts.backup --only prices   только прайс
    python -m scripts.backup --only orders clients
    python -m scripts.backup --no-snapshot   без копии файла, только JSON
    python -m scripts.backup --keep 30        хранить последние 30 бэкапов
    python -m scripts.backup --list           показать, что уже сохранено

Куда кладёт: папка backups/ рядом с проектом, имя вида 2026-08-02_14-30-05.
Папку backups/ стоит добавить в .gitignore — там данные клиентов.

Как автоматизировать (Windows, «Планировщик заданий»):
    Программа:   D:\\путь\\.venv\\Scripts\\python.exe
    Аргументы:   -m scripts.backup --keep 30
    Папка:       D:\\путь\\posterprint-ocr
Раз в сутки этого достаточно. На Linux — та же команда в cron.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sqlite3
import sys
from datetime import date, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import select  # noqa: E402

from app.database import DB_URL, SessionLocal  # noqa: E402
from app.models import Client, Order, OrderEvent, PriceItem  # noqa: E402

BASE_DIR = Path(__file__).resolve().parent.parent
BACKUP_DIR = BASE_DIR / "backups"

SECTIONS = ("orders", "clients", "prices")


# ---------------------------------------------------------------- вспомогательное
def jsonable(value):
    """datetime и date — в строки, остальное как есть."""
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return value


def dump_row(obj, fields: list[str]) -> dict:
    return {f: jsonable(getattr(obj, f)) for f in fields}


ORDER_FIELDS = [
    "id", "number", "template_key", "status", "title",
    "client_id", "client_name", "client_phone", "client_contact",
    "quantity", "params", "price", "prepaid", "refunded",
    "due_date", "manager", "notes",
    "created_at", "updated_at", "completed_at",
]
EVENT_FIELDS = ["id", "order_id", "kind", "text", "author", "created_at"]
CLIENT_FIELDS = ["id", "name", "phone", "phone_norm", "contact", "notes", "created_at", "updated_at"]
PRICE_FIELDS = [
    "id", "group_key", "item_key", "title", "value",
    "active", "sort_order", "note", "created_at", "updated_at", "updated_by",
]


# ---------------------------------------------------------------- разделы
def export_orders(db) -> dict:
    orders = db.scalars(select(Order).order_by(Order.id)).all()
    events = db.scalars(select(OrderEvent).order_by(OrderEvent.id)).all()
    return {
        "orders": [dump_row(o, ORDER_FIELDS) for o in orders],
        "events": [dump_row(e, EVENT_FIELDS) for e in events],
    }


def export_clients(db) -> dict:
    rows = db.scalars(select(Client).order_by(Client.id)).all()
    return {"clients": [dump_row(c, CLIENT_FIELDS) for c in rows]}


def export_prices(db) -> dict:
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
    if source is None:
        print("  [i] База не SQLite — снимок файла пропущен, JSON-выгрузка сделана.")
        return None
    if not source.exists():
        print(f"  [!] Файл базы не найден: {source}")
        return None

    # открываем на запись, чтобы механизм копирования дотянул незаписанные
    # изменения из журнала WAL: иначе копия отстанет на последние операции
    src = sqlite3.connect(source)
    dst = sqlite3.connect(target)
    try:
        src.backup(dst)  # штатное копирование, не ломается при параллельной записи
    finally:
        dst.close()
        src.close()
    return target


def copy_designs(target: Path) -> None:
    """Копирует макеты заказов.

    По умолчанию не копируем: это гигабайты, и в обычном бэкапе базы им не
    место. Если макеты лежат на том же диске, что и база, — надёжнее включить
    папку в общий файловый бэкап сервера, а не дублировать её здесь.
    """
    from app.designs import DESIGNS_DIR

    if not DESIGNS_DIR.exists():
        print("  макеты  → папки нет, пропускаю")
        return

    files = [p for p in DESIGNS_DIR.glob("*.cdr") if p.is_file()]
    if not files:
        print("  макеты  → файлов нет")
        return

    dest = target / "designs"
    dest.mkdir(exist_ok=True)
    total = 0
    for path in files:
        shutil.copy2(path, dest / path.name)
        total += path.stat().st_size
    print(f"  макеты   → designs/  ({len(files)} шт, {total / 1024 / 1024:.1f} МБ)")


# ---------------------------------------------------------------- ротация
def rotate(keep: int) -> None:
    if keep <= 0:
        return
    folders = sorted((p for p in BACKUP_DIR.iterdir() if p.is_dir()), key=lambda p: p.name)
    extra = folders[:-keep] if len(folders) > keep else []
    for folder in extra:
        shutil.rmtree(folder, ignore_errors=True)
        print(f"  Удалён старый бэкап: {folder.name}")


def show_list() -> None:
    if not BACKUP_DIR.exists():
        print("Бэкапов пока нет.")
        return
    folders = sorted((p for p in BACKUP_DIR.iterdir() if p.is_dir()), key=lambda p: p.name)
    if not folders:
        print("Бэкапов пока нет.")
        return
    print(f"Бэкапы в {BACKUP_DIR}:\n")
    for folder in folders:
        size = sum(f.stat().st_size for f in folder.rglob("*") if f.is_file())
        parts = sorted(f.name for f in folder.iterdir() if f.is_file())
        print(f"  {folder.name}   {size / 1024:8.1f} КБ   {', '.join(parts)}")
    print(f"\nВсего: {len(folders)}")


# ---------------------------------------------------------------- main
def main() -> None:
    parser = argparse.ArgumentParser(description="Бэкап базы ПОСТЕР")
    parser.add_argument("--only", nargs="+", choices=SECTIONS, help="выгрузить только указанные разделы")
    parser.add_argument("--no-snapshot", action="store_true", help="не копировать файл базы, только JSON")
    parser.add_argument("--keep", type=int, default=0, help="сколько последних бэкапов оставить (0 — не удалять)")
    parser.add_argument("--list", action="store_true", help="показать существующие бэкапы")
    parser.add_argument("--with-designs", action="store_true",
                        help="скопировать и макеты заказов (может быть много гигабайт)")
    args = parser.parse_args()

    if args.list:
        show_list()
        return

    sections = args.only or list(SECTIONS)
    stamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    target = BACKUP_DIR / stamp
    target.mkdir(parents=True, exist_ok=True)

    print(f"Бэкап в {target}")

    db = SessionLocal()
    counts: dict[str, int] = {}
    try:
        for section in sections:
            data = EXPORTERS[section](db)
            payload = {
                "section": section,
                "created_at": datetime.now().isoformat(timespec="seconds"),
                "source": DB_URL,
                **data,
            }
            file = target / f"{section}.json"
            file.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
            total = sum(len(v) for k, v in data.items())
            counts[section] = total
            print(f"  {section:8} → {file.name}  ({total} записей)")
    finally:
        db.close()

    if not args.no_snapshot and not args.only:
        snap = make_snapshot(target / "poster.db")
        if snap:
            print(f"  снимок   → {snap.name}  ({snap.stat().st_size / 1024:.1f} КБ)")

    if args.with_designs:
        copy_designs(target)

    if args.keep:
        rotate(args.keep)

    print("\nГотово. Восстановление:  python -m scripts.restore --help")


if __name__ == "__main__":
    main()