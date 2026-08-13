"""Управление устройствами. Доступно тем, у кого есть staff.manage.

Логика — в app/devices.py.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import devices as devices_logic
from app.database import get_db
from app.logs import log as applog
from app.models import Device, Employee
from app.security import CurrentUser, current_user, require_perm

router = APIRouter(
    prefix="/api/devices",
    tags=["devices"],
    dependencies=[Depends(require_perm("staff.manage"))],
)


class DeviceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    note: str
    last_ip: str
    first_ip: str
    browser: str = ""
    display_name: str = ""
    bound_to: list[str] = []          # имена профилей, привязанных к устройству
    is_current: bool = False
    first_seen_at: object | None = None
    last_seen_at: object | None = None


class DeviceUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, max_length=80)
    note: str | None = Field(default=None, max_length=200)


@router.get("", response_model=list[DeviceOut])
def list_devices(
    db: Session = Depends(get_db),
    user=Depends(require_perm("staff.manage")),
) -> list[DeviceOut]:
    rows = db.scalars(select(Device).order_by(Device.last_seen_at.desc())).all()
    employees = db.scalars(select(Employee)).all()

    result: list[DeviceOut] = []
    for device in rows:
        data = DeviceOut.model_validate(device)
        data.browser = devices_logic.browser_hint(device.user_agent)
        data.display_name = devices_logic.display_name(device)
        data.bound_to = [
            e.name
            for e in employees
            if e.access_mode == "devices" and device.id in (e.allowed_devices or [])
        ]
        data.is_current = bool(user.device and user.device.id == device.id)
        result.append(data)
    return result


@router.patch("/{device_id}", response_model=DeviceOut)
def update_device(
    device_id: int,
    payload: DeviceUpdate,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(current_user),
) -> DeviceOut:
    device = db.get(Device, device_id)
    if device is None:
        raise HTTPException(404, "Устройство не найдено")

    changes = payload.model_dump(exclude_unset=True)
    if "name" in changes:
        was = device.name or "без имени"
        device.name = (changes["name"] or "").strip()
        applog.info(
            "Устройство #%s: «%s» → «%s» · %s",
            device.id, was, device.name or "без имени", user.name,
        )
    if "note" in changes:
        device.note = (changes["note"] or "").strip()
    db.commit()
    db.refresh(device)

    data = DeviceOut.model_validate(device)
    data.browser = devices_logic.browser_hint(device.user_agent)
    data.display_name = devices_logic.display_name(device)
    return data


@router.delete("/{device_id}", status_code=204)
def delete_device(
    device_id: int,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(current_user),
) -> None:
    """Забыть устройство. Профили, привязанные только к нему, станут
    недоступны — сотруднику придётся зайти заново и получить новый ключ."""
    device = db.get(Device, device_id)
    if device is None:
        raise HTTPException(404, "Устройство не найдено")

    # чистим ссылки в профилях, чтобы не оставалось битых привязок
    unbound: list[str] = []
    for employee in db.scalars(select(Employee)).all():
        allowed = employee.allowed_devices or []
        if device_id in allowed:
            employee.allowed_devices = [d for d in allowed if d != device_id]
            unbound.append(employee.name)

    # отвязанные профили — причина будущего «не могу войти», её надо видеть
    applog.warning(
        "Устройство забыто: «%s» (#%s), отвязаны профили [%s] · %s",
        devices_logic.display_name(device), device.id, ", ".join(unbound) or "—", user.name,
    )

    db.delete(device)
    db.commit()
