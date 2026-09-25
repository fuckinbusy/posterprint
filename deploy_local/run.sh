#!/usr/bin/env bash
# Запуск CRM с автозапуском после перезагрузки.
#   есть systemd → служба poster-local (ставится, включается, запускается);
#   нет systemd, есть cron → строка @reboot + сторож раз в минуту, сейчас — запуск в фоне;
#   нет ни того ни другого → просто запуск в фоне (после перезагрузки повторить run.sh).
#
#   bash deploy_local/run.sh              запустить (повторный вызов — перезапуск, если уже идёт)
#   bash deploy_local/run.sh --watchdog   для cron: поднять, если упал (сам не вызывайте)
#   bash deploy_local/run.sh --boot       для cron @reboot: снять метку stop.sh и запустить

. "$(dirname "$0")/common.sh"

need_venv
[ -f "$APP/.env" ] || die "нет $APP/.env — сначала: bash $HERE/setup.sh"

case "${1:-}" in
    --watchdog)
        # молча, пока всё хорошо: иначе лог заполнится строками раз в минуту
        [ -f "$STOP_MARK" ] && exit 0
        if pid_alive && health_ok; then exit 0; fi
        tag watchdog
        note "$(date '+%d.%m.%Y %H:%M:%S') сервер не отвечает — поднимаю"
        stop_process
        start_process
        exit 0 ;;
    --boot)
        rm -f "$STOP_MARK"
        tag boot
        note "$(date '+%d.%m.%Y %H:%M:%S') запуск после перезагрузки"
        start_process
        exit 0 ;;
    "") ;;
    -h|--help) sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "неизвестный параметр: $1" ;;
esac

log_start "run.sh"
rm -f "$STOP_MARK"

if have_systemd; then
    say systemd "Режим: служба systemd «$SERVICE», пользователь $(id -un)"
    [ "$(id -u)" -eq 0 ] || [ -n "$SUDO" ] || die "для службы systemd нужен root или sudo"
    unit_text="[Unit]
Description=ПОСТЕР CRM (deploy_local)
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=0

[Service]
User=$(id -un)
Group=$(id -gn)
WorkingDirectory=$APP
EnvironmentFile=$APP/.env
ExecStart=$(uvicorn_cmd)
Restart=always
RestartSec=5
UMask=0077

[Install]
WantedBy=multi-user.target"
    if [ -f "$UNIT" ] && [ "$(cat "$UNIT")" = "$unit_text" ]; then
        note "файл службы $UNIT уже такой же"
    else
        note "пишу $UNIT:"
        printf '%s\n' "$unit_text" | sed "s/^/[$SCRIPT] [$TAG] │ /"
        printf '%s\n' "$unit_text" | $SUDO tee "$UNIT" >/dev/null || die "не удалось записать $UNIT"
        run $SUDO systemctl daemon-reload
    fi
    # процесс, запущенный когда-то через cron/nohup, отдал бы «порт занят»
    if pid_alive; then note "нашёл старый фоновый процесс — останавливаю"; stop_process; fi
    if cron_installed; then note "убираю строки cron — теперь за автозапуск отвечает systemd"; remove_cron; fi
    run $SUDO systemctl enable "$SERVICE"
    if service_active; then
        run $SUDO systemctl restart "$SERVICE"
    else
        run $SUDO systemctl start "$SERVICE"
    fi
    if wait_health; then
        ok "служба запущена: http://${HOST}:${PORT}/ · автозапуск включён"
        note "журнал: ${SUDO:+$SUDO }journalctl -u $SERVICE -n 50 · статус: bash $HERE/status.sh"
    else
        run $SUDO systemctl status "$SERVICE" --no-pager -n 20 || true
        die "служба не ответила на $HEALTH за 40 с — смотрите журнал выше"
    fi
elif have_cron; then
    say cron "Режим: cron (@reboot + сторож раз в минуту) — systemd в этой системе нет"
    if pid_alive; then note "уже запущен — перезапускаю"; stop_process; fi
    start_process
    note "строки в crontab пользователя $(id -un):"
    cron_lines | sed "s/^/[$SCRIPT] [$TAG] │ /"
    install_cron || die "не удалось записать crontab"
    if pgrep -x cron >/dev/null 2>&1 || pgrep -x crond >/dev/null 2>&1; then
        note "демон cron работает"
    else
        warn "демон cron (cron/crond) не запущен — строки записаны, но сработают только когда он заработает"
    fi
    ok "запущен: http://${HOST}:${PORT}/ · автозапуск через cron"
    note "вывод сервера: $OUT_FILE · статус: bash $HERE/status.sh"
else
    say plain "Режим: без автозапуска — нет ни systemd, ни cron"
    if pid_alive; then note "уже запущен — перезапускаю"; stop_process; fi
    start_process
    ok "запущен: http://${HOST}:${PORT}/"
    warn "после перезагрузки сервера запустите снова: bash $HERE/run.sh"
fi
