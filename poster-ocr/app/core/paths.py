"""Корень проекта и переменные окружения — одно место для всех.

Раньше каждый модуль считал BASE_DIR через parent.parent от себя и сам звал
load_dotenv(): любой переезд файла в подпапку молча ронял пути к базе, логам
и копиям, а .env искался относительно того, кого импортировали первым.
Теперь .env читается здесь, один раз, по абсолютному пути; переменные,
заданные снаружи (в системе или командной строке), главнее файла.
"""

import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent.parent

load_dotenv(BASE_DIR / ".env")


def data_dir(env_name: str, default: str) -> Path:
    """Папка данных из .env (логи, копии, макеты) — абсолютный путь.

    Относительный путь в .env («./logs») считается от корня проекта, а не от
    рабочего каталога: сервер и скрипты запускают из разных мест (корень
    монорепозитория, systemd, cron), и папка не должна заводиться там,
    откуда случайно запустили. Пояснение после «#» в той же строке .env
    отрезается, чтобы приложение не падало с непонятной ошибкой.
    """
    raw = (os.getenv(env_name) or "").split("#")[0].strip()
    path = Path(raw) if raw else BASE_DIR / default
    return path if path.is_absolute() else (BASE_DIR / path).resolve()
