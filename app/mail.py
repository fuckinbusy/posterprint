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

import base64
import email
import html as html_lib
import imaplib
import json
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


# ---------------------------------------------------------------- свои адресаты
MAX_CONTACTS = 50


def contacts(overrides: dict[str, str] | None = None) -> list[dict]:
    """Заготовленные адресаты — «Директор», «Цех»: сотруднику не нужно знать
    почту, он выбирает имя при написании письма. Хранятся в настройках
    JSON-списком; битое значение — пустой список, а не ошибка на странице."""
    raw = settings_logic.pick(overrides, "mail_contacts", "")
    if not raw:
        return []
    try:
        data = json.loads(raw)
    except ValueError:
        return []
    out: list[dict] = []
    for item in data if isinstance(data, list) else []:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        email_ = str(item.get("email") or "").strip()
        if email_:
            out.append({"name": name or email_, "email": email_})
    return out[:MAX_CONTACTS]


def normalize_contacts(raw: str) -> str:
    """Проверить список перед записью: адрес обязателен и похож на адрес,
    имя не длиннее строки. Возвращает JSON, каким его и хранить."""
    raw = (raw or "").strip()
    if not raw:
        return ""
    try:
        data = json.loads(raw)
    except ValueError:
        raise ValueError("Список адресатов повреждён") from None
    if not isinstance(data, list):
        raise ValueError("Список адресатов должен быть списком")
    if len(data) > MAX_CONTACTS:
        raise ValueError(f"Адресатов не больше {MAX_CONTACTS}")
    out: list[dict] = []
    for item in data:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()[:80]
        email_ = str(item.get("email") or "").strip()
        if not email_ and not name:
            continue
        if "@" not in email_ or " " in email_:
            raise ValueError(f"У адресата «{name or email_}» неправильный адрес")
        out.append({"name": name or email_, "email": email_})
    return json.dumps(out, ensure_ascii=False)


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


# ---------------------------------------------------------------- HTML письма
# Показывать чужой HTML как есть нельзя: это чужой код на нашей странице.
# Поэтому разметка переписывается заново по белому списку — остаются только
# теги оформления и безопасные атрибуты, ссылки только http/https/mailto,
# картинки только https и вложенные (cid → data:). Скрипты, формы, фреймы,
# обработчики on* и опасные конструкции CSS выбрасываются. Результат ещё и
# показывается в изолированной рамке без скриптов (см. MailPage).
ALLOWED_TAGS = {
    "a", "abbr", "b", "big", "blockquote", "br", "caption", "center", "cite", "code", "dd", "del", "div",
    "dl", "dt", "em", "font", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "img", "ins", "li", "mark",
    "ol", "p", "pre", "q", "s", "small", "span", "strike", "strong", "sub", "sup", "table", "tbody",
    "td", "tfoot", "th", "thead", "tr", "tt", "u", "ul", "body", "html", "section", "article", "header",
    "footer", "main", "nav", "figure", "figcaption", "picture", "source", "label",
}
VOID_TAGS = {"br", "img", "hr", "source"}
# всё внутри этих тегов выбрасывается целиком
DROP_WITH_CONTENT = {
    "script", "iframe", "object", "applet", "form", "button", "select", "textarea",
    "noscript", "svg", "math", "template", "title", "audio", "video",
}
# у этих тегов нет закрывающего — выбрасываем сам тег, не трогая то, что после
DROP_VOID = {"meta", "link", "base", "input", "embed", "param", "track"}
ALLOWED_ATTRS = {
    "href", "src", "srcset", "alt", "title", "width", "height", "align", "valign", "colspan", "rowspan",
    "style", "border", "cellpadding", "cellspacing", "bgcolor", "color", "size", "face", "dir", "lang",
    "class", "type", "start", "media",
}
_BAD_CSS = re.compile(r"(expression\s*\(|javascript:|vbscript:|behavior\s*:|-moz-binding|@import|url\s*\()", re.I)
_CTRL = re.compile(r"[\x00-\x20]+")
MAX_HTML_BYTES = 2_000_000
MAX_INLINE_IMAGE = 2_000_000
MAX_INLINE_TOTAL = 6_000_000


