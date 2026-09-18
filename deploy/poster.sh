#!/usr/bin/env bash
# Управление сервером ПОСТЕР на Linux одной командой.
#
#   deploy/poster.sh run                 в текущем терминале (Ctrl+C — стоп)
#   deploy/poster.sh start|stop|restart  служба systemd, если установлена; иначе фоновый
#                                        процесс (pid в logs/poster.pid). После stop сторож
#                                        сервер не поднимает — до следующего start
#   deploy/poster.sh status              жив ли процесс и отвечает ли /health
#   deploy/poster.sh logs [N]            последние N строк журнала и дальше вживую
#   deploy/poster.sh health              0 — отвечает, 1 — нет (для сторожа)
#   deploy/poster.sh watchdog            поднять, если не отвечает (для cron)
#   deploy/poster.sh install-service [--lan] [--user имя]
#                                        служба systemd: автозапуск при загрузке,
#                                        перезапуск после сбоя, сторож, без сна
#   deploy/poster.sh enable-autostart    автозапуск без systemd: @reboot и сторож в cron
#   deploy/poster.sh disable-autostart   убрать из автозапуска: служба остаётся, но при
#                                        загрузке не стартует; сторож и @reboot из cron убраны
#   deploy/poster.sh uninstall-service   снести службу целиком (файлы и данные не трогает)
#   deploy/poster.sh update              git pull, зависимости, перезапуск
#   deploy/poster.sh backup              копия базы прямо сейчас
#
# Сервер слушает $POSTER_HOST:$POSTER_PORT (по умолчанию 0.0.0.0:8000) —
# переменные можно задать в .env или перед командой:
#   POSTER_PORT=8010 deploy/poster.sh start
#
# Скрипт работает из любого каталога: сам находит корень проекта.

set -euo pipefail

# После install-service каталог закрыт для всех, кроме пользователя службы
# (chmod 700), поэтому обычному пользователю сюда не войти — нужен sudo.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." 2>/dev/null && pwd)" \
    || { echo 'Ошибка: нет доступа к каталогу проекта — запустите через sudo' >&2; exit 1; }
cd "$ROOT"
# всё, что создаёт сервер (база, копии, журналы), — только владельцу
umask 077

# интерпретатор из окружения проекта; на Windows под Git Bash — своя раскладка
if [ -x .venv/bin/python ]; then PY=".venv/bin/python"
elif [ -x .venv/Scripts/python.exe ]; then PY=".venv/Scripts/python.exe"
else PY=""; fi

# .env читает сам сервер; здесь нужны только адрес и порт
env_value() { grep -E "^$1=" .env 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '\r' | xargs || true; }
HOST="${POSTER_HOST:-$(env_value POSTER_HOST)}"; HOST="${HOST:-0.0.0.0}"
PORT="${POSTER_PORT:-$(env_value POSTER_PORT)}"; PORT="${PORT:-8000}"
HEALTH="http://127.0.0.1:${PORT}/health"

PID_FILE="logs/poster.pid"
OUT_FILE="logs/uvicorn.out"
# метка «остановлен намеренно»: пока она есть, сторож не поднимает сервер
STOP_MARK="logs/poster.stopped"
SERVICE="poster"

