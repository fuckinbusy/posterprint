"""Шрифты: каталог Google Fonts, поиск, ручка /api/tools/fonts."""

from __future__ import annotations

from api_helpers import staff

from app.services import fonts_catalog


def test_каталог_в_репозитории_полный():
    families = fonts_catalog.load()
    assert len(families) > 1000
    assert sum(1 for f in families if "cyrillic" in f["subsets"]) > 200
    montserrat = fonts_catalog.family("montserrat")   # без учёта регистра
    assert montserrat and montserrat["family"] == "Montserrat"
    assert "700" in montserrat["variants"] and "cyrillic" in montserrat["subsets"]


def test_поиск_и_фильтр_кириллицы():
    hits = fonts_catalog.search("montserrat")
    assert hits and hits[0]["family"] == "Montserrat"
    # по умолчанию — только с кириллицей; без фильтра — шире
    only_cyr = fonts_catalog.search("", cyrillic=True, limit=5000)
    everything = fonts_catalog.search("", cyrillic=False, limit=5000)
    assert all("cyrillic" in f["subsets"] for f in only_cyr)
    assert len(everything) > len(only_cyr)
    # категория
    mono = fonts_catalog.search("", cyrillic=False, category="Monospace", limit=5000)
    assert mono and all(f["category"] == "Monospace" for f in mono)
    # предел выдачи
    assert len(fonts_catalog.search("", cyrillic=False, limit=10)) == 10


def test_системные_шрифты_узнаются():
    assert fonts_catalog.is_system("Arial") and fonts_catalog.is_system("times new roman")
    assert not fonts_catalog.is_system("Montserrat")


def test_ручка_каталога(db, client):
    _, key = staff(db, "Дизайнер", ["tools.fonts"])
    reply = client.get("/api/tools/fonts?q=roboto", headers={"X-API-Key": key})
    assert reply.status_code == 200
    data = reply.json()
    assert data["families"][0]["family"].startswith("Roboto")
    assert data["total"] >= len(data["families"])
    assert client.get("/api/tools/fonts?q=roboto").status_code == 401
    _, other = staff(db, "Кассир", ["orders.view"])
    assert client.get("/api/tools/fonts?q=roboto", headers={"X-API-Key": other}).status_code == 403


# ---------------------------------------------------------------- скачивание

import io
import zipfile

import pytest

from app.services import fonts_download

CSS_SAMPLE = """/* latin */
@font-face {
  font-family: 'Montserrat';
  font-style: italic;
  font-weight: 400;
  src: url(https://fonts.gstatic.com/s/montserrat/v31/AAA.ttf) format('truetype');
}
@font-face {
  font-family: 'Montserrat';
  font-style: normal;
  font-weight: 400;
  src: url(https://fonts.gstatic.com/s/montserrat/v31/BBB.ttf) format('truetype');
}
@font-face {
  font-family: 'Montserrat';
  font-style: normal;
  font-weight: 700;
  src: url(https://fonts.gstatic.com/s/montserrat/v31/CCC.ttf) format('truetype');
}
"""


def test_запрос_css2_и_разбор_ссылок():
    assert fonts_download.css_query(["400", "700", "400i"]) == "ital,wght@0,400;0,700;1,400"
    urls = fonts_download.ttf_urls(CSS_SAMPLE)
    assert urls == {"400i": "https://fonts.gstatic.com/s/montserrat/v31/AAA.ttf",
                    "400": "https://fonts.gstatic.com/s/montserrat/v31/BBB.ttf",
                    "700": "https://fonts.gstatic.com/s/montserrat/v31/CCC.ttf"}
    assert fonts_download.style_name("700i") == "BoldItalic" and fonts_download.style_name("400") == "Regular"


@pytest.fixture
def fake_net(monkeypatch, tmp_path):
    calls = []

    def download(url: str) -> bytes:
        calls.append(url)
        if "css2" in url:
            return CSS_SAMPLE.encode("utf-8")
        return b"\x00\x01\x00\x00TTF:" + url.encode()

    monkeypatch.setattr(fonts_download, "_download", download)
    monkeypatch.setattr(fonts_download, "CACHE_DIR", tmp_path / "fonts_cache")
    return calls


def test_скачивание_семейства_и_кэш(fake_net):
    files = fonts_download.fetch_family("Montserrat", ["400", "700"])
    assert [name for name, _ in files] == ["Montserrat-Regular.ttf", "Montserrat-Bold.ttf"]
    assert files[0][1].startswith(b"\x00\x01\x00\x00TTF:")
    assert len(fake_net) == 3           # css + два файла
    fonts_download.fetch_family("Montserrat", ["400", "700"])
    assert len(fake_net) == 3           # второй раз — из кэша, в сеть не ходили
    fonts_download.fetch_family("Montserrat", ["400", "400i"])
    assert len(fake_net) == 5           # css + только недостающий курсив


def test_zip_с_установщиком(fake_net):
    payload = fonts_download.build_zip("Montserrat", ["400", "700"])
    with zipfile.ZipFile(io.BytesIO(payload)) as z:
        names = z.namelist()
        assert "Montserrat/Montserrat-Regular.ttf" in names and "Montserrat/Montserrat-Bold.ttf" in names
        assert "Montserrat/установить.cmd" in names and "Montserrat/ЛИЦЕНЗИЯ.txt" in names
        cmd = z.read("Montserrat/установить.cmd").decode("utf-8")
        assert "LOCALAPPDATA" in cmd and "reg add" in cmd and "Montserrat-Bold.ttf" in cmd


def test_ошибки_скачивания(fake_net, monkeypatch):
    with pytest.raises(fonts_download.FontsError, match="начертани"):
        fonts_download.fetch_family("Montserrat", ["950"])          # такого веса у семейства нет
    with pytest.raises(fonts_download.FontsError, match="каталоге"):
        fonts_download.fetch_family("Нет Такого Шрифта", ["400"])
    monkeypatch.setattr(fonts_download, "_download", lambda url: (_ for _ in ()).throw(OSError("timeout")))
    with pytest.raises(fonts_download.FontsError, match="Google"):
        fonts_download.fetch_family("Roboto", ["400"])


def test_ручка_скачивания(db, client, fake_net, monkeypatch):
    _, key = staff(db, "Дизайнер", ["tools.fonts"])
    reply = client.get("/api/tools/fonts/download?family=Montserrat&styles=400,700", headers={"X-API-Key": key})
    assert reply.status_code == 200, reply.text
    assert reply.headers["content-type"] == "application/zip"
    assert "Montserrat" in reply.headers["content-disposition"]
    assert client.get("/api/tools/fonts/download?family=Nope&styles=400", headers={"X-API-Key": key}).status_code == 404
    assert client.get("/api/tools/fonts/download?family=Montserrat&styles=950", headers={"X-API-Key": key}).status_code == 422
    monkeypatch.setattr(fonts_download, "_download", lambda url: (_ for _ in ()).throw(OSError("timeout")))
    gone = client.get("/api/tools/fonts/download?family=Roboto&styles=400", headers={"X-API-Key": key})
    assert gone.status_code == 502 and "Google" in gone.json()["detail"]
