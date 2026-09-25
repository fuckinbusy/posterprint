#!/usr/bin/env bash
# Состояние CRM: как запущена, отвечает ли, версия, база, копии, хвост лога.
# Код выхода 0 — сервер отвечает, 1 — нет.

. "$(dirname "$0")/common.sh"

say info "ПОСТЕР CRM · $(date '+%d.%m.%Y %H:%M:%S') · $BASE"
m="$(mode)"
case "$m" in
    systemd)
        note "режим:      служба systemd $SERVICE"
        note "служба:     $(systemctl is-active "$SERVICE" 2>/dev/null || true), автозапуск: $(systemctl is-enabled "$SERVICE" 2>/dev/null || true)"
        pid="$(systemctl show -p MainPID --value "$SERVICE" 2>/dev/null || true)"
        [ -n "$pid" ] && [ "$pid" != 0 ] && note "pid:        $pid"
        ;;
    cron)
        note "режим:      cron (@reboot + сторож)"
        if pid_alive; then note "процесс:    работает, pid $(cat "$PID_FILE")"; else note "процесс:    не запущен"; fi
        [ -f "$STOP_MARK" ] && note "остановлен вручную (stop.sh) — сторож не поднимает до run.sh или перезагрузки"
        ;;
    none)
        note "режим:      автозапуск не настроен"
        if pid_alive; then note "процесс:    работает, pid $(cat "$PID_FILE")"; else note "процесс:    не запущен"; fi
        ;;
esac
note "адрес:      http://${HOST}:${PORT}/"
if health_ok; then
    note "здоровье:   отвечает ($HEALTH)"
    up=0
else
    note "здоровье:   НЕ отвечает ($HEALTH)"
    up=1
fi
[ -x "$PY" ] && note "python:     $("$PY" --version 2>&1)" || note "python:     .venv нет — bash $HERE/setup.sh"
[ -f "$VERSION_FILE" ] && note "версия:     $(cat "$VERSION_FILE")" || note "версия:     не записана (update.sh ещё не запускался)"
if [ -f "$APP/poster.db" ]; then
    note "база:       $APP/poster.db, $(du -h "$APP/poster.db" | cut -f1)"
else
    note "база:       ещё не создана (появится при первом запуске)"
fi
last="$(ls -1t "$APP/backups" 2>/dev/null | head -1)"
[ -n "$last" ] && note "копия:      последняя — $last" || note "копия:      ещё не делалась (bash $HERE/backup.sh)"
note "диск:       свободно $(df -h "$APP" 2>/dev/null | awk 'NR==2 {print $4}')"

say log "Последние строки журнала сервера"
if [ "$m" = systemd ] && have journalctl; then
    $SUDO journalctl -u "$SERVICE" -n 15 --no-pager 2>/dev/null | sed "s/^/[$SCRIPT] [$TAG] │ /"
elif [ -f "$OUT_FILE" ]; then
    tail -n 15 "$OUT_FILE" | sed "s/^/[$SCRIPT] [$TAG] │ /"
else
    note "(журнала пока нет)"
fi
if [ "$up" -eq 0 ]; then ok "сервер работает"; else warn "сервер не отвечает — bash $HERE/run.sh"; fi
exit $up
