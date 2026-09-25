"""Скачивание шрифтов Google Fonts: TTF по начертаниям → zip с установщиком.

Как достаём файлы. У Google нет прямой ссылки «скачать семейство» без
браузера, зато есть CSS-API: запрос css2?family=Имя:ital,wght@0,400;0,700
с не-браузерным User-Agent отдаёт @font-face с адресами TTF на
fonts.gstatic.com — по одному файлу на начертание. Их и скачиваем.

Кэш. Каждый скачанный файл ложится в fonts_cache/<семейство>/<файл>.ttf:
повторная выдача тому же цеху — мгновенно и без интернета. Сеть с сервера
до Google медленная и не всегда есть, поэтому таймаут большой, а ошибка —
понятная: «Google Fonts недоступен».

В архив кладётся установить.cmd: ставит шрифты текущему пользователю Windows
(копия в %LOCALAPPDATA%\\Microsoft\\Windows\\Fonts + запись в реестре) — без
прав администратора, как это делает сама Windows по «Установить».
"""

from __future__ import annotations

import io
import re
import zipfile
from urllib.parse import quote
from urllib.request import Request, urlopen

from app.core.paths import data_dir
from app.services import cdr, fonts_catalog

CSS_URL = "https://fonts.googleapis.com/css2?family={family}:{query}"
CACHE_DIR = data_dir("POSTER_FONTS_CACHE_DIR", "./fonts_cache")
TIMEOUT = 60
# не браузерный UA: браузеру Google отдаёт woff2, остальным — ttf
USER_AGENT = "poster-crm/1.0 (+fonts tool)"

STYLE_NAMES = {
    "100": "Thin", "200": "ExtraLight", "300": "Light", "400": "Regular", "500": "Medium",
    "600": "SemiBold", "700": "Bold", "800": "ExtraBold", "900": "Black",
}


class FontsError(RuntimeError):
    """Шрифт не скачался — с понятной причиной."""


def _download(url: str) -> bytes:
    request = Request(url, headers={"User-Agent": USER_AGENT})
    with urlopen(request, timeout=TIMEOUT) as response:
        return response.read()


def style_name(style: str) -> str:
    """«700i» → «BoldItalic», «400» → «Regular»."""
    italic = style.endswith("i")
    weight = STYLE_NAMES.get(style.rstrip("i"), style.rstrip("i"))
    if italic:
        return "Italic" if weight == "Regular" else f"{weight}Italic"
    return weight


def css_query(styles: list[str]) -> str:
    """Начертания → часть запроса css2: ital,wght@0,400;0,700;1,400 (по возрастанию)."""
    pairs = sorted({(1 if s.endswith("i") else 0, int(s.rstrip("i"))) for s in styles})
    return "ital,wght@" + ";".join(f"{i},{w}" for i, w in pairs)


def ttf_urls(css: str) -> dict[str, str]:
    """Из ответа css2 — {начертание: адрес ttf}. Одно семейство может отдаваться
    несколькими блоками (по наборам символов); берём первый адрес на начертание."""
    urls: dict[str, str] = {}
    for block in re.findall(r"@font-face\s*\{(.*?)\}", css, flags=re.S):
        style = re.search(r"font-style:\s*(\w+)", block)
        weight = re.search(r"font-weight:\s*(\d+)", block)
        url = re.search(r"url\((https://[^)]+\.ttf)\)", block)
        if not (style and weight and url):
            continue
        key = weight.group(1) + ("i" if style.group(1) == "italic" else "")
        urls.setdefault(key, url.group(1))
    return urls


def _slug(family: str) -> str:
    return re.sub(r"[^A-Za-z0-9]+", "", family) or "Font"


