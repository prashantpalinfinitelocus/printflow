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

    bootstrap_admin_email: str = "admin@printflow.local"
    bootstrap_admin_password: str = "admin123"

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
