"""Платёжные реквизиты и QR-код для оплаты заказа.

Что показывает клиенту сотрудник, когда тот спрашивает «куда платить».

Платёжная строка — ГОСТ Р 56042-2014. Её понимают банковские приложения:
клиент наводит камеру, и все реквизиты со суммой подставляются сами. Это
и есть весь смысл: продиктованный вслух счёт из двадцати цифр клиент рано
или поздно наберёт с ошибкой, а сумму — тем более.

    ST00012|Name=ООО Ромашка|PersonalAcc=40702810…|BankName=Сбербанк|
    BIC=044525225|CorrespAcc=30101810…|Sum=280000|Purpose=Оплата заказа …

Устройство строки:

* `ST0001` — идентификатор формата, дальше цифра кодировки:
  1 — windows-1251, 2 — UTF-8, 3 — KOI8-R. Мы пишем UTF-8 (`ST00012`), но
  кодировку можно переключить: банки-приёмники встречаются разные, и если
  чей-то сканер не понял кириллицу, проще сменить настройку, чем код.
* Разделитель полей — `|`. Первые пять полей обязательны по стандарту,
  остальные дополнительные.
* **`Sum` — в копейках**, целым числом. 2800 ₽ → `Sum=280000`. Ошибка тут
  дороже всех прочих: клиент оплатит в сто раз больше или меньше.

Реквизиты живут в .env: их заводят один раз, и заводит их владелец, а не
программист. Проверяем их формально (длина счёта, БИК, ИНН) — неверный
реквизит превратится в QR, который банк отвергнет уже при клиенте, и
разбираться в этом у стойки некому.
"""

from __future__ import annotations

import os
import re

from dotenv import load_dotenv

load_dotenv()

# кодировка платёжной строки: цифра в конце ST0001x и как её зовут в Python
ENCODINGS = {"utf8": ("2", "utf-8"), "win1251": ("1", "cp1251")}


def _env(name: str) -> str:
    return (os.getenv(name) or "").strip()


def _digits(value: str) -> str:
    return re.sub(r"\D", "", value or "")


def settings() -> dict:
    """Реквизиты из .env. Пусто — значит, оплату показывать нечем."""
    return {
        # для QR по ГОСТ (все пять обязательны)
        "name": _env("POSTER_PAY_NAME"),
        "account": _digits(_env("POSTER_PAY_ACCOUNT")),
        "bank": _env("POSTER_PAY_BANK"),
        "bic": _digits(_env("POSTER_PAY_BIC")),
        "corr_account": _digits(_env("POSTER_PAY_CORR_ACCOUNT")),
        # дополнительные — банки часто просят ИНН
        "inn": _digits(_env("POSTER_PAY_INN")),
        "kpp": _digits(_env("POSTER_PAY_KPP")),
        # то, что просто показываем на экране, без QR
        "card": _env("POSTER_PAY_CARD"),
        "phone": _env("POSTER_PAY_PHONE"),
        "note": _env("POSTER_PAY_NOTE"),
        "encoding": _env("POSTER_PAY_ENCODING").lower() or "utf8",
    }


def _qr_library_missing() -> bool:
    """Установлена ли библиотека, которая рисует код.

    Проверяем явно: без неё ручка оплаты падала бы пятисоткой, а сотрудник
    у стойки видел бы «внутренняя ошибка» вместо понятного «доставьте
    зависимости». На старых установках, обновлённых из git, такое бывает.
    """
    try:
        import segno  # noqa: F401
    except ImportError:
        return True
    return False


