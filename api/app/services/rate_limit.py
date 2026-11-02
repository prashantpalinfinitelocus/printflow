"""Fixed-window throttles kept in Postgres, so a limit holds across every API instance.

`hit` counts one request under a key (an action and who made it) in the current window and
says how many seconds to wait when the limit is passed. Old windows of that key are cleared as
it goes, so the table stays small.
"""

from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy import delete
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from ..models import CampaignRateLimit


def hit(db: Session, key: str, limit: int, now: datetime, window_seconds: int = 60) -> int | None:
    """Counts a request; returns the seconds until the window resets if this one is over `limit`."""
    if limit <= 0:
        return None
    epoch = int(now.timestamp())
    start_epoch = epoch - epoch % window_seconds
    start = datetime.fromtimestamp(start_epoch, tz=now.tzinfo)
    stmt = insert(CampaignRateLimit).values(key=key, window_start=start, hits=1)
    stmt = stmt.on_conflict_do_update(
        index_elements=[CampaignRateLimit.key, CampaignRateLimit.window_start],
        set_={"hits": CampaignRateLimit.hits + 1},
    ).returning(CampaignRateLimit.hits)
    hits = db.execute(stmt).scalar_one()
    db.execute(
        delete(CampaignRateLimit).where(CampaignRateLimit.key == key, CampaignRateLimit.window_start < start - timedelta(seconds=window_seconds))
    )
    db.commit()
    if hits > limit:
        return max(1, start_epoch + window_seconds - epoch)
    return None
