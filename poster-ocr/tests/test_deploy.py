"""Режим «сервер в интернете» (app/core/deploy.py) и ежедневная копия
(app/services/autobackup.py): проверки перед стартом, заголовки, лимит тела,
расписание. Всё — чистые функции, базы не нужно."""

from datetime import datetime

import pytest

from app.core import deploy
from app.services import autobackup

GOOD = {
    "POSTER_ADMIN_PASSWORD_HASH": "pbkdf2$abcdef0123456789$" + "0" * 64,
    "POSTER_SECRET_KEY": "x" * 48,
    "POSTER_ALLOWED_HOSTS": "poster.example.ru",
}


def test_готовый_к_выходу_наружу_набор_проходит():
    assert deploy.check(GOOD) == []


@pytest.mark.parametrize(
    "broken, word",
    [
        ({"POSTER_ADMIN_PASSWORD_HASH": ""}, "set_password"),
        ({"POSTER_ADMIN_PASSWORD_HASH": "", "POSTER_ADMIN_PASSWORD": "admin"}, "«admin»"),
        ({"POSTER_ADMIN_PASSWORD_HASH": "", "POSTER_ADMIN_PASSWORD": "длинный-и-непростой"}, "открытым текстом"),
        ({"POSTER_ADMIN_PASSWORD_HASH": "не-хэш"}, "не похож на хэш"),
        ({"POSTER_SECRET_KEY": ""}, "SECRET_KEY"),
        ({"POSTER_SECRET_KEY": "мало"}, "SECRET_KEY"),
        ({"POSTER_ALLOWED_HOSTS": ""}, "ALLOWED_HOSTS"),
        ({"POSTER_ALLOWED_HOSTS": " , "}, "ALLOWED_HOSTS"),
    ],
)
def test_каждая_дыра_названа_по_имени(broken, word):
    problems = deploy.check({**GOOD, **broken})
    assert len(problems) == 1 and word in problems[0]


def test_несколько_проблем_перечисляются_все():
    problems = deploy.check({})
    assert len(problems) == 3


# ---------------------------------------------------------------- заголовки
def test_заголовки_безопасности_на_обычной_странице():
    headers = deploy.security_headers("/", "http")
    assert headers["X-Content-Type-Options"] == "nosniff"
    assert headers["X-Frame-Options"] == "DENY"
    assert headers["Content-Security-Policy"].startswith("default-src 'self'")
    assert "Strict-Transport-Security" not in headers  # только по https и только в открытом режиме
    assert "Cache-Control" not in headers


def test_файлы_сборки_кэшируются_навсегда_а_страница_нет():
    assert deploy.security_headers("/static/dist/assets/index-abc.js", "https")["Cache-Control"] == deploy.IMMUTABLE
    assert "Cache-Control" not in deploy.security_headers("/static/dist/index.html", "https")


def test_hsts_только_в_открытом_режиме_по_https(monkeypatch):
    monkeypatch.setattr(deploy, "PUBLIC", True)
    assert "Strict-Transport-Security" in deploy.security_headers("/", "https")
    assert "Strict-Transport-Security" not in deploy.security_headers("/", "http")


def test_политика_разрешает_только_своё():
    csp = deploy.content_security_policy()
    assert "object-src 'none'" in csp
    assert "frame-ancestors 'none'" in csp
    assert "connect-src 'self'" in csp
    # письма показываются со своими инлайн-стилями и картинками по https
    assert "style-src 'self' 'unsafe-inline'" in csp
    assert "img-src 'self' data: blob: https:" in csp


def test_встроенный_скрипт_темы_разрешён_хэшем():
    """В index.html один inline-скрипт (тема до загрузки стилей); CSP
    пропускает ровно его — по хэшу, а не через 'unsafe-inline'."""
    hashes = deploy.inline_script_hashes()
    assert len(hashes) == 1 and hashes[0].startswith("'sha256-")
    assert "'unsafe-inline'" not in deploy.content_security_policy().split(";")[1]


