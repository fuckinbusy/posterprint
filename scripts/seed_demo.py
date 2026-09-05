"""Демо-заказы — чтобы доска не была пустой и было на чём смотреть систему.

    python -m scripts.seed_demo              # добавить, если заказов ещё нет
    python -m scripts.seed_demo --replace    # стереть заказы и клиентов, залить заново
    python -m scripts.seed_demo --replace --yes

Заказы раскиданы по всем статусам и покрывают всё, что система умеет
показывать: просроченный, «сдать сегодня», без цены, частично оплаченный,
оплаченный полностью, с переплатой, отменённый с возвратом, выданный с
недоплатой. Цены считаются тем же расчётом, что и кнопка «Рассчитать», —
смета в карточке сходится с суммой.

Каталог должен быть на месте (`python -m scripts.seed_workshop`).
Профили сотрудников и устройства скрипт не трогает.
"""

from __future__ import annotations

import argparse
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import delete, select  # noqa: E402

from app import clients as clients_logic, pricing  # noqa: E402

# консоль Windows по умолчанию в cp1251 — на «₽» в выводе скрипт падал,
# успев стереть старые демо-заказы и не добавив новые
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
from app.database import SessionLocal, init_db  # noqa: E402
from app.models import STATUS_META, Client, Order, OrderEvent, OrderStatus, Payment, Template  # noqa: E402
from app.routers.orders import next_number  # noqa: E402

# кто принимал — просто имена в истории, профили под них не нужны
ANYA, SERGEY, ADMIN = "Аня", "Сергей", "Администратор"

