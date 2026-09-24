"""API-ключи сотрудников: пропуск для ботов, программ и скриптов.

Зачем. Вход в систему рассчитан на человека в браузере: имя, пароль, токен
на 14 дней, привязка к компьютеру. Боту это неудобно, а профиль с привязкой
он не откроет вовсе. Ключ — постоянный пропуск: запрос с заголовком
`X-API-Key: pst_…` (или `Authorization: Bearer pst_…`) работает от имени
сотрудника и ровно с его правами. Проверка — в app/core/security.py.

Как хранится. В базе ключа открытым текстом нет:

- api_key_hash — отпечаток SHA-256. По нему сервер находит сотрудника;
  обратно в ключ он не превращается. Соль не нужна: ключ — 256 случайных
  бит, а не придуманный человеком пароль, перебирать тут нечего.
- api_key_enc — ключ, зашифрованный так же, как пароли почтовых ящиков
  (app/core/crypto.py). Из него администратор видит ключ в профиле.

Копия базы без .env ключей не раскроет: отпечаток бесполезен, а шифр без
POSTER_SECRET_KEY не снять. Если сменить POSTER_SECRET_KEY, ключи продолжат
работать (отпечаток от секрета не зависит), но посмотреть их станет нельзя —
тогда их перевыпускают.
"""

from __future__ import annotations

import hashlib
import secrets

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import crypto
from app.models import Employee

PREFIX = "pst_"


def generate() -> str:
    """Новый ключ: приставка + 32 случайных байта (43 символа base64url).

    Приставка отличает ключ от токена сессии в заголовке Authorization и
    сразу видна, если ключ случайно попадёт в чат или в код."""
    return PREFIX + secrets.token_urlsafe(32)


def fingerprint(key: str) -> str:
    return hashlib.sha256(key.encode("utf-8")).hexdigest()


def looks_like_key(value: str | None) -> bool:
    return value is not None and value.startswith(PREFIX)


def issue(employee: Employee) -> str:
    """Выдаёт сотруднику новый ключ, прежний перестаёт работать.

    Сохраняет вызывающий (db.commit) — так выдача ключа попадает в ту же
    запись, что и создание профиля."""
    key = generate()
    employee.api_key_hash = fingerprint(key)
    employee.api_key_enc = crypto.encrypt(key)
    return key


def reveal(employee: Employee) -> str:
    """Ключ для показа администратору. Пусто — ключа нет или его не
    расшифровать (сменили POSTER_SECRET_KEY): нужен перевыпуск."""
    return crypto.decrypt(employee.api_key_enc or "")


def find_employee(db: Session, key: str | None) -> Employee | None:
    """Сотрудник, которому выдан этот ключ. Активен ли он — решает вызывающий."""
    if not looks_like_key(key):
        return None
    return db.scalar(select(Employee).where(Employee.api_key_hash == fingerprint(key or "")))


def issue_missing(db: Session) -> int:
    """Выдаёт ключи профилям, у которых их нет, — заведённым до появления
    ключей. Возвращает, скольким выдал."""
    rows = db.scalars(select(Employee).where(Employee.api_key_hash.is_(None))).all()
    for employee in rows:
        issue(employee)
    if rows:
        db.commit()
    return len(rows)
