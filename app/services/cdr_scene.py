"""Содержимое макета CorelDRAW: сцена для просмотра и выгрузка в открытые форматы.

Откуда берётся разбор
---------------------
Формат .cdr закрытый и от версии к версии меняется. Единственный открытый
разборщик, который читает и старые, и свежие файлы (проверено на версиях 16,
23 и 27), — библиотека libcdr из проекта LibreOffice. Писать свой означало бы
годами догонять её. Поэтому файл разбирает она, а мы превращаем результат в
сцену для интерфейса: страницы, объекты, размеры.

libcdr доступна двумя путями, ищем в этом порядке:

* ``cdr2xhtml`` — маленькая утилита из пакета ``libcdr-tools`` (на сервере:
  ``sudo apt install libcdr-tools``). Отдаёт все страницы разом.
* Inkscape — у него libcdr внутри. Тяжелее, зато умеет ещё и PDF.

Нет ни того ни другого — просмотр честно говорит, чего не хватает; эскиз из
файла (app/services/cdr.py) при этом работает как раньше.

Что получается, а что нет
-------------------------
Кривые, заливки, обводки, растровые вставки и размеры передаются точно —
в пунктах (1/72 дюйма), отсюда и миллиметры в интерфейсе. Текст, не
переведённый в кривые, libcdr отдаёт приблизительно: шрифт подставит браузер,
переносы строк и интервалы могут отличаться от оригинала. Размерные линии и
эффекты (тени, линзы, PowerClip) могут пропасть. Поэтому рядом всегда остаётся
эскиз, сохранённый самим CorelDRAW, — он показывает, как макет выглядит на
самом деле.

Записать .cdr не умеет никто, кроме CorelDRAW: «пересохранить в версию 16»
без него нельзя. Зато сцену можно отдать как SVG (и PDF, если есть Inkscape) —
CorelDRAW X6 такие файлы импортирует с сохранением кривых и размеров.

Безопасность
------------
SVG вставляется в страницу, а исходник приходит от клиента, поэтому всё, что
не входит в короткий список разрешённых тегов и атрибутов, выбрасывается:
скрипты, обработчики событий, внешние ссылки. Картинки — только вшитые data:.
"""

from __future__ import annotations

import gzip
import json
import os
import re
import shutil
import subprocess
import tempfile
import threading
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

SVG_NS = "http://www.w3.org/2000/svg"
XLINK_NS = "http://www.w3.org/1999/xlink"
XML_NS = "http://www.w3.org/XML/1998/namespace"

TIMEOUT = 120                      # секунд на разбор одного файла
MAX_SVG_BYTES = 60 * 1024 * 1024   # крупнее — браузер всё равно не провернёт
MAX_OBJECTS = 60_000
PT_TO_MM = 25.4 / 72

# одна конвертация за раз: мини-компьютер в мастерской не резиновый
_convert_lock = threading.Lock()

# ---------------------------------------------------------------- версия файла
VERSION_NAMES = {
    5: "5", 6: "6", 7: "7", 8: "8", 9: "9", 10: "10", 11: "11", 12: "12",
    13: "X3", 14: "X4", 15: "X5", 16: "X6", 17: "X7", 18: "X8",
    19: "2017", 20: "2018", 21: "2019", 22: "2020", 23: "2021",
    24: "2022", 25: "2023", 26: "2024", 27: "2025",
}
ROOT_NAMES = ("content/root.dat", "content/riffdata.cdr")


def _version_from_header(head: bytes) -> int | None:
    """RIFF....CDRx: x — цифра версии (4–9) или буква (A = 10, G = 16, R = 27)."""
    if len(head) < 12 or head[:4] != b"RIFF" or head[8:11] not in (b"CDR", b"cdr"):
        return None
    mark = chr(head[11])
    if mark.isdigit():
        return int(mark)
    if "A" <= mark <= "Z":
        return ord(mark) - ord("A") + 10
    return None


