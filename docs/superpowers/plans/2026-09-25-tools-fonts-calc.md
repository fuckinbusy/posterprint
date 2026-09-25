# Инструменты: доступность, шрифты, калькулятор — план

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline). Steps use `- [ ]`.

**Goal:** В разделе «Инструменты» недоступные на сервере утилиты помечены «В разработке»;
новые утилиты «Шрифты» (Google Fonts + шрифты из .cdr без libcdr + переход на
fonts-online.ru) и «Калькулятор» (деньги с курсами ЦБ, метраж, дизайн, единицы).

**Architecture:** бэкенд (FastAPI, stdlib `urllib`/`zipfile`, без новых зависимостей):
`GET /api/tools` — доступность; `services/fonts_catalog.py` — снимок каталога Google
Fonts в `app/data/google_fonts.json` (обновляется `scripts/refresh_fonts_catalog.py`);
`services/fonts_download.py` — TTF по css2-API → zip с `установить.cmd`, кэш в
`fonts_cache/`; `services/cdr_fonts.py` — имена шрифтов из .cdr (fontTable.dat →
ссылки в data-файлы → RIFF `font`); `services/rates.py` — курсы ЦБ раз в сутки с
файлом-кэшем. Фронтенд: плитки с плашкой, `FontsTool`, `CalcPage` на системных
Field/Select/.check.

**Spec:** решения владельца 25.09.2026 (плашка по факту недоступности; `установить.cmd`
нужен; валюты USD/EUR/CNY → RUB; кириллица важна; переход на fonts-online при промахе;
шрифты из .cdr без libcdr).

## Global Constraints
- Новых pip-зависимостей нет (stdlib: urllib, zipfile, json, zlib, struct).
- Сеть с сервера: fonts.googleapis.com / fonts.gstatic.com / cbr-xml-daily.ru —
  таймауты 60 с, при недоступности — понятная ошибка, кэш отдаёт последнее.
- fonts-online.ru — только ссылка в новой вкладке, никакой автоматизации.
- Файлы .cdr в «Шрифтах» не хранятся (tool_files.temp_dir, предел 300 МБ).
- Права `tools.fonts`, `tools.calc` — default True, раздаются существующим (perm_rollout).
- UI — Field / Select / label.check / PageHead / .btn, ссылка «← Все инструменты», ToolsNotice.
- Python 3.10; ruff/mypy — ноль; tests: pytest -q.

## Review Focus
1. Google недоступен → скачивание отвечает 502 с текстом, каталог и поиск работают (Task 3 тест).
2. .cdr без fontTable.dat и старый RIFF → не 500, а список из RIFF `font` или пустой с пояснением (Task 4 тест).
3. Имя семейства с пробелами/кириллицей в download → безопасное имя файла, 404 если нет в каталоге (Task 3).
4. Курс ЦБ недоступен, кэш есть → отдаётся кэш с датой и пометкой stale; кэша нет → 503 с текстом (Task 1).
5. Плашка: инструмент недоступен → плитка не ведёт никуда, прямой адрес показывает ту же причину (Task 5, браузер).

## Tasks
1. Права tools.fonts/tools.calc + rollout; `GET /api/tools` (viewer по cdr_scene.tools().can_view); `services/rates.py` + `GET /api/tools/rates`; тесты.
2. Снимок каталога + скрипт обновления; `services/fonts_catalog.py` (search: q, cyrillic, category; сортировка по popularity); `GET /api/tools/fonts`; тесты.
3. `services/fonts_download.py`: styles → css2 запрос (UA не браузерный → TTF), скачивание в кэш, zip + `установить.cmd`; `GET /api/tools/fonts/download?family=&styles=`; тесты с подменой urlopen.
4. `services/cdr_fonts.py` + `POST /api/tools/fonts/from-cdr` → [{family, status: google|system|unknown}], тесты на синтетическом zip + реальные файлы designs/ если есть.
5. Фронтенд: `api/tools.ts`, доступность в ToolsPage (плашка), `features/tools/fonts/FontsTool.tsx`, `features/tools/calc/CalcPage.tsx` (+ `calc.ts` чистые функции), маршруты, CSS; tsc + build + браузер.
6. TODO.md/API.md, коммит, push.
