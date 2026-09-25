#!/usr/bin/env bash
# Убрать автозапуск и остановить CRM: удалить службу systemd или строки cron.
# Код, база, копии и макеты остаются на месте. Вернуть — bash deploy_local/run.sh.

. "$(dirname "$0")/common.sh"

log_start "uninstall.sh"
if service_installed; then
    say systemd "Удаляю службу $SERVICE"
    if have_systemd; then
        run $SUDO systemctl disable --now "$SERVICE" || true
    fi
    run $SUDO rm -f "$UNIT"
    have_systemd && run $SUDO systemctl daemon-reload
fi
if cron_installed; then
    say cron "Убираю строки cron"
    remove_cron
    note "crontab теперь: $(crontab -l 2>/dev/null | wc -l) строк"
fi
say process "Останавливаю фоновый процесс, если есть"
stop_process
rm -f "$STOP_MARK"
ok "автозапуска нет, сервер остановлен, данные в $APP не тронуты"
