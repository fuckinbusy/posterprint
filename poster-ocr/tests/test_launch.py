"""Подготовка к реальному запуску: хэш пароля администратора, шифрование
секретов, скрипт set_password, права на файлы."""

import os
import stat

import pytest

from app.core import crypto, deploy, security
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
    assert "POSTER_ADMIN_PASSWORD_HASH='pbkdf2$s$d'\n" in out
    # на том же месте, остальное не тронуто
    assert out.splitlines()[1] == "POSTER_ADMIN_PASSWORD_HASH='pbkdf2$s$d'"
    assert out.startswith("POSTER_SHOP_NAME=ПОСТЕР\n") and out.endswith("POSTER_LOG_LEVEL=INFO\n")


def test_set_password_дописывает_если_строки_не_было():
    out = rewrite_env("POSTER_SHOP_NAME=X\n", "pbkdf2$s$d")
    assert out.endswith("POSTER_ADMIN_PASSWORD_HASH='pbkdf2$s$d'\n")
    assert out.count("POSTER_ADMIN_PASSWORD_HASH=") == 1


def test_set_password_не_плодит_хэши_при_повторе():
    out = rewrite_env("POSTER_ADMIN_PASSWORD_HASH=старый\nPOSTER_ADMIN_PASSWORD=x\n", "новый")
    assert out == "POSTER_ADMIN_PASSWORD_HASH='новый'\n"


def test_хэш_в_кавычках_читается_обратно_без_потерь():
    """В хэше есть «$»: Docker Compose в env_file подставил бы на место
    «$abc…» пустую переменную, и сервер не стартовал бы с «не похож на хэш».
    В одинарных кавычках значение берётся буквально — и Compose, и
    python-dotenv, которым .env читает сервер без Docker."""
    import io

    from dotenv import dotenv_values

    digest = "pbkdf2$ab12cd$ef34"  # буквы сразу после «$» — худший случай
    out = rewrite_env("", digest)
    assert dotenv_values(stream=io.StringIO(out))["POSTER_ADMIN_PASSWORD_HASH"] == digest


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


def test_относительные_папки_данных_считаются_от_проекта(monkeypatch, tmp_path):
    """POSTER_LOG_DIR=./logs при запуске из корня монорепозитория заводил
    папку logs там, а не в poster-ocr/."""
    from app.core import paths

    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("POSTER_LOG_DIR", "./logs   # пояснение")
    assert paths.data_dir("POSTER_LOG_DIR", "logs") == (paths.BASE_DIR / "logs").resolve()
    monkeypatch.delenv("POSTER_LOG_DIR")
    assert paths.data_dir("POSTER_LOG_DIR", "logs") == paths.BASE_DIR / "logs"
    absolute = tmp_path / "elsewhere"
    monkeypatch.setenv("POSTER_LOG_DIR", str(absolute))
    assert paths.data_dir("POSTER_LOG_DIR", "logs") == absolute


def test_пароль_администратора_проверяется_до_хэша():
    from scripts.set_password import password_problem

    assert password_problem("короткий")
    assert password_problem("admin")
    assert password_problem("Admin")
    assert password_problem("длинный-пароль-цеха") == ""
