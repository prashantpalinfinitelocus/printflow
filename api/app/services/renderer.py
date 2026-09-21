"""Compose a PSD template with per-order text and emit print-ready TIFF + PDF proof.

Pipeline
--------
1. Open the PSD with psd_tools and composite it to an RGB raster. If the
   template declares a placeholder text layer, that layer is excluded from the
   composite (we redraw it ourselves) and its bounding box is used as the text
   area when the format has no explicit box.
2. Draw the order text into the text box: word-wrapped, auto-shrunk until it
   fits, aligned per the format.
3. Emit three artifacts:
   - <base>.tif  : CMYK (or RGB) TIFF, LZW, DPI stamped -> goes to the printer
   - <base>.pdf  : RGB PDF proof at the same physical size -> for cross-checking
   - <base>.png  : downscaled preview -> for the browser
"""

from __future__ import annotations

import logging
import struct
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import numpy as np
import tifffile
from PIL import Image, ImageDraw, ImageFont
from psd_tools import PSDImage

from ..config import settings

log = logging.getLogger("printflow.renderer")

# Preferred faces for Latin text — bold first, this is signage.
FONT_CANDIDATES = [
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
    "/Library/Fonts/Arial Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
]

# Tried after the Latin faces when the text contains characters they lack.
# Order matters: broad-coverage faces first, then script specialists.
FALLBACK_FONTS = [
    "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
    "/System/Library/Fonts/Supplemental/Devanagari Sangam MN.ttc",
    "/System/Library/Fonts/Supplemental/Gujarati Sangam MN.ttc",
    "/System/Library/Fonts/Supplemental/Tamil Sangam MN.ttc",
    "/System/Library/Fonts/Supplemental/Telugu Sangam MN.ttc",
    "/System/Library/Fonts/Supplemental/Kannada Sangam MN.ttc",
    "/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf",
    # Linux script specialists. NotoSans-Regular is Latin/Greek/Cyrillic only —
    # without these, Indic text renders as tofu on any Debian-based host,
    # containers included.
    "/usr/share/fonts/truetype/noto/NotoSansDevanagari-Regular.ttf",
    "/usr/share/fonts/truetype/noto/NotoSansGujarati-Regular.ttf",
    "/usr/share/fonts/truetype/noto/NotoSansTamil-Regular.ttf",
    "/usr/share/fonts/truetype/noto/NotoSansTelugu-Regular.ttf",
    "/usr/share/fonts/truetype/noto/NotoSansKannada-Regular.ttf",
    "/usr/share/fonts/truetype/noto/NotoSansBengali-Regular.ttf",
    "/usr/share/fonts/truetype/noto/NotoSansArabic-Regular.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
]

MIN_FONT_SIZE = 8

# Paper sizes a format can lay its label out on, in inches (portrait).
#
# A label-sized artifact is what every consumer print path enlarges: handed a
# 4.45in canvas and a sheet of A4, Windows Photos' default "Fit picture to
# frame" scales it 2.5x and crops a third of the artwork off the sides. Padding
# the label out to the sheet it will actually be printed on removes the room
# for that: the artwork sits at true size in the middle of blank paper, so
# fit-to-page has almost nothing left to scale and can never crop into the art.
PAGE_SIZES_IN: dict[str, tuple[float, float]] = {
    "A4": (8.27, 11.69),
    "A5": (5.83, 8.27),
    "A6": (4.13, 5.83),
    "LETTER": (8.5, 11.0),
    "LEGAL": (8.5, 14.0),
    "4X6": (4.0, 6.0),
}

# Searched in order when no profile is configured. A CMYK TIFF with no embedded
# profile is the bug this exists to prevent: viewers fall back to a real press
# profile, and naively-separated values (C = 255 - R) come out near-black.
CMYK_PROFILE_CANDIDATES = [
    "/System/Library/ColorSync/Profiles/Generic CMYK Profile.icc",
    "/Library/ColorSync/Profiles/Generic CMYK Profile.icc",
    "/usr/share/color/icc/ghostscript/default_cmyk.icc",
    "/usr/share/color/icc/colord/CoatedFOGRA39.icc",
]


