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

from app import payments

GOOD = {
    "name": "ООО Ромашка",
    "account": "40702810500000000001",
    "bank": "Сбербанк",
    "bic": "044525225",
    "corr_account": "30101810400000000225",
    "inn": "7712345678",
    "kpp": "771201001",
    "card": "",
    "phone": "",
    "note": "",
    "encoding": "utf8",
}


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


def test_без_qr_но_с_картой_показывать_есть_что():
    """Карта и телефон работают сами по себе — QR им не нужен."""
    only_card = {k: ("utf8" if k == "encoding" else "") for k in GOOD}
    only_card["card"] = "2202 2002 1234 5678"
    assert payments.has_qr(only_card) is False
    assert payments.has_anything(only_card) is True


def test_совсем_пустая_настройка_ничего_не_обещает():
    empty = {k: ("utf8" if k == "encoding" else "") for k in GOOD}
    assert payments.has_anything(empty) is False


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
