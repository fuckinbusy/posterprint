"""Смысл денег в заказе: возврат, переплата, долг.

Решение владельца (17.08.2026): «вернули деньги» значит, что всё внесённое —
целиком, часть или сумму с переплатой — отдали клиенту обратно. Возврат при
нуле внесённого смысла не имеет. Переплата видна отдельно.
"""

from __future__ import annotations

import conftest  # noqa: F401 — добавляет корень проекта в sys.path
import pytest
from fastapi import HTTPException

from app.models import Order
from app.services.orders import check_refund, payment_state, surplus_of


def order(**kw) -> Order:
    base = {"number": "x", "template_key": "t", "status": "new", "price": 0.0, "prepaid": 0.0, "refunded": False}
    base.update(kw)
    return Order(**base)


def test_возврат_у_живого_заказа_возвращает_долг_целиком():
    """Внесённого больше нет — платить придётся заново."""
    state, debt = payment_state(order(price=5000, prepaid=2000, refunded=True, status="in_work"))
    assert state == "refunded"
    assert debt == 5000


def test_возврат_у_отменённого_долга_не_оставляет():
    state, debt = payment_state(order(price=5000, prepaid=2000, refunded=True, status="cancelled"))
    assert state == "refunded"
    assert debt == 0


def test_переплата_видна_отдельно():
    o = order(price=1000, prepaid=1300)
    state, debt = payment_state(o)
    assert state == "overpaid"
    assert debt == 0
    assert surplus_of(o) == 300


def test_ровно_столько_сколько_стоит_это_оплачен_а_не_переплата():
    assert payment_state(order(price=1000, prepaid=1000))[0] == "paid"
    assert surplus_of(order(price=1000, prepaid=1000)) == 0


def test_копейки_не_дают_ложной_переплаты():
    """Сумма с плавающей точкой: 0.1 + 0.2 не должно становиться «переплатой»."""
    assert payment_state(order(price=0.3, prepaid=0.1 + 0.2))[0] == "paid"


def test_переплата_после_возврата_не_считается():
    assert surplus_of(order(price=1000, prepaid=1300, refunded=True)) == 0


def test_возврат_без_внесённого_отклоняется():
    """Раньше возврат при нуле просто обнулял долг — способ списать заказ."""
    with pytest.raises(HTTPException) as exc:
        check_refund(True, 0)
    assert exc.value.status_code == 422
    check_refund(True, 500)   # есть что возвращать
    check_refund(False, 0)    # без возврата ноль в порядке
