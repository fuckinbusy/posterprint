"""Правила заказа, не зависящие от HTTP: номер, деньги, права на деньги,
сборка ответа. Роутер /api/orders только принимает запросы и зовёт это."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.core.security import CurrentUser
from app.models import Order, OrderEvent, OrderStatus, Payment
from app.schemas import OrderOut
from app.services import catalog, ledger


# ------------------------------------------------------------------ утилиты
def next_number(db: Session) -> str:
    """ЗК-2026-000007 — сквозная нумерация внутри года.

    Порядковый номер считаем числом, а не строкой: если в базе остались
    старые четырёхзначные номера (ЗК-2026-0007), сравнение строк дало бы
    неверный максимум при переходе на шестизначные.
    """
    year = datetime.now(timezone.utc).year
    prefix = f"ЗК-{year}-"
    width = 6

    # Обычный случай — один запрос: у номеров одной длины строковый максимум
    # и есть числовой. Раньше на каждый новый заказ читались все номера года.
    like = Order.number.like(f"{prefix}%")
    newest = db.scalar(
        select(func.max(Order.number)).where(like, func.length(Order.number) == len(prefix) + width)
    )
    if newest is not None:
        return f"{prefix}{int(newest[len(prefix):]) + 1:0{width}d}"

    # шестизначных ещё нет: либо год только начался, либо остались одни
    # старые короткие номера — их немного, можно перебрать
    last = 0
    for number in db.scalars(select(Order.number).where(like)).all():
        tail = number.rsplit("-", 1)[-1]
        if tail.isdigit():
            last = max(last, int(tail))
    return f"{prefix}{last + 1:0{width}d}"


def payment_state(order: Order) -> tuple[str, float]:
    """Возвращает (статус оплаты, остаток к доплате).

    refunded — всё, что вносили, вернули клиенту. Внесённого больше нет:
               если заказ ещё жив, платить за него придётся заново — долг
               равен всей стоимости; у отменённого долга нет;
    unset    — цена ещё не проставлена, судить об оплате рано;
    overpaid — внесли больше стоимости, лишнее видно отдельно (surplus);
    paid     — внесено ровно столько, сколько стоит;
    partial  — внесена часть;
    none     — не платили.
    """
    price = order.price or 0
    prepaid = order.prepaid or 0
    if order.refunded:
        alive = order.status != OrderStatus.cancelled.value
        return "refunded", round(price, 2) if alive else 0.0
    if not price:
        return "unset", 0.0
    if round(prepaid - price, 2) > 0:
        return "overpaid", 0.0
    if prepaid >= price:
        return "paid", 0.0
    if prepaid > 0:
        return "partial", round(price - prepaid, 2)
    return "none", round(price, 2)


def surplus_of(order: Order) -> float:
    """Переплата: сколько внесли сверх стоимости. Ноль, если возврат или
    недоплата."""
    if order.refunded or not order.price:
        return 0.0
    return max(round((order.prepaid or 0) - order.price, 2), 0.0)


def check_refund(refunded: bool, prepaid: float) -> None:
    """«Вернули деньги» имеет смысл, только если что-то вносили.

    Возврат при нуле внесённого раньше просто обнулял долг — и становился
    способом бесследно списать неоплаченный заказ.
    """
    if refunded and (prepaid or 0) <= 0:
        raise HTTPException(422, "Возвращать нечего: по заказу ничего не внесено")


# сколько записей истории отдавать: заказ, походивший по статусам туда-сюда,
# накапливает их десятками, а нужны последние
MAX_EVENTS = 50


def to_out(
    order: Order,
    user: CurrentUser | None = None,
    db: Session | None = None,
    templates: dict[str, dict] | None = None,
) -> OrderOut:
    """Собирает ответ. Поля, закрытые правами, не просто прячутся в интерфейсе —
    они вообще не уходят с сервера.

    templates — шаблоны, прочитанные один раз на весь список (см. list_orders):
    без них описание каждого заказа ходило бы в базу отдельно.
    """
    data = OrderOut.model_validate(order)
    if templates is not None:
        data.summary = catalog.describe_template(templates.get(order.template_key), order.params or {})
    elif db is not None:
        data.summary = catalog.describe(db, order.template_key, order.params or {})
    else:
        data.summary = ""
    if len(data.events) > MAX_EVENTS:
        data.events = data.events[:MAX_EVENTS]   # они уже отсортированы, свежие первыми
    data.payment, data.debt = payment_state(order)
    data.surplus = surplus_of(order)

    if user is not None and not user.can("orders.price.view"):
        data.price = 0.0
        data.prepaid = 0.0
        data.debt = 0.0
        data.surplus = 0.0
        data.payment = "hidden"
        data.refunded = False
    if user is not None and not user.can("clients.view"):
        data.client_phone = ""
        data.client_contact = ""
    return data


def log(db: Session, order: Order, kind: str, text: str, author: str = "") -> None:
    db.add(OrderEvent(order_id=order.id, kind=kind, text=text, author=author))


def get_order_or_404(db: Session, order_id: int) -> Order:
    order = db.scalar(
        select(Order).options(selectinload(Order.events)).where(Order.id == order_id)
    )
    if order is None:
        raise HTTPException(404, "Заказ не найден")
    return order


MAX_NUMBER_ATTEMPTS = 8


# поля заказа, куда можно записать пустоту
NULLABLE_FIELDS = {"due_date", "client_id"}


# то, что закрыто правом «стоимость: правка»
MONEY_FIELDS = {"price", "prepaid", "refunded"}


def ledger_method(value: str | None) -> str:
    """Способ оплаты из запроса: неизвестное и пустое — наличные."""
    return value if value in ledger.METHODS else ledger.DEFAULT_METHOD


def record_movement(
    db: Session, order: Order, before: tuple[float, bool], method: str, author: str
) -> None:
    """Строка в журнал кассы, если внесённое по заказу изменилось.

    Сравниваем состояние до правки с тем, что стало: разница и есть
    движение денег — плюс приняли, минус вернули (см. app/ledger.py).
    """
    delta = ledger.movement(before, (float(order.prepaid or 0), bool(order.refunded)))
    if delta:
        db.add(Payment(order_id=order.id, amount=delta, method=method, author=author))


def require_money_rights(user: CurrentUser, fields: set[str]) -> None:
    """Стоимость, внесённое и возврат меняет только тот, кому это разрешено.

    Раньше право orders.price.edit существовало в справочнике, но ни одна
    ручка его не спрашивала: профиль с одним orders.edit мог переписать
    цену вслепую — ответ ему её даже не показывал.
    """
    if fields & MONEY_FIELDS and not user.can("orders.price.edit"):
        raise HTTPException(
            403, "Менять стоимость и оплату может только тот, у кого есть право на правку цены"
        )


def fresh_orders_filter(rows: list[Order], after: int | None, me: str) -> list[Order]:
    """Что всплывать: заказы новее точки отсчёта и не свои.

    after=None — первый запрос после входа: человеку нужен только край,
    заваливать его тем, что оформили до его прихода, незачем.
    """
    if after is None:
        return []
    return [o for o in rows if o.id > after and (o.manager or "") != me]
