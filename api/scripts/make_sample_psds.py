"""Generate the three sample PSD templates shipped with PrintFlow.

Each design is drawn at 300 DPI and written as a flattened PSD. The text zone is
left visually empty — the renderer stamps the order text into the `text_box`
coordinates returned here, which `seed.py` stores on the print format.

Run:  python -m scripts.make_sample_psds
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import settings  # noqa: E402
from app.services.psd_writer import write_psd  # noqa: E402
from app.services.renderer import _load_font  # noqa: E402

DPI = 300
RED = (218, 20, 34)
DEEP_RED = (168, 12, 24)
CREAM = (255, 248, 240)
INK = (24, 20, 20)
GOLD = (214, 170, 88)


def _mm(mm: float) -> int:
    return int(round(mm / 25.4 * DPI))


def _font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    return _load_font(size)


def _centered(draw: ImageDraw.ImageDraw, text: str, y: int, width: int, font, fill) -> None:
    w = draw.textlength(text, font=font)
    draw.text(((width - w) / 2, y), text, font=font, fill=fill)


def gift_tag() -> tuple[Image.Image, dict]:
    """100 x 150 mm portrait gift tag: solid red field, cream text panel."""
    w, h = _mm(100), _mm(150)
    img = Image.new("RGB", (w, h), RED)
    d = ImageDraw.Draw(img)

    # Diagonal ribbon texture across the top third.
    for i in range(-h, w, _mm(6)):
        d.line([(i, 0), (i + h, h)], fill=DEEP_RED, width=_mm(1))

    margin = _mm(8)
    d.rounded_rectangle(
        [margin, margin, w - margin, h - margin],
        radius=_mm(6),
        outline=CREAM,
        width=_mm(1.5),
    )

    panel = [_mm(16), _mm(52), w - _mm(16), _mm(112)]
    d.rounded_rectangle(panel, radius=_mm(4), fill=CREAM)

    _centered(d, "A GIFT FOR YOU", _mm(26), w, _font(_mm(6)), CREAM)
    d.line([(_mm(34), _mm(38)), (w - _mm(34), _mm(38))], fill=GOLD, width=_mm(1))
    _centered(d, "PRINTFLOW", h - _mm(26), w, _font(_mm(4)), CREAM)

    text_box = {
        "x": panel[0] + _mm(5),
        "y": panel[1] + _mm(5),
        "w": panel[2] - panel[0] - _mm(10),
        "h": panel[3] - panel[1] - _mm(10),
    }
    return img, text_box


def _sweep(w: int, step: int = 8) -> list[int]:
    """x samples across the full width, both endpoints always included.

    A plain range() misses x=w (or x=0 when reversed) unless the width happens
    to be divisible by the step, which leaves a sliver of background down the
    edge of any polygon built from it.
    """
    xs = list(range(0, w, step))
    xs.append(w)
    return xs


def bottle_label() -> tuple[Image.Image, dict]:
    """120 x 80 mm landscape wrap label: red field with a cream wave band."""
    w, h = _mm(120), _mm(80)
    img = Image.new("RGB", (w, h), RED)
    d = ImageDraw.Draw(img)

    # Cream wave sweeping across the middle: top edge left-to-right, bottom edge
    # right-to-left, so the polygon closes cleanly on both vertical edges.
    band_top = _mm(24)
    band_bottom = _mm(58)
    xs = _sweep(w)
    points = [(x, band_top + int(_mm(4) * math.sin(x / w * math.tau))) for x in xs]
    points += [
        (x, band_bottom + int(_mm(3) * math.sin(x / w * math.tau + 1.2))) for x in reversed(xs)
    ]
    d.polygon(points, fill=CREAM)

    d.rectangle([0, 0, w, _mm(3)], fill=GOLD)
    d.rectangle([0, h - _mm(3), w, h], fill=GOLD)

    _centered(d, "SHARE A", _mm(9), w, _font(_mm(7)), CREAM)
    _centered(d, "LIMITED EDITION", h - _mm(16), w, _font(_mm(4)), CREAM)

    text_box = {"x": _mm(10), "y": _mm(30), "w": w - _mm(20), "h": _mm(24)}
    return img, text_box


def thank_you_card() -> tuple[Image.Image, dict]:
    """148 x 105 mm A6 landscape card: cream field, red frame."""
    w, h = _mm(148), _mm(105)
    img = Image.new("RGB", (w, h), CREAM)
    d = ImageDraw.Draw(img)

    d.rectangle([0, 0, w, _mm(14)], fill=RED)
    d.rectangle([0, h - _mm(8), w, h], fill=RED)
    d.rounded_rectangle(
        [_mm(6), _mm(20), w - _mm(6), h - _mm(14)],
        radius=_mm(3),
        outline=RED,
        width=_mm(0.8),
    )

    _centered(d, "THANK YOU", _mm(3), w, _font(_mm(8)), CREAM)

    # Small decorative dots along the inner frame.
    for x in range(_mm(14), w - _mm(12), _mm(8)):
        d.ellipse([x, _mm(24), x + _mm(1.5), _mm(25.5)], fill=GOLD)

    text_box = {"x": _mm(14), "y": _mm(34), "w": w - _mm(28), "h": _mm(48)}
    return img, text_box


DESIGNS = {
    "GIFT_TAG": ("Gift Tag 100x150mm", gift_tag, {"font_size": _mm(9), "font_color": "#1A1414"}),
    "BOTTLE_LABEL": (
        "Bottle Wrap Label 120x80mm",
        bottle_label,
        {"font_size": _mm(8), "font_color": "#A80C18"},
    ),
    "THANK_YOU": (
        "Thank You Card A6",
        thank_you_card,
        {"font_size": _mm(10), "font_color": "#DA1422"},
    ),
}


def build_all() -> list[dict]:
    settings.ensure_dirs()
    out = []
    for code, (name, builder, style) in DESIGNS.items():
        img, text_box = builder()
        filename = f"{code.lower()}.psd"
        write_psd(img, settings.psd_dir / filename, DPI)
        out.append(
            {
                "code": code,
                "name": name,
                "psd_path": filename,
                "text_box": text_box,
                "dpi": DPI,
                "width_px": img.width,
                "height_px": img.height,
                **style,
            }
        )
        print(f"  {filename}  {img.width}x{img.height}px @ {DPI}dpi  text_box={text_box}")
    return out


if __name__ == "__main__":
    print(f"Writing sample PSDs to {settings.psd_dir}")
    build_all()
