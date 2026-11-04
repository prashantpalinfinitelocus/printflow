from __future__ import annotations

import re
from datetime import date, datetime
from decimal import Decimal
from enum import Enum
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field

from .models import JobKind, JobStatus, ModerationStatus, OrderStatus, Role
from .services.campaign import CATEGORIES

#: A database row id. Postgres ids are 32-bit; anything larger would reach the
#: database as an out-of-range integer and come back as an unhandled 500.
RowId = Annotated[int, Field(ge=1, le=2_147_483_647)]

# Deliberately permissive: internal deployments use reserved TLDs such as
# `.local` and `.internal`, which strict RFC validators reject.
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$")


def _validate_email(value: str) -> str:
    value = value.strip().lower()
    if not _EMAIL_RE.match(value):
        raise ValueError("not a valid email address")
    return value


EmailStr = Annotated[str, AfterValidator(_validate_email)]


def _validate_page_size(value: str | None) -> str | None:
    """Normalise a paper-size name, rejecting ones the renderer cannot lay out.

    Caught here rather than at render time: a typo in the format editor would
    otherwise only surface as a label-sized file on the operator's paper, which
    is exactly the failure the setting exists to prevent.
    """
    from .services.renderer import PAGE_SIZES_IN

    if value is None:
        return None
    normalised = value.strip().upper().replace(" ", "")
    if not normalised:
        return None
    if normalised not in PAGE_SIZES_IN:
        raise ValueError(f"unknown page size; expected one of {', '.join(sorted(PAGE_SIZES_IN))}")
    return normalised


PageSize = Annotated[str | None, AfterValidator(_validate_page_size)]


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---------- auth ----------


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: UserOut


# ---------- stores ----------


class StoreCreate(BaseModel):
    code: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=255)
    city: str | None = None
    is_active: bool = True


class AppSettingsOut(ORMModel):
    uppercase_text: bool
    updated_at: datetime


class AppSettingsUpdate(BaseModel):
    uppercase_text: bool | None = None


class StoreUpdate(BaseModel):
    name: str | None = None
    city: str | None = None
    is_active: bool | None = None


class StoreOut(ORMModel):
    id: int
    code: str
    name: str
    city: str | None
    is_active: bool
    created_at: datetime


class StoreWithStats(StoreOut):
    user_count: int = 0
    pending_orders: int = 0


# ---------- users ----------


class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6, max_length=128)
    full_name: str | None = None
    role: Role = Role.OPERATOR
    store_id: RowId | None = None


class UserUpdate(BaseModel):
    full_name: str | None = None
    password: str | None = Field(default=None, min_length=6, max_length=128)
    role: Role | None = None
    store_id: RowId | None = None
    is_active: bool | None = None


class UserOut(ORMModel):
    id: int
    email: EmailStr
    full_name: str | None
    role: Role
    store_id: int | None
    is_active: bool
    created_at: datetime
    last_login_at: datetime | None = None
    store: StoreOut | None = None


# ---------- print formats ----------


class TextBox(BaseModel):
    x: int
    y: int
    w: int
    h: int


class PrintFormatCreate(BaseModel):
    code: str
    name: str
    psd_path: str
    text_box: TextBox
    text_layer_name: str | None = None
    dpi: int = 300
    font_size: int = 64
    font_color: str = "#111111"
    align: str = "center"
    font_path: str | None = None
    placeholder_color: str | None = None
    colorspace: str | None = None
    preserve_alpha: bool = False
    page_size: PageSize = None
    print_passes: int = Field(default=1, ge=1, le=10)
    white_passes: int = Field(default=0, ge=0, le=6)
    operator_note: str | None = Field(default=None, max_length=500)
    is_active: bool = True


class PrintFormatUpdate(BaseModel):
    name: str | None = None
    psd_path: str | None = None
    text_box: TextBox | None = None
    text_layer_name: str | None = None
    dpi: int | None = None
    font_size: int | None = None
    font_color: str | None = None
    align: str | None = None
    font_path: str | None = None
    placeholder_color: str | None = None
    colorspace: str | None = None
    preserve_alpha: bool | None = None
    page_size: PageSize = None
    print_passes: int | None = Field(default=None, ge=1, le=10)
    white_passes: int | None = Field(default=None, ge=0, le=6)
    operator_note: str | None = Field(default=None, max_length=500)
    is_active: bool | None = None


