"""Резервное копирование — запуск с сервера или из планировщика Windows.

Само копирование живёт в app/backup.py (его же зовёт кнопка в разделе
«Журнал»); здесь только разбор аргументов и вывод в консоль.

Использование
-------------
  python -m scripts.backup                 полная копия: JSON + снимок базы
  python -m scripts.backup --only prices   один раздел
  python -m scripts.backup --keep 30       оставить 30 последних копий
  python -m scripts.backup --list          что уже есть

Планировщик Windows (раз в сутки, ночью):
  schtasks /Create /SC DAILY /ST 03:00 /TN "ПОСТЕР бэкап" ^
    /TR "\"D:\\poster\\.venv\\Scripts\\python.exe\" -m scripts.backup --keep 30" ^
    /RU SYSTEM
  — путь к python и рабочую папку подставьте свои; задача должна стартовать
  из корня проекта (там, где лежит poster.db).

Восстановление:  python -m scripts.restore --help
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.services import backup


def show_list() -> None:
    items = backup.list_backups()
    if not items:
        print("Бэкапов пока нет.")
        return
    print(f"Бэкапы в {backup.BACKUP_DIR}:\n")
    for item in reversed(items):
        print(f"  {item['name']}   {item['size'] / 1024:8.1f} КБ   {', '.join(item['files'])}")
    print(f"\nВсего: {len(items)}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Бэкап базы ПОСТЕР")
    parser.add_argument("--only", nargs="+", choices=backup.SECTIONS, help="выгрузить только указанные разделы")
    parser.add_argument("--no-snapshot", action="store_true", help="не копировать файл базы, только JSON")
    parser.add_argument("--keep", type=int, default=0, help="сколько последних бэкапов оставить (0 — не удалять)")
    parser.add_argument("--list", action="store_true", help="показать существующие бэкапы")
    parser.add_argument("--with-designs", action="store_true",
                        help="скопировать и макеты заказов (может быть много гигабайт)")
    args = parser.parse_args()

    if args.list:
        show_list()
        return

    info = backup.run(
        args.only or backup.SECTIONS,
        snapshot=not args.no_snapshot,
        with_designs=args.with_designs,
    )
    print(f"Бэкап в {backup.BACKUP_DIR / info['name']}")
    for section, count in info["counts"].items():
        print(f"  {section:8} → {section}.json  ({count} записей)")
    if info["snapshot"]:
        print("  снимок   → poster.db")
    elif not args.no_snapshot and not args.only:
        print("  [i] База не SQLite или файл не найден — снимок пропущен, JSON-выгрузка сделана.")
    if args.with_designs:
        d = info["designs"]
        print(f"  макеты   → designs/  ({d['files']} шт, {d['bytes'] / 1024 / 1024:.1f} МБ)")

    if args.keep:
        for name in backup.rotate(args.keep):
            print(f"  Удалён старый бэкап: {name}")

    print("\nГотово. Восстановление:  python -m scripts.restore --help")


if __name__ == "__main__":
    main()
