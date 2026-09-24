"""Находки обхода API: утечки цен, PATCH, который стирал, мелкие расхождения.

Каждый тест — одна находка; по имени видно, что было не так. База — в
памяти со стандартным каталогом (как при первом запуске), запросы — прямо в
приложение (conftest.py, api_helpers.py).
"""

from __future__ import annotations

import conftest  # noqa: F401 — добавляет корень проекта в sys.path
import pytest
from api_helpers import admin_headers, staff

from app.api.v1 import export
from app.models import PriceGroup, PriceItem, Template
from app.services.seed_catalog import seed_price_groups, seed_price_items, seed_templates

ADMIN = admin_headers()


@pytest.fixture
def seeded(db):
    seed_price_groups(db)
    seed_price_items(db)
    seed_templates(db)
    db.commit()
    return db


def an_extra(client) -> dict:
    extras = client.get("/api/catalog", ADMIN).json()["extras"]
    assert extras, "в стандартном прайсе нет доп. услуг — тест ничего бы не проверил"
    return extras[0]


def order_with_extra(client) -> tuple[dict, dict]:
    extra = an_extra(client)
    order = client.post("/api/orders", ADMIN, json={
        "template_key": "banner_print", "params": {"width": 3, "height": 1},
        "extras": [{"key": extra["key"], "qty": 2}],
    })
    assert order.status_code == 201, order.text
    return order.json(), extra


# ---------------------------------------------------------------- цены
def test_ставка_доп_услуги_в_заказе_скрыта_без_права_на_цены(client, seeded):
    order, extra = order_with_extra(client)
    assert extra["price"] > 0
    _, blind = staff(seeded, "Производство", ["orders.view"])
    _, sighted = staff(seeded, "Приёмка", ["orders.view", "orders.price.view"])

    hidden = client.get(f"/api/orders/{order['id']}", {"X-API-Key": blind}).json()
    shown = client.get(f"/api/orders/{order['id']}", {"X-API-Key": sighted}).json()
    assert [e["rate"] for e in hidden["extras"]] == [0]
    assert [e["rate"] for e in shown["extras"]] == [extra["price"]]
    # название и количество — не деньги, их видно всем
    assert hidden["extras"][0]["title"] and hidden["extras"][0]["qty"] == 2


def test_цены_доп_услуг_в_справочнике_скрыты_без_права_на_цены(client, seeded):
    _, blind = staff(seeded, "Производство", ["orders.view"])
    _, sighted = staff(seeded, "Приёмка", ["orders.view", "orders.price.view"])
    hidden = client.get("/api/catalog", {"X-API-Key": blind}).json()["extras"]
    shown = client.get("/api/catalog", {"X-API-Key": sighted}).json()["extras"]
    assert hidden and {e["price"] for e in hidden} == {0}
    assert any(e["price"] > 0 for e in shown)
    # сам список услуг нужен всем, кто оформляет заказ
    assert [e["key"] for e in hidden] == [e["key"] for e in shown]


def test_сортировка_клиентов_по_сумме_без_права_на_суммы_не_раскрывает_рейтинг(client, seeded, monkeypatch):
    from app.api.v1 import clients as clients_api

    asked = []
    real = clients_api.clients_logic.browse

    def spy(db, *, sort, limit, offset):
        asked.append(sort)
        return real(db, sort=sort, limit=limit, offset=offset)

    monkeypatch.setattr(clients_api.clients_logic, "browse", spy)
    _, lister = staff(seeded, "Приёмка", ["clients.view", "clients.list"])
    _, boss = staff(seeded, "Старший", ["clients.view", "clients.list", "finance.totals"])
    assert client.get("/api/clients?sort=sum", {"X-API-Key": lister}).status_code == 200
    assert client.get("/api/clients?sort=sum", {"X-API-Key": boss}).status_code == 200
    assert asked == ["recent", "sum"]


# ---------------------------------------------------------------- PATCH
def test_null_в_правке_позиции_прайса_значит_не_трогать(client, seeded):
    item = seeded.query(PriceItem).first()
    title = item.title
    response = client.patch(f"/api/prices/{item.id}", ADMIN, json={"title": None, "note": None, "value": 123})
    assert response.status_code == 200, response.text
    assert response.json()["title"] == title
    assert response.json()["value"] == 123


def test_правка_раздела_прайса_меняет_только_присланное(client, seeded):
    group = seeded.query(PriceGroup).filter(PriceGroup.key == "uslugi").one()
    before = (group.title, group.unit, group.icon, group.kind, group.active)
    response = client.patch(f"/api/prices/groups/{group.id}", ADMIN, json={"hint": "новая подсказка"})
    assert response.status_code == 200, response.text
    seeded.refresh(group)
    assert (group.title, group.unit, group.icon, group.kind, group.active) == before
    assert group.hint == "новая подсказка"


def test_правка_вида_работ_без_fields_не_стирает_поля(client, seeded):
    template = seeded.query(Template).filter(Template.key == "banner_print").one()
    fields_before = len(template.fields)
    assert fields_before > 0
    response = client.patch(f"/api/templates/{template.id}", ADMIN, json={"title": "Баннер"})
    assert response.status_code == 200, response.text
    assert response.json()["title"] == "Баннер"
    assert len(response.json()["fields"]) == fields_before


def test_полная_правка_вида_работ_по_прежнему_переписывает_поля(client, seeded):
    """Интерфейс шлёт вид работ целиком — это должно работать как раньше."""
    template = seeded.query(Template).filter(Template.key == "banner_print").one()
    full = client.get("/api/templates", ADMIN).json()
    current = next(t for t in full if t["id"] == template.id)
    payload = {k: current[k] for k in ("title", "short", "hint", "icon", "quantity_label", "active")}
    payload["fields"] = [{k: f[k] for k in f if k != "id"} for f in current["fields"][:1]]
    response = client.patch(f"/api/templates/{template.id}", ADMIN, json=payload)
    assert response.status_code == 200, response.text
    assert len(response.json()["fields"]) == 1


# ---------------------------------------------------------------- заказы
def test_лишнее_поле_в_новом_заказе_отвергается(client, seeded):
    """Опечатка в имени поля («notse») раньше молча терялась."""
    response = client.post("/api/orders", ADMIN, json={"template_key": "banner_print", "notse": "x"})
    assert response.status_code == 422
    response = client.post("/api/orders", ADMIN, json={"template_key": "banner_print", "status": "done"})
    assert response.status_code == 422


# ---------------------------------------------------------------- мелочи
def test_роль_step_key_есть_в_справочнике_конструктора(client, seeded):
    roles = {r["key"] for r in client.get("/api/templates/meta", ADMIN).json()["roles"]}
    from app.services.catalog import PRICING_ROLES

    assert set(PRICING_ROLES) <= roles


def test_диагностика_макета_без_файла_отвечает_404(client, seeded):
    order, _ = order_with_extra(client)
    assert client.get(f"/api/orders/{order['id']}/design/inspect", ADMIN).status_code == 404


def test_у_каждого_состояния_оплаты_есть_перевод_для_csv():
    states = {"paid", "partial", "none", "refunded", "overpaid", "unset"}
    assert states <= set(export.PAYMENT_TITLES)


def test_ключ_раздела_при_создании_позиции_без_пробелов(client, seeded):
    response = client.post("/api/prices", ADMIN, json={"group_key": " uslugi ", "item_key": "новая", "value": 10})
    assert response.status_code == 201, response.text
    assert response.json()["group_key"] == "uslugi"
