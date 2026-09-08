"""HTTP-ручки входа.

Механика — в app/security.py и app/devices.py. Здесь приём запроса и ответ.
"""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import permissions
from app.core.database import get_db
from app.core.logs import log
from app.core.permissions import PERMISSIONS
from app.core.security import (
    CurrentUser,
    check_hashed,
    check_not_locked,
    check_password,
    current_user,
    make_token,
    note_failure,
    note_success,
    throttle_key,
)
from app.models import Employee
from app.schemas.auth import EmployeeLogin, LoginRequest, LoginResponse
from app.services import devices as devices_logic

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.get("/profiles")
def list_profiles(
    request: Request,
    x_device_key: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> dict:
    """Профили для экрана входа.

    Отдаём имена и признак доступности с этого компьютера — ни прав, ни хешей.
    Недоступные профили показываем помеченными, чтобы человек за чужим
    компьютером понимал, почему не видит свой, а не думал, что тот пропал.
    """
    device = devices_logic.touch(db, x_device_key, request)
    rows = db.scalars(
        select(Employee).where(Employee.active.is_(True)).order_by(Employee.name)
    ).all()

    return {
        "device": {
            "registered": device is not None,
            "name": devices_logic.display_name(device) if device else "",
            "named": bool(device and device.name),
        },
        "employees": [
            {
                "id": e.id,
                "name": e.name,
                "note": e.note,
                "has_password": bool(e.password_hash),
                "available": devices_logic.can_login(e, device),
                "bound": e.access_mode == "devices",
            }
            for e in rows
        ],
    }


@router.post("/admin", response_model=LoginResponse)
def login_admin(
    payload: LoginRequest,
    request: Request,
    x_device_key: str | None = Header(default=None),
) -> LoginResponse:
    """Администратор входит с любого компьютера — это способ восстановить
    доступ, если привязки настроены неверно."""
    key = throttle_key(request, x_device_key, "admin")
    check_not_locked(key)

    if not check_password(payload.password):
        note_failure(key)
        log.warning("Вход администратора: неверный пароль")
        raise HTTPException(401, "Неверный пароль")

    note_success(key)
    log.info("Вход: администратор")
    token, expires = make_token("admin")
    return LoginResponse(
        token=token,
        expires_at=expires,
        name="Администратор",
        kind="admin",
        permissions=[p["key"] for p in PERMISSIONS],
    )


@router.post("/employee", response_model=LoginResponse)
def login_employee(
    payload: EmployeeLogin,
    request: Request,
    x_device_key: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> LoginResponse:
    key = throttle_key(request, x_device_key, f"emp:{payload.employee_id}")
    check_not_locked(key)

    employee = db.get(Employee, payload.employee_id)
    if employee is None or not employee.active:
        raise HTTPException(404, "Профиль не найден")

    device = devices_logic.touch(db, x_device_key, request)
    if not devices_logic.can_login(employee, device):
        log.warning("Вход «%s»: компьютер не привязан (устройство %s)",
                    employee.name, device.id if device else "не опознано")
        raise HTTPException(403, "В этот профиль нельзя войти с этого компьютера")

    # пустой пароль у профиля = вход без пароля
    if employee.password_hash and not check_hashed(payload.password, employee.password_hash):
        note_failure(key)
        log.warning("Вход «%s»: неверный пароль", employee.name)
        raise HTTPException(401, "Неверный пароль")

    note_success(key)
    log.info("Вход: %s", employee.name)

    employee.last_login_at = datetime.now(UTC)
    db.commit()

    token, expires = make_token(f"emp:{employee.id}")
    return LoginResponse(
        token=token,
        expires_at=expires,
        name=employee.name,
        kind="employee",
        permissions=list(employee.permissions or []),
    )


@router.get("/me")
def me(user: CurrentUser = Depends(current_user)) -> dict:
    """Проверка сохранённого токена при загрузке страницы."""
    return user.as_dict()


@router.get("/permissions")
def permission_groups(_: CurrentUser = Depends(current_user)) -> dict:
    """Все права с названиями — страница профиля показывает по ним, что
    человеку разрешено. Это справочник, а не чьи-то права, поэтому доступен
    любому вошедшему."""
    return {"groups": permissions.groups()}
