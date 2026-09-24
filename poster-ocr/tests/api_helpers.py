"""Общее для тестов API: запросы прямо в приложение, база в памяти, профили.

База — SQLite в памяти. Запросы идут в приложение по ASGI, без сети и без
запуска сервера (lifespan не выполняется): ни файлов, ни портов. Фикстуры
`db` (база в памяти) и `client` (этот клиент поверх неё) — в conftest.py,
они доступны любому тесту без импорта.
"""

from __future__ import annotations

import asyncio
import json as jsonlib
from dataclasses import dataclass, field

import conftest  # noqa: F401 — добавляет корень проекта в sys.path

from app.core import security
from app.main import app
from app.models import Employee
from app.services import api_keys


@dataclass
class Reply:
    status_code: int
    headers: dict[str, str] = field(default_factory=dict)
    text: str = ""

    def json(self):
        return jsonlib.loads(self.text)


class AsgiClient:
    """Запрос прямо в приложение по протоколу ASGI.

    TestClient из Starlette 1.x требует отдельный пакет httpx2; здесь он не
    нужен: ASGI — это один вызов app(scope, receive, send), и собрать его
    руками — два десятка строк. Строка запроса («?status=ready») берётся из
    пути — как в адресной строке.
    """

    def request(self, method: str, path: str, headers: dict[str, str] | None = None, json=None) -> Reply:
        path, _, query = path.partition("?")
        body = b"" if json is None else jsonlib.dumps(json).encode()
        raw_headers = [(b"host", b"testserver")]
        if json is not None:
            raw_headers.append((b"content-type", b"application/json"))
        raw_headers += [(k.lower().encode(), v.encode()) for k, v in (headers or {}).items()]
        scope = {
            "type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1",
            "method": method, "scheme": "http", "path": path, "raw_path": path.encode(),
            "root_path": "", "query_string": query.encode(), "headers": raw_headers,
            "client": ("203.0.113.7", 50000), "server": ("testserver", 80),
        }
        reply = Reply(0)
        chunks: list[bytes] = []
        sent = False

        async def receive():
            nonlocal sent
            if sent:
                return {"type": "http.disconnect"}
            sent = True
            return {"type": "http.request", "body": body, "more_body": False}

        async def send(message):
            if message["type"] == "http.response.start":
                reply.status_code = message["status"]
                reply.headers = {k.decode().lower(): v.decode() for k, v in message["headers"]}
            elif message["type"] == "http.response.body":
                chunks.append(message.get("body", b""))

        asyncio.run(app(scope, receive, send))
        reply.text = b"".join(chunks).decode("utf-8", "replace")
        return reply

    def get(self, path: str, headers: dict[str, str] | None = None) -> Reply:
        return self.request("GET", path, headers)

    def post(self, path: str, headers: dict[str, str] | None = None, json=None) -> Reply:
        return self.request("POST", path, headers, json)

    def patch(self, path: str, headers: dict[str, str] | None = None, json=None) -> Reply:
        return self.request("PATCH", path, headers, json)


def staff(db, name: str, perms: list[str], *, active: bool = True, **extra) -> tuple[Employee, str]:
    """Сотрудник с ключом. Возвращает профиль и ключ."""
    employee = Employee(name=name, permissions=perms, active=active, **extra)
    db.add(employee)
    key = api_keys.issue(employee)
    db.commit()
    return employee, key


def admin_headers() -> dict[str, str]:
    token, _ = security.make_token("admin")
    return {"Authorization": f"Bearer {token}"}
