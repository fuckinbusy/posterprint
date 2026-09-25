"""Снимок каталога Google Fonts → app/data/google_fonts.json.

    python -m scripts.refresh_fonts_catalog

Зачем снимок. Сервер в мастерской доходит до Google медленно и не всегда, а
поиск по шрифтам должен работать мгновенно и без интернета. Поэтому список
семейств лежит в репозитории и обновляется этим скриптом при выпуске; сами
файлы шрифтов сервер берёт с fonts.gstatic.com в момент скачивания.

Берутся только открытые семейства (isOpenSource): у них лицензии OFL или
Apache — печатать и продавать изделия с ними можно. Из полного описания
(2,7 МБ) остаётся нужное: имя, категория, наборы символов, начертания,
переменные оси, популярность.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from urllib.request import Request, urlopen

URL = "https://fonts.google.com/metadata/fonts"
OUT = Path(__file__).resolve().parent.parent / "app" / "data" / "google_fonts.json"
TIMEOUT = 120


def fetch() -> dict:
    request = Request(URL, headers={"User-Agent": "poster-crm/1.0"})
    with urlopen(request, timeout=TIMEOUT) as response:
        text = response.read().decode("utf-8")
    # Google предваряет JSON строкой-защитой от подмены: )]}'
    return json.loads(re.sub(r"^\)\]\}'\n?", "", text))


def slim(raw: dict) -> list[dict]:
    out = []
    for item in raw["familyMetadataList"]:
        if item.get("isOpenSource") is False:
            continue
        out.append({
            "family": item["family"],
            "category": item["category"],
            "subsets": sorted(s for s in item.get("subsets", []) if s != "menu"),
            "variants": list(item.get("fonts", {}).keys()),
            "axes": [a["tag"] for a in item.get("axes", [])],
            "popularity": item.get("popularity", 10**6),
        })
    out.sort(key=lambda x: x["popularity"])
    return out


def main() -> None:
    print(f"Скачиваю {URL} …")
    families = slim(fetch())
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(families, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    cyr = sum(1 for f in families if "cyrillic" in f["subsets"])
    print(f"Записано {OUT}: семейств {len(families)}, с кириллицей {cyr}, {OUT.stat().st_size // 1024} КБ")


if __name__ == "__main__":
    try:
        main()
    except OSError as exc:
        sys.exit(f"Не удалось скачать каталог: {exc}")
