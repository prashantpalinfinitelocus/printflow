from typing import Annotated

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from .db import get_db
from .models import CampaignAdmin, CampaignParticipant, Role, User
from .security import decode_access_token, decode_campaign_admin_token, decode_participant_token

bearer = HTTPBearer(auto_error=False)

DbSession = Annotated[Session, Depends(get_db)]


def get_current_user(
    db: DbSession,
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)] = None,
) -> User:
    if creds is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    try:
        payload = decode_access_token(creds.credentials)
    except jwt.ExpiredSignatureError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token expired") from None
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token") from None

    user = db.get(User, int(payload["sub"]))
    if user is None or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User inactive or missing")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def require_admin(user: CurrentUser) -> User:
    if user.role != Role.ADMIN:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin privileges required")
    return user


AdminUser = Annotated[User, Depends(require_admin)]


def _unauthorized(message: str) -> HTTPException:
    # Campaign errors carry a code the web app can branch on (it sends the user back to log in).
    return HTTPException(status.HTTP_401_UNAUTHORIZED, {"code": "UNAUTHORIZED", "message": message})


def get_current_participant(
    db: DbSession,
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)] = None,
) -> CampaignParticipant:
    """The consumer behind a campaign token. Staff tokens are refused (no campaign audience)."""
    if creds is None:
        raise _unauthorized("Not logged in")
    try:
        payload = decode_participant_token(creds.credentials)
    except jwt.ExpiredSignatureError:
        raise _unauthorized("Your session has expired. Please log in again.") from None
    except jwt.PyJWTError:
        raise _unauthorized("Invalid session") from None

    try:
        participant_id = int(payload["sub"])
    except (TypeError, ValueError):
        raise _unauthorized("Invalid session") from None
    participant = db.get(CampaignParticipant, participant_id)
    # A token from before the last logout carries an older version number.
    if participant is None or payload["ver"] != participant.token_version:
        raise _unauthorized("Invalid session")
    return participant


CurrentParticipant = Annotated[CampaignParticipant, Depends(get_current_participant)]


def get_campaign_admin(
    db: DbSession,
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)] = None,
) -> CampaignAdmin:
    """The campaign admin behind a token. Staff and consumer tokens carry another audience and are refused."""
    if creds is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not signed in")
    try:
        payload = decode_campaign_admin_token(creds.credentials)
        admin_id = int(payload["sub"])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Your session has expired. Please sign in again.") from None
    except (jwt.PyJWTError, TypeError, ValueError):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not signed in") from None
    admin = db.get(CampaignAdmin, admin_id)
    if admin is None or not admin.is_active or payload["ver"] != admin.token_version:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not signed in")
    return admin


CampaignAdminUser = Annotated[CampaignAdmin, Depends(get_campaign_admin)]
