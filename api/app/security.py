import uuid
from datetime import UTC, datetime, timedelta

import bcrypt
import jwt

from .config import settings


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except ValueError:
        return False


def create_access_token(*, user_id: int, role: str, store_id: int | None) -> tuple[str, int]:
    expires_in = settings.jwt_expire_minutes * 60
    now = datetime.now(UTC)
    payload = {
        "sub": str(user_id),
        "role": role,
        "store_id": store_id,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(seconds=expires_in)).timestamp()),
    }
    token = jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)
    return token, expires_in


def decode_access_token(token: str) -> dict:
    return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])


#: Audience claim on consumer campaign tokens. Staff tokens carry none, and PyJWT
#: refuses a token whose audience the caller did not ask for, so neither kind of
#: token is accepted where the other is expected.
CAMPAIGN_AUDIENCE = "campaign"
CAMPAIGN_ISSUER = "printflow-campaign"
#: A campaign token missing any of these is refused, not defaulted.
_CAMPAIGN_REQUIRED_CLAIMS = ["sub", "iat", "exp", "aud", "iss", "jti", "ver"]


def create_participant_token(*, participant_id: int, version: int = 0) -> tuple[str, int]:
    """`version` is the participant's token_version; bumping it revokes every earlier token."""
    expires_in = settings.campaign_jwt_expire_minutes * 60
    now = datetime.now(UTC)
    payload = {
        "sub": str(participant_id),
        "aud": CAMPAIGN_AUDIENCE,
        "iss": CAMPAIGN_ISSUER,
        "jti": uuid.uuid4().hex,
        "ver": version,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(seconds=expires_in)).timestamp()),
    }
    token = jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)
    return token, expires_in


def decode_participant_token(token: str) -> dict:
    return jwt.decode(
        token,
        settings.jwt_secret,
        algorithms=[settings.jwt_algorithm],
        audience=CAMPAIGN_AUDIENCE,
        issuer=CAMPAIGN_ISSUER,
        options={"require": _CAMPAIGN_REQUIRED_CLAIMS},
    )


#: Campaign admin tokens: their own audience and issuer, so a staff or consumer token is
#: never accepted where one is expected, and one of these opens nothing else.
CAMPAIGN_ADMIN_AUDIENCE = "campaign-admin"
CAMPAIGN_ADMIN_ISSUER = "printflow-campaign-admin"


def create_campaign_admin_token(*, admin_id: int, version: int = 0) -> tuple[str, int]:
    expires_in = settings.campaign_admin_jwt_expire_minutes * 60
    now = datetime.now(UTC)
    payload = {
        "sub": str(admin_id),
        "aud": CAMPAIGN_ADMIN_AUDIENCE,
        "iss": CAMPAIGN_ADMIN_ISSUER,
        "jti": uuid.uuid4().hex,
        "ver": version,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(seconds=expires_in)).timestamp()),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm), expires_in


def decode_campaign_admin_token(token: str) -> dict:
    return jwt.decode(
        token,
        settings.jwt_secret,
        algorithms=[settings.jwt_algorithm],
        audience=CAMPAIGN_ADMIN_AUDIENCE,
        issuer=CAMPAIGN_ADMIN_ISSUER,
        options={"require": _CAMPAIGN_REQUIRED_CLAIMS},
    )