def fetch_family(family_name: str, styles: list[str]) -> list[tuple[str, bytes]]:
    """Файлы начертаний семейства: [(имя файла, байты)]. Сначала из кэша, недостающее — из сети."""
    item = fonts_catalog.family(family_name)
    if item is None:
        raise FontsError(f"«{family_name}» нет в каталоге Google Fonts")
    wanted = [s.strip() for s in styles if s.strip()]
    unknown = [s for s in wanted if s not in item["variants"]]
    if not wanted or unknown:
        raise FontsError(
            f"у «{item['family']}» нет начертания {', '.join(unknown) or '—'}; есть: {', '.join(item['variants'])}"
        )
    folder = CACHE_DIR / cdr.safe_filename(item["family"])
    result: list[tuple[str, bytes]] = []
    missing: list[str] = []
    for style in wanted:
        path = folder / f"{_slug(item['family'])}-{style_name(style)}.ttf"
        if path.exists() and path.stat().st_size > 0:
            result.append((path.name, path.read_bytes()))
        else:
            missing.append(style)
    if missing:
        url = CSS_URL.format(family=quote(item["family"]), query=css_query(missing))
        try:
            urls = ttf_urls(_download(url).decode("utf-8", "replace"))
            fetched = []
            for style in missing:
                if style not in urls:
                    raise FontsError(f"Google Fonts не отдал начертание {style} для «{item['family']}»")
                fetched.append((style, _download(urls[style])))
        except FontsError:
            raise
        except Exception as exc:
            raise FontsError(f"Google Fonts недоступен с сервера: {exc}") from None
        folder.mkdir(parents=True, exist_ok=True)
        for style, data in fetched:
            path = folder / f"{_slug(item['family'])}-{style_name(style)}.ttf"
            path.write_bytes(data)
            result.append((path.name, data))
    # порядок — как просили
    order = {f"{_slug(item['family'])}-{style_name(s)}.ttf": i for i, s in enumerate(wanted)}
    result.sort(key=lambda pair: order[pair[0]])
    return result


def installer_cmd(files: list[str]) -> str:
    """установить.cmd — для текущего пользователя Windows, без прав администратора."""
    lines = [
        "@echo off",
        "chcp 65001 >nul",
        "setlocal",
        'set "DEST=%LOCALAPPDATA%\\Microsoft\\Windows\\Fonts"',
        'if not exist "%DEST%" mkdir "%DEST%"',
        "echo Устанавливаю шрифты для пользователя %USERNAME% ...",
    ]
    for name in files:
        stem = name[:-4] if name.lower().endswith(".ttf") else name
        lines += [
            f'copy /y "%~dp0{name}" "%DEST%\\{name}" >nul && echo   + {name}',
            f'reg add "HKCU\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Fonts" /v "{stem} (TrueType)" '
            f'/t REG_SZ /d "%DEST%\\{name}" /f >nul',
        ]
    lines += [
        "echo Готово. Если программа уже открыта - перезапустите её, чтобы увидеть шрифт.",
        "pause",
    ]
    return "\r\n".join(lines) + "\r\n"


LICENSE_NOTE = (
    "Шрифты из Google Fonts распространяются по открытым лицензиям (SIL Open Font License\n"
    "или Apache 2.0): их можно использовать в коммерческой печати, встраивать в макеты и\n"
    "передавать заказчику. Нельзя продавать сами файлы шрифтов как товар.\n"
    "Подробности по семейству: https://fonts.google.com/specimen/{family}/license\n"
)


def build_zip(family_name: str, styles: list[str]) -> bytes:
    files = fetch_family(family_name, styles)
    item = fonts_catalog.family(family_name)
    assert item is not None
    folder = _slug(item["family"])
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in files:
            z.writestr(f"{folder}/{name}", data)
        z.writestr(f"{folder}/установить.cmd", installer_cmd([name for name, _ in files]).encode("utf-8"))
        z.writestr(f"{folder}/ЛИЦЕНЗИЯ.txt", LICENSE_NOTE.format(family=quote(item["family"])).encode("utf-8"))
    return buf.getvalue()
