"""Все ручки версии 1 одним роутером. Префиксы /api/… стоят на самих
модулях, как и раньше, — адреса для интерфейса не поменялись."""

from fastapi import APIRouter

from app.api.v1 import (
    auth,
    clients,
    designs,
    devices,
    employees,
    export,
    logs,
    mail,
    mail_accounts,
    metrics,
    orders,
    prices,
    reports,
    settings,
    templates,
)

router = APIRouter()
for module in (auth, orders, clients, prices, templates, designs, logs, employees, devices,
               metrics, reports, export, settings, mail, mail_accounts):
    router.include_router(module.router)
