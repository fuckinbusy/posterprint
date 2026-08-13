"""Восстановление из бэкапа.

Восстанавливать можно по разделам — например вернуть прайс, не трогая заказы.

Использование
-------------
    python -m scripts.restore --list
        показать доступные бэкапы

    python -m scripts.restore prices
        вернуть прайс из последнего бэкапа (спросит подтверждение)

    python -m scripts.restore prices --from 2026-08-02_14-30-05
        из конкретного бэкапа

    python -m scripts.restore orders clients prices
        восстановить всё сразу

    python -m scripts.restore prices --mode replace
        не дополнять, а стереть текущий прайс и залить из бэкапа

Режимы
------
    merge   (по умолчанию) существующие записи обновляются, новые добавляются,
            лишнее в базе остаётся нетронутым. Безопасный вариант.
    replace раздел полностью очищается и заливается из бэкапа. Всё, что
            появилось после бэкапа, будет потеряно.

Записи сопоставляются не по id, а по естественным ключам:
    заказы   — по номеру (ЗК-2026-000042)
    клиенты  — по нормализованному телефону, иначе по имени
    прайс    — по паре (раздел, ключ позиции)
Поэтому восстановление в базу, где данные уже есть, не плодит дубли.

Если нужно вернуть базу целиком в состояние на момент бэкапа — проще
остановить сервер и скопировать файл poster.db из папки бэкапа на место
рабочего. Этот скрипт для выборочного восстановления.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import date, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import select  # noqa: E402

from app.database import SessionLocal, init_db  # noqa: E402
from app.models import Client, Order, OrderEvent, PriceItem  # noqa: E402

BASE_DIR = Path(__file__).resolve().parent.parent
BACKUP_DIR = BASE_DIR / "backups"
SECTIONS = ("orders", "clients", "prices")

DATETIME_FIELDS = {"created_at", "updated_at", "completed_at"}
DATE_FIELDS = {"due_date"}


def parse_value(field: str, value):
    if value is None:
        return None
    if field in DATETIME_FIELDS:
        return datetime.fromisoformat(value)
    if field in DATE_FIELDS:
        return date.fromisoformat(value)
    return value


def apply_fields(obj, row: dict, fields: list[str]) -> None:
    for field in fields:
        if field in row:
            setattr(obj, field, parse_value(field, row[field]))


def latest_backup() -> Path | None:
    if not BACKUP_DIR.exists():
        return None
    folders = sorted((p for p in BACKUP_DIR.iterdir() if p.is_dir()), key=lambda p: p.name)
    return folders[-1] if folders else None


def show_list() -> None:
    if not BACKUP_DIR.exists() or not any(BACKUP_DIR.iterdir()):
        print("Бэкапов нет. Сделайте первый:  python -m scripts.backup")
        return
    print(f"Доступные бэкапы в {BACKUP_DIR}:\n")
    for folder in sorted((p for p in BACKUP_DIR.iterdir() if p.is_dir()), key=lambda p: p.name):
        parts = []
        for section in SECTIONS:
            file = folder / f"{section}.json"
            if file.exists():
                data = json.loads(file.read_text(encoding="utf-8"))
                count = sum(len(v) for k, v in data.items() if isinstance(v, list))
                parts.append(f"{section}: {count}")
        snap = " + снимок" if (folder / "poster.db").exists() else ""
        print(f"  {folder.name}   {', '.join(parts) or 'пусто'}{snap}")


# ---------------------------------------------------------------- разделы
def restore_prices(db, data: dict, mode: str) -> tuple[int, int]:
    rows = data.get("prices", [])
    fields = ["title", "value", "active", "sort_order", "note", "updated_by"]

    if mode == "replace":
        db.query(PriceItem).delete()
        db.flush()

    added = updated = 0
    for row in rows:
        item = db.scalar(
            select(PriceItem).where(
                PriceItem.group_key == row["group_key"],
                PriceItem.item_key == row["item_key"],
            )
        )
        if item is None:
            item = PriceItem(group_key=row["group_key"], item_key=row["item_key"])
            apply_fields(item, row, fields)
            db.add(item)
            added += 1
        else:
            apply_fields(item, row, fields)
            updated += 1
    return added, updated


def restore_clients(db, data: dict, mode: str) -> tuple[int, int]:
    rows = data.get("clients", [])
    fields = ["name", "phone", "phone_norm", "contact", "notes", "created_at", "updated_at"]

    if mode == "replace":
        db.query(Client).delete()
        db.flush()

    added = updated = 0
    for row in rows:
        client = None
        if row.get("phone_norm"):
            client = db.scalar(select(Client).where(Client.phone_norm == row["phone_norm"]))
        if client is None and row.get("name"):
            client = db.scalar(select(Client).where(Client.name == row["name"]))
        if client is None:
            client = Client()
            apply_fields(client, row, fields)
            db.add(client)
            added += 1
        else:
            apply_fields(client, row, fields)
            updated += 1
    return added, updated


def restore_orders(db, data: dict, mode: str) -> tuple[int, int]:
    """Заказы восстанавливаются вместе с историей событий."""
    rows = data.get("orders", [])
    events = data.get("events", [])
    fields = [
        "template_key", "status", "title",
        "client_name", "client_phone", "client_contact",
        "quantity", "params", "price", "prepaid", "refunded",
        "due_date", "manager", "notes",
        "created_at", "updated_at", "completed_at",
    ]

    if mode == "replace":
        db.query(OrderEvent).delete()
        db.query(Order).delete()
        db.flush()

    added = updated = 0
    old_to_new: dict[int, int] = {}
    for row in rows:
        order = db.scalar(select(Order).where(Order.number == row["number"]))
        if order is None:
            order = Order(number=row["number"])
            apply_fields(order, row, fields)
            db.add(order)
            added += 1
        else:
            apply_fields(order, row, fields)
            updated += 1
        db.flush()
        old_to_new[row["id"]] = order.id

    # история: добавляем только те события, которых ещё нет
    existing = {
        (e.order_id, e.kind, e.text, e.created_at.isoformat() if e.created_at else "")
        for e in db.scalars(select(OrderEvent)).all()
    }
    for row in events:
        order_id = old_to_new.get(row["order_id"])
        if order_id is None:
            continue
        signature = (order_id, row["kind"], row["text"], row.get("created_at") or "")
        if signature in existing:
            continue
        event = OrderEvent(order_id=order_id)
        apply_fields(event, row, ["kind", "text", "author", "created_at"])
        db.add(event)

    # связь заказов с клиентами восстанавливаем по телефону — id могли сместиться
    for order in db.scalars(select(Order).where(Order.client_id.is_(None))).all():
        if not order.client_phone:
            continue
        from app import clients as clients_logic

        client = clients_logic.find_by_phone(db, order.client_phone)
        if client:
            order.client_id = client.id

    return added, updated


RESTORERS = {
    "orders": restore_orders,
    "clients": restore_clients,
    "prices": restore_prices,
}


# ---------------------------------------------------------------- main
def main() -> None:
    parser = argparse.ArgumentParser(description="Восстановление из бэкапа ПОСТЕР")
    parser.add_argument("sections", nargs="*", choices=[*SECTIONS, []], help="какие разделы восстановить")
    parser.add_argument("--from", dest="folder", help="имя папки бэкапа (по умолчанию последний)")
    parser.add_argument("--mode", choices=["merge", "replace"], default="merge")
    parser.add_argument("--list", action="store_true", help="показать доступные бэкапы")
    parser.add_argument("--yes", action="store_true", help="не спрашивать подтверждения")
    args = parser.parse_args()

    if args.list or not args.sections:
        show_list()
        if not args.sections:
            print("\nЧто восстановить? Например:  python -m scripts.restore prices")
        return

    source = BACKUP_DIR / args.folder if args.folder else latest_backup()
    if source is None or not source.exists():
        print("Бэкап не найден. Список:  python -m scripts.restore --list")
        return

    print(f"Источник: {source}")
    print(f"Разделы:  {', '.join(args.sections)}")
    print(f"Режим:    {args.mode}"
          f"{'  — ТЕКУЩИЕ ДАННЫЕ В ЭТИХ РАЗДЕЛАХ БУДУТ СТЁРТЫ' if args.mode == 'replace' else ''}")

    if not args.yes:
        answer = input("\nПродолжить? [y/N] ").strip().lower()
        if answer not in ("y", "yes", "д", "да"):
            print("Отменено.")
            return

    init_db()
    db = SessionLocal()
    try:
        for section in args.sections:
            file = source / f"{section}.json"
            if not file.exists():
                print(f"  {section:8} — нет файла в этом бэкапе, пропускаю")
                continue
            data = json.loads(file.read_text(encoding="utf-8"))
            added, updated = RESTORERS[section](db, data, args.mode)
            db.commit()
            print(f"  {section:8} — добавлено {added}, обновлено {updated}")
    except Exception:
        db.rollback()
        print("\nОшибка — изменения откачены, база осталась как была.")
        raise
    finally:
        db.close()

    print("\nГотово. Перезапустите сервер, если он был запущен.")


if __name__ == "__main__":
    main()