def version(path: Path) -> dict | None:
    """Версия CorelDRAW, в которой сохранён файл. None — не распознали."""
    try:
        with path.open("rb") as fh:
            head = fh.read(16)
        if head.startswith(b"PK"):
            with zipfile.ZipFile(path) as archive:
                names = {n.lower(): n for n in archive.namelist()}
                for wanted in ROOT_NAMES:
                    if wanted in names:
                        with archive.open(names[wanted]) as inner:
                            head = inner.read(16)
                        break
        number = _version_from_header(head)
    except (OSError, zipfile.BadZipFile):
        return None
    if number is None:
        return None
    name = VERSION_NAMES.get(number, str(number))
    return {"number": number, "name": f"CorelDRAW {name}", "label": f"CorelDRAW {name} (версия {number})"}


# ---------------------------------------------------------------- поиск разборщика
INKSCAPE_GUESSES = (
    r"C:\Program Files\Inkscape\bin\inkscape.exe",
    r"C:\Program Files\Inkscape\bin\inkscape.com",
    "/usr/bin/inkscape",
    "/snap/bin/inkscape",
    "/Applications/Inkscape.app/Contents/MacOS/inkscape",
)


def _which(env_name: str, names: tuple[str, ...], guesses: tuple[str, ...] = ()) -> str | None:
    explicit = (os.getenv(env_name) or "").strip()
    if explicit:
        return explicit if Path(explicit).exists() else None
    for name in names:
        found = shutil.which(name)
        if found:
            return found
    for guess in guesses:
        if Path(guess).exists():
            return guess
    return None


def find_libcdr() -> str | None:
    return _which("POSTER_CDR2XHTML", ("cdr2xhtml",))


def find_inkscape() -> str | None:
    return _which("POSTER_INKSCAPE", ("inkscape",), INKSCAPE_GUESSES)


def tools() -> dict:
    """Что установлено — для подсказки в интерфейсе и для scripts/cdr_convert."""
    libcdr, inkscape = find_libcdr(), find_inkscape()
    return {
        "libcdr": libcdr or "",
        "inkscape": inkscape or "",
        "can_view": bool(libcdr or inkscape),
        "can_pdf": bool(inkscape),
    }


INSTALL_HINT = (
    "На сервере не установлен разборщик CorelDRAW. Linux: sudo apt install libcdr-tools "
    "(или inkscape — тогда будет и выгрузка в PDF). Windows: установите Inkscape."
)


class SceneError(Exception):
    """Понятная причина, почему содержимое макета показать нельзя."""


# ---------------------------------------------------------------- запуск разборщика
def _run(args: list[str], *, capture: bool = True) -> bytes:
    try:
        done = subprocess.run(
            args,
            stdout=subprocess.PIPE if capture else subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            timeout=TIMEOUT,
            check=False,
        )
    except subprocess.TimeoutExpired:
        raise SceneError(f"Макет разбирался дольше {TIMEOUT} с — слишком сложный файл") from None
    except OSError as exc:
        raise SceneError(f"Не удалось запустить разборщик: {exc}") from None
    if done.returncode != 0:
        tail = (done.stderr or b"").decode("utf-8", "replace").strip().splitlines()[-1:] or [""]
        raise SceneError(f"Разборщик не смог прочитать файл. {tail[0]}".strip())
    return done.stdout or b""


def _with_ascii_copy(path: Path, fn):
    """Внешним программам отдаём копию с простым именем во временной папке:
    кириллица в пути ломает Inkscape на Windows, а исходник так точно никто
    не тронет."""
    with tempfile.TemporaryDirectory(prefix="poster-cdr-") as tmp:
        source = Path(tmp) / "design.cdr"
        shutil.copyfile(path, source)
        return fn(source, Path(tmp))


