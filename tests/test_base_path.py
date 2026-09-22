"""Система под своим путём на домене (POSTER_BASE_PATH): нормализация и подстановка в страницу."""

from __future__ import annotations

import conftest  # noqa: F401 — добавляет корень проекта в sys.path
import pytest

from app.core import deploy

PAGE = """<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8" />
<link href="/static/fonts/fonts.css?v=2" rel="stylesheet">
<script>
  try { localStorage.getItem('poster.theme'); } catch (e) {}
</script>
  <script type="module" crossorigin src="/static/dist/assets/index-abc.js"></script>
  <link rel="stylesheet" crossorigin href="/static/dist/assets/index-abc.css">
</head>
<body></body></html>"""


@pytest.mark.parametrize(
    ("raw", "expected"),
    [(None, ""), ("", ""), ("/", ""), ("poster-crm", "/poster-crm"), ("/poster-crm/", "/poster-crm"),
     ("  /crm/v2  ", "/crm/v2")],
)
def test_путь_нормализуется(raw, expected):
    assert deploy.base_path(raw) == expected


@pytest.mark.parametrize("raw", ["/с пробелом", "/кириллица", "/a?b", "/x//y", "/<script>"])
def test_мусор_в_пути_отклоняется(raw):
    with pytest.raises(ValueError, match="POSTER_BASE_PATH"):
        deploy.base_path(raw)


def test_страница_получает_префикс_и_метку():
    html = deploy.inject_base(PAGE, "/poster-crm")
    assert '<meta name="poster-base" content="/poster-crm" />' in html
    assert 'href="/poster-crm/static/fonts/fonts.css?v=2"' in html
    assert 'src="/poster-crm/static/dist/assets/index-abc.js"' in html
    assert 'href="/poster-crm/static/dist/assets/index-abc.css"' in html
    assert "/static/" not in html.replace("/poster-crm/static/", "")
    # встроенный скрипт темы не изменился — его хэш в CSP остаётся верным
    assert "try { localStorage.getItem('poster.theme'); } catch (e) {}" in html


def test_без_префикса_страница_прежняя_плюс_пустая_метка():
    html = deploy.inject_base(PAGE, "")
    assert '<meta name="poster-base" content="" />' in html
    assert 'href="/static/fonts/fonts.css?v=2"' in html
    assert html.count("/static/") == PAGE.count("/static/")