# (вид работ, статус, название, клиент, телефон, контакт, тираж, params,
#  внесено (число) или "full"/"over:N", срок в днях от сегодня (None — без срока),
#  кто принял, заметка, дней с момента создания, возврат)
DEMO: list[dict] = [
    dict(
        template="banner_print", status=OrderStatus.new,
        title="Баннер на фасад автосервиса", client="Автосервис «Гарант»",
        phone="+7 928 404-90-12", contact="", qty=1,
        params={"material": "Баннер 440г", "width": 3, "height": 1, "gluing": True,
                "cutting": False, "grommets": 8},
        prepaid=0, due=3, manager=ANYA, notes="Макет присылают до среды, проверить вылеты.",
        age=0,
    ),
    dict(
        template="cards", status=OrderStatus.new,
        title="Визитки для кофейни", client="Кофейня «Причал»",
        phone="+7 918 111-22-33", contact="prichal@mail.ru", qty=500,
        params={"tier": "100", "paper": "Дизайнерская", "sides": "Двусторонняя",
                "corners": True, "lamination": False, "foil": False, "size": "90×50 мм"},
        prepaid=1500, due=5, manager=ANYA, notes="", age=1,
    ),
    dict(
        # без цены — попадёт в «без цены в работе»
        template="sticker_print", status=OrderStatus.new,
        title="Наклейки на витрину", client="Салон «Марго»",
        phone="+7 918 700-55-41", contact="", qty=12,
        params={"material": "Oracal 641 мат", "width": 0.3, "height": 0.3,
                "plotter_cut": True, "cut_length": 1.1, "hand_cut": False, "lamination": False},
        prepaid=0, due=6, manager="", notes="Ждём макет от дизайнера, цену не считали.",
        age=0, no_price=True,
    ),
    dict(
        template="banner_print", status=OrderStatus.confirmed,
        title="Растяжка «Распродажа»", client="Мебель-Сити",
        phone="+7 988 300-11-09", contact="@mebelcity", qty=2,
        params={"material": "Сетка 370г", "width": 6, "height": 1, "gluing": True,
                "cutting": True, "grommets": 14},
        prepaid=3000, due=2, manager=SERGEY, notes="", age=2,
    ),
    dict(
        template="milling", status=OrderStatus.confirmed,
        title="Буквы из ПВХ 10 мм", client="Пекарня «Тесто»",
        phone="+7 918 909-14-77", contact="", qty=8,
        params={"material": "ПВХ", "cut_length": 0.9},
        prepaid="full", due=4, manager=SERGEY, notes="Высота букв 250 мм, шрифт в макете.",
        age=1,
    ),
    dict(
        # просрочен: срок вчера, а всё ещё в работе
        template="sticker_print", status=OrderStatus.in_work,
        title="Плёнка на стекло, перфорация", client="Стоматология «Дента»",
        phone="+7 918 222-88-40", contact="denta@clinic.ru", qty=2,
        params={"material": "Перфорированная", "width": 1.2, "height": 1.8,
                "plotter_cut": False, "cut_length": 0, "hand_cut": True, "lamination": False},
        prepaid=2000, due=-1, manager=ANYA, notes="Оклейка на месте, звонить за час.",
        age=4,
    ),
    dict(
        # сдать сегодня
        template="cards", status=OrderStatus.in_work,
        title="Визитки ИП Лазарев", client="ИП Лазарев",
        phone="+7 918 555-01-01", contact="", qty=100,
        params={"tier": "100", "paper": "Мелованная 300", "sides": "Односторонняя",
                "corners": False, "lamination": False, "foil": False, "size": "90×50 мм"},
        prepaid="full", due=0, manager=SERGEY, notes="", age=2,
    ),
    dict(
        template="sheet_sale", status=OrderStatus.ready,
        title="ПВХ 5 мм, 3 листа", client="Мастерская «Дуб»",
        phone="+7 928 111-00-22", contact="", qty=3,
        params={"material": "ПВХ 5 мм"},
        prepaid="over:500", due=0, manager=ANYA,
        notes="Внесли больше — вернуть разницу при выдаче.", age=3,
    ),
    dict(
        template="banner_roll", status=OrderStatus.ready,
        title="Баннер 580 в рулоне, 12 м", client="Автосервис «Гарант»",
        phone="+7 928 404-90-12", contact="", qty=1,
        params={"material": "Баннер 580г", "length": 12},
        prepaid=0, due=1, manager=SERGEY, notes="", age=1,
    ),
    dict(
        # выдан, оплачен — обычная выручка
        template="banner_print", status=OrderStatus.done,
        title="Баннер «Открытие»", client="Пекарня «Тесто»",
        phone="+7 918 909-14-77", contact="", qty=1,
        params={"material": "Баннер 440г", "width": 2, "height": 1.5, "gluing": True,
                "cutting": False, "grommets": 6},
        prepaid="full", due=-3, manager=ANYA, notes="", age=6, done_days_ago=3,
    ),
    dict(
        # выдан с недоплатой — долг по выданным
        template="cards", status=OrderStatus.done,
        title="Визитки, тач-кавер", client="Салон «Марго»",
        phone="+7 918 700-55-41", contact="", qty=1000,
        params={"tier": "1000", "paper": "Тач-кавер", "sides": "Двусторонняя",
                "corners": True, "lamination": False, "foil": True, "size": "85×55 мм"},
        prepaid=5000, due=-5, manager=SERGEY, notes="Остаток обещали перевести в пятницу.",
        age=9, done_days_ago=5,
    ),
    dict(
        template="sticker_roll", status=OrderStatus.done,
        title="Плёнка Oracal 3641, 5 м", client="Стоматология «Дента»",
        phone="+7 918 222-88-40", contact="denta@clinic.ru", qty=1,
        params={"material": "Oracal 3641 литая", "length": 5},
        prepaid="full", due=-8, manager=ANYA, notes="", age=10, done_days_ago=8,
    ),
    dict(
        # отменён с возвратом предоплаты
        template="milling", status=OrderStatus.cancelled,
        title="Фрезеровка акрила, вывеска", client="Мебель-Сити",
        phone="+7 988 300-11-09", contact="@mebelcity", qty=2,
        params={"material": "Акрил", "cut_length": 3.5},
        prepaid=2000, due=None, manager=SERGEY, notes="", age=7,
        refunded=True, cancel_reason="Клиент передумал — нашли дешевле",
    ),
]


def build_price(db, item: dict) -> float:
    if item.get("no_price"):
        return 0.0
    result = pricing.estimate(db, item["template"], item["qty"], item["params"])
    if result["price"] is None:
        raise SystemExit(f"Не посчиталось «{item['title']}»: {result['note']}")
    return float(result["price"])


def resolve_prepaid(spec, price: float) -> float:
    if spec == "full":
        return price
    if isinstance(spec, str) and spec.startswith("over:"):
        return price + float(spec.split(":", 1)[1])
    return float(spec)


