#!/usr/bin/env bash
# Общее для скриптов deploy_local: пути, вывод, режим запуска (systemd или
# cron), запуск и остановка процесса. Сам по себе не запускается —
# подключается из setup.sh, run.sh, stop.sh, status.sh, update.sh, backup.sh:
#     . "$(dirname "$0")/common.sh"
#
# Формат вывода — каждая строка с префиксом, чтобы в консоли и в логе было
# видно, какой скрипт и на каком этапе это напечатал:
#     [SETUP] ──── Шаг 3 из 8 · Окружение .venv
#     [SETUP] [VENV] $ /usr/bin/python3.10 -m venv .venv      команда
#     [SETUP] [VENV] │ Collecting fastapi                       её вывод
#     [SETUP] [VENV] [!] предупреждение
#     [SETUP] [ERROR] что не так и что сделать
#     [SETUP] [OK] готово
# Всё напечатанное дублируется в poster-ocr/logs/deploy_local.log.

set -u

# ---------------------------------------------------------------- пути
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"   # deploy_local/
BASE="$(cd "$HERE/.." && pwd)"                          # папка установки
APP="$BASE/poster-ocr"                                  # код и данные системы
VENV="$APP/.venv"
PY="$VENV/bin/python"
LOG_DIR="$APP/logs"
LOG="$LOG_DIR/deploy_local.log"
PID_FILE="$LOG_DIR/poster.pid"
OUT_FILE="$LOG_DIR/uvicorn.out"       # вывод сервера в режиме cron
STOP_MARK="$LOG_DIR/stopped-by-hand"  # stop.sh поставил — сторож не поднимает
VERSION_FILE="$APP/VERSION_LOCAL"
SERVICE="poster-local"
UNIT="/etc/systemd/system/$SERVICE.service"
CRON_TAG="# poster-local"

# ---------------------------------------------------------------- вывод
SCRIPT="$(basename "${0%.sh}" | tr '[:lower:]' '[:upper:]')"
TAG="INFO"
upper() { printf '%s' "$1" | tr '[:lower:]' '[:upper:]'; }

# Всё, что печатается, уходит и на экран, и в лог. Вызывать в начале скрипта.
log_start() {
    mkdir -p "$LOG_DIR" 2>/dev/null || true
    if [ -w "$LOG_DIR" ]; then
        exec > >(tee -a "$LOG") 2>&1
    fi
    printf '\n[%s] ════ %s · %s@%s · %s\n' "$SCRIPT" "$(date '+%d.%m.%Y %H:%M:%S')" "$(id -un)" "$(hostname 2>/dev/null || echo ?)" "$1"
    printf '[%s] [INFO] папка установки: %s\n' "$SCRIPT" "$BASE"
}
# step НОМЕР ВСЕГО ЭТАП «Название» — заголовок шага; ЭТАП идёт во второй скобке до следующего step
step() { TAG="$(upper "$3")"; printf '\n[%s] ──── Шаг %s из %s · %s\n' "$SCRIPT" "$1" "$2" "$4"; }
# say ЭТАП «Название» — заголовок без номера
say()  { TAG="$(upper "$1")"; printf '\n[%s] ──── %s\n' "$SCRIPT" "$2"; }
tag()  { TAG="$(upper "$1")"; }
note() { printf '[%s] [%s] %s\n' "$SCRIPT" "$TAG" "$*"; }
warn() { printf '[%s] [%s] [!] %s\n' "$SCRIPT" "$TAG" "$*"; }
ok()   { printf '[%s] [OK] %s\n' "$SCRIPT" "$*"; }
die()  { printf '%s\n' "$*" | sed "1s/^/[$SCRIPT] [ERROR] /; 2,\$s/^/[$SCRIPT] [ERROR]   /" >&2; exit 1; }
# печатает команду, выполняет её; каждую строку вывода помечает префиксом и «│»
run()  {
    note "\$ $*"
    "$@" 2>&1 | sed "s/^/[$SCRIPT] [$TAG] │ /"
    return "${PIPESTATUS[0]}"
}
have() { command -v "$1" >/dev/null 2>&1; }

# ---------------------------------------------------------------- настройки
env_value() { grep -E "^$1=" "$APP/.env" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '\r' | xargs || true; }
PORT="${POSTER_PORT:-$(env_value POSTER_PORT)}"; PORT="${PORT:-8000}"
HOST="${POSTER_HOST:-$(env_value POSTER_HOST)}"; HOST="${HOST:-0.0.0.0}"
HEALTH="http://127.0.0.1:${PORT}/health"

