"""Аналитика — чистые расчёты app/services/metrics.py без базы.

Проверяется то, что легко испортить незаметно: сравнение периодов, кто
считается новым клиентом, попадание в срок, порядок должников.
"""

from datetime import date, datetime, timedelta, timezone

from app.models import Order
from app.services import metrics


def order(**kw) -> Order:
    base = {"number": "x", "template_key": "t", "status": "done", "price": 1000.0, "prepaid": 1000.0, "refunded": False}
    base.update(kw)
    return Order(**base)


NOW = datetime(2026, 9, 8, 12, 0, tzinfo=timezone.utc)


def test_delta_к_прошлому_периоду():
    assert metrics.delta(120, 100) == 20.0
    assert metrics.delta(80, 100) == -20.0
    assert metrics.delta(50, 0) is None, "с нулём сравнивать нечего — не делим на ноль"
    assert metrics.delta(50, None) is None


def test_выручка_по_факту_а_не_по_прайсу():
    assert metrics.received(order(price=5000, prepaid=2000)) == 2000
    assert metrics.received(order(price=5000, prepaid=5000, refunded=True)) == 0
    assert metrics.unpaid(order(price=5000, prepaid=2000)) == 3000
    assert metrics.unpaid(order(price=5000, prepaid=0, refunded=True)) == 0, "возврат долгом не считается"


def test_доп_услуги_по_снимку_в_заказе():
    o = order(extras=[{"key": "a", "rate": 500, "qty": 2}, {"key": "b", "rate": 300}, {"bad": 1}])
    assert metrics.extras_sum(o) == 1300


def test_в_срок_считаются_только_заказы_со_сроком():
    done = [
        order(due_date=date(2026, 9, 5), completed_at=datetime(2026, 9, 5, 18, tzinfo=timezone.utc)),  # день в день — успели
        order(due_date=date(2026, 9, 5), completed_at=datetime(2026, 9, 6, 9, tzinfo=timezone.utc)),   # на день позже
        order(due_date=None, completed_at=datetime(2026, 9, 6, tzinfo=timezone.utc)),                  # без срока — не в счёт
    ]
    stats = metrics.on_time_stats(done)
    assert stats == {"count": 1, "total": 2, "rate": 50.0}
    assert metrics.on_time_stats([])["rate"] is None


def test_новый_клиент_это_чей_первый_заказ_в_периоде():
    since = NOW - timedelta(days=30)
    done = [
        order(client_id=1, prepaid=100),   # первый заказ давно — повторный
        order(client_id=2, prepaid=300),   # первый заказ в периоде — новый
        order(client_id=2, prepaid=200),   # второй заказ нового — всё равно новый
        order(client_id=None, prepaid=999),  # без карточки — не считается
    ]
    # принятые: новый клиент 3 оформил заказ, но его ещё не выдали — он всё равно пришёл
    created = [*done, order(client_id=3, status="new")]
    first = {1: NOW - timedelta(days=200), 2: NOW - timedelta(days=10), 3: NOW - timedelta(days=1)}
    split = metrics.split_clients(created, done, first, since)
    assert split["new"] == 2 and split["returning"] == 1
    assert split["new_sum"] == 500 and split["returning_sum"] == 100
    assert split["returning_share"] == round(100 / 600 * 100, 1)
    # «всё время»: первый заказ каждого по определению внутри — все новые
    assert metrics.split_clients(created, done, first, None)["returning"] == 0


def test_должники_выданные_сверху_потом_просроченные_в_работе():
    today = date(2026, 9, 8)
    rows = metrics.debtors(
        [
            order(id=1, number="A", status="done", price=1000, prepaid=0, completed_at=datetime(2026, 9, 1, tzinfo=timezone.utc)),
            order(id=2, number="B", status="in_work", price=5000, prepaid=1000, due_date=date(2026, 9, 1)),
            order(id=3, number="C", status="in_work", price=5000, prepaid=1000, due_date=date(2026, 9, 20)),  # срок не вышел
            order(id=4, number="D", status="done", price=800, prepaid=800),  # оплачен
            order(id=5, number="E", status="done", price=3000, prepaid=500, completed_at=datetime(2026, 9, 6, tzinfo=timezone.utc)),
        ],
        today,
    )
    assert [r["number"] for r in rows] == ["E", "A", "B"], "выданные — по размеру долга, потом просроченные"
    assert rows[0]["debt"] == 2500 and rows[0]["days"] == 2 and rows[0]["kind"] == "done"
    assert rows[2]["kind"] == "overdue" and rows[2]["days"] == 7


def test_зависшие_только_без_движения_дольше_порога():
    active = [
        order(id=1, number="A", status="in_work", updated_at=NOW - timedelta(days=10)),
        order(id=2, number="B", status="new", updated_at=NOW - timedelta(days=2)),
        order(id=3, number="C", status="ready", updated_at=None, created_at=NOW - timedelta(days=30)),
    ]
    rows = metrics.stale_orders(active, NOW)
    assert [r["number"] for r in rows] == ["C", "A"], "самые давние сверху; свежий не попадает"


def test_причины_отмен_частые_сверху_пустая_подписана():
    rows = metrics.cancel_reasons(
        [order(cancel_reason="передумал"), order(cancel_reason=""), order(cancel_reason="передумал"), order(cancel_reason="дорого")]
    )
    assert rows[0] == {"reason": "передумал", "count": 2}
    assert {r["reason"] for r in rows} == {"передумал", "без причины", "дорого"}


def test_сотрудники_принял_и_выдал_разные_множества():
    created = [order(manager="Аня"), order(manager="Аня"), order(manager="")]
    done = [order(manager="Аня", prepaid=700), order(manager="Сергей", prepaid=300)]
    rows = metrics.by_manager(created, done)
    assert rows[0] == {"name": "Аня", "created": 2, "done": 1, "sum": 700.0}
    assert {r["name"] for r in rows} == {"Аня", "Сергей", "—"}


def test_график_по_дням_добивает_пустые_дни_включая_края():
    since = NOW - timedelta(days=3)
    done = [order(prepaid=100, completed_at=NOW - timedelta(days=1))]
    series = metrics.series_of(done, since, NOW, by_month=False)
    assert [s["label"] for s in series] == ["2026-09-05", "2026-09-06", "2026-09-07", "2026-09-08"]
    assert [s["sum"] for s in series] == [0, 0, 100, 0]
    assert series[2]["count"] == 1


def test_нагрузка_по_дням_недели():
    rows = metrics.weekday_load([order(created_at=datetime(2026, 9, 7, tzinfo=timezone.utc), price=10), order(created_at=datetime(2026, 9, 7, tzinfo=timezone.utc), price=5)])
    assert rows[0] == {"label": "пн", "count": 2, "sum": 15.0}
    assert sum(r["count"] for r in rows) == 2
