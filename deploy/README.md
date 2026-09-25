# Запуск и развёртывание

Система ПОСТЕР — две части: **CRM** (учёт заказов, `poster-ocr/`) и
**сайт-визитка** (`poster-website/`). Работают они всегда отдельными
процессами и запускаются вместе или по отдельности — на своём компьютере,
на компьютере в мастерской или на сервере в интернете.

```
poster.sh / poster.ps1     запуск на своём компьютере: run|start|stop|status  all|crm|site
docker-compose.yml         сервер в интернете: CRM, сайт и Caddy — отдельные контейнеры
deploy/
  README.md                этот гайд
  setup.sh                 первый запуск на VPS: режим, домены, пароль, сборка, старт
  mode.sh                  сменить режим: all | crm | site
  Caddyfile, caddy/        https и какой домен кому: правила для режимов all / crm / site
  crm/                     CRM без Docker: install.sh, poster.sh, служба, Windows, LINUX.md
  ../deploy_local/         CRM на своём сервере или NAS без Docker и git (см. её README.md)
```

- [Какой способ выбрать](#какой-способ-выбрать)
- [Домены](#домены)
- [Сервер в интернете (Docker)](#сервер-в-интернете-docker)
- [CRM без Docker: мастерская, NAS, Windows](#crm-без-docker-мастерская-nas-windows)
- [Сайт без Docker](#сайт-без-docker)
- [На своём компьютере](#на-своём-компьютере)
- [Если что-то не так](#если-что-то-не-так)

---

## Какой способ выбрать

| Задача | Как |
|---|---|
| CRM и сайт на одном сервере в интернете | VPS, `sudo bash deploy/setup.sh`, режим **all** |
| Только CRM в интернете (сайт пока на Tilda) | VPS, `setup.sh`, режим **crm** |
| Только сайт на этом сервере (CRM — на другом) | VPS, `setup.sh`, режим **site** |
| CRM на компьютере или NAS в мастерской, в своей сети | `deploy/crm/install.sh` — служба с автозапуском, [LINUX.md](crm/LINUX.md) |
| CRM на Windows в мастерской | `deploy\crm\poster.ps1` — [ниже](#windows) |
| Разработка, проверка на своём компьютере | `./poster.sh run` или `.\poster.ps1 run` |

Режимы можно совмещать по серверам: например, CRM в мастерской, а сайт —
на VPS в режиме **site**.

---

## Домены

Сайт живёт на основном домене, CRM — на своём поддомене:

    https://постерпринт.рф/          сайт
    https://crm.постерпринт.рф/      CRM

**Поддомен бесплатный** — это часть вашего домена, покупать ничего не
нужно. В панели DNS (у регистратора, где настроен постерпринт.рф) добавьте
A-запись: имя `crm`, значение — IP-адрес сервера. Сертификат для него Caddy
выпустит сам, тоже бесплатно.

**Сайт на Tilda не мешает.** Основной домен может и дальше указывать на
Tilda, а `crm.` — на ваш сервер: запустите VPS в режиме **crm**. Когда
новый сайт готов, переключите A-запись основного домена на сервер и смените
режим на **all**.

В `.env` домены пишутся в **punycode** — так их понимают Caddy и Let's
Encrypt. `setup.sh` переводит сам; вручную:

```bash
python3 -c "print('постерпринт.рф'.encode('idna').decode())"   # xn--e1agpbecgbfkg.xn--p1ai
```

---

## Сервер в интернете (Docker)

Три контейнера — три отдельных процесса со своими сборкой и перезапуском:

| Контейнер | Что внутри | Наружу | Режимы |
|---|---|---|---|
| `app` | CRM: FastAPI + собранный интерфейс, база SQLite в `data/` | нет, через Caddy | all, crm |
| `site` | сайт: собранный React и маленький Caddy | нет, через Caddy | all, site |
| `caddy` | https (Let's Encrypt), какой домен кому | 80 и 443 | всегда |

Упала CRM — сайт работает, и наоборот. Режим — одна строка
`COMPOSE_PROFILES` в корневом `.env`; по ней Compose поднимает нужные
контейнеры, а Caddy берёт правила `deploy/caddy/<режим>.caddy`.

### Что нужно

- VPS с Ubuntu или Debian: от 1 ГБ памяти и 10 ГБ диска (сборка образов
  тянет Python и Node; работать хватит и меньшего);
- A-записи доменов на адрес сервера (см. [«Домены»](#домены));
- открытые порты 22, 80 и 443.

### Первый запуск

```bash
curl -fsSL https://get.docker.com | sh                       # Docker и Compose
git clone https://github.com/fuckinbusy/posterprint /opt/poster
cd /opt/poster
sudo bash deploy/setup.sh
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw enable
```

`setup.sh` спросит режим, домены и пароль администратора CRM, остальное
сделает сам:

0. проверит доступ к Docker Hub; из России он бывает закрыт — тогда
   предложит прописать зеркало (см. [ниже](#docker-hub-недоступен));
1. корневой `.env` — режим и домены (кириллицу переведёт в punycode);
2. `poster-ocr/.env` — со случайным ключом подписи сессий
   (`POSTER_SECRET_KEY`) и ежедневной копией базы в 03:30;
3. папку `data/` для базы, копий, макетов и логов — с владельцем uid 1000:
   CRM в контейнере работает не от root, и в папку, которую Docker создал бы
   сам (от root), писать не смогла бы;
4. сборку образов;
5. хэш пароля администратора — считает сама CRM, пароль в файлы не попадает;
6. запуск — и ждёт, пока всё ответит.

Шаги 2, 3 и 5 — только если CRM запускается на этом сервере. Запускать
скрипт повторно можно: заданное он не трогает. Сертификаты Caddy выпустит
при первом заходе на каждый домен.

Дальше в CRM — «Сотрудники»: профили, пароли, права; ключи для ботов — там
же ([API.md](../poster-ocr/API.md)). Остальные настройки CRM (реквизиты
для QR, почта, копии) — в `poster-ocr/.env` по образцу с пояснениями
`poster-ocr/.env.example`, после правки — `docker compose up -d`.
`POSTER_ALLOWED_HOSTS`, `POSTER_PUBLIC` и пути к данным CRM получает от
compose — в `.env` их писать не нужно. Значения со знаком `$` (пароли,
хэш) — в одинарных кавычках: `KEY='значение'`, иначе Compose подставит
вместо `$…` пустоту.

### Сменить режим

```bash
sudo bash deploy/mode.sh crm        # или all, site
```

Скрипт записывает `COMPOSE_PROFILES` в `.env`, гасит контейнер, который
новый режим не включает, и поднимает остальное. Просто поправить `.env` и
сделать `docker compose up -d` мало: контейнер выключенного режима так и
останется работать — для Compose он не «сирота», и `--remove-orphans` его
не трогает. Переходите на режим с CRM впервые — скрипт попросит сначала
`sudo bash deploy/setup.sh`: он подготовит `poster-ocr/.env`, папку данных
и пароль.

### Каждый день

```bash
cd /opt/poster
git pull && docker compose up -d --build     # обновить всё
docker compose up -d --build site            # только сайт (CRM не трогается)
docker compose up -d --build app             # только CRM
docker compose ps                            # что запущено и здорово ли
docker compose logs -f app                   # журнал CRM (site, caddy — так же)
docker compose restart app                   # перезапустить CRM
docker compose stop site                     # остановить сайт, CRM работает дальше
```

Команды `docker compose` — от того же пользователя, что запускал
`setup.sh` (обычно root): `.env` закрыты от остальных.

### Данные и копии

Всё, что нельзя потерять, — в `/opt/poster/data`: база, копии, макеты,
журнал CRM. Образы можно пересобирать и удалять — данные остаются. Копию
база снимает сама каждую ночь в `data/backups`; раз в неделю забирайте их к
себе — копия на той же машине не спасёт от потери машины:

```bash
rsync -a root@сервер:/opt/poster/data/backups/ ~/poster-backups/
```

Копия вручную и восстановление:

```bash
docker compose exec app python -m scripts.backup --keep 30
docker compose exec app python -m scripts.restore --list
```

### Переезд из мастерской на сервер

База SQLite — один файл, макеты — папка; переезд — это их копирование.

1. **В мастерской остановите CRM** (`deploy/crm/poster.sh stop`, служба
   или окно). Копировать работающую базу нельзя: последние записи ещё в
   файле журнала `poster.db-wal`, и копия выйдет без них.
2. **Скопируйте на сервер** базу и макеты (из папки `poster-ocr`):

   ```bash
   scp poster.db root@сервер:/opt/poster/data/poster.db.new
   rsync -a designs/ root@сервер:/opt/poster/data/designs/
   ```

3. **Ключ подписи — тот же, что в мастерской.** Скопируйте значение
   `POSTER_SECRET_KEY` из `.env` мастерской (или, если его там нет,
   содержимое файла `.secret`) в `poster-ocr/.env` на сервере вместо
   сгенерированного. Иначе пароли почтовых ящиков не расшифруются
   (придётся ввести заново), а API-ключи продолжат работать, но показать
   их станет нельзя — только перевыпустить.
4. **На сервере подмените базу:**

   ```bash
   cd /opt/poster
   docker compose stop app
   # журнал пустой базы, с которой сервер уже успел запуститься, — долой:
   # SQLite применил бы его к новому файлу и испортил базу
   rm -f data/poster.db-wal data/poster.db-shm
   mv data/poster.db.new data/poster.db
   chown -R 1000:1000 data
   docker compose up -d
   docker compose logs -f app     # при первом старте схема базы дописывается сама
   ```

Если база из мастерской старше кода на сервере, недостающие колонки CRM
допишет при старте сама, сняв перед этим копию в `data/backups`.

### Docker Hub недоступен

Из России Docker Hub (`registry-1.docker.io`) часто не отвечает — сборка
встаёт на первом же `FROM python`. Лечится зеркалом: `setup.sh` сам
проверит доступ и предложит прописать работающее. Вручную —
`/etc/docker/daemon.json`:

```json
{ "registry-mirrors": ["https://dh-mirror.gitverse.ru"] }
```

и `systemctl restart docker`. Другие зеркала: `https://mirror.gcr.io`,
`https://dockerhub1.beget.com`; у многих российских хостингов (Timeweb,
Selectel, Yandex Cloud) есть своё — оно быстрее всех. Проверить зеркало:

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  -H 'Accept: application/vnd.oci.image.index.v1+json' \
  https://dh-mirror.gitverse.ru/v2/library/alpine/manifests/latest   # 200 — работает
```

PyPI и npm при этом обычно доступны — зеркало нужно только для базовых
образов.

### Медленная сборка

Образ CRM ставит пакет `libcdr-tools` из Debian. Из России
`deb.debian.org` бывает в сотни раз медленнее обычного — сборка висит на
одном файле по полчаса. Тогда в корневом `.env`:

```bash
POSTER_DEBIAN_MIRROR=https://mirror.yandex.ru/debian
```

и `docker compose build app`. `setup.sh` меряет скорость сам и при
необходимости прописывает зеркало.

### Что защищает CRM снаружи

Строгий режим `POSTER_PUBLIC=1` (в `docker-compose.yml` он включён всегда):
CRM не стартует без пароля администратора, ключа подписи и домена, отдаёт
только https с HSTS, заголовки безопасности, режет чужой `Host`, считает
попытки входа — подробно в README CRM, «Удалённый доступ». Сайту защищать
нечего, кроме самого сервера: держите открытыми только 22, 80 и 443.

---

## CRM без Docker: мастерская, NAS, Windows

**Сервер или NAS без git** (TerraMaster TOS, Python 3.10, обновления архивом
через curl) — отдельный набор скриптов в [../deploy_local/README.md](../deploy_local/README.md):
`setup.sh`, `run.sh`, `stop.sh`, `status.sh`, `update.sh`, `backup.sh`,
каждый печатает всё, что делает, и пишет лог. Ниже — вариант с git.

### Linux

Пошагово, от голой системы до службы с автозапуском и сторожем, — в
[crm/LINUX.md](crm/LINUX.md). Коротко (из корня репозитория):

```bash
git clone https://github.com/fuckinbusy/posterprint /opt/poster && cd /opt/poster
sudo bash deploy/crm/install.sh --service --lan    # в своей сети, без прокси
sudo bash deploy/crm/install.sh --service          # за https-прокси (Caddy, туннель)

deploy/crm/poster.sh status | logs | update | backup | start | stop
```

Раньше скрипты лежали в `poster-ocr/deploy/`; там остались переадресации,
чтобы уже установленные служба и сторож в cron работали после обновления.

### Windows

```powershell
cd poster-ocr
python -m venv .venv; .venv\Scripts\pip install -r requirements.txt
copy .env.example .env; .venv\Scripts\python -m scripts.set_password
cd ..

deploy\crm\poster.ps1 run                  # в окне, Ctrl+C — стоп
deploy\crm\poster.ps1 start                # в фоне, скрытым окном; stop, status, logs, update, backup
deploy\crm\poster.ps1 install-autostart    # от имени администратора: задача планировщика
```

`install-autostart` создаёт задачу планировщика от учётной записи SYSTEM:
CRM стартует при включении компьютера ещё до входа в Windows, после сбоя
перезапускается раз в минуту без ограничения попыток, второй задачей раз в
минуту работает сторож по `/health`, спящий режим и отключение диска
выключаются через `powercfg`. Убрать — `remove-autostart`. Чтобы компьютер
включался сам после отключения света, в BIOS ставится *Restore on AC Power
Loss → Power On*.

### CRM за своим Caddy (без Docker, с доменом)

Caddy (`apt install caddy`) с этим же `deploy/Caddyfile`: в
`caddy/snippets.caddy` замените `app:8000` на `127.0.0.1:8000`, задайте
службе caddy переменные `POSTER_RUN=crm` и `POSTER_CRM_DOMAIN=…` (или впишите
значения вместо `{$…}`), в `poster-ocr/.env` — `POSTER_PUBLIC=1` и
`POSTER_ALLOWED_HOSTS=<домен CRM>`. Служба CRM — `install.sh --service`
(без `--lan`: слушает только 127.0.0.1).

---

## Сайт без Docker

Сайт — статические файлы. Собрать:

```bash
cd poster-website
npm ci
VITE_CRM_URL=https://crm.xn--e1agpbecgbfkg.xn--p1ai/ npm run build   # без VITE_CRM_URL — без ссылки «Вход для сотрудников»
```

и отдать папку `dist/` любым веб-сервером так, чтобы адреса без файла
возвращали `index.html`. В Caddy: в `caddy/snippets.caddy` вместо
`reverse_proxy site:80` — `root * /путь/к/poster-website/dist`,
`try_files {path} /index.html` и `file_server`.

---

## На своём компьютере

Для разработки и проверки — одна команда из корня репозитория; CRM и сайт
всегда отдельными процессами:

```bash
./poster.sh run            # оба в этом терминале; Ctrl+C гасит оба
./poster.sh run crm        # только CRM:  http://localhost:8000
./poster.sh run site       # только сайт: http://localhost:5174 (живая перезагрузка)
./poster.sh start          # оба в фоне; start crm | start site — по одному
./poster.sh status         # что запущено
./poster.sh stop site      # остановить сайт, CRM работает дальше
./poster.sh logs crm       # журнал вживую
```

На Windows — то же: `.\poster.ps1 run`, `.\poster.ps1 start site` и т. д.

- **CRM** управляется через `deploy/crm/poster.sh` (`.ps1`): если на машине
  стоит служба, `start`/`stop` управляют ею. Первый раз нужно окружение —
  `bash deploy/crm/install.sh` (Linux) или шаги из [«Windows»](#windows).
- **Сайт**: в `run` — сервер разработки с живой перезагрузкой, в `start` —
  собранный сайт (`npm run build` + `vite preview`). Зависимости
  (`npm ci`) поставятся сами при первом запуске; нужен Node.js 20+.
- Порты: CRM — `POSTER_PORT` (8000), сайт — `POSTER_SITE_PORT` (5174).
  Ссылка «Вход для сотрудников» на сайте в разработке ведёт прямо на CRM,
  `http://localhost:8000/` — она должна быть запущена (`run all` поднимает обе).

---

## Если что-то не так

| Признак | Причина и что делать |
|---|---|
| сборка висит на `FROM python`, `registry-1.docker.io … i/o timeout` | Docker Hub недоступен — [зеркало](#docker-hub-недоступен) |
| сборка часами висит на `Get: … deb.debian.org` | медленный Debian — [зеркало](#медленная-сборка) `POSTER_DEBIAN_MIRROR` |
| `app` перезапускается, в журнале «POSTER_PUBLIC=1, но сервер не готов» | не задан пароль, ключ или домен CRM — `sudo bash deploy/setup.sh` допишет |
| «POSTER_ADMIN_PASSWORD_HASH не похож на хэш» | хэш записан без кавычек, Compose съел `$…` — возьмите в `'…'` |
| «unable to open database file» | у `data/` не тот владелец: `sudo chown -R 1000:1000 data` |
| браузер ругается на сертификат | домен ещё не указывает на сервер или закрыт порт 80 — `docker compose logs caddy` |
| сайт открывается, CRM — ошибка 502 | CRM не поднялась (`docker compose logs app`) или режим не включает её — `sudo bash deploy/mode.sh all` |
| Caddy не стартует: «no such file … caddy/.caddy» | пустой `COMPOSE_PROFILES` в `.env` — впишите all, crm или site |
| служба CRM после обновления «не найден deploy/poster.sh» | обновите код целиком (`git pull`): переадресация лежит в `poster-ocr/deploy/` |
