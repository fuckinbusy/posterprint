"""Симуляция живой мастерской: 80 клиентов, ~160 заказов по настоящему прайсу.

    python -m scripts.seed_demo              # добавить, если заказов ещё нет
    python -m scripts.seed_demo --replace    # стереть заказы, клиентов, кассу — залить заново
    python -m scripts.seed_demo --replace --yes
    python -m scripts.seed_demo --orders 200 --clients 80 --seed 7

Зачем. Проверить систему на данных, похожих на настоящие: доска с сотней
карточек, клиенты с историей в несколько заказов, касса за прошлые дни,
метрики за квартал. Каждый заказ проходит путь, как его прошли бы руками:
создан → подтверждён → в работе → готов → выдан (или отменён), с событиями,
платежами и сроками в правдоподобное время.

Что покрыто (все сценарии, которые система умеет показывать):
* все виды работ настоящего каталога, параметры под каждый — размеры,
  бумага, цветность, тираж — правдоподобные для этого вида;
* доп. услуги к четверти заказов: макет, замеры, монтаж, вёрстка;
* все статусы; отменённые — с причиной, часть с возвратом предоплаты;
* деньги: без цены, не оплачен, предоплата частями, оплачен полностью,
  переплата, выдан с недоплатой, возврат; наличные и переводы, каждое
  движение — строкой в кассе с датой и сотрудником;
* сроки: просроченные, «сегодня», ближайшие дни, далёкие, без срока;
  выданные — часть с опозданием против срока;
* клиенты: организации и частные лица, у трети — по 2–6 заказов,
  контакты и заметки у части, повторы одного телефона склеиваются;
* сотрудники: три профиля приёмки без пароля (вход по имени) — чтобы
  касса и история показывали, кто что делал; администратор остаётся.

Цены считаются тем же расчётом, что и кнопка «Рассчитать»: смета в карточке
сходится с суммой. Часть цен «поправлена руками», как делает приёмка.
Генератор детерминированный: один и тот же --seed даёт одни и те же данные.

Каталог должен быть на месте (`python -m scripts.seed_workshop`).
"""

from __future__ import annotations

import argparse
import random
import sys
from datetime import UTC, date, datetime, time, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import delete, select

from app.services import catalog, pricing
from app.services import clients as clients_logic

# консоль Windows по умолчанию в cp1251 — на «₽» в выводе скрипт падал
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
from app.core.database import SessionLocal, init_db
from app.core.permissions import default_permissions, normalize
from app.models import (
    STATUS_META,
    Client,
    Employee,
    Order,
    OrderEvent,
    OrderStatus,
    Payment,
)
from app.services.orders import next_number

ADMIN = "Администратор"
# приёмка: имя → какие права сверх обычных. Пароля нет — вход по имени.
STAFF: dict[str, list[str]] = {
    "Аня": ["finance.totals", "notify.orders"],
    "Сергей": ["finance.totals", "finance.cash", "notify.orders"],
    "Марина": ["orders.estimate"],
}

# ---------------------------------------------------------------- клиенты
COMPANY_KINDS = [
    ("Автосервис", ["«Гарант»", "«Мотор»", "«Пит-стоп»", "«Дизель»", "«Форсаж»"]),
    ("Кофейня", ["«Причал»", "«Зерно»", "«Тёплый пар»", "«Утро»"]),
    ("Стоматология", ["«Дента»", "«Улыбка»", "«Жемчуг»"]),
    ("Салон красоты", ["«Лилия»", "«Багира»", "«Шарм»"]),
    ("Магазин", ["«Стройдвор»", "«Мир обуви»", "«Продукты 24»", "«Дачник»"]),
    ("Пекарня", ["«Тесто»", "«Хлебная лавка»"]),
    ("Школа", ["№ 12", "№ 7", "«Эрудит»"]),
    ("Фитнес", ["«Атлет»", "«Пульс»"]),
    ("Аптека", ["«Здоровье»", "«Вита»"]),
    ("Мебель", ["«Мебель-Сити»", "«Кухни Люкс»"]),
    ("Агентство недвижимости", ["«Дом»", "«Квартал»"]),
    ("Ресторан", ["«Причал»", "«Кавказская кухня»", "«Пельмень»"]),
    ("Ветклиника", ["«Кот и пёс»"]),
    ("Турфирма", ["«Юг»"]),
    ("Ателье", ["«Стежок»"]),
    ("Детский центр", ["«Смайлик»", "«Умка»"]),
]
LEGAL = ["ООО", "ИП", "", "", ""]
FIRST_M = ["Андрей", "Сергей", "Дмитрий", "Максим", "Илья", "Артём", "Никита", "Олег", "Виктор", "Роман"]
FIRST_F = ["Анна", "Мария", "Елена", "Ольга", "Наталья", "Ирина", "Светлана", "Дарья", "Юлия", "Татьяна"]
LAST = ["Иванов", "Петров", "Смирнов", "Кузнецов", "Попов", "Лебедев", "Козлов", "Новиков", "Морозов",
        "Волков", "Соколов", "Зайцев", "Павлов", "Семёнов", "Голубев", "Виноградов", "Богданов", "Воробьёв"]
