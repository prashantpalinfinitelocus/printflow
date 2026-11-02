"""Consumer Diet Coke campaign: phone login, text check, entry window, entries.

Public apart from the participant token issued by /campaign/otp/verify. Errors
carry `{code, message}` so the web app can tell a wrong OTP from a closed window.
"""

import threading
import time

from fastapi import APIRouter, HTTPException, Response, status
from fastapi.responses import FileResponse
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError

from ..config import settings
from ..deps import CurrentParticipant, DbSession
from ..models import CampaignCatalogDesign, CampaignEntry, CampaignParticipant, ModerationStatus
from ..schemas import (
    CampaignSession,
    CampaignWindow,
    EntryCreate,
    EntryOut,
    PublicDesignOut,
    PublicDesignsOut,
    OtpRequest,
    OtpSent,
    OtpVerify,
    TextCheck,
    TextVerdict,
)
from ..security import create_participant_token
from ..services import campaign, campaign_catalog, otp, rate_limit
from ..services.moderation import Verdict, moderate_texts

router = APIRouter(prefix="/campaign", tags=["campaign"])


def _error(status_code: int, code: str, message: str) -> HTTPException:
    return HTTPException(status_code, {"code": code, "message": message})


def _otp_error(exc: otp.OtpError) -> HTTPException:
    """An OTP refusal as an API error; limits also say how long to wait, in the body and Retry-After."""
    detail: dict = {"code": exc.code, "message": exc.message}
    headers = None
    if exc.retry_after is not None:
        detail["retry_after"] = exc.retry_after
        headers = {"Retry-After": str(exc.retry_after)}
    return HTTPException(exc.status_code, detail, headers=headers)


class ApprovedTexts:
    """Texts Gemini cleared in the last `campaign_approved_text_ttl_seconds`.

    The live check approves a text while it is typed, and Make It Happen used to send the same
    text to Gemini again, a second wait of a second or more. Only a CLEAR verdict is kept: a
    flagged or unchecked text is asked about every time. Per instance and bounded; a miss just
    asks Gemini, so nothing depends on it being shared.
    """

    MAX = 10_000

    def __init__(self) -> None:
        self._until: dict[str, float] = {}
        self._lock = threading.Lock()

    def has(self, text: str) -> bool:
        with self._lock:
            until = self._until.get(text)
            return until is not None and until > time.monotonic()

    def add(self, text: str) -> None:
        with self._lock:
            if len(self._until) >= self.MAX:
                self._forget_expired_locked()
                if len(self._until) >= self.MAX:
                    self._until.pop(next(iter(self._until)))
            self._until[text] = time.monotonic() + settings.campaign_approved_text_ttl_seconds

    def forget_expired(self) -> None:
        with self._lock:
            self._forget_expired_locked()

    def _forget_expired_locked(self) -> None:
        now = time.monotonic()
        ttl = settings.campaign_approved_text_ttl_seconds
        for text in [t for t, until in self._until.items() if until <= now or until - now > ttl]:
            del self._until[text]

    def clear(self) -> None:
        with self._lock:
            self._until.clear()


APPROVED_TEXTS = ApprovedTexts()


def _throttle(db, action: str, participant_id: int, limit: int) -> None:
    """Refuses a signed-in phone that makes `action` more than `limit` times a minute."""
    wait = rate_limit.hit(db, f"{action}:{participant_id}", limit, campaign.now())
    if wait is not None:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            {"code": "RATE_LIMITED", "message": "Too many tries in a short time. Please wait a minute and try again.", "retry_after": wait},
            headers={"Retry-After": str(wait)},
        )


def _check_text(raw: str) -> tuple[str, Verdict]:
    """The trimmed text and the model's verdict. Raises if the text can't be printed or checked."""
    problem = campaign.validate_text(raw)
    if problem:
        raise _error(status.HTTP_422_UNPROCESSABLE_CONTENT, "TEXT_INVALID", problem)
    text = raw.strip()
    if APPROVED_TEXTS.has(text):
        return text, Verdict(ModerationStatus.CLEAR)
    verdict = moderate_texts([text]).verdicts[0]
    if verdict.status == ModerationStatus.CLEAR:
        APPROVED_TEXTS.add(text)
    if verdict.status == ModerationStatus.NEEDS_REVIEW:
        raise _error(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "MODERATION_UNAVAILABLE",
            "Our message checker needs a moment. Your design is still here — please try again.",
        )
    return text, verdict


def _approved_text(raw: str) -> str:
    """The trimmed text if it may go on a can; otherwise raises. Fails closed."""
    text, verdict = _check_text(raw)
    if verdict.status == ModerationStatus.FLAGGED:
        raise _error(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "TEXT_REJECTED",
            "That line isn’t quite the Diet Coke vibe. Try another one that keeps it fun, positive, and personal.",
        )
    return text


@router.post("/otp/send", response_model=OtpSent)
def send_otp(payload: OtpRequest, db: DbSession):
    """Starts a login: texts a code, or (flag off, bypass on) texts nothing. Rate limited per phone."""
    try:
        otp.send_otp(db, payload.phone, campaign.now())
    except otp.OtpError as exc:
        raise _otp_error(exc) from None
    return OtpSent(resend_after=settings.campaign_otp_resend_after_seconds)


