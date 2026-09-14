"""Подготовка к реальному запуску: хэш пароля администратора, шифрование
секретов, скрипт set_password, права на файлы, обратная связь."""

import os
import stat

import pytest

from app.core import crypto, deploy, permissions, security
from app.schemas.feedback import FeedbackIn, FeedbackUpdate
from app.services import feedback as feedback_logic
from scripts.set_password import rewrite_env


# ---------------------------------------------------------------- пароль администратора
def test_пароль_проверяется_по_хэшу(monkeypatch):
    digest = security.hash_password("очень-длинный-пароль-администратора")
    monkeypatch.setattr(security, "ADMIN_PASSWORD_HASH", digest)
    assert security.check_password("очень-длинный-пароль-администратора")
    assert not security.check_password("очень-длинный-пароль-администратор")
    assert not security.check_password("")


def test_без_хэша_работает_открытый_текст(monkeypatch):
    monkeypatch.setattr(security, "ADMIN_PASSWORD_HASH", "")
    monkeypatch.setattr(security, "ADMIN_PASSWORD", "пароль")
    assert security.check_password("пароль") and not security.check_password("другой")


def test_set_password_заменяет_открытый_пароль_на_хэш():
    text = "POSTER_SHOP_NAME=ПОСТЕР\nPOSTER_ADMIN_PASSWORD=секрет\nPOSTER_LOG_LEVEL=INFO\n"
    out = rewrite_env(text, "pbkdf2$s$d")
    assert "POSTER_ADMIN_PASSWORD=" not in out.replace("POSTER_ADMIN_PASSWORD_HASH", "")
    assert "POSTER_ADMIN_PASSWORD_HASH=pbkdf2$s$d\n" in out
    # на том же месте, остальное не тронуто
    assert out.splitlines()[1] == "POSTER_ADMIN_PASSWORD_HASH=pbkdf2$s$d"
    assert out.startswith("POSTER_SHOP_NAME=ПОСТЕР\n") and out.endswith("POSTER_LOG_LEVEL=INFO\n")


def test_set_password_дописывает_если_строки_не_было():
    out = rewrite_env("POSTER_SHOP_NAME=X\n", "pbkdf2$s$d")
    assert out.endswith("POSTER_ADMIN_PASSWORD_HASH=pbkdf2$s$d\n")
    assert out.count("POSTER_ADMIN_PASSWORD_HASH=") == 1


def test_set_password_не_плодит_хэши_при_повторе():
    out = rewrite_env("POSTER_ADMIN_PASSWORD_HASH=старый\nPOSTER_ADMIN_PASSWORD=x\n", "новый")
    assert out == "POSTER_ADMIN_PASSWORD_HASH=новый\n"


# ---------------------------------------------------------------- шифрование секретов
def test_секрет_шифруется_и_читается_обратно():
    token = crypto.encrypt("пароль-приложения")
    assert token.startswith("enc:") and "пароль" not in token
    assert crypto.decrypt(token) == "пароль-приложения"
    assert crypto.is_encrypted(token)


def test_открытый_текст_старых_записей_читается_как_есть():
    assert crypto.decrypt("старый-пароль") == "старый-пароль"
    assert not crypto.is_encrypted("старый-пароль")
    assert crypto.encrypt("") == "" and crypto.decrypt("") == ""


def test_чужой_шифр_не_роняет_а_даёт_пустоту():
    assert crypto.decrypt("enc:не-токен") == ""


# ---------------------------------------------------------------- права на файлы
@pytest.mark.skipif(os.name != "posix", reason="права POSIX")
def test_файл_доступный_всем_попадает_в_список(tmp_path):
    env = tmp_path / ".env"
    env.write_text("x")
    env.chmod(0o644)
    problems = deploy.file_permission_problems(tmp_path)
    assert len(problems) == 1 and ".env" in problems[0] and "600" in problems[0]
    env.chmod(stat.S_IRUSR | stat.S_IWUSR)
    assert deploy.file_permission_problems(tmp_path) == []


def test_на_windows_проверка_прав_молчит(monkeypatch, tmp_path):
    monkeypatch.setattr(os, "name", "nt")
    (tmp_path / ".env").write_text("x")
    assert deploy.file_permission_problems(tmp_path) == []


# ---------------------------------------------------------------- обратная связь
def test_право_писать_разработчику_есть_у_нового_профиля():
    assert "feedback.send" in permissions.default_permissions()
    assert "feedback.send" in permissions.normalize(["staff.manage"])


def test_схема_не_пропускает_пустое_и_чужой_вид():
    with pytest.raises(ValueError):
        FeedbackIn(kind="bug", title="ок", text="коротко")
    with pytest.raises(ValueError):
        FeedbackIn(kind="жалоба", title="заголовок", text="достаточно длинный текст")  # type: ignore[arg-type]
    ok = FeedbackIn(kind="idea", title="заголовок", text="достаточно длинный текст")
    assert ok.page == ""
    with pytest.raises(ValueError):
        FeedbackUpdate(status="new", author="x")  # type: ignore[call-arg]


def test_текст_уведомления_содержит_суть():
    from datetime import datetime, timezone

    from app.models import Feedback

    item = Feedback(id=7, kind="bug", title="Не сохраняется срок", text="Нажал сохранить — срок пустой",
                    page="/board", author="Аня", user_agent="Chrome", created_at=datetime(2026, 9, 14, 8, 0, tzinfo=timezone.utc))
    text = feedback_logic.render(item)
    assert "Ошибка: Не сохраняется срок" in text
    assert "Аня" in text and "/board" in text and "№7" in text


def test_каналы_доставки_из_окружения(monkeypatch):
    monkeypatch.delenv("POSTER_FEEDBACK_EMAIL", raising=False)
    monkeypatch.delenv("POSTER_FEEDBACK_WEBHOOK", raising=False)
    assert feedback_logic.targets() == {"email": "", "webhook": ""}
    monkeypatch.setenv("POSTER_FEEDBACK_EMAIL", " dev@example.ru ")
    assert feedback_logic.targets()["email"] == "dev@example.ru"