CONTACT_KINDS = ["tg", "mail", "wa", ""]
CLIENT_NOTES = [
    "Звонить после 14:00", "Оплата по счёту, бухгалтерия — Ольга", "Просит матовую ламинацию всегда",
    "Забирает муж", "Постоянный клиент, скидка 5 %", "Макеты присылает в Telegram", "",
]


def phone(rnd: random.Random, used: set[str]) -> str:
    while True:
        code = rnd.choice(["918", "928", "938", "988", "989", "961", "903"])
        number = f"+7 {code} {rnd.randint(100, 999)}-{rnd.randint(10, 99):02d}-{rnd.randint(10, 99):02d}"
        if number not in used:
            used.add(number)
            return number


def make_clients(rnd: random.Random, count: int) -> list[dict]:
    used: set[str] = set()
    out: list[dict] = []
    names: set[str] = set()
    companies = int(count * 0.6)
    while len(out) < companies:
        kind, variants = rnd.choice(COMPANY_KINDS)
        name = f"{rnd.choice(LEGAL)} {kind} {rnd.choice(variants)}".strip()
        if name in names:
            continue
        names.add(name)
        slug = kind.lower().split()[0]
        contact = ""
        ck = rnd.choice(CONTACT_KINDS)
        if ck == "mail":
            contact = f"{slug}{rnd.randint(1, 99)}@mail.ru"
        elif ck == "tg":
            contact = f"@{slug}_{rnd.randint(10, 99)}"
        elif ck == "wa":
            contact = "WhatsApp"
        out.append({"name": name, "phone": phone(rnd, used), "contact": contact,
                    "notes": rnd.choice(CLIENT_NOTES) if rnd.random() < 0.3 else "", "kind": "company"})
    while len(out) < count:
        female = rnd.random() < 0.5
        first = rnd.choice(FIRST_F if female else FIRST_M)
        last = rnd.choice(LAST) + ("а" if female else "")
        name = f"{last} {first}"
        if name in names:
            continue
        names.add(name)
        out.append({"name": name, "phone": phone(rnd, used), "contact": "",
                    "notes": rnd.choice(CLIENT_NOTES) if rnd.random() < 0.15 else "", "kind": "person"})
    return out


