# Инструменты 16.1 и 16.5 — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** В разделе «Инструменты» CRM — просмотр любого .cdr без заказа (16.1) и
раскладка PDF-макета на печатный лист с метками реза, с сохранением CMYK (16.5).

**Architecture:** Бэкенд (FastAPI) принимает файл во временную папку, работает с
ним и удаляет её в `finally` — ничего не хранится. Просмотр переиспользует разбор
libcdr (`services/cdr_scene.py`) и холст `DesignViewer`. Раскладка — чистый
движок `services/impose.py` (гильотинные раскладки, метки) плюс сборка PDF
`services/impose_pdf.py` на pypdf: страница-источник вставляется векторно как
Form XObject, содержимое не перекодируется — CMYK и плашки остаются как в файле.
Фронтенд показывает страницу PDF через pdf.js (отдельный кусок сборки), даёт
выбрать обрезной формат и строит превью листа по ответу движка.

**Tech Stack:** Python 3.10+ / FastAPI / pypdf 6; React 19 + TypeScript + Vite 6 /
@tanstack/react-query / pdfjs-dist 6.

**Spec:** `poster-ocr/TODO.md`, раздел 16 (общее, 16.1, 16.5) + решения
владельца от 24.09.2026 (ниже, «Global Constraints»).

## Global Constraints

- Печать только в CMYK: файл для печати собирается ТОЛЬКО из PDF-входа; содержимое страницы вставляется как есть (Form XObject), без растеризации и без пересчёта цвета.
- .cdr — только просмотр (16.1). Раскладка .cdr не принимает. Файл раскладки из .cdr не делаем.
- Выход раскладки — только PDF. SVG не делаем: в SVG нет CMYK, файл был бы непригоден для печати.
- Загруженные файлы не хранятся: временная папка `tempfile.TemporaryDirectory(prefix="poster-tool-")`, удаляется и после ответа, и после ошибки. В журнал — кто, инструмент, размер; без имени файла и содержимого.
- Предел файла инструментов — 100 МБ (`MAX_TOOL_BYTES = 100 * 1024 * 1024`).
- Права: `tools.viewer` и `tools.impose`, обе `"default": True` (решение владельца: доступ у всех сотрудников).
- Python 3.10 совместимость (ruff target py310, mypy 3.10); ruff/mypy — ноль замечаний.
- Зависимости: `pypdf>=6,<7` (requirements.txt), `pdfjs-dist@^6` (web/package.json). Прочего не добавлять.
- pdf.js грузится только на странице раскладки (`React.lazy`), основная сборка CRM не растёт.
- Тексты интерфейса и комментарии — по-русски, в стиле кода вокруг.
- Проверки бэка — из `poster-ocr/`: `PYTHONIOENCODING=utf-8 .venv/Scripts/python -m pytest -q`, `.venv/Scripts/python -m ruff check app scripts tests`, `.venv/Scripts/python -m mypy app`. Фронт — `cd web && npx tsc -b --noEmit && npm run build`.
- Единицы: движок и API раскладки — миллиметры, начало — левый верхний угол листа; координаты внутри PDF — пункты (1 мм = 72/25.4 pt), начало — левый нижний угол, как в самом PDF.

## Review Focus

1. **PDF с `/Rotate`** (макет сохранён «лёжа») — человек ждёт, что копии на листе стоят прямо, как он видел страницу на экране. Тест: `test_страница_с_rotate_ставится_прямо` (Task 5).
2. **PDF без TrimBox и без вылетов** — ждёт, что раскладка всё равно сделается по размеру страницы, а интерфейс предупредит «вылетов нет». Тест: `test_без_trimbox_формат_по_странице` (Task 5), предупреждение — шаг проверки в браузере (Task 7).
3. **Выбранный формат выходит за страницу / нулевой** — ждёт понятную ошибку, а не пустой лист. Тест: `test_формат_за_пределами_страницы` (Task 5).
4. **Защищённый паролем или битый PDF, .cdr вместо PDF** — ждёт понятную ошибку, временная папка при этом удалена. Тесты: `test_не_pdf_и_зашифрованный` (Task 5), `test_раскладка_pdf_ошибка_и_папка_удалена` (Task 6).
5. **Изделие не влезает на лист** (A3 на A4, огромные поля) — ждёт «не помещается», а не 500. Тест: `test_не_помещается` (Task 4), `test_раскладка_схема_ошибка_параметров` (Task 6).

---

## Карта файлов

Бэкенд (`poster-ocr/`):
- `app/core/permissions.py` — +2 права (группа «Инструменты»).
- `app/core/deploy.py` — `UPLOAD_PATH` пропускает загрузки инструментов мимо лимита 2 МБ.
- `app/services/tool_files.py` — НОВЫЙ: приём загрузки во временную папку с пределом и очередью.
- `app/services/impose.py` — НОВЫЙ: движок раскладки (чистые функции).
- `app/services/impose_pdf.py` — НОВЫЙ: сведения о PDF и сборка листа.
- `app/api/v1/tools.py` — НОВЫЙ: ручки `/api/tools/...`.
- `app/api/v1/__init__.py` — подключить роутер.
- `requirements.txt` — `pypdf`.
- `tests/api_helpers.py` — отправка multipart.
- `tests/pdf_helpers.py` — НОВЫЙ: сборка PDF для тестов.
- `tests/test_impose.py`, `tests/test_impose_pdf.py`, `tests/test_tools_api.py` — НОВЫЕ; `tests/test_deploy.py` — +проверка лимита.

Фронтенд (`poster-ocr/web/src/`):
- `types/api.ts` — два ключа в `Permission`.
- `api/client.ts` — `requestFormBlob`.
- `api/tools.ts` — НОВЫЙ: запросы инструментов.
- `features/design/DesignViewer.tsx` — источник сцены: заказ или файл.
- `features/design/standaloneSvg.ts` — НОВЫЙ: SVG страницы в натуральную величину в браузере.
- `features/design/DesignBlock.tsx` — новый проп `source`.
- `features/tools/tools.ts` — НОВЫЙ: список утилит (адрес, название, право).
- `features/tools/ToolsPage.tsx` — плитки.
- `features/tools/FileDrop.tsx` — НОВЫЙ: выбор/перетаскивание файла.
- `features/tools/ViewerTool.tsx` — НОВЫЙ: 16.1.
- `features/tools/impose/pdf.ts`, `PagePicker.tsx`, `SheetPreview.tsx`, `ImposePage.tsx` — НОВЫЕ: 16.5.
- `app/Shell.tsx` — маршруты и заголовки вкладок.
- `static/css/app.css` — стили плиток, просмотра файла и раскладки.

Документы: `TODO.md` (раздел 16), `API.md` (новые ручки).

---

### Task 1: Права, лимит загрузки, multipart в тестовом клиенте

**Files:**
- Modify: `poster-ocr/app/core/permissions.py` (перед блоком «администрирование»)
- Modify: `poster-ocr/app/core/deploy.py:32`
- Modify: `poster-ocr/web/src/types/api.ts:14-37`
- Modify: `poster-ocr/tests/api_helpers.py` (`AsgiClient.request`, `post`)
- Create: `poster-ocr/tests/test_tools_api.py`
- Modify: `poster-ocr/tests/test_deploy.py` (рядом со строкой 94)

**Interfaces:**
- Produces: права `"tools.viewer"`, `"tools.impose"`; `AsgiClient.post(path, headers=None, json=None, files=None, data=None)` — `files: dict[str, tuple[str, bytes, str]]` (имя, байты, тип), `data: dict[str, str]` — поля формы; `multipart(data, files) -> tuple[bytes, str]` в `tests/api_helpers.py`.

- [ ] **Step 1: Тесты**

`tests/test_tools_api.py`:

```python
"""Инструменты: права, приём файлов, ручки /api/tools.

Файлы инструментов не хранятся — это проверяется отдельно для каждой ручки:
временная папка удалена и после ответа, и после ошибки.
"""

from __future__ import annotations

from api_helpers import staff

from app.core.permissions import PERMISSIONS_BY_KEY, default_permissions


def test_права_инструментов_есть_и_включены_новым_профилям():
    for key in ("tools.viewer", "tools.impose"):
        assert key in PERMISSIONS_BY_KEY
        assert PERMISSIONS_BY_KEY[key]["group"] == "Инструменты"
        assert key in default_permissions()


def test_multipart_доходит_до_приложения(db, client):
    # ручки ещё нет — важно, что запрос с файлом собран и разобран: 404, а не 400/422
    _, key = staff(db, "Приёмщик", ["tools.viewer"])
    reply = client.post(
        "/api/tools/nope", headers={"X-API-Key": key},
        files={"file": ("a.cdr", b"123", "application/octet-stream")},
    )
    assert reply.status_code == 404
```

В `tests/test_deploy.py` после строки с `/api/orders/17/design`:

```python
    # загрузки инструментов идут мимо общего лимита — у них свой, 100 МБ
    for path in ("/api/tools/design-scene", "/api/tools/impose/info", "/api/tools/impose/pdf"):
        assert not deploy.body_too_large(path, str(90 * 1024 * 1024))
    assert deploy.body_too_large("/api/tools/impose/layout", str(deploy.MAX_BODY_BYTES + 1))
```

- [ ] **Step 2: Прогон — падает**

Run: `cd poster-ocr && PYTHONIOENCODING=utf-8 .venv/Scripts/python -m pytest -q tests/test_tools_api.py tests/test_deploy.py`
Expected: FAIL — нет прав `tools.*`, `post()` не знает `files`, лимит режет `/api/tools/...`.

- [ ] **Step 3: Права**

В `app/core/permissions.py` перед комментарием `# ---------------- администрирование`:

```python
    # ---------------- инструменты
    {
        "key": "tools.viewer",
        "title": "Просмотр макета без заказа",
        "hint": "«Инструменты» → открыть любой .cdr, посмотреть размеры и шрифты. "
                "Файл на сервере не сохраняется.",
        "group": "Инструменты",
        "default": True,
    },
    {
        "key": "tools.impose",
        "title": "Раскладка под печать",
        "hint": "«Инструменты» → разложить PDF-макет на лист SRA3/A3/A4 с метками реза. "
                "Файл на сервере не сохраняется.",
        "group": "Инструменты",
        "default": True,
    },
```

В `web/src/types/api.ts` в `Permission` перед `| 'staff.manage';`:

```ts
  | 'tools.viewer'
  | 'tools.impose'
```

- [ ] **Step 4: Лимит тела**

`app/core/deploy.py:32`:

```python
# загрузки, которые режутся своим лимитом в своей ручке: макет заказа и файлы инструментов
UPLOAD_PATH = re.compile(r"^/api/(orders/\d+/design|tools/(design-scene|impose/(info|pdf)))$")
```

- [ ] **Step 5: multipart в тестовом клиенте**

В `tests/api_helpers.py` перед `class AsgiClient`:

```python
def multipart(data: dict[str, str] | None, files: dict[str, tuple[str, bytes, str]] | None) -> tuple[bytes, str]:
    """Тело multipart/form-data — как его шлёт браузер из <input type=file>."""
    boundary = "poster-test-boundary"
    parts: list[bytes] = []
    for name, value in (data or {}).items():
        parts.append(
            f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n'.encode()
            + value.encode() + b"\r\n"
        )
    for name, (filename, payload, ctype) in (files or {}).items():
        parts.append(
            f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"; filename="{filename}"\r\n'
            f"Content-Type: {ctype}\r\n\r\n".encode()
            + payload + b"\r\n"
        )
    parts.append(f"--{boundary}--\r\n".encode())
    return b"".join(parts), f"multipart/form-data; boundary={boundary}"
```

`AsgiClient.request` — новая сигнатура и сборка тела/заголовков:

```python
    def request(self, method: str, path: str, headers: dict[str, str] | None = None, json=None,
                content: bytes | None = None, content_type: str | None = None) -> Reply:
        path, _, query = path.partition("?")
        body = content if content is not None else (b"" if json is None else jsonlib.dumps(json).encode())
        raw_headers = [(b"host", b"testserver")]
        if json is not None:
            raw_headers.append((b"content-type", b"application/json"))
        if content_type is not None:
            raw_headers.append((b"content-type", content_type.encode()))
        if body:
            raw_headers.append((b"content-length", str(len(body)).encode()))
```

(остальное тело метода — без изменений). `post`:

```python
    def post(self, path: str, headers: dict[str, str] | None = None, json=None,
             files: dict[str, tuple[str, bytes, str]] | None = None, data: dict[str, str] | None = None) -> Reply:
        if files is not None or data is not None:
            body, ctype = multipart(data, files)
            return self.request("POST", path, headers, content=body, content_type=ctype)
        return self.request("POST", path, headers, json)
```

- [ ] **Step 6: Прогон — проходит; весь набор — без регрессий**

Run: `PYTHONIOENCODING=utf-8 .venv/Scripts/python -m pytest -q`
Expected: всё зелёное (content-length теперь уходит и у JSON-запросов — проверить, что старые тесты не заметили).

- [ ] **Step 7: ruff + mypy, коммит**

```bash
.venv/Scripts/python -m ruff check app scripts tests && .venv/Scripts/python -m mypy app
git add app/core/permissions.py app/core/deploy.py web/src/types/api.ts tests/api_helpers.py tests/test_tools_api.py tests/test_deploy.py
git commit -m "Инструменты: права, лимит загрузки, multipart в тестах"
```

---

### Task 2: 16.1 — ручка просмотра .cdr без хранения

**Files:**
- Create: `poster-ocr/app/services/tool_files.py`
- Create: `poster-ocr/app/api/v1/tools.py`
- Modify: `poster-ocr/app/api/v1/__init__.py`
- Test: `poster-ocr/tests/test_tools_api.py`

**Interfaces:**
- Consumes: `cdr_scene.scene(path, cache=None) -> dict`, `cdr_scene.version(path)`, `cdr_scene.tools()`, `cdr_scene.SceneError`, `cdr.extract_preview(path) -> (bytes|None, str)`.
- Produces: `POST /api/tools/design-scene` (multipart `file`) → тот же JSON, что `GET /api/orders/{id}/design/scene`, плюс `"thumbnail": "data:image/png;base64,…" | null`. `tool_files.save_upload(file, folder, suffixes) -> Path` (async), `tool_files.slot()` (контекст-менеджер очереди), `tool_files.ToolFileError`, `tool_files.MAX_TOOL_BYTES`, `tool_files.temp_dir()` (контекст-менеджер `TemporaryDirectory`).

- [ ] **Step 1: Тесты** (дописать в `tests/test_tools_api.py`)

