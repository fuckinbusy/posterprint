#!/usr/bin/env bash
# Резервная копия базы и настроек — в poster-ocr/backups/<дата_время>/.
#   bash deploy_local/backup.sh            сделать копию
#   bash deploy_local/backup.sh --keep 30  сделать и оставить только 30 последних
#   bash deploy_local/backup.sh --list     что уже есть
# Восстановить: poster-ocr/.venv/bin/python -m scripts.restore --list

. "$(dirname "$0")/common.sh"

need_venv
log_start "backup.sh $*"
cd "$APP" || die "нет папки $APP"
case "${1:-}" in
    --list)
        say list "Существующие копии"
        run "$PY" -m scripts.backup --list ;;
    *)
        say backup "Копия базы и настроек"
        run "$PY" -m scripts.backup "$@" || die "копия не сделалась — смотрите сообщение выше"
        last="$(ls -1t backups 2>/dev/null | head -1)"
        [ -n "$last" ] && ok "копия: $APP/backups/$last ($(du -sh "backups/$last" | cut -f1))"
        ;;
esac
