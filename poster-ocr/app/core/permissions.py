"""Права доступа.

Один источник правды: этот список показывается администратору на странице
«Сотрудники», по нему же проверяются запросы на сервере и прячутся элементы
в интерфейсе.

Чтобы добавить новое право:
  1. допишите его в PERMISSIONS ниже;
  2. на сервере повесьте на ручку Depends(require_perm("ключ"));
  3. на фронтенде спрячьте элемент через can('ключ').
Страница управления сотрудниками построится сама.

Важно про безопасность: прятать что-то только на фронтенде бесполезно —
сотрудник может открыть адрес API напрямую. Поэтому каждое право,
закрывающее данные, обязательно проверяется на сервере.
"""

from __future__ import annotations

# group — раздел на странице настройки; danger — выделить как чувствительное
PERMISSIONS: list[dict] = [
    # ---------------- заказы
    {
        "key": "orders.view",
        "title": "Видеть доску заказов",
        "hint": "Без этого права сотрудник не увидит вообще ничего. Обычно включено всем.",
        "group": "Заказы",
        "default": True,
    },
    {
        "key": "orders.create",
        "title": "Создавать заказы",
        "hint": "Кнопка «Новый заказ».",
        "group": "Заказы",
        "default": True,
    },
    {
        "key": "orders.edit",
        "title": "Редактировать заказы",
        "hint": "Менять состав работ, клиента, сроки, комментарии.",
        "group": "Заказы",
        "default": True,
    },
    {
        "key": "orders.status",
        "title": "Менять статус заказа",
        "hint": "Двигать карточки по колонкам: в работу, готов, выдан.",
        "group": "Заказы",
        "default": True,
    },
    {
        "key": "notify.orders",
        "title": "Получать уведомления о новых заказах",
        "hint": "Всплывающее окно со звуком, когда кто-то другой оформил заказ. "
                "Нужно тому, кто в цехе или на выдаче и не смотрит на доску постоянно.",
        "group": "Заказы",
        "default": False,
    },
    {
        "key": "orders.delete",
        "title": "Удалять заказы",
        "hint": "Безвозвратно, вместе с историей. Обычно оставляют только старшим.",
        "group": "Заказы",
        "default": False,
        "danger": True,
    },
    # ---------------- деньги
    {
        "key": "orders.price.view",
        "title": "Видеть стоимость заказов",
        "hint": "Цена, предоплата и отметка об оплате в карточке заказа. "
                "Без этого права цены не придут даже в ответе сервера.",
        "group": "Деньги",
        "default": True,
    },
    {
        "key": "orders.price.edit",
        "title": "Указывать и менять стоимость",
        "hint": "Поля цены и предоплаты в форме заказа.",
        "group": "Деньги",
        "default": True,
    },
    {
        "key": "orders.estimate",
        "title": "Пользоваться расчётом цены",
        "hint": "Кнопка «Рассчитать» по прайсу.",
        "group": "Деньги",
        "default": True,
    },
    {
        "key": "finance.totals",
        "title": "Видеть суммы по колонкам",
        "hint": "Счётчик в шапке и итоги под заголовками колонок — сколько всего денег в работе.",
        "group": "Деньги",
        "default": False,
    },
    {
        "key": "finance.cash",
        "title": "Сверять кассу",
        "hint": "Касса за день: кто, сколько и как принял, печать и выгрузка. "
                "Отдельно от сумм в работе: ящик вечером сверяет один человек.",
        "group": "Деньги",
        "default": False,
    },
    # ---------------- макеты
    {
        "key": "design.view",
        "title": "Видеть макет заказа",
        "hint": "Превью в карточке заказа и скачивание исходного файла.",
        "group": "Макеты",
        "default": True,
    },
    {
        "key": "design.upload",
        "title": "Загружать и удалять макеты",
        "hint": "Прикреплять файл к заказу и заменять его. Один заказ — один макет.",
        "group": "Макеты",
        "default": True,
    },
    # ---------------- клиенты
    # ---------------- почта
    {
        "key": "mail.access",
        "title": "Работать с почтой",
        "hint": "Раздел «Почта»: читать письма, отвечать клиентам, получать уведомления о "
                "новых. Какие ящики видны — выбирается в профиле, не больше двух.",
        "group": "Почта",
        "default": True,
    },
    {
        "key": "clients.view",
        "title": "Видеть контакты клиентов",
        "hint": "Телефон и почта в заказе. Без права имя видно, контакты скрыты.",
        "group": "Клиенты",
        "default": True,
    },
    {
        "key": "clients.search",
        "title": "Искать по базе клиентов",
        "hint": "Подсказки при заполнении заказа — не набирать данные заново.",
        "group": "Клиенты",
        "default": True,
    },
    {
        "key": "clients.list",
        "title": "Раздел «Клиенты»",
        "hint": "Отдельная страница со списком всех клиентов, поиском и карточками.",
        "group": "Клиенты",
        "default": True,
    },
    {
        "key": "clients.edit",
        "title": "Править карточки клиентов",
        "hint": "Менять имя, телефон, контакт и заметку в карточке клиента.",
        "group": "Клиенты",
        "default": False,
    },
    {
        "key": "clients.history",
        "title": "Смотреть историю клиента",
        "hint": "Карточка клиента со списком его прошлых заказов.",
        "group": "Клиенты",
        "default": True,
    },
    # ---------------- аналитика и прайс
    {
        "key": "metrics.view",
        "title": "Раздел «Метрики»",
        "hint": "Выручка, средний чек, разбор по клиентам и видам работ.",
        "group": "Аналитика и прайс",
        "default": False,
    },
    {
        "key": "prices.view",
        "title": "Смотреть прайс",
        "hint": "Раздел «Прайс» на просмотр, без права менять.",
        "group": "Аналитика и прайс",
        "default": False,
    },
    {
        "key": "prices.edit",
        "title": "Менять прайс",
        "hint": "Править цены, добавлять и удалять позиции. Действует сразу у всех.",
        "group": "Аналитика и прайс",
        "default": False,
        "danger": True,
    },
    # ---------------- инструменты
    {
        "key": "tools.viewer",
        "title": "Просмотр макета без заказа",
        "hint": "«Инструменты» → открыть любой .cdr, посмотреть размеры и шрифты. "
                "Файл на сервере не сохраняется.",
        "group": "Инструменты",
        "default": True,
    },
    {
        "key": "tools.impose",
        "title": "Раскладка под печать",
        "hint": "«Инструменты» → разложить PDF-макет на лист SRA3/A3/A4 с метками реза. "
                "Файл на сервере не сохраняется.",
        "group": "Инструменты",
        "default": True,
    },
    # ---------------- администрирование
    {
        "key": "staff.manage",
        "title": "Управлять сотрудниками",
        "hint": "Создавать профили, менять пароли и права. По сути права администратора.",
        "group": "Администрирование",
        "default": False,
        "danger": True,
    },
]

