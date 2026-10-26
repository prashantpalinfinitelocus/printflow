from fastapi import APIRouter

from ..deps import AdminUser, CurrentUser, DbSession
from ..schemas import AppSettingsOut, AppSettingsUpdate
from ..services.app_settings import get_app_settings

router = APIRouter(prefix="/app-settings", tags=["app-settings"])


@router.get("", response_model=AppSettingsOut)
def read_app_settings(db: DbSession, _: CurrentUser):
    """Readable by operators too: the print dialog shows text the way it will print."""
    return get_app_settings(db)


@router.patch("", response_model=AppSettingsOut)
def update_app_settings(payload: AppSettingsUpdate, db: DbSession, admin: AdminUser):
    row = get_app_settings(db)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(row, field, value)
    row.updated_by_id = admin.id
    db.commit()
    db.refresh(row)
    return row
