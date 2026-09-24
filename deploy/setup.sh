#!/usr/bin/env bash
# Первый запуск на VPS: режим, домены, настройки, пароль, сборка и старт.
#
#   cd /opt/poster && sudo bash deploy/setup.sh
#
# Что делает, по шагам (каждый шаг пропускается, если уже сделан, — скрипт
# можно запускать повторно, заданное он не трогает):
#   0. проверяет Docker и доступ к Docker Hub; нет доступа (из России так
#      бывает) — предлагает прописать зеркало;
#   1. корневой .env — режим (all / crm / site) и домены; кириллический
#      домен переводит в punycode сам;
#   2. poster-ocr/.env — из примера, с новым ключом подписи сессий и
#      ежедневной копией базы в 03:30 (только если на сервере есть система);
#   3. папка data/ — база, копии, макеты, логи; владелец — пользователь
#      приложения в контейнере (uid 1000), иначе система не сможет писать;
#   4. сборка образов;
#   5. пароль администратора — спросит и запишет хэшем;
#   6. запуск и ожидание, пока всё ответит.
#
# Нужны Docker и Compose: curl -fsSL https://get.docker.com | sh
# Подробно — deploy/README.md.

set -euo pipefail
cd "$(dirname "$0")/.."

APP_UID=1000   # пользователь poster в poster-ocr/Dockerfile
ROOT_ENV=.env
APP_ENV=poster-ocr/.env
# зеркала Docker Hub, доступные из России (проверяются по очереди)
MIRRORS="https://dh-mirror.gitverse.ru https://mirror.gcr.io https://dockerhub1.beget.com"

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
  [ -f "$1" ] || return 0
  tr -d '\r' < "$1" | sed -n "s/^$2=//p" | tail -n 1 | sed "s/^'\(.*\)'$/\1/; s/^\"\(.*\)\"$/\1/"
}

# «постерпринт.рф» → «xn--e1agpbecgbfkg.xn--p1ai»: Caddy и Let's Encrypt
# работают с доменами в punycode. Латиница проходит как есть.
to_ascii() {
  local d=$1
  d=${d#http://}; d=${d#https://}; d=${d%%/*}; d=$(printf '%s' "$d" | tr '[:upper:]' '[:lower:]')
  if printf '%s' "$d" | LC_ALL=C grep -q '[^ -~]'; then
    command -v python3 >/dev/null || die "домен с кириллицей, а python3 нет — впишите его в punycode"
    d=$(python3 -c 'import sys; print(sys.argv[1].encode("idna").decode())' "$d")
  fi
  printf '%s' "$d"
}

ask_domain() {   # вопрос, значение по умолчанию → домен в punycode
  local answer
  read -rp "$1${2:+ [$2]}: " answer
  answer=${answer:-$2}
  [ -n "$answer" ] || { printf ''; return; }
  to_ascii "$answer"
}

has() { case ",$MODE," in *",$1,"*|*",all,"*) return 0 ;; esac; return 1; }   # есть ли в режиме crm/site

# ---------------------------------------------------------------- 0. проверки
command -v docker >/dev/null || die "Нет Docker. Поставьте: curl -fsSL https://get.docker.com | sh"
docker compose version >/dev/null 2>&1 || die "Нет плагина Docker Compose (docker compose). Поставьте Docker заново скриптом get.docker.com"
[ -f docker-compose.yml ] || die "Запускайте из папки репозитория: cd /opt/poster && sudo bash deploy/setup.sh"
if [ "$(id -u)" -ne 0 ]; then
  SUDO=sudo
  warn "Скрипт запущен не от root — для папки data/ и настроек Docker понадобится sudo"
else
  SUDO=
fi