SUDO=""
if [ "$(id -u)" -ne 0 ] && have sudo; then SUDO="sudo"; fi

need_venv() { [ -x "$PY" ] || die "нет окружения $VENV — сначала: bash $HERE/setup.sh"; }
uvicorn_cmd() { echo "$PY" -m uvicorn app.main:app --host "$HOST" --port "$PORT" --workers 1; }

# ---------------------------------------------------------------- режим
# systemd есть, если systemctl не только лежит на диске, но и отвечает
# (в контейнерах и на части NAS файл есть, а systemd не запущен)
have_systemd() { have systemctl && systemctl list-units --type=service >/dev/null 2>&1; }
have_cron() { have crontab; }
service_installed() { [ -f "$UNIT" ]; }
service_active() { have_systemd && systemctl is-active --quiet "$SERVICE" 2>/dev/null; }
cron_installed() { have_cron && crontab -l 2>/dev/null | grep -q "$CRON_TAG"; }

# как система запущена сейчас: systemd | cron | none
mode() {
    if service_installed && have_systemd; then echo systemd
    elif cron_installed; then echo cron
    else echo none
    fi
}

pid_alive() {
    [ -f "$PID_FILE" ] || return 1
    local pid; pid="$(cat "$PID_FILE" 2>/dev/null)"
    [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}
health_ok() { curl -sf -m 5 "$HEALTH" >/dev/null 2>&1; }
wait_health() {
    local i
    for i in $(seq 1 "${1:-40}"); do
        health_ok && return 0
        sleep 1
    done
    return 1
}

# ---------------------------------------------------------------- процесс (режим cron)
start_process() {
    need_venv
    if pid_alive; then note "уже запущен: pid $(cat "$PID_FILE")"; return 0; fi
    if health_ok; then die "порт $PORT уже занят кем-то другим (ответил на $HEALTH), а pid-файла нет"; fi
    mkdir -p "$LOG_DIR"
    note "запускаю: $(uvicorn_cmd)"
    note "вывод сервера: $OUT_FILE"
    cd "$APP" || die "нет папки $APP"
    # nohup + setsid: процесс переживёт закрытие терминала и выход из ssh
    if have setsid; then
        nohup setsid $(uvicorn_cmd) >>"$OUT_FILE" 2>&1 </dev/null &
    else
        nohup $(uvicorn_cmd) >>"$OUT_FILE" 2>&1 </dev/null &
    fi
    echo $! >"$PID_FILE"
    rm -f "$STOP_MARK"
    if wait_health; then
        note "сервер отвечает: pid $(cat "$PID_FILE"), http://${HOST}:${PORT}/"
    else
        die "сервер не ответил за 40 с — последние строки $OUT_FILE:
$(tail -n 20 "$OUT_FILE" 2>/dev/null)"
    fi
}

stop_process() {
    if ! pid_alive; then note "фоновый процесс не запущен"; rm -f "$PID_FILE"; return 0; fi
    local pid; pid="$(cat "$PID_FILE")"
    note "останавливаю pid $pid"
    kill "$pid" 2>/dev/null || true
    local i
    for i in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || break; sleep 0.5; done
    if kill -0 "$pid" 2>/dev/null; then
        warn "не остановился за 10 с — снимаю принудительно (kill -9)"
        kill -9 "$pid" 2>/dev/null || true
    fi
    rm -f "$PID_FILE"
    note "остановлен"
}

# строки cron для автозапуска и сторожа; сторож раз в минуту поднимает
# упавший сервер, но не тот, что остановили stop.sh (метка $STOP_MARK)
cron_lines() {
    printf '@reboot bash %s --boot >>%s 2>&1 %s\n' "$HERE/run.sh" "$LOG" "$CRON_TAG"
    printf '* * * * * bash %s --watchdog >>%s 2>&1 %s\n' "$HERE/run.sh" "$LOG" "$CRON_TAG"
}
install_cron() {
    local current; current="$(crontab -l 2>/dev/null | grep -v "$CRON_TAG" || true)"
    { [ -n "$current" ] && printf '%s\n' "$current"; cron_lines; } | crontab -
}
remove_cron() {
    have_cron || return 0
    local rest; rest="$(crontab -l 2>/dev/null | grep -v "$CRON_TAG" || true)"
    if [ -z "$rest" ]; then crontab -r 2>/dev/null || true; else printf '%s\n' "$rest" | crontab -; fi
}
