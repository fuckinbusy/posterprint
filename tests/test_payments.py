"""Платёжная строка по ГОСТ Р 56042 — app/payments.py.

Строку читает не человек, а банковское приложение: оно либо разберёт её
молча и правильно, либо скажет «неверный QR» уже при клиенте. Проверять
глазами тут нечего, поэтому проверяем составом.

Самое дорогое место — копейки. `Sum` в стандарте целое число копеек, и
ошибка на два порядка означает, что клиент заплатит 28 рублей вместо 2800
или наоборот.

Отдельно, руками, проверялось главное: что нарисованный код ЧИТАЕТСЯ и байты
в нём те самые. Сканер в набор тестов не тащим — ради одной проверки это
40 МБ opencv в зависимостях. Повторить при желании так:

    pip install opencv-python-headless numpy
    # segno.make(payload.encode(charset)).save(buf, kind='png')
    # cv2.QRCodeDetector().detectAndDecodeBytes(img)

13.08.2026 обе кодировки прошли: в utf8 расшифрованная строка совпала с
исходной байт в байт, в win1251 — тоже (opencv показывает такие байты как
latin-1, это особенность самого сканера, а не кода).

Чего эти тесты НЕ проверяют: примет ли строку конкретный банк. Это решается
только живым приложением — см. TODO 3.2.
"""

from __future__ import annotations

import conftest  # noqa: F401 — добавляет корень проекта в sys.path
import pytest

from app.services import payments

"""Реквизиты, у которых контрольный ключ реально сходится с БИК.

Корсчёт и БИК — настоящие, сбербанковские; расчётный счёт выдуман, но его
девятая цифра подобрана так, чтобы ключ сошёлся. Иначе проверка из 579-П
завернула бы собственные тестовые данные.
"""
GOOD = {
    "name": "ООО Ромашка",
    "account": "40702810200000000001",
    "bank": "Сбербанк",
    "bic": "044525225",
    "corr_account": "30101810400000000225",
    "inn": "7712345678",
    "kpp": "771201001",
    "card": "",
    "phone": "",
    "note": "",
    "encoding": "utf8",
    "link": "",
    "mode": "gost",
}

LINK = {**GOOD, "mode": "link", "link": "https://www.tbank.ru/rm/abcdef"}


def fields(payload: str) -> dict[str, str]:
    """Строку — в словарь, кроме заголовка."""
    head, *rest = payload.split("|")
    assert head.startswith("ST0001")
    return dict(part.split("=", 1) for part in rest)


# ------------------------------------------------------------------ состав
def test_обязательные_поля_на_месте():
    data = fields(payments.payment_string(GOOD, amount=100))
    for key in ("Name", "PersonalAcc", "BankName", "BIC", "CorrespAcc"):
        assert data.get(key), f"нет обязательного поля {key}"


def test_заголовок_говорит_о_кодировке():
    assert payments.payment_string(GOOD).startswith("ST00012")            # utf-8
    assert payments.payment_string({**GOOD, "encoding": "win1251"}).startswith("ST00011")


def test_сумма_в_копейках():
    assert fields(payments.payment_string(GOOD, amount=2800))["Sum"] == "280000"
    assert fields(payments.payment_string(GOOD, amount=1))["Sum"] == "100"
    # рубли с копейками не должны дать дробное число копеек
    assert fields(payments.payment_string(GOOD, amount=1234.56))["Sum"] == "123456"
    assert fields(payments.payment_string(GOOD, amount=0.1))["Sum"] == "10"


def test_без_суммы_поле_не_пишется():
    """Ноль — это «сумму введёт клиент», а не «платёж на ноль рублей»."""
    assert "Sum" not in fields(payments.payment_string(GOOD, amount=0))
    assert "Sum" not in fields(payments.payment_string(GOOD))
    assert "Sum" not in fields(payments.payment_string(GOOD, amount=-5))


def test_назначение_платежа_попадает_в_строку():
    data = fields(payments.payment_string(GOOD, amount=10, purpose="Оплата заказа ЗК-2026-000042"))
    assert data["Purpose"] == "Оплата заказа ЗК-2026-000042"


def test_необязательные_поля_не_пишутся_пустыми():
    """Пустой `PayeeINN=` некоторые приложения считают ошибкой разбора."""
    data = fields(payments.payment_string({**GOOD, "inn": "", "kpp": ""}, amount=10))
    assert "PayeeINN" not in data
    assert "KPP" not in data


def test_разделитель_и_равно_вычищаются_из_значений():
    """Иначе название получателя разорвёт строку на лишние поля."""
    dirty = {**GOOD, "name": "ООО | Ромашка = лучшая\nв городе"}
    data = fields(payments.payment_string(dirty, amount=10))
    assert data["Name"] == "ООО Ромашка лучшая в городе"
    # число полей не изменилось от мусора в значении
    assert len(data) == len(fields(payments.payment_string(GOOD, amount=10)))