# Docker Hub из России часто недоступен: без зеркала сборка встанет на
# первом же «FROM python». 401 — реестр ответил (просит токен), это «доступен»
if [ "$(curl -s -o /dev/null -m 8 -w '%{http_code}' https://registry-1.docker.io/v2/ || true)" != "401" ]; then
  if docker info --format '{{.RegistryConfig.Mirrors}}' 2>/dev/null | grep -q 'http'; then
    echo "Docker Hub недоступен, но зеркало уже прописано: $(docker info --format '{{.RegistryConfig.Mirrors}}')"
  else
    say "Docker Hub недоступен — нужно зеркало"
    accept='Accept: application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.index.v1+json'
    found=""
    for m in $MIRRORS; do
      code=$(curl -s -o /dev/null -m 10 -w '%{http_code}' -H "$accept" "$m/v2/library/alpine/manifests/latest" || true)
      [ "$code" = "200" ] && { found=$m; break; }
    done
    [ -n "$found" ] || die "ни Docker Hub, ни зеркала ($MIRRORS) не отвечают — нужен доступ к одному из них (deploy/README.md, «Docker Hub недоступен»)"
    if [ -s /etc/docker/daemon.json ]; then
      die "в /etc/docker/daemon.json уже есть настройки — впишите туда руками \"registry-mirrors\": [\"$found\"], перезапустите docker (systemctl restart docker) и запустите скрипт снова"
    fi
    read -rp "Прописать зеркало $found в /etc/docker/daemon.json и перезапустить Docker? [Y/n] " yes
    case "${yes:-y}" in [nN]*) die "без зеркала образы не скачаются — см. deploy/README.md, «Docker Hub недоступен»" ;; esac
    printf '{\n  "registry-mirrors": ["%s"]\n}\n' "$found" | $SUDO tee /etc/docker/daemon.json >/dev/null
    $SUDO systemctl restart docker
    echo "Зеркало прописано: $found"
  fi
fi

# ---------------------------------------------------------------- 1. корневой .env
if [ ! -f "$ROOT_ENV" ]; then
  say "Настройки сервера ($ROOT_ENV)"
  cp .env.example "$ROOT_ENV"
  # пример — это пример: домены в нём настоящие, но решать их должен человек
  set_env "$ROOT_ENV" COMPOSE_PROFILES "COMPOSE_PROFILES="
  set_env "$ROOT_ENV" POSTER_DOMAIN "POSTER_DOMAIN="
  set_env "$ROOT_ENV" POSTER_CRM_DOMAIN "POSTER_CRM_DOMAIN="
fi
MODE=$(get_env "$ROOT_ENV" COMPOSE_PROFILES)
case "$MODE" in
  all|crm|site) ;;
  *)
    echo
    echo "Что запускать на этом сервере?"
    echo "  1) всё — сайт и систему (CRM)"
    echo "  2) только систему (CRM) — сайт на другом сервере, на Tilda или его пока нет"
    echo "  3) только сайт — система на другом сервере"
    read -rp "Номер [1]: " n
    case "${n:-1}" in 1) MODE=all ;; 2) MODE=crm ;; 3) MODE=site ;; *) die "нет такого варианта: $n" ;; esac
    set_env "$ROOT_ENV" COMPOSE_PROFILES "COMPOSE_PROFILES=$MODE"
    ;;
esac

site_domain=$(get_env "$ROOT_ENV" POSTER_DOMAIN)
if has site && [ -z "$site_domain" ]; then
  site_domain=$(ask_domain "Домен сайта (A-запись должна указывать на этот сервер), например постерпринт.рф")
  [ -n "$site_domain" ] || die "без домена сайт не запустить"
  set_env "$ROOT_ENV" POSTER_DOMAIN "POSTER_DOMAIN=$site_domain"
fi
crm_domain=$(get_env "$ROOT_ENV" POSTER_CRM_DOMAIN)
if [ -z "$crm_domain" ]; then
  if has crm; then
    crm_domain=$(ask_domain "Домен системы — поддомен, например crm.постерпринт.рф" "${site_domain:+crm.$site_domain}")
    [ -n "$crm_domain" ] || die "без домена систему не запустить"
  else
    crm_domain=$(ask_domain "Адрес системы для ссылки «Вход для сотрудников» на сайте (Enter — без ссылки)")
  fi
  [ -z "$crm_domain" ] || set_env "$ROOT_ENV" POSTER_CRM_DOMAIN "POSTER_CRM_DOMAIN=$crm_domain"
