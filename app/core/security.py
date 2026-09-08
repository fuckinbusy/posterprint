"""Механика доступа: пароли, токены сессий и проверка прав.

HTTP-ручек здесь нет — они в app/routers/auth.py. Этот модуль только считает
и проверяет, поэтому его можно импортировать откуда угодно.

Кто может войти
---------------
1. Администратор — пароль из .env (POSTER_ADMIN_PASSWORD). У него всегда все
   права. Это «ключ от всего», он же способ восстановить доступ, если профили
   сотрудников удалили или забыли пароли.
2. Сотрудник — профиль, созданный администратором на странице «Сотрудники»:
   имя, пароль и набор прав (см. app/permissions.py).

Токен подписывается HMAC и хранит id профиля, но НЕ права. Права читаются из
базы на каждый запрос — поэтому изменение прав действует сразу, без
перелогина, а отключение профиля мгновенно закрывает доступ.

Честно о границах: это разграничение внутри доверенного контура — защита от
«не своего дела» и случайностей, а не от целенаправленного взлома. Трафик
внутри сети не шифруется, если не поставить HTTPS.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets
import time

from fastapi import Depends, Header, HTTPException, Request
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.paths import BASE_DIR
from app.core.permissions import ALL_KEYS
from app.models import Device, Employee
from app.services import devices as devices_logic

ADMIN_PASSWORD = os.getenv("POSTER_ADMIN_PASSWORD", "admin")
PASSWORD_IS_DEFAULT = not os.getenv("POSTER_ADMIN_PASSWORD")

TOKEN_TTL = 14 * 24 * 3600  # 14 дней
SECRET_FILE = BASE_DIR / ".secret"


# ---------------------------------------------------------------- подпись
def _secret() -> bytes:
    """Ключ подписи. Из .env, иначе генерируем один раз в файл .secret."""
    env = os.getenv("POSTER_SECRET_KEY")
    if env:
        return env.encode()
    if SECRET_FILE.exists():
        return SECRET_FILE.read_bytes().strip()
    value = secrets.token_urlsafe(48).encode()
    SECRET_FILE.write_bytes(value)
    return value


def _sign(payload: str) -> str:
    digest = hmac.new(_secret(), payload.encode(), hashlib.sha256).digest()
    return base64.urlsafe_b64encode(digest).decode().rstrip("=")


def make_token(subject: str = "admin") -> tuple[str, int]:
    """subject: 'admin' или 'emp:<id>'. Возвращает (токен, время истечения)."""
    expires = int(time.time()) + TOKEN_TTL
    payload = f"{subject}.{expires}"
    return f"{payload}.{_sign(payload)}", expires


def make_scoped_token(purpose: str, ttl: int = 300) -> str:
    """Короткоживущий токен под одно действие.

    Нужен для ссылок, по которым браузер ходит сам — скачивание файла,
    картинка в теге <img>. В таких запросах заголовков с нашим токеном нет,
    а класть в адрес токен сессии нельзя: он осядет в истории браузера и
    в логах сервера. Этот же действует пять минут и только на одно действие.
    """
    expires = int(time.time()) + ttl
    payload = f"scope:{purpose}:{expires}"
    return f"{expires}.{_sign(payload)}"


def verify_scoped_token(token: str | None, purpose: str) -> bool:
    if not token or "." not in token:
        return False
    expires, signature = token.split(".", 1)
    if not hmac.compare_digest(signature, _sign(f"scope:{purpose}:{expires}")):
        return False
    try:
        return int(expires) >= time.time()
    except ValueError:
        return False


def verify_token(token: str | None) -> str | None:
    """Возвращает subject, если токен валиден и не просрочен."""
    if not token:
        return None
    parts = token.split(".")
    if len(parts) != 3:
        return None
    subject, expires, signature = parts
    if not hmac.compare_digest(signature, _sign(f"{subject}.{expires}")):
        return None
    try:
        if int(expires) < time.time():
            return None
    except ValueError:
        return None
    return subject


# ---------------------------------------------------------------- пароли
def hash_password(password: str) -> str:
    """PBKDF2 с солью — из стандартной библиотеки, без лишних зависимостей."""
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode(), 200_000)
    return f"pbkdf2${salt}${digest.hex()}"


def check_hashed(password: str, stored: str) -> bool:
    if not stored or stored.count("$") != 2:
        return False
    _, salt, expected = stored.split("$")
    digest = hashlib.pbkdf2_hmac("sha256", (password or "").encode("utf-8"), salt.encode(), 200_000)
    return hmac.compare_digest(digest.hex(), expected)


def check_password(password: str) -> bool:
    """Пароль администратора. Сравниваем байты — иначе кириллица ломает compare_digest."""
    return hmac.compare_digest((password or "").encode("utf-8"), ADMIN_PASSWORD.encode("utf-8"))


# ---------------------------------------------------------------- защита от подбора
# Пароль администратора открывает всё и работает с любого компьютера, поэтому
# перебор по нему — самый дешёвый способ зайти. Считаем неудачные попытки и
# после пятой закрываем вход на минуту.
#
# Счётчик в памяти процесса, а не в базе: перезапуск сервера его обнуляет, и это
# нормально. Задача — сделать перебор бессмысленно медленным (5 попыток в
# минуту вместо тысяч в секунду), а не пережить перезагрузку.
FAIL_LIMIT = 5           # столько неудач подряд ещё прощаем
FAIL_WINDOW = 15 * 60    # за какое время они должны накопиться
LOCK_SECONDS = 60        # на столько закрываем вход после превышения

_failures: dict[str, list[float]] = {}


def throttle_key(request: Request, device_key: str | None, subject: str) -> str:
    """Кого считаем «одним подбирающим»: компьютер (или адрес) плюс цель входа.

    Устройство надёжнее адреса — из-за NAT весь офис приходит с одного IP, и
    по нему одна ошибка соседа блокировала бы всех. Но ключ устройства
    подделывается, поэтому если его нет — падаем на адрес.
    """
    who = (device_key or "")[:64] or (request.client.host if request.client else "?")
    return f"{who}|{subject}"


def check_not_locked(key: str) -> None:
    """Бросает 429, если по этому ключу лимит уже исчерпан."""
    now = time.time()
    attempts = [t for t in _failures.get(key, []) if now - t < FAIL_WINDOW]
    _failures[key] = attempts
    if len(attempts) < FAIL_LIMIT:
        return
    wait = int(LOCK_SECONDS - (now - attempts[-1]))
    if wait <= 0:
        # блокировка отстоялась — прощаем накопленное и даём попробовать снова
        _failures.pop(key, None)
        return
    raise HTTPException(
        429,
        f"Слишком много неудачных попыток. Подождите {wait} с и попробуйте снова.",
        headers={"Retry-After": str(wait)},
    )


def note_failure(key: str) -> None:
    _failures.setdefault(key, []).append(time.time())


def note_success(key: str) -> None:
    _failures.pop(key, None)


# ---------------------------------------------------------------- текущий пользователь
class CurrentUser:
    """Кто сейчас обращается к API."""

    def __init__(
        self,
        kind: str,
        name: str,
        permissions: list[str],
        employee_id: int | None = None,
        device: Device | None = None,
    ):
        self.kind = kind                  # 'admin' | 'employee' | 'guest'
        self.name = name
        self.permissions = permissions
        self.employee_id = employee_id
        self.device = device

    @property
    def is_admin(self) -> bool:
        return self.kind == "admin"

    def can(self, permission: str) -> bool:
        return permission in self.permissions

    def as_dict(self) -> dict:
        return {
            "kind": self.kind,
            "name": self.name,
            "permissions": self.permissions,
            "employee_id": self.employee_id,
            "device_id": self.device.id if self.device else None,
            "device_name": devices_logic.display_name(self.device) if self.device else "",
        }


GUEST = CurrentUser("guest", "", [])


def _token_from_headers(authorization: str | None, x_admin_token: str | None) -> str | None:
    if authorization and authorization.lower().startswith("bearer "):
        return authorization[7:].strip()
    return x_admin_token


def current_user(
    request: Request,
    authorization: str | None = Header(default=None),
    x_admin_token: str | None = Header(default=None),
    x_device_key: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> CurrentUser:
    """Мягкая проверка: не бросает ошибку, возвращает гостя, если токена нет.

    Заодно отмечает устройство: так администратор видит все компьютеры,
    с которых открывали систему, даже если вход ещё не выполнен.
    """
    device = devices_logic.touch(db, x_device_key, request)
    subject = verify_token(_token_from_headers(authorization, x_admin_token))
    if subject is None:
        return GUEST

    if subject == "admin":
        return CurrentUser("admin", "Администратор", list(ALL_KEYS), device=device)

    if subject.startswith("emp:"):
        try:
            employee_id = int(subject[4:])
        except ValueError:
            return GUEST
        employee = db.get(Employee, employee_id)
        # права читаются из базы каждый раз: правка админа действует сразу
        if employee is None or not employee.active:
            return GUEST
        # привязку проверяем на каждом запросе, а не только при входе —
        # иначе скопированный на другой компьютер токен продолжал бы работать
        if not devices_logic.can_login(employee, device):
            return GUEST
        return CurrentUser(
            "employee",
            employee.name,
            list(employee.permissions or []),
            employee.id,
            device=device,
        )

    return GUEST


def require_login(user: CurrentUser = Depends(current_user)) -> CurrentUser:
    if user.kind == "guest":
        raise HTTPException(401, "Нужно войти в систему")
    return user


def require_admin(user: CurrentUser = Depends(current_user)) -> CurrentUser:
    """Только администратор — для вещей, которые не делегируются."""
    if not user.is_admin:
        raise HTTPException(403, "Действие доступно только администратору")
    return user


def require_perm(permission: str):
    """Зависимость-фабрика: Depends(require_perm('orders.delete'))."""

    def dependency(user: CurrentUser = Depends(current_user)) -> CurrentUser:
        if user.kind == "guest":
            raise HTTPException(401, "Нужно войти в систему")
        if not user.can(permission):
            raise HTTPException(403, "Недостаточно прав для этого действия")
        return user

    return dependency
