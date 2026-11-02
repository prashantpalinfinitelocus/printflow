"""Admin pages for the Diet Coke campaign: sign-in, each day's lucky draw, its
winners, their print-ready TIFFs, the winners sheet, and the PSD each design
prints from.

The campaign is its own system: campaign admins have their own accounts and
tokens (nothing here accepts a PrintFlow staff or consumer token), and each
design's PSD and text settings live in the campaign's own CampaignDesign table,
never in PrintFlow's print formats. A winner's TIFF is made by the shared PSD
renderer from that design's settings.
"""

from __future__ import annotations

import csv
import io
import shutil
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from fastapi import APIRouter, File, Form, HTTPException, Query, Response, UploadFile, status
from fastapi.responses import FileResponse, StreamingResponse
from PIL import ImageFont
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from ..config import settings
from ..deps import CampaignAdminUser, DbSession
from ..models import (
    CampaignAdmin,
    CampaignCatalogDesign,
    CampaignDesign,
    CampaignDraw,
    CampaignEntry,
    CampaignHiddenDesign,
    CampaignWinner,
)
from ..schemas import (
    CampaignAdminLogin,
    CampaignAdminOut,
    CampaignAdminSession,
    CampaignDayOut,
    CampaignDesignOut,
    CampaignDesignUpdate,
    CampaignDrawOut,
    CampaignFindPlaceholder,
    CampaignDesignSetup,
    CampaignWinnerOut,
    CatalogDesignOut,
    CatalogDesignUpdate,
    DesignVisibility,
    DetectPlaceholderResponse,
    FontOut,
    TextBox,
)
from ..security import create_campaign_admin_token, hash_password, verify_password
from ..services import campaign
from ..services.campaign import CATEGORIES, DESIGN_IDS
from ..services.campaign_catalog import StickerError, hidden_builtins, new_design_id, store_sticker
from ..services.campaign_draw import DrawNotReady, can_draw, run_draw
from ..services.placeholder import PlaceholderError, detect_in_psd
from ..services.renderer import RenderError, psd_dimensions, render_order

router = APIRouter(prefix="/campaign-admin", tags=["campaign admin"])

#: Compared against when a user ID does not exist, so a wrong user ID takes as long as a wrong password.
_NO_SUCH_ADMIN = hash_password("no such campaign admin")


# ---------------- sign-in ----------------


@router.post("/auth/login", response_model=CampaignAdminSession)
def login(payload: CampaignAdminLogin, db: DbSession):
    """These accounts see every winner's phone and email, so repeated wrong passwords lock
    the account for a while (campaign_admin_max_failed_logins, campaign_admin_lock_minutes)."""
    now = campaign.now()
    admin = db.scalar(
        select(CampaignAdmin).where(CampaignAdmin.username == payload.username.strip().lower()).with_for_update()
    )
    if admin is not None and admin.locked_until is not None and admin.locked_until > now:
        minutes = max(1, round((admin.locked_until - now).total_seconds() / 60))
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS, f"Too many wrong attempts. Try again in {minutes} minutes."
        )
    password_ok = verify_password(payload.password, admin.password_hash if admin else _NO_SUCH_ADMIN)
    if admin is not None and not password_ok:
        admin.failed_logins += 1
        if admin.failed_logins >= settings.campaign_admin_max_failed_logins:
            admin.locked_until = now + timedelta(minutes=settings.campaign_admin_lock_minutes)
            admin.failed_logins = 0
        db.commit()
    if admin is None or not password_ok or not admin.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Wrong user ID or password")
    token, expires_in = create_campaign_admin_token(admin_id=admin.id, version=admin.token_version)
    admin.failed_logins, admin.locked_until, admin.last_login_at = 0, None, now
    db.commit()
    return CampaignAdminSession(token=token, expires_in=expires_in, admin=CampaignAdminOut(username=admin.username))


@router.get("/auth/me", response_model=CampaignAdminOut)
def me(admin: CampaignAdminUser):
    return CampaignAdminOut(username=admin.username)