def convert_to_svg(path: Path) -> tuple[bytes, str]:
    """Сырой ответ разборщика и его имя: XHTML со страницами (libcdr) или SVG (Inkscape)."""
    libcdr = find_libcdr()
    if libcdr:
        with _convert_lock:
            return _with_ascii_copy(path, lambda src, _tmp: _run([libcdr, str(src)])), "libcdr"
    inkscape = find_inkscape()
    if inkscape:
        def via_inkscape(src: Path, tmp: Path) -> bytes:
            out = tmp / "design.svg"
            _run([inkscape, str(src), "--export-type=svg", "--export-plain-svg",
                  f"--export-filename={out}"], capture=False)
            if not out.exists():
                raise SceneError("Inkscape не создал файл — возможно, эта версия CorelDRAW ему незнакома")
            return out.read_bytes()

        with _convert_lock:
            return _with_ascii_copy(path, via_inkscape), "inkscape"
    raise SceneError(INSTALL_HINT)


def convert_to_pdf(path: Path) -> bytes:
    """PDF для открытия в старом CorelDRAW. Нужен Inkscape."""
    inkscape = find_inkscape()
    if not inkscape:
        raise SceneError("Для PDF нужен Inkscape на сервере (sudo apt install inkscape). SVG доступен и без него.")

    def run(src: Path, tmp: Path) -> bytes:
        out = tmp / "design.pdf"
        _run([inkscape, str(src), "--export-type=pdf", f"--export-filename={out}"], capture=False)
        if not out.exists():
            raise SceneError("Inkscape не создал PDF")
        return out.read_bytes()

    with _convert_lock:
        return _with_ascii_copy(path, run)


# ---------------------------------------------------------------- чистка SVG
DRAWABLE = {"path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text", "image"}
CONTAINERS = {"g", "defs", "clipPath", "mask", "linearGradient", "radialGradient", "pattern", "marker", "symbol"}
ALLOWED_TAGS = DRAWABLE | CONTAINERS | {"svg", "tspan", "stop", "use", "title"}
NO_OBJECTS_INSIDE = {"defs", "clipPath", "mask", "pattern", "marker", "symbol"}

ALLOWED_ATTRS = {
    "d", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "fx", "fy", "dx", "dy",
    "width", "height", "points", "transform", "style", "viewBox", "preserveAspectRatio",
    "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-opacity",
    "stroke-linecap", "stroke-linejoin", "stroke-miterlimit", "stroke-dasharray", "stroke-dashoffset",
    "opacity", "clip-path", "clip-rule", "mask", "marker-start", "marker-mid", "marker-end",
    "font-family", "font-size", "font-weight", "font-style", "font-variant", "text-anchor",
    "text-decoration", "letter-spacing", "word-spacing", "writing-mode", "rotate", "textLength",
    "offset", "stop-color", "stop-opacity", "gradientUnits", "gradientTransform", "spreadMethod",
    "patternUnits", "patternContentUnits", "patternTransform", "clipPathUnits", "maskUnits",
    "markerWidth", "markerHeight", "refX", "refY", "orient", "markerUnits", "version",
}
_URL_REF = re.compile(r"url\(\s*['\"]?#([^'\")\s]+)['\"]?\s*\)")
_ANY_URL = re.compile(r"url\(", re.I)
_BAD_VALUE = re.compile(r"(javascript:|vbscript:|expression\s*\(|@import|behavior\s*:|-moz-binding|<|&#)", re.I)
_DATA_IMAGE = re.compile(r"^data:image/(png|jpe?g|gif|bmp|webp);base64,[A-Za-z0-9+/=\s]+$", re.I)


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1] if isinstance(tag, str) else ""


def _inches(value: str | None) -> float | None:
    """«8.2677in» → пункты. libcdr пишет размеры страницы в дюймах."""
    if not value:
        return None
    m = re.match(r"^\s*([0-9.]+)\s*(in|pt|px|mm|cm)?\s*$", value)
    if not m:
        return None
    number = float(m.group(1))
    unit = m.group(2) or "pt"
    return number * {"in": 72.0, "pt": 1.0, "px": 0.75, "mm": 72 / 25.4, "cm": 720 / 25.4}[unit]


