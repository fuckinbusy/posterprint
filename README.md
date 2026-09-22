# ПОСТЕР — мастерская печати

Два проекта в одном репозитории и одна инфраструктура на сервере:

    posterprint/
    ├── poster-ocr/          система учёта заказов: FastAPI + React, SQLite
    ├── poster-website/      сайт-визитка мастерской: React (Vite)
    ├── deploy/Caddyfile     Caddy на сервере: https, визитка в корне, система под /poster-crm
    ├── docker-compose.yml   всё вместе на VPS: система + визитка + Caddy
    └── .env.example         настройки сервера: домен и путь системы

На домене это выглядит так:

    https://example.ru/               сайт-визитка
    https://example.ru/poster-crm/    система (вход для сотрудников)

Проекты не зависят друг от друга: у каждого свой код, свои зависимости и
своя сборка, обновляются по отдельности. Общее — только домен, сертификат
и Caddy, который решает, кому какой путь.

## Система (poster-ocr)

Всё про неё — в [poster-ocr/README.md](poster-ocr/README.md): запуск дома и
в мастерской, права, прайс, почта, макеты, копии, безопасность. Коротко:

```bash
cd poster-ocr
bash deploy/install.sh              # Linux: окружение, зависимости, .env, пароль
deploy/poster.sh run                # запуск в терминале, http://localhost:8000
```

Запуск на Linux-сервере в мастерской (служба, автозапуск, обновление) —
[poster-ocr/deploy/LINUX.md](poster-ocr/deploy/LINUX.md).

## Сайт-визитка (poster-website)

React + Vite + TypeScript, собирается в статические файлы. Разработка:

```bash
cd poster-website
npm install
npm run dev                         # http://localhost:5174
```

Подробнее — [poster-website/README.md](poster-website/README.md).

## Сервер в интернете (VPS)

Один раз на сервере:

```bash
curl -fsSL https://get.docker.com | sh
git clone https://github.com/fuckinbusy/posterprint /opt/poster && cd /opt/poster
cp .env.example .env                              # домен и путь системы
cp poster-ocr/.env.example poster-ocr/.env        # настройки системы
nano .env poster-ocr/.env
```

В корневом `.env` — `POSTER_DOMAIN` (домен, на который указывает DNS) и
`POSTER_BASE_PATH` (по умолчанию `/poster-crm`). В `poster-ocr/.env` —
пароль администратора (`python -m scripts.set_password` или хэш руками),
`POSTER_SECRET_KEY`, почта, копии. `POSTER_ALLOWED_HOSTS` и
`POSTER_BASE_PATH` система получает от compose — дублировать не нужно.

Домен должен указывать на адрес сервера, порты 80 и 443 открыты. Затем:

```bash
docker compose up -d
docker compose logs -f app          # первый старт: таблицы, каталог, предупреждения
```

Обновление любого из проектов — та же команда после `git pull`:

```bash
git pull && docker compose up -d --build
```

Данные системы живут в `/opt/poster/data` (база, копии, макеты, логи) — том,
который переживает пересборку образов. Как перенести данные с сервера в
мастерской, делать копии и восстанавливаться — в README системы, раздел
«Удалённый доступ».

Что защищает систему снаружи (строгий режим, https, лимиты, заголовки) —
там же. Визитка — обычный статический сайт, ей защищать нечего, кроме
самого сервера: держите открытыми только 22, 80 и 443.