@router.post("/otp/verify", response_model=CampaignSession)
def verify_otp(payload: OtpVerify, db: DbSession):
    try:
        otp.verify_otp(db, payload.phone, payload.code, campaign.now())
    except otp.OtpError as exc:
        raise _otp_error(exc) from None

    # One atomic upsert, so two first logins for a phone at once (double tap, two tabs)
    # can't both insert. The latest email wins: it is where a winner is contacted.
    participant = db.execute(
        insert(CampaignParticipant)
        .values(phone=payload.phone, email=payload.email)
        .on_conflict_do_update(index_elements=[CampaignParticipant.phone], set_={"email": payload.email})
        .returning(CampaignParticipant.id, CampaignParticipant.token_version)
    ).one()
    db.commit()

    token, expires_in = create_participant_token(participant_id=participant.id, version=participant.token_version)
    return CampaignSession(token=token, expires_in=expires_in, phone=payload.phone, email=payload.email)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(db: DbSession, participant: CurrentParticipant):
    """Revokes every session token issued so far for this phone."""
    participant.token_version += 1
    db.commit()


@router.get("/window", response_model=CampaignWindow)
def get_window():
    return CampaignWindow(state=campaign.window_state(campaign.now()))


@router.get("/designs", response_model=PublicDesignsOut)
def list_designs(db: DbSession):
    """How the nine built-in designs have changed: designs a campaign admin added and shows
    (after the built-in ones), and built-in ones the admin hid."""
    designs = db.scalars(
        select(CampaignCatalogDesign).where(CampaignCatalogDesign.is_active.is_(True)).order_by(CampaignCatalogDesign.created_at)
    )
    return PublicDesignsOut(
        added=[PublicDesignOut(design_id=d.design_id, name=d.name, category=d.category, version=d.version) for d in designs],
        hidden=campaign_catalog.hidden_builtins(db),
    )


@router.get("/designs/{design_id}/sticker")
def added_design_sticker(design_id: str, db: DbSession):
    design = db.get(CampaignCatalogDesign, design_id)
    path = settings.campaign_sticker_dir / design.sticker_path if design and design.is_active else None
    if path is None or not path.is_file():
        raise _error(status.HTTP_404_NOT_FOUND, "NOT_FOUND", "No such design.")
    # The web app asks with ?v=<version>, so a replaced sticker has a new URL and this one can be cached.
    return FileResponse(path, media_type="image/png", headers={"Cache-Control": "public, max-age=86400"})


@router.post("/moderate", response_model=TextVerdict)
def moderate(payload: TextCheck, db: DbSession, participant: CurrentParticipant):
    _throttle(db, "moderate", participant.id, settings.campaign_moderate_per_minute)
    _, verdict = _check_text(payload.text)
    return TextVerdict(result="REJECTED" if verdict.status == ModerationStatus.FLAGGED else "APPROVED")


@router.post("/entries", response_model=EntryOut, status_code=status.HTTP_201_CREATED)
def create_entry(payload: EntryCreate, db: DbSession, participant: CurrentParticipant, response: Response):
    def existing() -> CampaignEntry | None:
        return db.scalar(
            select(CampaignEntry).where(
                CampaignEntry.participant_id == participant.id,
                CampaignEntry.idempotency_key == payload.idempotency_key,
            )
        )

    # A retried submit returns the entry it already made, without re-moderating — even
    # after 22:00, when the first try was accepted but its response was lost.
    found = existing()
    if found is not None:
        response.status_code = status.HTTP_200_OK
        return EntryOut(entry_id=found.id)

    _throttle(db, "entries", participant.id, settings.campaign_entries_per_minute)
    if not campaign_catalog.is_enterable(db, payload.design_id):
        raise _error(status.HTTP_422_UNPROCESSABLE_CONTENT, "DESIGN_UNKNOWN", "That design is no longer available. Pick another one.")

    at = campaign.now()
    state = campaign.window_state(at)
    if state != "OPEN":
        raise _error(status.HTTP_409_CONFLICT, "WINDOW_CLOSED", campaign.window_message(state))

    cap = settings.campaign_max_entries_per_participant
    daily_cap = settings.campaign_max_entries_per_day
    if cap or daily_cap:
        # Locks the participant until the entry is committed, so concurrent submits cannot
        # all read "below the cap" and each add one.
        db.execute(select(CampaignParticipant.id).where(CampaignParticipant.id == participant.id).with_for_update())
    if cap:
        used = db.scalar(select(func.count()).select_from(CampaignEntry).where(CampaignEntry.participant_id == participant.id))
        if used >= cap:
            raise _error(
                status.HTTP_409_CONFLICT,
                "ENTRY_LIMIT_REACHED",
                "You’ve reached the maximum number of entries for this campaign.",
            )
    if daily_cap:
        today = db.scalar(
            select(func.count())
            .select_from(CampaignEntry)
            .where(CampaignEntry.participant_id == participant.id, CampaignEntry.campaign_day == campaign.campaign_day(at))
        )
        if today >= daily_cap:
            raise _error(
                status.HTTP_409_CONFLICT,
                "ENTRY_LIMIT_REACHED",
                f"You’ve made {daily_cap} entries today. Come back tomorrow from {campaign.opening_label()} for more.",
            )

    # The browser's check proves nothing: the server moderates every entry again.
    text = _approved_text(payload.text)
    entry = CampaignEntry(
        participant_id=participant.id,
        idempotency_key=payload.idempotency_key,
        design_id=payload.design_id,
        text=text,
        campaign_day=campaign.campaign_day(at),
    )
    db.add(entry)
    try:
        db.commit()
    except IntegrityError:
        # Two copies of the same submit raced; the other one won.
        db.rollback()
        found = existing()
        if found is None:
            raise
        response.status_code = status.HTTP_200_OK
        return EntryOut(entry_id=found.id)
    return EntryOut(entry_id=entry.id)
