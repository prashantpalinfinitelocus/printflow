"""Campaign OTP: rate limiting, hashed one-time codes, the Infobip flag, session-token checks.

Every phone number used here is unique to its test, because the suite shares one
database and a block on a number would otherwise leak into the next test.
"""

from __future__ import annotations

import itertools
from datetime import UTC, datetime, timedelta

import httpx
import jwt
import pytest

EMAIL = "aanya@example.com"
_numbers = itertools.count(9_100_000_000)


def fresh_phone() -> str:
    return str(next(_numbers))


def at(seconds: int = 0) -> datetime:
    """A moment inside the entry window (30 Oct 2026, 12:00 IST) plus `seconds`."""
    return datetime(2026, 10, 30, 6, 30, tzinfo=UTC) + timedelta(seconds=seconds)


@pytest.fixture
def clock(monkeypatch):
    from app.services import campaign

    class Clock:
        now = at()

    monkeypatch.setattr(campaign, "now", lambda: Clock.now)
    return Clock


@pytest.fixture
def bypass(monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "campaign_otp_bypass", True)
    monkeypatch.setattr(settings, "campaign_otp_bypass_code", "123456")


class RecordingSender:
    """Stands in for the SMS vendor; keeps what would have been texted."""

    def __init__(self):
        self.sent: list[tuple[str, str]] = []

    def send(self, phone: str, code: str) -> None:
        self.sent.append((phone, code))

    @property
    def last_code(self) -> str:
        return self.sent[-1][1]


@pytest.fixture
def sender(monkeypatch, bypass):
    """Real OTP mode: the Infobip flag is on and the vendor is replaced by a recorder."""
    from app.config import settings
    from app.services import otp

    recorder = RecordingSender()
    monkeypatch.setattr(settings, "campaign_infobip_enabled", True)
    monkeypatch.setattr(settings, "campaign_otp_bypass", False)
    monkeypatch.setattr(otp, "get_sender", lambda: recorder)
    return recorder


def send(client, phone):
    return client.post("/campaign/otp/send", json={"phone": phone, "email": EMAIL})


def verify(client, phone, code):
    return client.post("/campaign/otp/verify", json={"phone": phone, "email": EMAIL, "code": code})


# ---------------- send rate limit ----------------


def test_five_sends_in_five_minutes_are_allowed_and_the_sixth_blocks_for_two_hours(client, bypass, clock):
    phone = fresh_phone()
    for i in range(5):
        clock.now = at(i * 10)
        assert send(client, phone).status_code == 200

    clock.now = at(50)
    res = send(client, phone)

    assert res.status_code == 429
    detail = res.json()["detail"]
    assert detail["code"] == "OTP_BLOCKED"
    assert detail["retry_after"] == 7200
    assert res.headers["retry-after"] == "7200"


def test_the_block_holds_for_two_hours_then_lifts(client, bypass, clock):
    phone = fresh_phone()
    for i in range(6):
        clock.now = at(i)
        send(client, phone)

    clock.now = at(5 + 7199)
    assert send(client, phone).status_code == 429

    clock.now = at(5 + 7201)
    assert send(client, phone).status_code == 200


def test_sends_spread_over_more_than_the_window_are_not_blocked(client, bypass, clock):
    phone = fresh_phone()
    for i in range(5):
        clock.now = at(i)
        assert send(client, phone).status_code == 200
    for i in range(5):
        clock.now = at(400 + i)
        assert send(client, phone).status_code == 200


def test_a_block_on_one_phone_does_not_touch_another(client, bypass, clock):
    blocked, other = fresh_phone(), fresh_phone()
    for _ in range(6):
        send(client, blocked)

    assert send(client, blocked).status_code == 429
    assert send(client, other).status_code == 200


def test_a_blocked_phone_cannot_verify_even_with_the_right_code(client, bypass, clock):
    phone = fresh_phone()
    for _ in range(6):
        send(client, phone)

    res = verify(client, phone, "123456")

    assert res.status_code == 429
    assert res.json()["detail"]["code"] == "OTP_BLOCKED"