# ---------------------------------------------------------------- заказы
# вес вида работ в потоке заказов — как в жизни печатного цеха
TEMPLATE_WEIGHTS = {
    "banner_print": 18, "film_print": 15, "cards_poly": 14, "cards_uv": 5, "flyers": 7,
    "digital_print": 8, "sign": 8, "riso": 3, "booklets": 3, "canvas_print": 3,
    "discount_cards": 2, "pocket": 2, "souvenirs": 4, "pens": 2, "badges": 2, "uv_dtf": 2,
}
QUANTITY = {
    "banner_print": [1, 1, 1, 2, 3], "film_print": [1, 1, 2, 3, 5, 10], "canvas_print": [1, 1, 2],
    "sign": [1, 1, 2, 4], "pocket": [2, 4, 6, 10], "cards_poly": [100, 100, 200, 300, 500, 1000, 1500],
    "cards_uv": [20, 40, 100, 120, 200, 300, 500], "discount_cards": [20, 60, 100, 250, 500],
    "digital_print": [5, 10, 20, 50, 100, 300], "flyers": [100, 200, 300, 500, 1000],
    "booklets": [100, 200, 300, 500], "riso": [50, 100, 200, 400, 600], "souvenirs": [1, 2, 6, 10, 30],
    "pens": [20, 50, 110, 300], "badges": [1, 3, 6, 12], "uv_dtf": [1, 3, 5, 12],
}
# размеры в метрах: (ширина, высота) — правдоподобные для вида
SIZES = {
    "banner_print": [(3, 1), (2, 1), (6, 1), (4, 2), (1.5, 1), (3, 2), (12, 1)],
    "film_print": [(1, 0.5), (0.6, 0.4), (2, 1), (1.2, 0.8), (0.3, 0.3), (3, 1.5)],
    "canvas_print": [(0.6, 0.4), (0.9, 0.6), (1.2, 0.8), (0.4, 0.4)],
    "sign": [(0.3, 0.2), (0.6, 0.4), (0.4, 0.3), (1, 0.5), (0.2, 0.15)],
}
TITLES = {
    "banner_print": ["Баннер на фасад", "Растяжка «Распродажа»", "Баннер на забор", "Баннер к открытию",
                     "Пресс-волл", "Баннер на сцену"],
    "film_print": ["Наклейка на витрину", "Плёнка на стекло", "Оклейка стойки", "Наклейки на авто",
                   "Табличка «Открыто»", "Оракал на дверь"],
    "canvas_print": ["Фото на холсте", "Картина на холсте", "Портрет на холсте"],
    "sign": ["Табличка на дверь", "Вывеска на вход", "Табличка режим работы", "Указатель", "Информационный стенд"],
    "pocket": ["Кармашки для стенда", "Кармашки А4 для доски объявлений"],
    "cards_poly": ["Визитки", "Визитки для сотрудников", "Визитки директора", "Визитки, обновление тиража"],
    "cards_uv": ["Визитки УФ", "Визитки крафт", "Визитки с белилами"],
    "discount_cards": ["Дисконтные карты", "Карты постоянного клиента"],
    "digital_print": ["Печать документов", "Меню А4", "Прайс-листы", "Грамоты", "Печать А3 цвет"],
    "flyers": ["Флаеры к акции", "Листовки в ящики", "Флаеры на раздачу"],
    "booklets": ["Буклеты о компании", "Буклеты меню"],
    "riso": ["Бланки", "Методички", "Тетради для школы", "Квитанции"],
    "souvenirs": ["Кружки с логотипом", "Магниты", "Брелоки", "Значки", "Футболки с принтом"],
    "pens": ["Ручки с логотипом", "Карандаши с надписью"],
    "badges": ["Бейджи сотрудникам", "Бейджи на конференцию"],
    "uv_dtf": ["Наклейки УФ-ДТФ", "Наклейки на термосы"],
}
ORDER_NOTES = [
    "Макет прислали в Telegram", "Позвонить перед выдачей", "Срочно — к открытию", "Цвет как в прошлый раз",
    "Люверсы по углам и через метр", "Без ламинации, клиент против", "Забирают в пятницу после 16",
    "Скругление углов обязательно", "Проверить телефон в макете", "",
]
CANCEL_REASONS = [
    "Клиент передумал", "Нашли дешевле", "Не согласовали макет", "Не вышли на связь", "Дубль заказа",
    "Перенесли на следующий месяц",
]
EXTRAS_BY_TEMPLATE = {
    "banner_print": ["Простой макет", "Замеры", "Монтаж простой"],
    "film_print": ["Простой макет", "Замеры", "Монтаж простой"],
    "sign": ["Простой макет", "Замеры", "Монтаж простой"],
    "canvas_print": ["Простой макет"],
    "cards_poly": ["Простой макет"], "cards_uv": ["Простой макет", "Сложный макет"],
    "flyers": ["Простой макет", "Сложный макет"], "booklets": ["Сложный макет", "Вёрстка"],
    "digital_print": ["Набор текста", "Вёрстка"], "riso": ["Набор текста"],
    "souvenirs": ["Простой макет"], "pens": ["Простой макет"], "badges": ["Простой макет"],
    "discount_cards": ["Простой макет"], "uv_dtf": ["Простой макет"],
}
STATUS_TITLE = {status: meta["title"] for status, meta in STATUS_META.items()}
PATH = [OrderStatus.new, OrderStatus.confirmed, OrderStatus.in_work, OrderStatus.ready, OrderStatus.done]


