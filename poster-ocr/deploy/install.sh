#!/usr/bin/env bash
# Скрипт переехал в deploy/crm/install.sh (в корне репозитория). Этот файл —
# переадресация для старых инструкций и привычки.
exec bash "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../../deploy/crm/install.sh" "$@"