class _Cleaner:
    """Переносит разрешённое из сырого SVG в чистое дерево и нумерует объекты."""

    def __init__(self, page: int):
        self.page = page
        self.ids: dict[str, str] = {}
        self.counts: dict[str, int] = {}
        self.fonts: set[str] = set()
        self.objects = 0

    def _new_id(self, old: str) -> str:
        if old not in self.ids:
            self.ids[old] = f"cdr{self.page}_{len(self.ids)}"
        return self.ids[old]

    def _value(self, value: str) -> str | None:
        if _BAD_VALUE.search(value):
            return None
        # ссылки внутри файла (градиенты, обтравка) оставляем, внешние — нет
        rewritten = _URL_REF.sub(lambda m: f"url(#{self._new_id(m.group(1))})", value)
        if len(_ANY_URL.findall(rewritten)) != len(_URL_REF.findall(rewritten)):
            return None
        return rewritten

    def clean(self, node: ET.Element, inside_defs: bool = False) -> ET.Element | None:
        tag = _local(node.tag)
        if tag not in ALLOWED_TAGS:
            return None
        out = ET.Element(f"{{{SVG_NS}}}{tag}")
        for raw_name, raw_value in node.attrib.items():
            name = _local(raw_name)
            value = raw_value.strip()
            if name == "id":
                out.set("id", self._new_id(value))
            elif name == "href":
                if tag == "image" and _DATA_IMAGE.match(value):
                    out.set("href", value)
                elif tag in ("use", "linearGradient", "radialGradient", "pattern") and value.startswith("#"):
                    out.set("href", f"#{self._new_id(value[1:])}")
            elif name in ALLOWED_ATTRS and not name.startswith("on"):
                cleaned = self._value(value)
                if cleaned is not None:
                    out.set(name, cleaned)
        if tag == "image" and "href" not in out.attrib:
            return None  # внешняя или битая картинка — пропускаем

        if tag in ("text", "tspan"):
            family = (node.get("font-family") or "").strip().strip("'\"")
            if family:
                self.fonts.add(family)
        if tag == "text":
            out.set(f"{{{XML_NS}}}space", "preserve")
        if tag in ("text", "tspan"):
            # libcdr переносит строку перед текстом ради красоты разметки; с
            # сохранением пробелов этот перенос превратился бы в лишний пробел
            out.text = (node.text or "").lstrip("\n").rstrip("\n") or None
        inside = inside_defs or tag in NO_OBJECTS_INSIDE
        if tag in DRAWABLE and not inside:
            self.objects += 1
            if self.objects > MAX_OBJECTS:
                raise SceneError(f"В макете больше {MAX_OBJECTS} объектов — для просмотра в браузере это слишком много")
            out.set("data-o", str(self.objects))
            out.set("data-kind", tag)
            self.counts[tag] = self.counts.get(tag, 0) + 1

        for child in node:
            if tag == "text" and _local(child.tag) != "tspan":
                continue
            cleaned_child = self.clean(child, inside)
            if cleaned_child is not None:
                if tag in ("text", "tspan"):
                    cleaned_child.tail = (child.tail or "").strip("\n") or None
                out.append(cleaned_child)
        return out


def _svg_roots(raw: bytes) -> list[ET.Element]:
    try:
        root = ET.fromstring(raw)
    except ET.ParseError as exc:
        raise SceneError(f"Разборщик вернул повреждённую разметку: {exc}") from None
    if _local(root.tag) == "svg":
        return [root]
    return [el for el in root.iter() if _local(el.tag) == "svg"]


