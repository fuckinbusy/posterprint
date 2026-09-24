"""Переходы между статусами — app/models/order.py.

Таблица переходов маленькая, но правится руками, и ошибка в ней тихая: заказ
либо застревает в колонке, либо прыгает через этап («Подтверждён → Выдан»),
и в истории не остаётся ни печати, ни резки. Проверяем не сами переходы
по списку — их и так видно, — а свойства, которые должны выполняться всегда.
"""

from __future__ import annotations

import conftest  # noqa: F401 — добавляет корень проекта в sys.path

from app.models import ALLOWED_TRANSITIONS, FORWARD, STATUS_META, OrderStatus


def test_у_каждого_статуса_есть_описание_и_правила():
    for status in OrderStatus:
        assert status in STATUS_META, f"нет подписи для {status.value}"
        assert set(STATUS_META[status]) >= {"title", "hint", "color"}
        assert status in ALLOWED_TRANSITIONS, f"нет правил перехода из {status.value}"


def test_кнопка_дальше_ведёт_туда_куда_можно():
    """FORWARD — то, что делает кнопка на карточке. Он не должен обходить
    ограничения ALLOWED_TRANSITIONS: иначе кнопка предлагает переход,
    который сервер тут же отклонит с 409."""
    for source, target in FORWARD.items():
        assert target in ALLOWED_TRANSITIONS[source], (
            f"кнопка «дальше» из {source.value} ведёт в {target.value}, "
            "а такой переход запрещён"
        )


def test_из_работы_нельзя_прыгнуть_сразу_в_выдан():
    """Заказ проходит все этапы: иначе в истории нет ни печати, ни готовности."""
    assert OrderStatus.done not in ALLOWED_TRANSITIONS[OrderStatus.new]
    assert OrderStatus.done not in ALLOWED_TRANSITIONS[OrderStatus.confirmed]
    assert OrderStatus.done not in ALLOWED_TRANSITIONS[OrderStatus.in_work]
    assert OrderStatus.done in ALLOWED_TRANSITIONS[OrderStatus.ready]


def test_отменить_можно_с_любого_рабочего_этапа():
    for status in (OrderStatus.new, OrderStatus.confirmed, OrderStatus.in_work, OrderStatus.ready):
        assert OrderStatus.cancelled in ALLOWED_TRANSITIONS[status], status.value


def test_закрытые_статусы_можно_вернуть_в_работу():
    """Выдали не тому, отменили по ошибке — из тупика должен быть выход,
    иначе останется только удалять заказ вместе с историей."""
    assert ALLOWED_TRANSITIONS[OrderStatus.done]
    assert ALLOWED_TRANSITIONS[OrderStatus.cancelled]


def test_переход_в_себя_не_объявлен():
    for status, targets in ALLOWED_TRANSITIONS.items():
        assert status not in targets, f"{status.value} разрешён сам в себя"


def test_все_цели_переходов_существуют():
    known = set(OrderStatus)
    for status, targets in ALLOWED_TRANSITIONS.items():
        unknown = targets - known
        assert not unknown, f"из {status.value} ведут в несуществующие: {unknown}"


def test_до_выдачи_можно_дойти_кнопкой_дальше():
    """Проверяем сам маршрут: от «Новый» до «Выдан» без ручного выбора."""
    status = OrderStatus.new
    path = [status]
    while status in FORWARD:
        status = FORWARD[status]
        path.append(status)
        assert len(path) <= len(OrderStatus), f"кнопка «дальше» зациклилась: {path}"
    assert status is OrderStatus.done
