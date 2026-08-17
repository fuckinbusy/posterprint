"""Заливка каталога: разделы прайса, позиции и виды работ.

    python -m scripts.seed_workshop            # дозалить недостающее
    python -m scripts.seed_workshop --wipe     # стереть всё и залить заново

Сами данные — в `app/seed_catalog.py`, там же описано, как из ролей полей
собираются разные работы. Здесь только запуск и `--wipe`.

`--wipe` стирает заказы, клиентов и весь каталог, но НЕ трогает профили
сотрудников и список компьютеров: это настройки доступа, а не каталог, и
восстанавливать их руками обиднее всего.

Перед `--wipe` снимите бэкап — `python -m scripts.backup`. Скрипт об этом
спросит, если запущен в терминале.
"""

from __future__ import annotations

import argparse
import sys

from sqlalchemy import delete

from app.database import SessionLocal, init_db
from app.models import (
    Client,
    Order,
    OrderEvent,
    PriceGroup,
    PriceItem,
    Template,
    TemplateField,
)
from app.seed_catalog import seed_price_groups, seed_price_items, seed_templates


def wipe(db) -> None:
    """Стирает заказы, клиентов и весь каталог.

    События заказов удаляются каскадом, но чистим явно — на случай, если
    внешние ключи выключены.
    """
    for model in (OrderEvent, Order, Client, TemplateField, Template, PriceItem, PriceGroup):
        db.execute(delete(model))
    db.commit()
    print("[i] Заказы, клиенты и каталог стёрты. Профили и устройства не тронуты.")


def confirm_wipe() -> bool:
    """Спрашивает подтверждение, если есть у кого. В скриптах и планировщике
    ввода нет — там считаем, что раз попросили `--wipe`, значит попросили."""
    if not sys.stdin or not sys.stdin.isatty():
        return True
    print("Будут стёрты ВСЕ заказы, клиенты, прайс и виды работ.")
    print("Бэкап снимается командой:  python -m scripts.backup")
    return input("Продолжить? [y/N] ").strip().lower() in ("y", "yes", "д", "да")


def main() -> None:
    parser = argparse.ArgumentParser(description="Каталог мастерской: виды работ и прайс")
    parser.add_argument("--wipe", action="store_true",
                        help="сначала стереть заказы, клиентов и весь каталог")
    parser.add_argument("--yes", action="store_true",
                        help="не спрашивать подтверждения на --wipe")
    args = parser.parse_args()

    init_db()
    db = SessionLocal()
    try:
        if args.wipe:
            if not (args.yes or confirm_wipe()):
                print("Отменено, база не тронута.")
                return
            wipe(db)

        groups = seed_price_groups(db)
        items = seed_price_items(db)
        works = seed_templates(db)
        print(f"[i] Разделов прайса: +{groups}, позиций: +{items}, видов работ: +{works}.")
        if not (groups or items or works):
            print("    Всё уже на месте — повторный запуск ничего не меняет.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
