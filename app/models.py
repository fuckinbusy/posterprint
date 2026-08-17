"""Модели данных: заказ и лента событий по заказу."""

from __future__ import annotations

from datetime import date, datetime, timezone
from enum import Enum

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class OrderStatus(str, Enum):
    """Колонки канбана. Порядок важен — в этом порядке они рисуются."""

    new = "new"                # Новый — принят, но не подтверждён
    confirmed = "confirmed"    # Подтверждён — согласован с клиентом
    in_work = "in_work"        # В работе — печатается/режется
    ready = "ready"            # Готов — ждёт выдачи
    done = "done"              # Выдан — закрыт
    cancelled = "cancelled"    # Отменён


STATUS_META = {
    OrderStatus.new: {"title": "Новый", "hint": "Приняли заявку", "color": "#8d94ff"},
    OrderStatus.confirmed: {"title": "Подтверждён", "hint": "Согласован с клиентом", "color": "#f0b429"},
    OrderStatus.in_work: {"title": "В работе", "hint": "Печать / резка", "color": "#3cc707"},
    OrderStatus.ready: {"title": "Готов", "hint": "Ждёт выдачи", "color": "#22d3ee"},
    OrderStatus.done: {"title": "Выдан", "hint": "Закрыт", "color": "#7a8274"},
    OrderStatus.cancelled: {"title": "Отменён", "hint": "Не выполняем", "color": "#e5484d"},
}

# Какие переходы разрешены. Пусто = переход в любой статус запрещён.
FORWARD: dict[OrderStatus, OrderStatus] = {
    OrderStatus.new: OrderStatus.confirmed,
    OrderStatus.confirmed: OrderStatus.in_work,
    OrderStatus.in_work: OrderStatus.ready,
    OrderStatus.ready: OrderStatus.done,
}

ALLOWED_TRANSITIONS: dict[OrderStatus, set[OrderStatus]] = {
    OrderStatus.new: {OrderStatus.confirmed, OrderStatus.cancelled},
    OrderStatus.confirmed: {OrderStatus.in_work, OrderStatus.new, OrderStatus.cancelled},
    OrderStatus.in_work: {OrderStatus.ready, OrderStatus.confirmed, OrderStatus.cancelled},
    OrderStatus.ready: {OrderStatus.done, OrderStatus.in_work, OrderStatus.cancelled},
    OrderStatus.done: {OrderStatus.ready},
    OrderStatus.cancelled: {OrderStatus.new},
}


class Client(Base):
    """Карточка клиента. Заполняется автоматически при создании заказа,
    дальше её можно переиспользовать через поиск, не набирая всё заново."""

    __tablename__ = "clients"
    # телефон уникален: без этого два одновременных заказа одному клиенту
    # заводили две карточки. Пустой телефон не мешает — в SQLite и Postgres
    # NULL/'' в уникальном индексе допускают повторы только для NULL,
    # поэтому пустые храним как NULL
    __table_args__ = (UniqueConstraint("phone_norm", name="uq_client_phone"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120), default="", index=True)
    phone: Mapped[str] = mapped_column(String(40), default="")
    # только цифры — по нему ищем и сверяем, чтобы +7 918, 8918 и 8 (918) были одним клиентом
    phone_norm: Mapped[str | None] = mapped_column(String(20), nullable=True, index=True)
    contact: Mapped[str] = mapped_column(String(120), default="")
    notes: Mapped[str] = mapped_column(Text, default="")

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    orders: Mapped[list["Order"]] = relationship(back_populates="client")


