#!/usr/bin/env bash
# Первая установка ПОСТЕР на Linux: от голой системы до работающего сервера.
#
#   bash deploy/install.sh                 окружение, зависимости, .env, пароль
#   sudo bash deploy/install.sh --service  то же плюс служба systemd с автозапуском
#   bash deploy/install.sh --service --lan для своей сети без прокси (0.0.0.0, без POSTER_PUBLIC)
#   bash deploy/install.sh --no-password   не спрашивать пароль администратора (задать позже)
#   bash deploy/install.sh --python python3.11   какой интерпретатор брать (по умолчанию 3.10,
#                                          если он есть; иначе первый подходящий ≥ 3.10)
#   bash deploy/install.sh --recreate      пересобрать .venv заново (например, другой версией Python)
#   bash deploy/install.sh --pip-index URL зеркало PyPI, если pypi.org не отвечает
#                                          (например https://pypi.tuna.tsinghua.edu.cn/simple)
#   bash deploy/install.sh --wheels ПАПКА  вообще без интернета: зависимости из папки с
#                                          wheel-файлами (см. deploy/LINUX.md, «Без интернета»)
#
# Повторный запуск безопасен: что уже сделано, пропускается.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SERVICE=0; LAN=0; ASK_PASSWORD=1; RECREATE=0; WANT_PYTHON="${POSTER_PYTHON:-}"
PIP_INDEX="${POSTER_PIP_INDEX:-}"
WHEELS="${POSTER_WHEELS:-}"
while [ $# -gt 0 ]; do
    case "$1" in
        --service) SERVICE=1 ;;
        --lan) LAN=1 ;;
        --no-password) ASK_PASSWORD=0 ;;
        --recreate) RECREATE=1 ;;
        --python) WANT_PYTHON="$2"; shift ;;
        --pip-index) PIP_INDEX="$2"; shift ;;
        --wheels) WHEELS="$2"; shift ;;
        *) echo "неизвестный параметр: $1" >&2; exit 1 ;;
    esac
    shift
done

say() { printf '\n== %s\n' "$*"; }
die() { printf 'Ошибка: %s\n' "$*" >&2; exit 1; }

# служба ставится от root, но окружение и .env должны принадлежать тому,
# кто будет запускать; при --service владельца поправит install-service
if [ "$SERVICE" -eq 1 ] && [ "$(id -u)" -ne 0 ]; then
    die "для --service нужен root: sudo bash deploy/install.sh --service"
fi

# ---------------------------------------------------------------- python
say "Python"
# Система проверена на 3.10 — его и берём, если он есть; --python или
# POSTER_PYTHON задают интерпретатор явно
PYTHON=""
if [ -n "$WANT_PYTHON" ]; then
    command -v "$WANT_PYTHON" >/dev/null 2>&1 || die "нет интерпретатора $WANT_PYTHON"
    PYTHON="$WANT_PYTHON"
else
    for candidate in python3.10 python3.11 python3.12 python3.13 python3; do
        if command -v "$candidate" >/dev/null 2>&1 \
           && "$candidate" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)'; then
            PYTHON="$candidate"; break
        fi
    done
fi
[ -n "$PYTHON" ] || die "нужен Python 3.10 или новее: sudo apt install python3.10 python3.10-venv"
"$PYTHON" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' || die "$PYTHON старее 3.10"
echo "используем $PYTHON ($("$PYTHON" --version))"
# На Debian/Ubuntu venv и ensurepip лежат в отдельном пакете; без него
# python -m venv создаёт полупустое окружение без pip и падает — а
# следующий запуск видел бы «.venv уже есть» и спотыкался на pip.
pyver="$("$PYTHON" -c 'import sys; print(f"{sys.version_info[0]}.{sys.version_info[1]}")')"
"$PYTHON" -c 'import venv, ensurepip' 2>/dev/null \
    || die "у $PYTHON нет venv/ensurepip: sudo apt install python${pyver}-venv  (затем повторите команду)"

# ---------------------------------------------------------------- окружение
say "Окружение .venv"
if [ -x .venv/bin/python ] && [ "$RECREATE" -eq 1 ]; then
    rm -rf .venv
    echo "прежнее окружение удалено"
fi
# окружение без pip — след неудачной попытки: сносим и создаём заново
if [ -x .venv/bin/python ] && ! .venv/bin/python -m pip --version >/dev/null 2>&1; then
    echo "в .venv нет pip (прошлая установка оборвалась) — пересоздаём"
    rm -rf .venv
