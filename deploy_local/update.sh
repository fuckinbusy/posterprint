#!/usr/bin/env bash
# Обновление CRM с GitHub без git: скачать архив ветки main через curl,
# распаковать только poster-ocr и deploy_local поверх кода, обновить
# зависимости, перезапустить. Данные (.env, база, копии, макеты, логи, .venv)
# не трогаются. Перед обновлением делается копия базы (backup.sh).
#
#   bash deploy_local/update.sh               обновить
#   bash deploy_local/update.sh --no-backup   без копии базы перед обновлением
#   POSTER_BRANCH=main                        какую ветку брать (по умолчанию main)
#
# Первая установка: этот же скрипт скачает код, если папки poster-ocr ещё нет.

REPO="fuckinbusy/posterprint"
BRANCH="${POSTER_BRANCH:-main}"
ARCHIVE_URL="https://codeload.github.com/$REPO/tar.gz/refs/heads/$BRANCH"
COMMIT_URL="https://api.github.com/repos/$REPO/commits/$BRANCH"

. "$(dirname "$0")/common.sh"

main() {
    local backup=1
    while [ $# -gt 0 ]; do
        case "$1" in
            --no-backup) backup=0 ;;
            -h|--help) sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
            *) die "неизвестный параметр: $1" ;;
        esac
        shift
    done
    local first=0
    [ -d "$APP" ] || first=1
    mkdir -p "$APP/logs" 2>/dev/null || true
    log_start "update.sh $*"
    [ "$first" -eq 1 ] && note "папки poster-ocr нет — это первая установка, только скачиваю код"

    local total=6
    # ------------------------------------------------------------ 1. копия
    step 1 $total backup "Копия базы перед обновлением"
    if [ "$first" -eq 1 ] || [ ! -f "$APP/poster.db" ]; then
        note "базы ещё нет — копию делать нечего"
    elif [ "$backup" -eq 0 ]; then
        note "--no-backup: пропускаю"
    else
        bash "$HERE/backup.sh" || die "копия не сделалась — обновление остановлено, чтобы не рисковать базой"
    fi

    # ------------------------------------------------------------ 2. скачать
    step 2 $total download "Скачиваю архив ветки $BRANCH"
    local tmp; tmp="$(mktemp -d "${TMPDIR:-/tmp}/poster-update.XXXXXX")" || die "не создаётся временная папка"
    trap 'rm -rf "$tmp"' EXIT
    note "$ARCHIVE_URL"
    run curl -fsSL -o "$tmp/poster.tar.gz" "$ARCHIVE_URL" \
        || die "архив не скачался (нет интернета, или GitHub недоступен). Адрес: $ARCHIVE_URL"
    note "скачано: $(du -h "$tmp/poster.tar.gz" | cut -f1) → $tmp/poster.tar.gz"
    local commit
    commit="$(curl -fsS -m 15 "$COMMIT_URL" 2>/dev/null | grep -m1 '"sha"' | sed -E 's/.*"([0-9a-f]{40})".*/\1/' || true)"
    [ -n "$commit" ] && note "последний коммит $BRANCH: ${commit:0:12}" || note "номер коммита узнать не удалось (не страшно)"

    # ------------------------------------------------------------ 3. распаковать
    step 3 $total unpack "Распаковываю poster-ocr и deploy_local (сайт-визитку не берём)"
    run tar -xzf "$tmp/poster.tar.gz" -C "$tmp" || die "архив не распаковался"
    local src; src="$(find "$tmp" -mindepth 1 -maxdepth 1 -type d | head -1)"
    [ -d "$src/poster-ocr" ] || die "в архиве нет папки poster-ocr — структура репозитория изменилась?"
    note "архив: $(basename "$src")"
    note "копирую poster-ocr → $APP (данные не затрагиваются: их в архиве нет)"
    mkdir -p "$APP"
    cp -a "$src/poster-ocr/." "$APP/" || die "не удалось скопировать код"
    if [ -d "$src/deploy_local" ]; then
        note "копирую deploy_local → $HERE"
        cp -a "$src/deploy_local/." "$HERE/" || die "не удалось скопировать скрипты"
    else
        warn "в архиве нет deploy_local — скрипты не обновлены"
    fi
    chmod +x "$HERE"/*.sh 2>/dev/null || true
    printf '%s %s %s\n' "${commit:-?}" "$BRANCH" "$(date '+%Y-%m-%d %H:%M')" >"$VERSION_FILE"
    note "версия записана в $VERSION_FILE: $(cat "$VERSION_FILE")"
    # обновлял root, а папкой владеет другой пользователь — вернуть владельца
    if [ "$(id -u)" -eq 0 ]; then
        local owner; owner="$(stat -c '%U:%G' "$BASE" 2>/dev/null || true)"
        if [ -n "$owner" ] && [ "$owner" != "root:root" ]; then run chown -R "$owner" "$APP" "$HERE"; fi
    fi
    if [ "$first" -eq 1 ]; then
        ok "код скачан. Дальше: bash $HERE/setup.sh, затем bash $HERE/run.sh"
        exit 0
    fi

    # ------------------------------------------------------------ 4. зависимости
    step 4 $total pip "Зависимости"
    need_venv
    (cd "$APP" && run "$PY" -m pip install --timeout 120 --retries 5 -r requirements.txt) \
        || die "зависимости не обновились — сервер не перезапускаю. Нет интернета? Повторите позже"
    if ! "$PY" -c 'import sqlite3' 2>/dev/null; then
        note "sqlite3 у Python нет — проверяю замену pysqlite3"
        "$PY" -c 'import pysqlite3' 2>/dev/null || run "$PY" -m pip install --timeout 120 --retries 5 pysqlite3-binary || die "нет ни sqlite3, ни pysqlite3"
    fi
    (cd "$APP" && run "$PY" -c 'import app.main') || die "приложение не импортируется после обновления — смотрите ошибку выше"

    # ------------------------------------------------------------ 5. перезапуск
    step 5 $total restart "Перезапуск"
    case "$(mode)" in
        systemd)
            run $SUDO systemctl restart "$SERVICE" || die "systemctl restart не удался"
            ;;
        cron|none)
            if pid_alive; then stop_process; start_process; else note "сервер не был запущен — не запускаю (bash $HERE/run.sh)"; fi
            ;;
    esac

    # ------------------------------------------------------------ 6. проверка
    step 6 $total check "Проверка"
    if [ "$(mode)" = none ] && ! pid_alive; then
        note "сервер не запущен, проверять нечего"
    elif wait_health; then
        note "сервер отвечает: http://${HOST}:${PORT}/"
    else
        die "после обновления сервер не ответил на $HEALTH — bash $HERE/status.sh покажет журнал"
    fi
    ok "обновление завершено: $(cat "$VERSION_FILE")"
}

# всё тело — в функции, а вызов — одной составной командой: скрипт копирует
# поверх самого себя, а bash читает файл по ходу выполнения
{ main "$@"; exit $?; }
