"""Платёжные реквизиты и QR-код для оплаты заказа.

Что показывает клиенту сотрудник, когда тот спрашивает «куда платить».

Два способа — выбирается настройкой POSTER_PAY_MODE.

1. «gost» — платёжная строка по ГОСТ Р 56042-2014
------------------------------------------------
    ST00012|Name=ООО Ромашка|PersonalAcc=40702810…|BankName=Сбербанк|
    BIC=044525225|CorrespAcc=30101810…|Sum=280000|Purpose=Оплата заказа …

* `ST0001` — идентификатор формата, дальше цифра кодировки:
  1 — windows-1251, 2 — UTF-8, 3 — KOI8-R. Пишем UTF-8 (`ST00012`), но
  кодировку можно переключить: банки-приёмники встречаются разные.
* Разделитель полей — `|`. Первые пять полей обязательны по стандарту.
* **`Sum` — в копейках**, целым числом. 2800 ₽ → `Sum=280000`. Ошибка тут
  дороже всех прочих: клиент оплатит в сто раз больше или меньше.

Это платёж **по банковским реквизитам**. Он рассчитан на счёт организации
(407…). Счёт физлица (408 17…) формально тоже счёт, но часть банковских
приложений в этом сценарии его отклоняет — «недопустимый номер счёта».
Для перевода человеку есть второй способ.

2. «link» — ссылка на перевод, которую выдал банк
-------------------------------------------------
В QR кладётся ссылка (POSTER_PAY_LINK), клиент наводит камеру и попадает
прямо в перевод: «Перевести мне по ссылке» у Т-Банка, ссылка или наклейка
СБП, «Мой QR» — у каждого банка называется по-своему.

**Настоящий QR СБП может выпустить только банк.** Это не картинка, которую
можно нарисовать по номеру телефона: за ней стоит зарегистрированный в НСПК
адрес вида `https://qr.nspk.ru/…`, привязанный к счёту получателя. Мы такие
не выдумываем — только показываем то, что банк уже выдал владельцу.

Сумму в ссылку подставляем, если в ней есть место — `{amount}`. Нет места —
показываем сумму рядом крупно, клиент введёт её сам.

Проверка реквизитов
-------------------
Реквизиты живут в .env: их заводят один раз, и заводит их владелец, а не
программист. Проверяем формально — длину счёта, БИК, ИНН **и контрольный
ключ счёта** (Положение ЦБ 579-П): он считается из БИК, и перепутанные
между собой счёт и банк ловятся сразу. Иначе неверный реквизит превратится
в QR, который банк отвергнет уже при клиенте, — а разбираться в этом
у стойки некому.
"""

from __future__ import annotations

import os
import re

# кодировка платёжной строки: цифра в конце ST0001x и как её зовут в Python
ENCODINGS = {"utf8": ("2", "utf-8"), "win1251": ("1", "cp1251")}

# способ оплаты: платёж по реквизитам или ссылка из банка
MODES = ("gost", "link")

# Места, которые подставляются в ссылку.
#
#   {amount} — сумма заказа в рублях: …/pay?amount={amount}
#   {phone}  — номер получателя из POSTER_PAY_PHONE, в виде 79881603218.
#              Именно так его ждут банки: у Сбербанка это
#              …/choise_bank?requisiteNumber={phone}&bankCode=100000000111
#              Нужен вид +7988… — пишите в ссылке «+{phone}».
AMOUNT_SLOT = "{amount}"
PHONE_SLOT = "{phone}"

# Веса разрядов для контрольного ключа счёта (579-П, приложение 9).
# Считается по 23 цифрам: три цифры из БИК плюс сам счёт.
KEY_WEIGHTS = [7, 1, 3] * 8


def _env(name: str) -> str:
    return (os.getenv(name) or "").strip()


def _digits(value: str) -> str:
    return re.sub(r"\D", "", value or "")


def account_key_ok(account: str, bic: str) -> bool:
    """Сходится ли контрольный ключ счёта с БИК (Положение ЦБ 579-П).

    Девятая цифра счёта — контрольная, и считается она из БИК банка. Поэтому
    счёт одного банка с БИК другого не сойдётся, как и опечатка в любой цифре.
    Именно это банк и отвечает «недопустимый номер счёта», а по такому ответу
    у стойки не понять, где искать ошибку.

    Корсчёт банка (301…) считается от 5-6 цифр БИК, счета клиентов — от
    последних трёх.
    """
    if len(account) != 20 or len(bic) != 9:
        return False
    prefix = "0" + bic[4:6] if account.startswith("301") else bic[6:9]
    digits = prefix + account
    # весов 24, цифр 23 — последний вес не нужен, обрезка намеренная
    return sum(int(d) * w for d, w in zip(digits, KEY_WEIGHTS, strict=False)) % 10 == 0


