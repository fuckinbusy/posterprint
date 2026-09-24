#!/usr/bin/env bash
# Первый запуск на VPS: настройки, папка данных, пароль, сборка и старт.
#
#   cd /opt/poster && sudo bash deploy/setup.sh
#
# Что делает, по шагам (каждый шаг пропускается, если уже сделан, — скрипт
# можно запускать повторно, заданное он не трогает):
#   1. корневой .env — домен и путь системы (спросит домен);
#   2. poster-ocr/.env — из примера, с новым ключом подписи сессий и
#      ежедневной копией базы в 03:30;
#   3. папка data/ — база, копии, макеты, логи; владелец — пользователь
#      приложения в контейнере (uid 1000), иначе система не сможет писать;
#   4. сборка образов;
#   5. пароль администратора — спросит и запишет хэшем;
#   6. запуск и ожидание, пока система ответит.
#
# Нужны Docker и Compose: curl -fsSL https://get.docker.com | sh

set -euo pipefail
cd "$(dirname "$0")/.."

APP_UID=1000   # пользователь poster в poster-ocr/Dockerfile
ROOT_ENV=.env
APP_ENV=poster-ocr/.env

say()  { printf '\n\033[1;32m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[!]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[x]\033[0m %s\n' "$*" >&2; exit 1; }