# ------------------------------------------------------------------ проверка настройки
def test_у_правильных_реквизитов_претензий_нет():
    assert payments.problems(GOOD) == []
    assert payments.has_qr(GOOD) is True


@pytest.mark.parametrize(
    "field, value",
    [
        ("name", ""),
        ("account", "12345"),                 # не 20 цифр
        ("bank", ""),
        ("bic", "0445252"),                   # не 9 цифр
        ("corr_account", ""),
        ("inn", "12345"),                     # не 10 и не 12
        ("kpp", "77120100"),                  # не 9
        ("encoding", "koi8"),                 # не поддерживаем
    ],
)
def test_кривой_реквизит_ловится_до_показа_клиенту(field, value):
    assert payments.problems({**GOOD, field: value}), f"{field}={value} прошло проверку"


def empty_config(**over) -> dict:
    base = dict.fromkeys(GOOD, "")
    base.update(encoding="utf8", mode="gost")
    base.update(over)
    return base


def test_без_qr_но_с_картой_показывать_есть_что():
    """Карта и телефон работают сами по себе — QR им не нужен."""
    only_card = empty_config(card="2202 2002 1234 5678")
    assert payments.has_qr(only_card) is False
    assert payments.has_anything(only_card) is True


def test_совсем_пустая_настройка_ничего_не_обещает():
    assert payments.has_anything(empty_config()) is False


# ------------------------------------------------------------------ ключ счёта
def test_контрольный_ключ_сходится_у_настоящих_реквизитов():
    """Проверено на трёх банках: ключ считается из БИК, и это ловит опечатку."""
    assert payments.account_key_ok("30101810400000000225", "044525225")  # Сбербанк
    assert payments.account_key_ok("30101810700000000187", "044525187")  # ВТБ
    assert payments.account_key_ok("30101810200000000593", "044525593")  # Альфа


def test_корсчёт_чужого_банка_ловится_по_последним_цифрам():
    """Ключ корсчёта считается от 5-6 цифр БИК и подмены банка внутри
    региона не замечает: у Сбербанка и ВТБ они одинаковые. Ловит другое
    правило — последние три цифры корсчёта повторяют последние три БИК."""
    сбер_корсчёт, втб_бик = "30101810400000000225", "044525187"
    assert payments.account_key_ok(сбер_корсчёт, втб_бик) is True   # ключ молчит
    found = payments.problems({**GOOD, "corr_account": сбер_корсчёт, "bic": втб_бик})
    assert any("от разных банков" in p for p in found)


def test_опечатка_в_счёте_ловится():
    good = GOOD["account"]
    broken = good[:5] + str((int(good[5]) + 1) % 10) + good[6:]
    assert payments.account_key_ok(good, GOOD["bic"]) is True
    assert payments.account_key_ok(broken, GOOD["bic"]) is False


def test_несходящийся_счёт_попадает_в_проблемы():
    bad = {**GOOD, "account": "40702810500000000001"}   # ключ не тот
    found = " ".join(payments.problems(bad))
    assert "не сходится с БИК" in found
    assert payments.has_qr(bad) is False


def test_про_ключ_не_говорим_пока_бик_не_заполнен():
    """Иначе к «БИК не из 9 цифр» приедет ещё и «ключ не сошёлся»."""
    found = payments.problems({**GOOD, "bic": "0445"})
    assert any("БИК" in p and "9 цифр" in p for p in found)
    assert not any("не сходится" in p for p in found)


# ------------------------------------------------------------------ счёт физлица
def test_счёт_физлица_не_ошибка_но_о_нём_предупреждаем():
    """Из-за него банк отвечает «недопустимый номер счёта» — а понять это
    по ответу банка невозможно."""
    account = "40817810" + "0" * 12
    # подбираем верный ключ, чтобы претензия осталась ровно одна — по 40817
    for digit in "0123456789":
        candidate = account[:8] + digit + account[9:]
        if payments.account_key_ok(candidate, GOOD["bic"]):
            account = candidate
            break

    config = {**GOOD, "account": account}
    assert payments.problems(config) == []          # формально всё верно
    assert any("40817" in h for h in payments.hints(config))
    assert any("POSTER_PAY_LINK" in h for h in payments.hints(config))


# ------------------------------------------------------------------ режим ссылки
def test_ссылка_уходит_в_qr_как_есть():
    assert payments.payload(LINK, amount=700) == "https://www.tbank.ru/rm/abcdef"


