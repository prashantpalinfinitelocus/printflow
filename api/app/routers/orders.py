from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, Query, UploadFile, status
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from ..config import settings
from ..deps import AdminUser, CurrentUser, DbSession
from ..models import CsvBatch, Order, OrderStatus, Role, Store, User
from ..schemas import (
    CsvBatchOut,
    ImportFromPathRequest,
    InboxFile,
    OrderOut,
    OrderPage,
    OrderStats,
    PrintJobOut,
)
from ..services.csv_import import CsvFormatError, import_csv

router = APIRouter(tags=["orders"])


def _scoped(stmt, user: User):
    """Operators only ever see their own store's orders. Enforced server-side."""
    if user.role != Role.ADMIN:
        if user.store_id is None:
            # An operator with no store sees nothing rather than everything.
            return stmt.where(Order.store_id == -1)
        return stmt.where(Order.store_id == user.store_id)
    return stmt


@router.get("/orders", response_model=OrderPage)
def list_orders(
    db: DbSession,
    user: CurrentUser,
    status_filter: OrderStatus | None = Query(default=None, alias="status"),
    store_id: int | None = None,
    q: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=200),
):
    stmt = _scoped(select(Order), user)
    count_stmt = _scoped(select(func.count(Order.id)), user)

    if status_filter is not None:
        stmt = stmt.where(Order.status == status_filter)
        count_stmt = count_stmt.where(Order.status == status_filter)
    if store_id is not None and user.role == Role.ADMIN:
        stmt = stmt.where(Order.store_id == store_id)
        count_stmt = count_stmt.where(Order.store_id == store_id)
    if q:
        pattern = f"%{q.lower()}%"
        cond = func.lower(Order.order_ref).like(pattern) | func.lower(Order.print_text).like(pattern)
        stmt = stmt.where(cond)
        count_stmt = count_stmt.where(cond)

    total = db.scalar(count_stmt) or 0
    items = db.scalars(
        stmt.options(
            selectinload(Order.store),
            selectinload(Order.print_format),
            selectinload(Order.printed_by),
        )
        .order_by(Order.status.desc(), Order.created_at.desc(), Order.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()

    return OrderPage(
        items=[OrderOut.model_validate(o) for o in items],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/orders/stats", response_model=OrderStats)
def order_stats(db: DbSession, user: CurrentUser, store_id: int | None = None):
    stmt = _scoped(select(Order.status, func.count(Order.id)), user)
    if store_id is not None and user.role == Role.ADMIN:
        stmt = stmt.where(Order.store_id == store_id)
    counts = dict(db.execute(stmt.group_by(Order.status)).all())

    amount_stmt = _scoped(
        select(func.coalesce(func.sum(Order.amount), 0)).where(Order.status == OrderStatus.PENDING),
        user,
    )
    if store_id is not None and user.role == Role.ADMIN:
        amount_stmt = amount_stmt.where(Order.store_id == store_id)

    return OrderStats(
        pending=counts.get(OrderStatus.PENDING, 0),
        printing=counts.get(OrderStatus.PRINTING, 0),
        printed=counts.get(OrderStatus.PRINTED, 0),
        failed=counts.get(OrderStatus.FAILED, 0),
        total=sum(counts.values()),
        amount_pending=db.scalar(amount_stmt) or 0,
    )


@router.get("/orders/{order_id}", response_model=OrderOut)
def get_order(order_id: int, db: DbSession, user: CurrentUser):
    order = db.scalar(
        _scoped(select(Order).where(Order.id == order_id), user).options(
            selectinload(Order.store),
            selectinload(Order.print_format),
            selectinload(Order.printed_by),
        )
    )
    if order is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Order not found")
    return order


@router.get("/orders/{order_id}/jobs", response_model=list[PrintJobOut])
def order_jobs(order_id: int, db: DbSession, user: CurrentUser):
    order = db.scalar(_scoped(select(Order).where(Order.id == order_id), user))
    if order is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Order not found")
    return sorted(order.jobs, key=lambda j: j.id, reverse=True)


# ---------- CSV intake (admin) ----------


@router.post("/csv/upload", response_model=CsvBatchOut, status_code=status.HTTP_201_CREATED)
async def upload_csv(db: DbSession, admin: AdminUser, file: UploadFile = File(...)):
    name = Path(file.filename or "upload.csv").name
    if not name.lower().endswith(".csv"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Only .csv files are accepted")
    raw = await file.read()
    if not raw:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "The uploaded file is empty")

    # Keep a copy of exactly what was ingested.
    (settings.inbox_dir / name).write_bytes(raw)

    try:
        batch, _result = import_csv(
            db, raw=raw, filename=name, source="upload", uploaded_by_id=admin.id
        )
    except CsvFormatError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc
    return batch


@router.get("/csv/inbox", response_model=list[InboxFile])
def list_inbox(_: AdminUser):
    """CSVs sitting in the watched drop directory (data/inbox)."""
    files = []
    for path in sorted(settings.inbox_dir.glob("*.csv")):
        stat = path.stat()
        files.append(
            InboxFile(
                name=path.name,
                size=stat.st_size,
                modified=datetime.fromtimestamp(stat.st_mtime),
            )
        )
    return files


@router.post("/csv/import-from-inbox", response_model=CsvBatchOut, status_code=status.HTTP_201_CREATED)
def import_from_inbox(payload: ImportFromPathRequest, db: DbSession, admin: AdminUser):
    name = Path(payload.filename).name  # defeat path traversal
    path = settings.inbox_dir / name
    if not path.exists() or path.suffix.lower() != ".csv":
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"'{name}' not found in the inbox")
    try:
        batch, _result = import_csv(
            db, raw=path.read_bytes(), filename=name, source="inbox", uploaded_by_id=admin.id
        )
    except CsvFormatError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc
    return batch


@router.get("/csv/batches", response_model=list[CsvBatchOut])
def list_batches(db: DbSession, _: AdminUser, limit: int = Query(default=20, ge=1, le=100)):
    return db.scalars(
        select(CsvBatch)
        .options(selectinload(CsvBatch.uploaded_by))
        .order_by(CsvBatch.id.desc())
        .limit(limit)
    ).all()


@router.get("/csv/template")
def csv_template():
    """The exact header the importer expects, plus one illustrative row."""
    sample_store = "STORE CODE FROM YOUR STORE MASTER"
    return {
        "columns": ["order_id", "store_id", "amount", "print_format", "text"],
        "example": {
            "order_id": "ORD-1001",
            "store_id": sample_store,
            "amount": "499.00",
            "print_format": "PSD FORMAT CODE",
            "text": "Happy Birthday, Riya!",
        },
    }
