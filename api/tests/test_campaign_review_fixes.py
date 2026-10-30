"""Fixes from the code review: quota on vendor failure, failure-counter decay, entry-cap race, copy."""

from __future__ import annotations

import itertools
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta

import pytest

EMAIL = "aanya@example.com"
_numbers = itertools.count(9_300_000_000)


def fresh_phone() -> str:
    return str(next(_numbers))


def at(seconds: int = 0) -> datetime:
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


def send(client, phone):
    return client.post("/campaign/otp/send", json={"phone": phone, "email": EMAIL})


def verify(client, phone, code):
    return client.post("/campaign/otp/verify", json={"phone": phone, "email": EMAIL, "code": code})


# ---------------- a vendor outage must not cost the user their quota ----------------


def test_failed_sends_do_not_count_toward_the_limit(client, bypass, clock, monkeypatch):
    from app.config import settings
    from app.services import otp

    monkeypatch.setattr(settings, "campaign_infobip_enabled", True)
    monkeypatch.setattr(settings, "campaign_otp_bypass", False)

    class Failing:
        def send(self, phone, code):
            raise otp.OtpDeliveryError("down")

    class Working:
        def send(self, phone, code):
            pass

    phone = fresh_phone()
    monkeypatch.setattr(otp, "get_sender", lambda: Failing())
    for _ in range(7):
        assert send(client, phone).status_code == 503

    monkeypatch.setattr(otp, "get_sender", lambda: Working())
    assert send(client, phone).status_code == 200


# ---------------- wrong-code failures decay ----------------


def test_old_wrong_codes_stop_counting_after_the_verify_window(client, bypass, clock, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "campaign_otp_verify_window_seconds", 600)
    phone = fresh_phone()

    for i in range(4):
        clock.now = at(i)
        assert verify(client, phone, "000000").status_code == 400

    clock.now = at(4 + 601)
    assert verify(client, phone, "000000").status_code == 400  # the fifth, but the first was long ago

    clock.now = at(4 + 602)
    assert verify(client, phone, "123456").status_code == 200


def test_wrong_codes_inside_the_window_still_lock(client, bypass, clock):
    phone = fresh_phone()
    for i in range(4):
        clock.now = at(i * 60)
        assert verify(client, phone, "000000").status_code == 400
    clock.now = at(300)

    assert verify(client, phone, "000000").status_code == 429


# ---------------- copy follows the settings ----------------


def test_the_block_message_does_not_hard_code_the_duration(client, bypass, clock, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "campaign_otp_send_limit", 1)
    monkeypatch.setattr(settings, "campaign_otp_block_seconds", 600)
    phone = fresh_phone()
    send(client, phone)

    res = send(client, phone)

    assert res.status_code == 429
    assert "2 hours" not in res.json()["detail"]["message"]
    assert res.json()["detail"]["retry_after"] == 600


# ---------------- the entry cap holds under concurrency ----------------


def test_concurrent_entries_cannot_exceed_the_cap(client, bypass, clock, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "campaign_max_entries_per_participant", 2)
    phone = fresh_phone()
    res = verify(client, phone, "123456")
    headers = {"Authorization": f"Bearer {res.json()['token']}"}
    barrier = threading.Barrier(6)

    def submit(i):
        barrier.wait()
        return client.post(
            "/campaign/entries",
            json={"design_id": "DISCO_BALL", "text": "Aanya", "idempotency_key": f"race-{i}"},
            headers=headers,
        ).status_code

    with ThreadPoolExecutor(6) as pool:
        codes = sorted(pool.map(submit, range(6)))

    assert codes == [201, 201, 409, 409, 409, 409]
