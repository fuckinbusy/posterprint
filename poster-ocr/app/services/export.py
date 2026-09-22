"""Выгрузка в CSV: один формат для заказов, клиентов и кассы.

Разделитель — точка с запятой и BOM в начале: так файл открывается в Excel
с русской локалью без вопросов про кодировку и столбцы."""

from __future__ import annotations

import csv
import io

from fastapi import Response


def csv_response(rows: list[list[str]], filename: str) -> Response:
    buf = io.StringIO()
    writer = csv.writer(buf, delimiter=";", lineterminator="\r\n")
    writer.writerows(rows)
    return Response(
        content=buf.getvalue().encode("utf-8-sig"),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