@dataclass(frozen=True)
class RenderResult:
    tiff_path: Path
    pdf_path: Path
    preview_path: Path
    width_px: int
    height_px: int
    dpi: int
    font_size_used: int
    font_path: str | None = None
    #: Characters no available font could draw — they printed as blank boxes.
    missing_glyphs: str = ""
    #: Whether the mock-up text baked into the artwork was successfully removed.
    placeholder_erased: bool = False
    colorspace: str = "RGB"
    #: White spot channels written into the TIFF, in order. Empty for a plain
    #: RGBA artifact — the press needs these named plates to lay white at all.
    spot_channels: tuple[str, ...] = ()
    #: Paper the label was centred on, or None when the artifact is label-sized.
    page_size: str | None = None
    #: Why a requested page size was not applied. Empty when there was nothing
    #: to report — the operator needs to know, because a label-sized file is the
    #: one their print dialog will enlarge.
    page_warning: str = ""


class RenderError(RuntimeError):
    pass


@lru_cache(maxsize=32)
def _font_charset(path: str) -> frozenset[int]:
    """Codepoints a font can actually draw. Empty set if the file is unreadable."""
    try:
        from fontTools.ttLib import TTCollection, TTFont

        if path.lower().endswith(".ttc"):
            with TTCollection(path, lazy=True) as collection:
                codepoints: set[int] = set()
                for font in collection.fonts:
                    codepoints.update(font.getBestCmap().keys())
                return frozenset(codepoints)

        with TTFont(path, lazy=True) as font:
            return frozenset(font.getBestCmap().keys())
    except Exception as exc:  # unreadable/exotic font — treat as no coverage
        log.warning("Could not read glyph coverage for %s: %s", path, exc)
        return frozenset()


def _available(paths: list[str]) -> list[str]:
    return [p for p in paths if Path(p).exists()]


def resolve_font_file(name: str | None) -> str | None:
    """Turn a configured font name into an absolute path.

    Bare names resolve inside the fonts directory so a print format can just say
    `You2013 Regular.ttf` without hard-coding a machine path.
    """
    if not name:
        return None
    candidate = Path(name)
    if not candidate.is_absolute():
        candidate = settings.fonts_dir / name
    return str(candidate) if candidate.exists() else None


def select_font_path(text: str, preferred: str | None = None) -> tuple[str | None, str]:
    """Pick a font that can draw `text`.

    A format's own font wins whenever it covers the text — that is the design's
    typeface and swapping it silently would change how the label looks. Only if
    it lacks glyphs do we fall back, first to the Latin faces, then to the
    broad-coverage ones. Returns the chosen path plus any characters that no
    available font can render — those would otherwise print as silent tofu
    boxes, which nobody notices until the paper comes out.
    """
    needed = {ord(ch) for ch in text if not ch.isspace()}
    chosen = resolve_font_file(preferred)
    chain = ([chosen] if chosen else []) + _available(FONT_CANDIDATES) + _available(FALLBACK_FONTS)

    if not chain:
        return None, ""
    if not needed:
        return chain[0], ""

    best_path, best_missing = chain[0], needed
    for path in chain:
        missing = needed - _font_charset(path)
        if not missing:
            return path, ""
        if len(missing) < len(best_missing):
            best_path, best_missing = path, missing

    return best_path, "".join(sorted(chr(c) for c in best_missing))