PERMISSIONS_BY_KEY = {p["key"]: p for p in PERMISSIONS}
ALL_KEYS = [p["key"] for p in PERMISSIONS]

# Права, без которых остальные бессмысленны: включаем автоматически
IMPLIED: dict[str, list[str]] = {
    "orders.price.edit": ["orders.price.view"],
    "orders.estimate": ["orders.price.view"],
    "finance.totals": ["orders.price.view"],
    "finance.cash": ["orders.price.view"],
    "notify.orders": ["orders.view"],
    "prices.edit": ["prices.view"],
    "clients.history": ["clients.view"],
    "design.upload": ["design.view"],
    "clients.list": ["clients.view"],
    "clients.edit": ["clients.view", "clients.list"],
    "staff.manage": ALL_KEYS,  # управляющий сотрудниками видит всё
}


def default_permissions() -> list[str]:
    """Набор для нового профиля — обычный приёмщик заказов."""
    return [p["key"] for p in PERMISSIONS if p.get("default")]


def normalize(keys: list[str] | None) -> list[str]:
    """Чистит список: убирает неизвестное, добавляет подразумеваемое."""
    result = {k for k in (keys or []) if k in PERMISSIONS_BY_KEY}
    changed = True
    while changed:  # подразумеваемые права могут тянуть за собой другие
        changed = False
        for key in list(result):
            for implied in IMPLIED.get(key, []):
                if implied not in result:
                    result.add(implied)
                    changed = True
    return [k for k in ALL_KEYS if k in result]


def groups() -> list[dict]:
    """Права, разложенные по разделам — для страницы настройки."""
    out: list[dict] = []
    for perm in PERMISSIONS:
        group = next((g for g in out if g["title"] == perm["group"]), None)
        if group is None:
            group = {"title": perm["group"], "items": []}
            out.append(group)
        group["items"].append(perm)
    return out