fi
echo "Режим: $MODE${site_domain:+ · сайт: https://$site_domain/}${crm_domain:+ · система: https://$crm_domain/}"

# Образ системы ставит пакет из Debian; из России deb.debian.org бывает в
# сотни раз медленнее (сборка висит на одном файле по полчаса). Меряем первый
# мегабайт крупного пакета: не успел за 10 с — берём зеркало Яндекса
if has crm && [ -z "$(get_env "$ROOT_ENV" POSTER_DEBIAN_MIRROR)" ]; then
  probe=pool/main/i/icu/libicu76_76.1-4_amd64.deb
  if ! curl -sf -o /dev/null -m 10 -r 0-1048575 "http://deb.debian.org/debian/$probe"; then
    if curl -sf -o /dev/null -m 10 -r 0-1048575 "https://mirror.yandex.ru/debian/$probe"; then
      set_env "$ROOT_ENV" POSTER_DEBIAN_MIRROR "POSTER_DEBIAN_MIRROR=https://mirror.yandex.ru/debian"
      echo "deb.debian.org отвечает медленно — для сборки взято зеркало mirror.yandex.ru (POSTER_DEBIAN_MIRROR)."
    fi
  fi
fi

# ---------------------------------------------------------------- 2–3. система: .env и данные
if has crm; then
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
  chmod 600 "$APP_ENV"

  say "Папка данных (data/)"
  $SUDO mkdir -p data/backups data/designs data/logs
  # Docker создал бы её сам, но от root — и приложение в контейнере (не root)
  # не смогло бы открыть базу: «unable to open database file»
  $SUDO chown -R "$APP_UID:$APP_UID" data
  echo "data/ принадлежит uid $APP_UID — пользователю приложения в контейнере."
fi
# в файлах — пароль и ключи: читать их должен только владелец
chmod 600 "$ROOT_ENV"

# ---------------------------------------------------------------- 4. сборка
say "Сборка образов (первый раз — несколько минут)"
docker compose build

# ---------------------------------------------------------------- 5. пароль администратора
if has crm && [ -z "$(get_env "$APP_ENV" POSTER_ADMIN_PASSWORD_HASH)" ]; then
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
if has crm && [ -n "$(get_env "$APP_ENV" POSTER_ADMIN_PASSWORD)" ]; then
  warn "В $APP_ENV осталась строка POSTER_ADMIN_PASSWORD с открытым паролем — удалите её"
fi

# ---------------------------------------------------------------- 6. запуск
say "Запуск"
docker compose up -d --remove-orphans

ready() {
  if has crm; then
    docker compose exec -T app python -c \
      "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3)" >/dev/null 2>&1 || return 1
  fi
  if has site; then
    docker compose exec -T site wget -q -O /dev/null http://127.0.0.1/ >/dev/null 2>&1 || return 1
  fi
}

printf 'Жду, пока всё ответит'
for _ in $(seq 1 30); do
  if ready; then
    echo " — готово."
    echo
    has site && echo "Сайт:     https://$site_domain/"
    has crm && echo "Система:  https://$crm_domain/        (вход: «Администратор» и пароль выше)"
    cat <<EOF

Сертификаты Let's Encrypt Caddy выпустит сам при первом заходе. Для этого
в DNS домена нужны A-записи на адрес этого сервера:
$(has site && echo "  $site_domain")$(has crm && printf '\n  %s' "$crm_domain")
и открытые порты 80 и 443:
  ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw enable

Сменить режим:  sudo bash deploy/mode.sh all|crm|site
Обновление:  git pull && docker compose up -d --build
Журнал:      docker compose logs -f app   (или site, caddy)
Подробно:    deploy/README.md
EOF
    exit 0
  fi
  printf '.'; sleep 2
done
echo
warn "Не ответило за минуту. Последние строки журналов:"
has crm && docker compose logs --tail 30 app
has site && docker compose logs --tail 10 site
exit 1