def erase_placeholder(
    image: Image.Image,
    box: tuple[int, int, int, int],
    placeholder_color: str | None,
    pad: int = 4,
) -> bool:
    """Remove the placeholder artwork (e.g. the red XXXXXXXX) from `box`.

    The box is repainted with the colour sampled from the ring just outside it,
    rather than a hard-coded white or a transparent hole. Anti-aliased glyph
    edges blend toward the background, so erasing only exact-colour pixels
    leaves a visible halo — repainting the whole box is what actually removes
    every trace.

    `placeholder_color` is a safety check, not the mechanism: the box is only
    repainted once that colour is confirmed present, so a mis-configured format
    cannot blank out real artwork. Pass None to skip the check and clear the box
    whatever is in it — right when the caller knows the area must end up empty,
    as when printing an order without its text.

    Returns False and leaves the image untouched when the surrounding area is
    not a single flat colour, because repainting would then destroy artwork.
    """
    import numpy as np

    x, y, w, h = box
    x0, y0 = max(0, x - pad), max(0, y - pad)
    x1, y1 = min(image.width, x + w + pad), min(image.height, y + h + pad)
    if x1 <= x0 or y1 <= y0:
        return False

    rgba = np.array(image.convert("RGBA"))

    # Sample the ring just outside the box to learn the background.
    ring_pad = 12
    rx0, ry0 = max(0, x0 - ring_pad), max(0, y0 - ring_pad)
    rx1, ry1 = min(image.width, x1 + ring_pad), min(image.height, y1 + ring_pad)
    window = rgba[ry0:ry1, rx0:rx1]
    inner = np.zeros(window.shape[:2], bool)
    inner[y0 - ry0 : y1 - ry0, x0 - rx0 : x1 - rx0] = True
    ring = window[~inner]
    if ring.size == 0:
        return False

    colors, counts = np.unique(ring, axis=0, return_counts=True)
    dominant = colors[counts.argmax()]
    share = counts.max() / counts.sum()
    if share < 0.9:
        log.warning(
            "Placeholder background is not a flat colour (%.0f%% dominant) — "
            "leaving the artwork alone rather than painting over it",
            share * 100,
        )
        return False

    # Confirm the placeholder is actually here before painting over anything.
    if placeholder_color is not None:
        target = np.array(_hex_to_rgb(placeholder_color))
        region = rgba[y0:y1, x0:x1, :3].astype(int)
        if not (np.abs(region - target).max(axis=2) <= 60).any():
            log.warning(
                "No %s placeholder found in the text box — nothing erased", placeholder_color
            )
            return False

    patch = Image.new("RGBA", (x1 - x0, y1 - y0), tuple(int(v) for v in dominant))
    image.paste(patch, (x0, y0))
    return True


def _load_font(size: int, path: str | None = None) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    if path is None:
        path = (_available(FONT_CANDIDATES) or _available(FALLBACK_FONTS) or [None])[0]
    if path is None:
        # Bitmap fallback: never fails, but ignores `size`.
        return ImageFont.load_default()
    try:
        return ImageFont.truetype(path, size)
    except OSError:
        return ImageFont.load_default()


@lru_cache(maxsize=1)
def find_cmyk_profile() -> str | None:
    """The CMYK ICC profile to separate with, or None if the host has none."""
    configured = settings.cmyk_icc_profile.strip()
    if configured:
        if Path(configured).exists():
            return configured
        log.error("Configured CMYK profile does not exist: %s", configured)
        return None
    for candidate in CMYK_PROFILE_CANDIDATES:
        if Path(candidate).exists():
            return candidate
    return None


@lru_cache(maxsize=1)
def _srgb_profile() -> bytes:
    """sRGB profile bytes to embed in RGB output, so viewers stop guessing."""
    from PIL import ImageCms

    return ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()


def _flatten(image: Image.Image, background: tuple[int, int, int] = (255, 255, 255)) -> Image.Image:
    """Composite onto a solid background, for formats that cannot carry alpha."""
    if image.mode != "RGBA":
        return image.convert("RGB")
    matte = Image.new("RGB", image.size, background)
    matte.paste(image, mask=image.getchannel("A"))
    return matte


def to_cmyk(image: Image.Image) -> tuple[Image.Image, bytes | None]:
    """Colour-managed sRGB -> CMYK separation.

    Returns the separated image plus the ICC profile bytes to embed. Embedding
    is not optional: an untagged CMYK TIFF is interpreted by the viewer's own
    default press profile, which is how correct-looking pixel data ends up
    printing and previewing as mud.

    Falls back to `(None profile, image unchanged in RGB)` when the host has no
    CMYK profile — a correct RGB TIFF beats a CMYK one nobody can interpret.
    """
    profile_path = find_cmyk_profile()
    if profile_path is None:
        log.warning(
            "No CMYK ICC profile found — writing an RGB TIFF instead. "
            "Set PRINTFLOW_CMYK_ICC_PROFILE to your press profile for CMYK output."
        )
        return image, None

    try:
        from PIL import ImageCms

        srgb = ImageCms.createProfile("sRGB")
        cmyk = ImageCms.getOpenProfile(profile_path)
        transform = ImageCms.buildTransform(
            srgb,
            cmyk,
            "RGB",
            "CMYK",
            renderingIntent=ImageCms.Intent.RELATIVE_COLORIMETRIC,
        )
        separated = ImageCms.applyTransform(image, transform)
        return separated, Path(profile_path).read_bytes()
    except Exception as exc:
        log.error("CMYK separation failed (%s) — writing an RGB TIFF instead", exc)
        return image, None


