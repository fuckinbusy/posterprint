"""API-ключи сотрудников и защита всех ручек API.

Ключ — пропуск для ботов и программ: запрос с заголовком X-API-Key работает
от имени сотрудника и с его правами. Здесь проверяется:

- как ключ хранится (в базе нет ключа открытым текстом);
- что по ключу пускает, а по чужому, старому или ключу отключённого — нет;
- что увидеть и перевыпустить ключ может только администратор;
- и главное — обход ВСЕХ ручек: без ключа закрыто всё, кроме короткого
  списка открытых, с ключом без прав — всё, кроме справочных. Новая ручка,
  которую забыли защитить, уронит этот тест.

База — SQLite в памяти. Запросы идут прямо в приложение по ASGI, без сети
и без запуска сервера (lifespan не выполняется): ни файлов, ни портов.
"""

from __future__ import annotations

import asyncio
import json as jsonlib
import re
from dataclasses import dataclass, field

import conftest  # noqa: F401 — добавляет корень проекта в sys.path
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core import security
from app.core.database import Base, get_db
from app.core.permissions import ALL_KEYS
from app.main import app
from app.models import Employee
from app.services import api_keys

# Ручки, открытые без входа, — и почему.
OPEN = {
    ("GET", "/"),                     # страница интерфейса
    ("GET", "/health"),               # проверка живости для Docker
    ("GET", "/api/auth/profiles"),    # имена для экрана входа
    ("POST", "/api/auth/admin"),      # сам вход
    ("POST", "/api/auth/employee"),   # сам вход
    ("GET", "/api/auth/me"),          # «кто я»: гостю отвечает «гость»
}

# Ручки, которым хватает входа без особых прав: справочники и «кто я».
LOGIN_ONLY = {
    ("GET", "/api/auth/me"),
    ("GET", "/api/auth/permissions"),
    ("GET", "/api/catalog"),
}

