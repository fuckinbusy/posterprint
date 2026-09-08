"""Проверка состояния базы.

    python -m scripts.check_db

Показывает: цела ли база, сколько в ней записей, включён ли журнал WAL,
когда делался последний бэкап. Полезно запускать раз в неделю и обязательно —
если сервер вёл себя странно или компьютер выключился некорректно.
"""

from __future__ import annotations

import sys
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import func, select, text

from app.core.database import DB_URL, SessionLocal, engine, sqlite_file
from app.models import (
    Client,
    Device,
    Employee,
    Order,
    OrderEvent,
    PriceGroup,
    PriceItem,
    Template,
)

BASE_DIR = Path(__file__).resolve().parent.parent
BACKUP_DIR = BASE_DIR / "backups"


def human_size(num: float) -> str:
    for unit in ("Б", "КБ", "МБ", "ГБ"):
        if num < 1024:
            return f"{num:.0f} {unit}" if unit == "Б" else f"{num:.1f} {unit}"
        num /= 1024
    return f"{num:.1f} ТБ"


def main() -> None:
    print(f"База: {DB_URL}\n")

    path = sqlite_file()
    if path is not None:
        if not path.exists():
            print("[!] Файл базы не найден — при первом запуске сервера он создастся заново.")
            return
        print(f"  файл          {path}")
        print(f"  размер        {human_size(path.stat().st_size)}")
        wal = path.with_name(path.name + "-wal")
        if wal.exists():
            print(f"  журнал WAL    {human_size(wal.stat().st_size)} (незаписанные изменения)")

    # ---- целостность
    print("\nЦЕЛОСТНОСТЬ")
    try:
        with engine.connect() as conn:
            quick = conn.execute(text("PRAGMA quick_check")).scalar()
            journal = conn.execute(text("PRAGMA journal_mode")).scalar()
            fk_problems = conn.execute(text("PRAGMA foreign_key_check")).fetchall()
    except Exception as exc:
        print(f"  [!] База не открывается: {exc}")
        print("      Восстановите из бэкапа:  python -m scripts.restore --list")
        return

    print(f"  проверка      {'в порядке' if quick == 'ok' else '[!] ' + str(quick)}")
    print(f"  журнал        {journal}{'  (защита от обрыва питания)' if journal == 'wal' else '  [!] лучше WAL'}")
    if fk_problems:
        print(f"  [!] битых связей: {len(fk_problems)} — например заказ ссылается на удалённого клиента")
    else:
        print("  связи         в порядке")

    # ---- содержимое
    print("\nСОДЕРЖИМОЕ")
    db = SessionLocal()
    try:
        rows = [
            ("заказы", Order),
            ("записи истории", OrderEvent),
            ("клиенты", Client),
            ("виды работ", Template),
            ("разделы прайса", PriceGroup),
            ("позиции прайса", PriceItem),
            ("профили", Employee),
            ("устройства", Device),
        ]
        for title, model in rows:
            print(f"  {title:16} {db.scalar(select(func.count(model.id))) or 0}")
    finally:
        db.close()

    # ---- макеты
    print("\nМАКЕТЫ ЗАКАЗОВ")
    try:
        from app.services.designs import storage_stats

        stats = storage_stats()
        print(f"  папка         {stats['dir']}")
        print(f"  файлов        {stats['count']}")
        print(f"  занято        {human_size(stats['bytes'])}")
        if stats["count"]:
            print("  [i] макеты не входят в обычный бэкап — python -m scripts.backup --with-designs")
    except Exception as exc:
        print(f"  [!] не удалось прочитать папку макетов: {exc}")

    # ---- бэкапы
    print("\nБЭКАПЫ")
    folders = sorted(
        (p for p in BACKUP_DIR.iterdir() if p.is_dir()) if BACKUP_DIR.exists() else [],
        key=lambda p: p.name,
    )
    if not folders:
        print("  [!] бэкапов нет. Сделайте первый:  python -m scripts.backup")
    else:
        last = folders[-1]
        age = datetime.now(UTC) - datetime.fromtimestamp(
            last.stat().st_mtime, tz=UTC
        )
        days = age.days
        print(f"  всего         {len(folders)}")
        print(f"  последний     {last.name} ({'сегодня' if days == 0 else f'{days} дн. назад'})")
        if days >= 7:
            print("  [!] бэкап старше недели — сделайте свежий: python -m scripts.backup")


if __name__ == "__main__":
    main()
