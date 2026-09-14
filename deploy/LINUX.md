# Запуск на Linux отдельным процессом

Как поднять сервер из терминала на любом Linux (Ubuntu, Debian, Astra,
Alt — разницы нет): сначала руками, чтобы увидеть, что всё работает, потом
как службу, чтобы он жил сам и переживал перезагрузку. Нужен только
Python 3.10 или новее и git; Node.js не нужен — интерфейс уже собран и лежит
в `static/dist`.

Команды даны для запуска из корня проекта. `$` в начале строки не набирать.

---

## 1. Что поставить

```bash
sudo apt update
sudo apt install -y python3 python3-venv python3-pip git
python3 --version        # должно быть 3.10 или новее
```

Если в системе Python старее 3.10 (например, Ubuntu 20.04 с 3.8) — поставьте
3.10 отдельно: `sudo apt install python3.10 python3.10-venv` (на Ubuntu через
PPA deadsnakes) и дальше везде пишите `python3.10` вместо `python3`.

## 2. Забрать код и собрать окружение

```bash
sudo mkdir -p /opt/poster && sudo chown "$USER" /opt/poster
git clone https://github.com/fuckinbusy/posterprint-ocr /opt/poster
cd /opt/poster

python3 -m venv .venv                 # отдельное окружение только для этого проекта
.venv/bin/pip install --upgrade pip
.venv/bin/pip install -r requirements.txt
```

`.venv/bin/python` — это интерпретатор со всеми зависимостями; активировать
окружение (`source .venv/bin/activate`) не обязательно, ниже он вызывается
по полному пути, так команды одинаково работают и из терминала, и из службы.

## 3. Настройки

```bash
cp .env.example .env
nano .env                             # или любой редактор
```

Минимум, что нужно задать:

| Переменная | Что это |
|---|---|
| `POSTER_ADMIN_PASSWORD` | пароль администратора, от 10 знаков |
| `POSTER_SECRET_KEY` | ключ подписи сессий: `python3 -c "import secrets; print(secrets.token_urlsafe(48))"` |
| `POSTER_SHOP_NAME`, `POSTER_SHOP_PHONE`… | реквизиты для квитанций (можно позже в интерфейсе) |
| `POSTER_BACKUP_AT=03:30` | ежедневная копия базы силами сервера |

Для доступа из интернета ещё `POSTER_PUBLIC=1` и `POSTER_ALLOWED_HOSTS=домен`
— см. README, «Удалённый доступ». В своей сети эти две строки не нужны.

Права на файл с секретами — только владельцу:

```bash
chmod 600 .env
```

## 4. Первый запуск — руками, в терминале

```bash
.venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Что произойдёт: создастся `poster.db`, в пустую базу зальётся стартовый
каталог (виды работ и прайс), в консоли появится `Uvicorn running on
http://0.0.0.0:8000`. Откройте с другого компьютера в сети
`http://<адрес-сервера>:8000/` — должен показаться экран входа.

- `--host 0.0.0.0` — слушать на всех интерфейсах, чтобы заходили коллеги.
  Если перед сервером будет прокси на этой же машине (Caddy, nginx),
  ставьте `--host 127.0.0.1`: снаружи порт 8000 тогда не виден.
- Остановить — `Ctrl+C`.
- Демо-данные для знакомства (160 заказов, 80 клиентов):
  `.venv/bin/python -m scripts.seed_demo`. На настоящей базе не запускать.

Если стартовать не хочет — читайте текст ошибки целиком: сервер отказывается
работать с повреждённой базой и, в режиме `POSTER_PUBLIC`, с паролем
«admin» или без ключа, и пишет, что именно не так.

## 5. Отдельный процесс, который не умирает с терминалом

Три способа, от быстрого к правильному.

### 5а. nohup — на один вечер

```bash
nohup .venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 \
    > logs/uvicorn.out 2>&1 &
echo $! > poster.pid                  # запомнить номер процесса
```

Терминал можно закрывать. Посмотреть, что живой: `curl http://127.0.0.1:8000/health`
(ответ `{"ok":true}`). Остановить: `kill "$(cat poster.pid)"`. После
перезагрузки машины запускать заново руками.

### 5б. tmux — когда нужно видеть консоль

