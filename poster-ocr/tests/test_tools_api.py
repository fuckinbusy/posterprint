"""Инструменты: права, приём файлов, ручки /api/tools.

Файлы инструментов не хранятся — это проверяется отдельно для каждой ручки:
временная папка удалена и после ответа, и после ошибки.
"""

from __future__ import annotations

import os
import tempfile

import pytest
from api_helpers import staff

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
