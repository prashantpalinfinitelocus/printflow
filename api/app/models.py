from __future__ import annotations

import enum
import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


class Role(str, enum.Enum):
    ADMIN = "ADMIN"
    OPERATOR = "OPERATOR"


class OrderStatus(str, enum.Enum):
    PENDING = "PENDING"
    PRINTING = "PRINTING"
    PRINTED = "PRINTED"
    FAILED = "FAILED"


class JobKind(str, enum.Enum):
    TIFF = "TIFF"
    PDF = "PDF"


class JobStatus(str, enum.Enum):
    QUEUED = "QUEUED"
    RENDERED = "RENDERED"
    SENT_TO_PRINTER = "SENT_TO_PRINTER"
    #: Handed to the operator to print from their own machine. The server never
    #: sees the printer — the only workable route when the app runs in the cloud
    #: and the printer hangs off the operator's laptop.
    DOWNLOADED = "DOWNLOADED"
    FAILED = "FAILED"


class ModerationStatus(str, enum.Enum):
    """Where an order's text stands with the LLM brand-safety gate.

    Stored as a plain varchar rather than a Postgres enum so that adding a
    member is an additive migration, not an ALTER TYPE.
    """

    #: Moderation was disabled when the row was imported. Printable, but shown.
    UNCHECKED = "UNCHECKED"
    #: The model saw nothing wrong.
    CLEAR = "CLEAR"
    #: The model flagged the text. Held until an admin decides.
    FLAGGED = "FLAGGED"
    #: The model could not be reached or gave no verdict. Held, fail-closed.
    NEEDS_REVIEW = "NEEDS_REVIEW"
    #: An admin looked at a held order and released it.
    APPROVED = "APPROVED"
    #: An admin looked at a held order and refused it. Never prints.
    REJECTED = "REJECTED"


#: Statuses in which an order must not be rendered or printed.
HOLD_STATUSES: frozenset[str] = frozenset(
    {ModerationStatus.FLAGGED.value, ModerationStatus.NEEDS_REVIEW.value, ModerationStatus.REJECTED.value}
)


