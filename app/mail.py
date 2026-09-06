"""Почта мастерской: чтение по IMAP, ответы по SMTP. По умолчанию — Яндекс.

Зачем. Клиенты присылают макеты и уточнения письмом, и приёмка держит
открытой вторую вкладку с почтой. Здесь письма читаются прямо из системы,
о новых всплывает уведомление, ответить можно не уходя с доски.

Ящик один — рабочий, общий. Пароль приложения хранится на сервере
(настройки или .env); личные ящики сюда не подключают.

Как устроено, чтобы не тормозило:
* одно IMAP-соединение на процесс, под замком (imaplib не потокобезопасен);
  оборвалось — переподключаемся и повторяем команду один раз;
* список UID (UID SEARCH ALL) кэшируется на 20 с — это один вызов на всех;
* заголовки письма (от кого, тема, дата) неизменны — кэшируются навсегда,
  свежими каждый раз берутся только флаги (прочитано/нет);
* страница списка — 30 писем, вокруг заданного UID: «старше такого-то» или
  «новее такого-то», чтобы интерфейс подгружал частями при прокрутке;
* тело письма грузится только по открытии, вложения — только по нажатию.
"""

from __future__ import annotations

import email
import imaplib
import logging
import os
import re
import smtplib
import threading
import time
from dataclasses import dataclass
from email import policy
from email.header import decode_header, make_header
from email.message import EmailMessage, Message
from email.utils import formataddr, formatdate, getaddresses, make_msgid, parseaddr, parsedate_to_datetime
from html.parser import HTMLParser

from app import settings as settings_logic

log = logging.getLogger("poster")

PAGE_SIZE = 30
MAX_PAGE = 100
UIDS_TTL = 20          # секунд живёт список UID
FRESH_TTL = 20         # секунд живёт ответ «что нового»
TIMEOUT = 20           # секунд на сетевую операцию

DEFAULT_IMAP = "imap.yandex.ru:993"
DEFAULT_SMTP = "smtp.yandex.ru:465"


class MailError(Exception):
    """Понятная человеку причина: не настроено, не пускает, оборвалось."""


# ---------------------------------------------------------------- настройки
@dataclass(frozen=True)
class MailConfig:
    user: str
    password: str
    imap_host: str
    imap_port: int
    smtp_host: str
    smtp_port: int
    sender_name: str

    @property
    def configured(self) -> bool:
        return bool(self.user and self.password)


def _host_port(value: str, default: str) -> tuple[str, int]:
    raw = (value or default).strip() or default
    host, _, port = raw.partition(":")
    try:
        return host.strip(), int(port or default.split(":")[1])
    except ValueError:
        return host.strip(), int(default.split(":")[1])


def config(overrides: dict[str, str] | None = None) -> MailConfig:
    """Настройки ящика: значение из базы главнее .env (как у реквизитов)."""
    pick = lambda key, env: settings_logic.pick(overrides, key, (os.getenv(env) or "").strip())  # noqa: E731
    imap_host, imap_port = _host_port(pick("mail_imap", "POSTER_MAIL_IMAP"), DEFAULT_IMAP)
    smtp_host, smtp_port = _host_port(pick("mail_smtp", "POSTER_MAIL_SMTP"), DEFAULT_SMTP)
    return MailConfig(
        user=pick("mail_user", "POSTER_MAIL_USER"),
        password=pick("mail_password", "POSTER_MAIL_PASSWORD"),
        imap_host=imap_host,
        imap_port=imap_port,
        smtp_host=smtp_host,
        smtp_port=smtp_port,
        sender_name=pick("mail_sender", "POSTER_MAIL_SENDER") or pick("shop_name", "POSTER_SHOP_NAME") or "ПОСТЕР",
    )


# ---------------------------------------------------------------- разбор писем
def decode(value: str | None) -> str:
    """Тема или имя в любой кодировке — в обычную строку."""
    if not value:
        return ""
    try:
        return str(make_header(decode_header(value))).strip()
    except Exception:  # noqa: BLE001 — кривой заголовок не должен ронять список
        return value.strip()


def address(value: str | None) -> dict:
    name, addr = parseaddr(value or "")
    return {"name": decode(name), "email": addr}


def addresses(value: str | None) -> list[dict]:
    if not value:
        return []
    return [{"name": decode(n), "email": a} for n, a in getaddresses([value]) if a]