def wipe(db) -> None:
    for model in (OrderEvent, Order, Client):
        db.execute(delete(model))
    db.commit()
    print("[i] Заказы и клиенты стёрты.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Демо-заказы")
    parser.add_argument("--replace", action="store_true",
                        help="стереть заказы и клиентов, залить заново")
    parser.add_argument("--yes", action="store_true", help="не спрашивать подтверждения")
    args = parser.parse_args()

    init_db()
    db = SessionLocal()
    try:
        templates = {t.key for t in db.scalars(select(Template)).all()}
        missing = {item["template"] for item in DEMO} - templates
        if missing:
            raise SystemExit(
                f"Нет видов работ {sorted(missing)} — сначала python -m scripts.seed_workshop"
            )

        if db.scalar(select(Order).limit(1)) is not None:
            if not args.replace:
                print("В базе уже есть заказы — демо не добавляю. Заменить: --replace")
                return
            if not args.yes and sys.stdin and sys.stdin.isatty():
                answer = input("Стереть ВСЕ заказы и клиентов и залить демо? [y/N] ")
                if answer.strip().lower() not in ("y", "yes", "д", "да"):
                    print("Отменено.")
                    return
            wipe(db)

        now = datetime.now(timezone.utc)
        today = date.today()
        for item in DEMO:
            price = build_price(db, item)
            prepaid = resolve_prepaid(item["prepaid"], price)
            created_at = now - timedelta(days=item["age"], hours=3)
            status = item["status"]
            order = Order(
                number=next_number(db),
                template_key=item["template"],
                status=status.value,
                title=item["title"],
                client_name=item["client"],
                client_phone=item["phone"],
                client_contact=item["contact"],
                quantity=item["qty"],
                params=item["params"],
                price=price,
                prepaid=prepaid,
                refunded=bool(item.get("refunded")),
                due_date=today + timedelta(days=item["due"]) if item["due"] is not None else None,
                manager=item["manager"],
                notes=item.get("notes", ""),
                cancel_reason=item.get("cancel_reason", ""),
                created_at=created_at,
                updated_at=created_at,
            )
            if status == OrderStatus.done:
                order.completed_at = now - timedelta(days=item.get("done_days_ago", 0))
                order.updated_at = order.completed_at

            client = clients_logic.upsert(
                db, name=item["client"], phone=item["phone"], contact=item["contact"]
            )
            if client is not None:
                order.client_id = client.id
            db.add(order)
            db.flush()

            # история: создание и путь по статусам, как если бы его прошли руками
            path = [OrderStatus.new, OrderStatus.confirmed, OrderStatus.in_work,
                    OrderStatus.ready, OrderStatus.done]
            events = [OrderEvent(
                order_id=order.id, kind="created",
                text=f"Заказ создан — {item['title']}", author=item["manager"] or ADMIN,
                created_at=created_at,
            )]
            if status == OrderStatus.cancelled:
                events.append(OrderEvent(
                    order_id=order.id, kind="status",
                    text=f"Новый → Отменён · причина: {item.get('cancel_reason', '')}",
                    author=item["manager"] or ADMIN,
                    created_at=created_at + timedelta(days=1),
                ))
            else:
                steps = path[: path.index(status) + 1]
                for n, (prev, cur) in enumerate(zip(steps, steps[1:]), start=1):
                    events.append(OrderEvent(
                        order_id=order.id, kind="status",
                        text=f"{STATUS_META[prev]['title']} → {STATUS_META[cur]['title']}",
                        author=item["manager"] or ADMIN,
                        created_at=created_at + timedelta(hours=8 * n),
                    ))
            # касса: внесённое — строкой в журнал, как если бы приняли руками.
            # Чётные заказы — переводом, нечётные — наличными: в кассе за день
            # видно оба способа.
            if prepaid > 0:
                db.add(Payment(
                    order_id=order.id, amount=prepaid,
                    method="transfer" if order.id % 2 == 0 else "cash",
                    author=item["manager"] or ADMIN,
                    created_at=created_at + timedelta(hours=1),
                ))
            db.add_all(events)
            db.commit()
            print(f"  {order.number}  {STATUS_META[status]['title']:<12} {item['title']:<36} {price:>9.0f} ₽")
        print(f"Добавлено демо-заказов: {len(DEMO)}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
