"""Consumer Diet Coke campaign: login, text check, entry window and entries.

Unit tests drive the rules in `app.services.campaign` directly; the API tests
go through the routes to prove auth, idempotency and the fail-closed text gate.
The clock is pinned through `campaign.now` so the 10 AM–10 PM IST window is
deterministic whatever time the suite runs.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import jwt
import pytest

PHONE = "9876543210"
EMAIL = "aanya@example.com"


def ist(hh: int, mm: int = 0) -> datetime:
    """A moment on 30 Oct 2026 at hh:mm India time (UTC+05:30)."""
    return datetime(2026, 10, 30, hh, mm, tzinfo=UTC) - timedelta(hours=5, minutes=30)


@pytest.fixture
def clock(monkeypatch):
    """Pins the campaign clock; set `clock.now` to move it."""
    from app.services import campaign

    class Clock:
        now = ist(12)

    monkeypatch.setattr(campaign, "now", lambda: Clock.now)
    return Clock


@pytest.fixture
def otp_bypass(monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "campaign_otp_bypass", True)
    monkeypatch.setattr(settings, "campaign_otp_bypass_code", "123456")


def _login(client, phone: str = PHONE, email: str = EMAIL) -> dict:
    res = client.post("/campaign/otp/verify", json={"phone": phone, "email": email, "code": "123456"})
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['token']}"}


@pytest.fixture
def participant(client, otp_bypass) -> dict:
    return _login(client)


def _entry(**overrides) -> dict:
    return {"design_id": "DISCO_BALL", "text": "Aanya", "idempotency_key": "key-1", **overrides}


# ---------------- unit: text rules ----------------


@pytest.mark.parametrize("text", ["Aanya", "प्रिया", "क्\u200dष", "क्\u200cष", "Riya's bday!", "No. 1 Mom"])
def test_printable_text_passes(text):
    from app.services.campaign import validate_text

    assert validate_text(text) is None


@pytest.mark.parametrize(
    "text",
    [
        "",
        "   ",
        "a" * 13,
        "Hi 🎉",
        "India 🇮🇳",
        "No 1\ufe0f\u20e3",
        "stu\u200bpid",
        "\u202eAanya",
        "Aa\u2028nya",
        "Coke™",
        "stu\ufe0fpid",
        "stu\U000e0100pid",
    ],
)
def test_unprintable_or_unsafe_text_is_refused(text):
    from app.services.campaign import validate_text

    assert validate_text(text)


def test_length_is_measured_after_trimming():
    from app.services.campaign import validate_text

    assert validate_text("  " + "a" * 12 + "  ") is None


# ---------------- unit: entry window ----------------


@pytest.mark.parametrize(
    ("hh", "mm", "state"),
    [(9, 59, "BEFORE_OPEN"), (10, 0, "OPEN"), (21, 59, "OPEN"), (22, 0, "CLOSED"), (23, 30, "CLOSED")],
)
def test_window_follows_india_time(hh, mm, state):
    from app.services.campaign import window_state

    assert window_state(ist(hh, mm)) == state


def test_a_paused_campaign_takes_no_entries(monkeypatch):
    from app.config import settings
    from app.services.campaign import window_state

    monkeypatch.setattr(settings, "campaign_paused", True)
    assert window_state(ist(12)) == "PAUSED"


def test_campaign_day_is_the_india_date():
    from app.services.campaign import campaign_day

    # 19:00 UTC on the 30th is already 00:30 on the 31st in India.
    assert campaign_day(datetime(2026, 10, 30, 19, 0, tzinfo=UTC)).isoformat() == "2026-10-31"


# ---------------- API: OTP ----------------


def test_send_otp_tells_the_client_when_it_may_resend(client, otp_bypass):
    res = client.post("/campaign/otp/send", json={"phone": PHONE, "email": EMAIL})
    assert res.status_code == 200, res.text
    assert res.json() == {"resend_after": 30}


@pytest.mark.parametrize(
    "payload",
    [
        {"phone": "1234567890", "email": EMAIL},
        {"phone": "98765", "email": EMAIL},
        {"phone": PHONE, "email": "not-an-email"},
    ],
)
def test_send_otp_rejects_bad_details(client, otp_bypass, payload):
    assert client.post("/campaign/otp/send", json=payload).status_code == 422


def test_without_an_sms_provider_or_bypass_login_is_unavailable(client, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "campaign_otp_bypass", False)
    res = client.post("/campaign/otp/send", json={"phone": PHONE, "email": EMAIL})
    assert res.status_code == 503
    assert res.json()["detail"]["code"] == "OTP_UNAVAILABLE"


def test_verify_with_the_bypass_code_returns_a_session(client, otp_bypass):
    res = client.post("/campaign/otp/verify", json={"phone": PHONE, "email": " Aanya@Example.com ", "code": "123456"})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["phone"] == PHONE
    assert body["email"] == "aanya@example.com"
    assert body["token"]
    # The web app sets its session cookie to expire with the token.
    assert body["expires_in"] == 24 * 60 * 60


def test_verify_with_a_wrong_code_is_refused(client, otp_bypass):
    res = client.post("/campaign/otp/verify", json={"phone": PHONE, "email": EMAIL, "code": "000000"})
    assert res.status_code == 400
    assert res.json()["detail"]["code"] == "OTP_WRONG"


def test_logging_in_again_reuses_the_participant_and_updates_the_email(client, otp_bypass):
    from sqlalchemy import select

    from app.db import SessionLocal
    from app.models import CampaignParticipant

    _login(client, phone="9000000001", email="first@example.com")
    _login(client, phone="9000000001", email="second@example.com")

    with SessionLocal() as db:
        rows = db.scalars(select(CampaignParticipant).where(CampaignParticipant.phone == "9000000001")).all()
    assert [r.email for r in rows] == ["second@example.com"]


def test_a_first_login_racing_another_for_the_same_phone_succeeds(client, otp_bypass):
    """A double tap or two tabs: another request inserts the phone just before this one does."""
    from sqlalchemy import event, select, text

    from app.db import SessionLocal, engine
    from app.models import CampaignParticipant

    phone = "9000000099"
    raced = False

    def competing_insert(conn, cursor, statement, parameters, context, executemany):
        nonlocal raced
        if raced or not statement.lstrip().upper().startswith("INSERT INTO CAMPAIGN_PARTICIPANTS"):
            return
        raced = True
        with engine.connect() as other:
            other.execute(
                text("INSERT INTO campaign_participants (phone, email) VALUES (:p, 'other@example.com')"),
                {"p": phone},
            )
            other.commit()

    event.listen(engine, "before_cursor_execute", competing_insert)
    try:
        res = client.post("/campaign/otp/verify", json={"phone": phone, "email": "race@example.com", "code": "123456"})
    finally:
        event.remove(engine, "before_cursor_execute", competing_insert)

    assert raced
    assert res.status_code == 200, res.text
    with SessionLocal() as db:
        rows = db.scalars(select(CampaignParticipant).where(CampaignParticipant.phone == phone)).all()
    assert [r.email for r in rows] == ["race@example.com"]


# ---------------- API: tokens stay in their lane ----------------


def test_a_participant_token_cannot_reach_staff_routes(client, participant):
    assert client.get("/stores", headers=participant).status_code == 401


def test_a_staff_token_cannot_act_as_a_participant(client, admin_headers, clock):
    assert client.post("/campaign/entries", json=_entry(), headers=admin_headers).status_code == 401


def test_an_expired_participant_token_is_refused(client, participant, clock):
    from app.config import settings

    token = jwt.encode(
        {"sub": "1", "aud": "campaign", "exp": int((datetime.now(UTC) - timedelta(minutes=1)).timestamp())},
        settings.jwt_secret,
        algorithm=settings.jwt_algorithm,
    )
    res = client.post("/campaign/entries", json=_entry(), headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 401
    assert res.json()["detail"]["code"] == "UNAUTHORIZED"


# ---------------- API: window ----------------


def test_window_is_public(client, clock):
    clock.now = ist(9, 0)
    res = client.get("/campaign/window")
    assert res.status_code == 200
    assert res.json() == {"state": "BEFORE_OPEN"}


# ---------------- API: text check ----------------


def test_moderate_needs_a_login(client):
    assert client.post("/campaign/moderate", json={"text": "Aanya"}).status_code == 401


def test_friendly_text_is_approved(client, participant, fake_gemini):
    res = client.post("/campaign/moderate", json={"text": "Aanya"}, headers=participant)
    assert res.status_code == 200, res.text
    assert res.json() == {"result": "APPROVED"}
    # The verdict came from the model (CLEAR), not from moderation being switched off.
    assert fake_gemini.calls[-1]["texts"] == ["Aanya"]


def test_flagged_text_is_rejected(client, participant, fake_gemini):
    fake_gemini.flag["Pepsi rules"] = (["COMPETITOR_BRAND"], "Names a competitor")
    res = client.post("/campaign/moderate", json={"text": "Pepsi rules"}, headers=participant)
    assert res.json() == {"result": "REJECTED"}


def test_text_is_trimmed_before_it_is_checked(client, participant, fake_gemini):
    client.post("/campaign/moderate", json={"text": "  Aanya  "}, headers=participant)
    assert fake_gemini.calls[-1]["texts"] == ["Aanya"]


def test_an_unreachable_checker_fails_closed(client, participant, fake_gemini):
    fake_gemini.fail_on_call = {1}
    res = client.post("/campaign/moderate", json={"text": "Aanya"}, headers=participant)
    assert res.status_code == 503
    assert res.json()["detail"]["code"] == "MODERATION_UNAVAILABLE"


def test_unprintable_text_is_refused_before_the_model_is_called(client, participant, fake_gemini):
    res = client.post("/campaign/moderate", json={"text": "Hi 🎉"}, headers=participant)
    assert res.status_code == 422
    assert res.json()["detail"]["code"] == "TEXT_INVALID"
    assert fake_gemini.calls == []


# ---------------- API: entries ----------------


def test_an_entry_is_accepted_in_the_window_and_stored(client, participant, clock):
    from app.db import SessionLocal
    from app.models import CampaignEntry

    res = client.post("/campaign/entries", json=_entry(idempotency_key="store-1"), headers=participant)
    assert res.status_code == 201, res.text
    entry_id = res.json()["entry_id"]

    with SessionLocal() as db:
        entry = db.get(CampaignEntry, entry_id)
        assert (entry.design_id, entry.text, entry.campaign_day.isoformat()) == ("DISCO_BALL", "Aanya", "2026-10-30")
        assert entry.participant.phone == PHONE


def test_a_retried_submission_returns_the_same_entry(client, participant, clock):
    first = client.post("/campaign/entries", json=_entry(idempotency_key="retry-1"), headers=participant)
    retry = client.post("/campaign/entries", json=_entry(idempotency_key="retry-1"), headers=participant)
    assert first.status_code == 201
    assert retry.status_code == 200
    assert retry.json()["entry_id"] == first.json()["entry_id"]


def test_a_retry_is_not_moderated_again(client, participant, clock, fake_gemini):
    client.post("/campaign/entries", json=_entry(idempotency_key="replay-1"), headers=participant)
    calls = len(fake_gemini.calls)
    client.post("/campaign/entries", json=_entry(idempotency_key="replay-1"), headers=participant)
    assert len(fake_gemini.calls) == calls


def test_a_retry_after_10pm_still_returns_the_entry_it_made(client, participant, clock):
    clock.now = ist(21, 59)
    first = client.post("/campaign/entries", json=_entry(idempotency_key="boundary"), headers=participant)
    clock.now = ist(22, 1)
    retry = client.post("/campaign/entries", json=_entry(idempotency_key="boundary"), headers=participant)
    assert retry.status_code == 200, retry.text
    assert retry.json()["entry_id"] == first.json()["entry_id"]


def test_entries_are_unlimited_with_new_keys(client, participant, clock):
    a = client.post("/campaign/entries", json=_entry(idempotency_key="many-1"), headers=participant)
    b = client.post("/campaign/entries", json=_entry(idempotency_key="many-2"), headers=participant)
    assert a.json()["entry_id"] != b.json()["entry_id"]


def test_two_people_may_use_the_same_key(client, otp_bypass, clock):
    first = _login(client, phone="9000000011")
    second = _login(client, phone="9000000012")
    a = client.post("/campaign/entries", json=_entry(idempotency_key="shared"), headers=first)
    b = client.post("/campaign/entries", json=_entry(idempotency_key="shared"), headers=second)
    assert a.json()["entry_id"] != b.json()["entry_id"]


def test_entries_after_10pm_are_refused_with_the_window_message(client, participant, clock):
    clock.now = ist(22, 5)
    res = client.post("/campaign/entries", json=_entry(idempotency_key="late"), headers=participant)
    assert res.status_code == 409
    assert res.json()["detail"] == {
        "code": "WINDOW_CLOSED",
        "message": "Today’s entry window is closed. Come back at 10 AM IST tomorrow.",
    }


def test_an_unknown_design_is_refused(client, participant, clock):
    res = client.post("/campaign/entries", json=_entry(design_id="NOPE", idempotency_key="d"), headers=participant)
    assert res.status_code == 422


def test_entry_text_is_moderated_again_on_the_server(client, participant, clock, fake_gemini):
    fake_gemini.flag["Pepsi rules"] = (["COMPETITOR_BRAND"], "Names a competitor")
    res = client.post(
        "/campaign/entries", json=_entry(text="Pepsi rules", idempotency_key="sneaky"), headers=participant
    )
    assert res.status_code == 422
    assert res.json()["detail"]["code"] == "TEXT_REJECTED"


def test_an_entry_is_not_taken_while_the_checker_is_down(client, participant, clock, fake_gemini):
    fake_gemini.fail_on_call = {1}
    res = client.post("/campaign/entries", json=_entry(idempotency_key="down"), headers=participant)
    assert res.status_code == 503
    assert res.json()["detail"]["code"] == "MODERATION_UNAVAILABLE"