class Device(Base):
    """Компьютер (точнее — браузер на нём), с которого заходят в систему.

    Ключ генерируется браузером один раз и хранится у него же. Сервер только
    запоминает, что такой ключ существует, с какого IP приходил и когда.
    Администратор даёт устройствам понятные имена и привязывает к ним профили.

    Честно о границах: браузер не умеет читать MAC-адрес или серийник диска —
    таких API просто нет. Ключ живёт в хранилище браузера, поэтому очистка
    данных сайта или другой браузер на том же компьютере = новое устройство,
    его придётся привязать заново. Зато с чужого компьютера ключа нет вовсе.
    """

    __tablename__ = "devices"

    id: Mapped[int] = mapped_column(primary_key=True)
    key: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(80), default="")
    note: Mapped[str] = mapped_column(String(200), default="")

    first_ip: Mapped[str] = mapped_column(String(45), default="")
    last_ip: Mapped[str] = mapped_column(String(45), default="")
    user_agent: Mapped[str] = mapped_column(String(300), default="")

    first_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Employee(Base):
    """Профиль сотрудника: имя, пароль и набор прав.

    Пароль хранится хешем (PBKDF2), в открытом виде нигде не сохраняется —
    администратор может только задать новый, но не подсмотреть текущий.
    Права лежат списком ключей из app/permissions.py.
    """

    __tablename__ = "employees"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(200), default="")
    permissions: Mapped[list] = mapped_column(JSON, default=list)
    active: Mapped[bool] = mapped_column(Boolean, default=True)

    # "any" — вход с любого компьютера; "devices" — только с привязанных
    access_mode: Mapped[str] = mapped_column(String(20), default="any")
    allowed_devices: Mapped[list] = mapped_column(JSON, default=list)  # id устройств
    note: Mapped[str] = mapped_column(String(200), default="")

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class PriceGroup(Base):
    """Раздел прайса: «Материалы», «Ламинация», «Обработка края».

    Раньше разделы были зашиты в код. Теперь их заводит администратор, и на
    них ссылаются поля шаблонов заказов: выбрал в поле «Материал» раздел
    «Материалы» — в форме заказа появится список его позиций с их ценами.
    """

    __tablename__ = "price_groups"

    id: Mapped[int] = mapped_column(primary_key=True)
    key: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    title: Mapped[str] = mapped_column(String(120), default="")
    hint: Mapped[str] = mapped_column(String(300), default="")
    # Ключ раздела-родителя. Пусто — раздел верхнего уровня.
    # Глубина ограничена двумя уровнями: родителем может быть только раздел
    # без собственного родителя. Дерево произвольной глубины потянуло бы за
    # собой циклы, сирот и рекурсию во всех местах, где раздел выбирают,
    # а «Материалы → Бумага» решается и так.
    parent_key: Mapped[str] = mapped_column(String(40), default="", index=True)
    unit: Mapped[str] = mapped_column(String(20), default="₽")
    kind: Mapped[str] = mapped_column(String(20), default="money")  # money | factor
    icon: Mapped[str] = mapped_column(String(30), default="printer")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    system: Mapped[bool] = mapped_column(Boolean, default=False)  # нельзя удалить

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class Template(Base):
    """Вид работ: «Плоттерная резка», «Визитки». То, что сотрудник выбирает
    первым шагом при создании заказа."""

    __tablename__ = "templates"

    id: Mapped[int] = mapped_column(primary_key=True)
    key: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    title: Mapped[str] = mapped_column(String(120), default="")
    short: Mapped[str] = mapped_column(String(40), default="")     # метка на карточке
    hint: Mapped[str] = mapped_column(String(300), default="")
    icon: Mapped[str] = mapped_column(String(30), default="printer")
    quantity_label: Mapped[str] = mapped_column(String(80), default="Количество, шт")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    active: Mapped[bool] = mapped_column(Boolean, default=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    fields: Mapped[list["TemplateField"]] = relationship(
        back_populates="template",
        cascade="all, delete-orphan",
        order_by="TemplateField.sort_order",
    )


class TemplateField(Base):
    """Одно поле в форме заказа и его роль в расчёте цены.

    Ключевая идея: поле не просто спрашивает значение, но и говорит, откуда
    брать варианты (source) и как выбранное влияет на цену (pricing_role).
    Благодаря этому расчёт один на все виды работ — формулы под каждый вид
    писать не нужно.
    """

    __tablename__ = "template_fields"

    id: Mapped[int] = mapped_column(primary_key=True)
    template_id: Mapped[int] = mapped_column(ForeignKey("templates.id", ondelete="CASCADE"), index=True)

    key: Mapped[str] = mapped_column(String(40))
    label: Mapped[str] = mapped_column(String(120), default="")
    type: Mapped[str] = mapped_column(String(20), default="select")   # select | number | bool | text

    # откуда берутся варианты: "price" — позиции раздела прайса, "list" — свой список
    source: Mapped[str] = mapped_column(String(20), default="price")
    price_group: Mapped[str] = mapped_column(String(40), default="")  # ключ раздела прайса
    options: Mapped[list] = mapped_column(JSON, default=list)         # для source="list"
    default_value: Mapped[str] = mapped_column(String(120), default="")

    # как значение поля влияет на цену — см. app/pricing.py
    pricing_role: Mapped[str] = mapped_column(String(20), default="none")
    # для полей-галочек: какая позиция прайса даёт ставку (пусто = ключ поля)
    price_item: Mapped[str] = mapped_column(String(80), default="")

    # По какому полю-измерению считать. Пусто = первое подходящее.
    # Нужно, когда длин несколько: погонаж материала и длина реза считаются
    # по разным полям, хотя роль у обоих «умножить на длину».
    source_field: Mapped[str] = mapped_column(String(40), default="")

    # единица измерения для полей размера: мм, см или м.
    # Внутри всё считается в миллиметрах, здесь только то, что вводит человек.
    unit: Mapped[str] = mapped_column(String(10), default="мм")

    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    required: Mapped[bool] = mapped_column(Boolean, default=False)

    template: Mapped[Template] = relationship(back_populates="fields")


class PriceItem(Base):
    """Одна строка прайса: «Баннер 510 г — 700 ₽/м²».

    group_key  — к какой группе относится (см. app/seed_catalog.py);
    item_key   — по нему расчёт находит цену, менять его в готовых позициях
                 не стоит: он должен совпадать с вариантом в шаблоне заказа;
    title      — подпись для человека, её можно править свободно.
    """

    __tablename__ = "price_items"
    __table_args__ = (UniqueConstraint("group_key", "item_key", name="uq_price_group_item"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    group_key: Mapped[str] = mapped_column(String(40), index=True)
    item_key: Mapped[str] = mapped_column(String(80))
    title: Mapped[str] = mapped_column(String(120), default="")
    value: Mapped[float] = mapped_column(Float, default=0.0)
    # За что берётся эта цена: ₽/шт, ₽/м², ₽/пог.м. Раньше единица стояла на
    # всём разделе, и люверсы (₽/шт) не помещались к проклейке (₽/пог.м) —
    # приходилось заводить лишний раздел. Пусто = как у раздела.
    # На расчёт не влияет: способ счёта задаёт роль поля вида работ.
    unit: Mapped[str] = mapped_column(String(20), default="")
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    note: Mapped[str] = mapped_column(String(200), default="")

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    updated_by: Mapped[str] = mapped_column(String(80), default="")


class Order(Base):
    __tablename__ = "orders"

    id: Mapped[int] = mapped_column(primary_key=True)
    number: Mapped[str] = mapped_column(String(24), unique=True, index=True)

    template_key: Mapped[str] = mapped_column(String(40), index=True)
    status: Mapped[str] = mapped_column(String(20), default=OrderStatus.new.value, index=True)
    title: Mapped[str] = mapped_column(String(160), default="")

    # клиент: текстовые поля остаются в заказе (снимок на момент заказа),
    # client_id связывает его с карточкой в справочнике
    client_id: Mapped[int | None] = mapped_column(ForeignKey("clients.id", ondelete="SET NULL"), nullable=True, index=True)
    client_name: Mapped[str] = mapped_column(String(120), default="")
    client_phone: Mapped[str] = mapped_column(String(40), default="")
    client_contact: Mapped[str] = mapped_column(String(120), default="")  # почта / телеграм / компания

    # производство
    quantity: Mapped[int] = mapped_column(Integer, default=1)
    params: Mapped[dict] = mapped_column(JSON, default=dict)  # поля конкретного шаблона

    # деньги
    price: Mapped[float] = mapped_column(Float, default=0.0)
    prepaid: Mapped[float] = mapped_column(Float, default=0.0)
    # из цены и предоплаты возврат не вычислить — нужен явный признак
    refunded: Mapped[bool] = mapped_column(Boolean, default=False)

    # прочее
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    manager: Mapped[str] = mapped_column(String(80), default="")
    notes: Mapped[str] = mapped_column(Text, default="")
    # почему заказ отменили. Заполняется при переводе в «Отменён» и
    # очищается, если заказ вернули в работу: иначе у повторно отменённого
    # заказа висела бы причина от прошлого раза
    cancel_reason: Mapped[str] = mapped_column(String(300), default="")

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    # проставляется в момент перехода в «Выдан» — по нему считается выручка за период
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    client: Mapped["Client | None"] = relationship(back_populates="orders")

    events: Mapped[list["OrderEvent"]] = relationship(
        back_populates="order",
        cascade="all, delete-orphan",
        order_by="OrderEvent.created_at.desc()",
    )


class OrderEvent(Base):
    """Короткая запись в ленте заказа: создан, сменил статус, отредактирован."""

    __tablename__ = "order_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(20))  # created | status | edited | note
    text: Mapped[str] = mapped_column(String(400))
    author: Mapped[str] = mapped_column(String(80), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    order: Mapped[Order] = relationship(back_populates="events")