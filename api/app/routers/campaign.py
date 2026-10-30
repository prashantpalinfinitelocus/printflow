"""Consumer Diet Coke campaign: phone login, text check, entry window, entries.

Public apart from the participant token issued by /campaign/otp/verify. Errors
carry `{code, message}` so the web app can tell a wrong OTP from a closed window.
"""

from fastapi import APIRouter, HTTPException, Response, status
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError

from ..config import settings
from ..deps import CurrentParticipant, DbSession
from ..models import CampaignEntry, CampaignParticipant, ModerationStatus
from ..schemas import (
    CampaignSession,
    CampaignWindow,
    EntryCreate,
    EntryOut,
    OtpRequest,
    OtpSent,
    OtpVerify,
    TextCheck,
    TextVerdict,
)
from ..security import create_participant_token
from ..services import campaign, otp
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


def _check_text(raw: str) -> tuple[str, Verdict]:
    """The trimmed text and the model's verdict. Raises if the text can't be printed or checked."""
    problem = campaign.validate_text(raw)
    if problem:
        raise _error(status.HTTP_422_UNPROCESSABLE_CONTENT, "TEXT_INVALID", problem)
    text = raw.strip()
    verdict = moderate_texts([text]).verdicts[0]
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


@router.post("/moderate", response_model=TextVerdict)
def moderate(payload: TextCheck, _: CurrentParticipant):
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

    at = campaign.now()
    state = campaign.window_state(at)
    if state != "OPEN":
        raise _error(status.HTTP_409_CONFLICT, "WINDOW_CLOSED", campaign.window_message(state))

    cap = settings.campaign_max_entries_per_participant
    if cap:
        # Locks the participant until the entry is committed, so concurrent submits cannot
        # all read "below the cap" and each add one.
        db.execute(select(CampaignParticipant.id).where(CampaignParticipant.id == participant.id).with_for_update())
        used = db.scalar(select(func.count()).select_from(CampaignEntry).where(CampaignEntry.participant_id == participant.id))
        if used >= cap:
            raise _error(
                status.HTTP_409_CONFLICT,
                "ENTRY_LIMIT_REACHED",
                "You’ve reached the maximum number of entries for this campaign.",
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
