"""Математика калькулятора (web/src/features/tools/calc/calc.ts) — через Node.

Файл calc.ts без React и только со стираемыми типами, поэтому Node 22.6+
читает его напрямую (--experimental-strip-types; в Node 24 флаг не нужен).
Нет Node — тест пропускается, как и сверка dimensions.ts.
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest
from conftest import ROOT

CHECK = Path(__file__).parent / "js" / "calc_check.mjs"


@pytest.mark.skipif(shutil.which("node") is None, reason="нет Node.js")
def test_калькулятор_считает_верно():
    node = shutil.which("node")
    assert node
    run = subprocess.run(
        [node, "--experimental-strip-types", "--no-warnings", str(CHECK)],
        capture_output=True, text=True, encoding="utf-8", cwd=ROOT, timeout=60,
    )
    assert run.returncode == 0, run.stderr or run.stdout
    assert "calc ok" in run.stdout
