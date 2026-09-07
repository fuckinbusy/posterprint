"""Подключение к базе данных.

По умолчанию — локальный SQLite-файл рядом с проектом.
Когда переедете на серверную базу, создайте файл .env рядом с requirements.txt
(за образец — .env.example) и укажите там:

    POSTER_DB_URL=postgresql+psycopg://user:pass@host:5432/poster

Больше ничего в коде менять не нужно.
"""

import os
from collections.abc import Iterator
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

load_dotenv()  # подхватывает .env, если он есть; переменные окружения имеют приоритет

BASE_DIR = Path(__file__).resolve().parent.parent

# .strip() и обрезка хвоста: если в .env рядом со значением осталось
# пояснение, приложение не должно падать с непонятной ошибкой
DB_URL = (os.getenv("POSTER_DB_URL") or "sqlite:///./poster.db").strip().split()[0]

# check_same_thread нужен только SQLite: FastAPI работает в нескольких потоках
connect_args = {"check_same_thread": False} if DB_URL.startswith("sqlite") else {}

engine = create_engine(DB_URL, connect_args=connect_args, future=True)

if DB_URL.startswith("sqlite"):

    @event.listens_for(engine, "connect")
    def _configure_sqlite(dbapi_conn, _record):
        """Настройки соединения: защита от повреждения базы и русский поиск.

        Почему это важнее, чем разносить данные по нескольким файлам: SQLite
        не бьётся «сам по себе» — его ломает обрыв питания посреди записи,
        отказ диска или сторонняя программа, трогающая файл. Журнал WAL
        закрывает первую причину полностью: незавершённая запись просто
        откатывается при следующем открытии, база остаётся целой.
        """
        cursor = dbapi_conn.cursor()
        # WAL: запись идёт в отдельный журнал, основной файл не рвётся на середине
        cursor.execute("PRAGMA journal_mode=WAL")
        # ждём освобождения базы вместо мгновенной ошибки, если пишут двое
        cursor.execute("PRAGMA busy_timeout=5000")
        # проверять внешние ключи: заказ не сможет сослаться на удалённого клиента
        cursor.execute("PRAGMA foreign_keys=ON")
        # компромисс скорости и надёжности: при WAL этого достаточно
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.close()

        # Встроенный lower() в SQLite умеет только латиницу — «МЕНЮ» не найдётся.
        # Подменяем питоновским, чтобы поиск работал и по кириллице.
        dbapi_conn.create_function("lower", 1, lambda s: s.lower() if s else s)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_db() -> Iterator[Session]:
    """Зависимость FastAPI: одна сессия на запрос."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    from app import models  # noqa: F401  — регистрируем модели перед create_all

    check_integrity()
    Base.metadata.create_all(bind=engine)
    _ensure_columns()


def check_integrity() -> bool:
    """Проверяет целостность базы при старте.

    Повреждение лучше заметить сразу, а не через неделю, когда все бэкапы
    окажутся копиями уже битого файла.
    """
    if not DB_URL.startswith("sqlite"):
        return True

    from sqlalchemy import text

    path = sqlite_file()
    if path is None or not path.exists():
        return True  # базы ещё нет — создастся чистой

    try:
        with engine.connect() as conn:
            result = conn.execute(text("PRAGMA quick_check")).scalar()
    except Exception as exc:  # noqa: BLE001 — сюда попадаем, если файл нечитаем
        print(f"[!] База {path.name} не открывается: {exc}")
        print("    Восстановите из бэкапа:  python -m scripts.restore --list")
        return False

    if result != "ok":
        print(f"[!] БАЗА ПОВРЕЖДЕНА: {result}")
        print(f"    Файл: {path}")
        print("    Не работайте с ней — данные будут теряться дальше.")
        print("    Восстановление:  python -m scripts.restore --list")
        return False
    return True


def sqlite_file() -> Path | None:
    """Путь к файлу базы, если используется SQLite."""
    if not DB_URL.startswith("sqlite"):
        return None
    raw = DB_URL.split("///", 1)[-1]
    path = Path(raw)
    return path if path.is_absolute() else (BASE_DIR / raw).resolve()


# Колонки, которые появились в схеме уже после первых запусков.
# create_all создаёт новые таблицы, но не меняет существующие — дописываем сами.
# Формат: таблица -> {колонка: тип с умолчанием}
ADDED_COLUMNS: dict[str, dict[str, str]] = {
    "orders": {
        "extras": "JSON",
        "completed_at": "TIMESTAMP",
        "client_id": "INTEGER",
        # FALSE, а не 0: Postgres не примет число в умолчании булевой колонки
        "refunded": "BOOLEAN DEFAULT FALSE",
        "cancel_reason": "VARCHAR(300) DEFAULT ''",
    },
    "employees": {
        "access_mode": "VARCHAR(20) DEFAULT 'any'",
        "allowed_devices": "JSON",
    },
    "template_fields": {
        "unit": "VARCHAR(10) DEFAULT 'мм'",
        "source_field": "VARCHAR(40) DEFAULT ''",
    },
    "price_items": {
        "unit": "VARCHAR(20) DEFAULT ''",
    },
    "price_groups": {
        "parent_key": "VARCHAR(40) DEFAULT ''",
    },
}


def _ensure_columns() -> None:
    """Мини-миграция: дописывает колонки, которых нет в уже созданной базе.

    Пока схема правится редко, этого хватает. Когда изменений станет много —
    Alembic. Добавили новое поле в models.py? Впишите его и сюда, иначе на
    существующей базе будет «no such column».
    """
    from sqlalchemy import inspect, text

    inspector = inspect(engine)
    tables = set(inspector.get_table_names())

    # Что вообще предстоит дописать — считаем заранее, чтобы снять копию
    # ДО первого ALTER TABLE. Обновление схемы необратимо, а откатываться
    # к копии проще, чем разбираться в полурасширенной базе.
    pending = [
        (table, column)
        for table, columns in ADDED_COLUMNS.items()
        if table in tables
        for column in columns
        if column not in {c["name"] for c in inspector.get_columns(table)}
    ]
    if pending:
        _backup_before_migration(pending)

    for table, columns in ADDED_COLUMNS.items():
        if table not in tables:
            continue  # таблицы нет — create_all создаст её сразу правильной
        existing = {col["name"] for col in inspector.get_columns(table)}
        for column, ddl in columns.items():
            if column in existing:
                continue
            with engine.begin() as conn:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}"))
            print(f"[i] База обновлена: в таблицу {table} добавлена колонка {column}.")

    _fill_defaults()
    _ensure_indexes()


def _backup_before_migration(pending: list[tuple[str, str]]) -> None:
    """Снимает копию базы перед изменением схемы."""
    if not DB_URL.startswith("sqlite"):
        return
    source = sqlite_file()
    if source is None or not source.exists():
        return

    import sqlite3
    from datetime import datetime

    target_dir = BASE_DIR / "backups" / f"{datetime.now():%Y-%m-%d_%H-%M-%S}_before-update"
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / source.name

    try:
        src = sqlite3.connect(f"file:{source}?mode=ro", uri=True)
        dst = sqlite3.connect(target)
        try:
            src.backup(dst)
        finally:
            dst.close()
            src.close()
        what = ", ".join(f"{t}.{c}" for t, c in pending)
        print(f"[i] Перед обновлением схемы ({what}) снята копия: {target_dir.name}")
    except Exception as exc:  # noqa: BLE001 — копия не должна мешать запуску
        print(f"[!] Не удалось снять копию перед обновлением: {exc}")


def _ensure_indexes() -> None:
    """Уникальность телефона клиента.

    Без неё два одновременных заказа одному клиенту заводили две карточки.
    Перед созданием индекса схлопываем уже накопившиеся дубли: заказы
    переносим на самую раннюю карточку, остальные удаляем.
    """
    from sqlalchemy import inspect, text

    inspector = inspect(engine)
    if "clients" not in set(inspector.get_table_names()):
        return
    if any(ix["name"] == "uq_client_phone" for ix in inspector.get_indexes("clients")):
        return

    with engine.begin() as conn:
        # пустые телефоны — в NULL, иначе они конфликтуют между собой
        conn.execute(text("UPDATE clients SET phone_norm = NULL WHERE phone_norm = ''"))

        dupes = conn.execute(text("""
            SELECT phone_norm, MIN(id) AS keep, COUNT(*) AS n
            FROM clients WHERE phone_norm IS NOT NULL
            GROUP BY phone_norm HAVING COUNT(*) > 1
        """)).fetchall()

        for phone_norm, keep, count in dupes:
            conn.execute(
                text("UPDATE orders SET client_id = :keep "
                     "WHERE client_id IN (SELECT id FROM clients "
                     "WHERE phone_norm = :p AND id != :keep)"),
                {"keep": keep, "p": phone_norm},
            )
            conn.execute(
                text("DELETE FROM clients WHERE phone_norm = :p AND id != :keep"),
                {"keep": keep, "p": phone_norm},
            )
            print(f"[i] Клиенты: слито дублей по телефону {phone_norm}: {count - 1}")

        conn.execute(text("CREATE UNIQUE INDEX uq_client_phone ON clients (phone_norm)"))
        print("[i] Телефон клиента теперь уникален.")


def _fill_defaults() -> None:
    """Проставляет значения там, где ALTER TABLE оставил NULL.

    JSON-колонки нельзя объявить с умолчанием на уровне SQLite, поэтому
    заполняем их отдельно — иначе у старых профилей allowed_devices будет
    NULL вместо пустого списка.
    """
    from sqlalchemy import inspect, text

    inspector = inspect(engine)
    if "employees" not in set(inspector.get_table_names()):
        return
    with engine.begin() as conn:
        conn.execute(text("UPDATE employees SET allowed_devices = '[]' WHERE allowed_devices IS NULL"))
        conn.execute(text("UPDATE employees SET access_mode = 'any' WHERE access_mode IS NULL"))

    if "template_fields" in set(inspector.get_table_names()):
        with engine.begin() as conn:
            conn.execute(text("UPDATE template_fields SET unit = 'мм' WHERE unit IS NULL OR unit = ''"))
    if "orders" in set(inspector.get_table_names()):
        with engine.begin() as conn:
            conn.execute(text("UPDATE orders SET extras = '[]' WHERE extras IS NULL"))

    # Единица переехала с раздела прайса на позицию: раньше «₽/пог.м» стояло
    # на всём разделе, из-за чего люверсы (₽/шт) приходилось выносить в
    # отдельный раздел. Старым позициям проставляем единицу их раздела —
    # выглядеть и считаться всё будет ровно как до обновления.
    tables = set(inspector.get_table_names())
    if {"price_items", "price_groups"} <= tables:
        with engine.begin() as conn:
            conn.execute(text(
                "UPDATE price_items SET unit = ("
                "  SELECT g.unit FROM price_groups g WHERE g.key = price_items.group_key"
                ") WHERE (unit IS NULL OR unit = '') AND EXISTS ("
                "  SELECT 1 FROM price_groups g WHERE g.key = price_items.group_key)"
            ))