@router.post("/auth/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(admin: CampaignAdminUser, db: DbSession):
    admin.token_version += 1
    db.commit()


SHEET_COLUMNS = [
    "Draw day",
    "Winner #",
    "Phone",
    "Email",
    "Design",
    "Text",
    "Entered at (IST)",
    "Entry ID",
    "TIFF status",
    "TIFF link",
]


def _designs(db: Session, design_ids: set[str]) -> dict[str, CampaignDesign]:
    if not design_ids:
        return {}
    return {d.design_id: d for d in db.scalars(select(CampaignDesign).where(CampaignDesign.design_id.in_(design_ids)))}


def _winner_out(winner: CampaignWinner) -> CampaignWinnerOut:
    return CampaignWinnerOut(
        id=winner.id,
        rank=winner.rank,
        entry_id=winner.entry_id,
        phone=winner.participant.phone,
        email=winner.participant.email,
        design_id=winner.entry.design_id,
        text=winner.entry.text,
        entered_at=winner.entry.created_at,
        tiff_ready=bool(winner.tiff_path) and Path(winner.tiff_path).exists(),
        tiff_error=winner.tiff_error,
        tiff_generated_at=winner.tiff_generated_at,
    )


def _winners(db: Session, day: date) -> list[CampaignWinner]:
    return list(
        db.scalars(
            select(CampaignWinner)
            .where(CampaignWinner.campaign_day == day)
            .options(selectinload(CampaignWinner.entry), selectinload(CampaignWinner.participant))
            .order_by(CampaignWinner.rank)
        )
    )


def _day_out(db: Session, day: date) -> CampaignDayOut:
    draw = db.get(CampaignDraw, day)
    winners = _winners(db, day)
    designs = {w.entry.design_id for w in winners}
    entries = db.scalar(select(func.count()).select_from(CampaignEntry).where(CampaignEntry.campaign_day == day))
    return CampaignDayOut(
        day=day,
        entries=entries or 0,
        can_draw=draw is None and can_draw(day),
        draw=CampaignDrawOut.model_validate(draw) if draw else None,
        winners=[_winner_out(w) for w in winners],
        missing_formats=sorted(designs - set(_designs(db, designs))),
    )


@router.get("/days/{day}", response_model=CampaignDayOut)
def get_day(day: date, db: DbSession, _: CampaignAdminUser):
    if day > campaign.campaign_day(campaign.now()):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "That day is in the future; pick today or an earlier day.")
    return _day_out(db, day)


@router.post("/days/{day}/draw", response_model=CampaignDayOut)
def draw_day(day: date, db: DbSession, admin: CampaignAdminUser):
    """Runs the day's draw now, or returns the one already recorded (the scheduled job may have run it)."""
    try:
        run_draw(db, day, run_by_id=admin.id)
    except DrawNotReady as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    return _day_out(db, day)


def _load_winner(db: Session, winner_id: int) -> CampaignWinner:
    winner = db.scalar(
        select(CampaignWinner)
        .where(CampaignWinner.id == winner_id)
        .options(selectinload(CampaignWinner.entry), selectinload(CampaignWinner.participant))
    )
    if winner is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Winner not found")
    return winner


#: Cloud Run refuses a response over 32 MiB that carries a Content-Length, so big TIFFs are streamed.
STREAM_ABOVE_BYTES = 30 * 1024 * 1024


def _file_chunks(path: Path):
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            yield chunk


def _output_base(winner: CampaignWinner) -> Path:
    name = f"{winner.rank:03d}-{winner.entry.design_id}-{winner.entry_id[:8]}"
    return settings.campaign_output_dir / str(winner.campaign_day) / name


@router.post("/winners/{winner_id}/tiff", response_model=CampaignWinnerOut)
def generate_tiff(winner_id: int, db: DbSession, _: CampaignAdminUser):
    """Renders the winner's design PSD with their text, at the design's settings."""
    winner = _load_winner(db, winner_id)
    design = winner.entry.design_id
    setup = _designs(db, {design}).get(design)
    if setup is None:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"No PSD set up for {design}. Upload it under Designs.",
        )
    try:
        # The rest of render_order's settings keep their defaults: CMYK with the colour profile,
        # LZW, a can-sized page, no white plates, the same output a store print gets.
        result = render_order(
            psd_path=setup.psd_path,
            # Capitals, as the can preview shows the text and as the can is printed.
            text=winner.entry.text.upper(),
            text_box=setup.text_box,
            text_layer_name=None,
            font_size=setup.font_size,
            font_color=setup.font_color,
            align=setup.align,
            dpi=setup.dpi or settings.render_dpi,
            out_base=_output_base(winner),
            font_file=setup.font_path,
            placeholder_color=setup.placeholder_color,
            psd_dir=settings.campaign_psd_dir,
        )
    except (RenderError, OSError) as exc:
        winner.tiff_error = str(exc)
        db.commit()
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, f"TIFF failed: {exc}") from exc

    winner.tiff_path = str(result.tiff_path)
    winner.tiff_error = None
    winner.tiff_generated_at = datetime.now(UTC)
    db.commit()
    return _winner_out(winner)


