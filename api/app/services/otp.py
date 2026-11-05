"""One-time codes for the consumer campaign login.

Three jobs, kept apart so each can change alone:

* **Delivery** is a strategy (`OtpSender`). `get_sender()` picks it from settings.
  With `campaign_infobip_enabled` off nothing is texted and only the bypass code
  logs in; with it on, codes go out through Infobip on a DLT-approved template.
* **Abuse limits** live in `campaign_phone_guards`, one row per phone, locked for
  the length of a send or a verify so two concurrent requests for one phone
  cannot both slip under a limit. Every number is a setting.
* **Storage** keeps only a keyed hash of each code.

Every function takes `now` so tests (and the router, via `campaign.now`) pin the clock.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import math
import secrets
from datetime import datetime, timedelta
from typing import Protocol

import httpx
from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from ..config import settings
from ..models import CampaignOtp, CampaignPhoneGuard

log = logging.getLogger("printflow.campaign.otp")

REASON_SEND = "SEND_LIMIT"
REASON_VERIFY = "VERIFY_LOCK"


class OtpError(Exception):
    """A refusal the router turns into `{code, message}` with this HTTP status."""

    status_code = 400
    code = "OTP_ERROR"

    def __init__(self, message: str, *, retry_after: int | None = None):
        super().__init__(message)
        self.message = message
        self.retry_after = retry_after


class OtpUnavailable(OtpError):
    status_code = 503
    code = "OTP_UNAVAILABLE"


class OtpSendFailed(OtpError):
    status_code = 503
    code = "OTP_SEND_FAILED"


class OtpBlocked(OtpError):
    """Too many codes were asked for; sending (and verifying) is closed for a while."""

    status_code = 429
    code = "OTP_BLOCKED"


class OtpLocked(OtpError):
    """Too many wrong codes; verifying is closed for a while."""

    status_code = 429
    code = "OTP_LOCKED"


class OtpWrong(OtpError):
    code = "OTP_WRONG"


class OtpExpired(OtpError):
    code = "OTP_EXPIRED"


class OtpDeliveryError(Exception):
    """The SMS vendor did not accept the message."""


# ---------------- delivery ----------------


class OtpSender(Protocol):
    def send(self, phone: str, code: str) -> None:
        """Text `code` to `phone` (10 digits). Raises OtpDeliveryError on failure."""


def _mask(phone: str) -> str:
    masked = f"{phone[:2]}******{phone[-2:]}"
    return masked.replace("\r", "").replace("\n", "")


class InfobipOtpSender:
    """Sends the code on the DLT-approved template through Infobip's SMS API."""

    def __init__(self, client: httpx.Client | None = None):
        self._client = client

    def send(self, phone: str, code: str) -> None:
        payload = {
            "messages": [
                {
                    "sender": settings.campaign_infobip_sender_id,
                    "destinations": [{"to": f"91{phone}"}],
                    "content": {"text": settings.campaign_infobip_message.replace("{otp}", code)},
                    "options": {
                        "regional": {
                            "indiaDlt": {
                                "principalEntityId": settings.campaign_infobip_dlt_entity_id,
                                "contentTemplateId": settings.campaign_infobip_dlt_template_id,
                            }
                        }
                    },
                }
            ]
        }
        # Both come from Secret Manager, where a copied value can carry a trailing newline.
        url = f"{settings.campaign_infobip_base_url.strip().rstrip('/')}/sms/3/messages"
        headers = {"Authorization": f"App {settings.campaign_infobip_api_key.strip()}", "Accept": "application/json"}
        client = self._client or httpx.Client(timeout=settings.campaign_infobip_timeout_seconds)
        try:
            res = client.post(url, json=payload, headers=headers)
        except httpx.HTTPError as exc:
            raise OtpDeliveryError(f"Infobip unreachable: {type(exc).__name__}") from exc
        finally:
            if self._client is None:
                client.close()
        if res.status_code >= 400:
            # The body can echo the message, so only the status is logged.
            log.error("Infobip refused the OTP for %s: HTTP %s", _mask(phone), res.status_code)
            raise OtpDeliveryError(f"Infobip returned HTTP {res.status_code}")


def _build_infobip_sender() -> OtpSender:
    required = (
        settings.campaign_infobip_base_url,
        settings.campaign_infobip_api_key,
        settings.campaign_infobip_sender_id,
        settings.campaign_infobip_dlt_entity_id,
        settings.campaign_infobip_dlt_template_id,
        settings.campaign_infobip_message,
    )
    if not all(required) or "{otp}" not in settings.campaign_infobip_message:
        log.error("campaign_infobip_enabled is on but the Infobip settings are incomplete")
        raise OtpUnavailable("Login is not available right now.")
    return InfobipOtpSender()


def get_sender() -> OtpSender | None:
    """The sender for the current settings; None means "send nothing" (bypass mode)."""
    if settings.campaign_infobip_enabled:
        return _build_infobip_sender()
    if settings.campaign_otp_bypass:
        return None
    raise OtpUnavailable("Login is not available right now.")


# ---------------- helpers ----------------


def _hash(phone: str, code: str) -> str:
    return hmac.new(settings.jwt_secret.encode(), f"{phone}:{code}".encode(), hashlib.sha256).hexdigest()


