"""Страница «Настройки»: реквизиты мастерской и оплаты.

Право — то же, что на управление сотрудниками: это верхний уровень
доверия в системе, и реквизиты счёта туда же.
"""

from __future__ import annotations

import os

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.logs import log as applog
from app.core.security import CurrentUser, require_perm
from app.schemas.settings import SettingsIn
from app.services import mail, payments, shop
from app.services import settings as settings_logic

router = APIRouter(
    prefix="/api/settings",
    tags=["settings"],
    dependencies=[Depends(require_perm("staff.manage"))],
)


def _snapshot(db: Session) -> dict:
    saved = settings_logic.overrides(db)
    values: dict[str, str] = {}
    sources: dict[str, str] = {}
    for key, env_name in settings_logic.KEYS.items():
        if key in saved:
            values[key] = saved[key]
            sources[key] = "db"
        else:
            values[key] = (os.getenv(env_name) or "").strip() if env_name else ""
            sources[key] = "env" if env_name and os.getenv(env_name) else "empty"

    # пароль обратно не отдаём — только факт, что он есть
    secrets = {key: bool(values.get(key)) for key in settings_logic.SECRET_KEYS}
    for key in settings_logic.SECRET_KEYS:
        values[key] = ""

    config = payments.settings(saved)
    return {
        "values": values,
        "sources": sources,
        "secrets": secrets,
        "shop": shop.details(saved),
        # что не так с платёжными реквизитами — прямо на странице, а не
        # у стойки, когда клиент уже ждёт
        "problems": payments.problems(config),
        "hints": payments.hints(config),
        "qr_ready": payments.has_qr(config),
    }


@router.get("")
def read_settings(db: Session = Depends(get_db)) -> dict:
    return _snapshot(db)


@router.put("")
def write_settings(
    payload: SettingsIn,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_perm("staff.manage")),
) -> dict:
    unknown = set(payload.values) - set(settings_logic.KEYS)
    if unknown:
        raise HTTPException(422, f"Неизвестные настройки: {sorted(unknown)}")
    # секретная настройка, пришедшая пустой, — «не менять», а не «стереть»:
    # форма секретов не показывает. (Пароли почты живут в /api/mail-accounts.)
    values = dict(payload.values)
    for key in settings_logic.SECRET_KEYS:
        if key in values and not values[key].strip():
            values.pop(key)
    try:
        if "mail_contacts" in values:
            values["mail_contacts"] = mail.normalize_contacts(values["mail_contacts"])
        settings_logic.save(db, values)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None
    changed = sorted(k for k in payload.values if k != "shop_logo")
    applog.warning("Настройки изменены: %s · %s", ", ".join(changed) or "логотип", user.name)
    return _snapshot(db)
