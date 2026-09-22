"""Шифрование секретов, которые нужно уметь прочитать обратно.

Пароли для входа хранятся хэшем — их читать обратно не нужно. Но пароль
приложения от почтового ящика сервер должен отдать SMTP-серверу как есть,
поэтому в базе он лежит зашифрованным: Fernet (AES-128-CBC + HMAC) из
библиотеки cryptography, ключ выводится из POSTER_SECRET_KEY.

Честно о границах. Ключ лежит в .env на том же диске: тот, кто может
прочитать и базу, и .env, расшифрует пароль. Защита от этого — права на
файлы (см. deploy.file_permission_problems и README, «Безопасность»):
служба работает от своего пользователя, и файлы читает только она.
Шифрование закрывает другое: копию базы, унесённую на флешке, выгрузку
в JSON, случайный `SELECT * FROM settings` на экране — там пароль
больше не виден.
"""

from __future__ import annotations

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken

from app.core.security import _secret

PREFIX = "enc:"


def _fernet() -> Fernet:
    # ключ Fernet — 32 байта в urlsafe-base64; выводим из секрета подписи с
    # «солью» назначения, чтобы ключ шифрования не совпадал с ключом подписи
    raw = hashlib.sha256(b"poster-settings:" + _secret()).digest()
    return Fernet(base64.urlsafe_b64encode(raw))


def encrypt(text: str) -> str:
    """Пустое — пустым: «пароля нет» не нужно шифровать."""
    if not text:
        return ""
    return PREFIX + _fernet().encrypt(text.encode("utf-8")).decode("ascii")


def decrypt(value: str) -> str:
    """Расшифровывает, если значение зашифровано; открытый текст (старые
    записи до появления шифрования) отдаёт как есть. Значение, которое
    выглядит зашифрованным, но не подходит под ключ (сменили
    POSTER_SECRET_KEY), считается пустым — пароль придётся ввести заново."""
    if not value or not value.startswith(PREFIX):
        return value
    try:
        return _fernet().decrypt(value[len(PREFIX):].encode("ascii")).decode("utf-8")
    except (InvalidToken, ValueError):
        return ""


def is_encrypted(value: str) -> bool:
    return bool(value) and value.startswith(PREFIX)
