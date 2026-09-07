"""Почта: разбор писем и настроек — то, что проверяется без ящика.

Само соединение с IMAP/SMTP здесь не трогаем: для этого в «Настройках»
есть кнопка «Проверить соединение».
"""

from __future__ import annotations

from email.message import EmailMessage

import conftest  # noqa: F401 — добавляет корень проекта в sys.path

from app import mail
from app.permissions import PERMISSIONS_BY_KEY, default_permissions, normalize


def test_право_на_почту_включено_по_умолчанию():
    assert "mail.access" in PERMISSIONS_BY_KEY
    assert "mail.access" in default_permissions()
    assert "mail.access" in normalize(["mail.access"])


def test_серверы_по_умолчанию_яндекс():
    cfg = mail.config({"mail_user": "zakaz@yandex.ru", "mail_password": "x"})
    assert (cfg.imap_host, cfg.imap_port) == ("imap.yandex.ru", 993)
    assert (cfg.smtp_host, cfg.smtp_port) == ("smtp.yandex.ru", 465)
    assert cfg.configured


def test_без_пароля_почта_не_настроена():
    cfg = mail.config({"mail_user": "zakaz@yandex.ru", "mail_password": ""})
    assert not cfg.configured


def test_сервер_с_портом_и_без():
    assert mail._host_port("imap.mail.ru:993", mail.DEFAULT_IMAP) == ("imap.mail.ru", 993)
    assert mail._host_port("imap.mail.ru", mail.DEFAULT_IMAP) == ("imap.mail.ru", 993)
    assert mail._host_port("", mail.DEFAULT_IMAP) == ("imap.yandex.ru", 993)


def test_тема_в_чужой_кодировке_читается():
    assert mail.decode("=?UTF-8?B?0JzQsNC60LXRgg==?=") == "Макет"
    assert mail.decode(None) == ""


def test_html_становится_текстом_без_скриптов():
    html = "<html><head><style>p{}</style></head><body><p>Здравствуйте,</p><p>макет <b>во вложении</b>.</p><script>alert(1)</script></body></html>"
    text = mail.html_to_text(html)
    assert "Здравствуйте," in text and "во вложении" in text
    assert "alert" not in text and "<" not in text
    assert text.count("\n\n") <= 2


def _letter(plain: str | None, html: str | None, attach: bool) -> EmailMessage:
    msg = EmailMessage()
    msg["From"] = "Клиент <client@example.com>"
    msg["Subject"] = "Баннер"
    if plain is not None:
        msg.set_content(plain)
    if html is not None:
        if plain is not None:
            msg.add_alternative(html, subtype="html")
        else:
            msg.set_content(html, subtype="html")
    if attach:
        msg.add_attachment(b"%PDF", maintype="application", subtype="pdf", filename="макет.pdf")
    return msg


def test_текст_письма_предпочитает_plain():
    text, was_html = mail.body_text(_letter("Привет", "<p>Привет из HTML</p>", False))
    assert text == "Привет" and not was_html


def test_письмо_только_html_показывается_текстом():
    text, was_html = mail.body_text(_letter(None, "<p>Только HTML</p>", False))
    assert text == "Только HTML" and was_html


def test_вложения_перечисляются_с_размером():
    msg = _letter("текст", None, True)
    atts = mail.attachments_of(msg)
    assert len(atts) == 1
    assert atts[0]["filename"] == "макет.pdf"
    assert atts[0]["content_type"] == "application/pdf"
    assert atts[0]["size"] == 4
    part = mail.attachment_part(msg, atts[0]["index"])
    assert part is not None and part.get_payload(decode=True) == b"%PDF"


def test_разбор_ответа_fetch():
    data = [
        (b"1 (UID 501 FLAGS (\\Seen) BODY[HEADER] {20}", b"Subject: x\r\n\r\n"),
        b")",
        (b"2 (UID 502 FLAGS () BODY[HEADER] {20}", b"Subject: y\r\n\r\n"),
        b")",
    ]
    parsed = mail._parse_fetch(data)
    assert set(parsed) == {501, 502}
    assert mail._flags(parsed[501][0]) == {"\\Seen"}
    assert mail._flags(parsed[502][0]) == set()


def test_html_вычищается_но_оформление_и_картинки_остаются():
    raw = (
        "<html><head><script>alert(1)</script><style>p{color:red;background:url(x)}</style></head>"
        "<body onload=\"evil()\"><p style=\"color:blue;expression(x)\">Привет</p>"
        "<img src=\"https://cdn.example.com/a.png\" onerror=\"evil()\">"
        "<img src=\"http://plain.example.com/b.png\">"
        "<img src=\"cid:logo@mail\">"
        "<a href=\"javascript:evil()\">плохая</a><a href=\"https://example.com\">хорошая</a>"
        "<iframe src=\"https://evil\"></iframe><form><input></form></body></html>"
    )
    out = mail.sanitize_html(raw, {"logo@mail": "data:image/png;base64,AAAA"})
    assert "alert" not in out and "evil" not in out and "<iframe" not in out and "<form" not in out
    assert "expression" not in out and "url(" not in out
    assert "color:red" in out and "color:blue" in out
    assert 'src="https://cdn.example.com/a.png"' in out
    assert "plain.example.com" not in out  # http-картинку выбросили
    assert 'src="data:image/png;base64,AAAA"' in out  # cid подставился
    assert 'href="https://example.com"' in out and "target=\"_blank\"" in out
    assert "javascript:" not in out
    assert out.startswith("<!doctype html>")


def test_вшитая_картинка_становится_data_строкой():
    msg = EmailMessage()
    msg["From"] = "a@b.c"
    msg.set_content("текст")
    msg.add_alternative('<p>лого: <img src="cid:pic1"></p>', subtype="html")
    msg.get_payload()[1].add_related(b"\x89PNG", maintype="image", subtype="png", cid="<pic1>")
    images = mail.inline_images(msg)
    assert "pic1" in images and images["pic1"].startswith("data:image/png;base64,")
    html = mail.html_body(msg)
    assert "data:image/png;base64," in html


def test_текстовое_письмо_без_html():
    msg = EmailMessage()
    msg.set_content("только текст")
    assert mail.html_body(msg) == ""


def test_папка_отправленных_по_флагу_sent():
    lines = [
        b'(\\HasNoChildren) "|" "INBOX"',
        b'(\\HasNoChildren \\Sent) "|" "Sent"',
        b'(\\HasNoChildren \\Trash) "|" "Trash"',
    ]
    assert mail.pick_sent(lines) == "Sent"


def test_папка_отправленных_по_имени_если_флага_нет():
    lines = [b'(\\HasNoChildren) "/" INBOX', b'(\\HasNoChildren) "/" "Sent Items"']
    assert mail.pick_sent(lines) == "Sent Items"
    assert mail.pick_sent([b'(\\HasNoChildren) "/" INBOX']) is None


def test_первый_message_id_из_заголовка():
    assert mail.first_message_id("<a@x> <b@y>") == "<a@x>"
    assert mail.first_message_id(" <only@z>\r\n") == "<only@z>"
    assert mail.first_message_id("") == "" and mail.first_message_id(None) == ""


def test_имя_папки_в_кавычках_для_imap():
    assert mail._quote_folder("INBOX") == "INBOX"
    assert mail._quote_folder("Sent Items") == '"Sent Items"'
    assert mail._quote_folder('"Sent"') == '"Sent"'

