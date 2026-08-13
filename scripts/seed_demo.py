"""Наполняет базу демо-заказами, чтобы доска не была пустой.

    python -m scripts.seed_demo
"""

import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import clients as clients_logic  # noqa: E402
from app.database import SessionLocal, init_db  # noqa: E402
from app.models import Order, OrderEvent, OrderStatus  # noqa: E402
from app.routers.orders import next_number  # noqa: E402

DEMO = [
    dict(
        template_key="business_cards", status=OrderStatus.new,
        title="Визитки для кофейни", client_name="Кофейня «Причал»", client_phone="+7 918 111 22 33",
        quantity=1000, price=4900, prepaid=0, due=3, manager="Аня",
        params={"size": "90×50 мм", "paper": "Мелованная 350 г", "sides": "Двусторонняя",
                "lamination": "Матовая", "round_corners": True},
        notes="Макет присылают до среды, проверить вылеты.",
    ),
    dict(
        template_key="plotter_print", status=OrderStatus.confirmed,
        title="Баннер на фасад", client_name="Автосервис Гарант", client_phone="+7 928 404 90 12",
        quantity=1, price=3200, prepaid=1500, due=2, manager="Аня",
        params={"product": "Баннер", "material": "Баннер 510 г", "width_mm": 3000, "height_mm": 1000,
                "finish": "Проклейка + люверсы", "contour": False, "lamination": False},
    ),
    dict(
        template_key="plotter_cut", status=OrderStatus.in_work,
        title="Плёнка на витрину", client_name="Салон «Марго»", client_phone="+7 918 700 55 41",
        quantity=2, price=2600, prepaid=2600, due=1, manager="Сергей",
        params={"material": "Oracal 641 матовая", "width_mm": 1200, "height_mm": 600,
                "weeding": True, "transfer": True, "mounting": True},
        notes="Оклейка на месте в четверг после 15:00.",
    ),
    dict(
        template_key="print_color", status=OrderStatus.ready,
        title="Меню A4, ламинация", client_name="Столовая №1", client_phone="+7 988 300 11 09",
        quantity=40, price=2200, prepaid=0, due=0, manager="Сергей",
        params={"format": "A4", "sides": "Двусторонняя", "paper": "Мелованная 250 г",
                "lamination": "Глянцевая", "trim": False},
    ),
    dict(
        template_key="print_bw", status=OrderStatus.done,
        title="Копии договоров", client_name="ИП Лазарев", client_phone="+7 918 222 88 40",
        quantity=180, price=1150, prepaid=1150, due=-1, manager="Аня",
        params={"format": "A4", "sides": "Односторонняя", "paper": "Офисная 80 г", "binding": "Скоба"},
    ),
    dict(
        template_key="print_color", status=OrderStatus.new,
        title="Флаеры к открытию", client_name="Пекарня «Тесто»", client_phone="+7 918 909 14 77",
        quantity=500, price=0, prepaid=0, due=5, manager="",
        params={"format": "A6", "sides": "Двусторонняя", "paper": "Мелованная 130 г",
                "lamination": "Нет", "trim": True},
        notes="Ждём цену от дизайнера.",
    ),
]


def main() -> None:
    init_db()
    db = SessionLocal()
    if db.query(Order).count():
        print("В базе уже есть заказы — демо не добавляю.")
        return
    for item in DEMO:
        order = Order(
            number=next_number(db),
            template_key=item["template_key"],
            status=item["status"].value,
            title=item["title"],
            client_name=item["client_name"],
            client_phone=item["client_phone"],
            quantity=item["quantity"],
            params=item["params"],
            price=item["price"],
            prepaid=item["prepaid"],
            due_date=date.today() + timedelta(days=item["due"]),
            manager=item["manager"],
            notes=item.get("notes", ""),
        )
        # заводим карточку клиента, как это делает обычное создание заказа
        client = clients_logic.upsert(
            db, name=item["client_name"], phone=item["client_phone"]
        )
        if client is not None:
            order.client_id = client.id
        db.add(order)
        db.flush()
        db.add(OrderEvent(order_id=order.id, kind="created", text="Заказ создан", author=item["manager"]))
        db.commit()
    print(f"Добавлено демо-заказов: {len(DEMO)}")


if __name__ == "__main__":
    main()