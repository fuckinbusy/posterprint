"""CRUD заказов и смена статусов."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app import catalog, ledger, clients as clients_logic, payments, pricing, settings as settings_logic, shop
from app.logs import log as applog
from app.security import CurrentUser, current_user, require_perm
from app.database import get_db
from app.models import ALLOWED_TRANSITIONS, FORWARD, STATUS_META, Order, OrderEvent, OrderStatus, Payment
from app.schemas import (
    EstimateRequest,
    EstimateResponse,
    NoteCreate,
    OrderCreate,
    OrderOut,
    OrderUpdate,
    StatusUpdate,
)

router = APIRouter(prefix="/api", tags=["orders"])

# закрытые статусы: их накапливается много, на доске показываем только свежие
CLOSED_STATUSES = (OrderStatus.done.value, OrderStatus.cancelled.value)

# потолок для поиска: больше на доску всё равно не помещается осмысленно
SEARCH_LIMIT = 200


# ------------------------------------------------------------------ утилиты
def next_number(db: Session) -> str:
    """ЗК-2026-000007 — сквозная нумерация внутри года.

    Порядковый номер считаем числом, а не строкой: если в базе остались
    старые четырёхзначные номера (ЗК-2026-0007), сравнение строк дало бы
    неверный максимум при переходе на шестизначные.
    """
    year = datetime.now(timezone.utc).year
    prefix = f"ЗК-{year}-"
    numbers = db.scalars(select(Order.number).where(Order.number.like(f"{prefix}%"))).all()

    last = 0
    for number in numbers:
        tail = number.rsplit("-", 1)[-1]
        if tail.isdigit():
            last = max(last, int(tail))

    return f"{prefix}{last + 1:06d}"


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


# ------------------------------------------------------------------ справочники
@router.get("/catalog")
def get_catalog(db: Session = Depends(get_db)) -> dict:
    return {
        "templates": catalog.all_templates(db),
        # реквизиты мастерской для шапки квитанции: справочник, который
        # читается один раз вместе с остальными
        "shop": shop.details(settings_logic.overrides(db)),
        "statuses": [
            {"key": status.value, **STATUS_META[status]} for status in OrderStatus
        ],
        "transitions": {
            status.value: sorted(s.value for s in targets)
            for status, targets in ALLOWED_TRANSITIONS.items()
        },
        # куда ведёт кнопка «дальше» на карточке
        "forward": {status.value: target.value for status, target in FORWARD.items()},
    }


# ------------------------------------------------------------------ заказы
@router.get("/orders", response_model=list[OrderOut])
def list_orders(
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_perm("orders.view")),
    status: OrderStatus | None = None,
    template_key: str | None = None,
    q: str | None = Query(default=None, description="Поиск по номеру, клиенту, телефону, названию"),
    closed_limit: int = Query(default=60, ge=10, le=1000,
                              description="Сколько выданных и отменённых показывать"),
) -> list[OrderOut]:
    def base():
        stmt = select(Order).options(selectinload(Order.events))
        if status:
            stmt = stmt.where(Order.status == status.value)
        if template_key:
            stmt = stmt.where(Order.template_key == template_key)
        if q:
            like = f"%{q.strip().lower()}%"
            stmt = stmt.where(
                or_(
                    *[
                        func.lower(col).like(like)
                        for col in (
                            Order.number,
                            Order.title,
                            Order.client_name,
                            Order.client_phone,
                            Order.client_contact,
                            Order.notes,
                        )
                    ]
                )
            )
        return stmt

    # порядок доски: сначала то, что горит по сроку; заказы без срока — в конец
    by_due = (Order.due_date.is_(None), Order.due_date, Order.created_at.desc())

    # шаблоны нужны каждой карточке для описания состава — читаем один раз,
    # включая скрытые: у старых заказов вид работ мог быть уже спрятан
    templates = {t["key"]: t for t in catalog.all_templates(db, include_hidden=True)}

    if q:
        # У поиска свой потолок: по короткому запросу вроде «а» иначе приедут
        # все заказы за годы. Если упёрлись — человек уточнит запрос.
        rows = list(db.scalars(base().order_by(*by_due).limit(SEARCH_LIMIT)).all())
        return [to_out(o, user, db, templates) for o in rows]

    if status is not None:
        rows = list(db.scalars(base().order_by(*by_due)).all())
        return [to_out(o, user, db, templates) for o in rows]

    # Заказы в работе отдаём все — их всегда обозримое число.
    # А «Выдан» и «Отменён» копятся годами: без ограничения доска через год
    # тянула бы тысячи карточек на каждое открытие.
    #
    # Свежие закрытые выбираем ОТДЕЛЬНЫМ запросом с сортировкой по времени
    # закрытия. Раньше общий список резался по срезу уже отсортированного по
    # сроку сдачи — и в колонки «Выдан» и «Отменён» попадали заказы с самым
    # ранним сроком, то есть самые старые. Пока их единицы, разницы не видно;
    # через год доска показывала бы прошлогоднее, а вчерашнее прятала.
    active = list(db.scalars(base().where(Order.status.not_in(CLOSED_STATUSES)).order_by(*by_due)).all())
    closed = list(
        db.scalars(
            base()
            .where(Order.status.in_(CLOSED_STATUSES))
            # completed_at есть только у выданных, у отменённых его нет —
            # для них временем закрытия служит updated_at
            .order_by(func.coalesce(Order.completed_at, Order.updated_at).desc(), Order.id.desc())
            .limit(closed_limit)
        ).all()
    )

    return [to_out(o, user, db, templates) for o in active + closed]


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


@router.post("/orders", response_model=OrderOut, status_code=201)
def create_order(
    payload: OrderCreate,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_perm("orders.create")),
) -> OrderOut:
    template = catalog.get_template(db, payload.template_key)
    if template is None:
        raise HTTPException(422, "Неизвестный вид работ")
    require_money_rights(user, payload.model_fields_set - {"pay_method"})
    check_refund(payload.refunded, payload.prepaid)
    pay_method = ledger_method(payload.pay_method)

    params = {**catalog.default_params(db, payload.template_key), **(payload.params or {})}

    # Номер занимаем с повтором: если двое оформляют заказ в одну секунду,
    # оба читают один и тот же последний номер и пытаются его занять.
    # Проигравший берёт следующий свободный вместо ошибки.
    # Заказ собираем заново на каждой попытке: после отката объект отвязан
    # от сессии и повторно использовать его нельзя.
    for attempt in range(MAX_NUMBER_ATTEMPTS):
        order = Order(
            number=next_number(db),
            template_key=payload.template_key,
            status=OrderStatus.new.value,
            title=payload.title.strip() or template["title"],
            client_name=payload.client_name.strip(),
            client_phone=payload.client_phone.strip(),
            client_contact=payload.client_contact.strip(),
            quantity=payload.quantity,
            params=params,
            price=payload.price,
            prepaid=payload.prepaid,
            due_date=payload.due_date,
            manager=user.name,   # кто принял — из профиля, а не из формы
            notes=payload.notes.strip(),
        )

        # справочник клиентов пополняется сам — отдельно заводить карточку не нужно
        client = clients_logic.upsert(
            db,
            name=payload.client_name,
            phone=payload.client_phone,
            contact=payload.client_contact,
            client_id=payload.client_id,
        )
        if client is not None:
            order.client_id = client.id

        db.add(order)
        try:
            db.flush()
            log(db, order, "created", f"Заказ создан — {template['title']}", user.name)
            record_movement(db, order, (0.0, False), pay_method, user.name)
            db.commit()
            db.refresh(order)
            applog.info(
                "Создан заказ %s «%s» · %s · %s шт · %s ₽ · клиент %s · %s",
                order.number, order.title, template["title"], order.quantity,
                order.price or 0, order.client_name or "—", user.name,
            )
            return to_out(order, user, db)
        except IntegrityError:
            db.rollback()
            if attempt == MAX_NUMBER_ATTEMPTS - 1:
                raise HTTPException(
                    503,
                    "Не удалось присвоить номер заказу — слишком много одновременных "
                    "операций. Повторите через секунду.",
                ) from None

    raise HTTPException(503, "Не удалось создать заказ, повторите")


@router.get("/orders/{order_id}", response_model=OrderOut)
def get_order(
    order_id: int,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_perm("orders.view")),
) -> OrderOut:
    return to_out(get_order_or_404(db, order_id), user, db)


@router.patch("/orders/{order_id}", response_model=OrderOut)
def update_order(
    order_id: int,
    payload: OrderUpdate,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_perm("orders.edit")),
) -> OrderOut:
    order = get_order_or_404(db, order_id)
    changes = payload.model_dump(exclude_unset=True)
    # «Принял» проставляется автоматически по профилю — из формы не принимаем
    changes.pop("manager", None)
    # Явный null допустим только там, где колонка его принимает. Для остальных
    # это «поле не трогали», а не «запиши пустоту»: иначе {"title": null}
    # ронял запрос в 500 на NOT NULL.
    changes = {k: v for k, v in changes.items() if v is not None or k in NULLABLE_FIELDS}
    # способ оплаты — не поле заказа, а подпись к движению денег в журнале
    pay_method = ledger_method(changes.pop("pay_method", None))
    require_money_rights(user, set(changes))
    money_before = (float(order.prepaid or 0), bool(order.refunded))

    if "template_key" in changes and not catalog.exists(db, changes["template_key"]):
        raise HTTPException(422, "Неизвестный шаблон заказа")

    changed_labels: list[str] = []
    for field, value in changes.items():
        if getattr(order, field) != value:
            changed_labels.append(field)
            setattr(order, field, value)

    # проверяем итог, а не только присланное: возврат могли включить раньше,
    # а внесённое обнулить сейчас
    if {"refunded", "prepaid"} & set(changed_labels):
        check_refund(order.refunded, order.prepaid)
        record_movement(db, order, money_before, pay_method, user.name)

    if changed_labels:
        # если правили данные клиента — обновляем и его карточку в справочнике
        if {"client_name", "client_phone", "client_contact", "client_id"} & set(changed_labels):
            client = clients_logic.upsert(
                db,
                name=order.client_name,
                phone=order.client_phone,
                contact=order.client_contact,
                client_id=order.client_id,
            )
            if client is not None:
                order.client_id = client.id

        readable = {
            "price": "стоимость",
            "quantity": "тираж",
            "params": "параметры",
            "due_date": "срок",
            "client_name": "клиент",
            "client_phone": "телефон",
            "notes": "комментарий",
            "title": "название",
            "template_key": "шаблон",
            "prepaid": "предоплата",
            "refunded": "возврат денег",
            "manager": "менеджер",
            "client_contact": "контакт",
            "client_id": "карточка клиента",
        }
        names = ", ".join(readable.get(f, f) for f in changed_labels)
        log(db, order, "edited", f"Изменено: {names}", user.name)
        db.commit()
        db.refresh(order)
        # что именно поменяли — по этой строке разбирают «а кто поставил такую цену»
        applog.info("Изменён заказ %s: %s · %s", order.number, names, user.name)
    return to_out(order, user, db)


@router.post("/orders/{order_id}/status", response_model=OrderOut)
def change_status(
    order_id: int,
    payload: StatusUpdate,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_perm("orders.status")),
) -> OrderOut:
    order = get_order_or_404(db, order_id)
    current = OrderStatus(order.status)
    target = payload.status

    if current == target:
        return to_out(order, user, db)
    if target not in ALLOWED_TRANSITIONS[current]:
        applog.warning(
            "Запрещённый переход %s: %s → %s · %s",
            order.number, STATUS_META[current]["title"], STATUS_META[target]["title"], user.name,
        )
        raise HTTPException(
            409,
            f"Нельзя перевести из «{STATUS_META[current]['title']}» в «{STATUS_META[target]['title']}»",
        )

    order.status = target.value
    # фиксируем момент выдачи — по нему считается выручка за период
    if target == OrderStatus.done:
        order.completed_at = datetime.now(timezone.utc)
    elif current == OrderStatus.done:
        order.completed_at = None  # заказ вернули из «Выдан» обратно в работу

    reason = payload.reason.strip()
    if target == OrderStatus.cancelled:
        order.cancel_reason = reason
    elif current == OrderStatus.cancelled:
        # заказ вернули в работу — прежняя причина больше не описывает его
        order.cancel_reason = ""

    move = f"{STATUS_META[current]['title']} → {STATUS_META[target]['title']}"
    log(db, order, "status", f"{move} · причина: {reason}" if reason else move, user.name)
    db.commit()
    db.refresh(order)
    applog.info(
        "Статус %s: %s → %s%s · %s",
        order.number, STATUS_META[current]["title"], STATUS_META[target]["title"],
        f" · причина: {reason}" if reason else "", user.name,
    )
    return to_out(order, user, db)


@router.post("/orders/{order_id}/notes", response_model=OrderOut)
def add_note(
    order_id: int,
    payload: NoteCreate,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_perm("orders.edit")),
) -> OrderOut:
    order = get_order_or_404(db, order_id)
    log(db, order, "note", payload.text.strip(), user.name)
    db.commit()
    db.refresh(order)
    return to_out(order, user, db)


@router.delete("/orders/{order_id}", status_code=204)
def delete_order(
    order_id: int,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_perm("orders.delete")),
) -> None:
    order = get_order_or_404(db, order_id)
    # макет привязан к номеру заказа — удаляем вместе с ним, иначе файл
    # осиротеет и будет занимать место без всякой связи с системой
    from app import designs

    applog.warning("Удалён заказ %s «%s» · %s", order.number, order.title, user.name)
    designs.delete(order.number)
    db.delete(order)
    db.commit()


# ------------------------------------------------------------------ деньги
@router.post("/price/estimate", response_model=EstimateResponse)
def estimate_price(
    payload: EstimateRequest,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_perm("orders.estimate")),
) -> EstimateResponse:
    if not catalog.exists(db, payload.template_key):
        raise HTTPException(422, "Неизвестный вид работ")
    result = pricing.estimate(db, payload.template_key, payload.quantity, payload.params)
    return EstimateResponse(**result)


@router.get("/orders/{order_id}/payment")
def order_payment(
    order_id: int,
    amount: float | None = Query(default=None, ge=0, le=100_000_000,
                                 description="Сумма к оплате; по умолчанию — остаток по заказу"),
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_perm("orders.price.view")),
) -> dict:
    """Что показать клиенту на вопрос «куда платить».

    Право то же, что и на стоимость заказа: кто не видит цену, тому и сумму
    к оплате называть нечем.
    """
    order = get_order_or_404(db, order_id)
    config = payments.settings(settings_logic.overrides(db))
    _, debt = payment_state(order)

    # по умолчанию — сколько осталось доплатить; ноль (всё оплачено) даёт
    # QR без суммы, клиент введёт её сам, если платит за что-то ещё
    total = debt if amount is None else amount
    purpose = f"Оплата заказа {order.number}"

    requisites = []
    if config["card"]:
        requisites.append({"label": "Карта", "value": config["card"]})
    if config["phone"]:
        requisites.append({"label": "Перевод по номеру", "value": config["phone"]})

    qr = ""
    if payments.has_qr(config):
        qr = payments.qr_data_uri(
            payments.payload(config, amount=total, purpose=purpose), config
        )

    # в режиме ссылки сумма попадает в QR, только если в ссылке нашлось для
    # неё место: иначе сотрудник должен назвать её вслух, и интерфейс обязан
    # об этом сказать, а не делать вид, что всё подставится само
    amount_in_qr = config["mode"] != "link" or payments.AMOUNT_SLOT in config["link"]

    return {
        "available": payments.has_anything(config),
        "mode": config["mode"],
        "qr": qr,
        "amount": round(total, 2),
        "amount_in_qr": bool(qr) and amount_in_qr,
        "purpose": purpose,
        "recipient": config["name"],
        "requisites": requisites,
        "note": config["note"],
        # что недонастроено и о чём стоит знать — только администратору:
        # сотруднику у стойки названия переменных из .env ничего не дают
        "problems": payments.problems(config) if user.is_admin else [],
        "hints": payments.hints(config) if user.is_admin else [],
    }


@router.get("/stats", dependencies=[Depends(require_perm("finance.totals"))])
def stats(db: Session = Depends(get_db)) -> dict:
    rows = db.execute(
        select(Order.status, func.count(Order.id), func.coalesce(func.sum(Order.price), 0))
        .group_by(Order.status)
    ).all()
    by_status = {status: {"count": count, "sum": float(total)} for status, count, total in rows}
    active = [s.value for s in (OrderStatus.new, OrderStatus.confirmed, OrderStatus.in_work, OrderStatus.ready)]
    return {
        "by_status": by_status,
        "active_count": sum(by_status.get(s, {}).get("count", 0) for s in active),
        "active_sum": sum(by_status.get(s, {}).get("sum", 0.0) for s in active),
    }