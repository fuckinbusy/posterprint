"""Режим «сервер в интернете» (app/core/deploy.py) и ежедневная копия
(app/services/autobackup.py): проверки перед стартом, заголовки, лимит тела,
расписание. Всё — чистые функции, базы не нужно."""

from datetime import datetime

import pytest

from app.core import deploy
from app.services import autobackup

GOOD = {
    "POSTER_ADMIN_PASSWORD": "длинный-и-непростой-пароль",
    "POSTER_SECRET_KEY": "x" * 48,
    "POSTER_ALLOWED_HOSTS": "poster.example.ru",
}


def test_готовый_к_выходу_наружу_набор_проходит():
    assert deploy.check(GOOD) == []


@pytest.mark.parametrize(
    "broken, word",
    [
        ({"POSTER_ADMIN_PASSWORD": ""}, "ADMIN_PASSWORD"),
        ({"POSTER_ADMIN_PASSWORD": "admin"}, "ADMIN_PASSWORD"),
        ({"POSTER_ADMIN_PASSWORD": "Admin"}, "ADMIN_PASSWORD"),
        ({"POSTER_ADMIN_PASSWORD": "короткий"}, "короче"),
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


def test_прежний_интерфейс_без_политики():
    """/legacy собран без оглядки на CSP — на него политика не ставится,
    остальные заголовки остаются."""
    headers = deploy.security_headers("/legacy", "https")
    assert "Content-Security-Policy" not in headers
    assert headers["X-Content-Type-Options"] == "nosniff"


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
