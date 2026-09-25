# API системы ПОСТЕР: гайд для ботов и программ

Всё, что сотрудник делает в интерфейсе, программа может сделать через API:
смотреть и заводить заказы, двигать их по статусам, искать клиентов,
считать цену, качать макеты, забирать кассу за день. Интерфейс системы сам
работает через этот же API — отдельного «урезанного» API для программ нет.

Этот гайд — для того, кто пишет бота (Telegram, 1С-обмен, скрипт выгрузки,
настольную программу). Как устроена сама система — в [README.md](README.md).

- [Быстрый старт](#быстрый-старт)
- [Адрес, ключ, права](#адрес-ключ-права)
- [Ответы и ошибки](#ответы-и-ошибки)
- [Частые задачи](#частые-задачи)
- [Объекты](#объекты)
- [Все ручки](#все-ручки)
- [Подводные камни](#подводные-камни)
- [Безопасность ключа](#безопасность-ключа)

---

## Быстрый старт

1. **Заведите боту профиль.** Администратор: «Сотрудники» → «Новый профиль»,
   имя вроде «Бот Telegram», галочки — только то, что боту нужно (например,
   «Видеть доску заказов» и «Менять статус заказа»). Пароль и привязка к
   компьютерам боту не нужны: он входит ключом.
2. **Возьмите ключ.** Там же, в профиле бота → блок «API-ключ» →
   «Копировать». Блок видит только администратор (вход паролем из `.env`).
   Ключ выглядит так: `pst_` и 43 символа.
3. **Первый запрос:**

   ```bash
   curl -H "X-API-Key: pst_ваш_ключ" https://crm.постерпринт.рф/api/auth/me
   ```

   ```json
   {"kind": "employee", "name": "Бот Telegram",
    "permissions": ["orders.view", "orders.status"],
    "employee_id": 7, "device_id": null, "device_name": ""}
   ```

   Пришло ваше имя и права — всё работает. Пришло `"kind": "guest"` —
   ключ не подошёл (опечатка, перевыпущен или профиль отключён).

То же на Python (`pip install requests`):

```python
import os
import requests

API = "https://crm.xn--e1agpbecgbfkg.xn--p1ai/api"   # crm.постерпринт.рф
session = requests.Session()
session.headers["X-API-Key"] = os.environ["POSTER_API_KEY"]   # ключ — не в коде

me = session.get(f"{API}/auth/me", timeout=10).json()
print(me["name"], me["permissions"])
```

---

## Адрес, ключ, права

### Адрес

| Где стоит система | Адрес API |
|---|---|
| Сервер в интернете | `https://crm.постерпринт.рф/api/…` — поддомен CRM |
| Компьютер в мастерской | `http://адрес-компьютера:8000/api/…` |

Домен CRM — `POSTER_CRM_DOMAIN` в корневом `.env` сервера
(`../deploy/README.md`). Программам, которые не понимают кириллицу в адресе,
пишите его в punycode: `crm.xn--e1agpbecgbfkg.xn--p1ai`. Если CRM отдают под
путём чужого домена (`POSTER_BASE_PATH`), путь добавляется перед `/api`.
Дальше в гайде пути пишутся от `/api`.

Снаружи — только https. Документация `/docs` на сервере в интернете
выключена намеренно (карта всех ручек для чужих); дома, без
`POSTER_PUBLIC`, она открыта: `http://localhost:8000/docs`.

### Ключ

Любой из двух заголовков:

```
X-API-Key: pst_…
Authorization: Bearer pst_…
```

Второй — для программ, которые умеют только Bearer. Ключ работает:

- **от имени сотрудника и ровно с его правами** — нет права, будет 403;
- **откуда угодно** — привязка профиля к компьютерам на ключ не действует;
- **пока профиль включён** — отключили или удалили профиль, перевыпустили
  ключ — старый перестаёт работать на следующем же запросе.

Права читаются из базы на каждом запросе: администратор поправил галочки —
бот получил новые права сразу, без перезапуска.

Сессии (`POST /api/auth/employee` с паролем, токен на 14 дней) — для
интерфейса в браузере. Боту они не нужны: ключ проще и не истекает.

### Права

Какие галочки нужны для каких ручек — в колонке «Право» таблицы
[«Все ручки»](#все-ручки). Самые ходовые:

| Право | Что открывает |
|---|---|
| `orders.view` | список и карточки заказов |
| `orders.create` | новые заказы |
| `orders.edit` | правка заказа, заметки |
| `orders.status` | смена статуса |
| `orders.price.view` | цены, внесённое, долг в заказах |
| `orders.price.edit` | задавать цену и оплату |
| `orders.estimate` | расчёт цены по прайсу |
| `notify.orders` | лента новых заказов |
| `design.view` / `design.upload` | скачать / загрузить макет |
| `clients.view`, `clients.search`, `clients.list` | контакты, поиск, список клиентов |
| `finance.cash` | касса за период |
| `metrics.view` | метрики, выгрузка заказов в CSV |
| `prices.view` / `prices.edit` | прайс и виды работ |

Некоторые права тянут за собой другие: `orders.price.edit` включает
`orders.price.view`, `design.upload` — `design.view`, `clients.edit` —
`clients.view` и `clients.list`. Полный список с описаниями —
`GET /api/auth/permissions` или `app/core/permissions.py`.

**Без `orders.price.view`** цены не уходят с сервера: в заказах `price`,
`prepaid`, `debt`, `surplus` и ставки доп. услуг `extras[].rate` — `0`,
`refunded` — `false`, `payment` — `"hidden"`; в `GET /api/catalog` цены
доп. услуг — `0`. Без `clients.view` — пустые `client_phone` и
`client_contact`. Без `finance.totals` у клиентов нет сумм, а сортировка
`sort=sum` работает как `recent`.

---

## Ответы и ошибки

Тела запросов и ответов — JSON в UTF-8 (кроме файлов и CSV). Даты —
`YYYY-MM-DD`, моменты времени — ISO 8601 (`2026-09-24T10:15:00`, UTC).
Деньги — числа в рублях (`1500.0`).

| Код | Когда |
|---|---|
| 200, 201 | готово; 201 — создано |
| 204 | удалено, тела нет |
| 401 | нет ключа или ключ не подошёл: `{"detail": "Нужно войти в систему"}` |
| 403 | у профиля нет права: `{"detail": "Недостаточно прав для этого действия"}` |
| 404 | нет такого заказа, клиента, файла |
| 409 | действие противоречит состоянию: запрещённый переход статуса, дубль имени |
| 413 | тело больше 2 МБ (макеты — отдельно, до 300 МБ) |
| 422 | неверные данные — см. ниже |
| 429 | слишком много неверных ключей с вашего адреса — см. «Лимиты» |
| 500 | ошибка сервера: `{"detail": "Внутренняя ошибка (№…)…"}` — номер найдётся в журнале |
| 502, 503 | почтовый сервер недоступен или ящик не настроен (только ручки `/api/mail`) |

Ошибка всегда в поле `detail`, и **у 422 оно бывает двух видов**:

```json
{"detail": "Неизвестный вид работ"}
```

```json
{"detail": [{"type": "greater_than_equal", "loc": ["body", "quantity"],
             "msg": "Input should be greater than or equal to 1", "input": 0}]}
```

Первый — проверка по смыслу (сервер сам написал, что не так). Второй —
данные не прошли по форме: `loc` показывает, какое поле. Обрабатывайте оба:

```python
def explain(response):
    detail = response.json().get("detail")
    if isinstance(detail, list):
        return "; ".join(f"{'.'.join(map(str, e['loc']))}: {e['msg']}" for e in detail)
    return detail
```

### Лимиты

- **Неверные ключи** считаются по адресу: 20 за 15 минут — и неверные
  ключи с этого адреса получают 429 с заголовком `Retry-After: секунды`.
  Верный ключ с того же адреса работает и во время блокировки.
- **Тело запроса** — до 2 МБ, макет `.cdr` — до 300 МБ.
- Жёсткого лимита на частоту запросов с верным ключом нет, но сервер один
  на мастерскую: опрашивайте не чаще раза в несколько секунд.

### Браузерные клиенты (CORS)

Ботам, скриптам и обычным программам CORS не нужен. Он нужен, только если
запросы идут **из браузера** со страницы на другом адресе (веб-страница,
Electron с `file://`). Такой адрес впишите в `POSTER_ALLOWED_ORIGINS` в
`poster-ocr/.env`. И помните: ключ в коде страницы видит любой посетитель.

---

## Частые задачи

Примеры на Python продолжают быстрый старт (`session`, `API`).

### Справочник: виды работ, статусы, переходы

```python
catalog = session.get(f"{API}/catalog").json()
kinds = {t["key"]: t["title"] for t in catalog["templates"]}  # виды работ
catalog["statuses"]      # [{key, title, hint, color}]
catalog["transitions"]   # {"new": ["cancelled", "confirmed"], …}
catalog["forward"]       # {"new": "confirmed", …} — «следующий» статус
```

Нужно любое право (достаточно войти). У каждого вида работ — список
`fields`: ключ поля, тип (`select`, `number`, `bool`, `text`), варианты,
значение по умолчанию. По ним собираются `params` заказа.

### Список заказов

```bash
curl -H "X-API-Key: $KEY" "$API/orders"                        # активные + 60 последних закрытых
curl -H "X-API-Key: $KEY" "$API/orders?status=ready"           # готовые к выдаче
curl -H "X-API-Key: $KEY" "$API/orders?q=ЗК-2026-000123"        # поиск: номер, клиент, телефон, заметки
```

Параметры: `status`, `template_key`, `q` (поиск, до 200 результатов),
`closed_limit` — сколько выданных и отменённых отдавать (10–1000, по
умолчанию 60). Страниц (`offset`) нет. Порядок — по сроку: сначала со
сроком, ближайшие первыми.

Один заказ: `GET /api/orders/{id}`.

### Новый заказ

```python
order = session.post(f"{API}/orders", json={
    "template_key": "banner_print",         # ключ вида работ из /catalog
    "title": "Баннер на фасад",
    "client_name": "ООО Ромашка",
    "client_phone": "+7 900 123-45-67",
    "quantity": 1,
    "params": {"width": 3, "height": 1, "grommets": 12},   # поля вида работ; размеры баннера — в метрах
    "due_date": "2026-10-01",
    "notes": "Заявка из Telegram",
}).json()
print(order["number"], order["status"])      # ЗК-2026-000124 new
```

- Нужно право `orders.create`. Заказ всегда начинается со статуса `new`.
- **`price`, `prepaid`, `refunded` не присылайте вовсе**, если у профиля
  нет `orders.price.edit`: само их присутствие в теле — даже `0` — даёт 403.
- Клиент находится в справочнике по `client_id`, телефону или имени, а
  если его нет — заводится сам.
- «Кто принял» (`manager`) — всегда имя профиля бота, из тела не берётся.
- Незнакомое поле в теле — 422 с именем поля в `loc`: опечатка не
  потеряется молча. Статус так не ставится — только
  `POST /api/orders/{id}/status`.

### Сменить статус

```python
session.post(f"{API}/orders/{order_id}/status", json={"status": "ready"})
session.post(f"{API}/orders/{order_id}/status",
             json={"status": "cancelled", "reason": "Клиент передумал"})
```

Нужно `orders.status`. Переходы — только разрешённые (см.
[«Статусы»](#статусы-заказа)), иначе 409 `«Нельзя перевести из «…» в «…»»`.
Тот же статус — не ошибка, заказ вернётся как есть.

### Заметка и правка

```python
session.post(f"{API}/orders/{order_id}/notes", json={"text": "Клиент заберёт в пятницу"})
session.patch(f"{API}/orders/{order_id}", json={"due_date": "2026-10-03"})
```

В `PATCH` передаются только меняемые поля; `null` значит «не трогать»,
кроме `due_date` и `client_id` — там `null` очищает значение. `params`
заменяется целиком.

### Расчёт цены по прайсу

```python
calc = session.post(f"{API}/price/estimate", json={
    "template_key": "banner_print", "quantity": 2,
    "params": {"width": 3, "height": 1},
}).json()
calc["price"]       # число или null, если посчитать нельзя
calc["breakdown"]   # [{"label": "…", "amount": …}]
calc["note"]        # пояснение, почему null или чего нет в прайсе
```

Нужно `orders.estimate`. Заказ при этом не создаётся.

### Лента новых заказов (уведомления)

```python
import time

latest = session.get(f"{API}/orders/fresh").json()["latest_id"]   # первый раз — только «край»
while True:
    time.sleep(10)
    data = session.get(f"{API}/orders/fresh", params={"after": latest}).json()
    for order in data["orders"]:
        print("Новый заказ", order["number"], order["title"])
    latest = data["latest_id"]
```

Нужно `notify.orders`. За раз — до 20 заказов новее `after`, кроме
заведённых самим ботом.

### Клиенты

```bash
curl -H "X-API-Key: $KEY" "$API/clients?q=Ромашка"            # поиск (clients.search), от 2 символов
curl -H "X-API-Key: $KEY" "$API/clients?sort=recent&limit=50"  # список (clients.list)
curl -H "X-API-Key: $KEY" "$API/clients/15/orders"              # история (clients.history)
```

Ответ списка: `{items, total, limit, offset}` — здесь страницы есть
(`limit` до 200, `offset`).

### Макет заказа (.cdr)

```bash
# скачать — одним запросом, с ключом
curl -H "X-API-Key: $KEY" -o макет.cdr "$API/orders/42/design/file"

# загрузить (заменит прежний) — design.upload, multipart, поле file
curl -H "X-API-Key: $KEY" -F "file=@макет.cdr" "$API/orders/42/design"

# превью PNG и выгрузка в SVG/PDF
curl -H "X-API-Key: $KEY" -o превью.png "$API/orders/42/design/preview"
curl -H "X-API-Key: $KEY" -o макет.pdf "$API/orders/42/design/export?format=pdf"
```

Есть ли макет и какого размера — `GET /api/orders/{id}/design`.

### Инструменты: просмотр .cdr и раскладка PDF

Файлы уходят на сервер на время запроса и не хранятся. Предел — 300 МБ для
.cdr (как у макета заказа) и 100 МБ для PDF,
одновременно обрабатываются два файла, остальные ждут до минуты.

```bash
# содержимое любого .cdr (как /design/scene у заказа, плюс thumbnail — data:-PNG)
curl -H "X-API-Key: $KEY" -F "file=@макет.cdr" "$API/tools/design-scene"

# страницы PDF: рамки MediaBox/TrimBox/BleedBox (пункты PDF; без BleedBox — CropBox или страница), /Rotate, размер в мм
curl -H "X-API-Key: $KEY" -F "file=@визитка.pdf" "$API/tools/impose/info"

# схема раскладки без файла: сколько встанет, где копии, резы и метки (мм)
curl -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
     -d '{"item_w": 90, "item_h": 50, "sheet_w": 320, "sheet_h": 450}' "$API/tools/impose/layout"

# готовый лист PDF: trim — рамка обрезного формата в пунктах PDF (из /impose/info)
curl -H "X-API-Key: $KEY" -F "file=@визитка.pdf" \
     -F 'params={"page": 1, "back_page": 2, "trim": [5.67, 5.67, 260.79, 147.4]}' \
     -o лист.pdf "$API/tools/impose/pdf"
```

Параметры раскладки (мм, кроме `trim`): `bleed` вылет (2), `sheet_w`/`sheet_h`
лист (SRA3 320×450), `margin` непечатное поле (5), `gap` зазор: 0 — рез
встык (0), `rotate` можно поворачивать (true), `marks` метки реза (true),
`mark_offset`/`mark_length` (2,5 / 3; отступ меньше вылета поднимается до вылета сам). Для листа ещё `page`, `back_page`
(оборот, null — без него), `flip`: `long` | `short` — как переворачивают лист
(по длинной или короткой стороне — с учётом того, книжный лист или альбомный).
Больше 1000 копий на лист — отказ «изделие слишком мелкое». Число копий — в заголовке ответа `X-Impose-Count`. Страница вставляется в

### Шрифты и курсы

```bash
# поиск: кириллические семейства с «mont» в названии
curl -H "X-API-Key: $KEY" "$API/tools/fonts?q=mont&cyrillic=1"
# zip с обычным и жирным Montserrat (файлы кэшируются на сервере в fonts_cache/)
curl -H "X-API-Key: $KEY" -o Montserrat.zip "$API/tools/fonts/download?family=Montserrat&styles=400,700"
# какие шрифты нужны макету (файл не хранится)
curl -H "X-API-Key: $KEY" -F "file=@макет.cdr" "$API/tools/fonts/from-cdr"
# курсы ЦБ: USD, EUR, CNY и остальные, за 1 единицу в рублях
curl -H "X-API-Key: $KEY" "$API/tools/rates"
```

Каталог шрифтов — снимок в `app/data/google_fonts.json` (обновляется
`python -m scripts.refresh_fonts_catalog`), поиск работает без интернета;
для скачивания серверу нужен доступ к fonts.googleapis.com и fonts.gstatic.com
(таймаут 60 с, иначе 502). Курсы берутся с cbr-xml-daily.ru раз в 12 часов,
кэш в `cache/rates.json`.
лист как есть: цвета CMYK и плашки остаются как в файле.

### Касса и выгрузки

```bash
curl -H "X-API-Key: $KEY" "$API/reports/cash?from=2026-09-24T00:00:00%2B03:00&to=2026-09-25T00:00:00%2B03:00"
curl -H "X-API-Key: $KEY" -o заказы.csv "$API/export/orders.csv?days=30"
```

Касса — `finance.cash`, границы суток задаёт клиент (укажите свой пояс).
CSV — разделитель `;`, UTF-8 с BOM, деньги с запятой — открывается в Excel.

---

## Объекты

### Заказ

| Поле | Тип | Что это |
|---|---|---|
| `id` | int | внутренний номер — для адресов `/api/orders/{id}` |
| `number` | str | номер для людей: `ЗК-2026-000123` |
| `template_key` | str | вид работ |
| `status` | str | см. «Статусы» |
| `title` | str | название |
| `client_id` | int \| null | карточка в справочнике клиентов |
| `client_name`, `client_phone`, `client_contact` | str | снимок на момент заказа; телефон и контакт — только с `clients.view` |
| `quantity` | int | тираж |
| `params` | object | значения полей вида работ |
| `extras` | list | доп. услуги: `{key, qty, title, rate}` |
| `price`, `prepaid` | float | стоимость и внесено — с `orders.price.view` |
| `refunded` | bool | деньги возвращены |
| `payment` | str | `paid`, `partial`, `none`, `refunded`, `overpaid`, `unset` (цены нет), `hidden` (нет права) |
| `debt`, `surplus` | float | к доплате / переплата |
| `due_date` | date \| null | срок |
| `manager` | str | кто принял |
| `notes` | str | заметки |
| `summary` | str | короткое описание состава |
| `cancel_reason` | str | причина отмены |
| `created_at`, `updated_at` | datetime | |
| `events` | list | история: `{id, kind, text, author, created_at}`, до 50, свежие первыми; `kind` — `created`, `status`, `edited`, `note`, `design` |

### Клиент

`{id, name, phone, contact, notes, created_at, updated_at, orders_count,
active_count, last_order_at, total_sum}` — `total_sum` только с
`finance.totals`, иначе `null`.

### Статусы заказа

| Статус | Название | Куда можно |
|---|---|---|
| `new` | Новый | `confirmed`, `cancelled` |
| `confirmed` | Подтверждён | `in_work`, `new`, `cancelled` |
| `in_work` | В работе | `ready`, `confirmed`, `cancelled` |
| `ready` | Готов | `done`, `in_work`, `cancelled` |
| `done` | Выдан | `ready` |
| `cancelled` | Отменён | `new` |

Обычный путь: `new → confirmed → in_work → ready → done`. Те же данные —
в `GET /api/catalog` (`statuses`, `transitions`, `forward`).

---

## Все ручки

Колонка «Право» — какая галочка нужна профилю. «вход» — любой профиль;
«открыто» — без ключа.

### Вход и справочники

| Метод | Путь | Право | Что делает |
|---|---|---|---|
| GET | `/api/auth/me` | открыто | кто я: имя, права (гостю — `kind: guest`) |
| GET | `/api/auth/permissions` | вход | все права с описаниями |
| GET | `/api/catalog` | вход | виды работ, доп. услуги, статусы, переходы |
| GET | `/api/auth/profiles` | открыто | имена для экрана входа (для интерфейса) |
| POST | `/api/auth/employee`, `/api/auth/admin` | открыто | вход паролем (для интерфейса) |

### Заказы

| Метод | Путь | Право | Что делает |
|---|---|---|---|
| GET | `/api/orders` | `orders.view` | список: `status`, `template_key`, `q`, `closed_limit` |
| GET | `/api/orders/{id}` | `orders.view` | один заказ |
| POST | `/api/orders` | `orders.create` (+`orders.price.edit` для денег) | новый заказ → 201 |
| PATCH | `/api/orders/{id}` | `orders.edit` (+`orders.price.edit` для денег) | правка |
| POST | `/api/orders/{id}/status` | `orders.status` | смена статуса `{status, reason}` |
| POST | `/api/orders/{id}/notes` | `orders.edit` | заметка `{text}` |
| DELETE | `/api/orders/{id}` | `orders.delete` | удалить вместе с макетом → 204 |
| GET | `/api/orders/fresh` | `notify.orders` | новые заказы после `after` |
| POST | `/api/price/estimate` | `orders.estimate` | расчёт цены |
| GET | `/api/orders/{id}/payment` | `orders.price.view` | QR и реквизиты для оплаты (`amount`) |
| GET | `/api/stats` | `finance.totals` | суммы и количество по статусам |

### Макеты

| Метод | Путь | Право | Что делает |
|---|---|---|---|
| GET | `/api/orders/{id}/design` | `design.view` | есть ли макет, размер, превью |
| GET | `/api/orders/{id}/design/file` | `design.view` | скачать `.cdr` |
| GET | `/api/orders/{id}/design/preview` | `design.view` | превью PNG |
| GET | `/api/orders/{id}/design/export` | `design.view` | SVG (`page`) или PDF: `format=svg\|pdf` |
| GET | `/api/orders/{id}/design/scene` | `design.view` | разбор содержимого: страницы, объекты, шрифты |
| GET | `/api/orders/{id}/design/link` | `design.view` | ссылка на 5 минут — для браузера |
| POST | `/api/orders/{id}/design` | `design.upload` | загрузить `.cdr` (multipart, поле `file`) |
| DELETE | `/api/orders/{id}/design` | `design.upload` | удалить макет |
| GET | `/api/orders/{id}/design/inspect` | `design.upload` | диагностика файла |

### Инструменты

| Метод | Путь | Право | Что делает |
|---|---|---|---|
| POST | `/api/tools/design-scene` | `tools.viewer` | содержимое любого `.cdr` (multipart, поле `file`), файл не хранится |
| POST | `/api/tools/impose/info` | `tools.impose` | страницы PDF: рамки, поворот, размеры |
| POST | `/api/tools/impose/layout` | `tools.impose` | схема раскладки по размерам, без файла (JSON) |
| POST | `/api/tools/impose/pdf` | `tools.impose` | готовый лист PDF (multipart: `file` + `params` — JSON) |
| GET | `/api/tools` | любое `tools.*` | какие утилиты работают на этом сервере (`viewer` — только с разборщиком .cdr) |
| GET | `/api/tools/fonts` | `tools.fonts` | поиск по снимку каталога Google Fonts: `q`, `cyrillic` (по умолчанию 1), `category`, `limit` |
| GET | `/api/tools/fonts/download` | `tools.fonts` | zip: TTF начертаний `styles=400,700,400i` семейства `family`, установить.cmd, лицензия |
| POST | `/api/tools/fonts/from-cdr` | `tools.fonts` | какие шрифты нужны макету .cdr (multipart `file`), без libcdr; статус system / google / unknown |
| GET | `/api/tools/rates` | `tools.calc` | курсы ЦБ за единицу валюты в рублях; `stale: true` — сети нет, показан последний сохранённый |

### Клиенты

| Метод | Путь | Право | Что делает |
|---|---|---|---|
| GET | `/api/clients` | `clients.search` (с `q`) / `clients.list` | поиск или список: `q`, `sort`, `limit`, `offset` |
| GET | `/api/clients/summary` | `clients.list` | сколько клиентов, выручка (с `finance.totals`) |
| GET | `/api/clients/{id}` | `clients.view` | карточка |
| GET | `/api/clients/{id}/orders` | `clients.history` | заказы клиента, по страницам |
| PATCH | `/api/clients/{id}` | `clients.edit` | правка карточки |
| DELETE | `/api/clients/{id}` | `clients.edit` | удалить карточку (заказы остаются) |
| POST | `/api/clients/{id}/merge` | `clients.edit` | объединить с `{into}` |

### Прайс и виды работ

| Метод | Путь | Право | Что делает |
|---|---|---|---|
| GET | `/api/prices` | `prices.view` | прайс по разделам |
| GET | `/api/prices/{id}/history` | `prices.view` | история цены позиции |
| POST | `/api/prices` | `prices.edit` | новая позиция |
| PATCH | `/api/prices/{id}` | `prices.edit` | правка позиции: `title`, `value`, `unit`, `active`, `note` |
| POST | `/api/prices/{id}/move` | `prices.edit` | перенести в раздел `{group_key}` |
| DELETE | `/api/prices/{id}` | `prices.edit` | удалить позицию |
| POST, PATCH, DELETE | `/api/prices/groups[/{id}]` | `prices.edit` | разделы прайса |
| POST | `/api/prices/restore-defaults` | `prices.edit` | досоздать стандартные позиции |
| GET | `/api/templates`, `/api/templates/meta` | `prices.view` | виды работ для конструктора |
| POST, PATCH, DELETE | `/api/templates[/{id}]` | `prices.edit` | конструктор видов работ |
| POST | `/api/templates/preview` | `prices.edit` | расчёт по несохранённому виду работ |

### Отчёты

| Метод | Путь | Право | Что делает |
|---|---|---|---|
| GET | `/api/reports/cash` | `finance.cash` | касса за период `from`–`to` |
| GET | `/api/reports/cash.csv` | `finance.cash` | то же в CSV |
| GET | `/api/metrics` | `metrics.view` | метрики: `days` или `from`+`to`, `top`, `tz` |
| GET | `/api/export/orders.csv` | `metrics.view` | заказы за `days` дней в CSV |
| GET | `/api/export/clients.csv` | `clients.list` | клиенты в CSV |

### Почта

Все — `mail.access`, работают с ящиками, назначенными профилю (параметр
`account` — номер ящика). Нет назначенного ящика — 503.

| Метод | Путь | Что делает |
|---|---|---|
| GET | `/api/mail/status`, `/api/mail/accounts`, `/api/mail/contacts` | состояние, ящики, адресаты |
| GET | `/api/mail/messages` | входящие по страницам: `before`, `after`, `limit` |
| GET | `/api/mail/fresh` | новые письма по всем своим ящикам |
| GET | `/api/mail/messages/{uid}` | письмо целиком (помечает прочитанным) |
| GET | `/api/mail/messages/{uid}/attachments/{index}` | вложение |
| GET | `/api/mail/ref` | найти письмо по Message-ID |
| POST | `/api/mail/messages/{uid}/seen` | прочитано / не прочитано |
| POST | `/api/mail/messages/{uid}/reply` | ответить `{text}` |
| POST | `/api/mail/send` | написать `{to, subject, text}` |

### Администрирование

Всё ниже — право `staff.manage` («Управлять сотрудниками»), оно включает
все остальные. Боту его давать не нужно.

| Метод | Путь | Что делает |
|---|---|---|
| GET, POST, PATCH, DELETE | `/api/employees[/{id}]` | профили сотрудников |
| GET | `/api/employees/permissions` | права и набор по умолчанию |
| GET, POST | `/api/employees/{id}/api-key` | показать / перевыпустить ключ — **только администратор** из `.env`, по ключу недоступно |
| GET, PATCH, DELETE | `/api/devices[/{id}]` | компьютеры сотрудников |
| GET, POST, PATCH, DELETE | `/api/mail-accounts[/{id}]`, `…/{id}/check` | почтовые ящики |
| GET, PUT | `/api/settings` | реквизиты, QR, настройки мастерской |
| GET | `/api/logs`, `/api/logs/backups` | журнал и список копий |
| POST | `/api/logs/backup` | копия базы сейчас |

Вне `/api`: `GET /health` → `{"ok": true}` без ключа — для мониторинга.

---

## Подводные камни

- **Деньги при создании заказа.** Без `orders.price.edit` поля `price`,
  `prepaid`, `refunded` нельзя даже упоминать в теле — 403.
- **PATCH меняет только присланное.** Не переданное поле и поле со
  значением `null` остаются как были — у заказов, клиентов, сотрудников,
  ящиков, позиций и разделов прайса, видов работ. Исключения в заказе:
  `null` в `due_date` и `client_id` очищает срок и привязку к клиенту.
- **`fields` вида работ переписываются целиком**, если их прислать:
  передайте полный список полей или не передавайте `fields` вовсе.
- **`params` заказа тоже заменяются целиком** — пришлите все значения.
- **Страниц у списка заказов нет** — только `closed_limit` и поиск до 200.
  Для больших выборок — `GET /api/export/orders.csv`.
- **Две формы 422** — см. [«Ответы и ошибки»](#ответы-и-ошибки).
- **Время — в UTC.** Для «кассы за сегодня» передавайте границы суток со
  своим поясом (`…T00:00:00+03:00`).

---

## Безопасность ключа

- **Один бот — один профиль — один ключ.** Так бот видит только своё, а
  отключить его можно, не трогая людей.
- **Минимум прав.** Боту уведомлений хватит `orders.view` и
  `notify.orders`; денег и клиентов ему не нужно.
- **Ключ — не в коде.** Держите в переменной окружения или в хранилище
  секретов, не коммитьте в репозиторий, не вставляйте в чат.
- **Утёк — перевыпустите.** «Сотрудники» → профиль → «Перевыпустить»:
  старый ключ перестаёт работать сразу. Каждый показ и перевыпуск ключа
  записан в журнале («Журнал» в интерфейсе): кто и когда.
- **Только https.** По http ключ идёт открытым текстом.
- Сервер хранит ключ в базе отпечатком и шифром — копия базы без `.env`
  ключей не раскроет. Подробнее — README, «Доступ к API: ключи сотрудников».
