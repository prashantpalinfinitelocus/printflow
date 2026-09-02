from fastapi import APIRouter, HTTPException, status
from sqlalchemy import func, select

from ..deps import AdminUser, CurrentUser, DbSession
from ..models import Order, OrderStatus, Role, Store, User
from ..schemas import StoreCreate, StoreOut, StoreUpdate, StoreWithStats

router = APIRouter(prefix="/stores", tags=["stores"])


@router.get("", response_model=list[StoreWithStats])
def list_stores(db: DbSession, user: CurrentUser, include_inactive: bool = True):
    """Admins see every store. Operators see only their own (needed for headers/filters)."""
    stmt = select(Store).order_by(Store.code)
    if user.role != Role.ADMIN:
        stmt = stmt.where(Store.id == user.store_id)
    if not include_inactive:
        stmt = stmt.where(Store.is_active.is_(True))
    stores = db.scalars(stmt).all()

    user_counts = dict(
        db.execute(select(User.store_id, func.count(User.id)).group_by(User.store_id)).all()
    )
    pending_counts = dict(
        db.execute(
            select(Order.store_id, func.count(Order.id))
            .where(Order.status == OrderStatus.PENDING)
            .group_by(Order.store_id)
        ).all()
    )

    return [
        StoreWithStats(
            **StoreOut.model_validate(s).model_dump(),
            user_count=user_counts.get(s.id, 0),
            pending_orders=pending_counts.get(s.id, 0),
        )
        for s in stores
    ]


@router.post("", response_model=StoreOut, status_code=status.HTTP_201_CREATED)
def create_store(payload: StoreCreate, db: DbSession, _: AdminUser):
    code = payload.code.strip().upper()
    if db.scalar(select(Store.id).where(Store.code == code)):
        raise HTTPException(status.HTTP_409_CONFLICT, f"Store code '{code}' already exists")
    store = Store(code=code, name=payload.name, city=payload.city, is_active=payload.is_active)
    db.add(store)
    db.commit()
    db.refresh(store)
    return store


@router.patch("/{store_id}", response_model=StoreOut)
def update_store(store_id: int, payload: StoreUpdate, db: DbSession, _: AdminUser):
    store = db.get(Store, store_id)
    if store is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Store not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(store, field, value)
    db.commit()
    db.refresh(store)
    return store


@router.delete("/{store_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_store(store_id: int, db: DbSession, _: AdminUser):
    store = db.get(Store, store_id)
    if store is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Store not found")
    if db.scalar(select(func.count(Order.id)).where(Order.store_id == store_id)):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Store has orders and cannot be deleted — deactivate it instead",
        )
    if db.scalar(select(func.count(User.id)).where(User.store_id == store_id)):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Store has users assigned — reassign them before deleting",
        )
    db.delete(store)
    db.commit()
