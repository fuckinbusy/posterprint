"""Конвертер макетов CorelDRAW в открытые форматы.

Зачем
-----
Клиенты присылают .cdr из свежих версий (2021, 2025), а CorelDRAW X6 —
версия 16 — их не открывает. Сохранить файл обратно в .cdr версии 16 умеет
только сам CorelDRAW: формат закрытый, и ни одна открытая программа его не
пишет. Зато X6 отлично импортирует SVG и PDF — с сохранением кривых,
заливок и размеров один к одному. Этот скрипт делает такие файлы пачкой.

Что нужно
---------
``libcdr-tools`` (sudo apt install libcdr-tools) — для SVG; Inkscape — для SVG
и PDF. На Windows достаточно установить Inkscape.

Примеры
-------
    python -m scripts.cdr_convert макет.cdr                  # → макет.svg рядом
    python -m scripts.cdr_convert папка/ --to pdf            # все .cdr в папке → PDF
    python -m scripts.cdr_convert *.cdr --out готово/ --to svg pdf
    python -m scripts.cdr_convert папка/ --info              # только версии, без конвертации
    python -m scripts.cdr_convert папка/ --newer-than 16     # только те, что X6 не откроет

Ограничения те же, что у просмотра в системе: текст, не переведённый в
кривые, переносится приблизительно (шрифт должен стоять на компьютере, где
файл откроют), эффекты CorelDRAW могут пропасть. Для печати просите у
клиента макет в кривых — тогда перенос точный.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from app.services import cdr_scene


def collect(sources: list[str]) -> list[Path]:
    files: list[Path] = []
    for raw in sources:
        path = Path(raw)
        if path.is_dir():
            files += sorted(p for p in path.rglob("*") if p.suffix.lower() == ".cdr" and p.is_file())
        elif path.exists():
            files.append(path)
        else:
            print(f"  нет такого файла: {raw}", file=sys.stderr)
    return files


def convert(path: Path, out_dir: Path | None, formats: list[str]) -> list[Path]:
    target_dir = out_dir or path.parent
    target_dir.mkdir(parents=True, exist_ok=True)
    made: list[Path] = []
    if "svg" in formats:
        scene = cdr_scene.scene(path)
        many = len(scene["pages"]) > 1
        for page in scene["pages"]:
            suffix = f"-стр{page['index']}" if many else ""
            target = target_dir / f"{path.stem}{suffix}.svg"
            target.write_bytes(cdr_scene.standalone_svg(page))
            made.append(target)
    if "pdf" in formats:
        target = target_dir / f"{path.stem}.pdf"
        target.write_bytes(cdr_scene.convert_to_pdf(path))
        made.append(target)
    return made


def main() -> int:
    parser = argparse.ArgumentParser(description="Макеты CorelDRAW → SVG/PDF для открытия в старых версиях")
    parser.add_argument("sources", nargs="+", help="файлы .cdr или папки с ними")
    parser.add_argument("--to", nargs="+", choices=["svg", "pdf"], default=["svg"], help="во что конвертировать")
    parser.add_argument("--out", help="папка для результата (по умолчанию — рядом с исходником)")
    parser.add_argument("--info", action="store_true", help="только показать версии файлов")
    parser.add_argument("--newer-than", type=int, default=0, metavar="N",
                        help="брать только файлы версии новее N (16 = CorelDRAW X6)")
    args = parser.parse_args()

    tools = cdr_scene.tools()
    if not args.info and not tools["can_view"]:
        print(cdr_scene.INSTALL_HINT, file=sys.stderr)
        return 2
    if "pdf" in args.to and not tools["can_pdf"] and not args.info:
        print("Для PDF нужен Inkscape; SVG доступен и без него.", file=sys.stderr)
        return 2

    files = collect(args.sources)
    if not files:
        print("Файлов .cdr не найдено", file=sys.stderr)
        return 1

    failed = 0
    for path in files:
        version = cdr_scene.version(path)
        label = version["label"] if version else "версия не распознана"
        if args.newer_than and version and version["number"] <= args.newer_than:
            print(f"  пропуск   {path.name} — {label}")
            continue
        if args.info:
            print(f"  {path.name} — {label}")
            continue
        try:
            made = convert(path, Path(args.out) if args.out else None, args.to)
        except cdr_scene.SceneError as exc:
            failed += 1
            print(f"  ОШИБКА    {path.name} — {label}: {exc}", file=sys.stderr)
            continue
        print(f"  готово    {path.name} — {label} → {', '.join(p.name for p in made)}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
