"""Rules for the consumer Diet Coke campaign (see the PRD in Confluence).

The web app checks the same text rules before calling the API, but this is the
authority: the server re-checks and re-moderates every entry, because anything
the browser sends can be edited.
"""

from __future__ import annotations

import unicodedata
from datetime import UTC, date, datetime
from zoneinfo import ZoneInfo

from ..config import settings

IST = ZoneInfo("Asia/Kolkata")

#: Entries are accepted from 10:00 to 22:00 India time (PRD 2).
OPEN_HOUR = 10
CLOSE_HOUR = 22

#: Must match the web app's sticker list (web/lib/campaign/designs.ts).
DESIGN_IDS = frozenset(
    {
        "ARCTIC_FRIENDS",
        "CLINKING_BOTTLES",
        "RED_RIBBON",
        "POLAR_BEARS_HEART",
        "HAPPY_BIRTHDAY",
        "SURFING_POLAR_BEAR",
        "POLAR_BEAR_CHILL",
        "BEACH_VIBES",
        "DISCO_BALL",
    }
)

#: Fits the can's print area at the You2013 size the design uses.
MAX_TEXT_LENGTH = 12

WINDOW_MESSAGE = {
    "OPEN": "The style desk is open. Entries are accepted from 10 AM to 10 PM IST.",
    "BEFORE_OPEN": "The next entry window opens at 10 AM IST. Get your can look ready.",
    "CLOSED": "Today’s entry window is closed. Come back at 10 AM IST tomorrow.",
    "PAUSED": "Entries are currently unavailable. Please check the campaign terms for updates.",
}

#: Zero-width joiner and non-joiner: invisible, but Indic scripts need them to shape conjuncts.
_JOINERS = {"‌", "‍"}
#: Combining enclosing keycap, the tail of "1️⃣"; a mark, so the category check would let it in.
_KEYCAP = "⃣"


def now() -> datetime:
    """The campaign clock. A function so tests can pin it."""
    return datetime.now(UTC)


def _printable(ch: str) -> bool:
    """Letters, combining marks, digits, spaces and punctuation; nothing invisible or pictographic."""
    if ch in _JOINERS:
        return True
    if ch == _KEYCAP:
        return False
    category = unicodedata.category(ch)
    return category[0] in "LMNP" or category == "Zs"


def validate_text(raw: str) -> str | None:
    """Why the text can't be printed, or None if it can.

    An allowlist, so a zero-width space or a direction override can't hide a word
    from moderation. Length counts code points, as the web app does.
    """
    text = raw.strip()
    if not text:
        return "Add a name or a short message first."
    if len(text) > MAX_TEXT_LENGTH:
        return f"Keep it to {MAX_TEXT_LENGTH} characters."
    if not all(_printable(ch) for ch in text):
        return "That text has characters we can't print."
    return None


def window_state(at: datetime) -> str:
    if settings.campaign_paused:
        return "PAUSED"
    hour = at.astimezone(IST).hour
    if hour < OPEN_HOUR:
        return "BEFORE_OPEN"
    if hour >= CLOSE_HOUR:
        return "CLOSED"
    return "OPEN"


def campaign_day(at: datetime) -> date:
    """The India-time date an entry counts towards."""
    return at.astimezone(IST).date()


def otp_matches(code: str) -> bool:
    """Until an SMS provider is wired in, the bypass code is the only valid OTP."""
    return settings.campaign_otp_bypass and bool(settings.campaign_otp_bypass_code) and (
        code == settings.campaign_otp_bypass_code
    )