# Только администратору из .env — ни одно право сотрудника сюда не пускает.
ADMIN_ONLY = {
    ("GET", "/api/employees/{employee_id}/api-key"),
    ("POST", "/api/employees/{employee_id}/api-key"),
}


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
    руками — два десятка строк.
    """

    def request(self, method: str, path: str, headers: dict[str, str] | None = None, json=None) -> Reply:
        body = b"" if json is None else jsonlib.dumps(json).encode()
        raw_headers = [(b"host", b"testserver")]
        if json is not None:
            raw_headers.append((b"content-type", b"application/json"))
        raw_headers += [(k.lower().encode(), v.encode()) for k, v in (headers or {}).items()]
        scope = {
            "type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1",
            "method": method, "scheme": "http", "path": path, "raw_path": path.encode(),
            "root_path": "", "query_string": b"", "headers": raw_headers,
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


@pytest.fixture
def db():
    # StaticPool: одна база в памяти на все потоки, в которых FastAPI зовёт зависимости
    engine = create_engine(
        "sqlite://", future=True, connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine, expire_on_commit=False)()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def client(db):
    app.dependency_overrides[get_db] = lambda: db
    security._failures.clear()  # счётчик неудач живёт в памяти процесса
    try:
        yield AsgiClient()
    finally:
        app.dependency_overrides.clear()
        security._failures.clear()


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


def all_routes() -> list[tuple[str, str]]:
    """(метод, путь) каждой ручки приложения — по описанию OpenAPI.

    Описание строится и тогда, когда /openapi.json наружу выключен
    (POSTER_PUBLIC): app.openapi() от этого не зависит.
    """
    routes = [
        (method.upper(), path)
        for path, item in app.openapi()["paths"].items()
        for method in item
        if method in {"get", "post", "put", "patch", "delete"}
    ]
    # пустой список означал бы, что обход ничего не проверил, а не что всё хорошо
    assert len(routes) > 80, f"ручек найдено подозрительно мало: {len(routes)}"
    return routes


def concrete(path: str) -> str:
    return re.sub(r"\{[^}]+\}", "1", path)


# ---------------------------------------------------------------- хранение
def test_ключ_выглядит_как_ключ_и_длинный():
    key = api_keys.generate()
    assert key.startswith("pst_")
    assert len(key) >= 40
    assert api_keys.generate() != key


def test_в_базе_нет_ключа_открытым_текстом(db):
    employee, key = staff(db, "Анна", [])
    stored = f"{employee.api_key_hash} {employee.api_key_enc}"
    assert key not in stored
    assert employee.api_key_hash == api_keys.fingerprint(key)
    # администратор видит ключ — он расшифровывается из базы
    assert api_keys.reveal(employee) == key


def test_по_ключу_находится_его_сотрудник(db):
    anna, anna_key = staff(db, "Анна", [])
    boris, boris_key = staff(db, "Борис", [])
    assert api_keys.find_employee(db, anna_key) is anna
    assert api_keys.find_employee(db, boris_key) is boris
    assert api_keys.find_employee(db, "pst_" + "x" * 43) is None
    assert api_keys.find_employee(db, "") is None
    assert api_keys.find_employee(db, None) is None


def test_перевыпуск_отменяет_старый_ключ(db):
    anna, old = staff(db, "Анна", [])
    new = api_keys.issue(anna)
    db.commit()
    assert new != old
    assert api_keys.find_employee(db, old) is None
    assert api_keys.find_employee(db, new) is anna


def test_ключи_выдаются_тем_у_кого_их_нет(db):
    old = Employee(name="Старый профиль", permissions=[])
    db.add(old)
    _, key = staff(db, "Новый", [])
    db.commit()

    assert api_keys.issue_missing(db) == 1
    assert old.api_key_hash and api_keys.reveal(old).startswith("pst_")
    assert api_keys.find_employee(db, key) is not None  # чужой ключ не тронут
    assert api_keys.issue_missing(db) == 0


# ---------------------------------------------------------------- вход по ключу
def test_ключ_пускает_с_правами_сотрудника(client, db):
    _, key = staff(db, "Бот", ["orders.view"])
    me = client.get("/api/auth/me", headers={"X-API-Key": key}).json()
    assert (me["kind"], me["name"], me["permissions"]) == ("employee", "Бот", ["orders.view"])

    assert client.get("/api/orders", headers={"X-API-Key": key}).status_code == 200
    assert client.get("/api/clients", headers={"X-API-Key": key}).status_code == 403


def test_ключ_можно_передать_как_bearer(client, db):
    _, key = staff(db, "Бот", ["orders.view"])
    assert client.get("/api/orders", headers={"Authorization": f"Bearer {key}"}).status_code == 200


def test_ключ_работает_и_у_профиля_с_привязкой_к_компьютерам(client, db):
    # привязка — для входа из браузера; у бота нет ключа устройства
    _, key = staff(db, "Бот", ["orders.view"], access_mode="devices", allowed_devices=[42])
    assert client.get("/api/orders", headers={"X-API-Key": key}).status_code == 200


def test_чужой_и_старый_ключ_не_пускают(client, db):
    anna, old = staff(db, "Анна", ["orders.view"])
    api_keys.issue(anna)
    db.commit()
    assert client.get("/api/orders", headers={"X-API-Key": old}).status_code == 401
    assert client.get("/api/orders", headers={"X-API-Key": "pst_выдуманный"}).status_code == 401


def test_ключ_отключённого_сотрудника_не_пускает(client, db):
    _, key = staff(db, "Уволен", ["orders.view"], active=False)
    assert client.get("/api/orders", headers={"X-API-Key": key}).status_code == 401


def test_перебор_ключей_упирается_в_лимит(client, db):
    codes = [
        client.get("/api/orders", headers={"X-API-Key": f"pst_guess{i}"}).status_code
        for i in range(security.IP_FAIL_LIMIT + 1)
    ]
    assert codes[0] == 401
    assert codes[-1] == 429


def test_перебор_с_адреса_не_блокирует_верный_ключ_с_того_же_адреса(client, db):
    """Офис за NAT приходит с одного адреса: чужой перебор (или бот с
    опечаткой в ключе) не должен останавливать рабочих ботов с верным
    ключом. Подбирающему это ничего не даёт — у него ключи неверные."""
    _, key = staff(db, "Бот", ["orders.view"])
    for i in range(security.IP_FAIL_LIMIT + 1):
        client.get("/api/orders", headers={"X-API-Key": f"pst_guess{i}"})
    assert client.get("/api/orders", headers={"X-API-Key": "pst_guess-ещё"}).status_code == 429
    assert client.get("/api/orders", headers={"X-API-Key": key}).status_code == 200


def test_макет_по_ключу_скачивается_без_одноразовой_ссылки(client, db):
    _, key = staff(db, "Бот", ["design.view"])
    _, weak = staff(db, "Без прав", [])
    url = "/api/orders/1/design/file"
    assert client.get(url).status_code == 401
    assert client.get(url, headers={"X-API-Key": weak}).status_code == 403
    # заказа нет — но до этого ответа пускают только с правом
    assert client.get(url, headers={"X-API-Key": key}).status_code == 404


# ---------------------------------------------------------------- ключ в профиле
def test_администратор_видит_ключ_сотрудника(client, db):
    anna, key = staff(db, "Анна", [])
    response = client.get(f"/api/employees/{anna.id}/api-key", headers=admin_headers())
    assert response.status_code == 200
    assert response.json()["api_key"] == key
    assert "no-store" in response.headers.get("cache-control", "")


def test_администратор_перевыпускает_ключ(client, db):
    anna, old = staff(db, "Анна", ["orders.view"])
    response = client.post(f"/api/employees/{anna.id}/api-key", headers=admin_headers())
    assert response.status_code == 200
    new = response.json()["api_key"]
    assert new != old
    assert client.get("/api/orders", headers={"X-API-Key": old}).status_code == 401
    assert client.get("/api/orders", headers={"X-API-Key": new}).status_code == 200


def test_управляющий_сотрудниками_ключей_не_видит(client, db):
    anna, _ = staff(db, "Анна", [])
    _, manager = staff(db, "Старший", ["staff.manage"])
    headers = {"X-API-Key": manager}
    assert client.get(f"/api/employees/{anna.id}/api-key", headers=headers).status_code == 403
    assert client.post(f"/api/employees/{anna.id}/api-key", headers=headers).status_code == 403
    # а список сотрудников ему по-прежнему доступен — и ключей в нём нет
    listing = client.get("/api/employees", headers=headers)
    assert listing.status_code == 200
    assert "pst_" not in listing.text


def test_новый_сотрудник_сразу_получает_ключ(client, db):
    created = client.post("/api/employees", json={"name": "Новичок"}, headers=admin_headers()).json()
    key = client.get(f"/api/employees/{created['id']}/api-key", headers=admin_headers()).json()["api_key"]
    assert key.startswith("pst_")
    assert client.get("/api/auth/me", headers={"X-API-Key": key}).json()["name"] == "Новичок"


# ---------------------------------------------------------------- все ручки
def test_без_входа_закрыто_всё_кроме_открытых(client):
    leaks = []
    for method, path in all_routes():
        if (method, path) in OPEN:
            continue
        status = client.request(method, concrete(path)).status_code
        if status != 401:
            leaks.append(f"{method} {path} → {status}")
    assert not leaks, "Ручки открыты без входа:\n" + "\n".join(leaks)


def test_с_ключом_без_прав_закрыто_всё_кроме_справочников(client, db):
    _, key = staff(db, "Бот без прав", [])
    leaks = []
    for method, path in all_routes():
        if (method, path) in OPEN | LOGIN_ONLY:
            continue
        status = client.request(method, concrete(path), headers={"X-API-Key": key}).status_code
        if status != 403:
            leaks.append(f"{method} {path} → {status}")
    assert not leaks, "Ручки пускают без права:\n" + "\n".join(leaks)


def test_с_ключом_и_всеми_правами_чтение_открыто_везде(client, db):
    """Ключ со всеми правами читает любую ручку: ни одного 401/403 на GET.

    Выполняем по-настоящему только чтение — база пустая и в памяти, так что
    ответы — пустые списки или «не найдено». Ручки записи не зовём: одна
    снимает бэкап настоящей базы на диск. Их защищает тот же механизм прав,
    что проверен обходом выше (без прав — 403 на каждой).
    """
    _, key = staff(db, "Бот со всем", sorted(ALL_KEYS))
    reads = [(m, p) for m, p in all_routes() if m == "GET" and (m, p) not in OPEN | ADMIN_ONLY]
    assert len(reads) > 40, f"ручек чтения найдено подозрительно мало: {len(reads)}"
    blocked = []
    for method, path in reads:
        status = client.request(method, concrete(path), headers={"X-API-Key": key}).status_code
        if status in (401, 403):
            blocked.append(f"{method} {path} → {status}")
    assert not blocked, "С полным набором прав ключ не пускают:\n" + "\n".join(blocked)
