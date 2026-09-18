"""Несколько почтовых ящиков: кто какой видит, серверы по службе, перенос старой настройки.

Сеть не нужна: проверяется только то, что решает сервер сам — какие ящики
показать человеку, какие серверы подставить для Mail.ru и Яндекса, и что
единственный ящик из прежних «Настроек» переезжает в список без потерь.
"""

from __future__ import annotations

import conftest  # noqa: F401 — добавляет корень проекта в sys.path
import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.api.v1.mail import parse_after
from app.core import crypto
from app.core.database import Base
from app.core.security import CurrentUser
from app.models import Employee, MailAccount, Setting
from app.services import mail, mail_accounts


@pytest.fixture
def db():
    engine = create_engine("sqlite://", future=True)
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine, expire_on_commit=False)()
    try:
        yield session
    finally:
        session.close()


def account(db, user: str, **extra) -> MailAccount:
    row = MailAccount(user=user, password=crypto.encrypt("secret"), provider=mail_accounts.guess_provider(user), **extra)
    db.add(row)
    db.commit()
    return row


def employee(db, name: str, boxes: list[int], perms: list[str] | None = None) -> CurrentUser:
    row = Employee(name=name, permissions=perms or ["mail.access"], mail_accounts=boxes)
    db.add(row)
    db.commit()
    return CurrentUser("employee", name, list(row.permissions), row.id)


# ---------------------------------------------------------------- службы
def test_служба_определяется_по_домену():
    assert mail_accounts.guess_provider("zakaz@yandex.ru") == "yandex"
    assert mail_accounts.guess_provider("print@mail.ru") == "mailru"
    assert mail_accounts.guess_provider("buh@inbox.ru") == "mailru"
    assert mail_accounts.guess_provider("BUH@BK.RU") == "mailru"
    assert mail_accounts.guess_provider("info@poster-print.ru") == "custom"
    assert mail_accounts.guess_provider("") == "custom"


def test_серверы_mailru_подставляются_сами(db):
    cfg = mail_accounts.to_config(account(db, "print@mail.ru"))
    assert (cfg.imap_host, cfg.imap_port) == ("imap.mail.ru", 993)
    assert (cfg.smtp_host, cfg.smtp_port) == ("smtp.mail.ru", 465)
    assert cfg.provider == "mailru" and cfg.configured


def test_свои_серверы_главнее_службы(db):
    cfg = mail_accounts.to_config(account(db, "print@mail.ru", imap="imap.example.ru:1993", smtp="smtp.example.ru"))
    assert (cfg.imap_host, cfg.imap_port) == ("imap.example.ru", 1993)
    assert (cfg.smtp_host, cfg.smtp_port) == ("smtp.example.ru", 465)


def test_пароль_лежит_зашифрованным_а_в_соединение_идёт_открытым(db):
    row = account(db, "zakaz@yandex.ru")
    assert row.password != "secret" and crypto.is_encrypted(row.password)
    assert mail_accounts.to_config(row).password == "secret"
    assert "password" not in mail_accounts.public(row)


def test_подсказка_про_пароль_своя_у_каждой_службы(db):
    assert "внешних приложений" in mail.auth_hint(mail_accounts.to_config(account(db, "a@mail.ru")))
    assert "пароль приложения" in mail.auth_hint(mail_accounts.to_config(account(db, "a@yandex.ru")))


def test_имя_отправителя_берётся_из_названия_мастерской(db):
    cfg = mail_accounts.to_config(account(db, "a@mail.ru"), {"shop_name": "Печатный цех"})
    assert cfg.sender_name == "Печатный цех"
    cfg = mail_accounts.to_config(account(db, "b@mail.ru", sender_name="Бухгалтерия"), {"shop_name": "Печатный цех"})
    assert cfg.sender_name == "Бухгалтерия"


# ---------------------------------------------------------------- кто что видит
def test_сотрудник_видит_только_назначенные_и_в_своём_порядке(db):
    a, b, c = account(db, "a@yandex.ru"), account(db, "b@mail.ru"), account(db, "c@mail.ru")
    user = employee(db, "Аня", [c.id, a.id])
    assert [x.id for x in mail_accounts.visible(db, user)] == [c.id, a.id]
    assert b.id not in [x.id for x in mail_accounts.visible(db, user)]


def test_без_назначения_почты_нет(db):
    account(db, "a@yandex.ru")
    assert mail_accounts.visible(db, employee(db, "Аня", [])) == []
    assert mail_accounts.pick(db, employee(db, "Оля", []), None) is None


def test_чужой_ящик_по_номеру_не_открыть(db):
    a, b = account(db, "a@yandex.ru"), account(db, "b@mail.ru")
    user = employee(db, "Аня", [a.id])
    first, named = mail_accounts.pick(db, user, None), mail_accounts.pick(db, user, a.id)
    assert first is not None and first.id == a.id
    assert named is not None and named.id == a.id
    with pytest.raises(PermissionError):
        mail_accounts.pick(db, user, b.id)


def test_администратор_и_управляющий_видят_все(db):
    a, b, c = account(db, "a@yandex.ru"), account(db, "b@mail.ru"), account(db, "c@mail.ru")
    admin = CurrentUser("admin", "Администратор", ["mail.access", "staff.manage"])
    assert [x.id for x in mail_accounts.visible(db, admin)] == [a.id, b.id, c.id]
    manager = employee(db, "Сергей", [], ["mail.access", "staff.manage"])
    assert len(mail_accounts.visible(db, manager)) == 3