def _clean_url(value: str, tag: str, attr: str, cid_map: dict[str, str]) -> str | None:
    raw = (value or "").strip()
    low = _CTRL.sub("", raw).lower()
    if low.startswith("cid:"):
        return cid_map.get(raw[4:].strip().strip("<>"))
    if tag == "img" or attr in ("src", "srcset"):
        # http-картинки браузер и так заблокирует на https-странице, а
        # data: пропускаем только с картинками
        if low.startswith("https://") or low.startswith("data:image/"):
            return raw
        return None
    if low.startswith(("https://", "http://", "mailto:", "tel:")):
        return raw
    return None


class _Sanitizer(HTMLParser):
    def __init__(self, cid_map: dict[str, str]):
        super().__init__(convert_charrefs=True)
        self.cid_map = cid_map
        self.out: list[str] = []
        self.drop: list[str] = []      # стек тегов, чьё содержимое выбрасываем
        self.in_style = False

    def _attrs(self, tag: str, attrs) -> str:
        parts = []
        for name, value in attrs:
            name = (name or "").lower()
            if name.startswith("on") or name not in ALLOWED_ATTRS:
                continue
            value = value or ""
            if name in ("href", "src", "srcset"):
                cleaned = _clean_url(value, tag, name, self.cid_map)
                if cleaned is None:
                    continue
                value = cleaned
            elif name == "style":
                value = _BAD_CSS.sub("", value)
            parts.append(f' {name}="{html_lib.escape(value, quote=True)}"')
        if tag == "a":
            parts.append(' target="_blank" rel="noopener noreferrer"')
        if tag == "img":
            parts.append(' loading="lazy"')
        return "".join(parts)

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        if tag in DROP_VOID:
            return
        if self.drop:
            if tag in DROP_WITH_CONTENT:
                self.drop.append(tag)
            return
        if tag in DROP_WITH_CONTENT:
            self.drop.append(tag)
            return
        if tag == "style":
            self.in_style = True
            self.out.append("<style>")
            return
        if tag not in ALLOWED_TAGS:
            return  # тег выбрасываем, содержимое остаётся
        self.out.append(f"<{tag}{self._attrs(tag, attrs)}>")

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag.lower() not in VOID_TAGS:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        tag = tag.lower()
        if self.drop:
            if tag == self.drop[-1]:
                self.drop.pop()
            return
        if tag == "style":
            self.in_style = False
            self.out.append("</style>")
            return
        if tag in ALLOWED_TAGS and tag not in VOID_TAGS:
            self.out.append(f"</{tag}>")

    def handle_data(self, data):
        if self.drop:
            return
        if self.in_style:
            self.out.append(_BAD_CSS.sub("", data))
        else:
            self.out.append(html_lib.escape(data, quote=False))

    def handle_comment(self, data):
        pass  # условные комментарии Outlook и трекинг — не нужны


# Фон документу не задаём: рамка прозрачная, цвет подкладывает интерфейс
# под свою тему (см. HtmlMail в MailPage). Текст тёмный, как в письме
# «на бумаге», — в тёмной теме рамка целиком инвертируется.
FRAME_STYLE = (
    "body{margin:0;padding:18px 22px;font:15px/1.5 -apple-system,'Segoe UI',Roboto,Arial,sans-serif;"
    "color:#111;word-break:break-word}"
    "img{max-width:100%;height:auto}table{max-width:100%}a{color:#0a58ca}"
    "blockquote{margin:8px 0;padding-left:12px;border-left:3px solid #ccc;color:#555}"
)


def sanitize_html(raw: str, cid_map: dict[str, str] | None = None) -> str:
    """HTML письма → безопасный документ для изолированной рамки."""
    parser = _Sanitizer(cid_map or {})
    try:
        parser.feed(raw)
        parser.close()
    except Exception:  # noqa: BLE001 — сломанную разметку показываем текстом
        return ""
    body = "".join(parser.out).strip()
    if not body:
        return ""
    return (
        '<!doctype html><html><head><meta charset="utf-8"><base target="_blank">'
        f"<style>{FRAME_STYLE}</style></head><body>{body}</body></html>"
    )


