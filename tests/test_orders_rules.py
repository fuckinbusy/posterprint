"""Правила заказов и клиентов, найденные ревизией кода.

Каждый тест здесь — про ошибку, которая уже была в коде и не падала:
право на цену, которое никто не спрашивал; переименование карточки
клиента из одного заказа; статус «Выдан» при создании в обход переходов.

База — своя, в памяти: правила про клиентов без неё не проверить, а
поднимать ради этого весь сервер незачем.
"""

from __future__ import annotations

import conftest  # noqa: F401 — добавляет корень проекта в sys.path
import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.core.security import CurrentUser
from app.models import Client, Order
from app.schemas import OrderCreate
from app.services import clients, phones
from app.services.orders import MONEY_FIELDS, require_money_rights


@pytest.fixture
def db():
    engine = create_engine("sqlite://", future=True)
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine, expire_on_commit=False)()
    try:
        yield session
    finally:
        session.close()


def user(*perms: str) -> CurrentUser:
    return CurrentUser("employee", "Тест", list(perms), employee_id=1)


# ------------------------------------------------------------------ право на деньги
def test_цену_меняет_только_тот_кому_разрешено():
    """orders.price.edit существовало в справочнике, но ни одна ручка его не
    спрашивала: профиль с одним orders.edit переписывал цену вслепую."""
    editor = user("orders.view", "orders.edit")
    with pytest.raises(HTTPException) as exc:
        require_money_rights(editor, {"price"})
    assert exc.value.status_code == 403

    for field in MONEY_FIELDS:
        with pytest.raises(HTTPException):
            require_money_rights(editor, {field})


def test_без_денежных_полей_право_не_нужно():
    require_money_rights(user("orders.edit"), {"title", "notes", "due_date"})


def test_с_правом_можно():
    require_money_rights(user("orders.edit", "orders.price.edit"), {"price", "prepaid"})


# ------------------------------------------------------------------ статус при создании
def test_статус_при_создании_не_принимается():
    """Раньше можно было создать заказ сразу «Выданным» — мимо таблицы
    переходов и без completed_at, из-за чего он ещё и попадал в выручку."""
    payload = OrderCreate(template_key="banner_print", status="done")  # type: ignore[call-arg]
    assert not hasattr(payload, "status")


# ------------------------------------------------------------------ карточка клиента
def test_правка_имени_в_заказе_не_переименовывает_карточку(db):
    """Имя в заказе — снимок на момент сделки. Раньше опечатка, исправленная
    в одном заказе, переименовывала клиента во всех его заказах и в метриках."""
    card = Client(name="ИП Иванов А.Д.", phone="+7 900 111-22-33", phone_norm="79001112233")
    db.add(card)
    db.flush()

    found = clients.upsert(db, name="Иванов", phone="+7 900 111-22-33", client_id=card.id)
    assert found is card
    assert card.name == "ИП Иванов А.Д."


def test_пустые_поля_карточки_дополняются_из_заказа(db):
    card = Client(name="Иванов", phone="", phone_norm=None)
    db.add(card)
    db.flush()

    clients.upsert(db, name="Иванов", phone="8 900 111-22-33", contact="tg", client_id=card.id)
    assert card.phone == "8 900 111-22-33"
    assert card.phone_norm == "79001112233"
    assert card.contact == "tg"


def test_чужой_номер_в_заказе_не_ломает_запрос(db):
    """Раньше: клиент A на заказе, в заказ вписали номер клиента B → в карточку A
    писался номер B → уникальный индекс → 500. Теперь заказ привязывается к B."""
    a = Client(name="A", phone="+7 900 111-22-33", phone_norm="79001112233")
    b = Client(name="B", phone="+7 900 444-55-66", phone_norm="79004445566")
    db.add_all([a, b])
    db.flush()

    found = clients.upsert(db, name="A", phone="+7 900 444-55-66", client_id=a.id)
    assert found is b
    assert a.phone_norm == "79001112233"   # карточку A не тронули


def test_новый_номер_у_известного_клиента_заводит_новую_карточку(db):
    a = Client(name="A", phone="+7 900 111-22-33", phone_norm="79001112233")
    db.add(a)
    db.flush()

    found = clients.upsert(db, name="A", phone="+7 900 999-88-77", client_id=a.id)
    assert found is not None and found is not a
    assert found.phone_norm == "79009998877"


# ------------------------------------------------------------------ суммы по клиенту
def test_сумма_клиента_не_считает_отменённые_и_возвраты(db):
    card = Client(name="C", phone="+7 900 000-00-01", phone_norm="79000000001")
    db.add(card)
    db.flush()
    db.add_all([
        Order(number="1", template_key="t", status="done", price=1000, prepaid=1000, client_id=card.id),
        Order(number="2", template_key="t", status="cancelled", price=100000, client_id=card.id),
        Order(number="3", template_key="t", status="done", price=500, prepaid=500,
              refunded=True, client_id=card.id),
    ])
    db.flush()

    stats = clients.stats_for(db, card.id)
    assert stats["orders_count"] == 3
    assert stats["total_sum"] == 1000


# ------------------------------------------------------------------ телефоны
def test_иностранный_номер_не_становится_российским():
    """Десятизначный «+49 151 …» раньше получал семёрку спереди и превращался
    в формально верный, но чужой российский номер."""
    assert phones.normalize_phone("+49 151 123 45") == "4915112345"      # 10 цифр
    assert phones.normalize_phone("+49 151 1234 56") == "49151123456"    # 11 цифр
    assert phones.normalize_phone("+1 212 555 0100") == "12125550100"
    # российские правила по-прежнему работают
    assert phones.normalize_phone("8 (988) 160-32-18") == "79881603218"
    assert phones.normalize_phone("9881603218") == "79881603218"
    assert phones.normalize_phone("+7 988 160-32-18") == "79881603218"
