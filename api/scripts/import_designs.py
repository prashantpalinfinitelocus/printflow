"""Import a folder of design PSDs (and their fonts) as print formats.

Built for the 300 ml label family, but nothing here is specific to it: point
`--psd-dir` at any folder of designs whose placeholder is baked in as coloured
pixels, and give the colour and expected placeholder size for that family.

    python scripts/import_designs.py \
        --psd-dir "../../300ml/PSD" \
        --fonts-dir "../../300ml/Label/DKO_Labels_300ml_New Designs_14 Aug/Fonts" \
        --font "You2013 Regular.ttf" \
        --placeholder-color "#ED1C24" \
        --dpi 508

Re-running is safe: formats are matched on their code and updated in place, so
you can adjust a colour or DPI and import again without duplicating rows.
"""

from __future__ import annotations

import argparse
import re
import shutil
import sys
from fnmatch import fnmatch
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import settings  # noqa: E402
from app.db import Base, SessionLocal, engine  # noqa: E402
from app.migrations import run_migrations  # noqa: E402
from app.models import PrintFormat  # noqa: E402
from app.services.placeholder import (  # noqa: E402
    DEFAULT_EXPECTED_SIZE,
    PlaceholderError,
    detect_in_psd,
)
from app.services.renderer import PAGE_SIZES_IN, psd_dimensions  # noqa: E402

FONT_SUFFIXES = (".ttf", ".otf", ".ttc")


def make_code(stem: str) -> str:
    """`Polar bear Sunset` -> `POLAR_BEAR_SUNSET`."""
    return re.sub(r"[^A-Z0-9]+", "_", stem.upper()).strip("_")


def title_case(stem: str) -> str:
    return " ".join(word if word.isupper() else word.capitalize() for word in stem.split())