def test_the_limits_are_configurable(client, bypass, clock, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "campaign_otp_send_limit", 2)
    monkeypatch.setattr(settings, "campaign_otp_block_seconds", 60)
    phone = fresh_phone()

    assert send(client, phone).status_code == 200
    assert send(client, phone).status_code == 200
    res = send(client, phone)

    assert res.status_code == 429
    assert res.json()["detail"]["retry_after"] == 60


# ---------------- real OTPs (Infobip flag on) ----------------


def test_a_real_otp_is_texted_and_logs_in_once(client, sender, clock):
    phone = fresh_phone()
    assert send(client, phone).status_code == 200
    (sent_to, code) = sender.sent[0]
    assert sent_to == phone
    assert len(code) == 6 and code.isdigit()

    first = verify(client, phone, code)
    again = verify(client, phone, code)

    assert first.status_code == 200
    assert again.status_code in (400, 429)


def test_the_otp_is_stored_hashed(client, sender, clock):
    from app.db import SessionLocal
    from app.models import CampaignOtp

    phone = fresh_phone()
    send(client, phone)
    code = sender.last_code

    with SessionLocal() as db:
        row = db.query(CampaignOtp).filter_by(phone=phone).one()
    assert row.code_hash and code not in row.code_hash


def test_an_otp_expires_after_its_ttl(client, sender, clock):
    phone = fresh_phone()
    send(client, phone)
    code = sender.last_code

    clock.now = at(301)
    res = verify(client, phone, code)

    assert res.status_code == 400
    assert res.json()["detail"]["code"] == "OTP_EXPIRED"


def test_a_new_otp_replaces_the_old_one(client, sender, clock):
    phone = fresh_phone()
    send(client, phone)
    old = sender.last_code
    clock.now = at(31)
    send(client, phone)
    new = sender.last_code

    assert verify(client, phone, old).status_code == 400 if old != new else True
    assert verify(client, phone, new).status_code == 200


def test_five_wrong_codes_lock_verification(client, sender, clock):
    phone = fresh_phone()
    send(client, phone)
    good = sender.last_code
    wrong = "000000" if good != "000000" else "111111"

    for _ in range(4):
        assert verify(client, phone, wrong).status_code == 400
    locked = verify(client, phone, wrong)
    after = verify(client, phone, good)

    assert locked.status_code == 429
    assert locked.json()["detail"]["code"] == "OTP_LOCKED"
    assert after.status_code == 429


def test_a_wrong_code_does_not_consume_a_good_one(client, sender, clock):
    phone = fresh_phone()
    send(client, phone)
    good = sender.last_code
    wrong = "000000" if good != "000000" else "111111"

    assert verify(client, phone, wrong).status_code == 400
    assert verify(client, phone, good).status_code == 200


def test_the_bypass_code_still_works_alongside_real_otps_when_enabled(client, sender, clock, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "campaign_otp_bypass", True)
    monkeypatch.setattr(settings, "campaign_otp_bypass_code", "123456")
    phone = fresh_phone()

    assert verify(client, phone, "123456").status_code == 200


# ---------------- the Infobip flag ----------------


def test_with_the_flag_off_nothing_is_texted(client, bypass, clock, monkeypatch):
    from app.config import settings
    from app.services import otp

    assert settings.campaign_infobip_enabled is False

    def boom():
        raise AssertionError("no SMS sender may be built while the flag is off")

    monkeypatch.setattr(otp, "_build_infobip_sender", boom)

    assert send(client, fresh_phone()).status_code == 200


def test_with_the_flag_on_but_unconfigured_login_is_unavailable(client, bypass, clock, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "campaign_infobip_enabled", True)
    monkeypatch.setattr(settings, "campaign_infobip_api_key", "")

    res = send(client, fresh_phone())

    assert res.status_code == 503
    assert res.json()["detail"]["code"] == "OTP_UNAVAILABLE"


def test_when_the_vendor_fails_the_user_is_told_to_retry(client, sender, clock, monkeypatch):
    from app.services import otp

    class Failing:
        def send(self, phone, code):
            raise otp.OtpDeliveryError("down")

    monkeypatch.setattr(otp, "get_sender", lambda: Failing())

    res = send(client, fresh_phone())

    assert res.status_code == 503
    assert res.json()["detail"]["code"] == "OTP_SEND_FAILED"