def when(value: str | None) -> str:
    try:
        return parsedate_to_datetime(value or "").isoformat()
    except (TypeError, ValueError):
        return ""


class _Text(HTMLParser):
    """HTML письма → читаемый текст: абзацы и переносы сохраняются, разметка
    и скрипты выбрасываются. Показывать чужой HTML как есть нельзя — это
    чужой код на нашей странице."""

    BLOCKS = {"p", "div", "br", "li", "tr", "h1", "h2", "h3", "h4", "blockquote", "table"}

    def __init__(self):
        super().__init__()
        self.parts: list[str] = []
        self.skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style", "head"):
            self.skip += 1
        elif tag in self.BLOCKS:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in ("script", "style", "head") and self.skip:
            self.skip -= 1
        elif tag in ("p", "div", "li", "tr", "blockquote"):
            self.parts.append("\n")

    def handle_data(self, data):
        if not self.skip:
            self.parts.append(data)

    def text(self) -> str:
        raw = "".join(self.parts)
        raw = re.sub(r"[ \t]+\n", "\n", raw)
        raw = re.sub(r"\n{3,}", "\n\n", raw)
        return raw.strip()


def html_to_text(html: str) -> str:
    parser = _Text()
    try:
        parser.feed(html)
    except Exception:  # noqa: BLE001
        return re.sub(r"<[^>]+>", "", html)
    return parser.text()


def body_text(msg: Message) -> tuple[str, bool]:
    """Текст письма и признак «это был HTML». text/plain предпочтительнее."""
    plain: list[str] = []
    html: list[str] = []
    for part in msg.walk():
        if part.is_multipart() or part.get_filename():
            continue
        ctype = part.get_content_type()
        if ctype not in ("text/plain", "text/html"):
            continue
        try:
            content = part.get_content()
        except Exception:  # noqa: BLE001 — неизвестная кодировка
            payload = part.get_payload(decode=True) or b""
            content = payload.decode(part.get_content_charset() or "utf-8", errors="replace")
        (plain if ctype == "text/plain" else html).append(content)
    if plain:
        return "\n\n".join(p.strip() for p in plain if p.strip()), False
    if html:
        return "\n\n".join(html_to_text(h) for h in html), True
    return "", False


def attachments_of(msg: Message) -> list[dict]:
    out: list[dict] = []
    for index, part in enumerate(msg.walk()):
        if part.is_multipart():
            continue
        filename = part.get_filename()
        disposition = (part.get_content_disposition() or "").lower()
        if not filename and disposition != "attachment":
            continue
        payload = part.get_payload(decode=True) or b""
        out.append(
            {
                "index": index,
                "filename": decode(filename) or f"вложение-{len(out) + 1}",
                "content_type": part.get_content_type(),
                "size": len(payload),
            }
        )
    return out


def attachment_part(msg: Message, index: int) -> Message | None:
    for i, part in enumerate(msg.walk()):
        if i == index and not part.is_multipart():
            return part
    return None


_UID_RE = re.compile(rb"UID (\d+)")
_FLAGS_RE = re.compile(rb"FLAGS \(([^)]*)\)")


def _parse_fetch(data) -> dict[int, tuple[bytes, bytes]]:
    """Ответ FETCH → {uid: (meta, payload)}. imaplib отдаёт вперемешку кортежи
    (метаданные, тело) и одиночные байты-закрывашки — их пропускаем."""
    out: dict[int, tuple[bytes, bytes]] = {}
    for item in data or []:
        if not isinstance(item, tuple) or len(item) < 2:
            continue
        meta, payload = item[0], item[1]
        m = _UID_RE.search(meta)
        if m:
            out[int(m.group(1))] = (meta, payload)
    return out


def _flags(meta: bytes) -> set[str]:
    m = _FLAGS_RE.search(meta)
    return set(m.group(1).decode(errors="replace").split()) if m else set()


