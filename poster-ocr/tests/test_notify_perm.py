"""Право «Получать уведомления о новых заказах» и выборка свежих заказов.

Уведомления приходят только тому, у кого право включено, и только о чужих
заказах: свой человек и так видит. Сама выборка — чистая функция от списка,
проверяется без базы.
"""

from __future__ import annotations

import conftest  # noqa: F401 — добавляет корень проекта в sys.path

from app.core.permissions import PERMISSIONS_BY_KEY, default_permissions, normalize
from app.models import Order
from app.services.orders import fresh_orders_filter


def order(id: int, manager: str) -> Order:
    return Order(id=id, number=f"x{id}", template_key="t", status="new", manager=manager)


def test_право_есть_и_по_умолчанию_выключено():
    assert "notify.orders" in PERMISSIONS_BY_KEY
    assert "notify.orders" not in default_permissions()


def test_уведомления_тянут_право_видеть_доску():
    assert "orders.view" in normalize(["notify.orders"])


def test_отбираются_только_новые_и_чужие():
    rows = [order(1, "Аня"), order(2, "Сергей"), order(3, "Аня"), order(4, "Сергей")]
    picked = fresh_orders_filter(rows, after=2, me="Аня")
    assert [o.id for o in picked] == [4]


def test_без_точки_отсчёта_ничего_не_всплывает():
    """Первый запрос после входа — только узнать край, не заваливать старым."""
    rows = [order(1, "Аня"), order(2, "Сергей")]
    assert fresh_orders_filter(rows, after=None, me="Аня") == []
