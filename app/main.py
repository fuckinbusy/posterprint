"""Точка входа.

Запуск:  uvicorn app.main:app --reload
Интерфейс: http://127.0.0.1:8000/
Документация API: http://127.0.0.1:8000/docs
"""

import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app import logs
from app.database import SessionLocal, check_integrity
from app.security import PASSWORD_IS_DEFAULT
from app.database import init_db
from app.routers import (
    auth,
    clients,
    designs,
    logs as logs_router,
    devices,
    employees,
    metrics,
    orders,
    prices,
    templates,
)

BASE_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = BASE_DIR / "static"


@asynccontextmanager
async def lifespan(_app: FastAPI):
    logs.setup()
    # если база повреждена — не запускаемся: работа с битой базой теряет данные
    # дальше, а бэкапы начинают копировать уже испорченное
    if not check_integrity():
        raise RuntimeError(
            "База данных повреждена. Восстановите её из бэкапа "
            "(python -m scripts.restore --list) и запустите снова."
        )

    init_db()  # создаём таблицы, если их ещё нет
    seed_if_empty()  # только на чистой базе: прайс, разделы и виды работ

    from app import designs as designs_storage
    designs_storage.ensure_dirs()  # папка для макетов
    if PASSWORD_IS_DEFAULT:
        print("[!] POSTER_ADMIN_PASSWORD не задан — админский профиль открывается паролем «admin».")
        print("    Задайте свой пароль в файле .env перед тем, как открывать доступ коллегам.")
    yield


app = FastAPI(title="ПОСТЕР · заказы", version="0.1.0", lifespan=lifespan)

# Кто может обращаться к API из браузера. По умолчанию — только сам сервер и
# режим разработки с горячей перезагрузкой (vite на :5173). Свой адрес добавьте
# в .env: POSTER_ALLOWED_ORIGINS=http://192.168.1.10:8000,http://poster.local
#
# Токен ходит в заголовке, а не в куках, поэтому чужая вкладка сама по себе им
# и раньше воспользоваться не могла — но и разрешать «*» без причины незачем.
DEFAULT_ORIGINS = [
    "http://localhost:8000", "http://127.0.0.1:8000",
    "http://localhost:5173", "http://127.0.0.1:5173",
]
_origins_env = (os.getenv("POSTER_ALLOWED_ORIGINS") or "").strip()
ALLOWED_ORIGINS = (
    [o.strip() for o in _origins_env.split(",") if o.strip()]
    if _origins_env
    else DEFAULT_ORIGINS
)

app.add_middleware(
    CORSMiddleware,
    # запросы «в свой же адрес» браузер шлёт без Origin — интерфейс, открытый
    # с этого сервера, работает независимо от этого списка
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def log_requests(request: Request, call_next):
    """Одна строка на запрос и полный трейсбек на ошибку.

    Стоимость — замер времени и одна запись в файл; на фоне работы с базой
    это незаметно. Статика и превью пропускаются: их много, а пользы нет.
    """
    path = request.url.path
    if not logs.should_log(path):
        return await call_next(request)

    timer = logs.Timer()
    who = request.headers.get("x-device-key", "")[:8] or "—"

    try:
        response = await call_next(request)
    except Exception:
        error_id = logs.new_error_id()
        logs.log.exception(
            "ОШИБКА %s · %s %s · устройство %s · %s мс",
            error_id, request.method, path, who, timer.ms,
        )
        # сотруднику показываем короткий номер: по нему вы найдёте трейсбек
        return JSONResponse(
            status_code=500,
            content={"detail": f"Внутренняя ошибка (№{error_id}). Покажите номер администратору."},
        )

    ms = timer.ms
    if response.status_code >= 500:
        logs.log.error("%s %s → %s · %s мс · устройство %s", request.method, path, response.status_code, ms, who)
    elif response.status_code >= 400:
        logs.log.warning("%s %s → %s · %s мс · устройство %s", request.method, path, response.status_code, ms, who)
    elif ms >= logs.SLOW_MS:
        logs.log.warning("МЕДЛЕННО %s %s → %s · %s мс", request.method, path, response.status_code, ms)
    elif logs.LOG_REQUESTS:
        logs.log.info("%s %s → %s · %s мс", request.method, path, response.status_code, ms)

    return response


app.include_router(auth.router)
app.include_router(orders.router)
app.include_router(clients.router)
app.include_router(prices.router)
app.include_router(templates.router)
app.include_router(designs.router)
app.include_router(logs_router.router)
app.include_router(employees.router)
app.include_router(devices.router)
app.include_router(metrics.router)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


# Саму страницу браузеру кэшировать нельзя: имена файлов сборки меняются при
# каждом npm run build, и адреса новых лежат внутри index.html. Без этого
# заголовка браузер держит старую страницу, продолжает грузить прежний
# бандл — и обновление интерфейса не доезжает до сотрудника, пока он не
# сделает жёсткую перезагрузку. Сами файлы сборки кэшируются как обычно:
# у них в имени хэш, старый адрес просто перестаёт запрашиваться.
NO_CACHE = {"Cache-Control": "no-cache, must-revalidate"}


@app.get("/", include_in_schema=False)
def index() -> FileResponse:
    """Отдаёт интерфейс.

    Основной фронтенд — собранный React из static/dist (исходники в web/,
    сборка командой `npm run build`). Прежний интерфейс на ванильном JS
    остаётся рядом как запасной: если сборки нет, отдаём его. Убрать его
    можно, когда новый отработает на живых заказах.
    """
    built = STATIC_DIR / "dist" / "index.html"
    if built.exists():
        return FileResponse(built, headers=NO_CACHE)
    return FileResponse(STATIC_DIR / "index.html", headers=NO_CACHE)


@app.get("/legacy", include_in_schema=False)
def legacy_index() -> FileResponse:
    """Прежний интерфейс — на случай, если в новом что-то не работает."""
    return FileResponse(STATIC_DIR / "index.html", headers=NO_CACHE)


def seed_if_empty() -> None:
    """Стартовый каталог — но ТОЛЬКО на полностью пустой базе.

    Проверяем именно пустоту, а не «чего не хватает». Раньше сиды дополняли
    каталог по недостающим ключам, и удалённый администратором раздел
    возвращался при следующем запуске — из-за этого их и пришлось отключить.
    Теперь настроенную базу они не трогают вовсе: заполнить есть что только
    при первом запуске на новом компьютере.

    Вернуть удалённые позиции по-прежнему можно кнопкой «Восстановить
    недостающие» на странице «Прайс» — там это осознанное действие человека.
    """
    from sqlalchemy import select

    from app.models import PriceGroup, PriceItem, Template
    from app.seed_catalog import seed_price_groups, seed_price_items, seed_templates

    db = SessionLocal()
    try:
        configured = any(
            db.scalar(select(model).limit(1)) is not None
            for model in (PriceGroup, PriceItem, Template)
        )
        if configured:
            return

        groups = seed_price_groups(db)
        items = seed_price_items(db)
        works = seed_templates(db)
        print(
            f"[i] База пустая — залит стартовый каталог: разделов прайса {groups}, "
            f"позиций {items}, видов работ {works}."
        )
        print("    Дальше всё правится в интерфейсе, повторно сиды не сработают.")
    finally:
        db.close()


@app.get("/health", include_in_schema=False)
def health() -> dict:
    return {"ok": True}