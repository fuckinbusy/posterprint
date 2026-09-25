#!/usr/bin/env bash
# Первичная настройка CRM на этом компьютере (без Docker и git):
#   окружение Python, зависимости, .env, права на папки, пароль администратора.
#
#   bash deploy_local/setup.sh                    обычный запуск, пароль спросит
#   bash deploy_local/setup.sh --password-stdin   пароль одной строкой со stdin (для автоматизации)
#   bash deploy_local/setup.sh --recreate         пересоздать .venv заново
#   bash deploy_local/setup.sh --wheels ПАПКА     зависимости из папки с колёсами, без интернета
#   POSTER_PYTHON=/путь/python3.10 bash deploy_local/setup.sh   какой Python брать
#
# Повторный запуск безопасен: что уже сделано — пропускается и об этом пишется.
# Всё напечатанное дублируется в poster-ocr/logs/deploy_local.log.

. "$(dirname "$0")/common.sh"

RECREATE=0; PASSWORD_STDIN=0; WHEELS=""
while [ $# -gt 0 ]; do
    case "$1" in
        --recreate) RECREATE=1 ;;
        --password-stdin) PASSWORD_STDIN=1 ;;
        --wheels) WHEELS="$2"; shift ;;
        -h|--help) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) die "неизвестный параметр: $1 (справка: bash $0 --help)" ;;
    esac
    shift
done

[ -d "$APP" ] || die "рядом нет папки poster-ocr — сначала скачайте код (см. deploy_local/README.md)"
log_start "setup.sh $*"
cd "$APP"

TOTAL=8
# ---------------------------------------------------------------- 1. инструменты
step 1 $TOTAL tools "Что есть в системе"
for tool in bash curl tar crontab systemctl sudo; do
    if have "$tool"; then note "$tool: $(command -v "$tool")"; else note "$tool: нет"; fi
done
have curl || die "нужен curl — им проверяется здоровье сервера и скачиваются обновления"
have tar || die "нужен tar — им распаковываются обновления"
if have_systemd; then note "systemd работает — run.sh поставит службу"
elif have_cron; then note "systemd нет, cron есть — run.sh поставит автозапуск через cron"
else warn "нет ни systemd, ни cron: сервер запустится, но после перезагрузки его придётся поднимать руками (run.sh)"
fi

