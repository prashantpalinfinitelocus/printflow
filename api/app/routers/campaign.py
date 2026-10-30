"""Consumer Diet Coke campaign: phone login, text check, entry window, entries.

Public apart from the participant token issued by /campaign/otp/verify. Errors
carry `{code, message}` so the web app can tell a wrong OTP from a closed window.
"""

from fastapi import APIRouter, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

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
from ..services import campaign
from ..services.moderation import moderate_texts

router = APIRouter(prefix="/campaign", tags=["campaign"])

#: Seconds the web app waits before offering "Resend code".
RESEND_AFTER = 30


def _error(status_code: int, code: str, message: str) -> HTTPException:
    return HTTPException(status_code, {"code": code, "message": message})


def _approved_text(raw: str) -> str:
    """The trimmed text if it may go on a can; otherwise raises. Fails closed."""
    problem = campaign.validate_text(raw)
    if problem:
        raise _error(status.HTTP_422_UNPROCESSABLE_CONTENT, "TEXT_INVALID", problem)
    text = raw.strip()
    verdict = moderate_texts([text]).verdicts[0]
    if verdict.status == ModerationStatus.FLAGGED:
        raise _error(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "TEXT_REJECTED",
            "That line isn’t quite the Diet Coke vibe. Try another one that keeps it fun, positive, and personal.",
        )
    if verdict.status == ModerationStatus.NEEDS_REVIEW:
        raise _error(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "MODERATION_UNAVAILABLE",
            "Our message checker needs a moment. Your design is still here — please try again.",
        )
    return text


@router.post("/otp/send", response_model=OtpSent)
def send_otp(payload: OtpRequest):
    """Starts a login. No SMS provider is wired in yet: with the bypass on, nothing is sent."""
    if not campaign.settings.campaign_otp_bypass:
        raise _error(status.HTTP_503_SERVICE_UNAVAILABLE, "OTP_UNAVAILABLE", "Login is not available right now.")
    return OtpSent(resend_after=RESEND_AFTER)


@router.post("/otp/verify", response_model=CampaignSession)
def verify_otp(payload: OtpVerify, db: DbSession):
    if not campaign.otp_matches(payload.code):
        raise _error(status.HTTP_400_BAD_REQUEST, "OTP_WRONG", "That code doesn't match. Try again.")

    participant = db.scalar(select(CampaignParticipant).where(CampaignParticipant.phone == payload.phone))
    if participant is None:
        participant = CampaignParticipant(phone=payload.phone, email=payload.email)
        db.add(participant)
    else:
        # The latest email is where a winner is contacted.
        participant.email = payload.email
    db.commit()

    token, expires_in = create_participant_token(participant_id=participant.id)
    return CampaignSession(token=token, expires_in=expires_in, phone=participant.phone, email=participant.email)


@router.get("/window", response_model=CampaignWindow)
def get_window():
    return CampaignWindow(state=campaign.window_state(campaign.now()))


@router.post("/moderate", response_model=TextVerdict)
def moderate(payload: TextCheck, _: CurrentParticipant):
    try:
        _approved_text(payload.text)
    except HTTPException as exc:
        if exc.detail["code"] == "TEXT_REJECTED":
            return TextVerdict(result="REJECTED")
        raise
    return TextVerdict(result="APPROVED")


@router.post("/entries", response_model=EntryOut, status_code=status.HTTP_201_CREATED)
def create_entry(payload: EntryCreate, db: DbSession, participant: CurrentParticipant, response: Response):
    at = campaign.now()
    state = campaign.window_state(at)
    if state != "OPEN":
        raise _error(status.HTTP_409_CONFLICT, "WINDOW_CLOSED", campaign.WINDOW_MESSAGE[state])

    def existing() -> CampaignEntry | None:
        return db.scalar(
            select(CampaignEntry).where(
                CampaignEntry.participant_id == participant.id,
                CampaignEntry.idempotency_key == payload.idempotency_key,
            )
        )

    # A retried submit returns the entry it already made, without re-moderating.
    found = existing()
    if found is not None:
        response.status_code = status.HTTP_200_OK
        return EntryOut(entry_id=found.id)

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