def settings(overrides: dict[str, str] | None = None) -> dict:
    """Реквизиты. Значение из базы (страница «Настройки») главнее .env;
    ключа в базе нет — берётся .env. Пусто — значит, оплату показывать нечем."""
    from app.services.settings import pick

    def get(key: str, env_name: str) -> str:
        return pick(overrides, key, _env(env_name))

    return {
        # для QR по ГОСТ (все пять обязательны)
        "name": get("pay_name", "POSTER_PAY_NAME"),
        "account": _digits(get("pay_account", "POSTER_PAY_ACCOUNT")),
        "bank": get("pay_bank", "POSTER_PAY_BANK"),
        "bic": _digits(get("pay_bic", "POSTER_PAY_BIC")),
        "corr_account": _digits(get("pay_corr_account", "POSTER_PAY_CORR_ACCOUNT")),
        # дополнительные — банки часто просят ИНН
        "inn": _digits(get("pay_inn", "POSTER_PAY_INN")),
        "kpp": _digits(get("pay_kpp", "POSTER_PAY_KPP")),
        # то, что просто показываем на экране, без QR
        "card": get("pay_card", "POSTER_PAY_CARD"),
        "phone": get("pay_phone", "POSTER_PAY_PHONE"),
        "note": get("pay_note", "POSTER_PAY_NOTE"),
        "encoding": get("pay_encoding", "POSTER_PAY_ENCODING").lower() or "utf8",
        # ссылка на перевод, выданная банком
        "link": get("pay_link", "POSTER_PAY_LINK"),
        "mode": _mode(
            get("pay_mode", "POSTER_PAY_MODE").lower(),
            get("pay_link", "POSTER_PAY_LINK"),
        ),
    }


def _mode(chosen: str = "", link: str = "") -> str:
    """Какой QR показываем.

    Пусто — решаем сами: есть ссылка, значит её и показываем. Так проще
    всего: владелец вставил ссылку из банка — всё заработало, читать про
    режимы не пришлось.
    """
    if chosen in MODES:
        return chosen
    return "link" if link else "gost"


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


def _link_problems(config: dict) -> list[str]:
    """Режим ссылки: проверять почти нечего, ссылку выдал банк."""
    link = config["link"]
    if not link:
        found = ["не указана ссылка на перевод (POSTER_PAY_LINK)"]
        return found
    if not re.match(r"^https?://", link):
        return ["ссылка должна начинаться с http:// или https:// (POSTER_PAY_LINK)"]

    # В ссылке стоит {phone}, а подставлять нечего — клиент уедет на страницу
    # банка с пустым номером и переводить будет некому.
    if PHONE_SLOT in link:
        from app.services.phones import normalize_phone

        digits = normalize_phone(config["phone"])
        if not digits:
            return [
                "в ссылке есть {phone}, но номер не указан — заполните POSTER_PAY_PHONE"
            ]
        if len(digits) != 11:
            return [
                f"номер получателя не похож на телефон ({len(digits)} цифр вместо 11) — "
                "проверьте POSTER_PAY_PHONE"
            ]
    return []


