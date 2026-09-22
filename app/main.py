"""Точка входа.

Запуск:  uvicorn app.main:app --reload
Интерфейс: http://127.0.0.1:8000/
Документация API: http://127.0.0.1:8000/docs (в режиме POSTER_PUBLIC выключена)

Сервер в интернете — см. README, «Удалённый доступ» и app/core/deploy.py.
"""

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app.api.v1 import router as api_router
from app.core import deploy, logs
from app.core.database import SessionLocal, check_integrity, init_db
from app.core.paths import BASE_DIR
from app.core.security import PASSWORD_IS_DEFAULT, PASSWORD_IS_PLAIN
from app.services import autobackup
from app.services import settings as settings_logic

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

    # Сервер смотрит в интернет — с паролем «admin» и без ключа подписи не
    # стартуем вовсе: снаружи это найдут раньше, чем владелец заметит.
    if deploy.PUBLIC:
        problems = deploy.check(os.environ)
        if problems:
            raise RuntimeError(
                "POSTER_PUBLIC=1, но сервер не готов к открытому доступу:\n  - " + "\n  - ".join(problems)
            )

    init_db()  # создаём таблицы, если их ещё нет
    seed_if_empty()  # только на чистой базе: прайс, разделы и виды работ

    from app.services import designs as designs_storage
    designs_storage.ensure_dirs()  # папка для макетов
    if PASSWORD_IS_DEFAULT:
        print("[!] Пароль администратора не задан — профиль открывается паролем «admin».")
        print("    Задайте свой: python -m scripts.set_password")
    elif PASSWORD_IS_PLAIN:
        print("[!] POSTER_ADMIN_PASSWORD лежит в .env открытым текстом — его прочитает любой, кто откроет файл.")
        print("    Переведите в хэш: python -m scripts.set_password")
    for problem in deploy.file_permission_problems(BASE_DIR, data_paths()):
        logs.log.warning("Права на файлы: %s", problem)
    encrypt_secrets()
    migrate_mail()
    if deploy.PUBLIC:
        warn_open_profiles()

    scheduler = autobackup.from_env()
    if scheduler is not None:
        scheduler.start()
    yield
    if scheduler is not None:
        scheduler.stop()


app = FastAPI(
    title="ПОСТЕР · заказы",
    version="0.1.0",
    lifespan=lifespan,
    # описание API наружу не отдаём: сотрудникам оно не нужно, а чужому —
    # готовая карта всех ручек
    # за прокси под своим путём («/poster-crm»): так FastAPI строит верные
    # адреса в документации и переадресациях
    root_path=deploy.BASE_PATH,
    docs_url=None if deploy.PUBLIC else "/docs",
    redoc_url=None if deploy.PUBLIC else "/redoc",
    openapi_url=None if deploy.PUBLIC else "/openapi.json",
)

# На какие имена сервер отзывается. Задано — чужой Host отбивается сразу
# (без этого заголовок Host можно подставить в ссылку на сброс, в письмо и
# т. п.). Не задано — как раньше, для домашней сети и разработки.
if deploy.ALLOWED_HOSTS:
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=deploy.ALLOWED_HOSTS)

# сотруднику на удалёнке доска и прайс уезжают в несколько раз быстрее сжатыми;
# файлы сборки и так сжаты прокси, но сервер может стоять и без него
app.add_middleware(GZipMiddleware, minimum_size=1024)

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
    # тело больше разумного отсекаем до чтения: иначе оно целиком ляжет в память
    if deploy.body_too_large(path, request.headers.get("content-length")):
        return JSONResponse(status_code=413, content={"detail": "Слишком большой запрос"})

    if not logs.should_log(path):
        response = await call_next(request)
        response.headers.update(deploy.security_headers(path, request.url.scheme))
        return response

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

    response.headers.update(deploy.security_headers(path, request.url.scheme))
    return response


app.include_router(api_router)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


# Саму страницу браузеру кэшировать нельзя: имена файлов сборки меняются при
# каждом npm run build, и адреса новых лежат внутри index.html. Без этого
# заголовка браузер держит старую страницу, продолжает грузить прежний
# бандл — и обновление интерфейса не доезжает до сотрудника, пока он не
# сделает жёсткую перезагрузку. Сами файлы сборки кэшируются как обычно:
# у них в имени хэш, старый адрес просто перестаёт запрашиваться.
NO_CACHE = {"Cache-Control": "no-cache, must-revalidate"}


@app.get("/", include_in_schema=False)
def index() -> HTMLResponse:
    """Отдаёт интерфейс: собранный React из static/dist (исходники в web/,
    сборка командой `npm run build`). Файл читается на каждый запрос — он
    маленький, а после пересборки новая страница уезжает без перезапуска."""
    html = (STATIC_DIR / "dist" / "index.html").read_text(encoding="utf-8")
    return HTMLResponse(deploy.inject_base(html, deploy.BASE_PATH), headers=NO_CACHE)


def data_paths() -> list:
    """Где лежат данные, которые не должны читать другие пользователи машины."""
    from app.core.database import sqlite_file
    from app.services import backup, designs

    paths = [backup.BACKUP_DIR, designs.DESIGNS_DIR, logs.LOG_DIR]
    db_file = sqlite_file()
    if db_file is not None:
        paths.append(db_file)
    return paths


def encrypt_secrets() -> None:
    """Пароли в настройках, записанные до появления шифрования, — зашифровать."""
    db = SessionLocal()
    try:
        changed = settings_logic.encrypt_at_rest(db)
    finally:
        db.close()
    if changed:
        logs.log.info("Настройки: зашифровано секретов, хранившихся открытым текстом: %s", changed)


def migrate_mail() -> None:
    """Единственный ящик из прежних «Настроек» (или .env) → список ящиков."""
    from app.services import mail_accounts

    db = SessionLocal()
    try:
        account = mail_accounts.migrate_legacy(db)
    finally:
        db.close()
    if account is not None:
        logs.log.info("Почта: ящик %s перенесён из настроек в список ящиков", account.user)


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
    from app.services.seed_catalog import seed_price_groups, seed_price_items, seed_templates

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


def warn_open_profiles() -> None:
    """В открытом режиме профиль без пароля, в который можно войти с любого
    компьютера, — это вход без пароля для всего интернета. Не запрещаем: так
    мог быть настроен планшет в цехе, — но пишем в журнал крупно."""
    from sqlalchemy import select

    from app.models import Employee

    db = SessionLocal()
    try:
        rows = db.scalars(
            select(Employee).where(
                Employee.active.is_(True), Employee.password_hash == "", Employee.access_mode == "any"
            )
        ).all()
    finally:
        db.close()
    for employee in rows:
        logs.log.warning(
            "Профиль «%s» без пароля и без привязки к компьютеру — в него войдёт любой из интернета. "
            "Задайте пароль или привяжите к устройствам.",
            employee.name,
        )


@app.get("/health", include_in_schema=False)
def health() -> dict:
    return {"ok": True}