def inline_images(msg: Message) -> dict[str, str]:
    """Картинки, вшитые в письмо (Content-ID) → data:-строки для подстановки
    вместо cid:. Ограничены по размеру: письмо с десятком мегабайт картинок
    браузеру не нужно целиком."""
    out: dict[str, str] = {}
    total = 0
    for part in msg.walk():
        if part.is_multipart() or not part.get_content_type().startswith("image/"):
            continue
        cid = (part.get("Content-ID") or "").strip().strip("<>")
        if not cid:
            continue
        payload = part.get_payload(decode=True) or b""
        if not payload or len(payload) > MAX_INLINE_IMAGE or total + len(payload) > MAX_INLINE_TOTAL:
            continue
        total += len(payload)
        out[cid] = f"data:{part.get_content_type()};base64,{base64.b64encode(payload).decode('ascii')}"
    return out


def html_body(msg: Message) -> str:
    """Вычищенный HTML письма или пустая строка, если письмо текстовое,
    разметка не разобралась или слишком велика."""
    chunks: list[str] = []
    for part in msg.walk():
        if part.is_multipart() or part.get_filename() or part.get_content_type() != "text/html":
            continue
        try:
            chunks.append(part.get_content())
        except Exception:  # noqa: BLE001
            payload = part.get_payload(decode=True) or b""
            chunks.append(payload.decode(part.get_content_charset() or "utf-8", errors="replace"))
    if not chunks:
        return ""
    raw = "\n".join(chunks)
    if len(raw.encode("utf-8", errors="ignore")) > MAX_HTML_BYTES:
        return ""
    return sanitize_html(raw, inline_images(msg))


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


INBOX = "INBOX"
# как папка отправленных называется у разных серверов, если сервер не
# пометил её флагом \Sent
SENT_NAMES = ("Sent", "Отправленные", "Sent Items", "Sent Messages", "INBOX/Sent", "INBOX.Sent")
_LIST_RE = re.compile(rb'^\((?P<flags>[^)]*)\) (?:"[^"]*"|NIL) (?P<name>"(?:[^"\\]|\\.)*"|\S+)$')


def pick_sent(lines: list[bytes]) -> str | None:
    """Имя папки отправленных из ответа LIST: по флагу Sent, иначе по имени."""
    named: dict[str, str] = {}
    for raw in lines:
        if not isinstance(raw, bytes):
            continue
        m = _LIST_RE.match(raw.strip())
        if not m:
            continue
        name = m.group("name").decode("ascii", errors="replace").strip()
        if name.startswith('"') and name.endswith('"'):
            name = name[1:-1].replace('\\"', '"')
        flags = m.group("flags").decode("ascii", errors="replace").lower()
        if "\\sent" in flags:
            return name
        named[name.lower()] = name
    for candidate in SENT_NAMES:
        if candidate.lower() in named:
            return named[candidate.lower()]
    return None


def _quote_folder(name: str) -> str:
    return name if name == INBOX or (name.startswith('"') and name.endswith('"')) else f'"{name}"'


