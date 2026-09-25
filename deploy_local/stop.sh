#!/usr/bin/env bash
# Остановить CRM до перезагрузки. Автозапуск остаётся: после перезагрузки
# сервер поднимется сам (служба systemd или строка @reboot в cron).
# Снова запустить сейчас — bash deploy_local/run.sh.
# Убрать автозапуск совсем — bash deploy_local/uninstall.sh.

. "$(dirname "$0")/common.sh"

log_start "stop.sh"
case "$(mode)" in
    systemd)
        say systemd "Останавливаю службу $SERVICE (автозапуск не трогаю)"
        run $SUDO systemctl stop "$SERVICE" || die "systemctl stop не удался"
        note "автозапуск: $(systemctl is-enabled "$SERVICE" 2>/dev/null || echo '?') — после перезагрузки служба поднимется сама"
        ;;
    cron)
        say cron "Останавливаю фоновый процесс (строки cron остаются, сторож поднимать не будет)"
        touch "$STOP_MARK"
        stop_process
        ;;
    none)
        say plain "Автозапуск не настроен — останавливаю фоновый процесс, если он есть"
        touch "$STOP_MARK"
        stop_process
        ;;
esac
if health_ok; then
    warn "на $HEALTH всё ещё кто-то отвечает — возможно, сервер запущен другим способом"
    exit 1
fi
ok "сервер остановлен, $HEALTH не отвечает. Запустить снова: bash $HERE/run.sh"