@router.get("/winners/{winner_id}/tiff")
def download_tiff(winner_id: int, db: DbSession, _: CampaignAdminUser):
    winner = _load_winner(db, winner_id)
    path = Path(winner.tiff_path) if winner.tiff_path else None
    if path is None or not path.exists():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This winner's TIFF has not been generated yet")
    if path.stat().st_size > STREAM_ABOVE_BYTES:
        return StreamingResponse(
            _file_chunks(path),
            media_type="image/tiff",
            headers={"Content-Disposition": f'attachment; filename="{path.name}"'},
        )
    return FileResponse(path, media_type="image/tiff", filename=path.name)


def _cell(value: str) -> str:
    """Keeps a spreadsheet from running a cell that starts like a formula."""
    return f"'{value}" if value[:1] in ("=", "+", "-", "@", "\t", "\r") else value


def _tiff_status(winner: CampaignWinnerOut, missing: set[str]) -> str:
    if winner.tiff_ready:
        return "Ready"
    if winner.design_id in missing:
        return f"No PSD set up for {winner.design_id}"
    if winner.tiff_error:
        return f"Failed: {winner.tiff_error}"
    return "Not generated"


@router.get("/days/{day}/winners.csv")
def winners_sheet(
    day: date,
    db: DbSession,
    _: CampaignAdminUser,
    link_base: str = Query(pattern=r"^https?://\S+$", max_length=500),
):
    """The day's winners as a CSV for Excel. `link_base` is the address the admin page
    downloads through, so each TIFF link opens for a signed-in admin."""
    out = _day_out(db, day)
    missing = set(out.missing_formats)
    zone = ZoneInfo(settings.campaign_timezone)
    base = link_base.rstrip("/")

    buffer = io.StringIO()
    # A byte-order mark so Excel reads the file as UTF-8 (names in Indian scripts).
    buffer.write("﻿")
    writer = csv.writer(buffer)
    writer.writerow(SHEET_COLUMNS)
    for w in out.winners:
        writer.writerow(
            [
                str(day),
                w.rank,
                _cell(w.phone),
                _cell(w.email),
                w.design_id,
                _cell(w.text),
                w.entered_at.astimezone(zone).strftime("%Y-%m-%d %H:%M"),
                w.entry_id,
                _tiff_status(w, missing),
                f"{base}/winners/{w.id}/tiff" if w.tiff_ready else "",
            ]
        )
    return Response(
        buffer.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="winners-{day}.csv"'},
    )


# ---------------- designs: the PSD each one prints from ----------------

#: The font the can's name is set in.
CAN_FONT = "You2013 Regular.ttf"


