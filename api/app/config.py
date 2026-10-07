from functools import lru_cache
from pathlib import Path

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
    moderation_enabled: bool = True
    moderation_model: str = "gemini-3.5-flash"
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
