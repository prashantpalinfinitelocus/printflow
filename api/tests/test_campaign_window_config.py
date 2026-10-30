"""The entry window is a deployment setting (PRD 15), not a constant."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest


def utc(hh: int, mm: int = 0) -> datetime:
    return datetime(2026, 10, 30, hh, mm, tzinfo=UTC)


def test_the_defaults_are_ten_to_ten_india_time():
    from app.services.campaign import window_state

    assert window_state(utc(4, 29)) == "BEFORE_OPEN"  # 09:59 IST
    assert window_state(utc(4, 30)) == "OPEN"  # 10:00 IST
    assert window_state(utc(16, 30)) == "CLOSED"  # 22:00 IST


def test_the_open_and_close_hours_can_be_changed(monkeypatch):
    from app.config import settings
    from app.services.campaign import window_state

    monkeypatch.setattr(settings, "campaign_open_hour", 0)
    monkeypatch.setattr(settings, "campaign_close_hour", 24)

    assert window_state(utc(21, 30)) == "OPEN"  # 03:00 IST the next day
    assert window_state(utc(18, 29)) == "OPEN"  # 23:59 IST


def test_the_timezone_can_be_changed(monkeypatch):
    from app.config import settings
    from app.services.campaign import window_state

    monkeypatch.setattr(settings, "campaign_timezone", "UTC")

    assert window_state(utc(9, 59)) == "BEFORE_OPEN"
    assert window_state(utc(10, 0)) == "OPEN"


def test_the_campaign_day_follows_the_configured_timezone(monkeypatch):
    from app.config import settings
    from app.services.campaign import campaign_day

    at = datetime(2026, 10, 30, 20, 0, tzinfo=UTC)  # 01:30 IST on the 31st
    assert campaign_day(at).isoformat() == "2026-10-31"

    monkeypatch.setattr(settings, "campaign_timezone", "UTC")
    assert campaign_day(at).isoformat() == "2026-10-30"


@pytest.mark.parametrize(("open_h", "close_h"), [(22, 10), (10, 10), (-1, 5), (0, 25)])
def test_an_impossible_window_is_refused_at_startup(open_h, close_h):
    from pydantic import ValidationError

    from app.config import Settings

    with pytest.raises(ValidationError):
        Settings(campaign_open_hour=open_h, campaign_close_hour=close_h)


def test_an_unknown_timezone_is_refused_at_startup():
    from pydantic import ValidationError

    from app.config import Settings

    with pytest.raises(ValidationError):
        Settings(campaign_timezone="Mars/Olympus")


def test_the_window_message_names_the_configured_hours(monkeypatch):
    from app.config import settings
    from app.services.campaign import window_message

    monkeypatch.setattr(settings, "campaign_open_hour", 9)
    monkeypatch.setattr(settings, "campaign_close_hour", 21)

    assert "9 AM to 9 PM" in window_message("OPEN")
    assert "9 AM" in window_message("BEFORE_OPEN")