def _gost_problems(config: dict) -> list[str]:
    """Режим платежа по реквизитам: тут ошибиться легко и дорого.

    Проверяем длину, цифры и контрольный ключ. Правильность самого счёта
    отсюда не видна, но опечатка ловится банком уже при клиенте — а это
    худшее место, чтобы узнать о проблеме.
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

    # ключ считается из БИК — сверяем только когда обе цифры на месте,
    # иначе поверх «БИК не из 9 цифр» приедет ещё и «ключ не сошёлся»
    if len(config["bic"]) == 9:
        if len(config["account"]) == 20 and not account_key_ok(config["account"], config["bic"]):
            found.append(
                "расчётный счёт не сходится с БИК — проверьте, что оба из одного банка "
                "и в них нет опечатки (POSTER_PAY_ACCOUNT / POSTER_PAY_BIC)"
            )
        if len(config["corr_account"]) == 20:
            if not account_key_ok(config["corr_account"], config["bic"]):
                found.append(
                    "корр. счёт не сходится с БИК — он у банка свой, посмотрите его "
                    "в реквизитах (POSTER_PAY_CORR_ACCOUNT)"
                )
            elif config["corr_account"][-3:] != config["bic"][-3:]:
                # Контрольный ключ корсчёта считается от 5-6 цифр БИК и потому
                # не замечает подмены банка внутри одного региона. А вот это
                # замечает: последние три цифры корсчёта всегда повторяют
                # последние три цифры БИК.
                found.append(
                    "корр. счёт и БИК от разных банков — последние три цифры у них "
                    "должны совпадать (POSTER_PAY_CORR_ACCOUNT / POSTER_PAY_BIC)"
                )
    return found


def hints(config: dict) -> list[str]:
    """Не ошибки, но то, о чём стоит знать заранее.

    Отдельно от problems: из-за этого QR не перестаёт работать, а вот
    объяснить, почему банк клиента вдруг заупрямился, помогает.
    """
    found: list[str] = []
    if config["mode"] == "gost" and config["account"].startswith("40817"):
        found.append(
            "счёт 40817 — это счёт физлица. Платёж по реквизитам на него часть "
            "банков не принимает и отвечает «недопустимый номер счёта». Если так — "
            "возьмите в своём банке ссылку на перевод и укажите её в POSTER_PAY_LINK."
        )
    if config["mode"] == "link" and AMOUNT_SLOT not in config["link"]:
        found.append(
            "в ссылке нет места для суммы — клиент введёт её сам. Если банк умеет "
            f"принимать сумму в адресе, впишите в неё {AMOUNT_SLOT}: "
            f"https://…/pay?amount={AMOUNT_SLOT}"
        )
    return found


def problems(config: dict) -> list[str]:
    """Что не так с реквизитами. Пустой список — можно делать QR."""
    found = _link_problems(config) if config["mode"] == "link" else _gost_problems(config)
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
    """Хватает ли настроек, чтобы нарисовать код."""
    return not problems(config)


def payload(config: dict, *, amount: float = 0.0, purpose: str = "") -> str:
    """Что кладём в QR — в зависимости от режима.

    В режиме ссылки это сама ссылка (с подставленной суммой, если ей нашлось
    место), в режиме реквизитов — платёжная строка по ГОСТ.
    """
    if config["mode"] == "link":
        return fill_link(config["link"], amount=amount, phone=config["phone"])
    return payment_string(config, amount=amount, purpose=purpose)


def fill_link(link: str, *, amount: float = 0.0, phone: str = "") -> str:
    """Подставляет в ссылку сумму и номер получателя.

    Номер приводим к тому виду, в каком его ждут банки, — 79881603218. Это
    то же правило, по которому система узнаёт клиента по телефону
    (app/services/phones.py), так что «+7 988 160-32-18» из настроек и номер в ссылке
    всегда совпадут, как бы его ни записали.

    Сумму пишем в рублях, а не в копейках: в адресах она человеческая. Целое
    число оставляем целым — «700», а не «700.0»: некоторые банки на дробной
    части спотыкаются.
    """
    from app.services.phones import normalize_phone

    filled = link.replace(PHONE_SLOT, normalize_phone(phone))

    if AMOUNT_SLOT not in filled:
        return filled
    if not amount or amount <= 0:
        # пустое «?amount=» часть банков принимает за ноль — убираем целиком
        return re.sub(r"[?&][^?&=]+=\{amount\}", "", filled).replace(AMOUNT_SLOT, "")
    shown = f"{amount:.2f}".rstrip("0").rstrip(".")
    return filled.replace(AMOUNT_SLOT, shown)


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


def qr_data_uri(content: str, config: dict, *, scale: int = 8) -> str:
    """QR как data:-ссылка — картинку можно вставить прямо в <img>.

    Рисуем у себя, а не через сторонний сервис «дай картинку по ссылке»:
    во-первых, туда уехали бы сумма и реквизиты, во-вторых, в мастерской
    может не быть интернета, а платить клиент хочет здесь и сейчас.

    SVG, а не PNG: он не мылится, если код растянуть на пол-экрана —
    а его для того и показывают.
    """
    import segno

    if config["mode"] == "link":
        # ссылка — латиница и цифры; пусть segno сам выберет режим,
        # так код получается мельче и читается быстрее
        code = segno.make(content, error="m")
    else:
        charset = ENCODINGS[config["encoding"]][1]
        # error='m' — код читается, даже если четверть закрыта бликом или пальцем
        code = segno.make(content.encode(charset), error="m")
    return code.svg_data_uri(scale=scale, border=2, dark="#000000", light="#ffffff")