```bash
sudo apt install -y tmux
tmux new -s poster                    # открылась отдельная сессия
.venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Отсоединиться, не останавливая: `Ctrl+B`, затем `D`. Вернуться к консоли:
`tmux attach -t poster`. Остановить — внутри сессии `Ctrl+C`. После
перезагрузки тоже запускать заново.

### 5в. systemd — постоянно (рекомендуется)

Служба стартует вместе с системой, перезапускается после сбоя, пишет журнал.
Готовый файл лежит в `deploy/poster.service`.

```bash
# отдельный пользователь без права входа: сервер работает от него, а не от вас
sudo useradd --system --home /opt/poster --shell /usr/sbin/nologin poster
sudo chown -R poster:poster /opt/poster

sudo cp deploy/poster.service /etc/systemd/system/poster.service
sudo nano /etc/systemd/system/poster.service     # проверить пути и --host
sudo systemctl daemon-reload
sudo systemctl enable --now poster               # включить и запустить
```

В файле службы по умолчанию `--host 127.0.0.1` (расчёт на прокси перед
сервером) и `Environment=POSTER_PUBLIC=1`. Для сервера в своей сети без
прокси поставьте `--host 0.0.0.0` и уберите строку с `POSTER_PUBLIC`.

Управление:

```bash
sudo systemctl status poster          # работает ли, последние строки журнала
sudo systemctl restart poster         # перезапустить (после правки .env или обновления)
sudo systemctl stop poster            # остановить
sudo journalctl -u poster -f          # журнал вживую, Ctrl+C — выйти
sudo journalctl -u poster --since today
```

## 6. Проверить, что всё работает

```bash
curl -s http://127.0.0.1:8000/health                       # {"ok":true}
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8000/   # 200
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8000/api/orders   # 401 — без токена и должно быть
ss -ltnp | grep 8000                                       # кто слушает порт
```

Журналы приложения — в `logs/poster.log` (все запросы) и `logs/errors.log`
(только ошибки), они обрезаются сами. У каждой ошибки 500 есть номер: по
нему ищется полный трейсбек в `errors.log`.

## 7. Обновление

```bash
cd /opt/poster
sudo -u poster git pull                  # или git pull, если запускали от себя
sudo -u poster .venv/bin/pip install -r requirements.txt   # если менялись зависимости
sudo systemctl restart poster
```

Перед изменением схемы базы сервер сам снимает копию в
`backups/…_before-update`. Копии руками: `.venv/bin/python -m scripts.backup`,
список и восстановление: `.venv/bin/python -m scripts.restore --list`.

## 8. Сеть и безопасность в своей сети

- Открыть порт в файрволе только для локальной сети:
  `sudo ufw allow from 192.168.0.0/16 to any port 8000` (подставьте свою сеть),
  `sudo ufw enable`.
- Заходить по адресу `http://<ip>:8000`. Чтобы был понятный адрес вроде
  `http://poster.local:8000`, добавьте строку в `/etc/hosts` на компьютерах
  сотрудников или запись в DNS роутера.
- Пароли сотрудникам и привязку профилей к компьютерам задаёт администратор
  в разделе «Сотрудники».
- Для доступа из интернета — не открывать 8000 наружу; поставить Caddy
  (`deploy/Caddyfile`) или туннель, включить `POSTER_PUBLIC=1`. Подробно —
  README, «Удалённый доступ».

## 9. Если что-то не так

| Симптом | Что смотреть |
|---|---|
| `Address already in use` | порт занят другим процессом: `ss -ltnp \| grep 8000`, остановить его или взять другой `--port` |
| `Permission denied` на базе или папках | владелец файлов не тот пользователь, от которого запущен сервер: `sudo chown -R poster:poster /opt/poster` |
| сервер стартует, страница пустая | нет `static/dist` — не докачали репозиторий целиком; `git status` и `ls static/dist` |
| `POSTER_PUBLIC=1, но сервер не готов` | в тексте ошибки перечислено, чего не хватает в `.env` |
| после `git pull` ошибка импорта | обновились зависимости: `.venv/bin/pip install -r requirements.txt` |
| время в отчётах «уезжает» | сервер хранит время в UTC, интерфейс показывает местное; проверьте часовой пояс машины: `timedatectl` |
