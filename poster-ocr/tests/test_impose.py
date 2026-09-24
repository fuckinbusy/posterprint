"""Движок раскладки: известные ответы и свойства на переборе.

Ошибка здесь не падает — тихо портит тираж: копия залезла на соседнюю или
под захват машины, рез без метки. Поэтому кроме примеров из жизни — перебор
сотен сочетаний с проверкой свойств, и счётчик: сколько раскладок дошло до
проверки (иначе «0 нарушений» мог бы значить «ничего не проверили»).
"""

from __future__ import annotations

import itertools

import pytest

from app.services.impose import ImposeError, Job, impose

SRA3, A3, A4 = (320, 450), (297, 420), (210, 297)


@pytest.mark.parametrize(
    ("w", "h", "sheet", "gap", "marks", "count"),
    [
        (90, 50, SRA3, 0, True, 24),    # визитки: 3×8, классика
        (90, 50, SRA3, 4, True, 24),    # с зазором — столько же, резов больше
        (90, 50, A3, 0, False, 24),
        (90, 50, A4, 0, True, 10),
        (99, 210, SRA3, 0, True, 6),    # еврофлаер
        (148, 210, SRA3, 0, True, 4),   # A5
        (148, 210, A3, 0, True, 2),
        (105, 148, SRA3, 0, True, 8),   # A6
    ],
)
def test_известные_раскладки(w, h, sheet, gap, marks, count):
    layout = impose(Job(w, h, sheet_w=sheet[0], sheet_h=sheet[1], gap=gap, marks=marks))
    assert layout.count == count


def test_без_меток_поворот_дает_больше():
    # визитки на SRA3 без меток: две полосы — основная сетка плюс повёрнутые
    layout = impose(Job(90, 50, marks=False))
    assert layout.count == 27
    assert any(p.rotated for p in layout.placements)


def test_поворот_запрещен():
    layout = impose(Job(90, 50, marks=False, rotate=False))
    assert not any(p.rotated for p in layout.placements)
    assert layout.count == 24


def test_раскладка_по_центру():
    layout = impose(Job(90, 50))
    left = min(p.x for p in layout.placements)
    right = max(p.x + p.w for p in layout.placements)
    top = min(p.y for p in layout.placements)
    bottom = max(p.y + p.h for p in layout.placements)
    assert left == pytest.approx(320 - right)
    assert top == pytest.approx(450 - bottom)


def test_встык_один_рез_между_соседями_вылеты_только_снаружи():
    layout = impose(Job(90, 50, gap=0))
    xs = sorted({c.pos for c in layout.cuts if c.axis == "x"})
    assert len(xs) == 4  # 3 колонки встык: 4 вертикальных реза
    left = min(p.x for p in layout.placements)
    for p in layout.placements:
        # крайние слева — с полным вылетом, у остальных сосед вплотную: вылета нет
        assert p.clip[0] == (2 if p.x == left else 0)


def test_зазор_полный_вылет_и_два_реза():
    layout = impose(Job(90, 50, gap=4))
    assert all(p.clip == (2, 2, 2, 2) for p in layout.placements)
    xs = sorted({c.pos for c in layout.cuts if c.axis == "x"})
    assert len(xs) == 6


def test_не_помещается():
    with pytest.raises(ImposeError, match="не помещается"):
        impose(Job(297, 420, sheet_w=210, sheet_h=297))


@pytest.mark.parametrize(
    ("job", "text"),
    [
        (Job(0, 50), "больше нуля"),
        (Job(90, 50, bleed=-1), "Отрицательный"),
        (Job(90, 50, bleed=3, mark_offset=2), "вылетах"),
    ],
)
def test_неверные_параметры(job, text):
    with pytest.raises(ImposeError, match=text):
        impose(job)


def _box(p):
    return p.x - p.clip[0], p.y - p.clip[1], p.x + p.w + p.clip[2], p.y + p.h + p.clip[3]


def _cross(a, b):
    return a[0] < b[2] - 1e-6 and b[0] < a[2] - 1e-6 and a[1] < b[3] - 1e-6 and b[1] < a[3] - 1e-6


def test_свойства_на_переборе():
    checked = 0
    for w, h, (sw, sh), gap, marks in itertools.product(
        (30, 50, 55, 90, 99, 105, 148, 210), (20, 50, 54, 85, 148, 297),
        (SRA3, A3, A4), (0, 1, 4, 6), (True, False),
    ):
        job = Job(w, h, sheet_w=sw, sheet_h=sh, gap=gap, marks=marks)
        try:
            layout = impose(job)
        except ImposeError:
            continue
        checked += 1
        boxes = [_box(p) for p in layout.placements]
        for b in boxes:  # копия с вылетами — в печатном поле
            assert b[0] >= job.margin - 1e-6 and b[1] >= job.margin - 1e-6
            assert b[2] <= sw - job.margin + 1e-6 and b[3] <= sh - job.margin + 1e-6
        for a, b in itertools.combinations(boxes, 2):  # копии не залезают друг на друга
            assert not _cross(a, b)
        for m in layout.marks:  # метки — в печатном поле и не на копиях
            for v, lim in ((m.x1, sw), (m.x2, sw), (m.y1, sh), (m.y2, sh)):
                assert job.margin - 1e-6 <= v <= lim - job.margin + 1e-6
            seg = (min(m.x1, m.x2), min(m.y1, m.y2), max(m.x1, m.x2), max(m.y1, m.y2))
            for b in boxes:
                assert not (seg[0] < b[2] - 1e-6 and seg[2] > b[0] + 1e-6 and seg[1] < b[3] - 1e-6 and seg[3] > b[1] + 1e-6)
        if marks:  # у каждого реза есть метка — иначе резчику не по чему резать
            for c in layout.cuts:
                assert any((m.x1 == m.x2 == c.pos) if c.axis == "x" else (m.y1 == m.y2 == c.pos) for m in layout.marks)
        assert layout.count <= (sw - 2 * job.margin) * (sh - 2 * job.margin) // (w * h)
    assert checked > 900  # перебор действительно дошёл до проверок