```python
import os
import tempfile

import pytest

from app.services import cdr, cdr_scene, tool_files

SCENE = {"tool": "test", "pages": [{"index": 1, "width_mm": 90, "height_mm": 50, "view_box": [0, 0, 255, 142],
         "mm_per_unit": 0.35, "objects": 1, "svg": "<svg/>"}], "stats": {"objects": 1, "curves": 1, "texts": 0,
         "images": 0}, "fonts": [], "warnings": [], "version": None}


@pytest.fixture
def tmp_root(tmp_path, monkeypatch):
    """Временные папки инструментов — внутри tmp_path, чтобы видеть, что их удалили."""
    monkeypatch.setattr(tempfile, "tempdir", str(tmp_path))
    return tmp_path


def _left(root) -> list[str]:
    return [n for n in os.listdir(root) if n.startswith("poster-tool-")]


def test_просмотр_cdr_без_хранения(db, client, tmp_root, monkeypatch):
    seen = {}

    def fake_scene(path, cache=None):
        seen["path"], seen["cache"] = path, cache
        assert path.exists()
        return dict(SCENE)

    monkeypatch.setattr(cdr_scene, "scene", fake_scene)
    monkeypatch.setattr(cdr, "extract_preview", lambda path: (b"\x89PNG\r\n\x1a\nxx", "zip"))
    _, key = staff(db, "Приёмщик", ["tools.viewer"])
    reply = client.post("/api/tools/design-scene", headers={"X-API-Key": key},
                        files={"file": ("Макет клиента.cdr", b"RIFF....", "application/octet-stream")})
    assert reply.status_code == 200, reply.text
    data = reply.json()
    assert data["available"] is True
    assert data["pages"][0]["width_mm"] == 90
    assert data["thumbnail"].startswith("data:image/png;base64,")
    assert seen["cache"] is None                    # кэш сцен не пишется
    assert not seen["path"].exists()                # файл удалён
    assert _left(tmp_root) == []                    # и папка тоже


def test_просмотр_ошибка_разбора_папка_удалена(db, client, tmp_root, monkeypatch):
    def broken(path, cache=None):
        raise cdr_scene.SceneError("libcdr не прочитал файл")

    monkeypatch.setattr(cdr_scene, "scene", broken)
    monkeypatch.setattr(cdr, "extract_preview", lambda path: (None, "нет эскиза"))
    _, key = staff(db, "Приёмщик", ["tools.viewer"])
    reply = client.post("/api/tools/design-scene", headers={"X-API-Key": key},
                        files={"file": ("a.cdr", b"xx", "application/octet-stream")})
    assert reply.status_code == 200
    assert reply.json()["available"] is False
    assert "libcdr" in reply.json()["reason"]
    assert _left(tmp_root) == []


def test_просмотр_только_cdr_и_в_пределах_размера(db, client, tmp_root, monkeypatch):
    _, key = staff(db, "Приёмщик", ["tools.viewer"])
    wrong = client.post("/api/tools/design-scene", headers={"X-API-Key": key},
                        files={"file": ("a.pdf", b"%PDF", "application/pdf")})
    assert wrong.status_code == 422
    assert ".cdr" in wrong.json()["detail"]
    monkeypatch.setattr(tool_files, "MAX_TOOL_BYTES", 10)
    big = client.post("/api/tools/design-scene", headers={"X-API-Key": key},
                      files={"file": ("a.cdr", b"x" * 11, "application/octet-stream")})
    assert big.status_code == 422
    assert "МБ" in big.json()["detail"]
    assert _left(tmp_root) == []


def test_просмотр_без_права_нельзя(db, client):
    _, key = staff(db, "Кассир", ["orders.view"])
    reply = client.post("/api/tools/design-scene", headers={"X-API-Key": key},
                        files={"file": ("a.cdr", b"xx", "application/octet-stream")})
    assert reply.status_code == 403
```

- [ ] **Step 2: Прогон — падает (404: ручки нет)**

Run: `PYTHONIOENCODING=utf-8 .venv/Scripts/python -m pytest -q tests/test_tools_api.py`

- [ ] **Step 3: `app/services/tool_files.py`**

```python
"""Файлы инструментов: приняли, поработали, удалили.

Утилиты раздела «Инструменты» не привязаны к заказу и ничего не хранят:
файл пишется во временную папку, ручка с ним работает, папка удаляется при
выходе из `with` — и после ответа, и после ошибки. В `designs/` и в кэш сцен
не попадает ничего.

Разбор и сборка тяжёлые (секунды процессора и сотни мегабайт памяти на
большом макете), поэтому одновременно работают не больше двух файлов;
остальные ждут очереди, а если ждать дольше минуты — получают понятный отказ.
"""

from __future__ import annotations

import tempfile
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from fastapi import UploadFile

from app.services import cdr

MAX_TOOL_BYTES = 100 * 1024 * 1024
WAIT_SECONDS = 60
_slots = threading.BoundedSemaphore(2)


class ToolFileError(ValueError):
    """Файл не принят: не тот тип, слишком большой, сервер занят."""


@contextmanager
def temp_dir() -> Iterator[Path]:
    with tempfile.TemporaryDirectory(prefix="poster-tool-") as name:
        yield Path(name)


@contextmanager
def slot() -> Iterator[None]:
    if not _slots.acquire(timeout=WAIT_SECONDS):
        raise ToolFileError("Сервер занят другими файлами — повторите через минуту")
    try:
        yield
    finally:
        _slots.release()


async def save_upload(file: UploadFile, folder: Path, suffixes: tuple[str, ...]) -> Path:
    """Пишет загрузку кусками на диск, пока не перешагнула предел.

    Имя берётся только ради расширения: сам файл ложится под нейтральным
    именем — так кириллица и пробелы в имени не доходят до внешних утилит."""
    suffix = Path(cdr.safe_filename(file.filename or "")).suffix.lower()
    if suffix not in suffixes:
        raise ToolFileError("Принимаются только файлы " + ", ".join(suffixes))
    target = folder / f"upload{suffix}"
    size = 0
    with open(target, "wb") as out:
        while chunk := await file.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_TOOL_BYTES:
                raise ToolFileError(f"Файл больше {MAX_TOOL_BYTES // 1024 // 1024} МБ")
            out.write(chunk)
    if size == 0:
        raise ToolFileError("Файл пустой")
    return target
```

Внимание: `MAX_TOOL_BYTES` читается из модуля при каждом вызове — тест подменяет его через `monkeypatch.setattr(tool_files, "MAX_TOOL_BYTES", 10)`, и сообщение тогда «Файл больше 0 МБ» (для теста важно только «МБ»).

- [ ] **Step 4: `app/api/v1/tools.py`**

```python
"""Инструменты: утилиты, не привязанные к заказу (раздел «Инструменты»).

Файлы сюда приходят на время запроса и не хранятся — см.
app/services/tool_files.py. План и границы — TODO.md, раздел 16.
"""

from __future__ import annotations

import base64

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from starlette.concurrency import run_in_threadpool

from app.core.logs import log as applog
from app.core.security import CurrentUser, require_perm
from app.services import cdr, cdr_scene, tool_files

router = APIRouter(prefix="/api/tools", tags=["tools"])


def _scene(path) -> dict:
    """Как GET /orders/{id}/design/scene, только без кэша: файл сейчас удалят."""
    base = {"available": False, "reason": "", "version": cdr_scene.version(path), "tools": cdr_scene.tools()}
    png, _note = cdr.extract_preview(path)
    base["thumbnail"] = "data:image/png;base64," + base64.b64encode(png).decode("ascii") if png else None
    try:
        scene = cdr_scene.scene(path, cache=None)
    except cdr_scene.SceneError as exc:
        return {**base, "reason": str(exc)}
    return {**base, **scene, "available": True}


@router.post("/design-scene")
async def design_scene(
    file: UploadFile = File(...),
    user: CurrentUser = Depends(require_perm("tools.viewer")),
) -> dict:
    """16.1: содержимое любого .cdr для просмотра. Файл не сохраняется."""
    try:
        with tool_files.temp_dir() as folder:
            path = await tool_files.save_upload(file, folder, (".cdr",))
            size = path.stat().st_size
            with tool_files.slot():
                result = await run_in_threadpool(_scene, path)
    except tool_files.ToolFileError as exc:
        raise HTTPException(422, str(exc)) from None
    applog.info("Инструменты: просмотр макета, %s КБ · %s", size // 1024, user.name)
    return result
```

В `app/api/v1/__init__.py` — импорт `tools` в список и `tools` в кортеж модулей (после `mail_accounts`).

- [ ] **Step 5: Прогон — проходит**

Run: `PYTHONIOENCODING=utf-8 .venv/Scripts/python -m pytest -q tests/test_tools_api.py`
Expected: PASS (6 тестов).

- [ ] **Step 6: ruff + mypy + весь набор, коммит**

```bash
.venv/Scripts/python -m ruff check app scripts tests && .venv/Scripts/python -m mypy app && PYTHONIOENCODING=utf-8 .venv/Scripts/python -m pytest -q
git add app/services/tool_files.py app/api/v1/tools.py app/api/v1/__init__.py tests/test_tools_api.py
git commit -m "Инструменты 16.1: просмотр .cdr без заказа, файл не хранится"
```

---

### Task 3: 16.1 — интерфейс: плитки, просмотр файла

**Files:**
- Create: `poster-ocr/web/src/api/tools.ts`
- Create: `poster-ocr/web/src/features/design/standaloneSvg.ts`
- Modify: `poster-ocr/web/src/features/design/DesignViewer.tsx:70-86, 350-375, 420-435, 450-460, 615-625`
- Modify: `poster-ocr/web/src/features/design/DesignBlock.tsx:280-285`
- Create: `poster-ocr/web/src/features/tools/tools.ts`, `FileDrop.tsx`, `ViewerTool.tsx`
- Modify: `poster-ocr/web/src/features/tools/ToolsPage.tsx`, `poster-ocr/web/src/app/Shell.tsx`
- Modify: `poster-ocr/static/css/app.css` (раздел «инструменты» — в конец файла)

**Interfaces:**
- Consumes: `POST /api/tools/design-scene` (Task 2), `DesignScene`, `DesignPage` из `api/designs.ts`.
- Produces: `loadToolScene(file: File): Promise<ToolScene>`; `DesignViewer` с пропом `source: DesignSource`; `TOOLS: ToolConfig[]` и `toolByPath(path)` из `features/tools/tools.ts`; `FileDrop` (`accept: string; hint: string; onFile(file: File)`).

- [ ] **Step 1: `api/tools.ts`**

```ts
/* Инструменты: файлы уходят на сервер на время запроса и там не хранятся. */

import type { DesignScene } from './designs';
import { request } from './client';

export interface ToolScene extends DesignScene {
  /** эскиз, сохранённый CorelDRAW, — data:-адрес PNG или null */
  thumbnail: string | null;
}

export function loadToolScene(file: File): Promise<ToolScene> {
  const form = new FormData();
  form.append('file', file);
  return request<ToolScene>('/tools/design-scene', { method: 'POST', body: form });
}
```

- [ ] **Step 2: `features/design/standaloneSvg.ts`** — та же операция, что `cdr_scene.standalone_svg` на сервере: для файла из «Инструментов» сервер файла уже не имеет.

```ts
/* Страница сцены как самостоятельный SVG в натуральную величину — CorelDRAW
   при импорте ставит его в мм. Копия app/services/cdr_scene.standalone_svg:
   макет из «Инструментов» на сервере не хранится, выгружать его нечем, а
   сцена со SVG уже в браузере. */

import type { DesignPage } from '@/api/designs';

export function standaloneSvg(page: DesignPage): Blob {
  const doc = new DOMParser().parseFromString(page.svg, 'image/svg+xml');
  const root = doc.documentElement;
  root.setAttribute('width', `${page.width_mm}mm`);
  root.setAttribute('height', `${page.height_mm}mm`);
  root.setAttribute('version', '1.1');
  for (const el of [root, ...Array.from(root.querySelectorAll('*'))]) {
    el.removeAttribute('data-o');
    el.removeAttribute('data-kind');
  }
  const xml = new XMLSerializer().serializeToString(root);
  return new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n${xml}`], { type: 'image/svg+xml' });
}
```

- [ ] **Step 3: `DesignViewer` — источник сцены**

Сигнатура и загрузка сцены (строки 70–86):

```tsx
/** Откуда сцена: макет заказа (хранится на сервере) или файл из «Инструментов»
 *  (разбирается на лету и нигде не остаётся). */
export type DesignSource = { kind: 'order'; orderId: number } | { kind: 'file'; file: File };