# ---------------------------------------------------------------- 2. Python
step 2 $TOTAL python "Python 3.10 или новее"
PYTHON=""
ok_version() { "$1" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' 2>/dev/null; }
if [ -n "${POSTER_PYTHON:-}" ]; then
    note "POSTER_PYTHON=$POSTER_PYTHON"
    [ -x "$POSTER_PYTHON" ] || die "POSTER_PYTHON указывает на несуществующий файл: $POSTER_PYTHON"
    ok_version "$POSTER_PYTHON" || die "$POSTER_PYTHON старше 3.10: $("$POSTER_PYTHON" --version 2>&1)"
    PYTHON="$POSTER_PYTHON"
else
    for candidate in python3.10 python3.11 python3.12 python3.13 python3; do
        if have "$candidate" && ok_version "$candidate"; then PYTHON="$(command -v "$candidate")"; break; fi
        have "$candidate" && note "$candidate: $("$candidate" --version 2>&1) — старше 3.10, не подходит"
    done
fi
[ -n "$PYTHON" ] || die "Python 3.10+ не найден. Укажите путь: POSTER_PYTHON=/путь/к/python3.10 bash $0"
note "беру: $PYTHON ($("$PYTHON" --version 2>&1))"

# ---------------------------------------------------------------- 3. окружение
step 3 $TOTAL venv "Окружение .venv"
if [ -x "$PY" ] && [ "$RECREATE" -eq 1 ]; then
    note "--recreate: удаляю старое окружение"
    run rm -rf "$VENV"
fi
if [ -x "$PY" ] && ! "$PY" -m pip --version >/dev/null 2>&1; then
    warn "в .venv нет pip (прошлая установка оборвалась) — пересоздаю"
    run rm -rf "$VENV"
fi
if [ -x "$PY" ]; then
    note "уже есть: $("$PY" --version 2>&1) в $VENV"
else
    if "$PYTHON" -c 'import ensurepip' 2>/dev/null; then
        run "$PYTHON" -m venv "$VENV" || { rm -rf "$VENV"; die "не удалось создать окружение (нужен модуль venv у $PYTHON)"; }
    else
        # на NAS ensurepip часто вырезан: создаём окружение без pip и ставим pip
        # официальным get-pip.py — для этого нужен интернет
        warn "у $PYTHON нет ensurepip — окружение без pip, pip поставлю через get-pip.py"
        run "$PYTHON" -m venv --without-pip "$VENV" || { rm -rf "$VENV"; die "не удалось создать окружение даже без pip"; }
        run curl -fsSL -o "$VENV/get-pip.py" https://bootstrap.pypa.io/get-pip.py \
            || { rm -rf "$VENV"; die "не скачался get-pip.py (нет интернета?) — без pip зависимости не поставить"; }
        run "$PY" "$VENV/get-pip.py" || { rm -rf "$VENV"; die "get-pip.py не установил pip"; }
        rm -f "$VENV/get-pip.py"
    fi
    note "создано: $("$PY" --version 2>&1)"
fi
note "pip: $("$PY" -m pip --version 2>&1)"

# ---------------------------------------------------------------- 4. зависимости
step 4 $TOTAL pip "Зависимости из requirements.txt"
PIP_ARGS=()
if [ -n "$WHEELS" ]; then
    [ -d "$WHEELS" ] || die "папки с колёсами нет: $WHEELS"
    PIP_ARGS=(--no-index --find-links "$WHEELS")
    note "без интернета: пакеты из $WHEELS"
fi
# --timeout/--retries: у NAS канал бывает медленный, и pip по умолчанию сдаётся через 15 с
run "$PY" -m pip install --timeout 120 --retries 5 ${PIP_ARGS[@]+"${PIP_ARGS[@]}"} -r requirements.txt \
    || die "зависимости не установились — смотрите вывод pip выше. Без интернета: --wheels ПАПКА"

# ---------------------------------------------------------------- 5. sqlite
step 5 $TOTAL sqlite "Модуль sqlite3"
if "$PY" -c 'import sqlite3' 2>/dev/null; then
    note "есть в стандартной библиотеке: SQLite $("$PY" -c 'import sqlite3; print(sqlite3.sqlite_version)')"
else
    warn "у этого Python нет модуля sqlite3 (так бывает на NAS) — ставлю замену pysqlite3-binary"
    run "$PY" -m pip install --timeout 120 --retries 5 ${PIP_ARGS[@]+"${PIP_ARGS[@]}"} pysqlite3-binary \
        || die "pysqlite3-binary не установился. Проверьте, что у сервера есть интернет, а процессор — x86_64 (для ARM готового колеса нет)"
fi
note "проверяю, что приложение импортируется и видит SQLite:"
run "$PY" -c 'import app; from app.core import sqlite_compat as s; print("sqlite через:", s.BACKEND)' \
    || die "приложение не импортируется — смотрите ошибку выше"

# ---------------------------------------------------------------- 6. .env
step 6 $TOTAL env "Настройки .env"
if [ -f .env ]; then
    note ".env уже есть — не перезаписываю"
else
    run cp .env.example .env
fi
set_env() {  # set_env КЛЮЧ ЗНАЧЕНИЕ — задать, если ключа нет или он пустой/закомментирован
    if grep -qE "^$1=.+" .env; then note "$1 уже задан: $(env_value "$1")"; return 0; fi
    if grep -qE "^#? ?$1=" .env; then
        sed -i -E "s|^#? ?$1=.*|$1=$2|" .env
    else
        printf '\n%s=%s\n' "$1" "$2" >>.env
    fi
    note "$1 = $2"
}
if grep -qE '^POSTER_SECRET_KEY=.{32,}' .env; then
    note "POSTER_SECRET_KEY уже задан"
else
    key="$("$PY" -c 'import secrets; print(secrets.token_urlsafe(48))')"
    if grep -qE '^#? ?POSTER_SECRET_KEY=' .env; then sed -i -E "s|^#? ?POSTER_SECRET_KEY=.*|POSTER_SECRET_KEY=$key|" .env; else printf '\nPOSTER_SECRET_KEY=%s\n' "$key" >>.env; fi
    note "POSTER_SECRET_KEY сгенерирован (ключ подписи сессий)"
fi
# локальная сеть: слушаем все интерфейсы, порт 8000, строгий режим для интернета не нужен
set_env POSTER_HOST 0.0.0.0
set_env POSTER_PORT 8000
note "сервер будет слушать $(env_value POSTER_HOST):$(env_value POSTER_PORT)"

# ---------------------------------------------------------------- 7. права
step 7 $TOTAL perms "Папки и права (папку видит только владелец — $(id -un))"
run mkdir -p logs backups designs
run chmod 700 "$BASE" "$APP" "$HERE" logs backups designs
run chmod 600 .env
[ -f poster.db ] && run chmod 600 poster.db
run chmod +x "$HERE"/*.sh
note "владелец папки: $(stat -c '%U' "$BASE" 2>/dev/null || echo '?')"

# ---------------------------------------------------------------- 8. пароль администратора
step 8 $TOTAL password "Пароль администратора"
if grep -qE '^POSTER_ADMIN_PASSWORD_HASH=.{20,}' .env; then
    note "уже задан (хэш в .env). Сменить: $PY -m scripts.set_password"
elif [ "$PASSWORD_STDIN" -eq 1 ]; then
    note "читаю пароль со стандартного ввода"
    "$PY" -m scripts.set_password --stdin 2>&1 | sed "s/^/[$SCRIPT] [$TAG] │ /"
    [ "${PIPESTATUS[0]}" -eq 0 ] || die "пароль не принят (смотрите сообщение выше)"
elif [ -t 0 ]; then
    note "введите пароль администратора (символы не показываются):"
    "$PY" -m scripts.set_password || die "пароль не задан — повторите: $PY -m scripts.set_password"
else
    warn "пароль не задан: нет терминала. Задайте отдельно: $PY -m scripts.set_password"
fi

# ---------------------------------------------------------------- итог
say done "Итог"
note "Python:     $("$PY" --version 2>&1)"
note "приложение: $APP"
note "адрес:      http://$(hostname -I 2>/dev/null | awk '{print $1}'):$(env_value POSTER_PORT)/ (после запуска)"
if have cdr2xhtml || have inkscape; then
    note "просмотр содержимого .cdr: доступен"
else
    note "просмотр содержимого .cdr: недоступен (нет libcdr-tools/Inkscape) — эскизы, загрузка и раскладка PDF работают"
fi
ok "настройка завершена. Дальше: bash $HERE/run.sh"
