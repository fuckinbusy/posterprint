"""CRUD заказов и смена статусов."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.core.database import get_db
from app.core.logs import log as applog
from app.core.security import CurrentUser, require_login, require_perm
from app.models import ALLOWED_TRANSITIONS, FORWARD, STATUS_META, Client, Order, OrderStatus
from app.schemas import (
    EstimateRequest,
    EstimateResponse,
    NoteCreate,
    OrderCreate,
    OrderOut,
    OrderUpdate,
    StatusUpdate,
)
from app.services import catalog, payments, pricing, shop
from app.services import clients as clients_logic
from app.services import settings as settings_logic
from app.services.orders import (
    MAX_NUMBER_ATTEMPTS,
    NULLABLE_FIELDS,
    check_refund,
    fresh_orders_filter,
    get_order_or_404,
    ledger_method,
    log,
    next_number,
    payment_state,
    record_movement,
    require_money_rights,
    to_out,
)

router = APIRouter(prefix="/api", tags=["orders"])

# закрытые статусы: их накапливается много, на доске показываем только свежие
CLOSED_STATUSES = (OrderStatus.done.value, OrderStatus.cancelled.value)

# потолок для поиска: больше на доску всё равно не помещается осмысленно
SEARCH_LIMIT = 200


# ------------------------------------------------------------------ справочники
# прайс с ценами и реквизиты мастерской — только вошедшим: это единственная
# ручка, которую интерфейс зовёт сразу после входа, и без токена ей делать нечего
@router.get("/catalog", dependencies=[Depends(require_login)])
def get_catalog(db: Session = Depends(get_db)) -> dict:
    return {
        "templates": catalog.all_templates(db),
        # доп. услуги к любому заказу — из раздела «Услуги» прайса
        "extras": pricing.extras_catalog(db),
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
        stmt = base()
        if status in CLOSED_STATUSES:
            # закрытые копятся годами — как и на доске, отдаём свежие по времени
            # закрытия, а не всё подряд с начала времён
            stmt = stmt.order_by(
                func.coalesce(Order.completed_at, Order.updated_at).desc(), Order.id.desc()
            ).limit(closed_limit)
        else:
            stmt = stmt.order_by(*by_due)
        rows = list(db.scalars(stmt).all())
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

    params = {**catalog.defaults_of(template), **(payload.params or {})}

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
            extras=pricing.normalize_extras(db, payload.extras),
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
            return to_out(order, user, db, {template["key"]: template})
        except IntegrityError:
            db.rollback()
            if attempt == MAX_NUMBER_ATTEMPTS - 1:
                raise HTTPException(
                    503,
                    "Не удалось присвоить номер заказу — слишком много одновременных "
                    "операций. Повторите через секунду.",
                ) from None

    raise HTTPException(503, "Не удалось создать заказ, повторите")


@router.get("/orders/fresh")
def fresh_orders(
    after: int | None = Query(default=None, ge=0, description="id последнего виденного заказа"),
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_perm("notify.orders")),
) -> dict:
    """Новые заказы после указанного — для всплывающих уведомлений.

    Опрашивается раз в несколько секунд каждым, у кого включено право,
    поэтому дёшево: один max(id) и, если есть точка отсчёта, короткая
    выборка по id. Свои заказы (manager — этот же профиль) не отдаются.
    Объявлена раньше /orders/{order_id}: иначе «fresh» пытался бы стать
    номером заказа.
    """
    latest = db.scalar(select(func.max(Order.id))) or 0
    rows: list[Order] = []
    if after is not None and latest > after:
        rows = list(
            db.scalars(
                select(Order)
                .options(selectinload(Order.events))
                .where(Order.id > after)
                .order_by(Order.id)
                .limit(20)
            ).all()
        )
    picked = fresh_orders_filter(rows, after, user.name)
    # шаблоны — одним чтением на всю пачку, а не по заказу (см. list_orders)
    templates = {t["key"]: t for t in catalog.all_templates(db, include_hidden=True)} if picked else {}
    return {"latest_id": latest, "orders": [to_out(o, user, db, templates) for o in picked]}


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

    template_key = changes.get("template_key")
    if template_key is not None and not catalog.exists(db, str(template_key)):
        raise HTTPException(422, "Неизвестный шаблон заказа")
    # чужой id карточки иначе доезжал до commit и падал там на внешнем ключе — 500 вместо 422
    if changes.get("client_id") is not None and db.get(Client, changes["client_id"]) is None:
        raise HTTPException(422, "Карточка клиента не найдена")
    if "extras" in changes:
        changes["extras"] = pricing.normalize_extras(db, changes["extras"])

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
            "extras": "доп. услуги",
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
    from app.services import designs

    applog.warning("Удалён заказ %s «%s» · %s", order.number, order.title, user.name)
    db.delete(order)
    db.commit()
    # файл — после commit: если база не дала удалить заказ, макет должен остаться
    designs.delete(order.number)


# ------------------------------------------------------------------ деньги
@router.post("/price/estimate", response_model=EstimateResponse)
def estimate_price(
    payload: EstimateRequest,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_perm("orders.estimate")),
) -> EstimateResponse:
    if not catalog.exists(db, payload.template_key):
        raise HTTPException(422, "Неизвестный вид работ")
    result = pricing.estimate(db, payload.template_key, payload.quantity, payload.params, payload.extras)
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