def resolve_page_size(name: str | None) -> tuple[float, float] | None:
    """Look up a paper size by name. None for blank or unknown names."""
    if not name:
        return None
    return PAGE_SIZES_IN.get(name.strip().upper().replace(" ", ""))


def place_on_page(
    image: Image.Image,
    page_size: str | None,
    dpi: int,
    margin_in: float | None = None,
) -> tuple[Image.Image, str | None, str]:
    """Centre `image` at true size on a `page_size` sheet at `dpi`.

    Returns the padded image, the page size actually applied, and a warning to
    surface to the operator (empty when there is nothing to say).

    The page is inset by `margin_in` per side rather than filling the sheet.
    That inset is what keeps the file printing 1:1: CUPS scales any image wider
    than the printer's printable area down to fit, so a full-bleed A4 artifact
    comes out at 0.94x on the very route that used to be correct.

    The sheet takes the label's own orientation when the label fits that way, so
    a wide label lands on a landscape page instead of a tall one. A label too big
    for either orientation is returned untouched rather than scaled down:
    shrinking it would push the artwork off the die-cut line, which is the very
    failure this padding exists to prevent.
    """
    inches = resolve_page_size(page_size)
    if inches is None:
        if page_size:
            return image, None, (
                f"Unknown page size {page_size!r} — the file was left label-sized. "
                f"Known sizes: {', '.join(sorted(PAGE_SIZES_IN))}."
            )
        return image, None, ""

    margin = settings.page_margin_in if margin_in is None else margin_in
    short_in, long_in = (side - 2 * max(0.0, margin) for side in inches)
    label_w, label_h = image.width / dpi, image.height / dpi

    if short_in <= 0 or long_in <= 0:
        return image, None, (
            f"A {margin}in margin leaves no usable area on a {page_size.strip().upper()} "
            "sheet — the file was left label-sized. Lower PRINTFLOW_PAGE_MARGIN_IN."
        )

    portrait, landscape = (short_in, long_in), (long_in, short_in)
    preferred = [landscape, portrait] if label_w > label_h else [portrait, landscape]
    fits = next(((w, h) for w, h in preferred if label_w <= w and label_h <= h), None)
    if fits is None:
        return image, None, (
            f"The {label_w:.2f}x{label_h:.2f}in label does not fit the "
            f"{long_in:.2f}x{short_in:.2f}in printable area of a {page_size.strip().upper()} "
            "sheet, so the file was left label-sized. Print it at actual size, or pick a "
            "larger page size for this format."
        )
    page_w_in, page_h_in = fits

    page_px = (max(1, round(page_w_in * dpi)), max(1, round(page_h_in * dpi)))
    # Transparent padding for artwork that carries alpha — a white matte here
    # would print the rectangle around a die-cut label that the rest of this
    # module goes out of its way to avoid.
    if image.mode == "RGBA":
        page = Image.new("RGBA", page_px, (255, 255, 255, 0))
    else:
        page = Image.new(image.mode, page_px, "white")

    offset = ((page_px[0] - image.width) // 2, (page_px[1] - image.height) // 2)
    page.paste(image, offset)
    return page, page_size.strip().upper(), ""


def _hex_to_rgb(value: str) -> tuple[int, int, int]:
    v = value.strip().lstrip("#")
    if len(v) == 3:
        v = "".join(ch * 2 for ch in v)
    if len(v) != 6:
        return (17, 17, 17)
    try:
        return (int(v[0:2], 16), int(v[2:4], 16), int(v[4:6], 16))
    except ValueError:
        return (17, 17, 17)


def _wrap(text: str, font, max_width: int, draw: ImageDraw.ImageDraw) -> list[str]:
    """Greedy word wrap; falls back to character splitting for long unbroken words."""
    lines: list[str] = []
    for paragraph in text.splitlines() or [""]:
        words = paragraph.split()
        if not words:
            lines.append("")
            continue
        current = words[0]
        for word in words[1:]:
            trial = f"{current} {word}"
            if draw.textlength(trial, font=font) <= max_width:
                current = trial
            else:
                lines.append(current)
                current = word
        lines.append(current)

    # Hard-break anything still too wide (e.g. a single 40-char token).
    out: list[str] = []
    for line in lines:
        if draw.textlength(line, font=font) <= max_width or not line:
            out.append(line)
            continue
        buf = ""
        for ch in line:
            if draw.textlength(buf + ch, font=font) <= max_width or not buf:
                buf += ch
            else:
                out.append(buf)
                buf = ch
        if buf:
            out.append(buf)
    return out


def _line_height(font, draw: ImageDraw.ImageDraw) -> int:
    bbox = draw.textbbox((0, 0), "Ag", font=font)
    return max(1, bbox[3] - bbox[1])


def fit_text(
    draw: ImageDraw.ImageDraw,
    text: str,
    box: tuple[int, int, int, int],
    start_size: int,
    font_path: str | None = None,
) -> tuple[list[str], object, int, int]:
    """Shrink the font until the wrapped text fits the box. Returns lines, font, size, line height."""
    _, _, w, h = box
    size = max(MIN_FONT_SIZE, start_size)
    while size >= MIN_FONT_SIZE:
        font = _load_font(size, font_path)
        lines = _wrap(text, font, w, draw)
        lh = _line_height(font, draw)
        leading = int(lh * 1.25)
        total = leading * len(lines)
        widest = max((draw.textlength(ln, font=font) for ln in lines), default=0)
        if total <= h and widest <= w:
            return lines, font, size, leading
        size -= 2
    font = _load_font(MIN_FONT_SIZE, font_path)
    lines = _wrap(text, font, w, draw)
    return lines, font, MIN_FONT_SIZE, int(_line_height(font, draw) * 1.25)


def _composite_psd(psd_path: Path, skip_layer: str | None) -> tuple[Image.Image, tuple[int, int, int, int] | None]:
    """Return the composited RGB image plus the placeholder layer's bbox if found."""
    if not psd_path.exists():
        raise RenderError(f"PSD template not found: {psd_path}")

    psd = PSDImage.open(psd_path)
    placeholder_bbox: tuple[int, int, int, int] | None = None

    if skip_layer:
        for layer in psd.descendants():
            if layer.name == skip_layer:
                left, top, right, bottom = layer.bbox
                placeholder_bbox = (left, top, right - left, bottom - top)
                break

    if skip_layer and placeholder_bbox is not None:
        image = psd.composite(layer_filter=lambda lyr: lyr.is_visible() and lyr.name != skip_layer)
    else:
        image = psd.composite()

    if image is None:
        # Flattened PSDs have no layer tree; fall back to the merged preview.
        image = psd.topil()
    if image is None:
        raise RenderError(f"PSD produced no composite: {psd_path}")
    # Keep RGBA: die-cut labels print on transparent stock, and flattening the
    # alpha here would silently add a white rectangle around the artwork.
    return image.convert("RGBA"), placeholder_bbox


def composite_psd(psd_path: str | Path) -> Image.Image:
    """Composite a design to RGBA, resolving bare filenames inside the PSD dir."""
    psd_path = Path(psd_path)
    if not psd_path.is_absolute():
        psd_path = settings.psd_dir / psd_path
    image, _ = _composite_psd(psd_path, None)
    return image


# ---------------------------------------------------------------------------
# White spot channels for the UV printer
#
# A UV press lays white ink first — on clear or metallic stock the colour is
# transparent without it. The RIP does not derive that plate from the artwork's
# alpha on its own: it wants named spot channels in the file, which the operator
# was adding by hand in Photoshop on every job.
#
# The structure below is copied field for field from one of those hand-made
# files, so this is a transcription rather than an interpretation:
#
#   SamplesPerPixel 6      R, G, B, Transparency, W1, W2
#   ExtraSamples    (1,0,0) alpha associated, plates unspecified
#   Photometric     2 (RGB), chunky, uncompressed
#   1006 / 1045     ['Transparency', 'W1', 'W2']
#   1053            channel ids 0, 5, 6
#   1077            alpha kind=1; each plate kind=2 (spot)
#
# Pillow can write none of this — it caps out at RGBA and cannot even set
# ExtraSamples — so the spot path goes through tifffile.
# ---------------------------------------------------------------------------

#: Display colour Photoshop shows for a spot channel: HSB(0, max, max). Cosmetic
#: — the press cares about the plate, not this swatch — but it is what the
#: operator's files carry, and matching them keeps the file recognisable.
_SPOT_DISPLAY = (1, 0, 65535, 65535, 0, 100)
_ALPHA_DISPLAY = (0, 65535, 0, 0, 0, 100)

# Deliberately NOT written: TIFF tag 37724, the "Photoshop Document Data Block".
#
# Photopea only lists spot channels when that tag is present, which makes it
# tempting to add — but the tag announces a layered document, and Photoshop then
# tries to reconstruct one. A block carrying the merged-transparency flag with no
# layer section behind it makes Photoshop refuse the file outright, and a real
# layer section would mean duplicating the whole raster.
#
# Photoshop is the authority here: the press already accepts files it wrote, and
# a flattened TIFF with spot channels is exactly what it produces. So the tag
# stays out, and Photopea simply cannot preview these channels. Verified by
# testing all three variants in Photoshop itself.


def _ps_resource(resource_id: int, data: bytes) -> bytes:
    """One 8BIM image-resource block, padded to an even length."""
    block = b"8BIM" + struct.pack(">H", resource_id) + b"\x00\x00"
    block += struct.pack(">I", len(data)) + data
    return block + (b"\x00" if len(data) % 2 else b"")


def _photoshop_channel_info(spot_names: list[str]) -> bytes:
    """The Photoshop resource block (TIFF tag 34377) that names the channels.

    Without this the extra samples are anonymous and the RIP has nothing to look
    up — which is exactly why a plain RGBA file leaves it with no white plate.
    """
    names = ["Transparency"] + spot_names
    r1006 = b"".join(bytes([len(n)]) + n.encode("latin-1") for n in names)
    # Photoshop's unicode string counts its own null terminator in the length.
    # Declaring the bare character count makes a reader treat the final letter as
    # the terminator, and the channels come out named "Transparenc" and "W".
    r1045 = b"".join(
        struct.pack(">I", len(n) + 1) + n.encode("utf-16-be") + b"\x00\x00" for n in names
    )
    # Channel ids: 0 for the transparency, then 5, 6, 7 … for the plates.
    r1053 = struct.pack(">I", 0) + b"".join(
        struct.pack(">I", 5 + i) for i in range(len(spot_names))
    )
    r1077 = struct.pack(">I", 1) + struct.pack(">HHHHHH", *_ALPHA_DISPLAY) + bytes([1])
    for _ in spot_names:
        r1077 += struct.pack(">HHHHHH", *_SPOT_DISPLAY) + bytes([2])
    return (
        _ps_resource(1006, r1006)
        + _ps_resource(1045, r1045)
        + _ps_resource(1053, r1053)
        + _ps_resource(1077, r1077)
    )


def white_plate_names(white_passes: int) -> list[str]:
    """Spot channel names for `white_passes` passes of white.

    The press file always carries the `W1`, `W2` pair — that is the layout the
    operator was building by hand, and one pass of white is what it means. Extra
    opacity is another `W1` appended, so three passes reads `W1, W2, W1, W1`:
    three W1 plates in total.
    """
    if white_passes < 1:
        return []
    return ["W1", "W2"] + ["W1"] * (white_passes - 1)


def write_spot_tiff(
    path: Path,
    image: Image.Image,
    spot_names: list[str],
    dpi: int,
    icc_profile: bytes | None,
) -> None:
    """Write `image` as RGB + Transparency + one white plate per name.

    Each plate is the inverse of the alpha. Spot channels store ink density
    inverted — 0 is full ink — so `255 - alpha` puts white under every opaque
    pixel and none in the transparent margin, which is what keeps a die-cut
    label from printing on a white rectangle.

    Every plate carries the same coverage; the count is what builds opacity.
    Names repeat on purpose — see `white_plate_names`.
    """
    rgba = np.asarray(image.convert("RGBA"), dtype=np.uint8)
    alpha = rgba[..., 3]
    # Associated alpha means the colour is premultiplied down. Photoshop writes
    # its transparency this way and the RIP reads it back on that assumption.
    coverage = alpha[..., None].astype(np.float32) / 255.0
    rgb = (rgba[..., :3].astype(np.float32) * coverage).round().clip(0, 255).astype(np.uint8)
    plate = 255 - alpha

    white_channels = len(spot_names)
    planes = [rgb[..., 0], rgb[..., 1], rgb[..., 2], alpha] + [plate] * white_channels
    data = np.stack(planes, axis=-1)
    names = list(spot_names)

    # Tag 34377 goes out as BYTE, not UNDEFINED. Photoshop writes it as BYTE and
    # readers that only look for that type — Photopea among them — skip an
    # UNDEFINED block and report no spot channels at all.
    extratags: list[tuple] = [
        (34377, 1, 0, _photoshop_channel_info(names), True),
        (274, 3, 1, 1, True),  # Orientation: top-left, as Photoshop records it
    ]
    if icc_profile:
        extratags.append((34675, 7, 0, icc_profile, True))

    # Uncompressed, because that is what the files the press already accepts look
    # like. LZW over six-plus samples is untested against this RIP, and a file it
    # silently refuses costs more than the disk does.
    tifffile.imwrite(
        str(path),
        data,
        photometric="rgb",
        extrasamples=["assocalpha"] + ["unspecified"] * white_channels,
        planarconfig="contig",
        compression=None,
        # The document block above carries byte-swapped keys, so the file has to
        # stay little-endian for a reader to find them.
        byteorder="<",
        resolution=(dpi, dpi),
        resolutionunit="INCH",
        # No shape/metadata JSON in ImageDescription — the press files carry no
        # such tag, and a stray one is one more thing for a RIP to trip over.
        metadata=None,
        extratags=extratags,
    )


def render_order(
    *,
    psd_path: str | Path,
    text: str,
    text_box: dict | None,
    text_layer_name: str | None,
    font_size: int,
    font_color: str,
    align: str,
    dpi: int,
    out_base: Path,
    colorspace: str | None = None,
    font_file: str | None = None,
    placeholder_color: str | None = None,
    preserve_alpha: bool = False,
    page_size: str | None = None,
    white_passes: int = 0,
    clear_text_area: bool = False,
) -> RenderResult:
    psd_path = Path(psd_path)
    if not psd_path.is_absolute():
        psd_path = settings.psd_dir / psd_path

    image, placeholder_bbox = _composite_psd(psd_path, text_layer_name)

    if text_box and all(k in text_box for k in ("x", "y", "w", "h")):
        box = (int(text_box["x"]), int(text_box["y"]), int(text_box["w"]), int(text_box["h"]))
    elif placeholder_bbox is not None:
        box = placeholder_bbox
    else:
        # Bottom third of the canvas with a 6% margin.
        margin = int(image.width * 0.06)
        box = (margin, int(image.height * 0.62), image.width - 2 * margin, int(image.height * 0.30))

    # Wipe the mock-up text baked into the artwork before drawing the real text,
    # otherwise the order text prints on top of the XXXXXXXX.
    placeholder_erased = False
    if clear_text_area:
        # Nothing is going to be drawn over this box, so whatever is baked into
        # it is the finished label. A format with no `placeholder_color` set
        # would otherwise ship its XXXXXXXX straight to the press — the colour
        # check exists to stop a mis-configured format destroying artwork, and
        # here the caller has already decided the area must end up empty.
        placeholder_erased = erase_placeholder(image, box, None)
    elif placeholder_color:
        placeholder_erased = erase_placeholder(image, box, placeholder_color)

    draw = ImageDraw.Draw(image)
    x, y, w, h = box
    font_path, missing_glyphs = select_font_path(text or "", font_file)
    if missing_glyphs:
        log.warning(
            "No available font covers %r — these will print as blank boxes", missing_glyphs
        )
    lines, font, size_used, leading = fit_text(draw, text or "", box, font_size, font_path)
    color = _hex_to_rgb(font_color)

    block_height = leading * len(lines)
    cursor_y = y + max(0, (h - block_height) // 2)  # vertically centred in the box
    for line in lines:
        line_width = draw.textlength(line, font=font)
        if align == "left":
            cursor_x = x
        elif align == "right":
            cursor_x = x + w - line_width
        else:
            cursor_x = x + (w - line_width) / 2
        draw.text((cursor_x, cursor_y), line, font=font, fill=color)
        cursor_y += leading

    out_base.parent.mkdir(parents=True, exist_ok=True)
    tiff_path = out_base.with_suffix(".tif")
    pdf_path = out_base.with_suffix(".pdf")
    preview_path = out_base.with_suffix(".png")

    target_space = (colorspace or settings.tiff_colorspace).upper()
    # Read the alpha off the label, not the padded sheet: transparent padding
    # would otherwise make every opaque design look like it needs alpha.
    has_alpha = image.mode == "RGBA" and image.getchannel("A").getextrema()[0] < 255

    # Pad the label out to the sheet it will be printed on. Everything the
    # printer sees is built from `sheet` from here on; the browser preview stays
    # label-only, because it is a proofreading aid rather than a print artifact.
    sheet, page_applied, page_warning = place_on_page(image, page_size, dpi)
    if page_warning:
        log.warning("%s", page_warning)

    spot_names = white_plate_names(white_passes)
    if spot_names and target_space == "CMYK":
        # The white plates are spot channels alongside RGB, and they are derived
        # from the alpha — neither survives a CMYK conversion.
        log.warning("Format asks for CMYK but needs white spot channels — writing RGB instead")
        target_space = "RGB"

    if target_space == "CMYK" and preserve_alpha and has_alpha:
        # CMYK has nowhere to put the alpha channel. Silently flattening would
        # print a white rectangle around a die-cut label, so RGB wins here.
        log.warning("Format asks for CMYK but needs transparency — writing RGB instead")
        target_space = "RGB"

    if target_space == "CMYK":
        tiff_image, icc_profile = to_cmyk(_flatten(sheet))
    elif preserve_alpha or spot_names:
        # White plates need the alpha they are derived from, so the spot path
        # always keeps transparency regardless of the flag.
        tiff_image, icc_profile = sheet, _srgb_profile()
    else:
        tiff_image, icc_profile = _flatten(sheet), _srgb_profile()

    if spot_names:
        write_spot_tiff(tiff_path, tiff_image, spot_names, dpi, icc_profile)
    else:
        save_kwargs: dict = {
            "format": "TIFF",
            "compression": settings.tiff_compression,
            "dpi": (dpi, dpi),
            "resolution_unit": 2,
        }
        if icc_profile:
            save_kwargs["icc_profile"] = icc_profile
        tiff_image.save(tiff_path, **save_kwargs)

    # PDF has no alpha channel — the proof is always matted onto white so the
    # operator sees the artwork rather than a black rectangle.
    _flatten(sheet).save(pdf_path, format="PDF", resolution=float(dpi))

    preview = image.copy()
    preview.thumbnail((1000, 1000))
    preview.save(preview_path, format="PNG", optimize=True)

    return RenderResult(
        tiff_path=tiff_path,
        pdf_path=pdf_path,
        preview_path=preview_path,
        width_px=sheet.width,
        height_px=sheet.height,
        dpi=dpi,
        font_size_used=size_used,
        font_path=font_path,
        missing_glyphs=missing_glyphs,
        placeholder_erased=placeholder_erased,
        colorspace=target_space,
        spot_channels=tuple(spot_names),
        page_size=page_applied,
        page_warning=page_warning,
    )


def psd_dimensions(psd_path: str | Path) -> tuple[int, int]:
    p = Path(psd_path)
    if not p.is_absolute():
        p = settings.psd_dir / p
    psd = PSDImage.open(p)
    return psd.width, psd.height