class Store(Base):
    __tablename__ = "stores"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(255))
    city: Mapped[str | None] = mapped_column(String(128), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    users: Mapped[list[User]] = relationship(back_populates="store")
    orders: Mapped[list[Order]] = relationship(back_populates="store")


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    full_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[Role] = mapped_column(Enum(Role, name="user_role"), default=Role.OPERATOR)
    store_id: Mapped[int | None] = mapped_column(ForeignKey("stores.id"), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    store: Mapped[Store | None] = relationship(back_populates="users")


class PrintFormat(Base):
    """A PSD design template. `text_box` locates where the CSV text is stamped."""

    __tablename__ = "print_formats"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(255))
    psd_path: Mapped[str] = mapped_column(String(512))
    width_px: Mapped[int] = mapped_column(Integer, default=0)
    height_px: Mapped[int] = mapped_column(Integer, default=0)
    dpi: Mapped[int] = mapped_column(Integer, default=300)
    # {"x":int,"y":int,"w":int,"h":int}  — pixels, top-left origin
    text_box: Mapped[dict] = mapped_column(JSONB, default=dict)
    text_layer_name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    font_size: Mapped[int] = mapped_column(Integer, default=64)
    font_color: Mapped[str] = mapped_column(String(16), default="#111111")
    align: Mapped[str] = mapped_column(String(16), default="center")

    #: Font file for this design. Relative names resolve inside the fonts dir.
    #: Blank falls back to automatic, glyph-coverage-driven selection.
    font_path: Mapped[str | None] = mapped_column(String(512), nullable=True)

    #: Colour of the placeholder baked into the artwork (e.g. the red XXXXXXXX).
    #: When set, that region is erased before the order text is drawn.
    #: Blank means the artwork has no placeholder to remove.
    placeholder_color: Mapped[str | None] = mapped_column(String(16), nullable=True)

    #: Per-format output override: RGB | CMYK. Blank inherits the global setting.
    #: Labels printed on transparent stock must stay RGB — CMYK has no alpha.
    colorspace: Mapped[str | None] = mapped_column(String(8), nullable=True)

    #: Keep the artwork's transparency in the TIFF instead of matting onto white.
    preserve_alpha: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")

    #: How many times this design must be printed onto the same object.
    #:
    #: A single pass of light ink on aluminium or glass goes down translucent —
    #: the substrate's own artwork reads straight through it. Building opacity
    #: takes 2-3 passes over the same can, without it leaving the jig. This is a
    #: property of the design's ink coverage, so it lives on the format.
    print_passes: Mapped[int] = mapped_column(Integer, default=1, server_default="1")

    #: Passes of white ink to lay under the artwork, as spot channels in the TIFF.
    #:
    #: 0 emits a plain RGBA file — right for anything not going to the UV press.
    #: 1 emits the `W1`, `W2` pair the press already accepts; each further pass
    #: appends another `W1`, because opacity on metal or glass is built by
    #: repeating the plate rather than by darkening it.
    white_passes: Mapped[int] = mapped_column(Integer, default=0, server_default="0")

    #: Paper the label is centred on in the TIFF and PDF — A4, LETTER, 4X6, and
    #: so on. Blank emits a label-sized file, which is what the operator's print
    #: dialog then enlarges to fill their sheet. Set this to the paper the store
    #: actually loads.
    page_size: Mapped[str | None] = mapped_column(String(16), nullable=True)

    #: Reminder shown to the operator on every order using this design — a
    #: manual step the file cannot do for them (load a different jig, apply a
    #: sticker after printing). Blank shows nothing.
    operator_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class AppSettings(Base):
    """App-wide settings an admin changes at runtime. A single row, id 1.

    Deploy-time knobs live in `config.Settings` (environment). This table is for
    the ones that must change without a redeploy.
    """

    __tablename__ = "app_settings"

    id: Mapped[int] = mapped_column(primary_key=True)

    #: Capitalise every order's text. Applied when a CSV is imported, so the
    #: queue shows exactly what will print, and again at render time so orders
    #: imported before it was switched on print in capitals too. Turning it off
    #: affects later imports only — text already stored in capitals stays so.
    uppercase_text: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")

    updated_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class CsvBatch(Base):
    __tablename__ = "csv_batches"

    id: Mapped[int] = mapped_column(primary_key=True)
    filename: Mapped[str] = mapped_column(String(512))
    source: Mapped[str] = mapped_column(String(32), default="upload")  # upload | inbox
    uploaded_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    total_rows: Mapped[int] = mapped_column(Integer, default=0)
    imported: Mapped[int] = mapped_column(Integer, default=0)
    skipped: Mapped[int] = mapped_column(Integer, default=0)
    errors: Mapped[list] = mapped_column(JSONB, default=list)
    #: Rows imported but held by moderation (FLAGGED or NEEDS_REVIEW).
    flagged: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    # Gemini spend for this file, so the cost of moderating is auditable per import.
    moderation_prompt_tokens: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    moderation_output_tokens: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    moderation_thought_tokens: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    uploaded_by: Mapped[User | None] = relationship()


class Order(Base):
    __tablename__ = "orders"
    __table_args__ = (UniqueConstraint("order_ref", name="uq_orders_order_ref"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    order_ref: Mapped[str] = mapped_column(String(128), index=True)
    store_id: Mapped[int] = mapped_column(ForeignKey("stores.id"), index=True)

    #: What the upstream system called this order's store, as it arrived in the
    #: CSV. A snapshot, not a source of truth: `store_id` above resolves the
    #: Store row that actually owns the order, and an import never writes back
    #: to the store master. Keeping both makes a disagreement visible instead of
    #: letting one side quietly win.
    store_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    city: Mapped[str | None] = mapped_column(String(128), nullable=True)

    #: Product identity for the order. Required in the CSV, nullable here —
    #: orders imported before this column existed have no value and never will,
    #: and NOT NULL would mean backfilling them with something invented.
    sku_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    brand: Mapped[str | None] = mapped_column(String(128), nullable=True)

    #: No longer part of the CSV contract; still stored when a file carries it.
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0)
    print_format_id: Mapped[int] = mapped_column(ForeignKey("print_formats.id"))
    print_text: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[OrderStatus] = mapped_column(
        Enum(OrderStatus, name="order_status"), default=OrderStatus.PENDING, index=True
    )
    reprint_count: Mapped[int] = mapped_column(Integer, default=0)
    batch_id: Mapped[int | None] = mapped_column(ForeignKey("csv_batches.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    printed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    printed_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Brand-safety moderation of `print_text`. See services/moderation.py.
    moderation_status: Mapped[str] = mapped_column(
        String(16), default=ModerationStatus.UNCHECKED.value, server_default="UNCHECKED", index=True
    )
    moderation_categories: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    #: The model's one-line reason when flagged, or the error when unavailable.
    moderation_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    #: Free text an admin left when approving or rejecting.
    moderation_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    moderated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reviewed_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)

    store: Mapped[Store] = relationship(back_populates="orders")
    print_format: Mapped[PrintFormat] = relationship()
    printed_by: Mapped[User | None] = relationship(foreign_keys=[printed_by_id])
    reviewed_by: Mapped[User | None] = relationship(foreign_keys=[reviewed_by_id])
    jobs: Mapped[list[PrintJob]] = relationship(back_populates="order", cascade="all, delete-orphan")


class PrintJob(Base):
    __tablename__ = "print_jobs"

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    kind: Mapped[JobKind] = mapped_column(Enum(JobKind, name="job_kind"))
    is_reprint: Mapped[bool] = mapped_column(Boolean, default=False)
    printer_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    tiff_path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    pdf_path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    status: Mapped[JobStatus] = mapped_column(Enum(JobStatus, name="job_status"), default=JobStatus.QUEUED)
    #: Passes printed onto the same object for this job. One job, N impressions —
    #: not N jobs, so a multi-pass print stays a single fulfilment and never
    #: inflates `Order.reprint_count`.
    passes: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    #: Point size the text was actually drawn at. The format's `font_size` is a
    #: starting point that shrinks to fit the text box, so this is the only place
    #: that records what went on the object — and the only way to notice that a
    #: box is capping the type far below what was asked for.
    font_size_used: Mapped[int | None] = mapped_column(Integer, nullable=True)
    #: This job printed the artwork with no text on it. The only way a held
    #: order reaches paper, so it has to be visible afterwards: an order can be
    #: PRINTED while its text is still FLAGGED, and the job is the only record
    #: of which of the two actually went out.
    without_text: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    #: CUPS job id per pass, comma-separated when there is more than one.
    cups_job_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    order: Mapped[Order] = relationship(back_populates="jobs")
    user: Mapped[User | None] = relationship()


class CampaignParticipant(Base):
    """A consumer who logged in to the Diet Coke campaign with a verified phone.

    One row per phone number; the email is the latest one they gave, which is
    where a winner is contacted (PRD 8).
    """

    __tablename__ = "campaign_participants"

    id: Mapped[int] = mapped_column(primary_key=True)
    phone: Mapped[str] = mapped_column(String(16), unique=True, index=True)
    email: Mapped[str] = mapped_column(String(255))
    #: Session tokens carry this number; logging out bumps it, which revokes every earlier token.
    token_version: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    entries: Mapped[list[CampaignEntry]] = relationship(back_populates="participant")


class CampaignOtp(Base):
    """One code sent to a phone. Doubles as the send log the rate limit counts.

    Only a keyed hash of the code is kept. `code_hash` is empty when the send
    went through the bypass, where no code exists.
    """

    __tablename__ = "campaign_otps"

    id: Mapped[int] = mapped_column(primary_key=True)
    phone: Mapped[str] = mapped_column(String(16), index=True)
    code_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    #: Set when the code is used or replaced by a newer one.
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)


class CampaignPhoneGuard(Base):
    """Per-phone abuse state: a block on sending codes or a lock on verifying them.

    Its row is also the lock that serialises concurrent sends and verifies for one phone.
    """

    __tablename__ = "campaign_phone_guards"

    phone: Mapped[str] = mapped_column(String(16), primary_key=True)
    blocked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    block_reason: Mapped[str | None] = mapped_column(String(32), nullable=True)
    failed_verifies: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    #: When the last wrong code was typed; old failures stop counting after a quiet period.
    last_failed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class CampaignEntry(Base):
    """One accepted entry into a day's lucky draw.

    Entries are unlimited (PRD 2); the idempotency key only stops one submit,
    retried, from landing twice. It is unique per participant, not globally,
    because keys are generated in the browser.
    """

    __tablename__ = "campaign_entries"
    __table_args__ = (
        UniqueConstraint("participant_id", "idempotency_key", name="uq_campaign_entries_participant_key"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    participant_id: Mapped[int] = mapped_column(ForeignKey("campaign_participants.id"), index=True)
    idempotency_key: Mapped[str] = mapped_column(String(64))
    design_id: Mapped[str] = mapped_column(String(64))
    text: Mapped[str] = mapped_column(String(64))
    #: The India-time date the entry counts for; the daily draw selects by it.
    campaign_day: Mapped[date] = mapped_column(Date, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    participant: Mapped[CampaignParticipant] = relationship(back_populates="entries")


class CampaignDraw(Base):
    """The record of one day's lucky draw (PRD 11). One per campaign day, so a re-run is a no-op."""

    __tablename__ = "campaign_draws"

    campaign_day: Mapped[date] = mapped_column(Date, primary_key=True)
    #: Entries the day had when it was drawn; the audit's "eligible entry set".
    eligible_entries: Mapped[int] = mapped_column(Integer)
    winner_count: Mapped[int] = mapped_column(Integer)
    #: Phones with entries that day that the monthly win limit kept out, so the draw replays
    #: from the seed even if other days of the month are drawn later.
    excluded_participants: Mapped[list] = mapped_column(JSONB, default=list, server_default="[]")
    #: Seeds the shuffle, so the draw can be replayed from the day's entries in (created_at, id) order.
    seed: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    #: The campaign admin who ran it; empty when the scheduled job did.
    run_by_id: Mapped[int | None] = mapped_column(ForeignKey("campaign_admins.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    winners: Mapped[list[CampaignWinner]] = relationship(
        back_populates="draw", order_by="CampaignWinner.rank", cascade="all, delete-orphan"
    )


class CampaignWinner(Base):
    """One winning entry, and the print-ready TIFF made for it."""

    __tablename__ = "campaign_winners"
    __table_args__ = (UniqueConstraint("campaign_day", "participant_id", name="uq_campaign_winners_day_participant"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    campaign_day: Mapped[date] = mapped_column(ForeignKey("campaign_draws.campaign_day"), index=True)
    #: Order the draw picked them in, from 1.
    rank: Mapped[int] = mapped_column(Integer)
    entry_id: Mapped[str] = mapped_column(ForeignKey("campaign_entries.id"), unique=True)
    participant_id: Mapped[int] = mapped_column(ForeignKey("campaign_participants.id"), index=True)
    tiff_path: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    #: Why the last TIFF attempt failed; cleared by a successful one.
    tiff_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    tiff_generated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    draw: Mapped[CampaignDraw] = relationship(back_populates="winners")
    entry: Mapped[CampaignEntry] = relationship()
    participant: Mapped[CampaignParticipant] = relationship()


class CampaignAdmin(Base):
    """An account for the campaign's admin pages, separate from PrintFlow's staff users.

    Its tokens open only the /campaign-admin routes; staff and consumer tokens open none of them.
    """

    __tablename__ = "campaign_admins"

    id: Mapped[int] = mapped_column(primary_key=True)
    #: The user ID it signs in with, stored lower-case.
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    #: Tokens carry this number; logging out bumps it, which revokes every earlier token.
    token_version: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    #: Wrong passwords since the last sign-in; reaching the limit locks the account until `locked_until`.
    failed_logins: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class CampaignDesign(Base):
    """The PSD one campaign design prints from, and where its text goes.

    The campaign's own record, apart from PrintFlow's print formats: a winner's TIFF is
    rendered from this by the shared renderer, but nothing here appears in PrintFlow.
    """

    __tablename__ = "campaign_designs"

    #: One of the campaign's design ids (DISCO_BALL and so on).
    design_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    #: File name inside the PSD folder (campaign-<design_id>.psd).
    psd_path: Mapped[str] = mapped_column(String(512))
    width_px: Mapped[int] = mapped_column(Integer)
    height_px: Mapped[int] = mapped_column(Integer)
    dpi: Mapped[int] = mapped_column(Integer, default=300)
    # {"x":int,"y":int,"w":int,"h":int}: pixels from the PSD's top-left corner.
    text_box: Mapped[dict] = mapped_column(JSONB)
    font_path: Mapped[str | None] = mapped_column(String(512), nullable=True)
    font_size: Mapped[int] = mapped_column(Integer)
    font_color: Mapped[str] = mapped_column(String(16))
    align: Mapped[str] = mapped_column(String(16), default="center")
    #: Colour of a placeholder baked into the art (the red XXXXXXXX), erased before the text is drawn.
    placeholder_color: Mapped[str | None] = mapped_column(String(16), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class CampaignRateLimit(Base):
    """One throttle counter: requests under `key` (an action and a phone) in the minute from
    `window_start`. Kept in the database so the limit holds across every API instance."""

    __tablename__ = "campaign_rate_limits"

    key: Mapped[str] = mapped_column(String(128), primary_key=True)
    window_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), primary_key=True)
    hits: Mapped[int] = mapped_column(Integer, default=0)


class CampaignCatalogDesign(Base):
    """A design a campaign admin added, beyond the nine built into the site.

    Users see it (in its category) only while `active`; its sticker is served from the
    campaign's sticker folder. Its PSD and text settings live in CampaignDesign like a built-in's.
    """

    __tablename__ = "campaign_catalog_designs"

    design_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(40))
    category: Mapped[str] = mapped_column(String(32))
    #: File name in the sticker folder (<design_id>.png).
    sticker_path: Mapped[str] = mapped_column(String(128))
    #: Bumped when the sticker is replaced, so browsers fetch the new one instead of a cached copy.
    version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class CampaignHiddenDesign(Base):
    """A built-in design a campaign admin took away from users. Its art stays in the site, so
    it can be shown again; entries already made with it keep it."""

    __tablename__ = "campaign_hidden_designs"

    design_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    hidden_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
