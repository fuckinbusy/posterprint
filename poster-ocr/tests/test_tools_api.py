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