export function DesignViewer({
  source,
  title,
  thumbnail,
  onClose,
}: {
  source: DesignSource;
  title: string;
  thumbnail: string | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const scene = useQuery<DesignScene & { thumbnail?: string | null }>({
    queryKey:
      source.kind === 'order'
        ? ['design-scene', source.orderId]
        : ['tool-scene', source.file.name, source.file.size, source.file.lastModified],
    queryFn: () => (source.kind === 'order' ? fetchDesignScene(source.orderId) : loadToolScene(source.file)),
    staleTime: 5 * 60 * 1000,
    // файл второй раз на сервер не шлём: разбор долгий, а ответ тот же
    retry: source.kind === 'order' ? undefined : false,
  });
  const thumb = thumbnail ?? scene.data?.thumbnail ?? null;
```

Импорты: `import { fetchDesignExport, fetchDesignScene, type DesignPage, type DesignScene } from '@/api/designs';`, `import { loadToolScene } from '@/api/tools';`, `import { standaloneSvg } from './standaloneSvg';`. Все прежние использования `thumbnail` в разметке (строки ~458 и ~619–622) заменить на `thumb`.

`exportAs` (строки 352–375):

```tsx
  const exportAs = async (format: 'svg' | 'pdf') => {
    setExporting(format);
    try {
      const blob =
        source.kind === 'order'
          ? await fetchDesignExport(source.orderId, format, page?.index ?? 1)
          : page && format === 'svg'
            ? standaloneSvg(page)
            : null;
      if (!blob) {
        toast(
          format === 'pdf'
            ? 'PDF не получился: для него на сервере нужен Inkscape. SVG доступен и без него.'
            : 'Не удалось выгрузить макет',
        );
        return;
      }
      // …дальше без изменений: ссылка, download, revokeObjectURL
```

Кнопка PDF (строки ~428–433): для файла — недоступна, с объяснением:

```tsx
            disabled={source.kind === 'file' || !data?.available || !data?.tools.can_pdf || Boolean(exporting)}
            title={
              source.kind === 'file'
                ? 'PDF — только для макета заказа. Для печати выгрузите PDF из CorelDRAW'
                : data?.tools.can_pdf
                  ? 'PDF — для открытия в CorelDRAW X6'
                  : 'Для PDF на сервере нужен Inkscape'
            }
```

`DesignBlock.tsx:280-285`: `orderId={orderId}` → `source={{ kind: 'order', orderId }}`.

- [ ] **Step 4: `features/tools/tools.ts`**

```ts
/* Утилиты раздела «Инструменты»: адрес, название, право. По этому списку
   строятся плитки, маршруты и заголовок вкладки браузера. */

import type { Permission } from '@/types/api';

export interface ToolConfig {
  key: string;
  path: string;
  title: string;
  /** одна строка на плитке: что делает */
  hint: string;
  permission: Permission;
}

export const TOOLS: ToolConfig[] = [
  {
    key: 'viewer',
    path: '/tools/viewer',
    title: 'Просмотр макета',
    hint: 'Открыть любой .cdr: размеры объектов, шрифты, версия CorelDRAW. Файл не сохраняется.',
    permission: 'tools.viewer',
  },
  {
    key: 'impose',
    path: '/tools/impose',
    title: 'Раскладка под печать',
    hint: 'PDF-макет на лист SRA3, A3 или A4 с метками реза. Цвета CMYK — как в файле.',
    permission: 'tools.impose',
  },
];

export const toolByPath = (path: string): ToolConfig | undefined => TOOLS.find((t) => t.path === path);
```

- [ ] **Step 5: `ToolsPage.tsx`** — плитки вместо заглушки

```tsx
/* Раздел «Инструменты»: утилиты для цеха, не привязанные к заказу.
   Плитка показывается, если у профиля есть право на утилиту. План и
   границы — TODO.md, раздел 16. */

import { Link } from 'react-router-dom';

import { useAuth } from '@/app/AuthProvider';
import { Empty, PageHead } from '@/components/ui';

import { TOOLS } from './tools';

export function ToolsPage() {
  const { can } = useAuth();
  const tools = TOOLS.filter((tool) => can(tool.permission));
  return (
    <main className="page scroll-page">
      <div className="page-inner">
        <PageHead
          eyebrow="Цех"
          title="Инструменты"
          sub="Утилиты для работы с макетами. Файлы на сервере не сохраняются: открыли, поработали, ушли."
        />
        {tools.length === 0 ? (
          <Empty>Для вашего профиля утилит нет — права выдаёт администратор.</Empty>
        ) : (
          <div className="tool-grid">
            {tools.map((tool) => (
              <Link className="tool-tile" to={tool.path} key={tool.key}>
                <b>{tool.title}</b>
                <span>{tool.hint}</span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
```

- [ ] **Step 6: `FileDrop.tsx`**

```tsx
/* Поле «перетащите файл или выберите» — общее для утилит. Проверяет только
   расширение: всё остальное проверит сервер и скажет понятно. */

import { useRef, useState } from 'react';

export function FileDrop({ accept, hint, onFile }: { accept: string; hint: string; onFile: (file: File) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [wrong, setWrong] = useState('');

  const take = (file: File | undefined) => {
    if (!file) return;
    const ok = accept.split(',').some((ext) => file.name.toLowerCase().endsWith(ext.trim()));
    if (!ok) {
      setWrong(`Нужен файл ${accept}`);
      return;
    }
    setWrong('');
    onFile(file);
  };

  return (
    <div
      className={over ? 'file-drop over' : 'file-drop'}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        take(e.dataTransfer.files[0]);
      }}
    >
      <p>{hint}</p>
      <button className="btn btn-ghost" type="button" onClick={() => input.current?.click()}>
        Выбрать файл
      </button>
      <input
        ref={input}
        type="file"
        accept={accept}
        hidden
        onChange={(e) => {
          take(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      {wrong && <div className="file-drop-err">{wrong}</div>}
    </div>
  );
}
```

- [ ] **Step 7: `ViewerTool.tsx`**

```tsx
/* 16.1: просмотр любого .cdr без заказа. Файл уходит на сервер только на
   время разбора; окно просмотра — то же, что у макета заказа. */

import { useState } from 'react';

import { PageHead } from '@/components/ui';
import { DesignViewer } from '@/features/design/DesignViewer';

import { FileDrop } from './FileDrop';

export function ViewerTool() {
  const [file, setFile] = useState<File | null>(null);
  return (
    <main className="page scroll-page">
      <div className="page-inner">
        <PageHead
          eyebrow="Инструменты"
          title="Просмотр макета"
          sub="Содержимое .cdr любой версии: размеры объектов в мм, шрифты, растры. На сервере файл не остаётся."
        />
        <FileDrop accept=".cdr" hint="Перетащите сюда файл .cdr или выберите его" onFile={setFile} />
      </div>
      {file && (
        <DesignViewer
          source={{ kind: 'file', file }}
          title={file.name}
          thumbnail={null}
          onClose={() => setFile(null)}
        />
      )}
    </main>
  );
}
```

- [ ] **Step 8: Маршруты и заголовки** — `app/Shell.tsx`

Импорты: `import { lazy, Suspense } from 'react';` (добавить к существующему импорту из react), `import { toolByPath } from '@/features/tools/tools';`, `import { ViewerTool } from '@/features/tools/ViewerTool';`, и

```tsx
// pdf.js тяжёлый — грузится, только когда открыли раскладку
const ImposePage = lazy(() => import('@/features/tools/impose/ImposePage').then((m) => ({ default: m.ImposePage })));
```

Заголовок вкладки в `useEffect` по `location.pathname`:

```tsx
    const view = viewByPath(location.pathname);
    const tool = toolByPath(location.pathname);
    document.title = view
      ? view.title
      : tool
        ? `ПОСТЕР · ${tool.title}`
        : location.pathname === '/profile'
          ? 'ПОСТЕР · Профиль'
          : 'ПОСТЕР · Заказы';
```

Маршруты после `/tools`:

```tsx
        <Route
          path="/tools/viewer"
          element={
            <Guarded permission="tools.viewer">
              <ViewerTool />
            </Guarded>
          }
        />
        <Route
          path="/tools/impose"
          element={
            <Guarded permission="tools.impose">
              <Suspense fallback={<main className="page"><div className="mx-empty">Загружаю…</div></main>}>
                <ImposePage />
              </Suspense>
            </Guarded>
          }
        />
```

До Task 7 создать `features/tools/impose/ImposePage.tsx`-заглушку, чтобы сборка проходила:

```tsx
export function ImposePage() {
  return <main className="page scroll-page"><div className="page-inner">Раскладка — в работе.</div></main>;
}
```

- [ ] **Step 9: Стили** — в конец `static/css/app.css` (файл с CRLF — править Edit-ом)

```css
/* ---------- инструменты ---------- */
.tool-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 14px;
}
.tool-tile {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 18px 20px;
  border: 1px solid var(--line-strong);
  border-radius: 14px;
  background: var(--panel);
  color: var(--text);
  transition: border-color 0.16s, transform 0.16s var(--ease);
}
.tool-tile b {
  font-family: var(--font-ui);
  font-size: 17px;
}
.tool-tile span {
  color: var(--muted);
  font-size: 13.5px;
  line-height: 1.5;
}
.tool-tile:hover,
.tool-tile:focus-visible {
  border-color: var(--green);
  transform: translateY(-2px);
  outline: none;
}
.file-drop {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  padding: 40px 20px;
  border: 1.5px dashed var(--line-strong);
  border-radius: 14px;
  color: var(--muted);
  text-align: center;
}
.file-drop.over {
  border-color: var(--green);
  background: rgba(60, 199, 7, 0.06);
}
.file-drop-err {
  color: var(--red);
  font-size: 13px;
}
```

- [ ] **Step 10: Проверка типов и сборки**

Run: `cd poster-ocr/web && npx tsc -b --noEmit && npm run build`
Expected: без ошибок.

- [ ] **Step 11: Проверка в браузере (временная база, `poster-api-test` + `poster-crm-web`)**

1. «Инструменты» → две плитки; профиль «Без прав» (права пустые) — «утилит нет».
2. «Просмотр макета» → файл `poster-ocr/designs/ЗК-2026-000014.cdr` (есть локально; на сервер разработки его не отправлять — только локальный uvicorn): окно просмотра, страницы, размеры по щелчку, эскиз справа.
3. Независимая сверка выгрузки SVG: тот же файл загрузить как макет заказа во временной базе, скачать SVG кнопкой у заказа (серверный `standalone_svg`) и кнопкой в «Инструментах» (браузерный `standaloneSvg`); сравнить: `width`/`height` в мм совпадают, нет атрибутов `data-o`/`data-kind`, число элементов одинаковое (скрипт в Node: посчитать `<path`, `<text`, `<image` в обоих файлах).
4. После закрытия окна — во временной папке системы нет `poster-tool-*` (`ls $TEMP | grep poster-tool`).
5. Макет заказа (DesignBlock) открывается как раньше.

- [ ] **Step 12: Коммит**

```bash
git add web/src static/css/app.css static/dist
git commit -m "Инструменты 16.1: плитки и просмотр любого .cdr"
```

---

### Task 4: 16.5 — движок раскладки

**Files:**
- Create: `poster-ocr/app/services/impose.py`
- Test: `poster-ocr/tests/test_impose.py`

**Interfaces:**
- Produces: `Job(item_w, item_h, bleed=2.0, sheet_w=320.0, sheet_h=450.0, margin=5.0, gap=0.0, rotate=True, marks=True, mark_offset=2.5, mark_length=3.0)`; `Placement(x, y, w, h, rotated, clip)` — `clip=(слева, сверху, справа, снизу)`; `Cut(axis, pos, start, end)`; `Mark(x1, y1, x2, y2)`; `Layout(job, placements, cuts, marks)` + `.count`; `impose(job) -> Layout`; `ImposeError(ValueError)`. Всё в мм, начало — левый верхний угол листа.

- [ ] **Step 1: Тесты `tests/test_impose.py`**

```python
"""Движок раскладки: известные ответы и свойства на переборе.

Ошибка здесь не падает — тихо портит тираж: копия залезла на соседнюю или
под захват машины, рез без метки. Поэтому кроме примеров из жизни — перебор
сотен сочетаний с проверкой свойств, и счётчик: сколько раскладок дошло до
проверки (иначе «0 нарушений» мог бы значить «ничего не проверили»).
"""

from __future__ import annotations

import itertools

import pytest

from app.services.impose import ImposeError, Job, impose

SRA3, A3, A4 = (320, 450), (297, 420), (210, 297)


@pytest.mark.parametrize(
    ("w", "h", "sheet", "gap", "marks", "count"),
    [
        (90, 50, SRA3, 0, True, 24),    # визитки: 3×8, классика
        (90, 50, SRA3, 4, True, 24),    # с зазором — столько же, резов больше
        (90, 50, A3, 0, False, 24),
        (90, 50, A4, 0, True, 10),
        (99, 210, SRA3, 0, True, 6),    # еврофлаер
        (148, 210, SRA3, 0, True, 4),   # A5
        (148, 210, A3, 0, True, 2),
        (105, 148, SRA3, 0, True, 8),   # A6
    ],
)
def test_известные_раскладки(w, h, sheet, gap, marks, count):
    layout = impose(Job(w, h, sheet_w=sheet[0], sheet_h=sheet[1], gap=gap, marks=marks))
    assert layout.count == count


def test_без_меток_поворот_дает_больше():
    # визитки на SRA3 без меток: две полосы — основная сетка плюс повёрнутые
    layout = impose(Job(90, 50, marks=False))
    assert layout.count == 27
    assert any(p.rotated for p in layout.placements)


def test_поворот_запрещен():
    layout = impose(Job(90, 50, marks=False, rotate=False))
    assert not any(p.rotated for p in layout.placements)
    assert layout.count == 24


def test_раскладка_по_центру():
    layout = impose(Job(90, 50))
    left = min(p.x for p in layout.placements)
    right = max(p.x + p.w for p in layout.placements)
    top = min(p.y for p in layout.placements)
    bottom = max(p.y + p.h for p in layout.placements)
    assert left == pytest.approx(320 - right)
    assert top == pytest.approx(450 - bottom)


def test_встык_один_рез_между_соседями_вылеты_только_снаружи():
    layout = impose(Job(90, 50, gap=0))
    xs = sorted({c.pos for c in layout.cuts if c.axis == "x"})
    assert len(xs) == 4  # 3 колонки встык: 4 вертикальных реза
    left = min(p.x for p in layout.placements)
    for p in layout.placements:
        # крайние слева — с полным вылетом, у остальных сосед вплотную: вылета нет
        assert p.clip[0] == (2 if p.x == left else 0)


def test_зазор_полный_вылет_и_два_реза():
    layout = impose(Job(90, 50, gap=4))
    assert all(p.clip == (2, 2, 2, 2) for p in layout.placements)
    xs = sorted({c.pos for c in layout.cuts if c.axis == "x"})
    assert len(xs) == 6


def test_не_помещается():
    with pytest.raises(ImposeError, match="не помещается"):
        impose(Job(297, 420, sheet_w=210, sheet_h=297))


@pytest.mark.parametrize(
    ("job", "text"),
    [
        (Job(0, 50), "больше нуля"),
        (Job(90, 50, bleed=-1), "Отрицательный"),
        (Job(90, 50, bleed=3, mark_offset=2), "вылетах"),
    ],
)
def test_неверные_параметры(job, text):
    with pytest.raises(ImposeError, match=text):
        impose(job)


def _box(p):
    return p.x - p.clip[0], p.y - p.clip[1], p.x + p.w + p.clip[2], p.y + p.h + p.clip[3]


def _cross(a, b):
    return a[0] < b[2] - 1e-6 and b[0] < a[2] - 1e-6 and a[1] < b[3] - 1e-6 and b[1] < a[3] - 1e-6


def test_свойства_на_переборе():
    checked = 0
    for w, h, (sw, sh), gap, marks in itertools.product(
        (30, 50, 55, 90, 99, 105, 148, 210), (20, 50, 54, 85, 148, 297),
        (SRA3, A3, A4), (0, 1, 4, 6), (True, False),
    ):
        job = Job(w, h, sheet_w=sw, sheet_h=sh, gap=gap, marks=marks)
        try:
            layout = impose(job)
        except ImposeError:
            continue
        checked += 1
        boxes = [_box(p) for p in layout.placements]
        for b in boxes:  # копия с вылетами — в печатном поле
            assert b[0] >= job.margin - 1e-6 and b[1] >= job.margin - 1e-6
            assert b[2] <= sw - job.margin + 1e-6 and b[3] <= sh - job.margin + 1e-6
        for a, b in itertools.combinations(boxes, 2):  # копии не залезают друг на друга
            assert not _cross(a, b)
        for m in layout.marks:  # метки — в печатном поле и не на копиях
            for v, lim in ((m.x1, sw), (m.x2, sw), (m.y1, sh), (m.y2, sh)):
                assert job.margin - 1e-6 <= v <= lim - job.margin + 1e-6
            seg = (min(m.x1, m.x2), min(m.y1, m.y2), max(m.x1, m.x2), max(m.y1, m.y2))
            for b in boxes:
                assert not (seg[0] < b[2] - 1e-6 and seg[2] > b[0] + 1e-6 and seg[1] < b[3] - 1e-6 and seg[3] > b[1] + 1e-6)
        if marks:  # у каждого реза есть метка — иначе резчику не по чему резать
            for c in layout.cuts:
                assert any((m.x1 == m.x2 == c.pos) if c.axis == "x" else (m.y1 == m.y2 == c.pos) for m in layout.marks)
        assert layout.count <= (sw - 2 * job.margin) * (sh - 2 * job.margin) // (w * h)
    assert checked > 900  # перебор действительно дошёл до проверок
```

(Числа в `test_известные_раскладки` и `checked > 900` сверены прототипом движка 24.09.2026: 1088 раскладок, 0 нарушений; та же проверка на прототипе с ошибкой нашла 17 наложений.)

- [ ] **Step 2: Прогон — падает (нет модуля)**

Run: `PYTHONIOENCODING=utf-8 .venv/Scripts/python -m pytest -q tests/test_impose.py`

- [ ] **Step 3: `app/services/impose.py`** — движок (прототип сверен тестами выше)

```python
"""Раскладка изделий на печатный лист под гильотинную резку.

Все размеры — в миллиметрах, начало координат — левый верхний угол листа.

Что считается
-------------
Изделие — обрезной формат (w×h) плюс вылеты. Лист — размер и непечатное
поле по краям (захват машины). Между изделиями — зазор: 0 значит «рез
встык» (соседние копии делят линию реза, вылеты у них остаются только
снаружи блока), зазор ≥ 2 вылетов — у каждой копии вылет со всех сторон и
по два реза между соседями. Промежуточный зазор тоже допустим: вылет внутри
блока тогда урезается до половины зазора.

Метки реза стоят на полях снаружи раскладки, поэтому место под них
вычитается из печатного поля: от обрезного края до внешнего конца метки —
отступ плюс длина. Метка не должна попасть на вылет — отступ не меньше
вылета.

Какие раскладки перебираются
----------------------------
Только гильотинные: каждый рез проходит через весь лист или через весь
блок, иначе на ручном резаке не порезать. Кандидаты — сетка в одной
ориентации, сетка в другой (если поворот разрешён) и два блока: основная
сетка плюс полоса из повёрнутых изделий в остатке — сбоку или снизу. Из
кандидатов берётся тот, где больше изделий; при равенстве — где меньше
резов. Готовая раскладка ставится по центру листа.
"""

from __future__ import annotations

from dataclasses import dataclass, field

EPS = 1e-6

# копия-черновик: (x, y, w, h, повёрнута)
Item = tuple[float, float, float, float, bool]


class ImposeError(ValueError):
    """Параметры, при которых раскладка невозможна, — с понятной причиной."""


@dataclass(frozen=True)
class Job:
    item_w: float
    item_h: float
    bleed: float = 2.0
    sheet_w: float = 320.0
    sheet_h: float = 450.0
    margin: float = 5.0
    gap: float = 0.0
    rotate: bool = True
    marks: bool = True
    mark_offset: float = 2.5
    mark_length: float = 3.0


@dataclass(frozen=True)
class Placement:
    """Копия на листе: левый верхний угол обрезного формата и поворот на 90°
    по часовой. clip — сколько вылета оставить с каждой стороны (слева,
    сверху, справа, снизу) у копии в том виде, как она лежит на листе."""

    x: float
    y: float
    w: float
    h: float
    rotated: bool
    clip: tuple[float, float, float, float]


@dataclass(frozen=True)
class Cut:
    """Линия реза: axis "x" — вертикальная (x = pos), "y" — горизонтальная.
    start..end — её протяжённость по другой оси."""

    axis: str
    pos: float
    start: float
    end: float


@dataclass(frozen=True)
class Mark:
    x1: float
    y1: float
    x2: float
    y2: float


@dataclass(frozen=True)
class Layout:
    job: Job
    placements: tuple[Placement, ...]
    cuts: tuple[Cut, ...]
    marks: tuple[Mark, ...] = field(default=())

    @property
    def count(self) -> int:
        return len(self.placements)


def check(job: Job) -> None:
    if job.item_w <= 0 or job.item_h <= 0:
        raise ImposeError("Размер изделия должен быть больше нуля")
    if job.sheet_w <= 0 or job.sheet_h <= 0:
        raise ImposeError("Размер листа должен быть больше нуля")
    for name, value in (("вылет", job.bleed), ("поле", job.margin), ("зазор", job.gap),
                        ("отступ метки", job.mark_offset), ("длина метки", job.mark_length)):
        if value < 0:
            raise ImposeError(f"Отрицательный {name}")
    if job.marks and job.mark_offset + EPS < job.bleed:
        raise ImposeError("Отступ меток меньше вылета — метки напечатаются на вылетах")


def reserve(job: Job) -> float:
    """Сколько места нужно снаружи обрезного края крайних копий."""
    return max(job.bleed, job.mark_offset + job.mark_length) if job.marks else job.bleed


def fits(length: float, size: float, gap: float) -> int:
    """Сколько изделий размера size встанет на длину length с зазором gap."""
    if length + EPS < size:
        return 0
    return int((length + gap + EPS) // (size + gap))


def span(n: int, size: float, gap: float) -> float:
    return n * size + max(n - 1, 0) * gap if n else 0.0


def _grid(x0: float, y0: float, cols: int, rows: int, w: float, h: float, gap: float, rotated: bool) -> list[Item]:
    return [(x0 + c * (w + gap), y0 + r * (h + gap), w, h, rotated) for r in range(rows) for c in range(cols)]


def _candidates(job: Job):
    """Все гильотинные варианты: списки копий от точки (0, 0)."""
    r = reserve(job)
    avail_w = job.sheet_w - 2 * job.margin - 2 * r
    avail_h = job.sheet_h - 2 * job.margin - 2 * r
    if avail_w <= 0 or avail_h <= 0:
        return
    g = job.gap
    a = (job.item_w, job.item_h, False)
    b = (job.item_h, job.item_w, True)
    orients = [a, b] if job.rotate and abs(job.item_w - job.item_h) > EPS else [a]
    for w, h, rot in orients:
        cols, rows = fits(avail_w, w, g), fits(avail_h, h, g)
        if cols and rows:
            yield _grid(0, 0, cols, rows, w, h, g, rot)
    if len(orients) < 2:
        return
    for (w1, h1, r1), (w2, h2, r2) in ((a, b), (b, a)):
        # полоса сбоку: основная сетка на n1 колонок, остаток ширины — другая ориентация
        rows1 = fits(avail_h, h1, g)
        for n1 in range(1, fits(avail_w, w1, g) + 1):
            used = span(n1, w1, g) + g
            cols2, rows2 = fits(avail_w - used, w2, g), fits(avail_h, h2, g)
            if rows1 and cols2 and rows2:
                yield _grid(0, 0, n1, rows1, w1, h1, g, r1) + _grid(used, 0, cols2, rows2, w2, h2, g, r2)
        # полоса снизу
        cols1 = fits(avail_w, w1, g)
        for n1 in range(1, fits(avail_h, h1, g) + 1):
            used = span(n1, h1, g) + g
            cols2, rows2 = fits(avail_w, w2, g), fits(avail_h - used, h2, g)
            if cols1 and cols2 and rows2:
                yield _grid(0, 0, cols1, n1, w1, h1, g, r1) + _grid(0, used, cols2, rows2, w2, h2, g, r2)


def _cuts(items: list[Item]) -> list[Cut]:
    """Линии реза: каждый обрезной край каждой копии; совпадающие у соседей —
    один рез. Протяжённость — по копиям, которые этот рез режет."""
    lines: dict[tuple[str, float], list[float]] = {}
    for x, y, w, h, _ in items:
        for axis, pos, lo, hi in (("x", x, y, y + h), ("x", x + w, y, y + h),
                                  ("y", y, x, x + w), ("y", y + h, x, x + w)):
            seg = lines.setdefault((axis, round(pos, 4)), [lo, hi])
            seg[0], seg[1] = min(seg[0], lo), max(seg[1], hi)
    return [Cut(axis, pos, lo, hi) for (axis, pos), (lo, hi) in sorted(lines.items())]


def _clips(items: list[Item], job: Job) -> list[list[float]]:
    """Вылет каждой копии с каждой стороны (слева, сверху, справа, снизу).

    Снаружи — полный. Если вылеты двух копий заходят друг на друга (соседи
    встык, узкий зазор, угол к углу у двух блоков с разным шагом рядов), обе
    копии урезаются до половины расстояния между ними — по той оси, по
    которой они разнесены дальше. Урезание только уменьшает вылеты, поэтому
    уже разведённые пары снова не сойдутся."""
    clips = [[job.bleed] * 4 for _ in items]

    def rect(i: int) -> tuple[float, float, float, float]:
        x, y, w, h, _ = items[i]
        c = clips[i]
        return x - c[0], y - c[1], x + w + c[2], y + h + c[3]

    for i in range(len(items)):
        for j in range(i + 1, len(items)):
            a, b = rect(i), rect(j)
            if not (a[0] < b[2] - EPS and b[0] < a[2] - EPS and a[1] < b[3] - EPS and b[1] < a[3] - EPS):
                continue
            xi, yi, wi, hi, _ = items[i]
            xj, yj, wj, hj, _ = items[j]
            sx = max(xj - (xi + wi), xi - (xj + wj))
            sy = max(yj - (yi + hi), yi - (yj + hj))
            if sx >= sy:
                ci, cj = (2, 0) if xj >= xi + wi - EPS else (0, 2)  # j справа от i — или слева
                half = max(sx, 0.0) / 2
            else:
                ci, cj = (3, 1) if yj >= yi + hi - EPS else (1, 3)  # j ниже i — или выше
                half = max(sy, 0.0) / 2
            clips[i][ci] = min(clips[i][ci], half)
            clips[j][cj] = min(clips[j][cj], half)
    return clips


def _marks(cuts: list[Cut], box: tuple[float, float, float, float], job: Job) -> list[Mark]:
    """Метки на концах линий реза — только там, где конец выходит на внешнюю
    границу раскладки: внутри (между блоками) метка легла бы на соседние копии."""
    if not job.marks:
        return []
    left, top, right, bottom = box
    off, length = job.mark_offset, job.mark_length
    out: list[Mark] = []
    for c in cuts:
        if c.axis == "x":
            if abs(c.start - top) < EPS:
                out.append(Mark(c.pos, top - off - length, c.pos, top - off))
            if abs(c.end - bottom) < EPS:
                out.append(Mark(c.pos, bottom + off, c.pos, bottom + off + length))
        else:
            if abs(c.start - left) < EPS:
                out.append(Mark(left - off - length, c.pos, left - off, c.pos))
            if abs(c.end - right) < EPS:
                out.append(Mark(right + off, c.pos, right + off + length, c.pos))
    return out


def impose(job: Job) -> Layout:
    """Лучшая гильотинная раскладка. Ни одна не встала — ImposeError."""
    check(job)
    best: tuple[tuple[int, int], list[Item]] | None = None
    for items in _candidates(job):
        key = (len(items), -len(_cuts(items)))
        if best is None or key > best[0]:
            best = (key, items)
    if best is None:
        raise ImposeError("Изделие не помещается на лист с такими полями и вылетами")
    items = best[1]
    # по центру листа
    min_x = min(i[0] for i in items)
    max_x = max(i[0] + i[2] for i in items)
    min_y = min(i[1] for i in items)
    max_y = max(i[1] + i[3] for i in items)
    dx = (job.sheet_w - (max_x - min_x)) / 2 - min_x
    dy = (job.sheet_h - (max_y - min_y)) / 2 - min_y
    items = [(x + dx, y + dy, w, h, rot) for x, y, w, h, rot in items]
    cuts = _cuts(items)
    box = (min_x + dx, min_y + dy, max_x + dx, max_y + dy)
    placements = tuple(
        Placement(round(x, 4), round(y, 4), w, h, rot, (round(c[0], 4), round(c[1], 4), round(c[2], 4), round(c[3], 4)))
        for (x, y, w, h, rot), c in zip(items, _clips(items, job), strict=True)
    )
    return Layout(job, placements, tuple(cuts), tuple(_marks(cuts, box, job)))
```

- [ ] **Step 4: Прогон — проходит**

Run: `PYTHONIOENCODING=utf-8 .venv/Scripts/python -m pytest -q tests/test_impose.py`
Expected: PASS. Если какое-то число в `test_известные_раскладки` не сошлось — не править число под код: пересчитать вручную (формула `fits`) и найти, кто неправ.

- [ ] **Step 5: ruff + mypy, коммит**

```bash
.venv/Scripts/python -m ruff check app scripts tests && .venv/Scripts/python -m mypy app
git add app/services/impose.py tests/test_impose.py
git commit -m "Инструменты 16.5: движок гильотинной раскладки с метками реза"
```

---

### Task 5: 16.5 — PDF: сведения о страницах и сборка листа

**Files:**
- Modify: `poster-ocr/requirements.txt` (после cryptography)
- Create: `poster-ocr/app/services/impose_pdf.py`
- Create: `poster-ocr/tests/pdf_helpers.py`
- Test: `poster-ocr/tests/test_impose_pdf.py`

**Interfaces:**
- Consumes: `impose.Job`, `impose.impose`, `impose.Layout`, `impose.Placement`, `impose.ImposeError`.
- Produces:
  - `MM = 72 / 25.4`; `PdfError(ValueError)`;
  - `pdf_info(data: bytes) -> dict` → `{"pages": [{"index": 1, "rotate": 0, "media": [x0,y0,x1,y1], "trim": [...]|None, "bleed": [...]|None, "width_mm": float, "height_mm": float}], "total": int}` — рамки в пунктах, в собственных координатах PDF (как у pdf.js), размеры в мм — видимые (с учётом `/Rotate`);
  - `item_size(page_rotate: int, trim: tuple[float,float,float,float]) -> tuple[float, float]` — видимые мм, округление до 0,01;
  - `build(data: bytes, req: SheetRequest) -> tuple[bytes, Layout]`;
  - `SheetRequest(page, back_page, flip, trim, bleed, sheet_w, sheet_h, margin, gap, rotate, marks, mark_offset, mark_length)` (dataclass; `page` и `back_page` с 1, `back_page=None` — без оборота; `flip` — `"long"`|`"short"`; `trim` — рамка обрезного формата в пунктах PDF).

- [ ] **Step 1: Зависимость**

`requirements.txt` после `cryptography…`:

```
# раскладка PDF под печать (app/services/impose_pdf.py): страница-источник
# вставляется в лист как есть, CMYK и плашки не трогаются. Чистый Python
pypdf>=6,<7
```

Run: `.venv/Scripts/python -m pip install "pypdf>=6,<7"`

- [ ] **Step 2: `tests/pdf_helpers.py`**

```python
"""PDF для тестов раскладки — собирается тут же, без файлов в репозитории."""

from __future__ import annotations

import io

from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, NameObject, NumberObject, RectangleObject

MM = 72 / 25.4
# чистый чёрный K и составной зелёный — чтобы проверить, что CMYK доехал как был
CMYK_CONTENT = b"0 0 0 1 k 0 0 1000 1000 re f 0.6 0 1 0 k 20 20 100 40 re f"


def make_pdf(pages: list[dict], password: str | None = None) -> bytes:
    """pages: [{"w": мм, "h": мм, "bleed": мм или None (нет TrimBox), "rotate": 0}]"""
    writer = PdfWriter()
    for spec in pages:
        w, h = spec["w"] * MM, spec["h"] * MM
        page = writer.add_blank_page(w, h)
        content = DecodedStreamObject()
        content.set_data(spec.get("content", CMYK_CONTENT))
        page[NameObject("/Contents")] = writer._add_object(content)
        bleed = spec.get("bleed")
        if bleed is not None:
            b = bleed * MM
            page.trimbox = RectangleObject([b, b, w - b, h - b])
            page.bleedbox = RectangleObject([0, 0, w, h])
        if spec.get("rotate"):
            page[NameObject("/Rotate")] = NumberObject(spec["rotate"])
    if password:
        writer.encrypt(password)
    buf = io.BytesIO()
    writer.write(buf)
    return buf.getvalue()
```

- [ ] **Step 3: Тесты `tests/test_impose_pdf.py`**

```python
"""Сборка листа из PDF: CMYK не трогается, копии там, где сказал движок."""

from __future__ import annotations

import io
import re

import pytest
from pdf_helpers import MM, make_pdf
from pypdf import PdfReader

from app.services import impose_pdf
from app.services.impose import impose
from app.services.impose_pdf import PdfError, SheetRequest

CARD = {"w": 94, "h": 54, "bleed": 2}  # визитка 90×50 с вылетами по 2 мм
TRIM = (2 * MM, 2 * MM, 92 * MM, 52 * MM)


def _req(**kw) -> SheetRequest:
    base = {"page": 1, "back_page": None, "flip": "long", "trim": TRIM, "bleed": 2.0, "sheet_w": 320.0,
            "sheet_h": 450.0, "margin": 5.0, "gap": 0.0, "rotate": True, "marks": True,
            "mark_offset": 2.5, "mark_length": 3.0}
    base.update(kw)
    return SheetRequest(**base)


def _ops(page) -> bytes:
    return page.get_contents().get_data()


def _cms(data: bytes) -> list[list[float]]:
    return [[float(v) for v in m.groups()] for m in re.finditer(rb"([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) cm", data)]


def test_сведения_о_страницах():
    info = impose_pdf.pdf_info(make_pdf([CARD, {"w": 210, "h": 297, "bleed": None, "rotate": 90}]))
    assert info["total"] == 2
    first, second = info["pages"]
    assert first["trim"] == pytest.approx(list(TRIM), abs=0.01)
    assert first["bleed"] is not None
    assert (first["width_mm"], first["height_mm"]) == pytest.approx((94, 54), abs=0.01)
    assert second["trim"] is None and second["rotate"] == 90
    assert (second["width_mm"], second["height_mm"]) == pytest.approx((297, 210), abs=0.01)  # видимые, «лёжа»


def test_cmyk_и_одна_форма_на_все_копии():
    pdf, layout = impose_pdf.build(make_pdf([CARD]), _req())
    reader = PdfReader(io.BytesIO(pdf))
    assert len(reader.pages) == 1
    sheet = reader.pages[0]
    assert (float(sheet.mediabox.width) / MM, float(sheet.mediabox.height) / MM) == pytest.approx((320, 450), abs=0.01)
    xobjects = sheet["/Resources"]["/XObject"]
    assert list(xobjects.keys()) == ["/P1"]             # одна форма, сколько бы ни было копий
    form = xobjects["/P1"].get_object().get_data()
    assert b"0 0 0 1 k" in form and b"0.6 0 1 0 k" in form  # цвета как в исходнике
    assert _ops(sheet).count(b"/P1 Do") == layout.count == 24
    assert b"1 1 1 1 K" in _ops(sheet)                 # метки — цветом «регистрация»


def test_копия_обрезана_по_формату_и_вылетам():
    pdf, layout = impose_pdf.build(make_pdf([CARD]), _req(gap=4))
    sheet = PdfReader(io.BytesIO(pdf)).pages[0]
    clips = [[float(v) for v in m.groups()] for m in re.finditer(rb"([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) re W n", _ops(sheet))]
    assert len(clips) == layout.count
    p = layout.placements[0]
    x, y, w, h = clips[0]
    assert x / MM == pytest.approx(p.x - p.clip[0], abs=0.01)
    assert (450 - (y + h) / MM) == pytest.approx(p.y - p.clip[1], abs=0.01)
    assert w / MM == pytest.approx(p.w + p.clip[0] + p.clip[2], abs=0.01)


def test_повернутая_копия_по_часовой():
    # визитки на SRA3 без меток: часть копий повёрнута
    pdf, layout = impose_pdf.build(make_pdf([CARD]), _req(marks=False))
    cms = _cms(_ops(PdfReader(io.BytesIO(pdf)).pages[0]))
    rotated = [cm for cm, p in zip(cms, layout.placements, strict=True) if p.rotated]
    assert rotated and all(cm[:4] == [0, -1, 1, 0] for cm in rotated)


def test_страница_с_rotate_ставится_прямо():
    # страница «лёжа»: 54×94 в файле, /Rotate 90 — на экране визитка 94×54
    src = make_pdf([{"w": 54, "h": 94, "bleed": 2, "rotate": 90}])
    trim = (2 * MM, 2 * MM, 52 * MM, 92 * MM)
    assert impose_pdf.item_size(90, trim) == (90.0, 50.0)
    pdf, layout = impose_pdf.build(src, _req(trim=trim, marks=True))
    cms = _cms(_ops(PdfReader(io.BytesIO(pdf)).pages[0]))
    plain = [cm for cm, p in zip(cms, layout.placements, strict=True) if not p.rotated]
    assert plain and all(cm[:4] == [0, -1, 1, 0] for cm in plain)  # поворот страницы учтён


def test_без_trimbox_формат_по_странице():
    info = impose_pdf.pdf_info(make_pdf([{"w": 90, "h": 50, "bleed": None}]))
    media = info["pages"][0]["media"]
    pdf, layout = impose_pdf.build(make_pdf([{"w": 90, "h": 50, "bleed": None}]), _req(trim=tuple(media), bleed=0.0))
    assert layout.count == 24


def test_оборот_зеркально_по_длинной_стороне():
    src = make_pdf([CARD, CARD])
    pdf, layout = impose_pdf.build(src, _req(back_page=2, gap=4))
    reader = PdfReader(io.BytesIO(pdf))
    assert len(reader.pages) == 2
    back = reader.pages[1]
    assert list(back["/Resources"]["/XObject"].keys()) == ["/P2"]
    clips = [[float(v) for v in m.groups()] for m in re.finditer(rb"([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) re W n", _ops(back))]
    p = layout.placements[0]
    assert clips[0][0] / MM == pytest.approx(320 - (p.x + p.w + p.clip[2]), abs=0.01)  # x зеркально


def test_формат_за_пределами_страницы():
    with pytest.raises(PdfError, match="за пределами"):
        impose_pdf.build(make_pdf([CARD]), _req(trim=(0, 0, 500 * MM, 50 * MM)))
    with pytest.raises(PdfError, match="нулевой"):
        impose_pdf.build(make_pdf([CARD]), _req(trim=(10, 10, 10, 50)))


def test_не_pdf_и_зашифрованный():
    with pytest.raises(PdfError, match="не PDF"):
        impose_pdf.pdf_info(b"RIFF\x00\x00CDR")
    with pytest.raises(PdfError, match="паролем"):
        impose_pdf.pdf_info(make_pdf([CARD], password="secret"))


def test_нет_такой_страницы():
    with pytest.raises(PdfError, match="страниц"):
        impose_pdf.build(make_pdf([CARD]), _req(page=3))


def test_раскладка_совпадает_с_движком():
    # PDF-ручка и превью в браузере считают через один движок — числа одни
    _, layout = impose_pdf.build(make_pdf([CARD]), _req())
    assert layout == impose(layout.job)
```

- [ ] **Step 4: Прогон — падает (нет модуля)**

Run: `PYTHONIOENCODING=utf-8 .venv/Scripts/python -m pytest -q tests/test_impose_pdf.py`

- [ ] **Step 5: `app/services/impose_pdf.py`**

```python
"""Раскладка PDF под печать: страница-источник на листе, метки реза.

Главное — цвет. Печать идёт только в CMYK, поэтому страница макета не
перерисовывается и не перекодируется: её содержимое целиком становится
Form XObject (так PDF хранит «вставленный рисунок»), и лист вызывает его
столько раз, сколько копий, — каждый раз со своим сдвигом, поворотом и
обрезкой. Операторы цвета, плашки, наложения, шрифты и растры остаются
байт в байт как в файле; растр при этом хранится один раз, сколько бы
копий ни было.

Координаты. Движок раскладки (impose.py) считает в мм от левого верхнего
угла листа; PDF — в пунктах от левого нижнего. Рамка обрезного формата
приходит в собственных координатах страницы PDF (так их показывает pdf.js
в браузере), а /Rotate страницы учитывается при установке копии: на листе
она стоит так, как её видели на экране.

Опора на pypdf: PdfWriter._add_object — внутренний метод, публичного
способа добавить свой поток в pypdf 6 нет. Версия прибита в requirements.txt.
"""

from __future__ import annotations

import io
from dataclasses import dataclass

from pypdf import PdfReader, PdfWriter
from pypdf.errors import PdfReadError
from pypdf.generic import ArrayObject, DecodedStreamObject, DictionaryObject, FloatObject, NameObject

from app.services.impose import ImposeError, Job, Layout, Placement, impose

MM = 72 / 25.4
MAX_PAGES_INFO = 200
MARK_WIDTH_PT = 0.25


class PdfError(ValueError):
    """PDF не годится для раскладки — с понятной причиной."""


@dataclass(frozen=True)
class SheetRequest:
    page: int
    back_page: int | None
    flip: str
    trim: tuple[float, float, float, float]
    bleed: float
    sheet_w: float
    sheet_h: float
    margin: float
    gap: float
    rotate: bool
    marks: bool
    mark_offset: float
    mark_length: float


def _open(data: bytes) -> PdfReader:
    if not data.lstrip()[:5].startswith(b"%PDF"):
        raise PdfError("Это не PDF. Выгрузите макет из CorelDRAW в PDF")
    try:
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted and not reader.decrypt(""):
            raise PdfError("PDF защищён паролем — выгрузите его без защиты")
        _ = len(reader.pages)
    except PdfReadError as exc:
        raise PdfError(f"PDF не читается: {exc}") from None
    return reader


def _box(value) -> list[float] | None:
    return [round(float(v), 3) for v in value] if value is not None else None


def pdf_info(data: bytes) -> dict:
    """Страницы: рамки (в пунктах PDF), поворот, видимый размер в мм."""
    reader = _open(data)
    pages = []
    for index, page in enumerate(reader.pages[:MAX_PAGES_INFO], start=1):
        rotate = int(page.get("/Rotate", 0) or 0) % 360
        media = _box(page.mediabox) or [0, 0, 0, 0]
        w, h = (media[2] - media[0]) / MM, (media[3] - media[1]) / MM
        if rotate in (90, 270):
            w, h = h, w
        pages.append({
            "index": index,
            "rotate": rotate,
            "media": media,
            "trim": _box(page["/TrimBox"]) if "/TrimBox" in page else None,
            "bleed": _box(page["/BleedBox"]) if "/BleedBox" in page else None,
            "width_mm": round(w, 2),
            "height_mm": round(h, 2),
        })
    return {"pages": pages, "total": len(reader.pages)}


def item_size(page_rotate: int, trim: tuple[float, float, float, float]) -> tuple[float, float]:
    """Видимый размер обрезного формата в мм (как на экране)."""
    w = round(abs(trim[2] - trim[0]) / MM, 2)
    h = round(abs(trim[3] - trim[1]) / MM, 2)
    return (h, w) if page_rotate % 180 == 90 else (w, h)


def _matrix(theta: int, trim: tuple[float, float, float, float], x: float, y: float) -> list[float]:
    """cm, который ставит рамку trim страницы-источника (пункты PDF) левым
    нижним углом в точку (x, y) листа, повернув на theta° по часовой."""
    sx, sy = min(trim[0], trim[2]), min(trim[1], trim[3])
    sw, sh = abs(trim[2] - trim[0]), abs(trim[3] - trim[1])
    if theta == 0:
        return [1, 0, 0, 1, x - sx, y - sy]
    if theta == 90:
        return [0, -1, 1, 0, x - sy, y + sx + sw]
    if theta == 180:
        return [-1, 0, 0, -1, x + sx + sw, y + sy + sh]
    return [0, 1, -1, 0, x + sy + sh, y - sx]  # 270


def _form(page, writer: PdfWriter):
    """Страница-источник как Form XObject — её содержимое без изменений."""
    form = DecodedStreamObject()
    contents = page.get_contents()
    form.set_data(contents.get_data() if contents is not None else b"")
    form.update({
        NameObject("/Type"): NameObject("/XObject"),
        NameObject("/Subtype"): NameObject("/Form"),
        NameObject("/BBox"): ArrayObject([FloatObject(v) for v in page.mediabox]),
    })
    if "/Resources" in page:
        form[NameObject("/Resources")] = page["/Resources"].clone(writer)
    if "/Group" in page:  # прозрачность и её цветовое пространство — как у страницы
        form[NameObject("/Group")] = page["/Group"].clone(writer)
    return writer._add_object(form)


def _mirror(p: Placement, flip: str, sheet_w: float, sheet_h: float) -> tuple[float, float, tuple[float, float, float, float]]:
    """Место копии на обороте: лист переворачивают по длинной стороне
    (слева направо) или по короткой (сверху вниз)."""
    left, top, right, bottom = p.clip
    if flip == "short":
        return p.x, sheet_h - p.y - p.h, (left, bottom, right, top)
    return sheet_w - p.x - p.w, p.y, (right, top, left, bottom)


def _back_theta(rotated: bool, flip: str) -> int:
    """Поворот копии на обороте, чтобы её верх лёг к тому же краю листа, что
    у лица. По длинной стороне: прямая — 0°, повёрнутая — 270°; по короткой:
    прямая — 180°, повёрнутая — 90°."""
    if flip == "short":
        return 90 if rotated else 180
    return 270 if rotated else 0


def _sheet_ops(layout: Layout, req: SheetRequest, name: str, trim, page_rotate: int, back: bool) -> bytes:
    ops: list[bytes] = []
    for p in layout.placements:
        if back:
            x, y, clip = _mirror(p, req.flip, req.sheet_w, req.sheet_h)
            theta = (_back_theta(p.rotated, req.flip) + page_rotate) % 360
        else:
            x, y, clip = p.x, p.y, p.clip
            theta = ((90 if p.rotated else 0) + page_rotate) % 360
        # в PDF: левый нижний угол обрезного формата копии
        X, Y = x * MM, (req.sheet_h - y - p.h) * MM
        left, top, right, bottom = clip
        cx, cy = X - left * MM, Y - bottom * MM
        cw, ch = (p.w + left + right) * MM, (p.h + top + bottom) * MM
        cm = " ".join(f"{v:.4f}".rstrip("0").rstrip(".") for v in _matrix(theta, trim, X, Y))
        ops.append(f"q {cx:.4f} {cy:.4f} {cw:.4f} {ch:.4f} re W n {cm} cm /{name} Do Q".encode())
    if req.marks:
        ops.append(f"q {MARK_WIDTH_PT} w 1 1 1 1 K".encode())
        for m in layout.marks:
            x1, x2 = m.x1, m.x2
            if back and req.flip == "long":
                x1, x2 = req.sheet_w - x1, req.sheet_w - x2
            y1, y2 = m.y1, m.y2
            if back and req.flip == "short":
                y1, y2 = req.sheet_h - y1, req.sheet_h - y2
            ops.append(f"{x1 * MM:.4f} {(req.sheet_h - y1) * MM:.4f} m {x2 * MM:.4f} {(req.sheet_h - y2) * MM:.4f} l S".encode())
        ops.append(b"Q")
    return b"\n".join(ops)


def _check_trim(page, trim) -> None:
    x0, y0, x1, y1 = (float(v) for v in page.mediabox)
    lo_x, hi_x = sorted((trim[0], trim[2]))
    lo_y, hi_y = sorted((trim[1], trim[3]))
    if hi_x - lo_x < 1 or hi_y - lo_y < 1:
        raise PdfError("Обрезной формат нулевой — выберите область на странице")
    if lo_x < x0 - 1 or lo_y < y0 - 1 or hi_x > x1 + 1 or hi_y > y1 + 1:
        raise PdfError("Обрезной формат за пределами страницы")


def build(data: bytes, req: SheetRequest) -> tuple[bytes, Layout]:
    """Лист (и оборот, если задан) — готовый PDF и раскладка, по которой он собран."""
    reader = _open(data)
    total = len(reader.pages)
    for number in (req.page, req.back_page):
        if number is not None and not 1 <= number <= total:
            raise PdfError(f"В файле страниц: {total}")
    front = reader.pages[req.page - 1]
    _check_trim(front, req.trim)
    front_rotate = int(front.get("/Rotate", 0) or 0) % 360
    item_w, item_h = item_size(front_rotate, req.trim)
    job = Job(item_w, item_h, bleed=req.bleed, sheet_w=req.sheet_w, sheet_h=req.sheet_h, margin=req.margin,
              gap=req.gap, rotate=req.rotate, marks=req.marks, mark_offset=req.mark_offset,
              mark_length=req.mark_length)
    try:
        layout = impose(job)
    except ImposeError as exc:
        raise PdfError(str(exc)) from None

    writer = PdfWriter()
    sides = [(front, "P1", False)]
    if req.back_page is not None:
        sides.append((reader.pages[req.back_page - 1], "P2", True))
    for source, name, back in sides:
        sheet = writer.add_blank_page(req.sheet_w * MM, req.sheet_h * MM)
        sheet[NameObject("/Resources")] = DictionaryObject(
            {NameObject("/XObject"): DictionaryObject({NameObject(f"/{name}"): _form(source, writer)})}
        )
        rotate = int(source.get("/Rotate", 0) or 0) % 360
        content = DecodedStreamObject()
        content.set_data(_sheet_ops(layout, req, name, req.trim, rotate, back))
        sheet[NameObject("/Contents")] = writer._add_object(content)
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue(), layout
```

Оборот использует ту же рамку `trim`, что лицо: у визиток лицо и оборот — страницы одного формата. Если размер страниц разный, рамка лица на обороте ничего не значит — отказ. В `build` сразу после `_check_trim(front, req.trim)`:

```python
    if req.back_page is not None:
        back_box = reader.pages[req.back_page - 1].mediabox
        if abs(float(back_box.width) - float(front.mediabox.width)) > 1 or \
                abs(float(back_box.height) - float(front.mediabox.height)) > 1:
            raise PdfError("Лицо и оборот разного формата — выберите страницы одного размера")
```

И тест в `tests/test_impose_pdf.py`:

```python
def test_лицо_и_оборот_разного_формата():
    with pytest.raises(PdfError, match="разного формата"):
        impose_pdf.build(make_pdf([CARD, {"w": 210, "h": 297, "bleed": 2}]), _req(back_page=2))
```

- [ ] **Step 6: Прогон — проходит**

Run: `PYTHONIOENCODING=utf-8 .venv/Scripts/python -m pytest -q tests/test_impose_pdf.py`

- [ ] **Step 7: Независимая сверка в настоящем просмотрщике**

Собрать лист из `make_pdf([CARD, CARD])` с оборотом скриптом во временной папке, открыть в Edge (встроенный просмотр PDF) — копии видны, обрезаны по вылетам, метки на полях, оборот зеркален. Скриншот — в отчёт. Главная проверка цвета — у владельца: открыть лист в Acrobat → «Просмотр цветоделения» (Output Preview): чёрный — только на плате K.

- [ ] **Step 8: ruff + mypy + весь набор, коммит**

```bash
.venv/Scripts/python -m ruff check app scripts tests && .venv/Scripts/python -m mypy app && PYTHONIOENCODING=utf-8 .venv/Scripts/python -m pytest -q
git add requirements.txt app/services/impose_pdf.py tests/pdf_helpers.py tests/test_impose_pdf.py
git commit -m "Инструменты 16.5: сборка листа из PDF, CMYK как в исходнике"
```

---

### Task 6: 16.5 — ручки раскладки

**Files:**
- Modify: `poster-ocr/app/api/v1/tools.py`
- Test: `poster-ocr/tests/test_tools_api.py`

**Interfaces:**
- Consumes: `impose_pdf.pdf_info`, `impose_pdf.build`, `impose_pdf.SheetRequest`, `impose_pdf.PdfError`, `impose.impose`, `impose.Job`, `tool_files.*`.
- Produces:
  - `POST /api/tools/impose/info` (multipart `file`) → `pdf_info(...)`;
  - `POST /api/tools/impose/layout` (JSON `LayoutIn`) → `{"count", "sheet_w", "sheet_h", "placements": [{x,y,w,h,rotated,clip}], "cuts": [{axis,pos,start,end}], "marks": [{x1,y1,x2,y2}]}`;
  - `POST /api/tools/impose/pdf` (multipart `file` + поле `params` — JSON `SheetIn`) → `application/pdf`, `Content-Disposition` с именем, заголовок `X-Impose-Count`.

- [ ] **Step 1: Тесты** (дописать в `tests/test_tools_api.py`)

```python
import json as jsonlib

from pdf_helpers import MM, make_pdf

CARD_PDF = {"w": 94, "h": 54, "bleed": 2}
SHEET = {"page": 1, "trim": [2 * MM, 2 * MM, 92 * MM, 52 * MM], "bleed": 2, "sheet_w": 320, "sheet_h": 450,
         "margin": 5, "gap": 0, "rotate": True, "marks": True}


def test_раскладка_сведения_о_pdf(db, client, tmp_root):
    _, key = staff(db, "Печатник", ["tools.impose"])
    reply = client.post("/api/tools/impose/info", headers={"X-API-Key": key},
                        files={"file": ("визитка.pdf", make_pdf([CARD_PDF]), "application/pdf")})
    assert reply.status_code == 200, reply.text
    assert reply.json()["pages"][0]["trim"] is not None
    assert _left(tmp_root) == []


def test_раскладка_схема(db, client):
    _, key = staff(db, "Печатник", ["tools.impose"])
    reply = client.post("/api/tools/impose/layout", headers={"X-API-Key": key},
                        json={"item_w": 90, "item_h": 50})
    assert reply.status_code == 200
    data = reply.json()
    assert data["count"] == 24 and len(data["placements"]) == 24
    assert data["marks"] and data["cuts"]


def test_раскладка_схема_ошибка_параметров(db, client):
    _, key = staff(db, "Печатник", ["tools.impose"])
    reply = client.post("/api/tools/impose/layout", headers={"X-API-Key": key},
                        json={"item_w": 297, "item_h": 420, "sheet_w": 210, "sheet_h": 297})
    assert reply.status_code == 422
    assert "не помещается" in reply.json()["detail"]


def test_раскладка_pdf(db, client, tmp_root):
    _, key = staff(db, "Печатник", ["tools.impose"])
    reply = client.post("/api/tools/impose/pdf", headers={"X-API-Key": key},
                        files={"file": ("визитка.pdf", make_pdf([CARD_PDF]), "application/pdf")},
                        data={"params": jsonlib.dumps(SHEET)})
    assert reply.status_code == 200
    assert reply.headers["content-type"] == "application/pdf"
    assert reply.headers["x-impose-count"] == "24"
    assert "attachment" in reply.headers["content-disposition"]
    assert _left(tmp_root) == []


def test_раскладка_pdf_ошибка_и_папка_удалена(db, client, tmp_root):
    _, key = staff(db, "Печатник", ["tools.impose"])
    reply = client.post("/api/tools/impose/pdf", headers={"X-API-Key": key},
                        files={"file": ("макет.pdf", b"RIFF-not-a-pdf", "application/pdf")},
                        data={"params": jsonlib.dumps(SHEET)})
    assert reply.status_code == 422
    assert "не PDF" in reply.json()["detail"]
    assert _left(tmp_root) == []
    bad = client.post("/api/tools/impose/pdf", headers={"X-API-Key": key},
                      files={"file": ("a.pdf", make_pdf([CARD_PDF]), "application/pdf")},
                      data={"params": "{не json"})
    assert bad.status_code == 422


def test_раскладка_без_права_нельзя(db, client):
    _, key = staff(db, "Кассир", ["orders.view"])
    assert client.post("/api/tools/impose/layout", headers={"X-API-Key": key},
                       json={"item_w": 90, "item_h": 50}).status_code == 403
```

- [ ] **Step 2: Прогон — падает (404)**

- [ ] **Step 3: Ручки** — дописать в `app/api/v1/tools.py`

Импорты: `from typing import Literal`, `from urllib.parse import quote`, `from dataclasses import asdict`, `from fastapi import Form, Response`, `from pydantic import BaseModel, Field, ValidationError`, `from app.services import impose as impose_engine, impose_pdf`.

```python
class LayoutIn(BaseModel):
    """Параметры раскладки в мм — то же, что impose.Job."""

    item_w: float = Field(gt=0, le=5000)
    item_h: float = Field(gt=0, le=5000)
    bleed: float = Field(default=2.0, ge=0, le=20)
    sheet_w: float = Field(default=320.0, gt=0, le=5000)
    sheet_h: float = Field(default=450.0, gt=0, le=5000)
    margin: float = Field(default=5.0, ge=0, le=100)
    gap: float = Field(default=0.0, ge=0, le=100)
    rotate: bool = True
    marks: bool = True
    mark_offset: float = Field(default=2.5, ge=0, le=50)
    mark_length: float = Field(default=3.0, ge=0, le=50)


class SheetIn(BaseModel):
    """Сборка листа из PDF: страница, рамка обрезного формата (пункты PDF), параметры."""

    page: int = Field(default=1, ge=1)
    back_page: int | None = Field(default=None, ge=1)
    flip: Literal["long", "short"] = "long"
    trim: tuple[float, float, float, float]
    bleed: float = Field(default=2.0, ge=0, le=20)
    sheet_w: float = Field(default=320.0, gt=0, le=5000)
    sheet_h: float = Field(default=450.0, gt=0, le=5000)
    margin: float = Field(default=5.0, ge=0, le=100)
    gap: float = Field(default=0.0, ge=0, le=100)
    rotate: bool = True
    marks: bool = True
    mark_offset: float = Field(default=2.5, ge=0, le=50)
    mark_length: float = Field(default=3.0, ge=0, le=50)


def _layout_json(layout: impose_engine.Layout) -> dict:
    return {
        "count": layout.count,
        "sheet_w": layout.job.sheet_w,
        "sheet_h": layout.job.sheet_h,
        "placements": [asdict(p) for p in layout.placements],
        "cuts": [asdict(c) for c in layout.cuts],
        "marks": [asdict(m) for m in layout.marks],
    }


@router.post("/impose/info")
async def impose_info(
    file: UploadFile = File(...),
    user: CurrentUser = Depends(require_perm("tools.impose")),
) -> dict:
    """16.5: страницы PDF — рамки и размеры, чтобы выбрать обрезной формат."""
    try:
        with tool_files.temp_dir() as folder:
            path = await tool_files.save_upload(file, folder, (".pdf",))
            with tool_files.slot():
                return await run_in_threadpool(impose_pdf.pdf_info, path.read_bytes())
    except (tool_files.ToolFileError, impose_pdf.PdfError) as exc:
        raise HTTPException(422, str(exc)) from None


@router.post("/impose/layout")
def impose_layout(
    body: LayoutIn,
    user: CurrentUser = Depends(require_perm("tools.impose")),
) -> dict:
    """16.5: сколько встанет и как — для превью, без файла."""
    try:
        layout = impose_engine.impose(impose_engine.Job(**body.model_dump()))
    except impose_engine.ImposeError as exc:
        raise HTTPException(422, str(exc)) from None
    return _layout_json(layout)


@router.post("/impose/pdf")
async def impose_pdf_sheet(
    file: UploadFile = File(...),
    params: str = Form(...),
    user: CurrentUser = Depends(require_perm("tools.impose")),
) -> Response:
    """16.5: готовый лист PDF для печати. Файл не сохраняется."""
    try:
        sheet = SheetIn.model_validate_json(params)
    except ValidationError as exc:
        raise HTTPException(422, "Параметры раскладки не разобраны: " + exc.errors()[0]["msg"]) from None
    try:
        with tool_files.temp_dir() as folder:
            path = await tool_files.save_upload(file, folder, (".pdf",))
            size = path.stat().st_size
            request = impose_pdf.SheetRequest(**sheet.model_dump())
            with tool_files.slot():
                pdf, layout = await run_in_threadpool(impose_pdf.build, path.read_bytes(), request)
    except (tool_files.ToolFileError, impose_pdf.PdfError) as exc:
        raise HTTPException(422, str(exc)) from None
    stem = cdr.safe_filename(file.filename or "макет").rsplit(".", 1)[0]
    name = f"{stem}-раскладка-{layout.count}шт.pdf"
    applog.info("Инструменты: раскладка %s шт., лист %s×%s, %s КБ · %s",
                layout.count, sheet.sheet_w, sheet.sheet_h, size // 1024, user.name)
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(name)}",
            "X-Impose-Count": str(layout.count),
        },
    )
```

`SheetRequest(**sheet.model_dump())`: `trim` из pydantic приходит кортежем — совпадает с полем dataclass.

- [ ] **Step 4: Прогон — проходит; весь набор; ruff + mypy**

```bash
PYTHONIOENCODING=utf-8 .venv/Scripts/python -m pytest -q && .venv/Scripts/python -m ruff check app scripts tests && .venv/Scripts/python -m mypy app
```

- [ ] **Step 5: Коммит**

```bash
git add app/api/v1/tools.py tests/test_tools_api.py
git commit -m "Инструменты 16.5: ручки раскладки — страницы PDF, схема, готовый лист"
```

---

### Task 7: 16.5 — интерфейс раскладки

**Files:**
- Modify: `poster-ocr/web/package.json` (`pdfjs-dist`)
- Modify: `poster-ocr/web/src/api/client.ts` (после `requestBlob`)
- Modify: `poster-ocr/web/src/api/tools.ts`
- Create: `poster-ocr/web/src/features/tools/impose/pdf.ts`, `PagePicker.tsx`, `SheetPreview.tsx`
- Replace: `poster-ocr/web/src/features/tools/impose/ImposePage.tsx`
- Modify: `poster-ocr/static/css/app.css` (раздел «раскладка» в конец)

**Interfaces:**
- Consumes: ручки Task 6.
- Produces: `requestFormBlob(path, form): Promise<{ blob: Blob; headers: Headers }>`; `imposeInfo(file)`, `imposeLayout(job)`, `imposePdf(file, params)` в `api/tools.ts`; типы `PdfPageInfo`, `ImposeJob`, `ImposeLayout`, `SheetParams`.

- [ ] **Step 1: pdf.js**

Run: `cd poster-ocr/web && npm install pdfjs-dist@^6`
(Сборка pdfjs-dist 6 с Vite 6 проверена отдельно 24.09.2026: worker уходит отдельным файлом `.mjs`; Python 3.10+ отдаёт `.mjs` как JavaScript.)

- [ ] **Step 2: `requestFormBlob`** — в `api/client.ts` после `requestBlob`

```ts
/** Файл в ответ на форму (готовый PDF раскладки). Ошибку сервера — ApiError
 *  с его понятным текстом, как у request(). */
export async function requestFormBlob(path: string, form: FormData): Promise<{ blob: Blob; headers: Headers }> {
  let res: Response;
  try {
    res = await fetch(API + path, { method: 'POST', headers: buildHeaders(form), body: form });
  } catch {
    throw new ApiError('Сервер недоступен. Проверьте, запущена ли программа.', 0);
  }
  if (!res.ok) {
    const message = await readError(res);
    if (res.status === 401) onUnauthorized?.();
    throw new ApiError(message, res.status);
  }
  return { blob: await res.blob(), headers: res.headers };
}
```

- [ ] **Step 3: `api/tools.ts`** — дописать

```ts
import { requestFormBlob } from './client';

export type Box = [number, number, number, number];

export interface PdfPageInfo {
  index: number;
  rotate: number;
  media: Box;
  trim: Box | null;
  bleed: Box | null;
  width_mm: number;
  height_mm: number;
}

export interface ImposeJob {
  item_w: number;
  item_h: number;
  bleed: number;
  sheet_w: number;
  sheet_h: number;
  margin: number;
  gap: number;
  rotate: boolean;
  marks: boolean;
  mark_offset: number;
  mark_length: number;
}

export interface ImposePlacement {
  x: number;
  y: number;
  w: number;
  h: number;
  rotated: boolean;
  /** слева, сверху, справа, снизу — мм вылета */
  clip: [number, number, number, number];
}

export interface ImposeLayout {
  count: number;
  sheet_w: number;
  sheet_h: number;
  placements: ImposePlacement[];
  cuts: { axis: 'x' | 'y'; pos: number; start: number; end: number }[];
  marks: { x1: number; y1: number; x2: number; y2: number }[];
}

export interface SheetParams extends Omit<ImposeJob, 'item_w' | 'item_h'> {
  page: number;
  back_page: number | null;
  flip: 'long' | 'short';
  trim: Box;
}

export function imposeInfo(file: File): Promise<{ pages: PdfPageInfo[]; total: number }> {
  const form = new FormData();
  form.append('file', file);
  return request('/tools/impose/info', { method: 'POST', body: form });
}

export const imposeLayout = (job: ImposeJob): Promise<ImposeLayout> =>
  request('/tools/impose/layout', { method: 'POST', body: job });

export async function imposePdf(file: File, params: SheetParams): Promise<{ blob: Blob; count: number }> {
  const form = new FormData();
  form.append('file', file);
  form.append('params', JSON.stringify(params));
  const { blob, headers } = await requestFormBlob('/tools/impose/pdf', form);
  return { blob, count: Number(headers.get('X-Impose-Count') ?? 0) };
}
```

- [ ] **Step 4: `impose/pdf.ts`** — pdf.js: загрузка, отрисовка страницы, пересчёт координат

```ts
/* pdf.js — только здесь и только на странице раскладки (кусок сборки
   грузится лениво). Страница рисуется в браузере из того же файла, что
   уйдёт на сервер, — отдельной ручки для картинки не нужно.

   Координаты: сервер отдаёт рамки в собственных координатах PDF (пункты,
   начало снизу слева, без учёта /Rotate). viewport pdf.js переводит их в
   пиксели картинки с учётом поворота и CropBox — и обратно. */

import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

import type { Box } from '@/api/tools';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export const MM = 72 / 25.4;

export interface RenderedPage {
  /** картинка страницы, data:-адрес PNG */
  url: string;
  width: number;
  height: number;
  /** пункты PDF → пиксели картинки: [x0, y0, x1, y1], упорядочено */
  toPx: (box: Box) => Box;
  /** пиксель картинки → пункты PDF */
  toPdf: (x: number, y: number) => [number, number];
}

export async function openPdf(file: File) {
  // isEvalSupported: false — CSP сервера запрещает eval, без флага pdf.js
  // пишет ошибку в консоль на каждый шрифт
  return pdfjs.getDocument({ data: await file.arrayBuffer(), isEvalSupported: false }).promise;
}

export async function renderPage(doc: pdfjs.PDFDocumentProxy, index: number, maxSide = 1400): Promise<RenderedPage> {
  const page = await doc.getPage(index);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(maxSide / Math.max(base.width, base.height), 4);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise;
  return {
    url: canvas.toDataURL('image/png'),
    width: canvas.width,
    height: canvas.height,
    toPx: (box) => {
      const [a, b, c, d] = viewport.convertToViewportRectangle(box);
      return [Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)];
    },
    toPdf: (x, y) => viewport.convertToPdfPoint(x, y) as [number, number],
  };
}
```

(Если `page.render` в установленной версии не принимает `canvas` — оставить только `canvasContext`: сверить с `node_modules/pdfjs-dist/types/src/display/api.d.ts`, `RenderParameters`.)

- [ ] **Step 5: `impose/PagePicker.tsx`** — страница с рамками и выбор области

```tsx
/* Страница PDF с рамками: пунктир — обрезной формат, тонкая — вылеты.
   Потянуть мышью — выбрать свою область (например, одну визитку с листа
   дизайнера); кнопками — вернуться к TrimBox или ко всей странице. */

import { useRef, useState } from 'react';

import type { Box, PdfPageInfo } from '@/api/tools';

import type { RenderedPage } from './pdf';

export function PagePicker({
  page,
  image,
  trim,
  onTrim,
}: {
  page: PdfPageInfo;
  image: RenderedPage;
  trim: Box;
  onTrim: (box: Box) => void;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);

  const local = (e: React.PointerEvent) => {
    const r = svg.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * image.width, y: ((e.clientY - r.top) / r.height) * image.height };
  };
  const t = image.toPx(trim);
  const bleed = page.bleed ? image.toPx(page.bleed) : null;

  return (
    <div className="ip-picker">
      <svg
        ref={svg}
        viewBox={`0 0 ${image.width} ${image.height}`}
        onPointerDown={(e) => {
          const p = local(e);
          (e.target as Element).setPointerCapture?.(e.pointerId);
          setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
        }}
        onPointerMove={(e) => {
          if (!drag) return;
          const p = local(e);
          setDrag({ ...drag, x1: p.x, y1: p.y });
        }}
        onPointerUp={() => {
          if (drag && Math.abs(drag.x1 - drag.x0) > 6 && Math.abs(drag.y1 - drag.y0) > 6) {
            const [ax, ay] = image.toPdf(drag.x0, drag.y0);
            const [bx, by] = image.toPdf(drag.x1, drag.y1);
            onTrim([Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)]);
          }
          setDrag(null);
        }}
      >
        <image href={image.url} width={image.width} height={image.height} />
        {bleed && (
          <rect className="ip-bleed" x={bleed[0]} y={bleed[1]} width={bleed[2] - bleed[0]} height={bleed[3] - bleed[1]} />
        )}
        <rect className="ip-trim" x={t[0]} y={t[1]} width={t[2] - t[0]} height={t[3] - t[1]} />
        {drag && (
          <rect
            className="ip-drag"
            x={Math.min(drag.x0, drag.x1)}
            y={Math.min(drag.y0, drag.y1)}
            width={Math.abs(drag.x1 - drag.x0)}
            height={Math.abs(drag.y1 - drag.y0)}
          />
        )}
      </svg>
      <div className="ip-picker-actions">
        {page.trim && (
          <button className="btn btn-ghost" type="button" onClick={() => onTrim(page.trim!)}>
            По обрезному формату файла
          </button>
        )}
        <button className="btn btn-ghost" type="button" onClick={() => onTrim(page.media)}>
          Вся страница
        </button>
        <span className="hint">Потяните мышью по странице, чтобы выбрать свою область</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: `impose/SheetPreview.tsx`** — лист по ответу движка

```tsx
/* Превью листа: копии страницы там, где их поставит сервер, с обрезкой по
   вылетам, линии реза пунктиром и метки. Считает не браузер — рисует ответ
   /impose/layout, тот же движок собирает и PDF. */

import type { Box, ImposeLayout } from '@/api/tools';

import type { RenderedPage } from './pdf';

export function SheetPreview({
  layout,
  image,
  trim,
  itemW,
}: {
  layout: ImposeLayout;
  image: RenderedPage;
  trim: Box;
  /** видимая ширина обрезного формата, мм — как на экране, с учётом /Rotate */
  itemW: number;
}) {
  const t = image.toPx(trim);
  // миллиметров листа на пиксель картинки: картинка уже повёрнута как на
  // экране, поэтому её ширина по рамке — это видимая ширина формата
  const kx = itemW / Math.max(t[2] - t[0], 1);
  return (
    <svg className="ip-sheet" viewBox={`0 0 ${layout.sheet_w} ${layout.sheet_h}`}>
      <rect className="ip-paper" width={layout.sheet_w} height={layout.sheet_h} />
      <defs>
        {layout.placements.map((p, i) => (
          <clipPath id={`ipc${i}`} key={i}>
            <rect x={p.x - p.clip[0]} y={p.y - p.clip[1]} width={p.w + p.clip[0] + p.clip[2]} height={p.h + p.clip[1] + p.clip[3]} />
          </clipPath>
        ))}
      </defs>
      {layout.placements.map((p, i) => (
        <g clipPath={`url(#ipc${i})`} key={i}>
          <image
            href={image.url}
            width={image.width}
            height={image.height}
            transform={
              p.rotated
                ? `translate(${p.x + p.w} ${p.y}) rotate(90) scale(${kx}) translate(${-t[0]} ${-t[1]})`
                : `translate(${p.x} ${p.y}) scale(${kx}) translate(${-t[0]} ${-t[1]})`
            }
          />
        </g>
      ))}
      {layout.cuts.map((c, i) =>
        c.axis === 'x' ? (
          <line className="ip-cut" key={`c${i}`} x1={c.pos} y1={c.start} x2={c.pos} y2={c.end} />
        ) : (
          <line className="ip-cut" key={`c${i}`} x1={c.start} y1={c.pos} x2={c.end} y2={c.pos} />
        ),
      )}
      {layout.marks.map((m, i) => (
        <line className="ip-mark" key={`m${i}`} x1={m.x1} y1={m.y1} x2={m.x2} y2={m.y2} />
      ))}
    </svg>
  );
}
```

- [ ] **Step 7: `impose/ImposePage.tsx`** — страница целиком

```tsx
/* 16.5: раскладка PDF-макета на печатный лист с метками реза.

   Порядок: файл → страница и обрезной формат (по TrimBox файла или своей
   рамкой) → лист и параметры → превью (ответ движка на сервере) → «Скачать
   PDF». Файл уходит на сервер дважды — за сведениями о страницах и за
   готовым листом — и там не хранится. Цвета не трогаются: для печати в
   CMYK макет нужен именно в PDF, выгруженный из CorelDRAW. */

import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';

import { imposeInfo, imposeLayout, imposePdf, type Box, type ImposeJob } from '@/api/tools';
import { useToast } from '@/app/ToastProvider';
import { PageHead } from '@/components/ui';
import { FileDrop } from '@/features/tools/FileDrop';

import { PagePicker } from './PagePicker';
import { MM, openPdf, renderPage, type RenderedPage } from './pdf';
import { SheetPreview } from './SheetPreview';

const SHEETS = {
  SRA3: [320, 450],
  A3: [297, 420],
  A4: [210, 297],
} as const;
type SheetName = keyof typeof SHEETS | 'custom';

const round2 = (v: number) => Math.round(v * 100) / 100;

/** Вылет, заложенный в файле: наименьшее расстояние от TrimBox до BleedBox, мм. */
function fileBleed(trim: Box | null, bleed: Box | null): number {
  if (!trim || !bleed) return 0;
  const d = Math.min(trim[0] - bleed[0], trim[1] - bleed[1], bleed[2] - trim[2], bleed[3] - trim[3]);
  return Math.max(0, Math.round((d / MM) * 10) / 10);
}

export function ImposePage() {
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [pageIndex, setPageIndex] = useState(1);
  const [backPage, setBackPage] = useState<number | null>(null);
  const [flip, setFlip] = useState<'long' | 'short'>('long');
  const [trim, setTrim] = useState<Box | null>(null);
  const [image, setImage] = useState<RenderedPage | null>(null);
  const [sheet, setSheet] = useState<SheetName>('SRA3');
  const [custom, setCustom] = useState({ w: 320, h: 450 });
  const [params, setParams] = useState({ bleed: 2, margin: 5, gap: 0, rotate: true, marks: true, mark_offset: 2.5, mark_length: 3 });
  const [busy, setBusy] = useState(false);

  const info = useQuery({
    queryKey: ['impose-info', file?.name, file?.size, file?.lastModified],
    queryFn: () => imposeInfo(file!),
    enabled: Boolean(file),
    retry: false,
  });
  const page = info.data?.pages[pageIndex - 1];

  // новая страница — её обрезной формат и заложенный в файле вылет
  useEffect(() => {
    if (!page) return;
    setTrim(page.trim ?? page.media);
    setParams((p) => ({ ...p, bleed: fileBleed(page.trim, page.bleed) }));
  }, [page]);

  // картинка страницы — в браузере, pdf.js
  useEffect(() => {
    if (!file || !page) return undefined;
    let alive = true;
    void (async () => {
      const doc = await openPdf(file);
      const rendered = await renderPage(doc, page.index);
      if (alive) setImage(rendered);
      void doc.destroy();
    })().catch(() => toast('Страница не отрисовалась — но раскладка всё равно соберётся'));
    return () => {
      alive = false;
    };
  }, [file, page, toast]);

  const [sheetW, sheetH] = sheet === 'custom' ? [custom.w, custom.h] : SHEETS[sheet];
  const job: ImposeJob | null = useMemo(() => {
    if (!trim || !page) return null;
    let w = round2(Math.abs(trim[2] - trim[0]) / MM);
    let h = round2(Math.abs(trim[3] - trim[1]) / MM);
    if (page.rotate % 180 === 90) [w, h] = [h, w];
    return { item_w: w, item_h: h, sheet_w: sheetW, sheet_h: sheetH, ...params };
  }, [trim, page, sheetW, sheetH, params]);

  const layout = useQuery({
    queryKey: ['impose-layout', job],
    queryFn: () => imposeLayout(job!),
    enabled: Boolean(job),
    retry: false,
    placeholderData: (prev) => prev,
  });

  const download = async () => {
    if (!file || !trim) return;
    setBusy(true);
    try {
      const { blob, count } = await imposePdf(file, {
        ...params, sheet_w: sheetW, sheet_h: sheetH, page: pageIndex, back_page: backPage, flip, trim,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${file.name.replace(/\.pdf$/i, '')}-${sheet === 'custom' ? `${sheetW}x${sheetH}` : sheet}-${count}шт.pdf`;
      document.body.append(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const num = (key: keyof typeof params) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setParams({ ...params, [key]: Number(e.target.value) });

  return (
    <main className="page scroll-page">
      <div className="page-inner impose">
        <PageHead
          eyebrow="Инструменты"
          title="Раскладка под печать"
          sub="PDF-макет на лист с метками реза. Цвета CMYK и плашки остаются как в файле — выгружайте макет из CorelDRAW в PDF. Файл на сервере не сохраняется."
        />
        {!file && <FileDrop accept=".pdf" hint="Перетащите сюда PDF-макет или выберите его" onFile={setFile} />}
        {file && info.isLoading && <div className="mx-empty">Читаю PDF…</div>}
        {file && info.isError && (
          <div className="ip-error">
            {(info.error as Error).message}{' '}
            <button className="btn btn-ghost" type="button" onClick={() => setFile(null)}>Другой файл</button>
          </div>
        )}
        {file && info.data && page && trim && (
          <div className="ip-grid">
            <section className="ip-source">
              <div className="ip-row">
                <b>{file.name}</b>
                <button className="btn btn-ghost" type="button" onClick={() => { setFile(null); setImage(null); }}>
                  Другой файл
                </button>
              </div>
              {info.data.total > 1 && (
                <label className="ip-field">
                  <span>Лицо — страница</span>
                  <select value={pageIndex} onChange={(e) => setPageIndex(Number(e.target.value))}>
                    {info.data.pages.map((p) => <option key={p.index} value={p.index}>{p.index}</option>)}
                  </select>
                </label>
              )}
              {image ? <PagePicker page={page} image={image} trim={trim} onTrim={setTrim} /> : <div className="mx-empty">Рисую страницу…</div>}
              <p className="hint">
                Формат: {job?.item_w} × {job?.item_h} мм.{' '}
                {params.bleed === 0 && fileBleed(page.trim, page.bleed) === 0 && (
                  <span className="ip-warn">В файле нет вылетов — при резке по краю может остаться белая полоска.</span>
                )}
              </p>
            </section>

            <section className="ip-params">
              <label className="ip-field">
                <span>Лист</span>
                <select value={sheet} onChange={(e) => setSheet(e.target.value as SheetName)}>
                  <option value="SRA3">SRA3 · 320 × 450</option>
                  <option value="A3">A3 · 297 × 420</option>
                  <option value="A4">A4 · 210 × 297</option>
                  <option value="custom">Свой размер</option>
                </select>
              </label>
              {sheet === 'custom' && (
                <div className="ip-pair">
                  <input type="number" min={10} value={custom.w} onChange={(e) => setCustom({ ...custom, w: Number(e.target.value) })} />
                  <span>×</span>
                  <input type="number" min={10} value={custom.h} onChange={(e) => setCustom({ ...custom, h: Number(e.target.value) })} />
                </div>
              )}
              <label className="ip-field"><span>Непечатное поле, мм</span><input type="number" min={0} step={0.5} value={params.margin} onChange={num('margin')} /></label>
              <label className="ip-field"><span>Вылет, мм</span><input type="number" min={0} step={0.5} value={params.bleed} onChange={num('bleed')} /></label>
              <label className="ip-field">
                <span>Рез</span>
                <select value={params.gap === 0 ? 'butt' : 'gap'} onChange={(e) => setParams({ ...params, gap: e.target.value === 'butt' ? 0 : Math.max(4, params.bleed * 2) })}>
                  <option value="butt">Встык — один рез между изделиями</option>
                  <option value="gap">С зазором — вылет у каждого</option>
                </select>
              </label>
              {params.gap > 0 && <label className="ip-field"><span>Зазор, мм</span><input type="number" min={0} step={0.5} value={params.gap} onChange={num('gap')} /></label>}
              <label className="ip-check"><input type="checkbox" checked={params.rotate} onChange={(e) => setParams({ ...params, rotate: e.target.checked })} /> Можно поворачивать</label>
              <label className="ip-check"><input type="checkbox" checked={params.marks} onChange={(e) => setParams({ ...params, marks: e.target.checked })} /> Метки реза</label>
              {info.data.total > 1 && (
                <>
                  <label className="ip-field">
                    <span>Оборот — страница</span>
                    <select value={backPage ?? ''} onChange={(e) => setBackPage(e.target.value ? Number(e.target.value) : null)}>
                      <option value="">Без оборота</option>
                      {info.data.pages.map((p) => <option key={p.index} value={p.index}>{p.index}</option>)}
                    </select>
                  </label>
                  {backPage && (
                    <label className="ip-field">
                      <span>Переворот листа</span>
                      <select value={flip} onChange={(e) => setFlip(e.target.value as 'long' | 'short')}>
                        <option value="long">По длинной стороне</option>
                        <option value="short">По короткой стороне</option>
                      </select>
                    </label>
                  )}
                </>
              )}
            </section>

            <section className="ip-result">
              {layout.isError && <div className="ip-error">{(layout.error as Error).message}</div>}
              {layout.data && image && (
                <>
                  <div className="ip-count"><b>{layout.data.count}</b> шт. на листе · резов {layout.data.cuts.length}</div>
                  <SheetPreview layout={layout.data} image={image} trim={trim} itemW={job?.item_w ?? 0} />
                  <button className="btn btn-green" type="button" disabled={busy} onClick={() => void download()}>
                    {busy ? 'Собираю PDF…' : 'Скачать PDF'}
                  </button>
                </>
              )}
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
```

- [ ] **Step 8: Стили** — в конец `static/css/app.css`

```css
/* ---------- раскладка под печать ---------- */
.impose.page-inner {
  max-width: 1400px;
}
.ip-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) 280px minmax(0, 1.3fr);
  gap: 22px;
  align-items: start;
}
.ip-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}
.ip-picker svg,
.ip-sheet {
  width: 100%;
  height: auto;
  display: block;
  border: 1px solid var(--line-strong);
  border-radius: 10px;
  background: var(--inset-bg);
}
.ip-picker svg {
  cursor: crosshair;
  touch-action: none;
}
.ip-trim {
  fill: none;
  stroke: var(--green);
  stroke-width: 2;
  stroke-dasharray: 8 5;
  vector-effect: non-scaling-stroke;
}
.ip-bleed {
  fill: none;
  stroke: var(--muted);
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}
.ip-drag {
  fill: rgba(60, 199, 7, 0.12);
  stroke: var(--green);
  stroke-width: 1.5;
  vector-effect: non-scaling-stroke;
}
.ip-picker-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-top: 10px;
}
.ip-params {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.ip-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: 13px;
  color: var(--muted);
}
.ip-field input,
.ip-field select,
.ip-pair input {
  background: var(--inset-bg);
  border: 1px solid var(--line-strong);
  border-radius: 9px;
  padding: 8px 10px;
  color: var(--text);
  font: inherit;
}
.ip-pair {
  display: flex;
  align-items: center;
  gap: 8px;
}
.ip-pair input {
  width: 100%;
}
.ip-check {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
}
.ip-paper {
  fill: #fff;
}
.ip-cut {
  stroke: rgba(229, 72, 77, 0.55);
  stroke-width: 0.3;
  stroke-dasharray: 2 1.5;
}
.ip-mark {
  stroke: #000;
  stroke-width: 0.25;
}
.ip-count {
  margin-bottom: 10px;
  color: var(--muted);
}
.ip-count b {
  font-size: 26px;
  color: var(--text);
}
.ip-result .btn {
  margin-top: 14px;
}
.ip-error {
  color: var(--red);
  margin: 10px 0;
}
.ip-warn {
  color: var(--amber, #d9a400);
}
@media (max-width: 1100px) {
  .ip-grid {
    grid-template-columns: 1fr;
  }
}
```

(Перед записью проверить, есть ли в `:root` переменная `--amber`; нет — оставить запасное значение как написано.)

- [ ] **Step 9: Типы и сборка**

Run: `cd poster-ocr/web && npx tsc -b --noEmit && npm run build`
Expected: без ошибок; в выводе сборки — отдельный кусок с pdf.js и файл `pdf.worker.min-*.mjs`; основной `index-*.js` вырос не больше чем на ~10 КБ.

- [ ] **Step 10: Проверка в браузере (временная база, сервер и vite)**

Тестовый PDF — собрать скриптом из `tests/pdf_helpers.make_pdf` во временную папку: (а) визитка 94×54 с TrimBox и двумя страницами (лицо/оборот), (б) A4 без TrimBox, (в) страница с `/Rotate 90`.
1. Файл (а): страница видна, пунктир обрезного формата, превью SRA3 — 24 шт., линии реза и метки; «Скачать PDF» → файл `…-SRA3-24шт.pdf`; открыть в Edge — совпадает с превью.
2. Оборот = стр. 2, переворот по длинной стороне — в PDF 2 страницы, оборот зеркален.
3. Своя рамка мышью — формат меняется, число пересчитывается.
4. Файл (б): формат по странице, предупреждение «нет вылетов».
5. Файл (в): копии стоят прямо, как на экране.
6. `.cdr` в поле PDF — «Нужен файл .pdf»; битый PDF с расширением .pdf — понятная ошибка сервера, «Другой файл» работает.
7. Лист A4 для A3-макета — «не помещается».
8. Консоль браузера — без ошибок CSP и pdf.js; в сети — worker `.mjs` отдан с типом JavaScript.
9. Ширина 1440 и 900 px, светлая и тёмная тема.

- [ ] **Step 11: Коммит**

```bash
git add web/package.json web/package-lock.json web/src static/css/app.css static/dist
git commit -m "Инструменты 16.5: раскладка PDF — выбор формата, превью листа, скачивание"
```

---

### Task 8: Документы, сверка с планом, итоговая проверка

**Files:**
- Modify: `poster-ocr/TODO.md` (раздел 16), `poster-ocr/API.md`, `deploy/README.md` (зависимости образа — если упоминаются)

- [ ] **Step 1: TODO.md, раздел 16** — 16.1 и 16.5 отметить СДЕЛАНО с датой, что проверено и что нет (цвет в Acrobat и пробная резка — у владельца); записать решения владельца от 24.09: .cdr — только просмотр, раскладка только из PDF, выход только PDF (SVG без CMYK непригоден), доступ у всех сотрудников.
- [ ] **Step 2: API.md** — раздел «Инструменты»: четыре ручки, права, пределы, что файлы не хранятся; пример `curl` для `/api/tools/impose/pdf` с `-F file=@макет.pdf -F params=...`.
- [ ] **Step 3: Итоговая проверка** — из `poster-ocr/`: pytest, ruff, mypy, `cd web && npx tsc -b --noEmit && npm run build`; `git status` — изменены только задуманные файлы; `static/dist` пересобран.
- [ ] **Step 4: Коммит**

```bash
git add TODO.md API.md
git commit -m "Инструменты: 16.1 и 16.5 в TODO и API.md"
```

---

## Самопроверка плана (выполнена при написании)

- **Покрытие спецификации:** общее §16 (не хранить, семафор, предел, права, плитки, lazy) — Task 1–3, 7; 16.1 — Task 2–3; 16.5: вход PDF, выбор объекта рамкой, параметры (лист, поля, вылеты, зазор/встык, поворот, оборот с переворотом), гильотина, метки, выход PDF — Task 4–7; проверка свойствами и примерами — Task 4. Не входит по решению владельца: вход .cdr/SVG в раскладку, выход SVG, подпись на поле листа (в спецификации «по желанию» — не делаем без запроса).
- **Заглушки:** нет «TBD» и «доделать при реализации»; единственная оговорка — сверка сигнатуры `page.render` с установленной pdfjs-dist (Task 7, Step 4) с указанием, где смотреть.
- **Согласованность имён:** `SheetRequest`/`SheetIn`/`SheetParams` — одинаковые поля (`page, back_page, flip, trim, bleed, sheet_w, sheet_h, margin, gap, rotate, marks, mark_offset, mark_length`); `Job`/`LayoutIn`/`ImposeJob` — одинаковые поля; `clip` везде — (слева, сверху, справа, снизу).
- **Review Focus:** пять случаев — каждому назначен тест в своей задаче.