# ---------------------------------------------------------------- лимит тела
def test_тело_обычного_запроса_ограничено():
    assert not deploy.body_too_large("/api/orders", str(deploy.MAX_BODY_BYTES))
    assert deploy.body_too_large("/api/orders", str(deploy.MAX_BODY_BYTES + 1))
    assert deploy.body_too_large("/api/settings", "мусор")
    assert not deploy.body_too_large("/api/orders", None)


def test_загрузка_макета_не_режется_общим_лимитом():
    assert not deploy.body_too_large("/api/orders/17/design", str(200 * 1024 * 1024))
    # загрузки инструментов идут мимо общего лимита — у них свой, 100 МБ
    for path in ("/api/tools/design-scene", "/api/tools/impose/info", "/api/tools/impose/pdf"):
        assert not deploy.body_too_large(path, str(90 * 1024 * 1024))
    assert deploy.body_too_large("/api/tools/impose/layout", str(deploy.MAX_BODY_BYTES + 1))
    # но соседние ручки макета — режутся
    assert deploy.body_too_large("/api/orders/17/design/preview", str(10 * 1024 * 1024))


# ---------------------------------------------------------------- расписание копий
@pytest.mark.parametrize("raw, expected", [("03:30", (3, 30)), (" 0:05 ", (0, 5)), ("", None), (None, None),
                                           ("25:00", None), ("3", None), ("aa:bb", None), ("12:60", None)])
def test_время_копии_разбирается_или_выключает(raw, expected):
    assert autobackup.parse_time(raw) == expected


def test_ждём_до_ближайшего_срока_сегодня_или_завтра():
    now = datetime(2026, 9, 9, 10, 0, 0)
    assert autobackup.seconds_until((11, 0), now) == 3600
    assert autobackup.seconds_until((9, 0), now) == 23 * 3600
    assert autobackup.seconds_until((10, 0), now) == 24 * 3600  # ровно сейчас — уже прошло, значит завтра


def test_настройки_из_окружения(monkeypatch):
    monkeypatch.delenv("POSTER_BACKUP_AT", raising=False)
    assert autobackup.from_env() is None
    monkeypatch.setenv("POSTER_BACKUP_AT", "04:00")
    monkeypatch.setenv("POSTER_BACKUP_KEEP", "не число")
    job = autobackup.from_env()
    assert job is not None and job.at == (4, 0) and job.keep == autobackup.DEFAULT_KEEP


# ---------------------------------------------------------------- разрешённые имена (Host)
def test_к_домену_добавляются_локальные_имена_для_проверки_здоровья():
    """Проверка здоровья в контейнере стучится на 127.0.0.1: без него
    строгий режим отвечал ей 400, и Docker считал живую систему больной."""
    hosts = deploy.trusted_hosts("crm.example.ru")
    assert hosts[0] == "crm.example.ru"
    assert {"127.0.0.1", "localhost"} <= set(hosts)
    assert deploy.trusted_hosts("") == []   # не задан — проверки Host нет вовсе, как раньше


def test_проверка_здоровья_проходит_а_чужой_host_нет():
    import asyncio

    from starlette.applications import Starlette
    from starlette.middleware.trustedhost import TrustedHostMiddleware
    from starlette.responses import PlainTextResponse
    from starlette.routing import Route

    inner = Starlette(routes=[Route("/health", lambda request: PlainTextResponse("ok"))])
    app = TrustedHostMiddleware(inner, allowed_hosts=deploy.trusted_hosts("crm.example.ru"))

    def status(host: str) -> int:
        codes: list[int] = []

        async def receive():
            return {"type": "http.request", "body": b"", "more_body": False}

        async def send(message):
            if message["type"] == "http.response.start":
                codes.append(message["status"])

        scope = {"type": "http", "method": "GET", "path": "/health", "raw_path": b"/health",
                 "query_string": b"", "headers": [(b"host", host.encode())], "scheme": "http",
                 "server": ("127.0.0.1", 8000), "client": ("127.0.0.1", 1), "root_path": "",
                 "http_version": "1.1", "asgi": {"version": "3.0"}}
        asyncio.run(app(scope, receive, send))
        return codes[0]

    assert status("127.0.0.1:8000") == 200
    assert status("crm.example.ru") == 200
    assert status("evil.example") == 400