# Заменяет строку «KEY=…» (или закомментированную «# KEY=…» — тогда
# раскомментирует на месте) на LINE; нет такой строки — дописывает в конец.
# Значение передаётся через окружение, а не в тексте программы awk: в хэше
# пароля есть «$» и кавычки, их не нужно экранировать.
set_env() {
  local file=$1
  KEY=$2 LINE=$3 awk '
    BEGIN { done = 0 }
    {
      k = $0; sub(/^#[ \t]*/, "", k)
      if (!done && index(k, "=") > 0 && substr(k, 1, index(k, "=") - 1) == ENVIRON["KEY"]) {
        print ENVIRON["LINE"]; done = 1; next
      }
      print
    }
    END { if (!done) print ENVIRON["LINE"] }
  ' "$file" > "$file.tmp"
  cat "$file.tmp" > "$file" && rm -f "$file.tmp"   # cat, а не mv: права файла сохраняются
}

# Значение незакомментированной строки KEY=… (пусто, если нет). «\r» —
# долой: .env, поправленный в Блокноте и залитый на сервер, приходит с
# концами строк Windows, и «пустое» значение оказывалось символом «\r»
get_env() {
  tr -d '\r' < "$1" | sed -n "s/^$2=//p" | tail -n 1 | sed "s/^'\(.*\)'$/\1/; s/^\"\(.*\)\"$/\1/"
}

# ---------------------------------------------------------------- 0. проверки
command -v docker >/dev/null || die "Нет Docker. Поставьте: curl -fsSL https://get.docker.com | sh"
docker compose version >/dev/null 2>&1 || die "Нет плагина Docker Compose (docker compose). Поставьте Docker заново скриптом get.docker.com"
[ -f docker-compose.yml ] || die "Запускайте из папки репозитория: cd /opt/poster && sudo bash deploy/setup.sh"
if [ "$(id -u)" -ne 0 ]; then
  SUDO=sudo
  warn "Скрипт запущен не от root — для папки data/ понадобится sudo"
else
  SUDO=
fi

# ---------------------------------------------------------------- 1. корневой .env
if [ ! -f "$ROOT_ENV" ]; then
  say "Настройки сервера ($ROOT_ENV)"
  cp .env.example "$ROOT_ENV"
fi
domain=$(get_env "$ROOT_ENV" POSTER_DOMAIN)
if [ -z "$domain" ] || [ "$domain" = "example.ru" ]; then
  read -rp "Домен сервера (на него должна указывать A-запись DNS), например poster-print.ru: " domain
  domain=${domain#http://}; domain=${domain#https://}; domain=${domain%%/*}
  [ -n "$domain" ] || die "Домен не указан"
  set_env "$ROOT_ENV" POSTER_DOMAIN "POSTER_DOMAIN=$domain"
fi
base=$(get_env "$ROOT_ENV" POSTER_BASE_PATH)
echo "Домен: $domain · система: https://$domain${base:-}/ · сайт: https://$domain/"

# ---------------------------------------------------------------- 2. poster-ocr/.env
if [ ! -f "$APP_ENV" ]; then
  say "Настройки системы ($APP_ENV)"
  cp poster-ocr/.env.example "$APP_ENV"
fi
secret=$(get_env "$APP_ENV" POSTER_SECRET_KEY)
if [ ${#secret} -lt 32 ]; then
  # 48 случайных байт в base64url — как secrets.token_urlsafe(48)
  secret=$(head -c 48 /dev/urandom | base64 | tr '+/' '-_' | tr -d '=\n')
  set_env "$APP_ENV" POSTER_SECRET_KEY "POSTER_SECRET_KEY=$secret"
  echo "Ключ подписи сессий сгенерирован (POSTER_SECRET_KEY)."
fi
if [ -z "$(get_env "$APP_ENV" POSTER_BACKUP_AT)" ]; then
  set_env "$APP_ENV" POSTER_BACKUP_AT "POSTER_BACKUP_AT=03:30"
  echo "Ежедневная копия базы — в 03:30 (POSTER_BACKUP_AT)."
fi
# в файлах — пароль и ключи: читать их должен только владелец
chmod 600 "$ROOT_ENV" "$APP_ENV"

# ---------------------------------------------------------------- 3. папка данных
say "Папка данных (data/)"
$SUDO mkdir -p data/backups data/designs data/logs
# Docker создал бы её сам, но от root — и приложение в контейнере (не root)
# не смогло бы открыть базу: «unable to open database file»
$SUDO chown -R "$APP_UID:$APP_UID" data
echo "data/ принадлежит uid $APP_UID — пользователю приложения в контейнере."

# ---------------------------------------------------------------- 4. сборка
say "Сборка образов (первый раз — несколько минут)"
docker compose build

# ---------------------------------------------------------------- 5. пароль администратора
if [ -z "$(get_env "$APP_ENV" POSTER_ADMIN_PASSWORD_HASH)" ]; then
  say "Пароль администратора"
  echo "Не короче 10 знаков. Им входят в систему как «Администратор» и видят API-ключи."
  while :; do
    read -rsp "Пароль: " pw1; echo
    read -rsp "Ещё раз: " pw2; echo
    [ "$pw1" = "$pw2" ] || { warn "Не совпали, ещё раз"; continue; }
    # хэш считает сама система — тем же кодом, что проверяет вход; пароль
    # идёт по трубе, а не в командной строке (её видно в списке процессов)
    if line=$(printf '%s\n' "$pw1" \
        | docker compose run --rm --no-deps -T app python -m scripts.set_password --print --stdin \
        | grep '^POSTER_ADMIN_PASSWORD_HASH='); then
      break
    fi
    warn "Пароль не подошёл (причина — строкой выше), ещё раз"
  done
  unset pw1 pw2
  set_env "$APP_ENV" POSTER_ADMIN_PASSWORD_HASH "$line"
  echo "Хэш пароля записан в $APP_ENV."
fi
if [ -n "$(get_env "$APP_ENV" POSTER_ADMIN_PASSWORD)" ]; then
  warn "В $APP_ENV осталась строка POSTER_ADMIN_PASSWORD с открытым паролем — удалите её"
fi

# ---------------------------------------------------------------- 6. запуск
say "Запуск"
docker compose up -d
printf 'Жду, пока система ответит'
for _ in $(seq 1 30); do
  if docker compose exec -T app python -c \
      "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3)" \
      >/dev/null 2>&1; then
    echo " — готово."
    cat <<EOF

Сайт:     https://$domain/
Система:  https://$domain${base:-}/        (вход: «Администратор» и пароль выше)

Сертификат Let's Encrypt Caddy выпустит сам при первом заходе — для этого
домен должен указывать на этот сервер, а порты 80 и 443 быть открыты:
  ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw enable

Дальше: заведите сотрудников («Сотрудники»), каждому — пароль. Ключи для
ботов и программ — там же, в профиле (гайд: poster-ocr/API.md).
Обновление:  git pull && docker compose up -d --build
Журнал:      docker compose logs -f app
EOF
    exit 0
  fi
  printf '.'; sleep 2
done
echo
warn "Система не ответила за минуту. Последние строки журнала:"
docker compose logs --tail 40 app
exit 1
