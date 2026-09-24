"""Новые права «для всех» доходят до уже заведённых сотрудников — один раз.

Право с "default": True попадает только в профили, созданные после его
появления. Если владелец решил «доступ у всех», существующим профилям его
надо выдать при обновлении — но ровно один раз: снятое администратором
право при следующем запуске возвращаться не должно.
"""

from __future__ import annotations

import conftest  # noqa: F401 — корень проекта в sys.path

from app.models import Employee
from app.services import perm_rollout


def test_новые_права_выдаются_существующим_один_раз(db):
    old = Employee(name="Старый", permissions=["orders.view"])
    db.add(old)
    db.commit()

    assert perm_rollout.grant_new(db) == 1
    db.refresh(old)
    assert "tools.viewer" in old.permissions and "tools.impose" in old.permissions
    assert "orders.view" in old.permissions

    # администратор снял право — при следующем запуске оно не возвращается
    old.permissions = ["orders.view"]
    db.commit()
    assert perm_rollout.grant_new(db) == 0
    db.refresh(old)
    assert "tools.viewer" not in old.permissions


def test_на_пустой_базе_ничего_не_ломается(db):
    assert perm_rollout.grant_new(db) == 0
    assert perm_rollout.grant_new(db) == 0