class PrintFormatOut(ORMModel):
    id: int
    code: str
    name: str
    psd_path: str
    width_px: int
    height_px: int
    dpi: int
    text_box: dict
    text_layer_name: str | None
    font_size: int
    font_color: str
    align: str
    font_path: str | None
    placeholder_color: str | None
    colorspace: str | None
    preserve_alpha: bool
    page_size: str | None
    print_passes: int
    white_passes: int
    operator_note: str | None
    is_active: bool


class DetectPlaceholderRequest(BaseModel):
    psd_path: str
    color: str = "#ED1C24"
    tolerance: int = Field(default=60, ge=0, le=255)
    #: Expected placeholder size. Leave both unset to take the largest text-like
    #: blob, which is only safe when the colour appears nowhere else in the art.
    expected_w: int | None = None
    expected_h: int | None = None


class DetectPlaceholderResponse(BaseModel):
    text_box: TextBox
    #: Share of the box that is placeholder-coloured — a sanity check that a
    #: run of letters was found rather than a solid block of colour.
    fill: float


class FontOut(BaseModel):
    """A font file available on the API host for formats to reference."""

    filename: str
    family: str | None = None


class FitTextRequest(BaseModel):
    """Ask what size a box would actually produce, and what box a size needs.

    `font_size` on a format is a ceiling in *pixels*, not a setting — the
    renderer shrinks it until the text fits. Designers think in points, and at
    508 dpi a point is 7.06 px, so a 68px cap is 9.6pt: far smaller than the
    number suggests. Both halves of that confusion are answered here.
    """

    text_box: TextBox
    font_size: int = Field(ge=1, le=2000)
    font_path: str | None = None
    #: Type the longest name you expect. Width binds before height on long text,
    #: so a box that suits "Anjali" may halve the size for something longer.
    text: str = Field(default="Sample Name", max_length=200)
    #: The format's resolution — points only mean something against a dpi.
    dpi: int = Field(default=300, ge=1, le=2400)


class FitTextResponse(BaseModel):
    #: Pixel size the renderer would use for this box, font and text.
    font_size_used: int
    #: The same size in points, which is the unit the artwork is specified in.
    font_size_used_pt: float
    #: What was asked for, in points, for a like-for-like comparison.
    requested_pt: float
    #: True when the box, not `font_size`, is deciding the size.
    capped: bool
    lines: int
    line_height: int
    #: Physical height of one line at the format's dpi, for a sanity check
    #: against the object being printed.
    line_height_mm: float
    #: Box the requested size actually needs, on one line. This is the actionable
    #: half: "24pt needs 1372x191" beats "your 400 became 68".
    min_box_width: int
    min_box_height: int


class PageSizeOut(BaseModel):
    """A paper size a format can centre its label on, in portrait inches."""

    name: str
    width_in: float
    height_in: float


# ---------- orders ----------


class OrderOut(ORMModel):
    id: int
    order_ref: str
    store_id: int
    #: Snapshots of what the CSV called the store. `store` below carries the
    #: store master's own values, which these never overwrite.
    store_name: str | None
    city: str | None
    sku_code: str | None
    brand: str | None
    amount: Decimal
    print_format_id: int
    print_text: str
    status: OrderStatus
    reprint_count: int
    created_at: datetime
    printed_at: datetime | None
    last_error: str | None
    moderation_status: ModerationStatus = ModerationStatus.UNCHECKED
    moderation_categories: list[str] | None = None
    moderation_reason: str | None = None
    moderation_note: str | None = None
    moderated_at: datetime | None = None
    store: StoreOut | None = None
    print_format: PrintFormatOut | None = None
    printed_by: UserOut | None = None
    reviewed_by: UserOut | None = None


class ModerationReviewRequest(BaseModel):
    decision: Literal["APPROVE", "REJECT"]
    note: str | None = Field(default=None, max_length=1000)


class OrderPage(BaseModel):
    items: list[OrderOut]
    total: int
    page: int
    page_size: int


class OrderStats(BaseModel):
    pending: int = 0
    printing: int = 0
    printed: int = 0
    failed: int = 0
    #: Orders held by moderation (FLAGGED, NEEDS_REVIEW or REJECTED). Overlaps
    #: with `pending` — a held order is still PENDING in the print pipeline.
    on_hold: int = 0
    total: int = 0
    amount_pending: Decimal = Decimal("0")


