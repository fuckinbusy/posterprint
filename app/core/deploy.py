"""Режим «сервер в интернете»: что должно быть настроено и какие заголовки
отдавать, когда к системе ходят не из своей сети.

Включается одной переменной POSTER_PUBLIC=1. В этом режиме сервер отказывается
стартовать с паролем по умолчанию, без ключа подписи и без списка адресов,
на которые он отзывается: снаружи первое же сканирование найдёт «admin».

Без POSTER_PUBLIC всё работает как раньше — для компьютера в мастерской
и для разработки. Заголовки безопасности отдаются всегда: дома они не мешают.
"""

from __future__ import annotations

import base64
import hashlib
import os
import re
from collections.abc import Mapping
from pathlib import Path

from app.core.paths import BASE_DIR

# короче — подбирается по словарю за часы; это про POSTER_ADMIN_PASSWORD,
# у профилей сотрудников свои правила (см. проверку при старте)
MIN_ADMIN_PASSWORD = 10
MIN_SECRET = 32

# сколько байт тела принимаем в обычной ручке: самый большой честный запрос —
# настройки с логотипом (400 КБ картинки в base64). Макеты грузятся своей
# ручкой со своим лимитом и в этот не упираются.
MAX_BODY_BYTES = 2 * 1024 * 1024
UPLOAD_PATH = re.compile(r"^/api/orders/\d+/design$")


def _flag(value: str | None) -> bool:
    return (value or "").strip().lower() in ("1", "true", "yes", "on")


def _list(value: str | None) -> list[str]:
    return [item.strip() for item in (value or "").split(",") if item.strip()]


PUBLIC = _flag(os.getenv("POSTER_PUBLIC"))
ALLOWED_HOSTS = _list(os.getenv("POSTER_ALLOWED_HOSTS"))


def check(env: Mapping[str, str | None]) -> list[str]:
    """Что мешает открывать сервер наружу. Пусто — можно.

    Чистая функция от переменных окружения, чтобы её проверяли тесты.
    """
    problems: list[str] = []
    digest = (env.get("POSTER_ADMIN_PASSWORD_HASH") or "").strip()
    password = (env.get("POSTER_ADMIN_PASSWORD") or "").strip()
    if digest:
        if digest.count("$") != 2 or not digest.startswith("pbkdf2$"):
            problems.append("POSTER_ADMIN_PASSWORD_HASH не похож на хэш — задайте его командой python -m scripts.set_password")
    elif not password or password.lower() == "admin":
        problems.append("Пароль администратора не задан или равен «admin» — задайте: python -m scripts.set_password")
    else:
        problems.append(
            "POSTER_ADMIN_PASSWORD лежит открытым текстом — переведите в хэш: python -m scripts.set_password"
        )

    secret = (env.get("POSTER_SECRET_KEY") or "").strip()
    if len(secret) < MIN_SECRET:
        problems.append(
            f"POSTER_SECRET_KEY не задан или короче {MIN_SECRET} знаков — им подписаны все сессии; "
            "сгенерируйте: python -c \"import secrets; print(secrets.token_urlsafe(48))\""
        )

    if not _list(env.get("POSTER_ALLOWED_HOSTS")):
        problems.append(
            "POSTER_ALLOWED_HOSTS не задан — укажите домен сервера, иначе он отвечает на любое имя "
            "и его можно подставить в чужую страницу"
        )
    return problems


# ---------------------------------------------------------------- заголовки
def inline_script_hashes() -> list[str]:
    """Хэши встроенных скриптов собранной страницы — для CSP.

    В index.html один такой скрипт: выставляет светлую тему до загрузки
    стилей, чтобы страница не вспыхивала тёмным. Запрещать inline-скрипты
    целиком и переносить его в файл — значит вернуть вспышку; хэш точнее:
    разрешён ровно этот текст, любой подменённый — нет.
    """
    page = BASE_DIR / "static" / "dist" / "index.html"
    if not page.exists():
        return []
    # Хэш считается по тексту скрипта после разбора HTML, а разбор приводит
    # переводы строк к LF (так велит стандарт HTML) — приводим и мы, иначе
    # файл с CRLF (git на Windows) даёт хэш, который браузер не узнает.
    html = page.read_bytes().replace(b"\r\n", b"\n").replace(b"\r", b"\n")
    hashes = []
    for body in re.findall(rb"<script>(.*?)</script>", html, flags=re.S):
        digest = hashlib.sha256(body).digest()
        hashes.append("'sha256-" + base64.b64encode(digest).decode("ascii") + "'")
    return hashes


def content_security_policy() -> str:
    """Что странице можно грузить. Своё — да, чужое — нет.

    Инлайн-стили разрешены: письма в разделе «Почта» показываются в рамке
    со своей разметкой, а у писем стили только инлайн. Скрипты в письмах
    вырезает санитайзер, и рамка без allow-scripts. Картинки — свои, data:
    (QR для оплаты, вложенные картинки писем) и https (картинки в письмах).
    """
    scripts = " ".join(["'self'", *inline_script_hashes()])
    return "; ".join(
        [
            "default-src 'self'",
            f"script-src {scripts}",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: blob: https:",
            "font-src 'self'",
            "connect-src 'self'",
            "frame-src 'self' blob:",
            "object-src 'none'",
            "base-uri 'self'",
            "form-action 'self'",
            "frame-ancestors 'none'",
        ]
    )


CSP = content_security_policy()

# полгода: столько браузер будет ходить только по https, даже если человек
# наберёт адрес без него
HSTS = "max-age=15552000"

# файлы сборки: в имени хэш, содержимое по этому адресу не меняется никогда
IMMUTABLE = "public, max-age=31536000, immutable"


def security_headers(path: str, scheme: str) -> dict[str, str]:
    """Заголовки для ответа. Чистая функция — по пути и схеме запроса."""
    headers = {
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "same-origin",
        "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
    }
    if path.startswith("/static/dist/assets/"):
        headers["Cache-Control"] = IMMUTABLE
    headers["Content-Security-Policy"] = CSP
    headers["X-Frame-Options"] = "DENY"
    if PUBLIC and scheme == "https":
        headers["Strict-Transport-Security"] = HSTS
    return headers


# ---------------------------------------------------------------- права на файлы
# Что не должны читать другие пользователи машины: секреты, база, копии, макеты
PROTECTED = (".env", ".secret")


def file_permission_problems(base: Path, extra: list[Path] = ()) -> list[str]:  # type: ignore[assignment]
    """Файлы с секретами и данными, которые может прочитать не только владелец.

    Только для POSIX: там права — три цифры, и «группа и остальные могут
    читать» видно по одной маске. На Windows права другие, проверять их
    отсюда не выйдет — подсказка в README, «Безопасность».
    """
    if os.name != "posix":
        return []
    problems = []
    for path in [*(base / name for name in PROTECTED), *extra]:
        if not path.exists():
            continue
        mode = path.stat().st_mode & 0o777
        if mode & 0o077:
            problems.append(f"{path.name}: права {mode:03o}, читают все — chmod {'700' if path.is_dir() else '600'} {path}")
    return problems


def body_too_large(path: str, content_length: str | None) -> bool:
    """Отсечь слишком большое тело до того, как оно прочитано.

    Загрузка макета ходит своей ручкой и режется там по своему лимиту;
    остальным ручкам больше пары мегабайт присылать нечего.
    """
    if not content_length or UPLOAD_PATH.match(path):
        return False
    try:
        return int(content_length) > MAX_BODY_BYTES
    except ValueError:
        return True