def _design_id(design_id: str, db: Session) -> str:
    """A built-in design, or one a campaign admin added (shown or hidden)."""
    if design_id not in DESIGN_IDS and db.get(CampaignCatalogDesign, design_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not a campaign design")
    return design_id


def default_text_setup(width: int, height: int) -> dict:
    """The can's name line (CAN_LAYOUT in web/lib/campaign/canImage.ts), centred, in Diet Coke red."""
    return {
        "text_box": {
            "x": round(0.15 * width),
            "y": round(0.4694 * height),
            "w": round(0.7 * width),
            "h": round(0.058 * width * 1.6),
        },
        "font_size": round(0.058 * width),
        "font_color": "#F40009",
        "align": "center",
    }


def _design_out(design_id: str, setup: CampaignDesign | None, added: CampaignCatalogDesign | None = None) -> CampaignDesignOut:
    extra = (
        {"name": added.name, "category": added.category, "builtin": False, "active": added.is_active, "version": added.version}
        if added
        else {}
    )
    return CampaignDesignOut(
        design_id=design_id, format=CampaignDesignSetup.model_validate(setup) if setup else None, **extra
    )


@router.get("/designs", response_model=list[CampaignDesignOut])
def list_designs(db: DbSession, _: CampaignAdminUser):
    """The nine built-in designs, then the added ones in the order they were added."""
    added = list(db.scalars(select(CampaignCatalogDesign).order_by(CampaignCatalogDesign.created_at)))
    setups = _designs(db, set(DESIGN_IDS) | {a.design_id for a in added})
    hidden = set(hidden_builtins(db))
    builtin = [_design_out(d, setups.get(d)).model_copy(update={"active": d not in hidden}) for d in sorted(DESIGN_IDS)]
    return builtin + [_design_out(a.design_id, setups.get(a.design_id), a) for a in added]


@router.patch("/designs/{design_id}/visibility", response_model=CampaignDesignOut)
def set_visibility(design_id: str, payload: DesignVisibility, db: DbSession, _: CampaignAdminUser):
    """Hides a design from users, or shows it again. Works for built-in and added designs;
    entries already made with it, and their winners, keep it."""
    design_id = _design_id(design_id, db)
    added = db.get(CampaignCatalogDesign, design_id)
    if added is not None:
        added.is_active = payload.active
    else:
        hidden = db.get(CampaignHiddenDesign, design_id)
        if payload.active and hidden is not None:
            db.delete(hidden)
        elif not payload.active and hidden is None:
            db.add(CampaignHiddenDesign(design_id=design_id))
    db.commit()
    return next(d for d in list_designs(db, _) if d.design_id == design_id)


@router.get("/fonts", response_model=list[FontOut])
def list_fonts(_: CampaignAdminUser):
    """Font files the renderer can use, for the text settings."""
    out: list[FontOut] = []
    for path in sorted(settings.fonts_dir.glob("*")):
        if path.suffix.lower() not in (".ttf", ".otf", ".ttc"):
            continue
        try:
            family = ImageFont.truetype(str(path), 20).getname()[0]
        except OSError:
            family = None
        out.append(FontOut(filename=path.name, family=family))
    return out


@router.post("/designs/{design_id}/psd", response_model=CampaignDesignOut)
def upload_design_psd(design_id: str, db: DbSession, _: CampaignAdminUser, file: UploadFile = File(...)):
    """Stores the design's PSD in the campaign's own folder. A new design gets the can's
    name-line text setup; a replaced PSD keeps the text settings already made."""
    design_id = _design_id(design_id, db)
    folder = settings.campaign_psd_dir
    # One file per design, whatever the upload was called, so designs never overwrite each other.
    name = f"campaign-{design_id}.psd"
    folder.mkdir(parents=True, exist_ok=True)
    incoming = folder / f".{name}.upload"
    with incoming.open("wb") as out:
        shutil.copyfileobj(file.file, out)
    try:
        width, height = psd_dimensions(incoming.name, folder)
    except Exception as exc:
        incoming.unlink(missing_ok=True)
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"File is not a readable PSD: {exc}") from exc
    # Only a readable file replaces the design's current PSD.
    incoming.replace(folder / name)

    setup = db.get(CampaignDesign, design_id)
    if setup is None:
        setup = CampaignDesign(
            design_id=design_id,
            dpi=300,
            font_path=CAN_FONT if (settings.fonts_dir / CAN_FONT).exists() else None,
            **default_text_setup(width, height),
        )
        db.add(setup)
    setup.psd_path, setup.width_px, setup.height_px = name, width, height
    db.commit()
    db.refresh(setup)
    return _design_out(design_id, setup)


@router.patch("/designs/{design_id}", response_model=CampaignDesignOut)
def update_design(design_id: str, payload: CampaignDesignUpdate, db: DbSession, _: CampaignAdminUser):
    setup = db.get(CampaignDesign, _design_id(design_id, db))
    if setup is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Upload this design's PSD first")
    data = payload.model_dump(exclude_unset=True)
    if box := data.pop("text_box", None):
        setup.text_box = box
    for field, value in data.items():
        setattr(setup, field, value)
    db.commit()
    db.refresh(setup)
    return _design_out(design_id, setup)


@router.post("/designs/{design_id}/find-placeholder", response_model=DetectPlaceholderResponse)
def find_placeholder(design_id: str, payload: CampaignFindPlaceholder, db: DbSession, _: CampaignAdminUser):
    """Finds a baked-in placeholder (the red XXXXXXXX) of about the given size; the admin checks it before saving."""
    setup = db.get(CampaignDesign, _design_id(design_id, db))
    if setup is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Upload this design's PSD first")
    expected = (payload.expected_w, payload.expected_h) if payload.expected_w and payload.expected_h else None
    try:
        box = detect_in_psd(setup.psd_path, payload.color, expected_size=expected, psd_dir=settings.campaign_psd_dir)
    except PlaceholderError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc
    except (RenderError, OSError) as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Cannot read PSD: {exc}") from exc
    return DetectPlaceholderResponse(text_box=TextBox(x=box.x, y=box.y, w=box.w, h=box.h), fill=box.fill)


