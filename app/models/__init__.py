"""Модели данных. Импортируются отсюда: `from app.models import Order`.

Разложены по файлам по смыслу (заказ, клиент, каталог…), но наружу — один
пакет: так внешний код не знает, в каком файле лежит класс, а SQLAlchemy
видит все классы разом и связи между ними настраиваются без сюрпризов.
"""

from __future__ import annotations

from app.models.base import utcnow
from app.models.catalog import PriceChange, PriceGroup, PriceItem, Template, TemplateField
from app.models.client import Client
from app.models.device import Device
from app.models.employee import Employee
from app.models.order import (
    ALLOWED_TRANSITIONS,
    FORWARD,
    STATUS_META,
    Order,
    OrderEvent,
    OrderStatus,
    Payment,
)
from app.models.setting import Setting

__all__ = [
    "ALLOWED_TRANSITIONS",
    "FORWARD",
    "STATUS_META",
    "Client",
    "Device",
    "Employee",
    "Order",
    "OrderEvent",
    "OrderStatus",
    "Payment",
    "PriceChange",
    "PriceGroup",
    "PriceItem",
    "Setting",
    "Template",
    "TemplateField",
    "utcnow",
]
