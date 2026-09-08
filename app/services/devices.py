"""Устройства — компьютеры, с которых заходят в систему.

Как это работает
----------------
1. Браузер при первом заходе генерирует случайный ключ и кладёт его в своё
   хранилище. Дальше он шлёт этот ключ в заголовке X-Device-Key при каждом
   запросе.
2. Сервер записывает устройство: ключ, IP, браузер, время последнего визита.
3. Администратор в разделе «Устройства» даёт компьютерам понятные имена, а в
   профиле сотрудника выбирает, с каких устройств в него можно войти.

Что это даёт и чего не даёт
---------------------------
Даёт: с чужого компьютера в привязанный профиль не войти — ключа там нет.
Проверка идёт на каждом запросе, поэтому скопировать токен на другую машину
тоже не поможет.

Не даёт: это не привязка к железу в буквальном смысле. Браузеру недоступны
MAC-адрес, серийник диска и прочие идентификаторы оборудования — таких API
нет ни в одном браузере. Ключ живёт в хранилище браузера, значит:
  * очистка данных сайта или режим инкогнито = новое устройство;
  * другой браузер на том же компьютере = другое устройство;
  * человек с доступом к консоли браузера может скопировать ключ на другую
    машину.
Для внутренней системы в офисе этого достаточно: она защищает от того, чтобы
сотрудник зашёл под своим профилем из дома или с чужого рабочего места, а не
от целенаправленного обхода изнутри.
"""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import Device

MAX_UA = 300


def client_ip(request: Request | None) -> str:
    """IP клиента. Учитывает прокси, если сервер стоит за nginx."""
    if request is None:
        return ""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else ""


def touch(db: Session, key: str | None, request: Request | None = None) -> Device | None:
    """Находит устройство по ключу или заводит новое. Обновляет IP и время визита.

    Возвращает None, если ключа нет (например, старый браузер без поддержки
    или запрос из curl) — такие запросы считаются «без устройства».
    """
    if not key or len(key) < 8:
        return None

    key = key.strip()[:64]
    device = db.scalar(select(Device).where(Device.key == key))
    ip = client_ip(request)
    agent = (request.headers.get("user-agent", "")[:MAX_UA] if request else "")

    if device is None:
        device = Device(
            key=key,
            name="",
            first_ip=ip,
            last_ip=ip,
            user_agent=agent,
        )
        db.add(device)
        try:
            db.commit()
        except IntegrityError:
            # Гонка: страница при первом заходе шлёт несколько запросов разом,
            # и все они видят «устройства нет». Первый его создал — остальные
            # просто берут созданное вместо того, чтобы падать с ошибкой.
            db.rollback()
            device = db.scalar(select(Device).where(Device.key == key))
            if device is None:
                return None
            return device
        db.refresh(device)
        return device

    # обновляем, но не на каждый чих: запись раз в минуту, чтобы не долбить базу
    now = datetime.now(UTC)
    last = device.last_seen_at
    if last is not None and last.tzinfo is None:
        last = last.replace(tzinfo=UTC)
    if last is None or (now - last).total_seconds() > 60 or device.last_ip != ip:
        device.last_seen_at = now
        if ip:
            device.last_ip = ip
        if agent:
            device.user_agent = agent
        db.commit()
    return device


def display_name(device: Device) -> str:
    """Имя для интерфейса: заданное администратором или подсказка по IP."""
    if device.name:
        return device.name
    return f"Без имени · {device.last_ip or 'адрес неизвестен'}"


def can_login(employee, device: Device | None) -> bool:
    """Пускать ли этот профиль с этого устройства."""
    if getattr(employee, "access_mode", "any") != "devices":
        return True
    if device is None:
        return False
    return device.id in (employee.allowed_devices or [])


def browser_hint(user_agent: str) -> str:
    """Грубое определение браузера и системы — чтобы отличать устройства в списке."""
    ua = (user_agent or "").lower()
    if "firefox" in ua:
        browser = "Firefox"
    elif "edg/" in ua:
        browser = "Edge"
    elif "opr/" in ua or "opera" in ua:
        browser = "Opera"
    elif "yabrowser" in ua:
        browser = "Яндекс"
    elif "chrome" in ua:
        browser = "Chrome"
    elif "safari" in ua:
        browser = "Safari"
    else:
        browser = "Браузер"

    if "windows" in ua:
        system = "Windows"
    elif "android" in ua:
        system = "Android"
    elif "iphone" in ua or "ipad" in ua:
        system = "iOS"
    elif "mac os" in ua:
        system = "macOS"
    elif "linux" in ua:
        system = "Linux"
    else:
        system = ""

    return f"{browser}{' · ' + system if system else ''}"
