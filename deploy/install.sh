#!/usr/bin/env bash
# Первая установка ПОСТЕР на Linux: от голой системы до работающего сервера.
#
#   bash deploy/install.sh                 окружение, зависимости, .env, пароль
#   sudo bash deploy/install.sh --service  то же плюс служба systemd с автозапуском
#   bash deploy/install.sh --service --lan для своей сети без прокси (0.0.0.0, без POSTER_PUBLIC)
#   bash deploy/install.sh --no-password   не спрашивать пароль администратора (задать позже)
#
# Повторный запуск безопасен: что уже сделано, пропускается.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SERVICE=0; LAN=0; ASK_PASSWORD=1
for arg in "$@"; do
    case "$arg" in
        --service) SERVICE=1 ;;
        --lan) LAN=1 ;;
        --no-password) ASK_PASSWORD=0 ;;
        *) echo "неизвестный параметр: $arg" >&2; exit 1 ;;
    esac
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
PYTHON=""
for candidate in python3.12 python3.11 python3.10 python3; do
    if command -v "$candidate" >/dev/null 2>&1; then
        if "$candidate" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)'; then
            PYTHON="$candidate"; break
        fi
    fi
done
[ -n "$PYTHON" ] || die "нужен Python 3.10 или новее: sudo apt install python3 python3-venv"
echo "используем $PYTHON ($("$PYTHON" --version))"
"$PYTHON" -c 'import venv' 2>/dev/null || die "нет модуля venv: sudo apt install python3-venv"

# ---------------------------------------------------------------- окружение
say "Окружение .venv"
if [ ! -x .venv/bin/python ]; then
    "$PYTHON" -m venv .venv
    echo "создано"
else
    echo "уже есть"
fi
.venv/bin/python -m pip install -q --upgrade pip
.venv/bin/python -m pip install -q -r requirements.txt
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
