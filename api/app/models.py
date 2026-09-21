from __future__ import annotations

import enum
from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
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

    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


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
