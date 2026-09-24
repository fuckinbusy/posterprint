# Сервер ПОСТЕР в контейнере. Собранный интерфейс (static/dist) лежит в
# репозитории, поэтому Node.js для сборки образа не нужен — только Python.
#
# Данные (база, копии, макеты, логи) живут не в образе, а в томе /app/data:
# образ можно пересобирать и обновлять, данные остаются. См. docker-compose.yml.

FROM python:3.12-slim

# без .pyc и с небуферизованным выводом — журнал контейнера идёт сразу
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# зависимости отдельным слоем: правка кода не тянет переустановку пакетов
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# разборщик макетов CorelDRAW: просмотр содержимого .cdr и выгрузка в SVG.
# DEBIAN_MIRROR — зеркало Debian вместо deb.debian.org (из России тот бывает
# медленнее в сотни раз): https://mirror.yandex.ru/debian. Пусто — как есть.
ARG DEBIAN_MIRROR=""
RUN if [ -n "$DEBIAN_MIRROR" ]; then \
        sed -i "s#http://deb.debian.org/debian#$DEBIAN_MIRROR#g" /etc/apt/sources.list.d/debian.sources; \
    fi \
    && apt-get update && apt-get install -y --no-install-recommends libcdr-tools \
    && rm -rf /var/lib/apt/lists/*

COPY app ./app
COPY scripts ./scripts
COPY static ./static

# от своего пользователя, не от root: дыра в приложении не даст корень контейнера
RUN useradd --system --uid 1000 --create-home poster \
    && mkdir -p /app/data \
    && chown -R poster:poster /app
USER poster

# все данные — в один каталог, который монтируется томом
ENV POSTER_DB_URL=sqlite:////app/data/poster.db \
    POSTER_BACKUP_DIR=/app/data/backups \
    POSTER_DESIGNS_DIR=/app/data/designs \
    POSTER_LOG_DIR=/app/data/logs

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3)"

# Один процесс — намеренно: SQLite, счётчик попыток входа и кэш почты живут
# в памяти процесса. --proxy-headers: настоящий адрес клиента приходит от
# Caddy в X-Forwarded-For, по нему считается лимит попыток входа и
# отмечаются устройства. Прокси доверяем любому — в сеть контейнера снаружи
# никто, кроме Caddy, не попадает (порт 8000 наружу не публикуется).
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", \
     "--workers", "1", "--proxy-headers", "--forwarded-allow-ips=*"]