def build_scene(raw: bytes, tool: str) -> dict:
    """Сырой ответ разборщика → страницы с чистым SVG, счётчики, шрифты."""
    if len(raw) > MAX_SVG_BYTES:
        raise SceneError("Макет слишком тяжёлый для просмотра в браузере — откройте файл в CorelDRAW")
    ET.register_namespace("", SVG_NS)
    pages: list[dict] = []
    counts: dict[str, int] = {}
    fonts: set[str] = set()
    for index, root in enumerate(_svg_roots(raw), start=1):
        cleaner = _Cleaner(index)
        clean = cleaner.clean(root)
        if clean is None:
            continue
        width = _inches(root.get("width"))
        height = _inches(root.get("height"))
        box = [float(v) for v in re.split(r"[\s,]+", (root.get("viewBox") or "").strip()) if v] or []
        if len(box) != 4:
            if not (width and height):
                continue
            box = [0.0, 0.0, width, height]
        width, height = width or box[2], height or box[3]
        clean.set("viewBox", " ".join(f"{v:g}" for v in box))
        for attr in ("width", "height"):
            clean.attrib.pop(attr, None)
        pages.append({
            "index": index,
            "width_mm": round(width * PT_TO_MM, 2),
            "height_mm": round(height * PT_TO_MM, 2),
            "view_box": box,
            # сколько миллиметров в единице координат страницы
            "mm_per_unit": round((width / box[2]) * PT_TO_MM, 6) if box[2] else PT_TO_MM,
            "objects": cleaner.objects,
            "svg": ET.tostring(clean, encoding="unicode"),
        })
        for kind, amount in cleaner.counts.items():
            counts[kind] = counts.get(kind, 0) + amount
        fonts |= cleaner.fonts
    if not pages:
        raise SceneError("В файле не нашлось ни одной страницы с содержимым")

    warnings: list[str] = []
    if counts.get("text"):
        warnings.append(
            "В макете есть текст, не переведённый в кривые: шрифт подставляет браузер, переносы и "
            "интервалы могут отличаться от оригинала. Размеры текстовых блоков — приблизительные."
        )
    if counts.get("image"):
        warnings.append(
            "Размер и положение растровых вставок разборщик иногда определяет неверно (особенно внутри "
            "PowerClip) — разрешение растра проверяйте по эскизу и в самом CorelDRAW."
        )
    warnings.append("Эффекты CorelDRAW (тени, линзы, PowerClip, размерные линии) могут не отображаться — сверяйтесь с эскизом.")
    return {
        "tool": tool,
        "pages": pages,
        "stats": {
            "objects": sum(p["objects"] for p in pages),
            "curves": sum(counts.get(k, 0) for k in ("path", "rect", "circle", "ellipse", "line", "polyline", "polygon")),
            "texts": counts.get("text", 0),
            "images": counts.get("image", 0),
        },
        "fonts": sorted(fonts),
        "warnings": warnings,
    }


# ---------------------------------------------------------------- сцена с кэшем
def _stamp(path: Path) -> str:
    stat = path.stat()
    return f"3:{stat.st_size}:{int(stat.st_mtime)}"   # первая цифра — версия формата кэша


def scene(path: Path, cache: Path | None = None) -> dict:
    """Сцена макета. Разбор долгий, поэтому результат кладём рядом с эскизами
    и пересчитываем, только когда исходник заменили."""
    stamp = _stamp(path)
    if cache is not None and cache.exists():
        try:
            saved = json.loads(gzip.decompress(cache.read_bytes()).decode("utf-8"))
            if saved.get("stamp") == stamp:
                return saved["scene"]
        except (OSError, ValueError, KeyError, EOFError):
            pass
    raw, tool = convert_to_svg(path)
    result = build_scene(raw, tool)
    result["version"] = version(path)
    if cache is not None:
        try:
            cache.parent.mkdir(parents=True, exist_ok=True)
            payload = json.dumps({"stamp": stamp, "scene": result}, ensure_ascii=False).encode("utf-8")
            cache.write_bytes(gzip.compress(payload, compresslevel=5))
        except OSError:
            pass  # кэш не критичен
    return result


def standalone_svg(page: dict) -> bytes:
    """Страница сцены как самостоятельный SVG-файл с размерами в миллиметрах —
    так CorelDRAW при импорте ставит макет в натуральную величину."""
    root = ET.fromstring(page["svg"])
    root.set("width", f"{page['width_mm']}mm")
    root.set("height", f"{page['height_mm']}mm")
    root.set("version", "1.1")
    for el in root.iter():
        el.attrib.pop("data-o", None)
        el.attrib.pop("data-kind", None)
    ET.register_namespace("", SVG_NS)
    return b'<?xml version="1.0" encoding="UTF-8"?>\n' + ET.tostring(root, encoding="utf-8")
