"""Касса: журнал движений денег по заказам.

Заказ хранит только итог — «внесено» и галочку «вернули». Для вечерней
сверки кассы этого мало: нужно знать, что за день *произошло* — кто, когда
и сколько принял, наличными или переводом, и что вернули. Поэтому каждое
изменение внесённого пишется отдельной строкой в таблицу payments
(см. models.Payment): плюс — деньги пришли, минус — ушли клиенту.

Здесь — чистая арифметика без базы: сколько денег двинулось между двумя
состояниями заказа и как сложить строки за день. Ручки и запись в базу —
в routers/orders.py и routers/reports.py.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable
from typing import TYPE_CHECKING, Protocol

if TYPE_CHECKING:
    from app.models import Payment

# Как приняли деньги. Два способа, потому что ровно так и сверяют кассу:
# наличные пересчитывают в ящике, переводы сверяют с выпиской.
METHODS: dict[str, str] = {
    "cash": "наличные",
    "transfer": "перевод",
}
DEFAULT_METHOD = "cash"


def held(prepaid: float, refunded: bool) -> float:
    """Сколько денег клиента у нас на руках при таком состоянии заказа.

    После возврата — ничего: внесённое отдали целиком (решение владельца,
    см. routers/orders.payment_state).
    """
    return 0.0 if refunded else float(prepaid or 0)


def movement(before: tuple[float, bool], after: tuple[float, bool]) -> float:
    """Сколько денег двинулось, когда заказ перешёл из before в after.

    Состояние — пара (внесено, вернули). Плюс — клиент доплатил, минус —
    ему вернули (возврат целиком или уменьшили «внесено» руками). Ноль —
    движения не было: например, поправили сумму у заказа, по которому уже
    сделан возврат, — денег на руках как не было, так и нет.
    """
    return round(held(*after) - held(*before), 2)


class Entry(Protocol):
    """То, что нужно знать о строке журнала, чтобы сложить итоги.

    Свойства, а не поля: итогам строку менять не нужно. Модель Payment
    с её колонками Mapped[...] проверка типов под протокол всё равно не
    подводит, поэтому summarize принимает её явно, рядом с протоколом —
    для тестов и любых простых объектов с теми же полями.
    """

    @property
    def amount(self) -> float: ...

    @property
    def method(self) -> str: ...

    @property
    def author(self) -> str: ...


def summarize(entries: Iterable[Entry | Payment]) -> dict:
    """Итоги по строкам за период: по способу оплаты и по сотруднику.

    Приход и расход считаются отдельно: «приняли 12 000, вернули 2 000»
    говорит кассиру больше, чем «итого 10 000» — вернувшиеся деньги
    он ищет отдельно.
    """
    by_method: dict[str, dict[str, float]] = {
        key: {"in": 0.0, "out": 0.0, "net": 0.0} for key in METHODS
    }
    by_author: dict[str, dict[str, float]] = defaultdict(
        lambda: dict.fromkeys(METHODS, 0.0) | {"total": 0.0}
    )
    total_in = total_out = 0.0
    for entry in entries:
        method = entry.method if entry.method in METHODS else DEFAULT_METHOD
        amount = float(entry.amount)
        if amount >= 0:
            by_method[method]["in"] += amount
            total_in += amount
        else:
            by_method[method]["out"] += -amount
            total_out += -amount
        by_method[method]["net"] += amount
        author = entry.author or "—"
        by_author[author][method] += amount
        by_author[author]["total"] += amount

    rounded_methods = {
        key: {k: round(v, 2) for k, v in value.items()} for key, value in by_method.items()
    }
    authors = [
        {"author": author, **{k: round(v, 2) for k, v in sums.items()}}
        for author, sums in sorted(by_author.items(), key=lambda item: -item[1]["total"])
    ]
    return {
        "by_method": rounded_methods,
        "by_author": authors,
        "total_in": round(total_in, 2),
        "total_out": round(total_out, 2),
        "total": round(total_in - total_out, 2),
    }
