"""Курсы валют ЦБ РФ для калькулятора.

Источник — ежедневный JSON с cbr-xml-daily.ru (зеркало официальных курсов
ЦБ). Курсы меняются раз в день, поэтому ответ хранится в файле и обновляется
не чаще раза в TTL_SECONDS. Пропал интернет — отдаём последний сохранённый
курс с пометкой stale и его датой: сотруднику важнее посчитать примерно,
чем увидеть ошибку. Нет ни сети, ни кэша — RatesError.

Значение — за одну единицу валюты в рублях (у ЦБ иены идут за 100 штук —
делим на номинал).
"""

from __future__ import annotations

import json
import time
from urllib.request import Request, urlopen

from app.core.paths import data_dir

URL = "https://www.cbr-xml-daily.ru/daily_json.js"
CODES = ("USD", "EUR", "CNY")
TTL_SECONDS = 12 * 60 * 60
TIMEOUT = 30
CACHE_FILE = data_dir("POSTER_CACHE_DIR", "./cache") / "rates.json"


class RatesError(RuntimeError):
    """Курсы взять неоткуда."""


def _download() -> dict:
    request = Request(URL, headers={"User-Agent": "poster-crm/1.0"})
    with urlopen(request, timeout=TIMEOUT) as response:
        return json.loads(response.read().decode("utf-8"))


def _normalize(raw: dict) -> dict:
    rates = {}
    for code in CODES:
        item = raw["Valute"][code]
        rates[code] = {"value": round(item["Value"] / item["Nominal"], 4), "name": item["Name"]}
    # остальные валюты тоже пригодятся, но в интерфейсе их не показываем
    for code, item in raw["Valute"].items():
        rates.setdefault(code, {"value": round(item["Value"] / item["Nominal"], 4), "name": item["Name"]})
    return {"date": raw["Date"][:10], "rates": rates, "fetched_at": int(time.time())}


def _read_cache() -> dict | None:
    try:
        return json.loads(CACHE_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def get() -> dict:
    """Курсы: свежие, если кэш старше TTL и сеть есть; иначе — кэш с пометкой stale."""
    cached = _read_cache()
    if cached and time.time() - cached.get("fetched_at", 0) < TTL_SECONDS:
        return {**cached, "stale": False}
    try:
        fresh = _normalize(_download())
    except Exception as exc:  # любая сетевая беда — отдаём кэш
        if cached:
            return {**cached, "stale": True, "error": str(exc)}
        raise RatesError(f"Курсы ЦБ недоступны: {exc}. Проверьте интернет на сервере") from None
    try:
        CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
        CACHE_FILE.write_text(json.dumps(fresh, ensure_ascii=False), encoding="utf-8")
    except OSError:
        pass  # кэш не критичен
    return {**fresh, "stale": False}