def test_infobip_sender_posts_the_dlt_template(monkeypatch):
    from app.config import settings
    from app.services.otp import InfobipOtpSender

    monkeypatch.setattr(settings, "campaign_infobip_base_url", "https://example.api.infobip.com")
    monkeypatch.setattr(settings, "campaign_infobip_api_key", "k3y")
    monkeypatch.setattr(settings, "campaign_infobip_sender_id", "DIETCK")
    monkeypatch.setattr(settings, "campaign_infobip_dlt_entity_id", "ENTITY1")
    monkeypatch.setattr(settings, "campaign_infobip_dlt_template_id", "TEMPLATE1")
    monkeypatch.setattr(settings, "campaign_infobip_message", "Your code is {otp}. Do not share it.")
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["auth"] = request.headers["authorization"]
        seen["json"] = request.read().decode()
        return httpx.Response(200, json={"messages": [{"messageId": "m1"}]})

    InfobipOtpSender(httpx.Client(transport=httpx.MockTransport(handler))).send("9876543210", "424242")

    assert seen["url"] == "https://example.api.infobip.com/sms/3/messages"
    assert seen["auth"] == "App k3y"
    body = seen["json"]
    assert '"to":"919876543210"' in body.replace(" ", "")
    assert "Your code is 424242. Do not share it." in body
    assert "ENTITY1" in body and "TEMPLATE1" in body and "DIETCK" in body


def test_infobip_sender_raises_on_vendor_errors(monkeypatch):
    from app.config import settings
    from app.services.otp import InfobipOtpSender, OtpDeliveryError

    monkeypatch.setattr(settings, "campaign_infobip_base_url", "https://example.api.infobip.com")
    monkeypatch.setattr(settings, "campaign_infobip_api_key", "k3y")
    client = httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(400, text="bad template")))

    with pytest.raises(OtpDeliveryError):
        InfobipOtpSender(client).send("9876543210", "424242")


def test_the_default_dlt_ids_are_blank_so_none_can_leak_from_another_brand():
    from app.config import Settings

    fields = Settings.model_fields
    assert fields["campaign_infobip_dlt_entity_id"].default == ""
    assert fields["campaign_infobip_dlt_template_id"].default == ""
    assert fields["campaign_infobip_enabled"].default is False


# ---------------- session token checks ----------------


def login(client, phone):
    res = verify(client, phone, "123456")
    assert res.status_code == 200, res.text
    return res.json()["token"]


def bearer(token):
    return {"Authorization": f"Bearer {token}"}


def test_the_session_token_carries_issuer_and_unique_id(client, bypass):
    claims = jwt.decode(login(client, fresh_phone()), options={"verify_signature": False})

    assert claims["iss"] == "printflow-campaign"
    assert claims["aud"] == "campaign"
    assert claims["jti"]


def test_each_login_gets_a_different_token_id(client, bypass):
    phone = fresh_phone()
    a = jwt.decode(login(client, phone), options={"verify_signature": False})
    b = jwt.decode(login(client, phone), options={"verify_signature": False})

    assert a["jti"] != b["jti"]


def test_logout_revokes_earlier_tokens(client, bypass, clock):
    token = login(client, fresh_phone())
    assert client.post("/campaign/moderate", json={"text": "Aanya"}, headers=bearer(token)).status_code != 401

    assert client.post("/campaign/logout", headers=bearer(token)).status_code == 204
    res = client.post("/campaign/moderate", json={"text": "Aanya"}, headers=bearer(token))

    assert res.status_code == 401
    assert res.json()["detail"]["code"] == "UNAUTHORIZED"


def _forged(**overrides):
    from app.config import settings

    now = datetime.now(UTC)
    claims = {
        "sub": "1",
        "aud": "campaign",
        "iss": "printflow-campaign",
        "jti": "abc",
        "ver": 0,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(hours=1)).timestamp()),
    }
    claims.update(overrides)
    return jwt.encode({k: v for k, v in claims.items() if v is not None}, settings.jwt_secret, algorithm="HS256")


@pytest.mark.parametrize("missing", ["jti", "iss", "ver", "iat", "exp", "sub"])
def test_a_token_missing_a_required_claim_is_refused(client, bypass, missing):
    res = client.post("/campaign/moderate", json={"text": "Aanya"}, headers=bearer(_forged(**{missing: None})))

    assert res.status_code == 401


