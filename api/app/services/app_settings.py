"""The single row of runtime settings, created on first read."""

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..models import AppSettings

SETTINGS_ID = 1


def get_app_settings(db: Session) -> AppSettings:
    row = db.get(AppSettings, SETTINGS_ID)
    if row is None:
        db.add(AppSettings(id=SETTINGS_ID))
        try:
            db.commit()
        except IntegrityError:
            # Another request created it first.
            db.rollback()
        row = db.get(AppSettings, SETTINGS_ID)
    return row


def apply_text_case(text: str, settings: AppSettings) -> str:
    """The order text as it should appear on the label."""
    return text.upper() if settings.uppercase_text else text
