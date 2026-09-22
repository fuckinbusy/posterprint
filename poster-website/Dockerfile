# Сайт-визитка: два шага — собрать React, отдать статику.
#
# Первый образ с Node нужен только на время сборки; в итоговом образе — лишь
# Caddy и папка dist, ни исходников, ни node_modules. Главный Caddy сервера
# (../deploy/Caddyfile) проксирует сюда корень домена.

FROM node:22-alpine AS build
WORKDIR /src
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund 2>/dev/null || npm install --no-audit --no-fund
COPY . .
RUN npm run build

FROM caddy:2-alpine
COPY --from=build /src/dist /srv
COPY Caddyfile /etc/caddy/Caddyfile
EXPOSE 80
