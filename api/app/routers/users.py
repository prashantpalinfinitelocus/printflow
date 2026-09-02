from fastapi import APIRouter, HTTPException, status
from sqlalchemy import func, select

from ..deps import AdminUser, DbSession
from ..models import CsvBatch, Order, PrintJob, Role, Store, User
from ..schemas import UserCreate, UserOut, UserUpdate
from ..security import hash_password

router = APIRouter(prefix="/users", tags=["users"])


def _validate_store_assignment(db, role: Role, store_id: int | None) -> None:
    if role == Role.OPERATOR:
        if store_id is None:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY, "An operator must be assigned to a store"
            )
        store = db.get(Store, store_id)
        if store is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Store not found")


@router.get("", response_model=list[UserOut])
def list_users(db: DbSession, _: AdminUser, store_id: int | None = None, q: str | None = None):
    stmt = select(User).order_by(User.id)
    if store_id is not None:
        stmt = stmt.where(User.store_id == store_id)
    if q:
        pattern = f"%{q.lower()}%"
        stmt = stmt.where(func.lower(User.email).like(pattern))
    return db.scalars(stmt).all()


@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_user(payload: UserCreate, db: DbSession, _: AdminUser):
    email = payload.email.lower()
    if db.scalar(select(User.id).where(User.email == email)):
        raise HTTPException(status.HTTP_409_CONFLICT, f"User '{email}' already exists")
    _validate_store_assignment(db, payload.role, payload.store_id)

    user = User(
        email=email,
        full_name=payload.full_name,
        password_hash=hash_password(payload.password),
        role=payload.role,
        store_id=payload.store_id if payload.role == Role.OPERATOR else None,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.patch("/{user_id}", response_model=UserOut)
def update_user(user_id: int, payload: UserUpdate, db: DbSession, admin: AdminUser):
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")

    data = payload.model_dump(exclude_unset=True)
    if user.id == admin.id and data.get("is_active") is False:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You cannot deactivate your own account")
    if user.id == admin.id and data.get("role") == Role.OPERATOR:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You cannot demote your own account")

    new_role = data.get("role", user.role)
    new_store = data.get("store_id", user.store_id)
    _validate_store_assignment(db, new_role, new_store)

    if password := data.pop("password", None):
        user.password_hash = hash_password(password)
    for field, value in data.items():
        setattr(user, field, value)
    if user.role == Role.ADMIN:
        user.store_id = None

    db.commit()
    db.refresh(user)
    return user


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(user_id: int, db: DbSession, admin: AdminUser):
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    if user.id == admin.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You cannot delete your own account")
    if user.role == Role.ADMIN and db.scalar(
        select(func.count(User.id)).where(User.role == Role.ADMIN, User.is_active.is_(True))
    ) <= 1:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Cannot delete the last active admin")

    # Keep the print audit trail intact; just detach the operator from it.
    db.query(PrintJob).filter(PrintJob.user_id == user_id).update({PrintJob.user_id: None})
    db.query(Order).filter(Order.printed_by_id == user_id).update({Order.printed_by_id: None})
    db.query(CsvBatch).filter(CsvBatch.uploaded_by_id == user_id).update(
        {CsvBatch.uploaded_by_id: None}
    )
    db.delete(user)
    db.commit()
