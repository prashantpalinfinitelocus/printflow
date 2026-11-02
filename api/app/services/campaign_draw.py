"""The daily lucky draw (PRD 11).

After a day's entry window closes, up to `campaign_daily_winners` entries are
drawn from that day's entries. Every entry is one ticket, so more entries mean
more chances (PRD 20: "multiple entries increases chance of winning"); a phone
still wins at most once a day, and not at all once it has
`campaign_monthly_win_limit` wins in the calendar month.

A day is drawn once. Running it again, from the admin page or the scheduled
job, returns the recorded draw, so a retry never changes who won.
"""

from __future__ import annotations

import random
import secrets
from collections.abc import Sequence
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..config import settings
from ..models import CampaignDraw, CampaignEntry, CampaignWinner
from . import campaign


#: Advisory-lock namespace for draws; the month (YYYYMM) is added to it.
_MONTH_LOCK = 7_317_000_000


class DrawNotReady(Exception):
    """The day's entry window has not closed yet."""


def closes_at(day: date) -> datetime:
    """When `day`'s entry window closes; its draw may run from then."""
    zone = ZoneInfo(settings.campaign_timezone)
    midnight = datetime.combine(day, time(0), tzinfo=zone)
    return midnight + timedelta(hours=settings.campaign_close_hour)


def can_draw(day: date) -> bool:
    return campaign.now() >= closes_at(day) + timedelta(minutes=settings.campaign_draw_grace_minutes)


def pick_winners(
    entries: Sequence[CampaignEntry], excluded: set[int], rng: random.Random
) -> list[CampaignEntry]:
    """Draws entries in a random order, skipping a phone already picked or excluded."""
    tickets = list(entries)
    rng.shuffle(tickets)
    picked: list[CampaignEntry] = []
    taken = set(excluded)
    for entry in tickets:
        if len(picked) >= settings.campaign_daily_winners:
            break
        if entry.participant_id in taken:
            continue
        taken.add(entry.participant_id)
        picked.append(entry)
    return picked


def _month(day: date) -> tuple[date, date]:
    first = day.replace(day=1)
    return first, (first + timedelta(days=32)).replace(day=1)


def _at_monthly_limit(db: Session, day: date) -> set[int]:
    """Phones that already have the monthly limit of wins on other days of `day`'s month.

    Every other day counts, not only earlier ones: a missed night drawn later must
    still see the wins from the days after it.
    """
    first, next_first = _month(day)
    rows = db.execute(
        select(CampaignWinner.participant_id)
        .where(
            CampaignWinner.campaign_day >= first,
            CampaignWinner.campaign_day < next_first,
            CampaignWinner.campaign_day != day,
        )
        .group_by(CampaignWinner.participant_id)
        .having(func.count() >= settings.campaign_monthly_win_limit)
    )
    return {participant_id for (participant_id,) in rows}


def run_draw(
    db: Session, day: date, *, rng: random.Random | None = None, run_by_id: int | None = None
) -> CampaignDraw:
    existing = db.get(CampaignDraw, day)
    if existing is not None:
        return existing
    if not can_draw(day):
        raise DrawNotReady(f"{day} can be drawn once its entry window closes at {campaign.closing_label()}.")

    # One draw per month at a time: two days of a month drawn together would each miss the
    # other's winners when counting the monthly limit. The lock ends with this transaction.
    db.execute(select(func.pg_advisory_xact_lock(_MONTH_LOCK + day.year * 100 + day.month)))
    existing = db.get(CampaignDraw, day)
    if existing is not None:
        db.commit()
        return existing

    # A fixed order before the shuffle, so the recorded seed replays the same draw.
    entries = db.scalars(
        select(CampaignEntry).where(CampaignEntry.campaign_day == day).order_by(CampaignEntry.created_at, CampaignEntry.id)
    ).all()
    seed = None
    if rng is None:
        seed = secrets.randbits(63)
        rng = random.Random(seed)
    excluded = _at_monthly_limit(db, day)
    winners = pick_winners(entries, excluded, rng)

    draw = CampaignDraw(
        campaign_day=day,
        eligible_entries=len(entries),
        winner_count=len(winners),
        excluded_participants=sorted(excluded & {e.participant_id for e in entries}),
        seed=seed,
        run_by_id=run_by_id,
    )
    draw.winners = [
        CampaignWinner(campaign_day=day, rank=rank, entry_id=entry.id, participant_id=entry.participant_id)
        for rank, entry in enumerate(winners, start=1)
    ]
    db.add(draw)
    try:
        db.commit()
    except IntegrityError:
        # Another run recorded this day first; its winners stand.
        db.rollback()
        return db.get(CampaignDraw, day)
    return draw
