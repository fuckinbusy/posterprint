"""Реквизиты мастерской — то, что печатается в шапке квитанции.

Живут в .env, а не в базе: их заводят один раз при установке и потом не
трогают, а отдельная страница настроек ради четырёх строк — лишняя сущность.
Когда к ним добавятся платёжные реквизиты для QR (см. TODO 3.2), всё это
осмысленно будет перенести в интерфейс разом.

Ничего не задано — квитанция просто напечатается без шапки. Это допустимо:
номер заказа, состав и суммы в ней важнее вывески.
"""

from __future__ import annotations

import os

from dotenv import load_dotenv

load_dotenv()


def details() -> dict:
    """Название, телефон, адрес и строка под ними (часы работы, сайт)."""
    return {
        "name": (os.getenv("POSTER_SHOP_NAME") or "").strip(),
        "phone": (os.getenv("POSTER_SHOP_PHONE") or "").strip(),
        "address": (os.getenv("POSTER_SHOP_ADDRESS") or "").strip(),
        "note": (os.getenv("POSTER_SHOP_NOTE") or "").strip(),
    }
