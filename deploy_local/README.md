# CRM на своём сервере без Docker и git

Для запуска ПОСТЕР CRM на компьютере или NAS в локальной сети компании
(TerraMaster TOS и подобные): только Python 3.10+, bash, curl и tar. Сайт-визитка
сюда не относится и на сервер не скачивается.

Все скрипты печатают каждый шаг и каждую команду с префиксом `[СКРИПТ] [ЭТАП]`,
ничего не прячут, а всё напечатанное дублируют в `poster-ocr/logs/deploy_local.log`.

## Что нужно на сервере

| Что | Зачем |
|---|---|
| Python 3.10 или новее | сама система. Если у Python нет модуля `sqlite3` (так на TOS) — `setup.sh` поставит замену `pysqlite3-binary` |
| bash, curl, tar | скрипты, проверка здоровья, обновления |
| systemd **или** cron | автозапуск после перезагрузки; что есть — то и используется |
| интернет при установке и обновлении | pip и архив с GitHub. Без интернета: `setup.sh --wheels ПАПКА` |

Не нужны: Docker, git, Node.js, apt (просмотр содержимого `.cdr` требует
`libcdr-tools`, которого на NAS нет, — эскизы, загрузка и раскладка PDF работают и без него).

## Куда ставить

В папку, которой владеет администратор сервера и **которая не является общей
папкой (share) в TOS**: иначе сотрудники увидят базу и `.env` со своих
компьютеров. Подойдёт, например, `/Volume1/.poster` или `/opt/poster`; общие
папки TOS живут отдельно (`/Volume1/<имя_share>`), и такую папку выбирать нельзя.
`setup.sh` закрывает папку правами `700` — читать её сможет только владелец,
и служба запускается от него же.

## Первая установка

От администратора (на NAS обычно `root` или `admin`, по ssh):

```bash
mkdir -p /Volume1/.poster && cd /Volume1/.poster
curl -fsSL https://codeload.github.com/fuckinbusy/posterprint/tar.gz/refs/heads/main \
  | tar -xz --strip-components=1 --wildcards '*/poster-ocr' '*/deploy_local'
bash deploy_local/setup.sh      # окружение, зависимости, .env, пароль администратора
bash deploy_local/run.sh        # запуск + автозапуск
```

Если `tar` не понимает `--wildcards` (busybox), скачайте только скрипт и он
заберёт остальное сам:

```bash
mkdir -p /Volume1/.poster/deploy_local && cd /Volume1/.poster
curl -fsSL -o deploy_local/common.sh https://raw.githubusercontent.com/fuckinbusy/posterprint/main/deploy_local/common.sh
curl -fsSL -o deploy_local/update.sh https://raw.githubusercontent.com/fuckinbusy/posterprint/main/deploy_local/update.sh
bash deploy_local/update.sh     # скачает poster-ocr и остальные скрипты
bash deploy_local/setup.sh && bash deploy_local/run.sh
```

Своя версия Python: `POSTER_PYTHON=/путь/к/python3.10 bash deploy_local/setup.sh`.

После запуска система открывается по адресу `http://IP-сервера:8000/`.
Порт меняется в `poster-ocr/.env` (`POSTER_PORT`) с последующим `run.sh`.

## Скрипты

| Скрипт | Что делает |
|---|---|
| `setup.sh` | первичная настройка: Python, `.venv`, зависимости, sqlite, `.env`, права, пароль администратора. Повторный запуск безопасен |
| `run.sh` | запуск с автозапуском: служба systemd, а без systemd — cron (`@reboot` + сторож раз в минуту). Повторный вызов — перезапуск |
| `stop.sh` | остановить до перезагрузки; автозапуск остаётся |
| `status.sh` | режим, pid, ответ `/health`, версия, база, последняя копия, хвост журнала. Код выхода 0 — сервер работает |
| `update.sh` | копия базы → архив ветки `main` через curl → распаковка `poster-ocr` и `deploy_local` поверх кода → зависимости → перезапуск → проверка |
| `backup.sh` | копия базы и настроек в `poster-ocr/backups/<дата>/`; `--keep 30` оставить 30 последних; `--list` |
| `uninstall.sh` | убрать автозапуск и остановить; данные не трогает |

Пароль администратора сменить: `poster-ocr/.venv/bin/python -m scripts.set_password`,
затем `run.sh`. Восстановить из копии: `poster-ocr/.venv/bin/python -m scripts.restore --list`.

## Где что лежит

```
/Volume1/.poster/
  deploy_local/            скрипты (это они обновляются update.sh)
  poster-ocr/
    .env                   настройки и хэш пароля (права 600)
    poster.db              база
    backups/  designs/  logs/     копии, макеты, журналы
    .venv/                 окружение Python
    VERSION_LOCAL          коммит и дата последнего update.sh
    logs/deploy_local.log  всё, что печатали скрипты
    logs/uvicorn.out       вывод сервера в режиме cron (в режиме systemd — journalctl -u poster-local)
```

## Если что-то не так

| Симптом | Что делать |
|---|---|
| `Python 3.10+ не найден` | `POSTER_PYTHON=/путь/к/python3.10 bash deploy_local/setup.sh` |
| `у Python нет ensurepip` | `setup.sh` сам поставит pip через get-pip.py — нужен интернет |
| `нет модуля sqlite3` | `setup.sh` сам ставит `pysqlite3-binary`; нет колеса — процессор не x86_64 |
| `порт 8000 уже занят` | `bash deploy_local/status.sh` покажет, чем; или другой порт в `.env` |
| сервер не поднялся после перезагрузки | `status.sh` — режим и журнал; в режиме cron проверьте, что демон cron запущен |
| обновление не скачалось | нет интернета до GitHub; повторите позже, данные не тронуты |
| зависимости не ставятся | `setup.sh --wheels ПАПКА` с колёсами, скачанными на другом компьютере: `pip download -r requirements.txt -d wheels --platform manylinux2014_x86_64 --python-version 3.10 --only-binary=:all:` |

Полный лог всех действий — `poster-ocr/logs/deploy_local.log`.