# ---------------------------------------------------------------- ящик
class Mailbox:
    def __init__(self):
        self._lock = threading.RLock()
        self._conn: imaplib.IMAP4_SSL | None = None
        self._cfg: MailConfig | None = None
        self._uids: tuple[float, list[int]] = (0.0, [])
        self._headers: dict[int, dict] = {}         # uid → неизменные поля письма
        self._fresh: tuple[float, dict] = (0.0, {})

    # ------------------------------------------------ соединение
    def _connect(self, cfg: MailConfig) -> imaplib.IMAP4_SSL:
        try:
            conn = imaplib.IMAP4_SSL(cfg.imap_host, cfg.imap_port, timeout=TIMEOUT)
            conn.login(cfg.user, cfg.password)
            conn.select("INBOX")
        except imaplib.IMAP4.error as exc:
            raise MailError(
                "Почтовый сервер не принял логин или пароль. Для Яндекса нужен пароль приложения, "
                "не пароль от аккаунта, и включённый IMAP в настройках ящика."
            ) from exc
        except OSError as exc:
            raise MailError(f"Не удалось соединиться с {cfg.imap_host}:{cfg.imap_port}: {exc}") from exc
        return conn

    def _drop(self) -> None:
        if self._conn is not None:
            try:
                self._conn.logout()
            except Exception:  # noqa: BLE001
                pass
        self._conn = None

    def reset(self) -> None:
        """Настройки поменялись — всё забыть."""
        with self._lock:
            self._drop()
            self._cfg = None
            self._uids = (0.0, [])
            self._headers.clear()
            self._fresh = (0.0, {})

    def _ensure(self, cfg: MailConfig) -> imaplib.IMAP4_SSL:
        if not cfg.configured:
            raise MailError("Почта не настроена: укажите ящик и пароль приложения в «Настройках».")
        if self._cfg != cfg:
            self.reset()
            self._cfg = cfg
        if self._conn is None:
            self._conn = self._connect(cfg)
        return self._conn

    def _call(self, cfg: MailConfig, fn):
        """Команда под замком; оборвалось — один раз переподключиться."""
        with self._lock:
            conn = self._ensure(cfg)
            try:
                return fn(conn)
            except (imaplib.IMAP4.abort, OSError, EOFError):
                self._drop()
                conn = self._ensure(cfg)
                try:
                    return fn(conn)
                except (imaplib.IMAP4.abort, OSError, EOFError) as exc:
                    self._drop()
                    raise MailError(f"Связь с почтой оборвалась: {exc}") from exc
            except imaplib.IMAP4.error as exc:
                raise MailError(f"Почтовый сервер ответил ошибкой: {exc}") from exc

    # ------------------------------------------------ список
    def uids(self, cfg: MailConfig, force: bool = False) -> list[int]:
        stamp, cached = self._uids
        if not force and time.monotonic() - stamp < UIDS_TTL and (cached or stamp):
            return cached

        def run(conn):
            conn.noop()  # подтянуть новые письма в выбранной папке
            status, data = conn.uid("SEARCH", None, "ALL")
            if status != "OK":
                raise MailError("Не удалось получить список писем")
            return sorted(int(x) for x in (data[0] or b"").split())

        result = self._call(cfg, run)
        self._uids = (time.monotonic(), result)
        return result

    def _summaries(self, cfg: MailConfig, uids: list[int]) -> list[dict]:
        """Краткие карточки писем: заголовки из кэша, флаги — свежие."""
        if not uids:
            return []
        missing = [u for u in uids if u not in self._headers]
        uid_set = ",".join(str(u) for u in uids)

        def run(conn):
            flags_by_uid: dict[int, set[str]] = {}
            status, data = conn.uid("FETCH", uid_set, "(FLAGS)")
            if status == "OK":
                for uid, (meta, _payload) in _parse_fetch(data).items():
                    flags_by_uid[uid] = _flags(meta)
                # у FETCH (FLAGS) тело пустое — imaplib отдаёт байты, не кортежи
                for item in data or []:
                    if isinstance(item, bytes):
                        m = _UID_RE.search(item)
                        if m:
                            flags_by_uid[int(m.group(1))] = _flags(item)
            if missing:
                status, data = conn.uid(
                    "FETCH",
                    ",".join(str(u) for u in missing),
                    "(BODYSTRUCTURE BODY.PEEK[HEADER.FIELDS (FROM TO SUBJECT DATE MESSAGE-ID)])",
                )
                if status == "OK":
                    for uid, (meta, payload) in _parse_fetch(data).items():
                        head = email.message_from_bytes(payload, policy=policy.default)
                        self._headers[uid] = {
                            "uid": uid,
                            "from": address(head.get("From")),
                            "to": addresses(head.get("To")),
                            "subject": decode(head.get("Subject")) or "(без темы)",
                            "date": when(head.get("Date")),
                            "message_id": (head.get("Message-ID") or "").strip(),
                            # точный разбор BODYSTRUCTURE не нужен: слово
                            # attachment в структуре и есть признак вложения
                            "has_attachments": b"attachment" in meta.lower(),
                        }
            return flags_by_uid

        flags_by_uid = self._call(cfg, run)
        out = []
        for uid in uids:
            head = self._headers.get(uid)
            if not head:
                continue
            flags = flags_by_uid.get(uid, set())
            out.append({**head, "seen": "\\Seen" in flags, "flagged": "\\Flagged" in flags})
        return out

    def page(self, cfg: MailConfig, before: int | None, after: int | None, limit: int) -> dict:
        """Страница списка. before — письма старше этого UID, after — новее.
        Без обоих — самые свежие. Свежие сверху."""
        limit = max(1, min(limit, MAX_PAGE))
        all_uids = self.uids(cfg)
        if before is not None:
            chosen = [u for u in all_uids if u < before][-limit:]
        elif after is not None:
            chosen = [u for u in all_uids if u > after][:limit]
        else:
            chosen = all_uids[-limit:]
        messages = self._summaries(cfg, chosen)
        messages.sort(key=lambda m: m["uid"], reverse=True)
        oldest = chosen[0] if chosen else None
        newest = chosen[-1] if chosen else None
        return {
            "messages": messages,
            "has_older": bool(chosen) and any(u < oldest for u in all_uids),
            "has_newer": bool(chosen) and any(u > newest for u in all_uids),
            "total": len(all_uids),
        }

    # ------------------------------------------------ письмо
    def raw(self, cfg: MailConfig, uid: int) -> Message:
        def run(conn):
            status, data = conn.uid("FETCH", str(uid), "(BODY.PEEK[])")
            if status != "OK":
                raise MailError("Письмо не удалось прочитать")
            parsed = _parse_fetch(data)
            if uid not in parsed:
                raise MailError("Такого письма уже нет в ящике")
            return email.message_from_bytes(parsed[uid][1], policy=policy.default)

        return self._call(cfg, run)

    def message(self, cfg: MailConfig, uid: int) -> dict:
        msg = self.raw(cfg, uid)
        text, was_html = body_text(msg)
        summary = self._summaries(cfg, [uid])
        head = summary[0] if summary else {}
        return {
            **head,
            "uid": uid,
            "reply_to": address(msg.get("Reply-To") or msg.get("From")),
            "cc": addresses(msg.get("Cc")),
            "text": text,
            "was_html": was_html,
            "attachments": attachments_of(msg),
        }

    def attachment(self, cfg: MailConfig, uid: int, index: int) -> tuple[str, str, bytes]:
        msg = self.raw(cfg, uid)
        part = attachment_part(msg, index)
        if part is None:
            raise MailError("Вложения с таким номером нет")
        payload = part.get_payload(decode=True) or b""
        return decode(part.get_filename()) or "attachment", part.get_content_type(), payload

    def set_seen(self, cfg: MailConfig, uid: int, seen: bool) -> None:
        def run(conn):
            conn.uid("STORE", str(uid), "+FLAGS" if seen else "-FLAGS", r"(\Seen)")

        self._call(cfg, run)
        self._fresh = (0.0, {})  # число непрочитанных изменилось

    # ------------------------------------------------ что нового
    def fresh(self, cfg: MailConfig) -> dict:
        """Сколько непрочитанных и какие UID — кэш на всех клиентов разом."""
        stamp, cached = self._fresh
        if cached and time.monotonic() - stamp < FRESH_TTL:
            return cached

        def run(conn):
            conn.noop()
            status, data = conn.uid("SEARCH", None, "UNSEEN")
            unseen = sorted(int(x) for x in (data[0] or b"").split()) if status == "OK" else []
            return unseen

        unseen = self._call(cfg, run)
        all_uids = self.uids(cfg, force=True)
        result = {"latest_uid": all_uids[-1] if all_uids else 0, "unseen": len(unseen), "unseen_uids": unseen}
        self._fresh = (time.monotonic(), result)
        return result

    def fresh_since(self, cfg: MailConfig, after_uid: int | None) -> dict:
        base = self.fresh(cfg)
        new_uids = [u for u in base["unseen_uids"] if after_uid is not None and u > after_uid][-5:]
        messages = self._summaries(cfg, new_uids) if new_uids else []
        messages.sort(key=lambda m: m["uid"], reverse=True)
        return {"latest_uid": base["latest_uid"], "unseen": base["unseen"], "messages": messages}

    # ------------------------------------------------ отправка
    def send(
        self,
        cfg: MailConfig,
        to: list[str],
        subject: str,
        text: str,
        *,
        in_reply_to: str = "",
        references: str = "",
    ) -> str:
        if not cfg.configured:
            raise MailError("Почта не настроена: укажите ящик и пароль приложения в «Настройках».")
        if not to:
            raise MailError("Не указан адресат")
        msg = EmailMessage()
        msg["From"] = formataddr((cfg.sender_name, cfg.user))
        msg["To"] = ", ".join(to)
        msg["Subject"] = subject
        msg["Date"] = formatdate(localtime=True)
        msg["Message-ID"] = make_msgid(domain=cfg.user.split("@")[-1] or None)
        if in_reply_to:
            msg["In-Reply-To"] = in_reply_to
            msg["References"] = (references + " " + in_reply_to).strip()
        msg.set_content(text)
        try:
            with smtplib.SMTP_SSL(cfg.smtp_host, cfg.smtp_port, timeout=TIMEOUT) as smtp:
                smtp.login(cfg.user, cfg.password)
                smtp.send_message(msg)
        except smtplib.SMTPAuthenticationError as exc:
            raise MailError("SMTP не принял логин или пароль приложения") from exc
        except (smtplib.SMTPException, OSError) as exc:
            raise MailError(f"Письмо не отправилось: {exc}") from exc
        return msg["Message-ID"]

    def reply(self, cfg: MailConfig, uid: int, text: str, author: str) -> dict:
        """Ответ на письмо: адресат — Reply-To или From, тема с «Re:», нить
        сохраняется заголовками In-Reply-To/References. Под ответом — подпись
        и цитата оригинала, как делают почтовые программы."""
        original = self.raw(cfg, uid)
        target = address(original.get("Reply-To") or original.get("From"))
        if not target["email"]:
            raise MailError("У письма нет обратного адреса")
        subject = decode(original.get("Subject")) or ""
        if not re.match(r"^\s*re:", subject, re.IGNORECASE):
            subject = f"Re: {subject}".strip()
        quoted, _ = body_text(original)
        quote = "\n".join(f"> {line}" for line in quoted.splitlines()[:60])
        signature = f"\n\n— {author}, {cfg.sender_name}" if author else f"\n\n— {cfg.sender_name}"
        body = text.rstrip() + signature
        if quote:
            sender = original.get("From") or ""
            body += f"\n\n{decode(sender)} писал(а):\n{quote}"
        message_id = self.send(
            cfg,
            [target["email"]],
            subject,
            body,
            in_reply_to=(original.get("Message-ID") or "").strip(),
            references=(original.get("References") or "").strip(),
        )
        return {"to": target, "subject": subject, "message_id": message_id}

    # ------------------------------------------------ проверка
    def check(self, cfg: MailConfig) -> dict:
        """Соединиться и с IMAP, и с SMTP — для кнопки в настройках."""
        result = {"ok": False, "imap": "", "smtp": "", "unseen": 0, "total": 0}
        if not cfg.configured:
            result["imap"] = result["smtp"] = "не настроено"
            return result
        try:
            self.reset()
            fresh = self.fresh(cfg)
            result["imap"] = "ок"
            result["unseen"] = fresh["unseen"]
            result["total"] = len(self.uids(cfg))
        except MailError as exc:
            result["imap"] = str(exc)
        try:
            with smtplib.SMTP_SSL(cfg.smtp_host, cfg.smtp_port, timeout=TIMEOUT) as smtp:
                smtp.login(cfg.user, cfg.password)
            result["smtp"] = "ок"
        except smtplib.SMTPAuthenticationError:
            result["smtp"] = "логин или пароль приложения не приняты"
        except (smtplib.SMTPException, OSError) as exc:
            result["smtp"] = f"не удалось соединиться: {exc}"
        result["ok"] = result["imap"] == "ок" and result["smtp"] == "ок"
        return result


mailbox = Mailbox()
