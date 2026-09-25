# ПОСТЕР — мастерская печати

Одна система из двух частей: **CRM** — учёт заказов для сотрудников и
**сайт-визитка** для клиентов. Код в одном репозитории, работают они
отдельными процессами — вместе или по отдельности, на своём компьютере, в
мастерской или на сервере в интернете.

    posterprint/
    ├── poster-ocr/          CRM: FastAPI + React, SQLite
    ├── poster-website/      сайт-визитка: React (Vite)
    ├── poster.sh, poster.ps1  запуск на своём компьютере: all | crm | site
    ├── docker-compose.yml   сервер в интернете: CRM, сайт и Caddy — отдельные контейнеры
    ├── deploy/              всё про запуск и развёртывание — deploy/README.md
    └── .env.example         настройки сервера: режим и домены

На домене это выглядит так:

    https://постерпринт.рф/          сайт-визитка
    https://crm.постерпринт.рф/      CRM (вход для сотрудников)

## Быстрый старт

```bash
./poster.sh run              # CRM (http://localhost:8000) и сайт (http://localhost:5174) — два процесса
./poster.sh run crm          # только CRM
./poster.sh run site         # только сайт
```

На Windows — `.\poster.ps1 run` с теми же вариантами. Первый раз CRM нужно
окружение — см. [deploy/README.md](deploy/README.md), «На своём компьютере».

**Сервер в интернете** — `sudo bash deploy/setup.sh`: спросит, что
запускать (всё, только CRM или только сайт), домены и пароль, остальное
сделает сам. **Мастерская без Docker** — служба systemd или планировщик
Windows. Всё это — в [deploy/README.md](deploy/README.md).
**Свой сервер или NAS в локальной сети, без Docker и git** (TerraMaster TOS,
Python 3.10) — скрипты `setup / run / stop / status / update / backup` в
[deploy_local/README.md](deploy_local/README.md): обновление приходит архивом
с GitHub через curl, сайт-визитка на такой сервер не ставится.

## CRM (poster-ocr)

Всё про неё — в [poster-ocr/README.md](poster-ocr/README.md): права,
прайс, почта, макеты, копии, безопасность. **API для ботов и программ** —
[poster-ocr/API.md](poster-ocr/API.md): ключи сотрудников, права, частые
задачи с примерами, все ручки.

## Сайт-визитка (poster-website)

React + Vite + TypeScript, собирается в статические файлы. Подробнее —
[poster-website/README.md](poster-website/README.md).
