"""Раскладка изделий на печатный лист под гильотинную резку.

Все размеры — в миллиметрах, начало координат — левый верхний угол листа.

Что считается
-------------
Изделие — обрезной формат (w×h) плюс вылеты. Лист — размер и непечатное
поле по краям (захват машины). Между изделиями — зазор: 0 значит «рез
встык» (соседние копии делят линию реза, вылеты у них остаются только
снаружи блока), зазор ≥ 2 вылетов — у каждой копии вылет со всех сторон и
по два реза между соседями. Промежуточный зазор тоже допустим: вылет внутри
блока тогда урезается до половины зазора.

Метки реза стоят на полях снаружи раскладки, поэтому место под них
вычитается из печатного поля: от обрезного края до внешнего конца метки —
отступ плюс длина. Метка не должна попасть на вылет — отступ не меньше
вылета.

Какие раскладки перебираются
----------------------------
Только гильотинные: каждый рез проходит через весь лист или через весь
блок, иначе на ручном резаке не порезать. Кандидаты — сетка в одной
ориентации, сетка в другой (если поворот разрешён) и два блока: основная
сетка плюс полоса из повёрнутых изделий в остатке — сбоку или снизу. Из
кандидатов берётся тот, где больше изделий; при равенстве — где меньше
резов. Готовая раскладка ставится по центру листа.
"""

from __future__ import annotations

from dataclasses import dataclass, field

EPS = 1e-6
# больше копий на листе не бывает на деле: это почти всегда случайная рамка в
# пару миллиметров, а перебор и развод вылетов растут с квадратом числа копий
MAX_COPIES = 1000

# копия-черновик: (x, y, w, h, повёрнута)
Item = tuple[float, float, float, float, bool]


class ImposeError(ValueError):
    """Параметры, при которых раскладка невозможна, — с понятной причиной."""


@dataclass(frozen=True)
class Job:
    item_w: float
    item_h: float
    bleed: float = 2.0
    sheet_w: float = 320.0
    sheet_h: float = 450.0
    margin: float = 5.0
    gap: float = 0.0
    rotate: bool = True
    marks: bool = True
    mark_offset: float = 2.5
    mark_length: float = 3.0


@dataclass(frozen=True)
class Placement:
    """Копия на листе: левый верхний угол обрезного формата и поворот на 90°
    по часовой. clip — сколько вылета оставить с каждой стороны (слева,
    сверху, справа, снизу) у копии в том виде, как она лежит на листе."""

    x: float
    y: float
    w: float
    h: float
    rotated: bool
    clip: tuple[float, float, float, float]


@dataclass(frozen=True)
class Cut:
    """Линия реза: axis "x" — вертикальная (x = pos), "y" — горизонтальная.
    start..end — её протяжённость по другой оси."""

    axis: str
    pos: float
    start: float
    end: float


@dataclass(frozen=True)
class Mark:
    x1: float
    y1: float
    x2: float
    y2: float


@dataclass(frozen=True)
class Layout:
    job: Job
    placements: tuple[Placement, ...]
    cuts: tuple[Cut, ...]
    marks: tuple[Mark, ...] = field(default=())

    @property
    def count(self) -> int:
        return len(self.placements)


def check(job: Job) -> None:
    if job.item_w <= 0 or job.item_h <= 0:
        raise ImposeError("Размер изделия должен быть больше нуля")
    if job.sheet_w <= 0 or job.sheet_h <= 0:
        raise ImposeError("Размер листа должен быть больше нуля")
    for name, value in (("вылет", job.bleed), ("поле", job.margin), ("зазор", job.gap),
                        ("отступ метки", job.mark_offset), ("длина метки", job.mark_length)):
        if value < 0:
            raise ImposeError(f"Отрицательный {name}")
    if job.marks and job.mark_offset + EPS < job.bleed:
        raise ImposeError("Отступ меток меньше вылета — метки напечатаются на вылетах")
    # верхняя оценка числа копий — по площади с зазором; считается до перебора,
    # чтобы крошечное изделие не успело занять сервер
    r = reserve(job)
    avail_w = job.sheet_w - 2 * job.margin - 2 * r
    avail_h = job.sheet_h - 2 * job.margin - 2 * r
    if avail_w > 0 and avail_h > 0:
        bound = (avail_w + job.gap) * (avail_h + job.gap) / ((job.item_w + job.gap) * (job.item_h + job.gap))
        if bound > MAX_COPIES:
            raise ImposeError(
                f"Изделие слишком мелкое: на лист встало бы больше {MAX_COPIES} шт. — проверьте выбранную область"
            )