def test_выключенный_ящик_никому_не_виден(db):
    a = account(db, "a@yandex.ru", active=False)
    assert mail_accounts.visible(db, employee(db, "Аня", [a.id])) == []


def test_не_больше_двух_ящиков_на_сотрудника(db):
    ids = [account(db, f"box{i}@mail.ru").id for i in range(3)]
    assert mail_accounts.clean_ids(db, [ids[0], ids[1], ids[0]]) == [ids[0], ids[1]]
    with pytest.raises(ValueError, match="не больше 2"):
        mail_accounts.clean_ids(db, ids)
    with pytest.raises(ValueError, match="нет"):
        mail_accounts.clean_ids(db, [999])


def test_удалённый_ящик_уходит_из_профилей(db):
    a, b = account(db, "a@yandex.ru"), account(db, "b@mail.ru")
    employee(db, "Аня", [a.id, b.id])
    assert mail_accounts.forget(db, a.id) == 1
    db.commit()
    assert db.scalar(select(Employee)).mail_accounts == [b.id]
    assert mail_accounts.users_of(db) == {b.id: ["Аня"]}


# ---------------------------------------------------------------- перенос старой настройки
def test_ящик_из_прежних_настроек_переезжает_в_список(db):
    db.add_all([
        Setting(key="mail_user", value="zakaz@yandex.ru"),
        Setting(key="mail_password", value=crypto.encrypt("app-password")),
        Setting(key="mail_sender", value="Печатный цех"),
    ])
    db.add(Employee(name="Аня", permissions=["mail.access"], mail_accounts=[]))
    db.add(Employee(name="Цех", permissions=["orders.view"], mail_accounts=[]))
    db.commit()

    moved = mail_accounts.migrate_legacy(db)
    assert moved is not None and moved.user == "zakaz@yandex.ru" and moved.provider == "yandex"
    assert mail_accounts.to_config(moved).password == "app-password"
    assert moved.sender_name == "Печатный цех"
    # кто работал с почтой — продолжает, остальным она не появляется
    by_name = {e.name: e.mail_accounts for e in db.scalars(select(Employee)).all()}
    assert by_name == {"Аня": [moved.id], "Цех": []}
    # пароль больше не лежит в настройках
    assert db.scalars(select(Setting).where(Setting.key.like("mail_%"))).all() == []
    # повторный запуск ничего не дублирует
    assert mail_accounts.migrate_legacy(db) is None
    assert len(mail_accounts.all_accounts(db)) == 1


def test_без_старой_настройки_переносить_нечего(db, monkeypatch):
    for name in ("POSTER_MAIL_USER", "POSTER_MAIL_PASSWORD"):
        monkeypatch.delenv(name, raising=False)
    assert mail_accounts.migrate_legacy(db) is None


# ---------------------------------------------------------------- опрос «что нового»
def test_отметки_по_ящикам_разбираются_и_мусор_не_мешает():
    assert parse_after("1:120,2:55") == {1: 120, 2: 55}
    assert parse_after(" 3:7 , x:1, 4:, :9, 5:abc") == {3: 7}
    assert parse_after(None) == {} and parse_after("") == {}


def test_у_каждого_ящика_своё_соединение():
    assert mail.mailbox_for(101) is mail.mailbox_for(101)
    assert mail.mailbox_for(101) is not mail.mailbox_for(102)
    mail.forget_mailbox(101)
    mail.forget_mailbox(102)


def test_отправленные_mailru_находятся_и_без_флага():
    lines = [
        rb'(\Inbox) "/" "INBOX"',
        rb'() "/" "&BB4EQgQ,BEAEMAQyBDsENQQ9BD0ESwQ1-"',
        rb'(\Trash) "/" "&BBoEPgRABDcEOAQ9BDA-"',
    ]
    assert mail.pick_sent(lines) == "&BB4EQgQ,BEAEMAQyBDsENQQ9BD0ESwQ1-"
    flagged = [rb'(\Sent) "/" "&BB4EQgQ,BEAEMAQyBDsENQQ9BD0ESwQ1-"', rb'() "/" "Sent"']
    assert mail.pick_sent(flagged) == "&BB4EQgQ,BEAEMAQyBDsENQQ9BD0ESwQ1-"


def test_после_отказа_в_пароле_минуту_не_стучимся(monkeypatch):
    """Опрос идёт с каждого рабочего места; частые неудачные входы — повод
    для почты заблокировать ящик."""
    import imaplib

    calls = []

    def refuse(*args, **kwargs):
        calls.append(1)
        raise imaplib.IMAP4.error("auth failed")

    monkeypatch.setattr(imaplib, "IMAP4_SSL", refuse)
    box = mail.Mailbox()
    cfg = mail.MailConfig("a@mail.ru", "bad", "imap.mail.ru", 993, "smtp.mail.ru", 465, "Цех", provider="mailru")
    for _ in range(3):
        with pytest.raises(mail.MailError, match="не принял"):
            box.uids(cfg, force=True)
    assert len(calls) == 1
    box.reset()  # кнопка «Проверить» и смена пароля пробуют сразу
    with pytest.raises(mail.MailError):
        box.uids(cfg, force=True)
    assert len(calls) == 2
