"""Чистая база перед реальным запуском: стереть рабочие данные, оставить каталог.

    python -m scripts.wipe_data          # спросит подтверждение
    python -m scripts.wipe_data --yes    # без вопросов (для скриптов)

Стирает: заказы с историей и кассой, клиентов, профили сотрудников,
устройства. Оставляет: разделы и позиции прайса, виды работ,
настройки владельца (реквизиты, почта). Перед этим сам делает полную копию
в backups/ — симуляцию, если она была нужна, можно вернуть оттуда.

Профиль администратора не в базе (пароль в .env), поэтому после чистки
входить можно сразу им и заводить настоящих сотрудников.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import delete, func, select, text

from app.core.database import DB_URL, SessionLocal, init_db
from app.models import Client, Device, Employee, Order, OrderEvent, Payment, PriceItem, Template
from app.services import backup

# порядок важен там, где внешние ключи выключены: сначала зависимые
WIPE = (
    ("движения кассы", Payment),
    ("события заказов", OrderEvent),
    ("заказы", Order),
    ("клиенты", Client),
    ("профили сотрудников", Employee),
    ("устройства", Device),
)


def counts(db) -> dict[str, int]:
    return {title: int(db.scalar(select(func.count()).select_from(model)) or 0) for title, model in WIPE}


def wipe(db) -> None:
    for _, model in WIPE:
        db.execute(delete(model))
    db.commit()


def main() -> None:
    parser = argparse.ArgumentParser(description="Стереть рабочие данные ПОСТЕР, оставить каталог")
    parser.add_argument("--yes", action="store_true", help="не спрашивать подтверждения")
    parser.add_argument("--no-backup", action="store_true", help="не делать копию перед чисткой")
    args = parser.parse_args()

    init_db()
    db = SessionLocal()
    try:
        before = counts(db)
        keep_items = db.scalar(select(func.count()).select_from(PriceItem)) or 0
        keep_templates = db.scalar(select(func.count()).select_from(Template)) or 0
        print("Будет стёрто:", ", ".join(f"{k} — {v}" for k, v in before.items()))
        print(f"Останется: позиций прайса — {keep_items}, видов работ — {keep_templates}, настройки.")
        if not args.yes:
            answer = input("Продолжить? Напишите «да»: ").strip().lower()
            if answer not in ("да", "yes", "y"):
                print("Отменено, ничего не изменено.")
                return
        if not args.no_backup:
            info = backup.run()
            print(f"Копия перед чисткой: backups/{info['name']}")
        wipe(db)
    finally:
        db.close()

    if DB_URL.startswith("sqlite"):
        # файл базы не уменьшается сам после удаления — ужимаем
        with SessionLocal() as db:
            db.execute(text("VACUUM"))
            db.commit()
    print("Готово: база чистая, каталог на месте. Вход — профилем администратора.")


if __name__ == "__main__":
    main()
