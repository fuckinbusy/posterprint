"""Каталог Google Fonts из снимка в репозитории (app/data/google_fonts.json).

Снимок делает scripts/refresh_fonts_catalog.py. Здесь — загрузка один раз в
память, поиск по имени с фильтрами и распознавание системных шрифтов Windows:
их скачивать не нужно, они есть на любом компьютере в цехе.
"""

from __future__ import annotations

import json
from functools import lru_cache

from app.core.paths import BASE_DIR

CATALOG_FILE = BASE_DIR / "app" / "data" / "google_fonts.json"

# Шрифты из состава Windows (и CorelDRAW): в макетах они встречаются постоянно,
# но ставить их не надо. Сравнение без учёта регистра.
SYSTEM_FONTS = {
    "arial", "arial black", "arial narrow", "times new roman", "calibri", "cambria", "candara",
    "verdana", "tahoma", "segoe ui", "segoe ui symbol", "courier new", "georgia", "impact",
    "comic sans ms", "trebuchet ms", "consolas", "constantia", "corbel", "franklin gothic",
    "garamond", "palatino linotype", "book antiqua", "century gothic", "lucida console",
    "lucida sans unicode", "microsoft sans serif", "ms gothic", "ms mincho", "ms pgothic",
    "sylfaen", "symbol", "wingdings", "webdings", "bahnschrift", "yu gothic", "malgun gothic",
    "meiryo", "simsun", "mingliu", "ebrima", "gadugi", "leelawadee ui", "nirmala ui",
}


@lru_cache(maxsize=1)
def load() -> list[dict]:
    return json.loads(CATALOG_FILE.read_text(encoding="utf-8"))


@lru_cache(maxsize=1)
def _by_name() -> dict[str, dict]:
    return {item["family"].casefold(): item for item in load()}


def family(name: str) -> dict | None:
    """Семейство по имени без учёта регистра; None — в каталоге нет."""
    return _by_name().get(name.strip().casefold())


def is_system(name: str) -> bool:
    return name.strip().casefold() in SYSTEM_FONTS


def search(q: str = "", cyrillic: bool = True, category: str = "", limit: int = 60) -> list[dict]:
    """Семейства по подстроке имени, в порядке популярности Google Fonts.

    Точное совпадение и совпадение с начала имени — раньше остальных: по
    запросу «roboto» первым нужен Roboto, а не Roboto Condensed."""
    needle = q.strip().casefold()
    rows = []
    for item in load():
        if cyrillic and "cyrillic" not in item["subsets"]:
            continue
        if category and item["category"] != category:
            continue
        name = item["family"].casefold()
        if needle and needle not in name:
            continue
        rank = 0 if name == needle else 1 if name.startswith(needle) else 2
        rows.append((rank, item["popularity"], item))
    rows.sort(key=lambda r: (r[0], r[1]))
    return [r[2] for r in rows[:limit]]


def count(q: str = "", cyrillic: bool = True, category: str = "") -> int:
    return len(search(q, cyrillic, category, limit=10**6))
