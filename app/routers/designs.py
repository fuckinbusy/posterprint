"""Макеты заказов: превью, загрузка, скачивание.

Хранение — в app/designs.py, разбор CDR — в app/cdr.py.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app import designs
from app.database import get_db
from app.logs import log as applog
from app.models import Order, OrderEvent
from app.security import CurrentUser, make_scoped_token, require_perm, verify_scoped_token

router = APIRouter(prefix="/api/orders/{order_id}/design", tags=["designs"])


def _order(db: Session, order_id: int) -> Order:
    order = db.get(Order, order_id)
    if order is None:
        raise HTTPException(404, "Заказ не найден")
    return order


@router.get("")
def design_info(
    order_id: int,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_perm("design.view")),
) -> dict:
    """Есть ли макет, его размер и удалось ли достать превью."""
    order = _order(db, order_id)
    data = designs.info(order.number).as_dict()
    data["can_upload"] = user.can("design.upload")
    return data


@router.get("/preview")
def design_preview(
    order_id: int,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_perm("design.view")),
) -> Response:
    """Картинка превью. Отдаём PNG прямо в браузер."""
    order = _order(db, order_id)
    data, note = designs.get_preview(order.number)
    if data is None:
        raise HTTPException(404, note)

    return Response(
        content=data,
        media_type="image/png",
        headers={
            # превью меняется только вместе с файлом, поэтому его можно кэшировать,
            # но ненадолго: макет могут заменить в любой момент
            "Cache-Control": "private, max-age=60",
        },
    )


@router.get("/link")
def design_link(
    order_id: int,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_perm("design.view")),
) -> dict:
    """Адрес для скачивания с одноразовым токеном.

    Обычная ссылка <a href download> не отправляет наши заголовки — браузер
    ходит по ней сам. Поэтому выдаём адрес с коротким токеном на пять минут.
    """
    order = _order(db, order_id)
    if not designs.design_path(order.number).exists():
        raise HTTPException(404, "Макет не загружен")
    token = make_scoped_token(f"design:{order_id}")
    return {
        "url": f"/api/orders/{order_id}/design/file?t={token}",
        "filename": designs.design_path(order.number).name,
    }


@router.get("/file")
def design_file(
    order_id: int,
    t: str | None = Query(default=None, description="одноразовый токен из /link"),
    db: Session = Depends(get_db),
) -> FileResponse:
    """Скачивание исходного CDR.

    Права проверяются либо токеном из /link (браузер идёт по ссылке сам и
    заголовков не шлёт), либо обычным заголовком — для запросов из кода.
    """
    order = _order(db, order_id)

    if not verify_scoped_token(t, f"design:{order_id}"):
        raise HTTPException(401, "Ссылка устарела — обновите страницу")

    path = designs.design_path(order.number)
    if not path.exists():
        raise HTTPException(404, "Макет не загружен")
    return FileResponse(
        path,
        media_type="application/octet-stream",
        filename=path.name,
    )


@router.post("")
async def upload_design(
    order_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_perm("design.upload")),
) -> dict:
    """Загрузка макета. Прежний файл заменяется — один заказ, один макет."""
    order = _order(db, order_id)

    data = await file.read()
    try:
        info = designs.save(order.number, file.filename or "", data)
    except ValueError as exc:
        applog.warning(
            "Макет %s отклонён: %s (файл «%s») · %s",
            order.number, exc, file.filename or "без имени", user.name,
        )
        raise HTTPException(422, str(exc)) from None
    except OSError as exc:
        applog.error("Макет %s не сохранён: %s · %s", order.number, exc, user.name)
        raise HTTPException(500, f"Не удалось сохранить файл: {exc}") from None

    db.add(OrderEvent(
        order_id=order.id,
        kind="design",
        text=f"Загружен макет ({info.size // 1024} КБ)",
        author=user.name,
    ))
    db.commit()
    # отсутствие превью — самая частая жалоба по макетам, пишем сразу
    applog.info(
        "Макет %s загружен: «%s», %s КБ, превью %s · %s",
        order.number, file.filename or "без имени", info.size // 1024,
        "есть" if info.has_preview else f"нет ({info.preview_note or 'причина неизвестна'})",
        user.name,
    )

    result = info.as_dict()
    result["can_upload"] = True
    return result


@router.delete("", status_code=204)
def delete_design(
    order_id: int,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_perm("design.upload")),
) -> None:
    order = _order(db, order_id)
    if not designs.delete(order.number):
        raise HTTPException(404, "Макет не загружен")

    applog.warning("Макет %s удалён · %s", order.number, user.name)
    db.add(OrderEvent(
        order_id=order.id,
        kind="design",
        text="Макет удалён",
        author=user.name,
    ))
    db.commit()


@router.get("/inspect")
def inspect_design(
    order_id: int,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_perm("design.upload")),
) -> dict:
    """Что внутри файла — на случай, когда превью не находится.

    Показывает тип контейнера и список вложений: по нему видно, где именно
    CorelDRAW держит эскиз в вашей версии.
    """
    from app import cdr

    order = _order(db, order_id)
    return cdr.inspect(designs.design_path(order.number))