def reserve(job: Job) -> float:
    """Сколько места нужно снаружи обрезного края крайних копий."""
    return max(job.bleed, job.mark_offset + job.mark_length) if job.marks else job.bleed


def fits(length: float, size: float, gap: float) -> int:
    """Сколько изделий размера size встанет на длину length с зазором gap."""
    if length + EPS < size:
        return 0
    return int((length + gap + EPS) // (size + gap))


def span(n: int, size: float, gap: float) -> float:
    return n * size + max(n - 1, 0) * gap if n else 0.0


def _grid(x0: float, y0: float, cols: int, rows: int, w: float, h: float, gap: float, rotated: bool) -> list[Item]:
    return [(x0 + c * (w + gap), y0 + r * (h + gap), w, h, rotated) for r in range(rows) for c in range(cols)]


def _candidates(job: Job):
    """Все гильотинные варианты: списки копий от точки (0, 0)."""
    r = reserve(job)
    avail_w = job.sheet_w - 2 * job.margin - 2 * r
    avail_h = job.sheet_h - 2 * job.margin - 2 * r
    if avail_w <= 0 or avail_h <= 0:
        return
    g = job.gap
    a = (job.item_w, job.item_h, False)
    b = (job.item_h, job.item_w, True)
    orients = [a, b] if job.rotate and abs(job.item_w - job.item_h) > EPS else [a]
    for w, h, rot in orients:
        cols, rows = fits(avail_w, w, g), fits(avail_h, h, g)
        if cols and rows:
            yield _grid(0, 0, cols, rows, w, h, g, rot)
    if len(orients) < 2:
        return
    for (w1, h1, r1), (w2, h2, r2) in ((a, b), (b, a)):
        # полоса сбоку: основная сетка на n1 колонок, остаток ширины — другая ориентация
        rows1 = fits(avail_h, h1, g)
        for n1 in range(1, fits(avail_w, w1, g) + 1):
            used = span(n1, w1, g) + g
            cols2, rows2 = fits(avail_w - used, w2, g), fits(avail_h, h2, g)
            if rows1 and cols2 and rows2:
                yield _grid(0, 0, n1, rows1, w1, h1, g, r1) + _grid(used, 0, cols2, rows2, w2, h2, g, r2)
        # полоса снизу
        cols1 = fits(avail_w, w1, g)
        for n1 in range(1, fits(avail_h, h1, g) + 1):
            used = span(n1, h1, g) + g
            cols2, rows2 = fits(avail_w, w2, g), fits(avail_h - used, h2, g)
            if cols1 and cols2 and rows2:
                yield _grid(0, 0, cols1, n1, w1, h1, g, r1) + _grid(0, used, cols2, rows2, w2, h2, g, r2)


def _cuts(items: list[Item]) -> list[Cut]:
    """Линии реза: каждый обрезной край каждой копии; совпадающие у соседей —
    один рез. Протяжённость — по копиям, которые этот рез режет."""
    lines: dict[tuple[str, float], list[float]] = {}
    for x, y, w, h, _ in items:
        for axis, pos, lo, hi in (("x", x, y, y + h), ("x", x + w, y, y + h),
                                  ("y", y, x, x + w), ("y", y + h, x, x + w)):
            seg = lines.setdefault((axis, round(pos, 4)), [lo, hi])
            seg[0], seg[1] = min(seg[0], lo), max(seg[1], hi)
    return [Cut(axis, pos, lo, hi) for (axis, pos), (lo, hi) in sorted(lines.items())]


def _clips(items: list[Item], job: Job) -> list[list[float]]:
    """Вылет каждой копии с каждой стороны (слева, сверху, справа, снизу).

    Снаружи — полный. Если вылеты двух копий заходят друг на друга (соседи
    встык, узкий зазор, угол к углу у двух блоков с разным шагом рядов), обе
    копии урезаются до половины расстояния между ними — по той оси, по
    которой они разнесены дальше. Урезание только уменьшает вылеты, поэтому
    уже разведённые пары снова не сойдутся."""
    clips = [[job.bleed] * 4 for _ in items]

    def rect(i: int) -> tuple[float, float, float, float]:
        x, y, w, h, _ = items[i]
        c = clips[i]
        return x - c[0], y - c[1], x + w + c[2], y + h + c[3]

    for i in range(len(items)):
        for j in range(i + 1, len(items)):
            a, b = rect(i), rect(j)
            if not (a[0] < b[2] - EPS and b[0] < a[2] - EPS and a[1] < b[3] - EPS and b[1] < a[3] - EPS):
                continue
            xi, yi, wi, hi, _ = items[i]
            xj, yj, wj, hj, _ = items[j]
            sx = max(xj - (xi + wi), xi - (xj + wj))
            sy = max(yj - (yi + hi), yi - (yj + hj))
            if sx >= sy:
                ci, cj = (2, 0) if xj >= xi + wi - EPS else (0, 2)  # j справа от i — или слева
                half = max(sx, 0.0) / 2
            else:
                ci, cj = (3, 1) if yj >= yi + hi - EPS else (1, 3)  # j ниже i — или выше
                half = max(sy, 0.0) / 2
            clips[i][ci] = min(clips[i][ci], half)
            clips[j][cj] = min(clips[j][cj], half)
    return clips


def _marks(cuts: list[Cut], box: tuple[float, float, float, float], job: Job) -> list[Mark]:
    """Метки на концах линий реза — только там, где конец выходит на внешнюю
    границу раскладки: внутри (между блоками) метка легла бы на соседние копии."""
    if not job.marks:
        return []
    left, top, right, bottom = box
    off, length = job.mark_offset, job.mark_length
    out: list[Mark] = []
    for c in cuts:
        if c.axis == "x":
            if abs(c.start - top) < EPS:
                out.append(Mark(c.pos, top - off - length, c.pos, top - off))
            if abs(c.end - bottom) < EPS:
                out.append(Mark(c.pos, bottom + off, c.pos, bottom + off + length))
        else:
            if abs(c.start - left) < EPS:
                out.append(Mark(left - off - length, c.pos, left - off, c.pos))
            if abs(c.end - right) < EPS:
                out.append(Mark(right + off, c.pos, right + off + length, c.pos))
    return out


def impose(job: Job) -> Layout:
    """Лучшая гильотинная раскладка. Ни одна не встала — ImposeError."""
    check(job)
    best: tuple[tuple[int, int], list[Item]] | None = None
    for items in _candidates(job):
        key = (len(items), -len(_cuts(items)))
        if best is None or key > best[0]:
            best = (key, items)
    if best is None:
        raise ImposeError("Изделие не помещается на лист с такими полями и вылетами")
    items = best[1]
    # по центру листа
    min_x = min(i[0] for i in items)
    max_x = max(i[0] + i[2] for i in items)
    min_y = min(i[1] for i in items)
    max_y = max(i[1] + i[3] for i in items)
    dx = (job.sheet_w - (max_x - min_x)) / 2 - min_x
    dy = (job.sheet_h - (max_y - min_y)) / 2 - min_y
    items = [(x + dx, y + dy, w, h, rot) for x, y, w, h, rot in items]
    cuts = _cuts(items)
    box = (min_x + dx, min_y + dy, max_x + dx, max_y + dy)
    placements = tuple(
        Placement(round(x, 4), round(y, 4), w, h, rot, (round(c[0], 4), round(c[1], 4), round(c[2], 4), round(c[3], 4)))
        for (x, y, w, h, rot), c in zip(items, _clips(items, job), strict=True)
    )
    return Layout(job, placements, tuple(cuts), tuple(_marks(cuts, box, job)))