def weighted(rnd: random.Random, table: dict) -> str:
    keys = list(table)
    return rnd.choices(keys, weights=[table[k] for k in keys], k=1)[0]


def business_moment(rnd: random.Random, day: date) -> datetime:
    """Момент в рабочее время дня, в UTC (мастерская живёт по UTC+8)."""
    hour = rnd.choice([9, 10, 10, 11, 11, 12, 13, 14, 14, 15, 16, 16, 17, 18])
    local = datetime.combine(day, time(hour, rnd.randint(0, 59)))
    return (local - timedelta(hours=8)).replace(tzinfo=UTC)


def pick_params(rnd: random.Random, template: dict) -> dict:
    """Параметры под поля вида работ: списки — вариант, размеры — из таблицы
    правдоподобных, галочки — иногда, счётчики — по ситуации."""
    key = template["key"]
    params: dict = {}
    size = rnd.choice(SIZES.get(key, [(1, 1)]))
    for field in template["fields"]:
        role = field["pricing_role"]
        if role == "width":
            params[field["key"]] = size[0]
        elif role == "height":
            params[field["key"]] = size[1]
        elif field["type"] == "select":
            options = list(field["options"])
            if not options:
                continue
            if not field["required"] and rnd.random() < 0.55:
                params[field["key"]] = ""      # необязательный список чаще пуст
            else:
                # первые варианты популярнее: «Баннер до 2 м» чаще акрила
                weights = [max(len(options) - i, 1) for i in range(len(options))]
                params[field["key"]] = rnd.choices(options, weights=weights, k=1)[0]
        elif field["type"] == "bool":
            params[field["key"]] = rnd.random() < 0.3
        elif field["type"] == "number":
            if field["key"] == "grommets":
                params[field["key"]] = rnd.choice([0, 4, 6, 8, 12, 16]) if rnd.random() < 0.7 else 0
            elif field["key"] in ("holes", "tape"):
                params[field["key"]] = rnd.choice([0, 0, 2, 4])
            else:
                params[field["key"]] = 0
        elif field["type"] == "text":
            params[field["key"]] = rnd.choice(["Логотип и телефон", "Меню на 6 листов", ""])
    # баннер — материал по размеру, как в прайсе
    if key == "banner_print":
        big = size[0] >= 2 or size[1] >= 2
        mesh = "Сетка" in str(params.get("material", ""))
        params["material"] = ("Сетка" if mesh else "Баннер") + (" от 2 м" if big else " до 2 м")
    return params


def pick_extras(rnd: random.Random, key: str, extras_catalog: dict[str, dict]) -> list[dict]:
    pool = [k for k in EXTRAS_BY_TEMPLATE.get(key, []) if k in extras_catalog]
    if not pool or rnd.random() > 0.25:
        return []
    chosen = rnd.sample(pool, k=min(len(pool), rnd.choice([1, 1, 2])))
    out = []
    for k in chosen:
        item = extras_catalog[k]
        qty = rnd.choice([4, 8, 12]) if "шт" in item["unit"] else 1
        out.append({"key": k, "title": item["title"], "qty": qty, "rate": item["price"]})
    return out


def title_for(rnd: random.Random, key: str, params: dict, client: dict) -> str:
    base = rnd.choice(TITLES.get(key, [key]))
    if key in SIZES and "width" in params:
        w, h = params["width"], params["height"]
        base = f"{base} {w:g}×{h:g} м"
    if client["kind"] == "company" and rnd.random() < 0.5:
        short = client["name"].split("«")[-1].rstrip("»") if "«" in client["name"] else client["name"]
        base = f"{base} — {short}"
    return base


def choose_status(rnd: random.Random, age_days: int) -> OrderStatus:
    if age_days > 21:
        table = {"done": 85, "cancelled": 8, "ready": 5, "in_work": 2}
    elif age_days > 7:
        table = {"done": 45, "ready": 20, "in_work": 20, "confirmed": 8, "cancelled": 7}
    elif age_days > 2:
        table = {"in_work": 35, "confirmed": 25, "ready": 20, "new": 10, "done": 7, "cancelled": 3}
    else:
        table = {"new": 50, "confirmed": 30, "in_work": 15, "cancelled": 5}
    return OrderStatus(weighted(rnd, table))


def round_price(value: float) -> float:
    return float(round(value / 10) * 10)


