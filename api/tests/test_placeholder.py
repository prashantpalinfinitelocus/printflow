"""Placeholder detection: the part that decides where the order text lands."""

from __future__ import annotations

import pytest
from PIL import Image, ImageDraw

from app.services.placeholder import (
    PlaceholderError,
    detect_placeholder,
    parse_hex,
)

RED = "#ED1C24"


def canvas(size=(1200, 600)) -> Image.Image:
    return Image.new("RGBA", size, (255, 255, 255, 255))


def draw_glyph_run(image: Image.Image, x: int, y: int, count: int = 8, w: int = 60, h: int = 78, gap: int = 18):
    """Paste a row of separate X glyphs and return the box they actually occupy.

    Drawn on a scratch layer first so the returned box is measured, not assumed —
    stroked diagonals overshoot their endpoints by half the line width.
    """
    span = count * (w + gap) - gap
    layer = Image.new("RGBA", (span + 32, h + 32), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for i in range(count):
        left = 16 + i * (w + gap)
        # Two diagonals so the blob's fill ratio looks like a letter, not a block.
        d.line([(left, 16), (left + w, 16 + h)], fill=RED, width=14)
        d.line([(left + w, 16), (left, 16 + h)], fill=RED, width=14)

    bbox = layer.getbbox()
    layer = layer.crop(bbox)
    image.alpha_composite(layer, (x, y))
    return x, y, layer.width, layer.height


def test_finds_a_glyph_run_and_merges_it_into_one_box():
    image = canvas()
    x, y, w, h = draw_glyph_run(image, 200, 250)
    box = detect_placeholder(image, RED, expected_size=(w, h))
    assert (box.x, box.y) == (x, y)
    assert box.w == pytest.approx(w, abs=2)
    assert box.h == pytest.approx(h, abs=2)


def test_ignores_same_coloured_artwork_elsewhere():
    """The regression that made naive bbox-of-all-red useless on these designs."""
    image = canvas()
    d = ImageDraw.Draw(image)
    d.ellipse([(40, 20), (240, 220)], fill=RED)  # a Coca-Cola disc
    d.rectangle([(900, 480), (1180, 560)], fill=RED)  # a solid banner
    x, y, w, h = draw_glyph_run(image, 200, 250)

    box = detect_placeholder(image, RED, expected_size=(w, h))
    assert (box.x, box.y, box.w) == (x, y, pytest.approx(w, abs=2))


def test_does_not_chain_across_unrelated_artwork():
    """A big red shape near the run must not be absorbed into the line."""
    image = canvas()
    x, y, w, h = draw_glyph_run(image, 200, 250)
    ImageDraw.Draw(image).rectangle([(x + w + 40, 120), (x + w + 400, 480)], fill=RED)

    box = detect_placeholder(image, RED, expected_size=(w, h))
    assert box.w == pytest.approx(w, abs=2)
    assert box.h == pytest.approx(h, abs=2)


def test_transparent_pixels_never_match():
    """Die-cut margins carry arbitrary RGB under zero alpha."""
    image = Image.new("RGBA", (600, 400), (237, 28, 36, 0))
    x, y, w, h = draw_glyph_run(image, 60, 150, count=4, w=50, h=60)
    box = detect_placeholder(image, RED, expected_size=(w, h))
    assert box.x == x


def test_missing_colour_is_a_clear_error():
    with pytest.raises(PlaceholderError, match="No pixels matching"):
        detect_placeholder(canvas(), "#00FF00")


def test_size_mismatch_explains_itself_rather_than_guessing():
    image = canvas()
    draw_glyph_run(image, 200, 250)
    with pytest.raises(PlaceholderError, match="off the expected"):
        detect_placeholder(image, RED, expected_size=(120, 40))


def test_solid_block_is_rejected_as_not_text():
    image = canvas()
    ImageDraw.Draw(image).rectangle([(100, 100), (710, 178)], fill=RED)
    with pytest.raises(PlaceholderError, match="no blob shaped like text"):
        detect_placeholder(image, RED, expected_size=(610, 78))


def test_parse_hex_rejects_junk():
    assert parse_hex("#ED1C24") == (237, 28, 36)
    assert parse_hex("ed1c24") == (237, 28, 36)
    with pytest.raises(PlaceholderError):
        parse_hex("red")


# ---------------- erasing the placeholder ----------------
#
# `erase_placeholder` repaints the box with the colour sampled from just
# outside it. The colour argument is a safety check — confirm the placeholder
# is really there before painting over artwork — not the mechanism.


def _red_pixels_in(image: Image.Image, box: tuple[int, int, int, int]) -> int:
    import numpy as np

    x, y, w, h = box
    region = np.array(image.convert("RGB").crop((x, y, x + w, y + h))).astype(int)
    target = np.array([237, 28, 36])  # RED
    return int((np.abs(region - target).max(axis=2) <= 60).sum())


def test_clearing_removes_a_placeholder_that_overflows_its_box():
    """The staging failure: text_box h=60, the mock-up ink h=79.

    `text_box` is where copy gets typeset, not a promise about where the
    designer's mock-up ink falls. When the ink overruns it, clearing only the
    box leaves the overflow behind *and* poisons the background sample that
    `erase_placeholder` relies on.
    """
    from app.services.renderer import clear_ink_in_box

    image = canvas()
    ink = draw_glyph_run(image, 300, 200)
    assert _red_pixels_in(image, ink) > 0

    # A box 19px shorter than the ink, centred on it — staging's proportions.
    short_box = (ink[0], ink[1] + 10, ink[2], ink[3] - 19)
    assert short_box[3] < ink[3]

    assert clear_ink_in_box(image, short_box) is True
    assert _red_pixels_in(image, ink) == 0, "the overflow must go too, not just the boxed part"


def test_clearing_a_box_needs_no_declared_colour():
    from app.services.renderer import clear_ink_in_box

    image = canvas()
    box = draw_glyph_run(image, 300, 200)
    assert clear_ink_in_box(image, box) is True
    assert _red_pixels_in(image, box) == 0


def test_clearing_an_already_empty_box_is_a_no_op_that_succeeds():
    from app.services.renderer import clear_ink_in_box

    image = canvas()
    before = image.tobytes()
    assert clear_ink_in_box(image, (300, 200, 400, 80)) is True
    assert image.tobytes() == before


def test_clearing_refuses_when_the_ink_runs_on_into_artwork():
    """Ink continuing past the search window is design, not a placeholder."""
    from app.services.renderer import clear_ink_in_box

    image = canvas()
    d = ImageDraw.Draw(image)
    # A band far wider than any search window around the box.
    d.rectangle([0, 180, 1200, 320], fill=(20, 80, 160, 255))

    before = image.tobytes()
    assert clear_ink_in_box(image, (300, 200, 400, 80)) is False
    assert image.tobytes() == before, "artwork must be left alone, not painted over"


def test_a_wrong_placeholder_colour_still_protects_the_artwork():
    """Unchanged on the normal path: no confirmed placeholder, no paint."""
    from app.services.renderer import erase_placeholder

    image = canvas()
    box = draw_glyph_run(image, 300, 200)

    before = image.tobytes()
    assert erase_placeholder(image, box, "#00FF00") is False
    assert image.tobytes() == before
