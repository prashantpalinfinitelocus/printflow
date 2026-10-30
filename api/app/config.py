from functools import lru_cache
from pathlib import Path

from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="PRINTFLOW_", extra="ignore")

    database_url: str = "postgresql+psycopg://localhost/printflow"

    jwt_secret: str = "dev-only-change-me"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60 * 12

    # Filesystem layout
    data_dir: Path = BASE_DIR / "data"
    inbox_dir: Path = BASE_DIR / "data" / "inbox"
    psd_dir: Path = BASE_DIR / "data" / "psd"
    output_dir: Path = BASE_DIR / "data" / "output"
    fonts_dir: Path = BASE_DIR / "data" / "fonts"

    # Rendering
    render_dpi: int = 300
    tiff_compression: str = "tiff_lzw"
    tiff_colorspace: str = "CMYK"  # CMYK | RGB

    # Inset per side, in inches, when a format lays its label out on a page.
    #
    # The page must land inside the printer's printable area, not fill the sheet:
    # CUPS scales anything wider than that area down to fit, so a full-bleed A4
    # artifact prints at 0.94x. Measured printable width for A4 on the generic
    # driver is 7.80in against a 8.27in sheet, so 0.25in per side clears it with
    # room to spare and still prints 1:1. Raise it for a printer with wider
    # unprintable margins.
    page_margin_in: float = 0.25

    # Path to the CMYK ICC profile used for separation and embedded in the TIFF.
    # Leave blank to auto-detect a system profile. Point this at your press
    # profile (e.g. a SWOP or FOGRA .icc) for colour-accurate output.
    cmyk_icc_profile: str = ""

    # Printing
    printing_enabled: bool = True
    lp_binary: str = "lp"
    lpstat_binary: str = "lpstat"

    # Text moderation — every imported `text` is checked by Gemini before it can
    # print. The SDK reads GEMINI_API_KEY (or GOOGLE_API_KEY) from the environment.
    # Direct-to-bucket CSV upload. The load balancer's WAF rejects multipart CSV bodies, so the
    # browser PUTs the file straight to this bucket's inbox/ folder with a short-lived signed URL,
    # then imports it from the inbox. Blank = not configured; the page falls back to the normal
    # multipart upload (local dev and docker compose).
    upload_bucket: str = ""
    upload_url_ttl_seconds: int = 600
    upload_max_bytes: int = 20 * 1024 * 1024

    moderation_enabled: bool = True
    moderation_model: str = "gemini-3.5-flash"
    # Deployed environments call Gemini through Vertex AI with the Cloud Run service
    # account (company policy forbids API keys). Local dev keeps using GEMINI_API_KEY.
    moderation_use_vertex: bool = False
    # Blank = the project the service account runs in (resolved by Application Default Credentials).
    moderation_vertex_project: str = ""
    # Gemini 3.x models are served from the "global" endpoint; use a region only if the model is available there.
    moderation_vertex_location: str = "global"
    # Texts per API call. The system prompt is paid once per call, so bigger
    # batches are cheaper; 25 keeps the reply small enough that the model never
    # loses track of indexes.
    moderation_batch_size: int = 25
    # Parallel calls per import. Bounded so a 1,000-row file does not hit the
    # per-minute request limit.
    moderation_concurrency: int = 4
    # Gemini 3.x thinks by default (billed as output). Classification of short
    # gift-tag strings does not need it — MINIMAL is 3-4x cheaper per call.
    moderation_thinking_level: str = "MINIMAL"
    moderation_timeout_seconds: float = 60.0
    # Comma-separated brands to treat as competitors in addition to the built-in list.
    moderation_extra_competitors: str = ""
    # The brand whose artwork this campaign prints on. The placement rule reads
    # every message as if it stood beside this logo ("not ok" -> "Diet Coke not ok").
    moderation_campaign_brand: str = "Diet Coke"

    # Consumer Diet Coke campaign. No SMS provider is wired in yet, so while the
    # bypass is on no OTP is sent and only `campaign_otp_bypass_code` logs in.
    # Anyone who knows the code can log in as any number: never enable it live.
    campaign_otp_bypass: bool = False
    campaign_otp_bypass_code: str = ""
    campaign_jwt_expire_minutes: int = 60 * 24
    #: Stops new entries (window state PAUSED) without a deploy.
    campaign_paused: bool = False
    #: Daily entry window: open at `campaign_open_hour` (inclusive), closed from
    #: `campaign_close_hour` (exclusive, 24 = midnight), in `campaign_timezone`.
    campaign_open_hour: int = 10
    campaign_close_hour: int = 22
    campaign_timezone: str = "Asia/Kolkata"

    @model_validator(mode="after")
    def _check_campaign_window(self) -> "Settings":
        if not 0 <= self.campaign_open_hour < self.campaign_close_hour <= 24:
            raise ValueError("campaign window needs 0 <= campaign_open_hour < campaign_close_hour <= 24")
        try:
            ZoneInfo(self.campaign_timezone)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise ValueError(f"unknown campaign_timezone {self.campaign_timezone!r}") from exc
        return self

    # One-time codes. Every number below is a deployment setting, not a constant.
    campaign_otp_length: int = 6
    campaign_otp_ttl_seconds: int = 300
    #: A phone may ask for this many codes inside `campaign_otp_send_window_seconds`;
    #: the next ask blocks it for `campaign_otp_block_seconds`.
    campaign_otp_send_limit: int = 5
    campaign_otp_send_window_seconds: int = 300
    campaign_otp_block_seconds: int = 2 * 60 * 60
    #: Wrong codes allowed before verification locks for `campaign_otp_verify_lock_seconds`.
    campaign_otp_verify_max_failures: int = 5
    campaign_otp_verify_lock_seconds: int = 2 * 60 * 60
    #: Seconds the web app waits before offering "Resend code".
    campaign_otp_resend_after_seconds: int = 30

    # SMS delivery through Infobip. OFF by default: while off, no SMS is sent and
    # only the bypass code logs in. Turn it on once the DLT template is approved.
    # The DLT ids default to blank on purpose; they belong to one brand's sender.
    campaign_infobip_enabled: bool = False
    campaign_infobip_base_url: str = ""
    campaign_infobip_api_key: str = ""
    campaign_infobip_sender_id: str = ""
    campaign_infobip_dlt_entity_id: str = ""
    campaign_infobip_dlt_template_id: str = ""
    #: Must match the DLT-approved template text exactly, with {otp} where the code goes.
    campaign_infobip_message: str = ""
    campaign_infobip_timeout_seconds: float = 10.0

    #: Entries one phone may submit in total (PRD 2: 50). 0 = no cap.
    campaign_max_entries_per_participant: int = 50

    bootstrap_admin_email: str = "admin@printflow.local"
    bootstrap_admin_password: str = "admin123"

    #: URL prefix the load balancer puts in front of the API (for example "/backend").
    #: Routes answer both with and without it, and the API docs show it. Empty = no prefix.
    root_path: str = ""

    cors_origins: str = "http://localhost:3000"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    def ensure_dirs(self) -> None:
        for d in (self.data_dir, self.inbox_dir, self.psd_dir, self.output_dir, self.fonts_dir):
            d.mkdir(parents=True, exist_ok=True)


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    s.ensure_dirs()
    return s


settings = get_settings()