def ensure_staff(db) -> None:
    existing = {e.name for e in db.scalars(select(Employee)).all()}
    for name, extra in STAFF.items():
        if name in existing:
            continue
        db.add(Employee(name=name, password_hash="", permissions=normalize(default_permissions() + extra), active=True))
    db.commit()


def wipe(db) -> None:
    for model in (Payment, OrderEvent, Order, Client):
        db.execute(delete(model))
    db.commit()
    print("[i] Заказы, история, касса и клиенты стёрты.")


# ---------------------------------------------------------------- генерация одного заказа
def generate_order(db, rnd: random.Random, client: dict, templates: dict[str, dict],
                   extras_catalog: dict[str, dict], today: date, force_due_today: bool) -> Order:
    key = weighted(rnd, {k: w for k, w in TEMPLATE_WEIGHTS.items() if k in templates})
    template = templates[key]
    params = pick_params(rnd, template)
    quantity = rnd.choice(QUANTITY.get(key, [1]))
    extras = pick_extras(rnd, key, extras_catalog)
    manager = rnd.choice([*STAFF, ADMIN])

    age = rnd.choice(list(range(0, 3)) * 4 + list(range(3, 8)) * 3 + list(range(8, 22)) * 2 + list(range(22, 90)))
    created_day = today - timedelta(days=age)
    created_at = business_moment(rnd, created_day)
    status = choose_status(rnd, age)

    # срок: через 1–10 дней после приёма; у части — нет
    if force_due_today:
        due = today
    elif rnd.random() < 0.08:
        due = None
    else:
        due = created_day + timedelta(days=rnd.choice([1, 2, 2, 3, 3, 4, 5, 7, 10]))
        if status in (OrderStatus.new, OrderStatus.confirmed, OrderStatus.in_work, OrderStatus.ready) and due < today and rnd.random() < 0.6:
            due = today + timedelta(days=rnd.randint(0, 4))  # большинство живых заказов ещё в сроке

    # цена — расчётом, иногда поправлена рукой; у части новых её ещё нет
    est = pricing.estimate(db, key, quantity, params, [{"key": e["key"], "qty": e["qty"]} for e in extras])
    price = round_price(est["price"] or 0)
    if price and rnd.random() < 0.15:
        price = round_price(price * rnd.choice([0.9, 0.95, 1.05, 1.1]))
    if status == OrderStatus.new and rnd.random() < 0.2:
        price = 0.0
    if price and price < 100:
        price = 100.0  # минимальный чек мастерской

    order = Order(
        number=next_number(db), template_key=key, status=status.value,
        title=title_for(rnd, key, params, client),
        client_name=client["name"], client_phone=client["phone"], client_contact=client["contact"],
        quantity=quantity, params=params, extras=extras, price=price, prepaid=0.0, refunded=False,
        due_date=due, manager=manager, notes=rnd.choice(ORDER_NOTES) if rnd.random() < 0.35 else "",
        created_at=created_at, updated_at=created_at,
    )
    card = clients_logic.upsert(db, name=client["name"], phone=client["phone"], contact=client["contact"])
    if card is not None:
        order.client_id = card.id
        if client.get("notes") and not card.notes:
            card.notes = client["notes"]
    db.add(order)
    db.flush()

    events: list[OrderEvent] = [OrderEvent(order_id=order.id, kind="created",
                                           text=f"Заказ создан — {order.title}", author=manager, created_at=created_at)]
    payments: list[Payment] = []
    method = lambda: rnd.choice(["cash", "cash", "transfer", "transfer", "cash"])  # noqa: E731

    def pay(amount: float, at: datetime, who: str) -> None:
        if not amount:
            return
        payments.append(Payment(order_id=order.id, amount=amount, method=method(), author=who, created_at=at))
        order.prepaid = round(float(order.prepaid) + amount, 2)
        events.append(OrderEvent(order_id=order.id, kind="edited", text="Изменено: предоплата",
                                 author=who, created_at=at))

    # путь по статусам — по времени между приёмом и сегодня (или сроком)
    finish_day = min(today, due) if (due and status == OrderStatus.done) else today
    if status == OrderStatus.done and rnd.random() < 0.15 and due:
        finish_day = due + timedelta(days=rnd.randint(1, 3))  # выдан с опозданием
    finish_day = min(finish_day, today)
    span = max((finish_day - created_day).days, 0)
    steps = PATH[: PATH.index(status) + 1] if status != OrderStatus.cancelled else [OrderStatus.new]
    moment = created_at
    for i in range(1, len(steps)):
        frac = i / max(len(steps) - 1, 1)
        day = created_day + timedelta(days=int(span * frac))
        moment = max(business_moment(rnd, day), moment + timedelta(minutes=20))
        events.append(OrderEvent(order_id=order.id, kind="status",
                                 text=f"{STATUS_TITLE[steps[i - 1]]} → {STATUS_TITLE[steps[i]]}",
                                 author=rnd.choice(list(STAFF)), created_at=moment))

    # деньги по сценарию статуса
    if price:
        if status == OrderStatus.done:
            roll = rnd.random()
            if roll < 0.45:
                pay(price, moment, manager)                                  # всё при выдаче
            elif roll < 0.78:
                half = round_price(price * rnd.choice([0.3, 0.5, 0.5, 0.7]))
                pay(half, created_at + timedelta(minutes=5), manager)        # предоплата
                pay(price - half, moment, rnd.choice(list(STAFF)))           # доплата при выдаче
            elif roll < 0.88:
                pay(round_price(price * rnd.choice([0.5, 0.7])), created_at + timedelta(minutes=5), manager)  # недоплата
            elif roll < 0.93:
                pay(price + rnd.choice([50, 100, 200]), moment, manager)     # переплата
            # остальные — выданы без оплаты (оплата по счёту позже)
        elif status in (OrderStatus.confirmed, OrderStatus.in_work, OrderStatus.ready):
            roll = rnd.random()
            if roll < 0.35:
                pay(round_price(price * rnd.choice([0.3, 0.5, 0.5])), created_at + timedelta(minutes=5), manager)
            elif roll < 0.55:
                pay(price, created_at + timedelta(minutes=5), manager)
        elif status == OrderStatus.new:
            if rnd.random() < 0.3:
                pay(round_price(price * 0.5), created_at + timedelta(minutes=5), manager)
        elif status == OrderStatus.cancelled:
            cancel_at = max(business_moment(rnd, created_day + timedelta(days=min(span, rnd.randint(0, 3)))),
                            created_at + timedelta(hours=1))
            if rnd.random() < 0.5:
                pay(round_price(price * 0.5), created_at + timedelta(minutes=5), manager)
                if rnd.random() < 0.8:
                    # вернули всё внесённое
                    payments.append(Payment(order_id=order.id, amount=-order.prepaid, method=method(),
                                            author=manager, created_at=cancel_at))
                    order.refunded = True
            order.cancel_reason = rnd.choice(CANCEL_REASONS)
            events.append(OrderEvent(order_id=order.id, kind="status",
                                     text=f"Новый → Отменён · причина: {order.cancel_reason}",
                                     author=manager, created_at=cancel_at))
            moment = cancel_at

    if status == OrderStatus.cancelled and not price:
        cancel_at = created_at + timedelta(hours=2)
        order.cancel_reason = rnd.choice(CANCEL_REASONS)
        events.append(OrderEvent(order_id=order.id, kind="status",
                                 text=f"Новый → Отменён · причина: {order.cancel_reason}",
                                 author=manager, created_at=cancel_at))
        moment = cancel_at

    if rnd.random() < 0.15:
        events.append(OrderEvent(order_id=order.id, kind="note", text=rnd.choice(ORDER_NOTES[:-1]),
                                 author=rnd.choice(list(STAFF)), created_at=created_at + timedelta(hours=1)))
    if price and rnd.random() < 0.1:
        events.append(OrderEvent(order_id=order.id, kind="edited", text="Изменено: стоимость",
                                 author=ADMIN, created_at=created_at + timedelta(hours=2)))

    if status == OrderStatus.done:
        order.completed_at = moment
    order.updated_at = max(e.created_at for e in events)
    db.add_all(events)
    db.add_all(payments)
    return order