def _generate() -> str:
    return str(secrets.randbelow(10**settings.campaign_otp_length)).zfill(settings.campaign_otp_length)


def _lock_guard(db: Session, phone: str) -> CampaignPhoneGuard:
    """The phone's guard row, created if missing and locked until the transaction ends."""
    db.execute(insert(CampaignPhoneGuard).values(phone=phone, failed_verifies=0).on_conflict_do_nothing())
    return db.execute(
        select(CampaignPhoneGuard).where(CampaignPhoneGuard.phone == phone).with_for_update()
    ).scalar_one()


def _seconds_until(moment: datetime, now: datetime) -> int:
    return max(1, math.ceil((moment - now).total_seconds()))


def _raise_if_blocked(guard: CampaignPhoneGuard, now: datetime, db: Session) -> None:
    if guard.blocked_until is None or guard.blocked_until <= now:
        return
    wait = _seconds_until(guard.blocked_until, now)
    reason = guard.block_reason
    db.rollback()  # release the row lock before answering
    if reason == REASON_VERIFY:
        raise OtpLocked("Too many wrong codes. Please try again later.", retry_after=wait)
    raise OtpBlocked("Too many OTP requests. Please try again later.", retry_after=wait)


def _block(db: Session, guard: CampaignPhoneGuard, *, now: datetime, seconds: int, reason: str) -> int:
    guard.blocked_until = now + timedelta(seconds=seconds)
    guard.block_reason = reason
    guard.failed_verifies = 0
    db.commit()
    return seconds


# ---------------- send ----------------


def send_otp(db: Session, phone: str, now: datetime) -> None:
    """Issues a code for `phone`, or raises why not. Counts toward the send limit."""
    sender = get_sender()  # unavailable login must not spend the user's quota

    guard = _lock_guard(db, phone)
    _raise_if_blocked(guard, now, db)

    window_start = now - timedelta(seconds=settings.campaign_otp_send_window_seconds)
    recent = db.scalar(
        select(func.count()).select_from(CampaignOtp).where(
            CampaignOtp.phone == phone, CampaignOtp.created_at > window_start
        )
    )
    if recent >= settings.campaign_otp_send_limit:
        wait = _block(db, guard, now=now, seconds=settings.campaign_otp_block_seconds, reason=REASON_SEND)
        raise OtpBlocked("Too many OTP requests. Please try again later.", retry_after=wait)

    # One live code per phone: a new one replaces the last.
    db.execute(
        update(CampaignOtp).where(CampaignOtp.phone == phone, CampaignOtp.consumed_at.is_(None)).values(consumed_at=now)
    )
    code = _generate() if sender is not None else None
    row = CampaignOtp(
        phone=phone,
        code_hash=_hash(phone, code) if code else None,
        expires_at=now + timedelta(seconds=settings.campaign_otp_ttl_seconds),
        created_at=now,
    )
    db.add(row)
    # Committed before texting so the row lock is not held across the vendor call.
    db.commit()

    if sender is not None:
        try:
            sender.send(phone, code)
        except OtpDeliveryError as exc:
            log.error("OTP delivery failed for %s: %s", _mask(phone), exc)
            # Nothing was delivered, so this attempt must not count toward the send limit:
            # a vendor outage would otherwise block users for something that is not their fault.
            db.delete(row)
            db.commit()
            raise OtpSendFailed("We couldn't send the code. Please try again.") from exc


# ---------------- verify ----------------


def _bypass_matches(code: str) -> bool:
    expected = settings.campaign_otp_bypass_code
    return settings.campaign_otp_bypass and bool(expected) and hmac.compare_digest(code.encode(), expected.encode())


def verify_otp(db: Session, phone: str, code: str, now: datetime) -> None:
    """Returns if `code` is valid for `phone`; otherwise raises and counts the failure."""
    guard = _lock_guard(db, phone)
    _raise_if_blocked(guard, now, db)

    if _bypass_matches(code):
        guard.failed_verifies = 0
        db.commit()
        return

    active = None
    if settings.campaign_infobip_enabled:
        active = db.scalars(
            select(CampaignOtp)
            .where(
                CampaignOtp.phone == phone,
                CampaignOtp.consumed_at.is_(None),
                CampaignOtp.code_hash.is_not(None),
                CampaignOtp.expires_at > now,
            )
            .order_by(CampaignOtp.created_at.desc())
            .limit(1)
        ).first()

    if active is not None and hmac.compare_digest(active.code_hash, _hash(phone, code)):
        active.consumed_at = now
        guard.failed_verifies = 0
        db.commit()
        return

    if guard.last_failed_at is not None and (
        now - guard.last_failed_at > timedelta(seconds=settings.campaign_otp_verify_window_seconds)
    ):
        guard.failed_verifies = 0
    guard.failed_verifies += 1
    guard.last_failed_at = now
    if guard.failed_verifies >= settings.campaign_otp_verify_max_failures:
        if active is not None:
            active.consumed_at = now
        wait = _block(db, guard, now=now, seconds=settings.campaign_otp_verify_lock_seconds, reason=REASON_VERIFY)
        raise OtpLocked("Too many wrong codes. Please try again later.", retry_after=wait)
    db.commit()

    if settings.campaign_infobip_enabled and active is None:
        raise OtpExpired("That code has expired. Tap resend for a new one.")
    raise OtpWrong("That code doesn't match. Try again.")
