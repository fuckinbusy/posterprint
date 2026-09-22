"""Ежедневная копия базы из самого сервера.

На компьютере в мастерской копию делал планировщик Windows (см. README,
«Бэкапы»). На удалённом сервере планировщик — лишняя сущность: сервер
и так работает круглосуточно, пусть копирует сам. Включается переменной
POSTER_BACKUP_AT=03:30 (местное время сервера); POSTER_BACKUP_KEEP — сколько
последних копий хранить (по умолчанию 30).

Один поток, спит до назначенного времени, делает копию, спит дальше.
Копия — та же, что кнопка в «Журнале» и scripts/backup.py: JSON по разделам
плюс снимок файла базы. Ошибка копии пишется в журнал и не роняет сервер:
заказы принимать важнее, а про сбой копий администратор увидит в журнале.
"""

from __future__ import annotations

import logging
import os
import threading
from datetime import datetime, timedelta

from app.services import backup

log = logging.getLogger("poster")

DEFAULT_KEEP = 30


def parse_time(value: str | None) -> tuple[int, int] | None:
    """«03:30» → (3, 30); пусто или мусор → None (копии выключены)."""
    raw = (value or "").strip()
    if not raw:
        return None
    try:
        hours, minutes = raw.split(":")
        h, m = int(hours), int(minutes)
    except ValueError:
        return None
    if not (0 <= h < 24 and 0 <= m < 60):
        return None
    return h, m


def seconds_until(at: tuple[int, int], now: datetime) -> float:
    """Сколько ждать до ближайшего момента ЧЧ:ММ — сегодня или завтра."""
    target = now.replace(hour=at[0], minute=at[1], second=0, microsecond=0)
    if target <= now:
        target += timedelta(days=1)
    return (target - now).total_seconds()


class DailyBackup:
    def __init__(self, at: tuple[int, int], keep: int) -> None:
        self.at = at
        self.keep = keep
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._loop, name="poster-backup", daemon=True)

    def start(self) -> None:
        self._thread.start()
        log.info("Ежедневная копия: в %02d:%02d, храним %s последних", self.at[0], self.at[1], self.keep)

    def stop(self) -> None:
        self._stop.set()

    def _loop(self) -> None:
        while not self._stop.is_set():
            wait = seconds_until(self.at, datetime.now())
            if self._stop.wait(wait):
                return
            self.run_once()

    def run_once(self) -> None:
        try:
            info = backup.run()
            removed = backup.rotate(self.keep)
            log.info(
                "Копия сделана: %s · %s · удалено старых: %s",
                info["name"], ", ".join(f"{k} {v}" for k, v in info.get("counts", {}).items()), len(removed),
            )
        except Exception:
            log.exception("Ежедневная копия не удалась")


def from_env() -> DailyBackup | None:
    """Планировщик по настройкам из .env или None, если время не задано."""
    at = parse_time(os.getenv("POSTER_BACKUP_AT"))
    if at is None:
        return None
    try:
        keep = int((os.getenv("POSTER_BACKUP_KEEP") or str(DEFAULT_KEEP)).strip())
    except ValueError:
        keep = DEFAULT_KEEP
    return DailyBackup(at, keep)