def problems(config: dict) -> list[str]:
    """Что не так с реквизитами. Пустой список — можно делать QR.

    Проверяем формально: длину и то, что это цифры. Правильность самого
    счёта отсюда не видна, но опечатка в одной цифре ловится банком уже
    при клиенте — а это худшее место, чтобы узнать о проблеме.
    """
    found: list[str] = []
    if not config["name"]:
        found.append("не указано название получателя (POSTER_PAY_NAME)")
    if len(config["account"]) != 20:
        found.append("расчётный счёт должен быть из 20 цифр (POSTER_PAY_ACCOUNT)")
    if not config["bank"]:
        found.append("не указан банк (POSTER_PAY_BANK)")
    if len(config["bic"]) != 9:
        found.append("БИК должен быть из 9 цифр (POSTER_PAY_BIC)")
    if len(config["corr_account"]) != 20:
        found.append("корр. счёт должен быть из 20 цифр (POSTER_PAY_CORR_ACCOUNT)")
    if config["inn"] and len(config["inn"]) not in (10, 12):
        found.append("ИНН бывает из 10 или 12 цифр (POSTER_PAY_INN)")
    if config["kpp"] and len(config["kpp"]) != 9:
        found.append("КПП должен быть из 9 цифр (POSTER_PAY_KPP)")
    if config["encoding"] not in ENCODINGS:
        found.append("POSTER_PAY_ENCODING бывает utf8 или win1251")
    if found:
        # про библиотеку говорим, только когда остальное уже в порядке:
        # иначе это лишняя строка в списке к незаполненным реквизитам
        return found
    if _qr_library_missing():
        found.append(
            "не установлена библиотека segno, которая рисует код — "
            "выполните pip install -r requirements.txt"
        )
    return found


def has_qr(config: dict) -> bool:
    """Хватает ли реквизитов на платёжную строку."""
    return not problems(config)


def has_anything(config: dict) -> bool:
    """Есть ли что показать клиенту вообще — хотя бы номер карты."""
    return bool(config["card"] or config["phone"] or has_qr(config))


def payment_string(config: dict, *, amount: float = 0.0, purpose: str = "") -> str:
    """Платёжная строка по ГОСТ Р 56042.

    amount в рублях, в строку уходит в копейках. Ноль или меньше — поле Sum
    не пишем вовсе: клиент введёт сумму сам. Так надо, когда доплачивать
    нечего или когда сумма ещё не определена, — «Sum=0» часть приложений
    показывает как платёж на ноль рублей.
    """
    marker = ENCODINGS[config["encoding"]][0]
    parts = [
        f"ST0001{marker}",
        f"Name={_clean(config['name'])}",
        f"PersonalAcc={config['account']}",
        f"BankName={_clean(config['bank'])}",
        f"BIC={config['bic']}",
        f"CorrespAcc={config['corr_account']}",
    ]
    if config["inn"]:
        parts.append(f"PayeeINN={config['inn']}")
    if config["kpp"]:
        parts.append(f"KPP={config['kpp']}")
    if amount and amount > 0:
        parts.append(f"Sum={round(amount * 100)}")
    if purpose:
        parts.append(f"Purpose={_clean(purpose)}")
    return "|".join(parts)


def _clean(value: str) -> str:
    """Убирает то, что ломает разбор строки.

    `|` — разделитель полей, `=` внутри значения часть приложений принимает
    за начало следующего поля. Переводы строк там тоже неуместны.
    """
    return re.sub(r"\s+", " ", (value or "").replace("|", " ").replace("=", " ")).strip()


def qr_data_uri(payload: str, config: dict, *, scale: int = 8) -> str:
    """QR как data:-ссылка — картинку можно вставить прямо в <img>.

    Рисуем у себя, а не через сторонний сервис «дай картинку по ссылке»:
    во-первых, туда уехали бы сумма и реквизиты, во-вторых, в мастерской
    может не быть интернета, а платить клиент хочет здесь и сейчас.

    SVG, а не PNG: он не мылится, если код растянуть на пол-экрана —
    а его для того и показывают.
    """
    import segno

    charset = ENCODINGS[config["encoding"]][1]
    # error='m' — код читается, даже если четверть закрыта бликом или пальцем
    code = segno.make(payload.encode(charset), error="m")
    return code.svg_data_uri(scale=scale, border=2, dark="#000000", light="#ffffff")
