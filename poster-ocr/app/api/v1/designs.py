"""Макеты заказов: превью, загрузка, скачивание.

Хранение — в app/designs.py, разбор CDR — в app/cdr.py.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.core import deploy
from app.core.database import get_db
from app.core.logs import log as applog
from app.core.security import CurrentUser, current_user, make_scoped_token, require_perm, verify_scoped_token
from app.models import Order, OrderEvent
from app.services import designs

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
        # с префиксом пути (POSTER_BASE_PATH): браузер идёт по ссылке сам, без нашего клиента
        "url": f"{deploy.BASE_PATH}/api/orders/{order_id}/design/file?t={token}",
        "filename": designs.design_path(order.number).name,
    }


@router.get("/file")
def design_file(
    order_id: int,
    t: str | None = Query(default=None, description="одноразовый токен из /link"),
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(current_user),
) -> FileResponse:
    """Скачивание исходного CDR.

    Права проверяются либо токеном из /link (браузер идёт по ссылке сам и
    заголовков не шлёт), либо обычным заголовком — API-ключом или токеном
    сессии, для запросов из кода. Права — до поиска заказа: иначе по ответу
    «заказ не найден» без входа можно было бы перебрать номера заказов.
    """
    if not verify_scoped_token(t, f"design:{order_id}"):
        if user.kind == "guest":
            raise HTTPException(401, "Ссылка устарела — обновите страницу")
        if not user.can("design.view"):
            raise HTTPException(403, "Недостаточно прав для этого действия")
    order = _order(db, order_id)

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

    # Пишем кусками сразу на диск и останавливаемся, как только перешагнули
    # лимит: макет в 300 МБ иначе лежал в памяти целиком, и дважды — буфер
    # и его копия, — а на несколько одновременных загрузок это гигабайты.
    try:
        designs.check_name(file.filename or "")
        temp = designs.upload_target(order.number)
        size = 0
        with open(temp, "wb") as out:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > designs.MAX_UPLOAD_BYTES:
                    out.close()
                    temp.unlink(missing_ok=True)
                    applog.warning(
                        "Макет %s отклонён: больше %s МБ (файл «%s») · %s",
                        order.number, designs.MAX_UPLOAD_BYTES // 1024 // 1024,
                        file.filename or "без имени", user.name,
                    )
                    raise HTTPException(
                        422, f"Файл больше {designs.MAX_UPLOAD_BYTES // 1024 // 1024} МБ"
                    )
                out.write(chunk)
        info = designs.commit(order.number, temp)
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


@router.get("/scene")
def design_scene(
    order_id: int,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_perm("design.view")),
) -> dict:
    """Содержимое макета для просмотра: страницы, объекты, размеры.

    Нельзя показать (нет разборщика, файл не читается) — это не ошибка
    сервера: отвечаем available=false и причиной, интерфейс покажет её
    вместо холста, а эскиз и скачивание работают как раньше.
    """
    from app.services import cdr_scene

    order = _order(db, order_id)
    path = designs.design_path(order.number)
    if not path.exists():
        raise HTTPException(404, "Макет не загружен")
    base = {"available": False, "reason": "", "version": cdr_scene.version(path), "tools": cdr_scene.tools()}
    try:
        scene = cdr_scene.scene(path, designs.scene_cache_path(order.number))
    except cdr_scene.SceneError as exc:
        applog.info("Макет %s: просмотр недоступен — %s", order.number, exc)
        return {**base, "reason": str(exc)}
    return {**base, **scene, "available": True}


@router.get("/export")
def design_export(
    order_id: int,
    format: str = Query(default="svg", pattern="^(svg|pdf)$"),
    page: int = Query(default=1, ge=1, le=500),
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(require_perm("design.view")),
) -> Response:
    """Макет в открытом формате — чтобы открыть файл новой версии в старом
    CorelDRAW (X6 импортирует и SVG, и PDF). Сам .cdr записать умеет только
    CorelDRAW, поэтому «пересохранить в версию 16» здесь нельзя."""
    from urllib.parse import quote

    from app.services import cdr_scene

    order = _order(db, order_id)
    path = designs.design_path(order.number)
    if not path.exists():
        raise HTTPException(404, "Макет не загружен")
    try:
        if format == "pdf":
            payload, media = cdr_scene.convert_to_pdf(path), "application/pdf"
        else:
            scene = cdr_scene.scene(path, designs.scene_cache_path(order.number))
            if page > len(scene["pages"]):
                raise HTTPException(404, f"В макете страниц: {len(scene['pages'])}")
            payload, media = cdr_scene.standalone_svg(scene["pages"][page - 1]), "image/svg+xml"
    except cdr_scene.SceneError as exc:
        raise HTTPException(422, str(exc)) from None
    suffix = f"-стр{page}" if format == "svg" and page > 1 else ""
    filename = f"{order.number}{suffix}.{format}"
    applog.info("Макет %s выгружен в %s · %s", order.number, format.upper(), user.name)
    return Response(
        content=payload,
        media_type=media,
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"},
    )


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
    from app.services import cdr

    order = _order(db, order_id)
    return cdr.inspect(designs.design_path(order.number))