# ---------- csv import ----------


class CsvRowError(BaseModel):
    row: int
    order_ref: str | None = None
    reason: str


class CsvBatchOut(ORMModel):
    id: int
    filename: str
    source: str
    total_rows: int
    imported: int
    skipped: int
    flagged: int = 0
    errors: list
    moderation_prompt_tokens: int = 0
    moderation_output_tokens: int = 0
    moderation_thought_tokens: int = 0
    created_at: datetime
    uploaded_by: UserOut | None = None


class InboxFile(BaseModel):
    name: str
    size: int
    modified: datetime


FileName = Annotated[str, Field(min_length=1, max_length=255)]


class ImportFromPathRequest(BaseModel):
    filename: FileName


class UploadUrlRequest(BaseModel):
    filename: FileName


class UploadUrlOut(BaseModel):
    """Where and how the browser may POST a CSV form directly into the bucket."""

    url: str
    #: Form fields to send before the file.
    fields: dict[str, str]
    #: Name the file will have in the inbox; pass it to /csv/import-from-inbox afterwards.
    filename: str
    expires_in: int


# ---------- printing ----------


class PrinterOut(BaseModel):
    name: str
    status: str
    is_default: bool = False


class Delivery(str, Enum):
    """How the rendered file reaches paper."""

    #: The API hands the file to CUPS itself. Only possible when the printer is
    #: reachable from the server.
    PRINTER = "PRINTER"
    #: The operator downloads the file and prints it from their own machine.
    #: The order still counts as printed.
    DOWNLOAD = "DOWNLOAD"
    #: Render only — produce the artifacts and leave the order status alone.
    PROOF = "PROOF"


class PrintRequest(BaseModel):
    kind: JobKind = JobKind.TIFF
    printer_name: str | None = None
    copies: int = Field(default=1, ge=1, le=20)
    #: Preferred over `send_to_printer`, which predates the DOWNLOAD mode and is
    #: kept so existing callers keep working. When unset, the boolean decides.
    delivery: Delivery | None = None
    send_to_printer: bool = True
    #: Print the artwork with no text on it.
    #:
    #: This is the one route through a moderation hold. It is safe precisely
    #: because the held text is what gets omitted — nothing an admin has not
    #: seen reaches the artwork. Accepted on any order, not just held ones;
    #: a blank label is never the unsafe outcome, so refusing it elsewhere
    #: would be noise.
    without_text: bool = False

    @property
    def mode(self) -> Delivery:
        if self.delivery is not None:
            return self.delivery
        return Delivery.PRINTER if self.send_to_printer else Delivery.PROOF


class PrintJobOut(ORMModel):
    id: int
    order_id: int
    kind: JobKind
    is_reprint: bool
    without_text: bool
    printer_name: str | None
    status: JobStatus
    passes: int
    font_size_used: int | None
    cups_job_id: str | None
    error: str | None
    created_at: datetime
    user: UserOut | None = None


class PrintResponse(BaseModel):
    job: PrintJobOut
    order: OrderOut
    tiff_url: str | None = None
    pdf_url: str | None = None
    preview_url: str | None = None
    #: Set when the text contained characters no installed font could draw.
    #: The render still succeeded — those characters came out as blank boxes.
    warning: str | None = None


TokenResponse.model_rebuild()


# ---------------- consumer campaign ----------------

#: A 10-digit Indian mobile number, digits only (the web app strips +91 and spaces).
CampaignPhone = Annotated[str, Field(pattern=r"^[6-9][0-9]{9}$")]


class OtpRequest(BaseModel):
    phone: CampaignPhone
    email: EmailStr


class OtpVerify(OtpRequest):
    code: str = Field(pattern=r"^[0-9]{4,8}$")


class OtpSent(BaseModel):
    resend_after: int


class CampaignSession(BaseModel):
    token: str
    #: Seconds until the token expires; the web app's session cookie lasts as long.
    expires_in: int
    phone: str
    email: str


class TextCheck(BaseModel):
    text: str = Field(max_length=200)


class TextVerdict(BaseModel):
    result: Literal["APPROVED", "REJECTED"]


class CampaignWindow(BaseModel):
    state: Literal["OPEN", "BEFORE_OPEN", "CLOSED", "PAUSED"]


