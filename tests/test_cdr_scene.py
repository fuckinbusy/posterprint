"""Сцена макета CorelDRAW: версия файла, чистка SVG, размеры в миллиметрах.

Внешний разборщик (libcdr, Inkscape) здесь не запускается — проверяется то,
что делаем мы сами: из его ответа получается безопасная разметка с
пронумерованными объектами и правильными размерами страниц.
"""

from __future__ import annotations

import io
import zipfile

import conftest  # noqa: F401 — добавляет корень проекта в sys.path
import pytest

from app.services import cdr_scene

# так отвечает cdr2xhtml: страницы — svg с префиксом внутри XHTML, размеры в дюймах,
# координаты в пунктах
XHTML = """<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:svg="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
<body>
<svg:svg version="1.1" width="8.2677in" height="11.6929in" viewBox="0 0 595.2756 841.8898">
<svg:defs><svg:linearGradient id="grad1"><svg:stop offset="0" stop-color="#fff"/></svg:linearGradient>
<svg:clipPath id="clip1"><svg:path d="M0,0 L10,10"/></svg:clipPath></svg:defs>
<svg:g id="Layer1000">
<svg:path d="M0,0 L100,0 L100,50 Z" style="fill: url(#grad1); stroke: #224b87" onclick="alert(1)"/>
<svg:path d="M1,1 L2,2" style="fill: url(http://evil.example/x.svg#a)"/>
<svg:text x="22" y="112"><svg:tspan font-family="Gogol" font-size="22">
Ярослава</svg:tspan><svg:tspan font-family="Gogol" font-size="22">
 </svg:tspan><svg:tspan font-family="Arial" font-size="22">
и</svg:tspan></svg:text>
<svg:image x="0" y="0" width="10" height="10" xlink:href="data:image/png;base64,iVBORw0KGgo="/>
<svg:image x="0" y="0" width="10" height="10" xlink:href="http://evil.example/track.png"/>
<svg:script>alert(1)</svg:script>
<svg:foreignObject><body xmlns="http://www.w3.org/1999/xhtml"><img src="x" onerror="alert(1)"/></body></svg:foreignObject>
</svg:g>
</svg:svg>
<svg:svg version="1.1" width="1in" height="2in" viewBox="0 0 72 144"><svg:rect x="0" y="0" width="72" height="144"/></svg:svg>
</body></html>""".encode()


def test_страницы_и_размеры_в_миллиметрах():
    scene = cdr_scene.build_scene(XHTML, "libcdr")
    first, second = scene["pages"]
    assert (first["width_mm"], first["height_mm"]) == (210.0, 297.0)
    assert (second["width_mm"], second["height_mm"]) == (25.4, 50.8)
    assert first["view_box"] == [0.0, 0.0, 595.2756, 841.8898]
    # единица координат — пункт: 72 пункта = 25,4 мм
    assert first["mm_per_unit"] == pytest.approx(25.4 / 72, rel=1e-4)


def test_объекты_пронумерованы_а_служебные_не_считаются():
    scene = cdr_scene.build_scene(XHTML, "libcdr")
    svg = scene["pages"][0]["svg"]
    # два контура, текст и вшитая картинка; контур внутри clipPath объектом не считается
    assert scene["pages"][0]["objects"] == 4
    assert svg.count("data-o=") == 4
    assert scene["stats"] == {"objects": 5, "curves": 3, "texts": 1, "images": 1}


def test_опасное_вычищается():
    svg = cdr_scene.build_scene(XHTML, "libcdr")["pages"][0]["svg"]
    for bad in ("script", "onclick", "onerror", "foreignObject", "evil.example", "alert"):
        assert bad not in svg
    assert "data:image/png;base64" in svg          # вшитая картинка остаётся


def test_ссылки_на_градиент_переживают_перенумерацию():
    svg = cdr_scene.build_scene(XHTML, "libcdr")["pages"][0]["svg"]
    assert 'id="grad1"' not in svg
    import re

    ref = re.search(r"url\(#(cdr1_\d+)\)", svg)
    assert ref and f'id="{ref.group(1)}"' in svg


def test_текст_сохраняет_пробелы_и_шрифты_собраны():
    scene = cdr_scene.build_scene(XHTML, "libcdr")
    svg = scene["pages"][0]["svg"]
    assert scene["fonts"] == ["Arial", "Gogol"]
    assert 'space="preserve"' in svg
    assert ">Ярослава<" in svg and "> <" in svg    # перенос разметки убран, пробел-слово цел
    assert any("кривые" in w for w in scene["warnings"])


def test_одиночный_svg_от_inkscape_тоже_читается():
    raw = b'<svg xmlns="http://www.w3.org/2000/svg" width="10mm" height="20mm" viewBox="0 0 10 20"><path d="M0,0 L1,1"/></svg>'
    page = cdr_scene.build_scene(raw, "inkscape")["pages"][0]
    assert (page["width_mm"], page["height_mm"]) == (10.0, 20.0)
    assert page["mm_per_unit"] == pytest.approx(1.0)


def test_пустой_и_битый_ответ_дают_понятную_ошибку():
    with pytest.raises(cdr_scene.SceneError, match="страницы"):
        cdr_scene.build_scene(b"<html xmlns='http://www.w3.org/1999/xhtml'><body/></html>", "libcdr")
    with pytest.raises(cdr_scene.SceneError, match="повреждённую"):
        cdr_scene.build_scene(b"<svg", "libcdr")


def test_самостоятельный_svg_в_натуральную_величину():
    page = cdr_scene.build_scene(XHTML, "libcdr")["pages"][0]
    out = cdr_scene.standalone_svg(page).decode()
    assert 'width="210.0mm"' in out and 'height="297.0mm"' in out
    assert "data-o" not in out and out.startswith("<?xml")


# ---------------------------------------------------------------- версия
def _zip_cdr(tmp_path, mark: bytes, name: str = "content/root.dat"):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr(name, b"RIFF\x00\x00\x00\x00CDR" + mark + b"vrsn")
    path = tmp_path / "x.cdr"
    path.write_bytes(buffer.getvalue())
    return path


@pytest.mark.parametrize(
    ("mark", "number", "name"),
    [(b"G", 16, "X6"), (b"N", 23, "2021"), (b"R", 27, "2025"), (b"E", 14, "X4"), (b"9", 9, "9")],
)
def test_версия_из_zip(tmp_path, mark, number, name):
    info = cdr_scene.version(_zip_cdr(tmp_path, mark))
    assert info is not None and info["number"] == number and info["name"] == f"CorelDRAW {name}"


def test_версия_из_старого_riff_и_мусора(tmp_path):
    old = tmp_path / "old.cdr"
    old.write_bytes(b"RIFF\x10\x00\x00\x00CDRDvrsn")
    info = cdr_scene.version(old)
    assert info is not None and info["number"] == 13
    junk = tmp_path / "junk.cdr"
    junk.write_bytes(b"not a corel file at all")
    assert cdr_scene.version(junk) is None


def test_без_разборщика_понятная_подсказка(tmp_path, monkeypatch):
    monkeypatch.setattr(cdr_scene, "find_libcdr", lambda: None)
    monkeypatch.setattr(cdr_scene, "find_inkscape", lambda: None)
    with pytest.raises(cdr_scene.SceneError, match="libcdr-tools"):
        cdr_scene.convert_to_svg(_zip_cdr(tmp_path, b"G"))
    assert cdr_scene.tools() == {"libcdr": "", "inkscape": "", "can_view": False, "can_pdf": False}
