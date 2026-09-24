"""Новые права «для всех» — существующим профилям, один раз.

Право с "default": True попадает только в профили, созданные после его
появления (permissions.default_permissions). Когда владелец решает, что новая
возможность нужна всем, уже заведённым сотрудникам её надо выдать при
обновлении — иначе у всех, кто работал вчера, раздел просто пустой.

Выдаётся ровно один раз: что выдано, записано в таблице настроек под
служебным ключом (его нет в settings.KEYS, страница «Настройки» его не
видит). Снятое администратором право при следующем запуске не вернётся.
"""

from __future__ import annotations

import json

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Employee, Setting

# права, которые при появлении выдаются всем уже заведённым профилям;
# новое такое право — дописать сюда (решение владельца, TODO.md, раздел 16)
FOR_EVERYONE = ["tools.viewer", "tools.impose"]
STATE_KEY = "perm_rollout"


def grant_new(db: Session) -> int:
    """Выдаёт ещё не розданные права всем профилям. Возвращает, скольким профилям добавили."""
    row = db.get(Setting, STATE_KEY)
    done: list[str] = json.loads(row.value) if row and row.value else []
    fresh = [key for key in FOR_EVERYONE if key not in done]
    if not fresh:
        return 0
    changed = 0
    for employee in db.scalars(select(Employee)).all():
        missing = [key for key in fresh if key not in (employee.permissions or [])]
        if missing:
            # присваиванием, а не append: JSON-колонка не видит правок на месте
            employee.permissions = [*(employee.permissions or []), *missing]
            changed += 1
    value = json.dumps([*done, *fresh])
    if row is None:
        db.add(Setting(key=STATE_KEY, value=value))
    else:
        row.value = value
    db.commit()
    return changed
