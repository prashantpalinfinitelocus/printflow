"""Designs a campaign admin adds: their ids, which ids exist, and their sticker images.

A sticker upload is never stored as sent. It must open as a PNG, WebP or JPEG, is shrunk to at
most 1024 px and re-saved as a fresh PNG, so nothing else in the upload (scripts in an SVG,
metadata, a disguised file) reaches users.
"""

from __future__ import annotations

import io
import re

from PIL import Image
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings
from ..models import CampaignCatalogDesign, CampaignHiddenDesign
from .campaign import DESIGN_IDS

STICKER_FORMATS = {"PNG", "WEBP", "JPEG"}
MAX_STICKER_SIDE = 1024
#: Refuse images whose pixels would take a lot of memory to decode (a "decompression bomb").
MAX_STICKER_PIXELS = 40_000_000


class StickerError(ValueError):
    """The upload is not a usable sticker image."""


def new_design_id(db: Session, name: str) -> str:
    """An id from the name (Summer splash -> SUMMER_SPLASH), unique among built-in and added designs."""
    base = re.sub(r"[^A-Z0-9]+", "_", name.upper()).strip("_")[:56] or "DESIGN"
    taken = set(DESIGN_IDS) | set(db.scalars(select(CampaignCatalogDesign.design_id)))
    candidate, n = base, 2
    while candidate in taken:
        candidate, n = f"{base}_{n}", n + 1
    return candidate


def hidden_builtins(db: Session) -> list[str]:
    return sorted(db.scalars(select(CampaignHiddenDesign.design_id)))


def is_enterable(db: Session, design_id: str) -> bool:
    """A design users can see: a built-in one not hidden, or an added one that is shown."""
    if design_id in DESIGN_IDS:
        return db.get(CampaignHiddenDesign, design_id) is None
    design = db.get(CampaignCatalogDesign, design_id)
    return design is not None and design.is_active


def clean_sticker(data: bytes) -> bytes:
    """The upload re-saved as an RGBA PNG at most 1024 px on its longer side."""
    try:
        with Image.open(io.BytesIO(data)) as probe:
            if probe.format not in STICKER_FORMATS:
                raise StickerError
            if probe.width * probe.height > MAX_STICKER_PIXELS:
                raise StickerError
            probe.verify()
        with Image.open(io.BytesIO(data)) as image:
            image = image.convert("RGBA")
            image.thumbnail((MAX_STICKER_SIDE, MAX_STICKER_SIDE))
            out = io.BytesIO()
            image.save(out, "PNG", optimize=True)
            return out.getvalue()
    except (StickerError, OSError, ValueError, Image.DecompressionBombError) as exc:
        raise StickerError("The sticker must be a PNG, WebP or JPEG image.") from exc


def store_sticker(design_id: str, data: bytes) -> str:
    """Writes the cleaned sticker to the sticker folder and returns its file name."""
    name = f"{design_id}.png"
    folder = settings.campaign_sticker_dir
    folder.mkdir(parents=True, exist_ok=True)
    incoming = folder / f".{name}.upload"
    incoming.write_bytes(clean_sticker(data))
    incoming.replace(folder / name)
    return name