def parse_size(value: str) -> tuple[int, int] | None:
    if value.lower() in ("auto", "none", ""):
        return None
    match = re.fullmatch(r"\s*(\d+)\s*[xX*]\s*(\d+)\s*", value)
    if not match:
        raise argparse.ArgumentTypeError("Expected WIDTHxHEIGHT, e.g. 610x78, or 'auto'")
    return int(match.group(1)), int(match.group(2))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--psd-dir", required=True, type=Path, help="Folder of .psd designs to import")
    parser.add_argument(
        "--exclude",
        action="append",
        default=[],
        metavar="GLOB",
        help="Skip PSDs matching this glob (repeatable), e.g. --exclude 'gift_tag.psd'",
    )
    parser.add_argument("--fonts-dir", type=Path, help="Folder of fonts to copy into the fonts dir")
    parser.add_argument("--font", help="Font filename these designs should render with")
    parser.add_argument("--placeholder-color", default="#ED1C24", help="Colour of the baked-in placeholder")
    parser.add_argument("--tolerance", type=int, default=60, help="Per-channel colour match tolerance")
    parser.add_argument(
        "--placeholder-size",
        type=parse_size,
        default=DEFAULT_EXPECTED_SIZE,
        metavar="WxH",
        help="Expected placeholder size in px, e.g. 610x78; 'auto' picks the largest text-like blob",
    )
    parser.add_argument("--dpi", type=int, default=508, help="Output resolution")
    parser.add_argument("--font-size", type=int, default=112, help="Starting point size; shrinks to fit the box")
    parser.add_argument("--font-color", default="#ED1C24", help="Colour to draw the order text in")
    parser.add_argument("--align", default="center", choices=("left", "center", "right"))
    parser.add_argument("--colorspace", default="RGB", choices=("RGB", "CMYK"))
    parser.add_argument(
        "--print-passes",
        type=int,
        default=1,
        metavar="N",
        help="Times each design must be printed onto the same object. Light ink on "
        "aluminium or glass needs 2-3 passes to stop the substrate reading through.",
    )
    parser.add_argument(
        "--white-passes",
        type=int,
        default=0,
        metavar="N",
        help="Passes of white ink as spot channels. 0 = none; 1 emits the W1/W2 pair "
        "the UV press expects; each further pass appends another W1.",
    )
    parser.add_argument(
        "--page-size",
        default=None,
        help="Paper to centre the label on, e.g. A4 or 4X6. Omit for a label-sized "
        "file, which the operator's print dialog will scale up to fill their sheet.",
    )
    parser.add_argument(
        "--no-preserve-alpha",
        action="store_true",
        help="Matte the artwork onto white instead of keeping transparency (die-cut labels need transparency)",
    )
    parser.add_argument("--dry-run", action="store_true", help="Detect and report without copying or writing rows")
    args = parser.parse_args()

    psd_source = args.psd_dir.expanduser().resolve()
    if not psd_source.is_dir():
        print(f"error: --psd-dir is not a folder: {psd_source}", file=sys.stderr)
        return 2

    psd_files = sorted(p for p in psd_source.glob("*.psd") if not p.name.startswith("."))
    if args.exclude:
        skipped = [p for p in psd_files if any(fnmatch(p.name, g) for g in args.exclude)]
        psd_files = [p for p in psd_files if p not in skipped]
        # Say what was dropped — a silent skip reads as "nothing matched".
        for path in skipped:
            print(f"skip  {path.name}")
    if not psd_files:
        print(f"error: no .psd files to import in {psd_source}", file=sys.stderr)
        return 2

    if not 1 <= args.print_passes <= 10:
        print("error: --print-passes must be between 1 and 10", file=sys.stderr)
        return 2

    if not 0 <= args.white_passes <= 6:
        print("error: --white-passes must be between 0 and 6", file=sys.stderr)
        return 2

    page_size = (args.page_size or "").strip().upper().replace(" ", "") or None
    if page_size and page_size not in PAGE_SIZES_IN:
        print(
            f"error: --page-size {args.page_size!r} is not one of "
            f"{', '.join(sorted(PAGE_SIZES_IN))}",
            file=sys.stderr,
        )
        return 2

    settings.ensure_dirs()

    # --- fonts -------------------------------------------------------------
    if args.fonts_dir:
        fonts_source = args.fonts_dir.expanduser().resolve()
        if not fonts_source.is_dir():
            print(f"error: --fonts-dir is not a folder: {fonts_source}", file=sys.stderr)
            return 2
        for font in sorted(fonts_source.iterdir()):
            if font.suffix.lower() not in FONT_SUFFIXES:
                continue
            dest = settings.fonts_dir / font.name
            already_in_place = dest.exists() and font.samefile(dest)
            if not args.dry_run and not already_in_place:
                shutil.copy2(font, dest)
            print(f"font  {font.name}")

    if args.font and not args.dry_run and not (settings.fonts_dir / args.font).exists():
        print(
            f"error: --font {args.font!r} is not in {settings.fonts_dir} "
            "(copy it there or pass --fonts-dir)",
            file=sys.stderr,
        )
        return 2

    # --- designs -----------------------------------------------------------
    if not args.dry_run:
        Base.metadata.create_all(engine)
        run_migrations()

    imported, failed = 0, 0
    with SessionLocal() as db:
        for source in psd_files:
            code = make_code(source.stem)
            dest = settings.psd_dir / source.name
            # `--psd-dir` may already BE the templates dir — the normal case when
            # re-seeding a database against assets that are already in place.
            already_in_place = dest.exists() and source.samefile(dest)
            if not args.dry_run and not already_in_place:
                shutil.copy2(source, dest)

            probe = source if args.dry_run else dest
            try:
                box = detect_in_psd(
                    probe,
                    args.placeholder_color,
                    tolerance=args.tolerance,
                    expected_size=args.placeholder_size,
                )
            except PlaceholderError as exc:
                # Not fatal: the format still imports, and an admin can place the
                # box by hand in the format editor. Failing the whole run because
                # one design is off-pattern would be worse.
                print(f"WARN  {code}: {exc}")
                box = None
                failed += 1

            width, height = psd_dimensions(probe)
            if args.dry_run:
                where = f"{box.x},{box.y} {box.w}x{box.h} fill={box.fill:.1%}" if box else "not found"
                print(f"      {code:<24} {width}x{height}  placeholder {where}")
                imported += 1
                continue

            fmt = db.query(PrintFormat).filter(PrintFormat.code == code).one_or_none()
            if fmt is None:
                fmt = PrintFormat(code=code)
                db.add(fmt)
            fmt.name = title_case(source.stem)
            fmt.psd_path = source.name
            fmt.width_px, fmt.height_px = width, height
            fmt.dpi = args.dpi
            # On a failed detect, keep whatever box an admin already placed.
            fmt.text_box = box.as_dict() if box else (fmt.text_box or {})
            fmt.font_size = args.font_size
            fmt.font_color = args.font_color
            fmt.align = args.align
            fmt.font_path = args.font
            fmt.placeholder_color = args.placeholder_color
            fmt.colorspace = args.colorspace
            fmt.preserve_alpha = not args.no_preserve_alpha
            fmt.page_size = page_size
            fmt.print_passes = args.print_passes
            fmt.white_passes = args.white_passes
            fmt.is_active = True

            detected = f"{box.x},{box.y} {box.w}x{box.h}" if box else "manual"
            page = f"  page {page_size}" if page_size else ""
            reps = f"  {args.print_passes}x passes" if args.print_passes > 1 else ""
            if args.white_passes:
                from app.services.renderer import white_plate_names
                reps += "  white " + ",".join(white_plate_names(args.white_passes))
            print(f"psd   {code:<24} {width}x{height} @{args.dpi}dpi  box {detected}{page}{reps}")
            imported += 1

        if not args.dry_run:
            db.commit()

    verb = "would import" if args.dry_run else "imported"
    print(f"\n{verb} {imported} format(s); {failed} needed manual placement")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
