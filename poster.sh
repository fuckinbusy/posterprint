#!/usr/bin/env bash
# Система (CRM) и сайт-визитка одной командой — вместе или по отдельности,
# каждый своим процессом. Для разработки и компьютера в мастерской; сервер в
# интернете — Docker (deploy/README.md).
#
#   ./poster.sh run    [all|crm|site]   в этом терминале; all — два процесса, Ctrl+C гасит оба
#   ./poster.sh start  [all|crm|site]   в фоне
#   ./poster.sh stop   [all|crm|site]
#   ./poster.sh status [all|crm|site]
#   ./poster.sh logs   crm|site         журнал вживую
#
# Что без указания — all.
#   crm   система: http://localhost:8000 — через deploy/crm/poster.sh (если
#         установлена служба systemd, start/stop управляют ею)
#   site  сайт: http://localhost:5174 — в run сервер разработки с живой
#         перезагрузкой, в start собранный сайт (npm run build + vite preview)
#
# Порт системы — POSTER_PORT (8000), сайта — POSTER_SITE_PORT (5174).
# Windows без Git Bash — .\poster.ps1 с теми же командами.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CRM="$REPO/deploy/crm/poster.sh"
SITE_DIR="$REPO/poster-website"
SITE_PORT="${POSTER_SITE_PORT:-5174}"
SITE_PID="$SITE_DIR/.site.pid"
SITE_LOG="$SITE_DIR/site.log"

say() { printf '%s\n' "$*"; }
die() { printf 'Ошибка: %s\n' "$*" >&2; exit 1; }

# vite зовём напрямую, без npm: тогда pid — это сам сервер, и stop гасит
# именно его, а не обёртку npm, оставляя vite работать сиротой
vite() { (cd "$SITE_DIR" && exec node node_modules/vite/bin/vite.js "$@"); }

# Погасить процесс вместе с детьми. В Git Bash на Windows «exec node» из
# оболочки MSYS оставляет обёртку: kill гасит её, а сам node (сервер сайта)
# продолжает работать. Там у процесса есть настоящий Windows-pid — по нему
# taskkill /T снимает всё дерево. На Linux это обычный kill.
kill_tree() {
    local pid
    for pid in "$@"; do
        if [ -r "/proc/$pid/winpid" ] && command -v taskkill >/dev/null 2>&1; then
            taskkill //F //T //PID "$(cat "/proc/$pid/winpid")" >/dev/null 2>&1 || true
        fi
        kill "$pid" 2>/dev/null || true
    done
}

site_deps() {
    command -v node >/dev/null 2>&1 || die "нет Node.js — поставьте Node 20+ (https://nodejs.org)"
    [ -d "$SITE_DIR/node_modules" ] || { say "Ставлю зависимости сайта (npm ci)…"; (cd "$SITE_DIR" && npm ci --no-audit --no-fund); }
}

site_alive() {
    [ -f "$SITE_PID" ] || return 1
    local pid; pid="$(cat "$SITE_PID" 2>/dev/null || true)"
    [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

site_run() { site_deps; say "Сайт: http://localhost:$SITE_PORT/ — Ctrl+C, чтобы остановить"; vite --port "$SITE_PORT" --strictPort; }

site_start() {
    site_alive && { say "Сайт уже запущен (pid $(cat "$SITE_PID"))"; return 0; }
    site_deps
    say "Собираю сайт…"
    (cd "$SITE_DIR" && npm run build --silent) >/dev/null
    (cd "$SITE_DIR" && exec nohup node node_modules/vite/bin/vite.js preview --port "$SITE_PORT" --strictPort --host \
        >>"$SITE_LOG" 2>&1 < /dev/null) &
    echo $! >"$SITE_PID"
    local i
    for i in $(seq 1 20); do
        curl -sf -m 2 "http://127.0.0.1:$SITE_PORT/" >/dev/null 2>&1 && { say "Сайт: http://localhost:$SITE_PORT/ (pid $(cat "$SITE_PID"))"; return 0; }
        sleep 0.5
    done
    die "сайт не ответил — смотрите $SITE_LOG"
}

site_stop() {
    site_alive || { say "Сайт не запущен"; rm -f "$SITE_PID"; return 0; }
    kill_tree "$(cat "$SITE_PID")"
    rm -f "$SITE_PID"
    say "Сайт остановлен"
}

site_status() {
    if site_alive; then say "Сайт: запущен, pid $(cat "$SITE_PID"), http://localhost:$SITE_PORT/"; else say "Сайт: не запущен"; return 1; fi
}

# run all: два процесса рядом, их вывод — в этом терминале. Ctrl+C или
# падение любого — гасим оба: полсистемы молча работать не должно.
run_all() {
    [ -x "$REPO/poster-ocr/.venv/bin/python" ] || [ -x "$REPO/poster-ocr/.venv/Scripts/python.exe" ] \
        || die "нет окружения системы — сначала bash deploy/crm/install.sh"
    site_deps
    bash "$CRM" run & local crm=$!
    vite --port "$SITE_PORT" --strictPort & local site=$!
    trap 'kill_tree $crm $site; wait 2>/dev/null; say "Остановлены оба"; exit 0' INT TERM
    say "Система: http://localhost:${POSTER_PORT:-8000}/ · сайт: http://localhost:$SITE_PORT/ — Ctrl+C, чтобы остановить оба"
    wait -n $crm $site || true
    say "Один из процессов завершился — останавливаю второй"
    kill_tree $crm $site
    wait 2>/dev/null || true
    exit 1
}

cmd="${1:-help}"
what="${2:-all}"
case "$what" in all|crm|site) ;; *) die "что запускать: all, crm или site (а не «$what»)" ;; esac

case "$cmd" in
    run)
        case "$what" in
            crm) exec bash "$CRM" run ;;
            site) site_run ;;
            all) run_all ;;
        esac ;;
    start|stop|status)
        rc=0
        if [ "$what" != site ]; then bash "$CRM" "$cmd" || rc=$?; fi
        if [ "$what" != crm ]; then "site_$cmd" || rc=$?; fi
        exit $rc ;;
    logs)
        case "$what" in
            crm) exec bash "$CRM" logs ;;
            site) [ -f "$SITE_LOG" ] || die "журнала сайта нет — он запускался только через run"; exec tail -n 100 -f "$SITE_LOG" ;;
            *) die "журнал чего: crm или site" ;;
        esac ;;
    help|-h|--help) sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//' ;;
    *) die "неизвестная команда: $cmd (./poster.sh help)" ;;
esac