# ---------------- the catalog: designs a campaign admin adds ----------------


def _catalog_out(design: CampaignCatalogDesign) -> CatalogDesignOut:
    return CatalogDesignOut(
        design_id=design.design_id, name=design.name, category=design.category, active=design.is_active, version=design.version
    )


def _read_sticker(file: UploadFile) -> bytes:
    data = file.file.read(settings.campaign_max_sticker_bytes + 1)
    if len(data) > settings.campaign_max_sticker_bytes:
        mb = settings.campaign_max_sticker_bytes // (1024 * 1024)
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, f"The sticker must be {mb} MB or smaller.")
    return data


def _catalog_design(db: Session, design_id: str) -> CampaignCatalogDesign:
    design = db.get(CampaignCatalogDesign, design_id)
    if design is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not an added design")
    return design


@router.post("/catalog", response_model=CatalogDesignOut, status_code=status.HTTP_201_CREATED)
def add_design(
    db: DbSession,
    _: CampaignAdminUser,
    name: str = Form(...),
    category: str = Form(...),
    file: UploadFile = File(...),
):
    """Adds a design for users: shown at once in its category, with this sticker on the can."""
    # Form fields bypass the JSON schemas' validators, so the same rules are checked here.
    name = name.strip()
    if not 1 <= len(name) <= 40:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Give the design a name of up to 40 characters.")
    if category not in CATEGORIES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"The category must be one of {', '.join(CATEGORIES)}.")
    data = _read_sticker(file)
    design_id = new_design_id(db, name)
    try:
        sticker = store_sticker(design_id, data)
    except StickerError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc
    design = CampaignCatalogDesign(design_id=design_id, name=name, category=category, sticker_path=sticker, version=1)
    db.add(design)
    db.commit()
    db.refresh(design)
    return _catalog_out(design)


@router.patch("/catalog/{design_id}", response_model=CatalogDesignOut)
def update_added_design(design_id: str, payload: CatalogDesignUpdate, db: DbSession, _: CampaignAdminUser):
    """Renames, recategorises, hides or shows an added design. Its id, and so its entries, stay."""
    design = _catalog_design(db, design_id)
    data = payload.model_dump(exclude_unset=True)
    if "name" in data:
        design.name = data["name"].strip()
    if "category" in data:
        design.category = data["category"]
    if "active" in data:
        design.is_active = data["active"]
    db.commit()
    db.refresh(design)
    return _catalog_out(design)


@router.post("/catalog/{design_id}/sticker", response_model=CatalogDesignOut)
def replace_sticker(design_id: str, db: DbSession, _: CampaignAdminUser, file: UploadFile = File(...)):
    design = _catalog_design(db, design_id)
    try:
        design.sticker_path = store_sticker(design.design_id, _read_sticker(file))
    except StickerError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc
    design.version += 1
    db.commit()
    db.refresh(design)
    return _catalog_out(design)


@router.get("/catalog/{design_id}/sticker")
def added_design_sticker(design_id: str, db: DbSession, _: CampaignAdminUser):
    """The sticker for the admin page, hidden designs included."""
    path = settings.campaign_sticker_dir / _catalog_design(db, design_id).sticker_path
    if not path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "The sticker file is missing")
    return FileResponse(path, media_type="image/png")


@router.delete("/catalog/{design_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_added_design(design_id: str, db: DbSession, _: CampaignAdminUser):
    """Deletes an added design nobody has entered with, with its sticker and PSD setup. One with
    entries is kept so its entries and winners still have their design: hide it instead."""
    design = _catalog_design(db, design_id)
    if db.scalar(select(func.count()).select_from(CampaignEntry).where(CampaignEntry.design_id == design_id)):
        raise HTTPException(
            status.HTTP_409_CONFLICT, "People have entered with this design, so it can't be deleted. Hide it instead."
        )
    setup = db.get(CampaignDesign, design_id)
    files = [settings.campaign_sticker_dir / design.sticker_path]
    if setup is not None:
        files.append(settings.campaign_psd_dir / setup.psd_path)
        db.delete(setup)
    db.delete(design)
    db.commit()
    for path in files:
        path.unlink(missing_ok=True)
