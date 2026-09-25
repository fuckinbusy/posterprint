"""Инструменты: права, приём файлов, ручки /api/tools.

Файлы инструментов не хранятся — это проверяется отдельно для каждой ручки:
временная папка удалена и после ответа, и после ошибки.
"""

from __future__ import annotations

import json as jsonlib
import os
import tempfile

import pytest
from api_helpers import staff
from pdf_helpers import MM, make_pdf

from app.core.permissions import PERMISSIONS_BY_KEY, default_permissions
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
    monkeypatch.setattr(tool_files, "MAX_VIEW_BYTES", 10)
    big = client.post("/api/tools/design-scene", headers={"X-API-Key": key},
                      files={"file": ("a.cdr", b"x" * 11, "application/octet-stream")})
    assert big.status_code == 422
    assert "МБ" in big.json()["detail"]
    assert _left(tmp_root) == []


def test_предел_просмотра_как_у_макета_заказа():
    # сотрудник смотрит те же файлы, что грузят к заказу: предел один — иначе
    # макет, который система принимает в заказ, в просмотр не влезает
    from app.services import designs

    assert tool_files.MAX_VIEW_BYTES == designs.MAX_UPLOAD_BYTES == 300 * 1024 * 1024
    assert tool_files.MAX_PDF_BYTES == 100 * 1024 * 1024


def test_просмотр_без_права_нельзя(db, client):
    _, key = staff(db, "Кассир", ["orders.view"])
    reply = client.post("/api/tools/design-scene", headers={"X-API-Key": key},
                        files={"file": ("a.cdr", b"xx", "application/octet-stream")})
    assert reply.status_code == 403


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


def test_третий_файл_ждет_не_блокируя_сервер(db, client, tmp_root, monkeypatch):
    """Два места заняты, третий файл ждёт в очереди — а сервер тем временем
    отвечает всем остальным. Ожидание места не должно держать цикл событий:
    у сервера он один на всех, и заблокированный цикл — это зависшая CRM."""
    import asyncio
    import itertools
    import threading
    import time

    monkeypatch.setattr(tool_files, "_slots", threading.BoundedSemaphore(2))
    monkeypatch.setattr(tool_files, "WAIT_SECONDS", 3)

    def slow_scene(path, cache=None):
        time.sleep(0.5)
        return dict(SCENE)

    monkeypatch.setattr(cdr_scene, "scene", slow_scene)
    monkeypatch.setattr(cdr, "extract_preview", lambda path: (None, "нет эскиза"))
    _, key = staff(db, "Приёмщик", ["tools.viewer"])
    beats: list[float] = []

    async def heartbeat():
        start = time.monotonic()
        while time.monotonic() - start < 1.6:
            beats.append(time.monotonic())
            await asyncio.sleep(0.05)

    async def main():
        files = {"file": ("a.cdr", b"xx", "application/octet-stream")}
        uploads = [client.apost("/api/tools/design-scene", headers={"X-API-Key": key}, files=files) for _ in range(3)]
        return await asyncio.gather(*uploads, heartbeat())

    replies = asyncio.run(main())
    assert [r.status_code for r in replies[:3]] == [200, 200, 200]
    gaps = [b - a for a, b in itertools.pairwise(beats)]
    assert max(gaps) < 0.3, f"цикл событий стоял {max(gaps):.2f} с"


# ---------------------------------------------------------------- доступность, курсы, права новых утилит

def test_права_шрифтов_и_калькулятора_есть_и_раздаются_старым_профилям(db):
    from app.models import Employee
    from app.services import perm_rollout

    for key in ("tools.fonts", "tools.calc"):
        assert key in PERMISSIONS_BY_KEY and key in default_permissions()
        assert key in perm_rollout.FOR_EVERYONE
    old = Employee(name="Старый", permissions=["orders.view"])
    db.add(old)
    db.commit()
    perm_rollout.grant_new(db)
    db.refresh(old)
    assert "tools.fonts" in old.permissions and "tools.calc" in old.permissions


def test_доступность_инструментов(db, client, monkeypatch):
    # просмотр .cdr зависит от разборщика на сервере; остальное работает всегда
    monkeypatch.setattr(cdr_scene, "tools", lambda: {"libcdr": "", "inkscape": "", "can_view": False, "can_pdf": False})
    _, key = staff(db, "Приёмщик", ["tools.viewer"])
    reply = client.get("/api/tools", headers={"X-API-Key": key})
    assert reply.status_code == 200
    tools = reply.json()["tools"]
    assert tools["viewer"]["available"] is False and "libcdr" in tools["viewer"]["reason"]
    assert tools["impose"]["available"] and tools["fonts"]["available"] and tools["calc"]["available"]
    assert client.get("/api/tools").status_code == 401


SAMPLE_CBR = {
    "Date": "2026-09-25T11:30:00+03:00",
    "Valute": {
        "USD": {"Nominal": 1, "Value": 84.9057, "Name": "Доллар США"},
        "EUR": {"Nominal": 1, "Value": 96.8859, "Name": "Евро"},
        "CNY": {"Nominal": 1, "Value": 12.65, "Name": "Юань"},
        "JPY": {"Nominal": 100, "Value": 55.5, "Name": "Иен"},
    },
}


def test_курсы_цб_с_кэшем_и_без_сети(db, client, tmp_path, monkeypatch):
    from app.services import rates

    monkeypatch.setattr(rates, "CACHE_FILE", tmp_path / "rates.json")
    calls = []

    def fake_download():
        calls.append(1)
        return SAMPLE_CBR

    monkeypatch.setattr(rates, "_download", fake_download)
    _, key = staff(db, "Приёмщик", ["tools.calc"])
    first = client.get("/api/tools/rates", headers={"X-API-Key": key})
    assert first.status_code == 200, first.text
    data = first.json()
    assert data["date"] == "2026-09-25" and data["stale"] is False
    assert data["rates"]["USD"]["value"] == 84.9057 and data["rates"]["JPY"]["value"] == 0.555  # за 1 единицу
    # второй запрос — из кэша, в сеть не ходим
    client.get("/api/tools/rates", headers={"X-API-Key": key})
    assert len(calls) == 1
    # сеть пропала, кэш устарел — отдаём кэш с пометкой stale
    monkeypatch.setattr(rates, "_download", lambda: (_ for _ in ()).throw(OSError("нет сети")))
    monkeypatch.setattr(rates, "TTL_SECONDS", 0)
    stale = client.get("/api/tools/rates", headers={"X-API-Key": key}).json()
    assert stale["stale"] is True and stale["rates"]["USD"]["value"] == 84.9057
    # ни сети, ни кэша — понятный отказ
    (tmp_path / "rates.json").unlink()
    gone = client.get("/api/tools/rates", headers={"X-API-Key": key})
    assert gone.status_code == 503 and "ЦБ" in gone.json()["detail"]
