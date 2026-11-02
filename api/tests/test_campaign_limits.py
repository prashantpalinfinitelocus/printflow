"""Speed and anti-abuse limits on the consumer campaign API.

- Speed: one Gemini client is reused, and an approved text is remembered for a while, so
  Make It Happen does not send the same text to Gemini twice.
- A phone may enter at most `campaign_max_entries_per_day` times a campaign day (5).
- A signed-in phone is throttled on text checks and entries, so a script cannot hammer
  the API (per network address limits are at the load balancer: infra/cloud-armor.sh).
"""

from __future__ import annotations

import itertools
from datetime import UTC, datetime, timedelta

import pytest

_phones = itertools.count(9700000000)


def ist(hh: int, mm: int = 0, day: int = 30) -> datetime:
    return datetime(2026, 10, day, hh, mm, tzinfo=UTC) - timedelta(hours=5, minutes=30)


@pytest.fixture
def clock(monkeypatch):
    from app.services import campaign

    class Clock:
        now = ist(12)

    monkeypatch.setattr(campaign, "now", lambda: Clock.now)
    return Clock


@pytest.fixture
def signed_in(client, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "campaign_otp_bypass", True)
    monkeypatch.setattr(settings, "campaign_otp_bypass_code", "123456")
    phone = str(next(_phones))
    res = client.post("/campaign/otp/verify", json={"phone": phone, "email": f"{phone}@example.com", "code": "123456"})
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['token']}"}


def _enter(client, headers, n: int, text: str = "Aanya"):
    return client.post(
        "/campaign/entries",
        json={"design_id": "DISCO_BALL", "text": text, "idempotency_key": f"key-{n}"},
        headers=headers,
    )


# ---------------- speed ----------------


def test_the_gemini_client_is_made_once_and_reused(client, signed_in, fake_gemini, monkeypatch):
    from app.services import moderation

    made = []
    monkeypatch.setattr(moderation, "_make_client", lambda: made.append(1) or fake_gemini)

    for text in ("Aanya", "Riya", "Kabir"):
        client.post("/campaign/moderate", json={"text": text}, headers=signed_in)

    assert len(made) == 1


def test_an_approved_text_is_not_sent_to_gemini_again_on_entry(client, signed_in, fake_gemini, clock):
    assert client.post("/campaign/moderate", json={"text": "Aanya"}, headers=signed_in).json()["result"] == "APPROVED"
    calls = len(fake_gemini.calls)

    assert _enter(client, signed_in, 1).status_code == 201
    assert len(fake_gemini.calls) == calls


def test_a_rejected_text_is_checked_again_every_time(client, signed_in, fake_gemini):
    fake_gemini.flag["Badword"] = (["ABUSE_PROFANITY"], "rude")
    for _ in range(2):
        assert client.post("/campaign/moderate", json={"text": "Badword"}, headers=signed_in).json()["result"] == "REJECTED"
    assert len(fake_gemini.calls) == 2


def test_a_remembered_approval_expires(client, signed_in, fake_gemini, monkeypatch):
    from app.config import settings
    from app.routers import campaign as campaign_router

    client.post("/campaign/moderate", json={"text": "Aanya"}, headers=signed_in)
    monkeypatch.setattr(settings, "campaign_approved_text_ttl_seconds", 0)
    campaign_router.APPROVED_TEXTS.forget_expired()
    client.post("/campaign/moderate", json={"text": "Aanya"}, headers=signed_in)

    assert len(fake_gemini.calls) == 2


# ---------------- 5 entries a day ----------------


def test_a_phone_can_enter_five_times_a_day(client, signed_in, clock):
    for n in range(5):
        assert _enter(client, signed_in, n).status_code == 201

    res = _enter(client, signed_in, 5)
    assert res.status_code == 409
    assert res.json()["detail"]["code"] == "ENTRY_LIMIT_REACHED"
    assert "5 entries today" in res.json()["detail"]["message"]


def test_the_daily_count_starts_again_the_next_day(client, signed_in, clock):
    for n in range(5):
        _enter(client, signed_in, n)
    clock.now = ist(12, day=31)
    assert _enter(client, signed_in, 5).status_code == 201


def test_a_retried_fifth_entry_is_not_counted_as_a_sixth(client, signed_in, clock):
    for n in range(5):
        _enter(client, signed_in, n)
    res = _enter(client, signed_in, 4)
    assert res.status_code == 200


# ---------------- throttling a signed-in phone ----------------


def test_too_many_text_checks_in_a_minute_are_refused(client, signed_in, clock, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "campaign_moderate_per_minute", 3)
    for n in range(3):
        assert client.post("/campaign/moderate", json={"text": f"Name{n}"}, headers=signed_in).status_code == 200

    res = client.post("/campaign/moderate", json={"text": "Name9"}, headers=signed_in)
    assert res.status_code == 429
    assert res.json()["detail"]["code"] == "RATE_LIMITED"
    assert int(res.headers["Retry-After"]) > 0

    clock.now += timedelta(minutes=1)
    assert client.post("/campaign/moderate", json={"text": "Name9"}, headers=signed_in).status_code == 200


def test_too_many_entries_in_a_minute_are_refused(client, signed_in, clock, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "campaign_entries_per_minute", 2)
    assert _enter(client, signed_in, 1).status_code == 201
    assert _enter(client, signed_in, 2).status_code == 201
    assert _enter(client, signed_in, 3).status_code == 429


def test_one_phones_limit_does_not_slow_another(client, signed_in, clock, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "campaign_moderate_per_minute", 1)
    client.post("/campaign/moderate", json={"text": "Aanya"}, headers=signed_in)
    assert client.post("/campaign/moderate", json={"text": "Aanya"}, headers=signed_in).status_code == 429

    phone = str(next(_phones))
    other = client.post("/campaign/otp/verify", json={"phone": phone, "email": "o@example.com", "code": "123456"}).json()
    assert client.post("/campaign/moderate", json={"text": "Aanya"}, headers={"Authorization": f"Bearer {other['token']}"}).status_code == 200


# ---------------- admin: no future days ----------------


def test_the_admin_cannot_open_a_future_day(client, ca_headers, clock):
    tomorrow = (clock.now + timedelta(days=1)).date()
    res = client.get(f"/campaign-admin/days/{tomorrow}", headers=ca_headers)
    assert res.status_code == 422
    assert "future" in res.json()["detail"]
    assert client.get("/campaign-admin/days/2026-10-30", headers=ca_headers).status_code == 200
