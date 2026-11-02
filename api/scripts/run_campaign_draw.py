"""Runs the Diet Coke campaign's daily lucky draw (PRD 11).

Meant for a nightly scheduler (Cloud Scheduler, cron), any time after the entry
window closes plus the grace period (10:10 PM IST by default). With no argument it
draws every day of the last `campaign_draw_catchup_days` that has entries, has
closed and was not drawn yet, oldest first, so a night the job missed is drawn by
the next run. A day already drawn is left as it is, so a retry is safe.

Run:  python -m scripts.run_campaign_draw [YYYY-MM-DD]
"""

from __future__ import annotations

import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select  # noqa: E402

from app.config import settings  # noqa: E402
from app.db import SessionLocal  # noqa: E402
from app.models import CampaignDraw, CampaignEntry  # noqa: E402
from app.services import campaign  # noqa: E402
from app.services.campaign_draw import DrawNotReady, can_draw, run_draw  # noqa: E402


def days_to_draw(db) -> list[date]:
    """Closed, undrawn days with entries in the catch-up window, oldest first."""
    today = campaign.campaign_day(campaign.now())
    since = today - timedelta(days=settings.campaign_draw_catchup_days)
    drawn = select(CampaignDraw.campaign_day)
    days = db.scalars(
        select(CampaignEntry.campaign_day)
        .where(CampaignEntry.campaign_day >= since, CampaignEntry.campaign_day <= today)
        .where(CampaignEntry.campaign_day.not_in(drawn))
        .distinct()
        .order_by(CampaignEntry.campaign_day)
    )
    return [d for d in days if can_draw(d)]


def main(argv: list[str]) -> int:
    db = SessionLocal()
    try:
        days = [date.fromisoformat(argv[0])] if argv else days_to_draw(db)
        if not days:
            print("Nothing to draw.")
        for day in days:
            draw = run_draw(db, day)
            print(f"{day}: {draw.winner_count} winners from {draw.eligible_entries} entries")
    except DrawNotReady as exc:
        print(exc, file=sys.stderr)
        return 1
    finally:
        db.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