class EntryCreate(BaseModel):
    #: A built-in design or an added one shown to users; the route checks which ids exist.
    design_id: str = Field(pattern=r"^[A-Z0-9_]{1,64}$")
    text: str = Field(max_length=200)
    idempotency_key: str = Field(min_length=1, max_length=64)


class EntryOut(BaseModel):
    entry_id: str


# ---------------- campaign admin: daily draw and winners ----------------


class CampaignDrawOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    eligible_entries: int
    winner_count: int
    created_at: datetime


class CampaignWinnerOut(BaseModel):
    id: int
    rank: int
    entry_id: str
    phone: str
    email: str
    design_id: str
    text: str
    entered_at: datetime
    tiff_ready: bool
    tiff_error: str | None
    tiff_generated_at: datetime | None


class CampaignDayOut(BaseModel):
    day: date
    entries: int
    #: The entry window has closed and the day has not been drawn yet.
    can_draw: bool
    draw: CampaignDrawOut | None
    winners: list[CampaignWinnerOut]
    #: Designs among the winners with no PSD set up under Designs, so no TIFF can be made.
    missing_formats: list[str]


class CampaignAdminLogin(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=200)


class CampaignAdminOut(BaseModel):
    username: str


class CampaignAdminSession(BaseModel):
    token: str
    expires_in: int
    admin: CampaignAdminOut


class CampaignDesignSetup(BaseModel):
    """The PSD a campaign design prints from and where its text goes."""

    model_config = ConfigDict(from_attributes=True)

    psd_path: str
    width_px: int
    height_px: int
    dpi: int
    text_box: dict
    font_path: str | None
    font_size: int
    font_color: str
    placeholder_color: str | None


class CampaignDesignOut(BaseModel):
    design_id: str
    #: Name and category of an added design; built-in designs carry theirs in the web app.
    name: str | None = None
    category: str | None = None
    builtin: bool = True
    #: Shown to users. Built-in designs always are.
    active: bool = True
    #: The added design's sticker version, for its URL; 0 for built-in designs.
    version: int = 0
    #: What the design's TIFFs render from; empty until its PSD is uploaded.
    format: CampaignDesignSetup | None


class CampaignTextBox(BaseModel):
    """Where a design's text goes, in pixels from the PSD's top-left corner."""

    x: int = Field(ge=0)
    y: int = Field(ge=0)
    w: int = Field(ge=1)
    h: int = Field(ge=1)


class CampaignDesignUpdate(BaseModel):
    # Fields left out keep their value. The box, size and colour are required columns, so an
    # explicit null is refused rather than cleared (a default is not validated; a sent null is).
    text_box: CampaignTextBox = None  # type: ignore[assignment]
    font_size: int = Field(default=None, ge=1, le=2000)  # type: ignore[assignment]
    font_color: str = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")  # type: ignore[assignment]
    #: Empty uses the renderer's automatic font choice.
    font_path: str | None = None
    #: Colour of a placeholder baked into the art, erased before printing; empty erases nothing.
    placeholder_color: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}$")


class CampaignFindPlaceholder(BaseModel):
    color: str = Field(default="#ED1C24", pattern=r"^#[0-9A-Fa-f]{6}$")
    expected_w: int | None = Field(default=None, ge=1)
    expected_h: int | None = Field(default=None, ge=1)


def _category(value: str) -> str:
    if value not in CATEGORIES:
        raise ValueError(f"must be one of {', '.join(CATEGORIES)}")
    return value


DesignName = Annotated[str, Field(min_length=1, max_length=40)]
DesignCategory = Annotated[str, AfterValidator(_category)]


class CatalogDesignOut(BaseModel):
    """A design a campaign admin added."""

    design_id: str
    name: str
    category: str
    active: bool
    version: int


class CatalogDesignUpdate(BaseModel):
    # A field left out keeps its value; a sent null is refused (a default is not validated).
    name: DesignName = None  # type: ignore[assignment]
    category: DesignCategory = None  # type: ignore[assignment]
    active: bool = None  # type: ignore[assignment]


class PublicDesignOut(BaseModel):
    """An added design as users see it; its sticker is at /campaign/designs/<id>/sticker."""

    design_id: str
    name: str
    category: str
    version: int


class PublicDesignsOut(BaseModel):
    """What users can pick beyond the defaults: added designs shown, and built-in ones hidden."""

    added: list[PublicDesignOut]
    hidden: list[str]


class DesignVisibility(BaseModel):
    active: bool
