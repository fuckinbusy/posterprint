"""Пароль администратора — в .env хэшем, а не открытым текстом.

    python -m scripts.set_password            # спросит пароль дважды и запишет в .env
    python -m scripts.set_password --print    # только напечатать хэш, файл не трогать

Зачем. К файлам на сервере в мастерской имеют доступ те, кто за ним сидит;
строка POSTER_ADMIN_PASSWORD=… читалась любым блокнотом. Хэш (PBKDF2,
200 000 итераций, случайная соль — тот же, что у паролей сотрудников)
обратно в пароль не превращается: зная его, войти нельзя, можно только
подбирать, и подбор длинного пароля займёт годы.

Скрипт заменяет строку POSTER_ADMIN_PASSWORD на POSTER_ADMIN_PASSWORD_HASH
и, где это возможно (Linux, macOS), закрывает .env от чтения другими
пользователями. После этого сервер нужно перезапустить.
"""

from __future__ import annotations

import argparse
import getpass
import os
import re
import stat
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.deploy import MIN_ADMIN_PASSWORD
from app.core.paths import BASE_DIR
from app.core.security import hash_password

ENV_FILE = BASE_DIR / ".env"


def env_line(password_hash: str) -> str:
    """Строка для .env — значение в одинарных кавычках.

    В хэше есть «$» (pbkdf2$соль$хэш). Docker Compose в env_file подставляет
    переменные в значения без кавычек, и «$ab12…» превращалось бы в пустоту —
    сервер отказывался стартовать с «не похож на хэш». В одинарных кавычках
    значение берётся буквально и Compose, и python-dotenv (им .env читает
    сервер без Docker)."""
    return f"POSTER_ADMIN_PASSWORD_HASH='{password_hash}'"


def rewrite_env(text: str, password_hash: str) -> str:
    """Чистая функция над текстом .env — её проверяют тесты.

    Открытый пароль убираем совсем, а не комментируем: закомментированная
    строка с паролем ничем не лучше обычной. Хэш пишем на его место, чтобы
    настройка осталась в том же разделе файла; не было ни того ни другого —
    добавляем в конец.
    """
    lines = text.splitlines()
    out: list[str] = []
    placed = False
    for line in lines:
        key = line.split("=", 1)[0].strip()
        if key in ("POSTER_ADMIN_PASSWORD", "POSTER_ADMIN_PASSWORD_HASH"):
            if not placed:
                out.append(env_line(password_hash))
                placed = True
            continue
        out.append(line)
    if not placed:
        if out and out[-1].strip():
            out.append("")
        out.append("# пароль администратора хэшем — задаётся командой python -m scripts.set_password")
        out.append(env_line(password_hash))
    return "\n".join(out) + "\n"


def protect(path: Path) -> str:
    """Права «только владелец». На Windows права другие — подсказываем руками."""
    if os.name != "posix":
        return "На Windows закройте файл через свойства → Безопасность: доступ только учётной записи, от которой запущен сервер."
    path.chmod(stat.S_IRUSR | stat.S_IWUSR)
    return "Права на .env: только владелец (600)."


def password_problem(password: str) -> str:
    """Чем плох пароль; пусто — годится. Отдельно от ввода — её проверяют тесты."""
    if len(password) < MIN_ADMIN_PASSWORD:
        return f"Короче {MIN_ADMIN_PASSWORD} знаков — такой подбирается по словарю. Придумайте длиннее."
    if password.lower() == "admin":
        return "«admin» — это пароль по умолчанию, его знают все."
    return ""


def ask_password() -> str:
    first = getpass.getpass("Новый пароль администратора: ")
    problem = password_problem(first)
    if problem:
        sys.exit(problem)
    second = getpass.getpass("Ещё раз: ")
    if first != second:
        sys.exit("Пароли не совпали, ничего не изменено.")
    return first


def main() -> None:
    parser = argparse.ArgumentParser(description="Пароль администратора ПОСТЕР — хэшем в .env")
    parser.add_argument("--print", action="store_true", help="напечатать хэш и выйти, .env не трогать")
    # для установочного скрипта (deploy/setup.sh): пароль приходит одной строкой
    # по трубе — внутри `docker compose run` без терминала getpass ненадёжен
    parser.add_argument("--stdin", action="store_true", help="прочитать пароль одной строкой со стандартного ввода")
    args = parser.parse_args()

    if args.stdin:
        password = sys.stdin.readline().rstrip("\r\n")
        problem = password_problem(password)
        if problem:
            sys.exit(problem)
    else:
        password = ask_password()
    digest = hash_password(password)

    if args.print:
        print("\n" + env_line(digest))
        return

    if not ENV_FILE.exists():
        sys.exit(f"Нет файла {ENV_FILE}: сначала скопируйте .env.example в .env")
    text = ENV_FILE.read_text(encoding="utf-8")
    new = rewrite_env(text, digest)
    ENV_FILE.write_text(new, encoding="utf-8")
    had_plain = bool(re.search(r"^POSTER_ADMIN_PASSWORD=", text, re.M))
    print(f"Хэш записан в {ENV_FILE.name}." + (" Открытый пароль из файла убран." if had_plain else ""))
    print(protect(ENV_FILE))
    print("Перезапустите сервер, чтобы он прочитал новый пароль.")


if __name__ == "__main__":
    main()
