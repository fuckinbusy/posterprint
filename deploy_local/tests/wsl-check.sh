#!/usr/bin/env bash
# Сквозная проверка deploy_local в WSL от root, в урезанной среде:
# без git и docker в PATH, только python3.10. Прогоняет режим systemd,
# затем — со спрятанным systemctl — режим cron. Каждый шаг печатает
# результат; итог — число пройденных и упавших проверок, код выхода 1
# при любом падении.
#
#   wsl -u root -- bash /mnt/d/coding/posterprint/deploy_local/tests/wsl-check.sh /path/to/python3.10
#
# Стенд собирается в /root/pl (сносится и создаётся заново), исходники
# берутся из рабочей копии на диске D (только файлы под git).
set -u
PY310="${1:?путь к python3.10}"
SRC="${SRC:-/mnt/d/coding/posterprint}"
STAND=/root/pl
BIN=/root/pl-bin
LOGD=/root/pl-logs
PASS=0; FAIL=0
check() {  # check «описание» команда...
    local what="$1"; shift
    if "$@"; then PASS=$((PASS+1)); printf 'PASS  %s\n' "$what"
    else FAIL=$((FAIL+1)); printf 'FAIL  %s\n' "$what"; fi
}
sh_() {  # запуск скрипта стенда с логом в файл: sh_ имя-лога скрипт аргументы
    local name="$1"; shift
    PATH="$BIN" bash "$STAND/deploy_local/$@" >"$LOGD/$name.log" 2>&1
    local rc=$?
    printf '      [%s → код %s, %s строк, лог %s]\n' "$1" "$rc" "$(wc -l <"$LOGD/$name.log")" "$LOGD/$name.log"
    return $rc
}
health() { curl -sf -m 3 http://127.0.0.1:8000/health >/dev/null 2>&1; }
# часть проверок идёт через bash -c — функции и пути стенда нужны и там
export -f sh_ health
export STAND BIN LOGD

echo "### стенд"
bash "$SRC/deploy_local/uninstall.sh" >/dev/null 2>&1 || true
[ -f /etc/systemd/system/poster-local.service ] && { systemctl disable --now poster-local >/dev/null 2>&1; rm -f /etc/systemd/system/poster-local.service; systemctl daemon-reload; }
crontab -l 2>/dev/null | grep -v "poster-local" | crontab - 2>/dev/null || true
pkill -f "uvicorn app.main:app" 2>/dev/null || true
rm -rf "$STAND" "$BIN" "$LOGD"; mkdir -p "$STAND" "$BIN" "$LOGD"
# урезанный PATH: всё из /usr/bin и /bin, кроме git, docker и системных python
for d in /usr/bin /bin /usr/sbin /sbin; do
    for f in "$d"/*; do
        n="$(basename "$f")"
        case "$n" in git|git-*|docker|docker-*|python3|python3.*|python|pip|pip3|pip3.*) continue ;; esac
        [ -e "$BIN/$n" ] || ln -s "$f" "$BIN/$n"
    done
done
ln -s "$PY310" "$BIN/python3.10"
echo "python3.10 → $PY310 ($("$PY310" --version))"
echo "в PATH нет: $(PATH="$BIN" bash -c 'for t in git docker python3; do command -v $t >/dev/null || printf "%s " $t; done')"
# исходники: только файлы под git, концы строк как на Linux
# -co: и учтённые git, и новые файлы (deploy_local до первого коммита), без игнорируемых (.venv, база)
(cd "$SRC" && git -c safe.directory='*' ls-files -co --exclude-standard -z poster-ocr deploy_local | tar --null -cf - -T -) | tar -xf - -C "$STAND"
find "$STAND" -type f \( -name '*.sh' -o -name '*.py' -o -name '*.txt' -o -name '.env.example' \) -exec sed -i 's/\r$//' {} +
echo "стенд: $STAND ($(find "$STAND" -type f | wc -l) файлов)"

echo; echo "### 1. setup.sh (пароль через --password-stdin)"
check "setup завершился с кодом 0" bash -c "printf 'пароль-цеха-стенд-2026\n' | PATH='$BIN' bash '$STAND/deploy_local/setup.sh' --password-stdin >'$LOGD/setup.log' 2>&1"
printf '      [setup.sh: %s строк, лог %s]\n' "$(wc -l <"$LOGD/setup.log")" "$LOGD/setup.log"
check ".venv создан на 3.10" bash -c "'$STAND/poster-ocr/.venv/bin/python' --version | grep -q 'Python 3.10'"
check "хэш пароля в .env" grep -qE '^POSTER_ADMIN_PASSWORD_HASH=.{20,}' "$STAND/poster-ocr/.env"
check "POSTER_HOST=0.0.0.0 в .env" grep -q '^POSTER_HOST=0.0.0.0' "$STAND/poster-ocr/.env"
check "права 700 на папке установки" bash -c "[ \"\$(stat -c %a '$STAND')\" = 700 ]"
check "права 600 на .env" bash -c "[ \"\$(stat -c %a '$STAND/poster-ocr/.env')\" = 600 ]"
check "в логе setup нет строк без префикса [SETUP]" bash -c "! grep -vE '^(\[SETUP\]|$)' '$LOGD/setup.log' | grep -q ."
check "повторный setup проходит (идемпотентность)" sh_ setup2 setup.sh
check "повторный setup пишет «уже есть»" grep -q "уже есть" "$LOGD/setup2.log"

echo; echo "### 2. режим systemd: run → status → stop → status → run"
check "run.sh (systemd) код 0" sh_ run1 run.sh
check "служба poster-local активна" systemctl is-active --quiet poster-local
check "служба включена в автозапуск" systemctl is-enabled --quiet poster-local
check "/health отвечает" health
check "status.sh код 0 и видит systemd" bash -c "sh_ status1 status.sh && grep -q 'служба systemd' '$LOGD/status1.log'"
check "stop.sh код 0" sh_ stop1 stop.sh
check "после stop /health не отвечает" bash -c "! health"
check "после stop служба всё ещё enabled" systemctl is-enabled --quiet poster-local
check "status.sh после stop — код 1" bash -c "! sh_ status2 status.sh"
check "run.sh снова поднимает" bash -c "sh_ run2 run.sh && health"
check "update.sh (systemd) код 0" sh_ update1 update.sh
check "update записал VERSION_LOCAL с коммитом" grep -qE '^[0-9a-f]{40} main' "$STAND/poster-ocr/VERSION_LOCAL"
check "update сделал копию базы перед обновлением" bash -c "[ -n \"\$(ls -1 '$STAND/poster-ocr/backups' 2>/dev/null)\" ]"
check "после update /health отвечает" health
check "backup.sh код 0" sh_ backup1 backup.sh
check "backup.sh --list код 0" sh_ backup2 backup.sh --list
check "копий стало 2" bash -c "[ \"\$(ls -1 '$STAND/poster-ocr/backups' | wc -l)\" -ge 2 ]"
check "uninstall.sh снимает службу" bash -c "sh_ uninstall1 uninstall.sh && [ ! -f /etc/systemd/system/poster-local.service ] && ! health"

echo; echo "### 3. режим cron (systemctl спрятан): run → status → stop → сторож → run → update"
rm -f "$BIN/systemctl" "$BIN/journalctl"
check "run.sh (cron) код 0" sh_ run3 run.sh
check "строки poster-local в crontab (2)" bash -c "[ \"\$(crontab -l | grep -c poster-local)\" = 2 ]"
check "/health отвечает" health
check "status.sh видит cron" bash -c "sh_ status3 status.sh && grep -q 'cron' '$LOGD/status3.log'"
check "stop.sh код 0, /health молчит" bash -c "sh_ stop2 stop.sh && ! health"
check "сторож после stop НЕ поднимает" bash -c "PATH='$BIN' bash '$STAND/deploy_local/run.sh' --watchdog; ! health"
check "run.sh снова поднимает" bash -c "sh_ run4 run.sh && health"
pid="$(cat "$STAND/poster-ocr/logs/poster.pid")"
kill -9 "$pid"; sleep 1
check "сторож поднимает упавший сервер" bash -c "PATH='$BIN' bash '$STAND/deploy_local/run.sh' --watchdog >'$LOGD/watchdog.log' 2>&1; health"
check "update.sh (cron) код 0 и /health" bash -c "sh_ update2 update.sh && health"
check "uninstall.sh убирает cron и процесс" bash -c "sh_ uninstall2 uninstall.sh && ! crontab -l 2>/dev/null | grep -q poster-local && ! health"

echo; echo "### 4. Python без sqlite3 (как на TOS): setup ставит pysqlite3-binary"
NOSQL=/root/pl-py-nosqlite
rm -rf "$NOSQL"; cp -a "$(dirname "$(dirname "$(readlink -f "$PY310")")")" "$NOSQL"
rm -f "$NOSQL"/lib/python3.10/lib-dynload/_sqlite3*.so
check "тестовый python правда без sqlite3" bash -c "! '$NOSQL/bin/python3.10' -c 'import sqlite3' 2>/dev/null"
rm -rf "$STAND/poster-ocr/.venv"
check "setup с таким python — код 0" bash -c "printf 'пароль-цеха-стенд-2026\n' | POSTER_PYTHON='$NOSQL/bin/python3.10' PATH='$BIN' bash '$STAND/deploy_local/setup.sh' --password-stdin >'$LOGD/setup-nosqlite.log' 2>&1"
check "setup написал про замену" grep -q "pysqlite3-binary" "$LOGD/setup-nosqlite.log"
check "приложение видит sqlite через pysqlite3" grep -q "sqlite через: pysqlite3" "$LOGD/setup-nosqlite.log"
check "run.sh с pysqlite3 поднимает сервер" bash -c "sh_ run5 run.sh && health && sh_ uninstall3 uninstall.sh"

echo; echo "### 5. первая установка одним update.sh в пустую папку"
FRESH=/root/pl-fresh; rm -rf "$FRESH"; mkdir -p "$FRESH/deploy_local"
cp "$STAND/deploy_local/common.sh" "$STAND/deploy_local/update.sh" "$FRESH/deploy_local/"
check "update.sh в пустой папке — код 0" bash -c "PATH='$BIN' bash '$FRESH/deploy_local/update.sh' >'$LOGD/first-install.log' 2>&1"
check "скачал poster-ocr, без сайта-визитки" bash -c "[ -f '$FRESH/poster-ocr/requirements.txt' ] && [ ! -d '$FRESH/poster-website' ]"
check "лог говорит про первую установку" grep -q "первая установка" "$LOGD/first-install.log"

echo; echo "### итог: PASS=$PASS FAIL=$FAIL · логи в $LOGD"
[ "$FAIL" -eq 0 ]
