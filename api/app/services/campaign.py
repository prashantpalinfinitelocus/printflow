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

#: The entry window (10:00 to 22:00 India time by default, PRD 2) comes from settings:
#: campaign_open_hour, campaign_close_hour and campaign_timezone.

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

def _hour_label(hour: int) -> str:
    """9 -> "9 AM", 22 -> "10 PM", 24 -> "12 AM"."""
    return f"{hour % 12 or 12} {'AM' if hour % 24 < 12 else 'PM'}"


def _zone_label() -> str:
    return "IST" if settings.campaign_timezone == "Asia/Kolkata" else settings.campaign_timezone


def closing_label() -> str:
    """When the entry window closes, e.g. "10 PM IST"."""
    return f"{_hour_label(settings.campaign_close_hour)} {_zone_label()}"


def window_message(state: str) -> str:
    """The PRD 5 copy for a window state, naming the configured hours."""
    opens, closes, zone = _hour_label(settings.campaign_open_hour), _hour_label(settings.campaign_close_hour), _zone_label()
    return {
        "OPEN": f"The style desk is open. Entries are accepted from {opens} to {closes} {zone}.",
        "BEFORE_OPEN": f"The next entry window opens at {opens} {zone}. Get your can look ready.",
        "CLOSED": f"Today’s entry window is closed. Come back at {opens} {zone} tomorrow.",
        "PAUSED": "Entries are currently unavailable. Please check the campaign terms for updates.",
    }[state]

#: Zero-width joiner and non-joiner: invisible, but Indic scripts need them to shape conjuncts.
_JOINERS = {"\u200c", "\u200d"}


def _hidden_mark(ch: str) -> bool:
    """Marks the category check would let in that print nothing or turn text into emoji:
    the enclosing keycap (tail of "1\ufe0f\u20e3") and the invisible variation selectors."""
    cp = ord(ch)
    return cp == 0x20E3 or 0xFE00 <= cp <= 0xFE0F or 0xE0100 <= cp <= 0xE01EF


def now() -> datetime:
    """The campaign clock. A function so tests can pin it."""
    return datetime.now(UTC)


def _printable(ch: str) -> bool:
    """Letters, combining marks, digits, spaces and punctuation; nothing invisible or pictographic."""
    if ch in _JOINERS:
        return True
    if _hidden_mark(ch):
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
    hour = at.astimezone(ZoneInfo(settings.campaign_timezone)).hour
    if hour < settings.campaign_open_hour:
        return "BEFORE_OPEN"
    if hour >= settings.campaign_close_hour:
        return "CLOSED"
    return "OPEN"


def campaign_day(at: datetime) -> date:
    """The India-time date an entry counts towards."""
    return at.astimezone(ZoneInfo(settings.campaign_timezone)).date()