def test_сумма_подставляется_в_место_для_неё():
    config = {**LINK, "link": "https://www.tbank.ru/rm/abcdef?amount={amount}"}
    assert payments.payload(config, amount=700).endswith("?amount=700")
    # дробные рубли сохраняются, лишние нули — нет
    assert payments.payload(config, amount=350.5).endswith("?amount=350.5")
    assert payments.payload(config, amount=700.00).endswith("?amount=700")


def test_без_суммы_параметр_из_ссылки_убирается():
    """«?amount=» пустым некоторые банки принимают за ноль."""
    config = {**LINK, "link": "https://www.tbank.ru/rm/abcdef?amount={amount}"}
    assert payments.payload(config, amount=0) == "https://www.tbank.ru/rm/abcdef"


SBER = (
    "https://www.sberbank.ru/ru/choise_bank"
    "?requisiteNumber={phone}&bankCode=100000000111"
)


def test_номер_подставляется_в_том_виде_как_ждёт_банк():
    """Сбербанк ждёт 79881603218 — без плюса, скобок и восьмёрки."""
    expected = (
        "https://www.sberbank.ru/ru/choise_bank"
        "?requisiteNumber=79881603218&bankCode=100000000111"
    )
    for written in ("+7 (988) 160-32-18", "89881603218", "79881603218", "9881603218"):
        assert payments.fill_link(SBER, phone=written) == expected, written


def test_номер_с_плюсом_если_банк_просит_его():
    """Отдельного места под +7 не нужно: плюс пишется в самой ссылке."""
    link = payments.fill_link("https://bank/pay?to=+{phone}", phone="8 988 160-32-18")
    assert link == "https://bank/pay?to=+79881603218"


def test_ссылка_с_номером_и_суммой_разом():
    config = {**LINK, "link": SBER + "&amount={amount}", "phone": "+7 (988) 160-32-18"}
    assert payments.payload(config, amount=700) == (
        "https://www.sberbank.ru/ru/choise_bank"
        "?requisiteNumber=79881603218&bankCode=100000000111&amount=700"
    )


def test_место_для_номера_без_самого_номера_это_ошибка():
    """Иначе клиент уедет на страницу банка с пустым номером."""
    assert payments.problems({**LINK, "link": SBER, "phone": ""})
    assert payments.problems({**LINK, "link": SBER, "phone": "123"})
    assert payments.problems({**LINK, "link": SBER, "phone": "+7 988 160-32-18"}) == []


def test_ссылке_нужен_протокол():
    assert payments.problems({**LINK, "link": "tbank.ru/rm/abcdef"})
    assert payments.problems({**LINK, "link": ""})
    assert payments.problems(LINK) == []


def test_режим_выбирается_сам_если_не_задан(monkeypatch):
    """Вставил ссылку — заработало, читать про режимы не пришлось."""
    for name in ("POSTER_PAY_MODE", "POSTER_PAY_LINK"):
        monkeypatch.delenv(name, raising=False)
    assert payments.settings()["mode"] == "gost"

    monkeypatch.setenv("POSTER_PAY_LINK", "https://www.tbank.ru/rm/abcdef")
    assert payments.settings()["mode"] == "link"

    monkeypatch.setenv("POSTER_PAY_MODE", "gost")
    assert payments.settings()["mode"] == "gost"


def test_в_режиме_ссылки_реквизиты_счёта_не_требуются():
    """Ссылку выдал банк — проверять в ней нечего, кроме протокола."""
    only_link = empty_config(mode="link", link="https://qr.nspk.ru/AS100012")
    assert payments.problems(only_link) == []
    assert payments.has_qr(only_link) is True


def test_если_в_ссылке_нет_места_для_суммы_об_этом_говорим():
    assert any("сумм" in h for h in payments.hints(LINK))
    with_slot = {**LINK, "link": "https://www.tbank.ru/rm/abcdef?amount={amount}"}
    assert payments.hints(with_slot) == []


# ------------------------------------------------------------------ сам QR
def test_qr_рисуется_у_себя_и_без_интернета():
    """Картинка приходит data:-ссылкой — никаких сторонних сервисов.

    Через чужой сервис «нарисуй QR по ссылке» уехали бы сумма и реквизиты,
    а в мастерской ещё и интернета может не быть.
    """
    payload = payments.payment_string(GOOD, amount=2800, purpose="Оплата заказа ЗК-2026-000001")
    uri = payments.qr_data_uri(payload, GOOD)
    assert uri.startswith("data:image/svg+xml")
    assert len(uri) > 500


def test_qr_рисуется_в_обеих_кодировках():
    for encoding in ("utf8", "win1251"):
        config = {**GOOD, "encoding": encoding}
        payload = payments.payment_string(config, amount=100, purpose="Оплата заказа")
        assert payments.qr_data_uri(payload, config).startswith("data:image/svg+xml")
