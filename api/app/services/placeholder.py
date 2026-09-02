"""Locate the baked-in text placeholder inside a design.

The client's artwork carries the placeholder as coloured pixels (a red XXXXXXXX
in the 300 ml labels) rather than as an editable text layer, so the only way to
know where the order text belongs is to find those pixels.

Naive "bounding box of every red pixel" fails on these designs: seven of the
eight have red in the artwork itself (Coca-Cola discs, hearts, stamp borders),
so the box comes back spanning most of the label. The fix is to group the red
pixels into connected blobs and keep only the one whose shape matches the
placeholder — the placeholders are set in the same font at the same size across
the whole design family, so they are all near-identical in size and fill ratio.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path

import numpy as np

log = logging.getLogger(__name__)

#: Placeholders in the 300 ml family measure 610x78 px. Blobs are matched
#: against this with `size_tolerance`; override for a design family set at a
#: different size.
DEFAULT_EXPECTED_SIZE = (610, 78)

#: A run of X glyphs covers roughly this share of its bounding box. Solid
#: rectangles (colour swatches, borders) sit near 1.0 and are rejected.
FILL_RANGE = (0.25, 0.75)


class PlaceholderError(RuntimeError):
    pass


@dataclass(frozen=True)
class PlaceholderBox:
    x: int
    y: int
    w: int
    h: int
    #: Share of the bounding box that is actually placeholder-coloured.
    fill: float

    def as_dict(self) -> dict[str, int]:
        return {"x": self.x, "y": self.y, "w": self.w, "h": self.h}


def parse_hex(color: str) -> tuple[int, int, int]:
    value = color.strip().lstrip("#")
    if len(value) != 6:
        raise PlaceholderError(f"Expected a #RRGGBB colour, got {color!r}")
    try:
        return tuple(int(value[i : i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]
    except ValueError as exc:
        raise PlaceholderError(f"Expected a #RRGGBB colour, got {color!r}") from exc


def color_mask(image, color: str, tolerance: int = 60) -> np.ndarray:
    """Boolean mask of pixels within `tolerance` of `color` in each channel.

    Transparent pixels never match: a fully transparent pixel can carry any RGB
    value at all, and the die-cut labels have large transparent margins that
    would otherwise flood the mask.
    """
    target = np.array(parse_hex(color), dtype=np.int16)
    rgba = np.asarray(image.convert("RGBA"), dtype=np.int16)
    close = np.abs(rgba[:, :, :3] - target).max(axis=2) <= tolerance
    return close & (rgba[:, :, 3] > 127)


def _label_runs(mask: np.ndarray) -> list[tuple[int, int, int, int, int]]:
    """4-connected components as (x0, y0, x1, y1, area), via row runs.

    Row-run union-find rather than a per-pixel flood fill: a 2260x2290 label has
    tens of thousands of placeholder pixels but only a few hundred runs, so this
    stays fast without pulling in scipy or scikit-image.
    """
    parent: list[int] = []

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def union(a: int, b: int) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[max(ra, rb)] = min(ra, rb)

    height, width = mask.shape
    # Per-run record: [label, x0, x1, y]
    runs: list[list[int]] = []
    prev_row: list[int] = []  # indices into `runs` for the previous row

    for y in range(height):
        row = mask[y]
        if not row.any():
            prev_row = []
            continue
        # Run boundaries from the diff of the padded row.
        padded = np.concatenate(([False], row, [False]))
        edges = np.flatnonzero(padded[1:] != padded[:-1])
        starts, ends = edges[0::2], edges[1::2]  # ends are exclusive

        current_row: list[int] = []
        for x0, x_end in zip(starts, ends):
            idx = len(runs)
            parent.append(idx)
            runs.append([idx, int(x0), int(x_end) - 1, y])
            current_row.append(idx)
            for prev_idx in prev_row:
                _, px0, px1, _ = runs[prev_idx]
                if px0 <= x_end - 1 and x0 <= px1:  # horizontal overlap
                    union(idx, prev_idx)
        prev_row = current_row

    boxes: dict[int, list[int]] = {}
    for idx, x0, x1, y in runs:
        root = find(idx)
        box = boxes.get(root)
        if box is None:
            boxes[root] = [x0, y, x1, y, x1 - x0 + 1]
        else:
            box[0] = min(box[0], x0)
            box[1] = min(box[1], y)
            box[2] = max(box[2], x1)
            box[3] = max(box[3], y)
            box[4] += x1 - x0 + 1
    return [tuple(b) for b in boxes.values()]  # type: ignore[misc]


def _merge_into_lines(
    blobs: list[tuple[int, int, int, int, int]],
    *,
    gap_ratio: float,
    overlap_ratio: float = 0.5,
    height_ratio: float = 0.4,
) -> list[tuple[int, int, int, int, int]]:
    """Group per-glyph blobs back into text lines.

    The placeholder is a run of separate X glyphs, so connected-component
    labelling returns eight blobs, not one. Two blobs join when they sit on the
    same line — vertical spans overlapping by at least `overlap_ratio` of the
    shorter — and the horizontal gap between them is under `gap_ratio` of the
    glyph height, which is the inter-letter spacing of any normal typeface.

    Both thresholds are measured against the height of the line's *first* glyph,
    never the accumulated bounding box. Letting the line's height grow as it
    absorbs blobs also grows the permitted gap, which chains runaway across
    unrelated artwork — on the DRD label that produced a 2099x527 "line".
    Requiring each new blob to be within `height_ratio` of the seed glyph stops
    a Coca-Cola disc or a stamp border from joining a run of letters.
    """
    lines: list[list[int]] = []  # [x0, y0, x1, y1, area, seed_height]

    for x0, y0, x1, y1, area in sorted(blobs, key=lambda b: b[0]):  # left to right
        height = y1 - y0 + 1
        for line in lines:
            lx1, ly0, ly1, seed_h = line[2], line[1], line[3], line[5]
            if abs(height - seed_h) > height_ratio * seed_h:
                continue
            if min(y1, ly1) - max(y0, ly0) + 1 < overlap_ratio * min(height, ly1 - ly0 + 1):
                continue
            if x0 - lx1 - 1 > gap_ratio * seed_h:
                continue
            line[0], line[1] = min(line[0], x0), min(ly0, y0)
            line[2], line[3] = max(lx1, x1), max(ly1, y1)
            line[4] += area
            break
        else:
            lines.append([x0, y0, x1, y1, area, height])

    return [tuple(line[:5]) for line in lines]  # type: ignore[misc]


def detect_placeholder(
    image,
    color: str,
    *,
    tolerance: int = 60,
    expected_size: tuple[int, int] | None = DEFAULT_EXPECTED_SIZE,
    size_tolerance: float = 0.08,
) -> PlaceholderBox:
    """Find the placeholder blob in a composited design.

    With `expected_size`, blobs are ranked by how closely they match it — that
    is what separates the placeholder from same-coloured artwork. Pass
    `expected_size=None` for a design family whose size you do not know yet; the
    largest blob with a text-like fill ratio is used instead, which is only
    reliable when the placeholder colour appears nowhere else.
    """
    mask = color_mask(image, color, tolerance)
    if not mask.any():
        raise PlaceholderError(
            f"No pixels matching {color} (tolerance {tolerance}) — "
            "check the placeholder colour against the artwork"
        )

    # Drop specks before grouping: anti-aliased fringing around red artwork
    # leaves stray pixels that would otherwise stretch a line's bounding box.
    blobs = [b for b in _label_runs(mask) if b[4] >= 12]

    # No single letter-spacing works across a design family — tight display type
    # and airy script both appear here. Sweep the gap ratio and pool every line
    # any pass produces; the size match below picks the right one.
    seen: set[tuple[int, int, int, int]] = set()
    candidates: list[PlaceholderBox] = []
    for gap_ratio in (0.25, 0.4, 0.6, 0.9):
        for x0, y0, x1, y1, area in _merge_into_lines(blobs, gap_ratio=gap_ratio):
            if (x0, y0, x1, y1) in seen:
                continue
            seen.add((x0, y0, x1, y1))
            w, h = x1 - x0 + 1, y1 - y0 + 1
            fill = area / (w * h)
            if not FILL_RANGE[0] <= fill <= FILL_RANGE[1]:
                continue
            candidates.append(PlaceholderBox(x=x0, y=y0, w=w, h=h, fill=round(fill, 4)))

    if not candidates:
        raise PlaceholderError(
            f"Found {color} pixels but no blob shaped like text "
            f"(fill ratio outside {FILL_RANGE}) — the colour may match solid artwork"
        )

    if expected_size is None:
        return max(candidates, key=lambda b: b.w * b.h)

    ew, eh = expected_size

    def deviation(box: PlaceholderBox) -> float:
        return max(abs(box.w - ew) / ew, abs(box.h - eh) / eh)

    best = min(candidates, key=deviation)
    if deviation(best) > size_tolerance:
        raise PlaceholderError(
            f"Closest {color} blob is {best.w}x{best.h}, more than "
            f"{size_tolerance:.0%} off the expected {ew}x{eh}. "
            "Set the expected size to match this design family, or place the box by hand."
        )
    return best


def detect_in_psd(
    psd_path: str | Path,
    color: str,
    *,
    tolerance: int = 60,
    expected_size: tuple[int, int] | None = DEFAULT_EXPECTED_SIZE,
    size_tolerance: float = 0.08,
) -> PlaceholderBox:
    from .renderer import composite_psd

    return detect_placeholder(
        composite_psd(psd_path),
        color,
        tolerance=tolerance,
        expected_size=expected_size,
        size_tolerance=size_tolerance,
    )
