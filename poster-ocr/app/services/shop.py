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


def details(overrides: dict[str, str] | None = None) -> dict:
    """Название, телефон, адрес и строка под ними (часы работы, сайт).

    overrides — то, что владелец записал на странице «Настройки»
    (app/services/settings.py); оно главнее .env. Логотип живёт только там.
    """
    from app.services.settings import pick

    env = lambda name: (os.getenv(name) or "").strip()  # noqa: E731
    return {
        "name": pick(overrides, "shop_name", env("POSTER_SHOP_NAME")),
        "phone": pick(overrides, "shop_phone", env("POSTER_SHOP_PHONE")),
        "address": pick(overrides, "shop_address", env("POSTER_SHOP_ADDRESS")),
        "note": pick(overrides, "shop_note", env("POSTER_SHOP_NOTE")),
        "logo": pick(overrides, "shop_logo", ""),
    }
