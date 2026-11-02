"""Creates a campaign admin, or sets a new password for an existing one.

Campaign admins sign in at /user-campaign/admin/login with this user ID and
password. They are separate from PrintFlow's staff users: neither login opens
the other's pages.

Run:  python -m scripts.create_campaign_admin <user-id>
      (asks for the password, so it never lands in shell history)
"""

from __future__ import annotations

import getpass
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.db import SessionLocal  # noqa: E402
from app.models import CampaignAdmin  # noqa: E402
from app.security import hash_password  # noqa: E402

MIN_PASSWORD = 10
#: The username column's length.
MAX_USER_ID = 64


def main(argv: list[str]) -> int:
    if len(argv) != 1 or not argv[0].strip():
        print("Usage: python -m scripts.create_campaign_admin <user-id>", file=sys.stderr)
        return 2
    username = argv[0].strip().lower()
    if len(username) > MAX_USER_ID:
        print(f"The user ID must be at most {MAX_USER_ID} characters.", file=sys.stderr)
        return 2
    password = getpass.getpass(f"Password for {username}: ")
    if len(password) < MIN_PASSWORD:
        print(f"The password must be at least {MIN_PASSWORD} characters.", file=sys.stderr)
        return 1
    if getpass.getpass("Type it again: ") != password:
        print("The passwords did not match.", file=sys.stderr)
        return 1

    db = SessionLocal()
    try:
        admin = db.query(CampaignAdmin).filter_by(username=username).one_or_none()
        created = admin is None
        if created:
            admin = CampaignAdmin(username=username)
            db.add(admin)
        admin.password_hash = hash_password(password)
        admin.is_active = True
        # A new password signs out every earlier session.
        admin.token_version = (admin.token_version or 0) + (0 if created else 1)
        db.commit()
    finally:
        db.close()
    print(f"{'Created' if created else 'Updated the password for'} campaign admin {username}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
