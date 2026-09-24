"""Каталог: разделы и позиции прайса, виды работ и их поля, история цен."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import utcnow


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

    fields: Mapped[list[TemplateField]] = relationship(
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

    # как значение поля влияет на цену — см. app/services/pricing.py
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

    group_key  — к какой группе относится (см. app/services/seed_catalog.py);
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

class PriceChange(Base):
    """Одна смена цены или единицы у позиции прайса.

    Ради вопроса «когда подняли баннер до 800 и с чего» — раньше в строке
    стояло только «менял Администратор». Хранится всё, что было записано с
    момента включения; удаляется вместе с позицией.
    """

    __tablename__ = "price_changes"

    id: Mapped[int] = mapped_column(primary_key=True)
    item_id: Mapped[int] = mapped_column(
        ForeignKey("price_items.id", ondelete="CASCADE"), index=True
    )
    group_key: Mapped[str] = mapped_column(String(40), default="")
    item_key: Mapped[str] = mapped_column(String(80), default="")
    field: Mapped[str] = mapped_column(String(20), default="value")   # value | unit
    old_value: Mapped[str] = mapped_column(String(40), default="")
    new_value: Mapped[str] = mapped_column(String(40), default="")
    author: Mapped[str] = mapped_column(String(80), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
