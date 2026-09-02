"""Additive schema migrations.

`Base.metadata.create_all` creates missing tables but never alters existing
ones, so columns added after a database already exists would be silently absent
until something queried them and blew up at runtime.

These statements are additive and idempotent (`ADD COLUMN IF NOT EXISTS`), so
they are safe to run on every startup. This is a deliberate stopgap: once the
schema needs a destructive or data-migrating change, move to Alembic — this
module cannot express those safely.
"""

from __future__ import annotations

import logging

from sqlalchemy import text

from .db import engine

log = logging.getLogger("printflow.migrations")

STATEMENTS: list[str] = [
    "ALTER TABLE print_formats ADD COLUMN IF NOT EXISTS font_path VARCHAR(512)",
    "ALTER TABLE print_formats ADD COLUMN IF NOT EXISTS placeholder_color VARCHAR(16)",
    "ALTER TABLE print_formats ADD COLUMN IF NOT EXISTS colorspace VARCHAR(8)",
    "ALTER TABLE print_formats ADD COLUMN IF NOT EXISTS preserve_alpha BOOLEAN NOT NULL DEFAULT false",
    "ALTER TABLE print_formats ADD COLUMN IF NOT EXISTS page_size VARCHAR(16)",
    "ALTER TABLE print_formats ADD COLUMN IF NOT EXISTS print_passes INTEGER NOT NULL DEFAULT 1",
    "ALTER TABLE print_formats ADD COLUMN IF NOT EXISTS white_passes INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS passes INTEGER NOT NULL DEFAULT 1",
    # Widening a varchar is safe and repeatable: a multi-pass job records one
    # CUPS id per pass, which no longer fits the original 64 characters.
    "ALTER TABLE print_jobs ALTER COLUMN cups_job_id TYPE VARCHAR(255)",
    # job_status is a native Postgres enum type, so a new member needs ALTER TYPE
    # — create_all() will not add it to a database that already exists.
    "ALTER TYPE job_status ADD VALUE IF NOT EXISTS 'DOWNLOADED'",
]


def run_migrations() -> None:
    with engine.begin() as conn:
        for statement in STATEMENTS:
            conn.execute(text(statement))
    log.info("Schema migrations applied (%d statements)", len(STATEMENTS))
