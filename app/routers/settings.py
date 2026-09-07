"""Страница «Настройки»: реквизиты мастерской и оплаты.

Право — то же, что на управление сотрудниками: это верхний уровень
доверия в системе, и реквизиты счёта туда же.
"""

from __future__ import annotations

import os

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app import mail, payments, settings as settings_logic, shop
from app.database import get_db
from app.logs import log as applog
from app.security import CurrentUser, require_perm

router = APIRouter(
    prefix="/api/settings",
    tags=["settings"],
    dependencies=[Depends(require_perm("staff.manage"))],
)


class SettingsIn(BaseModel):
    values: dict[str, str]


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
    # пустой пароль в форме — «не менять», а не «стереть»: форма его и не
    # показывает. Стереть — очистить ящик, без него пароль не нужен.
    values = dict(payload.values)
    for key in settings_logic.SECRET_KEYS:
        if key in values and not values[key].strip():
            values.pop(key)
    if not values.get("mail_user", "x").strip():
        values["mail_password"] = ""
    try:
        if "mail_contacts" in values:
            values["mail_contacts"] = mail.normalize_contacts(values["mail_contacts"])
        settings_logic.save(db, values)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None
    if any(k.startswith("mail_") for k in values):
        mail.mailbox.reset()  # ящик или пароль поменялись — старое соединение забыть
    changed = sorted(k for k in payload.values if k != "shop_logo")
    applog.warning("Настройки изменены: %s · %s", ", ".join(changed) or "логотип", user.name)
    return _snapshot(db)