# ---------------------------------------------------------------- main
def main() -> None:
    parser = argparse.ArgumentParser(description="Симуляция заказов мастерской")
    parser.add_argument("--replace", action="store_true", help="стереть заказы, клиентов и кассу, залить заново")
    parser.add_argument("--yes", action="store_true", help="не спрашивать подтверждения")
    parser.add_argument("--orders", type=int, default=160, help="сколько заказов (по умолчанию 160)")
    parser.add_argument("--clients", type=int, default=80, help="сколько клиентов (по умолчанию 80)")
    parser.add_argument("--seed", type=int, default=2026, help="зерно генератора — те же данные при повторе")
    args = parser.parse_args()

    init_db()
    db = SessionLocal()
    try:
        templates = {t["key"]: t for t in catalog.all_templates(db)}
        missing = set(TEMPLATE_WEIGHTS) - set(templates)
        if missing:
            print(f"[i] В каталоге нет видов работ {sorted(missing)} — заказы по ним не генерирую.")
        if not (set(TEMPLATE_WEIGHTS) & set(templates)):
            raise SystemExit("Каталог пуст — сначала python -m scripts.seed_workshop")
        extras_catalog = {item["key"]: item for item in pricing.extras_catalog(db)}

        if db.scalar(select(Order).limit(1)) is not None:
            if not args.replace:
                print("В базе уже есть заказы — симуляцию не добавляю. Заменить: --replace")
                return
            if not args.yes and sys.stdin and sys.stdin.isatty():
                answer = input("Стереть ВСЕ заказы, клиентов и кассу и залить симуляцию? [y/N] ")
                if answer.strip().lower() not in ("y", "yes", "д", "да"):
                    print("Отменено.")
                    return
            wipe(db)

        rnd = random.Random(args.seed)
        ensure_staff(db)
        clients = make_clients(rnd, args.clients)
        # у трети клиентов несколько заказов: веса — сколько раз клиент «приходит»
        weights = [rnd.choice([1, 1, 1, 1, 2, 3, 4, 6]) for _ in clients]
        # пять клиентов — только в справочнике, без заказов: заведены на будущее
        for i in rnd.sample(range(len(clients)), k=min(5, len(clients))):
            weights[i] = 0
            clients_logic.upsert(db, name=clients[i]["name"], phone=clients[i]["phone"], contact=clients[i]["contact"])
        today = date.today()
        due_today_left = 6
        # каждому клиенту с заказами — хотя бы один, остальное по весам:
        # иначе у части справочника заказов не оказывалось вовсе
        with_orders = [c for c, w in zip(clients, weights, strict=True) if w > 0]
        plan = list(with_orders) + rnd.choices(clients, weights=weights, k=max(args.orders - len(with_orders), 0))
        rnd.shuffle(plan)
        orders: list[Order] = []
        for client in plan:
            force = due_today_left > 0 and rnd.random() < 0.08
            if force:
                due_today_left -= 1
            orders.append(generate_order(db, rnd, client, templates, extras_catalog, today, force))
        db.commit()

        # номера — по времени приёма: перенумеровываем после генерации.
        # В два шага: номера уникальны, и прямая перестановка упёрлась бы в
        # уже занятый номер посреди обновления
        ordered = sorted(orders, key=lambda o: o.created_at)
        year = today.year
        for order in ordered:
            order.number = f"tmp-{order.id}"
        db.flush()
        for i, order in enumerate(ordered, start=1):
            order.number = f"ЗК-{year}-{i:06d}"
        db.commit()

        by_status: dict[str, int] = {}
        for o in orders:
            by_status[o.status] = by_status.get(o.status, 0) + 1
        by_template: dict[str, int] = {}
        for o in orders:
            by_template[o.template_key] = by_template.get(o.template_key, 0) + 1
        repeat = sum(1 for c in db.scalars(select(Client)).all()
                     if db.scalar(select(Order).where(Order.client_id == c.id).limit(1)) is not None
                     and len(db.scalars(select(Order.id).where(Order.client_id == c.id)).all()) > 1)
        cash = db.scalars(select(Payment)).all()
        print(f"Симуляция: {len(orders)} заказов, {len(clients)} клиентов ({repeat} с несколькими заказами), "
              f"{len(cash)} движений в кассе на {sum(p.amount for p in cash):,.0f} ₽".replace(",", " "))
        print("По статусам:", ", ".join(f"{STATUS_TITLE[OrderStatus(k)]} {v}" for k, v in sorted(by_status.items())))
        print("По видам работ:", ", ".join(f"{templates[k]['short']} {v}" for k, v in sorted(by_template.items(), key=lambda kv: -kv[1])))
        print(f"Сотрудники без пароля: {', '.join(STAFF)} — вход по имени.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