def test_a_token_from_another_issuer_is_refused(client, bypass):
    res = client.post("/campaign/moderate", json={"text": "Aanya"}, headers=bearer(_forged(iss="someone-else")))

    assert res.status_code == 401


def test_a_token_issued_in_the_future_is_refused(client, bypass):
    future = int((datetime.now(UTC) + timedelta(hours=2)).timestamp())

    res = client.post("/campaign/moderate", json={"text": "Aanya"}, headers=bearer(_forged(iat=future)))

    assert res.status_code == 401


def test_a_token_signed_with_none_is_refused(client, bypass):
    token = jwt.encode({"sub": "1", "aud": "campaign"}, key=None, algorithm="none")

    assert client.post("/campaign/moderate", json={"text": "x"}, headers=bearer(token)).status_code == 401


# ---------------- per-participant entry cap ----------------


def test_entries_stop_at_the_configured_cap(client, bypass, clock, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "campaign_max_entries_per_participant", 2)
    headers = bearer(login(client, fresh_phone()))

    def enter(key):
        return client.post(
            "/campaign/entries",
            json={"design_id": "DISCO_BALL", "text": "Aanya", "idempotency_key": key},
            headers=headers,
        )

    assert enter("k1").status_code == 201
    assert enter("k2").status_code == 201
    res = enter("k3")

    assert res.status_code == 409
    assert res.json()["detail"]["code"] == "ENTRY_LIMIT_REACHED"
    # A retry of an accepted entry is not a new entry, so it still answers.
    assert enter("k1").status_code == 200


# ---------------- input shape ----------------


@pytest.mark.parametrize("phone", ["9\u0966\u0966\u0966\u0966\u0966\u0966\u0966\u0966\u0966", "\u0669876543210"])
def test_a_phone_with_non_ascii_digits_is_rejected(client, bypass, phone):
    res = client.post("/campaign/otp/send", json={"phone": phone, "email": EMAIL})

    assert res.status_code == 422


def test_a_code_with_non_ascii_digits_is_rejected(client, bypass):
    res = client.post("/campaign/otp/verify", json={"phone": fresh_phone(), "email": EMAIL, "code": "\u0661\u0662\u0663\u0664\u0665\u0666"})

    assert res.status_code == 422


def test_infobip_sender_texts_the_diet_coke_template_like_thums_up(monkeypatch):
    """Same request shape as thums-up-be's SendOTP, on the Diet Coke DLT template."""
    import json

    from app.config import settings
    from app.services.otp import InfobipOtpSender

    monkeypatch.setattr(settings, "campaign_infobip_base_url", "https://example.api.infobip.com/")
    monkeypatch.setattr(settings, "campaign_infobip_api_key", "k3y")
    monkeypatch.setattr(settings, "campaign_infobip_sender_id", "COKEBY")
    monkeypatch.setattr(settings, "campaign_infobip_dlt_entity_id", "1101393580000056521")
    monkeypatch.setattr(settings, "campaign_infobip_dlt_template_id", "1177179363488364821")
    monkeypatch.setattr(
        settings,
        "campaign_infobip_message",
        "Your One Time Password for Diet Coke - Make It Yours is {otp}. Please do not share it with anyone.",
    )
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["body"] = json.loads(request.read())
        return httpx.Response(200, json={"messages": [{"messageId": "m1"}]})

    InfobipOtpSender(httpx.Client(transport=httpx.MockTransport(handler))).send("9876543210", "123456")

    assert seen["url"] == "https://example.api.infobip.com/sms/3/messages"
    assert seen["body"] == {
        "messages": [
            {
                "sender": "COKEBY",
                "destinations": [{"to": "919876543210"}],
                "content": {
                    "text": "Your One Time Password for Diet Coke - Make It Yours is 123456. "
                    "Please do not share it with anyone."
                },
                "options": {
                    "regional": {
                        "indiaDlt": {
                            "principalEntityId": "1101393580000056521",
                            "contentTemplateId": "1177179363488364821",
                        }
                    }
                },
            }
        ]
    }