# служба управляется от root; из-под обычного пользователя — через sudo
SUDO=""
if [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1; then SUDO="sudo"; fi

# Служба уже установлена — порт берём из её файла: это тот порт, на котором
# она на самом деле слушает. Иначе сторож из cron (он не видит переменных
# оболочки, с которыми ставили службу) стучался бы не туда и перезапускал
# здоровый сервер каждую минуту.
UNIT_FILE="/etc/systemd/system/$SERVICE.service"
if [ "${1:-}" != "install-service" ] && [ -f "$UNIT_FILE" ]; then
    unit_port="$(grep -oE -- '--port [0-9]+' "$UNIT_FILE" | head -1 | tr -dc '0-9' || true)"
    if [ -n "$unit_port" ]; then PORT="$unit_port"; HEALTH="http://127.0.0.1:${PORT}/health"; fi
fi

say()  { printf '%s\n' "$*"; }
die()  { printf 'Ошибка: %s\n' "$*" >&2; exit 1; }
need_venv() { [ -n "$PY" ] || die "нет окружения .venv — сначала deploy/install.sh"; }
have() { command -v "$1" >/dev/null 2>&1; }

uvicorn_cmd() { echo "$PY" -m uvicorn app.main:app --host "$HOST" --port "$PORT" --workers 1; }

# без конвейера: при pipefail «systemctl | grep -q» изредка падал по SIGPIPE,
# и скрипт принимал установленную службу за отсутствующую
service_exists() { have systemctl && { [ -f "/etc/systemd/system/$SERVICE.service" ] || systemctl cat "$SERVICE" >/dev/null 2>&1; }; }
service_active() { have systemctl && systemctl is-active --quiet "$SERVICE" 2>/dev/null; }

pid_alive() {
    [ -f "$PID_FILE" ] || return 1
    local pid; pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

health_ok() { curl -sf -m 5 "$HEALTH" >/dev/null 2>&1; }

wait_health() {
    local i
    for i in $(seq 1 30); do
        health_ok && return 0
        sleep 1
    done
    return 1
}

# ---------------------------------------------------------------- команды
cmd_run() {
    need_venv
    say "Сервер на http://${HOST}:${PORT}/ — Ctrl+C, чтобы остановить"
    exec $(uvicorn_cmd)
}

cmd_start() {
    need_venv
    mkdir -p logs
    rm -f "$STOP_MARK"
    if service_exists; then
        if service_active; then say "Служба уже работает"; return 0; fi
        $SUDO systemctl start "$SERVICE"
        if wait_health; then say "Служба запущена: http://${HOST}:${PORT}/"; else die "служба не ответила — $SUDO journalctl -u $SERVICE -n 50"; fi
        return 0
    fi
    if pid_alive; then say "Уже запущен (pid $(cat "$PID_FILE"))"; return 0; fi
    # nohup и setsid: процесс переживёт закрытие терминала и выход из ssh
    # (setsid есть на Linux; под Git Bash на Windows обходимся nohup)
    if have setsid; then
        nohup setsid $(uvicorn_cmd) >>"$OUT_FILE" 2>&1 < /dev/null &
    else
        nohup $(uvicorn_cmd) >>"$OUT_FILE" 2>&1 < /dev/null &
    fi
    echo $! >"$PID_FILE"
    if wait_health; then
        say "Запущен: pid $(cat "$PID_FILE"), http://${HOST}:${PORT}/"
    else
        die "процесс не ответил на $HEALTH за 30 с — смотрите $OUT_FILE"
    fi
}

cmd_stop() {
    # метка ставится первой: иначе сторож из cron поднимет сервер через минуту
    mkdir -p logs
    touch "$STOP_MARK"
    if service_exists; then
        $SUDO systemctl stop "$SERVICE"
        say "Служба остановлена. Сторож её не поднимет, пока не сделать: deploy/poster.sh start"
        return 0
    fi
    if ! pid_alive; then say "Не запущен"; rm -f "$PID_FILE"; return 0; fi
    local pid; pid="$(cat "$PID_FILE")"
    kill "$pid" 2>/dev/null || true
    local i
    for i in $(seq 1 15); do
        kill -0 "$pid" 2>/dev/null || break
        sleep 1
    done
    kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null || true
    rm -f "$PID_FILE"
    say "Остановлен"
}

cmd_status() {
    [ -f "$STOP_MARK" ] && say "Остановлен намеренно (deploy/poster.sh stop) — сторож не вмешивается"
    if service_exists; then
        say "Служба systemd: $(systemctl is-active "$SERVICE" 2>/dev/null || true), автозапуск: $(systemctl is-enabled "$SERVICE" 2>/dev/null || true)"
    elif pid_alive; then
        say "Фоновый процесс: pid $(cat "$PID_FILE")"
    else
        say "Процесс не запущен"
    fi
    if health_ok; then say "Отвечает: $HEALTH"; else say "Не отвечает: $HEALTH"; return 1; fi
}

cmd_logs() {
    local n="${1:-100}"
    if service_active && have journalctl; then exec journalctl -u "$SERVICE" -n "$n" -f; fi
    [ -f logs/poster.log ] || die "журнала ещё нет — сервер не запускался"
    exec tail -n "$n" -f logs/poster.log
}

cmd_health() { health_ok && { say "ok"; return 0; } || { say "нет ответа"; return 1; }; }

cmd_watchdog() {
    # для cron раз в минуту: тихо, если всё хорошо или остановили намеренно
    [ -f "$STOP_MARK" ] && return 0
    # три попытки с паузой: одна неудача — ещё не повод ронять всем работу
    # (сервер мог быть занят копией или только что перезапущен)
    local try
    for try in 1 2 3; do
        health_ok && return 0
        sleep 5
    done
    if service_exists; then
        $SUDO systemctl restart "$SERVICE" && say "$(date '+%d.%m %H:%M') сторож: служба перезапущена"
    else
        pid_alive && cmd_stop >/dev/null
        cmd_start >/dev/null && say "$(date '+%d.%m %H:%M') сторож: процесс поднят заново"
    fi
}

cmd_install_service() {
    have systemctl || die "нет systemd — используйте enable-autostart"
    [ "$(id -u)" -eq 0 ] || die "нужен root: sudo deploy/poster.sh install-service"
    need_venv
    local user="poster" lan=0
    while [ $# -gt 0 ]; do
        case "$1" in
            --lan) lan=1 ;;
            --user) user="$2"; shift ;;
            *) die "неизвестный параметр $1" ;;
        esac
        shift
    done

    id "$user" >/dev/null 2>&1 || useradd --system --home "$ROOT" --shell /usr/sbin/nologin "$user"
    chown -R "$user:$user" "$ROOT"
    chmod 700 "$ROOT"
    [ -f .env ] && chmod 600 .env
    [ -f .secret ] && chmod 600 .secret

    # юнит из deploy/poster.service, но с настоящими путём и пользователем
    local unit="/etc/systemd/system/$SERVICE.service"
    sed -e "s#/opt/poster#$ROOT#g" -e "s#^User=poster#User=$user#" -e "s#^Group=poster#Group=$user#" \
        deploy/poster.service >"$unit"
    if [ "$lan" -eq 1 ]; then
        # своя сеть без прокси: слушать все интерфейсы, строгий режим не нужен
        sed -i -e "s#--host 127.0.0.1#--host 0.0.0.0#" -e "/^Environment=POSTER_PUBLIC=1/d" "$unit"
    fi
    sed -i -e "s#--port 8000#--port $PORT#" "$unit"
    # ProtectHome=true прячет /home и /root целиком — проект внутри них служба
    # бы не увидела; read-only оставляет домашние каталоги видимыми, а запись
    # в сам проект разрешает ReadWritePaths
    case "$ROOT" in /home/*|/root/*) sed -i -e "s#^ProtectHome=true#ProtectHome=read-only#" "$unit" ;; esac
    chmod 644 "$unit"   # umask выше закрыл бы юнит от чтения — systemd на это ворчит
    systemctl daemon-reload
    systemctl enable --now "$SERVICE"

    # система не должна засыпать: сервер в мастерской работает круглосуточно
    systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target >/dev/null 2>&1 || true

    # сторож раз в минуту: живой, но зависший процесс systemd сам не заметит.
    # Через bash: в git у скрипта может не быть права на исполнение, и cron
    # молча получал бы «Permission denied» каждую минуту.
    remove_cron_lines
    install_cron_line "* * * * * bash $ROOT/deploy/poster.sh watchdog >> $ROOT/logs/watchdog.log 2>&1"

    say "Служба $SERVICE установлена: автозапуск при загрузке, перезапуск после сбоя, сторож в cron."
    say "Проверка: systemctl status $SERVICE · curl $HEALTH"
    if wait_health; then say "Отвечает: $HEALTH"; else say "Пока не отвечает — journalctl -u $SERVICE -n 50"; fi
}

cmd_enable_autostart() {
    # без systemd (контейнер, экзотика): cron поднимает при загрузке и сторожит
    have crontab || die "нет cron — установите cron или используйте install-service"
    need_venv
    remove_cron_lines   # прежние строки (в том числе старого вида, без bash) — долой
    install_cron_line "@reboot sleep 20 && bash $ROOT/deploy/poster.sh start >> $ROOT/logs/watchdog.log 2>&1"
    install_cron_line "* * * * * bash $ROOT/deploy/poster.sh watchdog >> $ROOT/logs/watchdog.log 2>&1"
    say "Автозапуск через cron включён для пользователя $(whoami): @reboot и сторож раз в минуту."
    say "Проверить: crontab -l"
}

install_cron_line() {
    local line="$1"
    local current; current="$(crontab -l 2>/dev/null || true)"
    grep -Fqx -- "$line" <<<"$current" && return 0
    printf '%s\n%s\n' "$current" "$line" | sed '/^$/d' | crontab -
}

remove_cron_lines() {
    # все строки cron, которые ссылаются на этот скрипт (сторож, @reboot)
    have crontab || return 0
    local current; current="$(crontab -l 2>/dev/null || true)"
    [ -n "$current" ] || return 0
    local rest; rest="$(printf '%s\n' "$current" | grep -Fv "$ROOT/deploy/poster.sh" || true)"
    if [ -z "$rest" ]; then crontab -r 2>/dev/null || true; else printf '%s\n' "$rest" | crontab -; fi
}

cmd_disable_autostart() {
    local removed=0
    if service_exists; then
        [ "$(id -u)" -eq 0 ] || [ -n "$SUDO" ] || die "нужен root: sudo deploy/poster.sh disable-autostart"
        $SUDO systemctl disable --now "$SERVICE" 2>/dev/null && removed=1
        say "Служба $SERVICE выключена и убрана из автозапуска (файл службы остался — вернуть: deploy/poster.sh start и sudo systemctl enable $SERVICE)"
    fi
    # cron: и от текущего пользователя, и от root (install-service писал от root)
    remove_cron_lines
    if [ "$(id -u)" -ne 0 ] && [ -n "$SUDO" ]; then
        $SUDO bash -c "$(declare -f have remove_cron_lines); ROOT='$ROOT'; remove_cron_lines" 2>/dev/null || true
    fi
    pid_alive && cmd_stop
    rm -f "$STOP_MARK"
    [ "$removed" -eq 1 ] || say "Строки автозапуска и сторожа убраны из cron"
}

cmd_uninstall_service() {
    have systemctl || die "нет systemd"
    [ "$(id -u)" -eq 0 ] || die "нужен root: sudo deploy/poster.sh uninstall-service"
    cmd_disable_autostart
    rm -f "/etc/systemd/system/$SERVICE.service"
    systemctl daemon-reload
    # спящий режим снова разрешён — как было до установки
    systemctl unmask sleep.target suspend.target hibernate.target hybrid-sleep.target >/dev/null 2>&1 || true
    say "Служба $SERVICE удалена. Код, база и копии в $ROOT не тронуты; пользователь $SERVICE оставлен."
}

cmd_update() {
    need_venv
    # Каталог принадлежит пользователю службы, а обновляет обычно root: git без
    # safe.directory отказался бы («dubious ownership»). fileMode=false — чтобы
    # chmod +x на скриптах не считался правкой и не мешал pull.
    git -c safe.directory="$ROOT" -c core.fileMode=false pull --ff-only
    "$PY" -m pip install -q -r requirements.txt \
        || say "зависимости не обновились (нет сети?) — если requirements.txt не менялся, это не страшно"
    chmod +x deploy/*.sh 2>/dev/null || true
    # новые файлы от root вернуть владельцу каталога — иначе служба не сможет в них писать
    if [ "$(id -u)" -eq 0 ]; then
        local owner; owner="$(stat -c '%U:%G' "$ROOT" 2>/dev/null || true)"
        [ -n "$owner" ] && [ "$owner" != "root:root" ] && chown -R "$owner" "$ROOT"
    fi
    if service_exists; then
        $SUDO systemctl restart "$SERVICE"
        say "Обновлено, служба перезапущена"
    elif pid_alive; then
        cmd_stop >/dev/null; cmd_start
    else
        say "Обновлено; сервер не был запущен"
    fi
}

cmd_backup() { need_venv; "$PY" -m scripts.backup "$@"; }

cmd_help() { sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; }

case "${1:-help}" in
    run) cmd_run ;;
    start) cmd_start ;;
    stop) cmd_stop ;;
    restart) if service_exists; then $SUDO systemctl restart "$SERVICE" && rm -f "$STOP_MARK" && say "Служба перезапущена"; else cmd_stop; cmd_start; fi ;;
    status) cmd_status ;;
    logs) shift; cmd_logs "$@" ;;
    health) cmd_health ;;
    watchdog) cmd_watchdog ;;
    install-service) shift; cmd_install_service "$@" ;;
    enable-autostart) cmd_enable_autostart ;;
    disable-autostart) cmd_disable_autostart ;;
    uninstall-service) cmd_uninstall_service ;;
    update) cmd_update ;;
    backup) shift; cmd_backup "$@" ;;
    help|-h|--help) cmd_help ;;
    *) die "неизвестная команда: $1 (deploy/poster.sh help)" ;;
esac
