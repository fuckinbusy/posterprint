"""Управление профилями сотрудников. Доступно тем, у кого есть staff.manage.

Пароли хранятся хешем: администратор может задать новый, но не увидеть текущий.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.logs import log as applog
from app.models import Device, Employee
from app.permissions import PERMISSIONS, default_permissions, groups, normalize
from app.security import CurrentUser, current_user, hash_password, require_perm

router = APIRouter(
    prefix="/api/employees",
    tags=["employees"],
    dependencies=[Depends(require_perm("staff.manage"))],
)


class EmployeeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    permissions: list[str]
    active: bool
    note: str
    access_mode: str = "any"
    allowed_devices: list[int] = []
    has_password: bool = False
    last_login_at: object | None = None
    created_at: object | None = None


class EmployeeCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    password: str = Field(default="", max_length=200)
    permissions: list[str] | None = None
    note: str = ""
    access_mode: str = "any"                  # "any" | "devices"
    allowed_devices: list[int] = []


class EmployeeUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=80)
    password: str | None = None          # пустая строка = убрать пароль
    permissions: list[str] | None = None
    active: bool | None = None
    note: str | None = None
    access_mode: str | None = None
    allowed_devices: list[int] | None = None


def to_out(employee: Employee) -> EmployeeOut:
    data = EmployeeOut.model_validate(employee)
    data.has_password = bool(employee.password_hash)
    return data


@router.get("/permissions")
def permission_catalog() -> dict:
    """Все права с описаниями — страница настройки строится по этому ответу."""
    return {
        "groups": groups(),
        "all": [p["key"] for p in PERMISSIONS],
        "defaults": default_permissions(),
    }


@router.get("", response_model=list[EmployeeOut])
def list_employees(db: Session = Depends(get_db)) -> list[EmployeeOut]:
    rows = db.scalars(select(Employee).order_by(Employee.active.desc(), Employee.name)).all()
    return [to_out(e) for e in rows]


def check_devices(db: Session, access_mode: str, allowed: list[int]) -> list[int]:
    """Привязка к компьютерам должна вести куда-то.

    Режим «только с выбранных» с пустым списком — профиль, в который нельзя
    войти ниоткуда, и интерфейс об этом не скажет: на экране входа он просто
    серый. То же с id несуществующих устройств. Проверяем здесь, потому что
    список приходит из формы, а форму заполняет человек.
    """
    if access_mode != "devices":
        return allowed
    if not allowed:
        raise HTTPException(
            422, "Выберите хотя бы один компьютер — иначе в профиль нельзя будет войти"
        )
    known = set(db.scalars(select(Device.id).where(Device.id.in_(allowed))).all())
    missing = [d for d in allowed if d not in known]
    if missing:
        raise HTTPException(422, f"Устройств с такими номерами нет: {missing}")
    return allowed


def protect_self(user: CurrentUser, employee: Employee, changes: dict) -> None:
    """Сотрудник не может закрыть дверь за собой.

    Отключить себя, снять с себя staff.manage — после этого следующий же
    запрос будет от гостя, а вернуть доступ сможет только администратор с
    паролем из .env. Администратора это не касается: у него нет профиля.
    """
    if user.employee_id != employee.id:
        return
    if changes.get("active") is False:
        raise HTTPException(409, "Свой профиль отключить нельзя — попросите другого администратора")
    if "permissions" in changes and "staff.manage" not in normalize(changes["permissions"]):
        raise HTTPException(
            409, "Снять с себя право управлять сотрудниками нельзя — иначе вернуть его будет некому"
        )


@router.post("", response_model=EmployeeOut, status_code=201)
def create_employee(
    payload: EmployeeCreate,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(current_user),
) -> EmployeeOut:
    name = payload.name.strip()
    exists = db.scalar(select(Employee).where(func.lower(Employee.name) == name.lower()))
    if exists:
        raise HTTPException(409, "Сотрудник с таким именем уже есть")

    access_mode = "devices" if payload.access_mode == "devices" else "any"
    allowed = check_devices(db, access_mode, list(payload.allowed_devices or []))
    employee = Employee(
        name=name,
        password_hash=hash_password(payload.password) if payload.password else "",
        permissions=normalize(payload.permissions if payload.permissions is not None else default_permissions()),
        note=payload.note.strip(),
        access_mode=access_mode,
        allowed_devices=allowed,
    )
    db.add(employee)
    db.commit()
    db.refresh(employee)
    # раздача доступа — событие для разбора «кто это завёл и когда»
    applog.warning(
        "Профиль создан: «%s», прав %s, пароль %s, доступ %s · создал %s",
        employee.name, len(employee.permissions),
        "задан" if employee.password_hash else "не задан",
        employee.access_mode, user.name,
    )
    return to_out(employee)


@router.patch("/{employee_id}", response_model=EmployeeOut)
def update_employee(
    employee_id: int,
    payload: EmployeeUpdate,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(current_user),
) -> EmployeeOut:
    employee = db.get(Employee, employee_id)
    if employee is None:
        raise HTTPException(404, "Профиль не найден")

    changes = payload.model_dump(exclude_unset=True)
    # null в PATCH — «не трогали», а не «запиши пустоту»
    changes = {k: v for k, v in changes.items() if v is not None}
    was_perms = set(employee.permissions or [])
    protect_self(user, employee, changes)

    if "name" in changes:
        name = changes["name"].strip()
        clash = db.scalar(
            select(Employee).where(func.lower(Employee.name) == name.lower(), Employee.id != employee_id)
        )
        if clash:
            raise HTTPException(409, "Сотрудник с таким именем уже есть")
        employee.name = name

    if "password" in changes:
        password = changes["password"] or ""
        employee.password_hash = hash_password(password) if password else ""

    if "permissions" in changes:
        employee.permissions = normalize(changes["permissions"])
    if "active" in changes:
        employee.active = changes["active"]
    if "access_mode" in changes:
        employee.access_mode = "devices" if changes["access_mode"] == "devices" else "any"
    if "allowed_devices" in changes:
        employee.allowed_devices = list(changes["allowed_devices"] or [])
    if "access_mode" in changes or "allowed_devices" in changes:
        employee.allowed_devices = check_devices(
            db, employee.access_mode, list(employee.allowed_devices or [])
        )
    if "note" in changes:
        employee.note = changes["note"].strip()

    db.commit()
    db.refresh(employee)

    # Права пишем списком, а не числом: «стало 14 прав» ни о чём не говорит,
    # а «выдано finance.totals» — говорит.
    now_perms = set(employee.permissions or [])
    added = sorted(now_perms - was_perms)
    removed = sorted(was_perms - now_perms)
    if added or removed:
        applog.warning(
            "Права «%s»: выдано [%s], снято [%s] · изменил %s",
            employee.name, ", ".join(added) or "—", ", ".join(removed) or "—", user.name,
        )
    if "password" in changes:
        applog.warning(
            "Пароль профиля «%s» %s · изменил %s",
            employee.name, "задан" if employee.password_hash else "снят", user.name,
        )
    if "active" in changes:
        applog.warning(
            "Профиль «%s» %s · изменил %s",
            employee.name, "включён" if employee.active else "отключён", user.name,
        )
    if "access_mode" in changes or "allowed_devices" in changes:
        applog.info(
            "Доступ «%s»: режим %s, устройств %s · изменил %s",
            employee.name, employee.access_mode,
            len(employee.allowed_devices or []), user.name,
        )
    return to_out(employee)


@router.delete("/{employee_id}", status_code=204)
def delete_employee(
    employee_id: int,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(current_user),
) -> None:
    """Удаляет профиль. Заказы, которые сотрудник принял, остаются —
    имя в них хранится текстом."""
    employee = db.get(Employee, employee_id)
    if employee is None:
        raise HTTPException(404, "Профиль не найден")
    if user.employee_id == employee.id:
        raise HTTPException(409, "Свой профиль удалить нельзя — попросите другого администратора")
    applog.warning("Профиль удалён: «%s» · удалил %s", employee.name, user.name)
    db.delete(employee)
    db.commit()