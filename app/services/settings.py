"""Настройки, которые правит владелец из интерфейса.

Реквизиты мастерской для квитанции и платёжные реквизиты для QR раньше
жили только в .env. Это работало, пока их заводил тот, кто ставил систему;
но правит их владелец, а лезть в файл рядом с программой он не должен.

Хранение — таблица ключ/значение. Значение из базы главнее .env; ключа в
базе нет — берётся .env, как раньше. Так ничего не ломается у тех, кто уже
всё настроил в файле, а страница «Настройки» показывает, откуда взято
каждое значение.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import crypto
from app.models import Setting

# ключ в базе → переменная в .env. Порядок — как на странице настроек.
KEYS: dict[str, str] = {
    "shop_name": "POSTER_SHOP_NAME",
    "shop_phone": "POSTER_SHOP_PHONE",
    "shop_address": "POSTER_SHOP_ADDRESS",
    "shop_note": "POSTER_SHOP_NOTE",
    "shop_logo": "",                      # только в базе: картинка data:-строкой
    "pay_mode": "POSTER_PAY_MODE",
    "pay_link": "POSTER_PAY_LINK",
    "pay_name": "POSTER_PAY_NAME",
    "pay_account": "POSTER_PAY_ACCOUNT",
    "pay_bank": "POSTER_PAY_BANK",
    "pay_bic": "POSTER_PAY_BIC",
    "pay_corr_account": "POSTER_PAY_CORR_ACCOUNT",
    "pay_inn": "POSTER_PAY_INN",
    "pay_kpp": "POSTER_PAY_KPP",
    "pay_card": "POSTER_PAY_CARD",
    "pay_phone": "POSTER_PAY_PHONE",
    "pay_note": "POSTER_PAY_NOTE",
    "pay_encoding": "POSTER_PAY_ENCODING",
    # почта: ящик, пароль приложения, серверы, имя отправителя
    "mail_user": "POSTER_MAIL_USER",
    "mail_password": "POSTER_MAIL_PASSWORD",
    "mail_imap": "POSTER_MAIL_IMAP",
    "mail_smtp": "POSTER_MAIL_SMTP",
    "mail_sender": "POSTER_MAIL_SENDER",
    # свои адресаты для сотрудников: JSON-список {name, email}; только в базе
    "mail_contacts": "",
}

# что не показываем обратно в интерфейс: только «задано / не задано».
# В базе эти значения лежат зашифрованными (app/core/crypto.py)
SECRET_KEYS = {"mail_password"}

# логотип — картинка, вшитая строкой; больше не нужно, это шапка квитанции
MAX_LOGO_BYTES = 400 * 1024


def overrides(db: Session) -> dict[str, str]:
    """Что записано в базе. Только эти ключи перекрывают .env."""
    rows = db.scalars(select(Setting)).all()
    return {
        row.key: (crypto.decrypt(row.value) if row.key in SECRET_KEYS else row.value)
        for row in rows
        if row.key in KEYS
    }


def save(db: Session, values: dict[str, str]) -> None:
    """Записывает все известные ключи. Пустое значение — тоже значение:
    владелец очистил поле, и .env его подставлять не должен."""
    existing = {row.key: row for row in db.scalars(select(Setting)).all()}
    for key in KEYS:
        if key not in values:
            continue
        value = str(values[key] or "").strip()
        if key == "shop_logo" and len(value.encode("utf-8")) > MAX_LOGO_BYTES:
            raise ValueError(f"Логотип больше {MAX_LOGO_BYTES // 1024} КБ — уменьшите картинку")
        if key in SECRET_KEYS:
            value = crypto.encrypt(value)
        if key in existing:
            existing[key].value = value
        else:
            db.add(Setting(key=key, value=value))
    db.commit()


def encrypt_at_rest(db: Session) -> int:
    """Секреты, записанные до появления шифрования, лежат открытым текстом —
    зашифровать при старте. Возвращает, сколько записей переведено."""
    changed = 0
    for row in db.scalars(select(Setting).where(Setting.key.in_(SECRET_KEYS))).all():
        if row.value and not crypto.is_encrypted(row.value):
            row.value = crypto.encrypt(row.value)
            changed += 1
    if changed:
        db.commit()
    return changed


def pick(overrides_map: dict[str, str] | None, key: str, env_value: str) -> str:
    """Значение из базы, если оно там есть, иначе из .env."""
    if overrides_map is not None and key in overrides_map:
        return overrides_map[key].strip()
    return env_value