fi
if [ ! -x .venv/bin/python ]; then
    if ! "$PYTHON" -m venv .venv; then
        rm -rf .venv
        die "не удалось создать окружение: sudo apt install python${pyver}-venv и повторите"
    fi
    echo "создано на $("$PYTHON" --version)"
else
    have_version="$(.venv/bin/python --version 2>&1)"
    want_version="$("$PYTHON" --version 2>&1)"
    if [ "$have_version" != "$want_version" ]; then
        echo "уже есть, но на $have_version, а выбран $want_version — пересобрать: bash deploy/install.sh --recreate"
    else
        echo "уже есть ($have_version)"
    fi
fi
.venv/bin/python -m pip --version >/dev/null 2>&1 \
    || .venv/bin/python -m ensurepip --upgrade >/dev/null 2>&1 \
    || { rm -rf .venv; die "в окружении нет pip: sudo apt install python${pyver}-venv и повторите"; }
# pypi.org из России отвечает медленно и с обрывами: ждём дольше, пробуем
# чаще, при --pip-index берём зеркало, при --wheels — вообще не ходим в сеть
pip_args=(--timeout 90 --retries 10)
if [ -n "$WHEELS" ]; then
    [ -d "$WHEELS" ] || die "нет папки с wheel-файлами: $WHEELS"
    pip_args=(--no-index --find-links "$WHEELS")
    echo "зависимости — из $WHEELS, без интернета"
fi
[ -n "$PIP_INDEX" ] && pip_args+=(--index-url "$PIP_INDEX" --trusted-host "$(printf '%s' "$PIP_INDEX" | sed -E 's#^[a-z]+://([^/]+).*#\1#')")
if [ -z "$WHEELS" ]; then
    .venv/bin/python -m pip install -q "${pip_args[@]}" --upgrade pip \
        || echo "pip не обновился — не страшно, ставим зависимости тем, что есть"
fi
if ! .venv/bin/python -m pip install -q "${pip_args[@]}" -r requirements.txt; then
    die "зависимости не установились. Сеть: --pip-index https://pypi.tuna.tsinghua.edu.cn/simple; без сети: --wheels ПАПКА (deploy/LINUX.md, «Без интернета»)"
fi
echo "зависимости установлены"

# ---------------------------------------------------------------- .env
say "Настройки .env"
if [ ! -f .env ]; then
    cp .env.example .env
    echo "создан из .env.example"
else
    echo "уже есть, не трогаем"
fi
# ключ подписи сессий — если пустой или закомментирован
if ! grep -qE '^POSTER_SECRET_KEY=.{32,}' .env; then
    key="$(.venv/bin/python -c 'import secrets; print(secrets.token_urlsafe(48))')"
    if grep -qE '^#? ?POSTER_SECRET_KEY=' .env; then
        sed -i -E "s|^#? ?POSTER_SECRET_KEY=.*|POSTER_SECRET_KEY=$key|" .env
    else
        printf '\nPOSTER_SECRET_KEY=%s\n' "$key" >>.env
    fi
    echo "ключ подписи сессий сгенерирован"
fi
chmod 600 .env
mkdir -p logs backups designs
chmod 700 logs backups designs
[ -f poster.db ] && chmod 600 poster.db
# скрипты запускаются и напрямую (deploy/poster.sh ...); право на исполнение
# не считаем правкой, иначе git pull потом споткнётся
chmod +x deploy/*.sh 2>/dev/null || true
[ -d .git ] && git -c safe.directory="$ROOT" config core.fileMode false 2>/dev/null || true

# ---------------------------------------------------------------- пароль администратора
if grep -qE '^POSTER_ADMIN_PASSWORD_HASH=.{20,}' .env; then
    echo "пароль администратора уже задан"
elif [ "$ASK_PASSWORD" -eq 1 ] && [ -t 0 ]; then
    say "Пароль администратора"
    .venv/bin/python -m scripts.set_password
else
    echo "пароль администратора не задан — позже: .venv/bin/python -m scripts.set_password"
fi

# ---------------------------------------------------------------- служба
if [ "$SERVICE" -eq 1 ]; then
    say "Служба systemd"
    args=()
    [ "$LAN" -eq 1 ] && args+=(--lan)
    bash deploy/poster.sh install-service "${args[@]}"
else
    say "Готово"
    cat <<EOF
Запуск руками:        deploy/poster.sh run
В фоне:               deploy/poster.sh start   (stop, status, logs)
Как служба с автозапуском:
                      sudo bash deploy/install.sh --service        (за прокси)
                      sudo bash deploy/install.sh --service --lan  (в своей сети)
Подробно — deploy/LINUX.md
EOF
fi