def first_message_id(value: str | None) -> str:
    """Первый <id> из заголовка In-Reply-To/References — со скобками, как в письме."""
    m = re.search(r"<[^>]+>", value or "")
    return m.group(0) if m else ""


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
        self._headers: dict[tuple[str, int], dict] = {}  # (папка, uid) → неизменные поля письма
        self._fresh: tuple[float, dict] = (0.0, {})
        self._sent: str | None | bool = False        # False — ещё не искали
        self._by_id: dict[str, tuple[float, dict | None]] = {}  # Message-ID → (когда, где лежит)

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
            self._sent = False
            self._by_id.clear()

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

    def _in_folder(self, conn, folder: str, fn):
        """Выполнить команду в другой папке и вернуться во «Входящие»: всё
        остальное в классе считает, что выбран INBOX."""
        if folder == INBOX:
            return fn()
        status, _ = conn.select(_quote_folder(folder), readonly=True)
        if status != "OK":
            raise MailError(f"Папка «{folder}» не открывается")
        try:
            return fn()
        finally:
            conn.select(INBOX)

    def sent_folder(self, cfg: MailConfig) -> str | None:
        """Где лежат отправленные. Ищется один раз на соединение."""
        if self._sent is not False:
            return self._sent  # type: ignore[return-value]

        def run(conn):
            status, data = conn.list()
            return pick_sent(data or []) if status == "OK" else None

        self._sent = self._call(cfg, run)
        return self._sent  # type: ignore[return-value]

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

    def _summaries(self, cfg: MailConfig, uids: list[int], folder: str = INBOX) -> list[dict]:
        """Краткие карточки писем: заголовки из кэша, флаги — свежие."""
        if not uids:
            return []
        missing = [u for u in uids if (folder, u) not in self._headers]
        uid_set = ",".join(str(u) for u in uids)

        def run(conn):
            return self._in_folder(conn, folder, lambda: fetch(conn))

        def fetch(conn):
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
                        self._headers[(folder, uid)] = {
                            "uid": uid,
                            "folder": folder,
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
            head = self._headers.get((folder, uid))
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
    def raw(self, cfg: MailConfig, uid: int, folder: str = INBOX) -> Message:
        def run(conn):
            def fetch():
                status, data = conn.uid("FETCH", str(uid), "(BODY.PEEK[])")
                if status != "OK":
                    raise MailError("Письмо не удалось прочитать")
                parsed = _parse_fetch(data)
                if uid not in parsed:
                    raise MailError("Такого письма уже нет в ящике")
                return email.message_from_bytes(parsed[uid][1], policy=policy.default)

            return self._in_folder(conn, folder, fetch)

        return self._call(cfg, run)

    def message(self, cfg: MailConfig, uid: int, folder: str = INBOX) -> dict:
        msg = self.raw(cfg, uid, folder)
        text, was_html = body_text(msg)
        summary = self._summaries(cfg, [uid], folder)
        head = summary[0] if summary else {}
        return {
            **head,
            "uid": uid,
            "folder": folder,
            # на что это письмо отвечает — по нему интерфейс показывает
            # исходное письмо во всплывающей карточке
            "in_reply_to": first_message_id(msg.get("In-Reply-To")) or first_message_id(msg.get("References")),
            "reply_to": address(msg.get("Reply-To") or msg.get("From")),
            "cc": addresses(msg.get("Cc")),
            "text": text,
            "was_html": was_html,
            # вычищенная разметка с картинками — показывается в рамке;
            # текст остаётся запасным видом и для цитаты в ответе
            "html": html_body(msg),
            "attachments": attachments_of(msg),
        }

    def attachment(self, cfg: MailConfig, uid: int, index: int, folder: str = INBOX) -> tuple[str, str, bytes]:
        msg = self.raw(cfg, uid, folder)
        part = attachment_part(msg, index)
        if part is None:
            raise MailError("Вложения с таким номером нет")
        payload = part.get_payload(decode=True) or b""
        return decode(part.get_filename()) or "attachment", part.get_content_type(), payload

    NEGATIVE_TTL = 60  # секунд помним «не нашли»: письмо могло ещё не долететь

    def locate(self, cfg: MailConfig, message_id: str) -> dict | None:
        """Где лежит письмо с таким Message-ID: {folder, uid} или None.

        Ищем во «Входящих» и в «Отправленных»: клиент отвечает на наше письмо,
        а наше лежит в отправленных — иначе ссылку «в ответ на» было бы не
        разрешить. Найденное помним навсегда (письма не переезжают), не
        найденное — минуту.
        """
        message_id = message_id.strip()
        if not message_id:
            return None
        cached = self._by_id.get(message_id)
        if cached and (cached[1] is not None or time.monotonic() - cached[0] < self.NEGATIVE_TTL):
            return cached[1]

        folders = [INBOX]
        sent = self.sent_folder(cfg)
        if sent and sent != INBOX:
            folders.append(sent)

        def run(conn):
            for folder in folders:
                def search():
                    status, data = conn.uid("SEARCH", None, "HEADER", "Message-ID", f'"{message_id}"')
                    return [int(x) for x in (data[0] or b"").split()] if status == "OK" else []

                found = self._in_folder(conn, folder, search)
                if found:
                    return {"folder": folder, "uid": found[-1]}
            return None

        result = self._call(cfg, run)
        self._by_id[message_id] = (time.monotonic(), result)
        return result

    def referenced(self, cfg: MailConfig, message_id: str) -> dict:
        """Письмо, на которое ссылаются: целиком, для всплывающей карточки."""
        where = self.locate(cfg, message_id)
        if not where:
            return {"found": False, "message": None}
        return {"found": True, "message": self.message(cfg, where["uid"], where["folder"])}

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
