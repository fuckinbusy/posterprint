#!/usr/bin/env bash
# Сменить режим сервера — что на нём запущено:
#
#   sudo bash deploy/mode.sh all    сайт и система (CRM)
#   sudo bash deploy/mode.sh crm    только система
#   sudo bash deploy/mode.sh site   только сайт
#
# Почему не просто «поправить COMPOSE_PROFILES и docker compose up -d»:
# контейнер из выключенного режима так и останется работать. Для Compose он
# не «сирота» (сервис описан в docker-compose.yml, просто профиль выключен),
# и --remove-orphans его не трогает. Скрипт гасит его явно.

set -euo pipefail
cd "$(dirname "$0")/.."

die() { printf '\033[1;31m[x]\033[0m %s\n' "$*" >&2; exit 1; }
get_env() { [ -f "$1" ] || return 0; tr -d '\r' < "$1" | sed -n "s/^$2=//p" | tail -n 1; }

mode=${1:-}
case "$mode" in all|crm|site) ;; *) die "какой режим: all, crm или site (sudo bash deploy/mode.sh crm)" ;; esac
[ -f .env ] || die "сервер ещё не настроен — sudo bash deploy/setup.sh"

# режим с системой впервые — нужна её подготовка: .env, папка данных, пароль
if [ "$mode" != site ] && [ -z "$(get_env poster-ocr/.env POSTER_ADMIN_PASSWORD_HASH)" ]; then
  sed -i "s/^COMPOSE_PROFILES=.*/COMPOSE_PROFILES=$mode/" .env
  die "система здесь ещё не настроена — запустите sudo bash deploy/setup.sh (режим $mode уже записан в .env)"
fi
[ "$mode" = crm ] || [ -n "$(get_env .env POSTER_DOMAIN)" ] || die "для сайта нужен POSTER_DOMAIN в .env"
[ "$mode" = site ] || [ -n "$(get_env .env POSTER_CRM_DOMAIN)" ] || die "для системы нужен POSTER_CRM_DOMAIN в .env"

if grep -q '^COMPOSE_PROFILES=' .env; then
  sed -i "s/^COMPOSE_PROFILES=.*/COMPOSE_PROFILES=$mode/" .env
else
  printf '\nCOMPOSE_PROFILES=%s\n' "$mode" >> .env
fi

case "$mode" in
  crm)  off=site ;;
  site) off=app ;;
  all)  off= ;;
esac
if [ -n "$off" ]; then
  # COMPOSE_PROFILES=all — чтобы Compose «видел» сервис выключенного профиля
  COMPOSE_PROFILES=all docker compose rm --stop --force "$off" >/dev/null 2>&1 || true
  echo "Остановлен и убран: $off"
fi
docker compose up -d --remove-orphans
echo "Режим: $mode. Запущено: $(docker compose ps --format '{{.Service}}' | sort | tr '\n' ' ')"
