"""Ключ латиницей из русского названия — для видов работ и разделов прайса."""

from __future__ import annotations

import re


def slugify(value: str) -> str:
    """«Лазерная резка» → «lazernaya_rezka». Ключ нужен латиницей: он попадает
    в данные заказов и в API."""
    table = {
        "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "e",
        "ж": "zh", "з": "z", "и": "i", "й": "y", "к": "k", "л": "l", "м": "m",
        "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u",
        "ф": "f", "х": "h", "ц": "c", "ч": "ch", "ш": "sh", "щ": "sch",
        "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu", "я": "ya",
    }
    text = "".join(table.get(ch, ch) for ch in (value or "").lower())
    text = re.sub(r"[^a-z0-9]+", "_", text).strip("_")
    return text[:40] or "template"
