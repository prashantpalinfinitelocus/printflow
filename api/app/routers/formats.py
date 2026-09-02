from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile, status
from PIL import ImageFont
from sqlalchemy import func, select

from ..config import settings
from ..deps import AdminUser, CurrentUser, DbSession
from ..models import Order, PrintFormat
from ..schemas import (
    DetectPlaceholderRequest,
    DetectPlaceholderResponse,
    FontOut,
    PageSizeOut,
    PrintFormatCreate,
    PrintFormatOut,
    PrintFormatUpdate,
    TextBox,
)
from ..services.placeholder import PlaceholderError, detect_in_psd
from ..services.renderer import PAGE_SIZES_IN, RenderError, psd_dimensions

router = APIRouter(prefix="/print-formats", tags=["print-formats"])


@router.get("", response_model=list[PrintFormatOut])
def list_formats(db: DbSession, _: CurrentUser, include_inactive: bool = True):
    stmt = select(PrintFormat).order_by(PrintFormat.code)
    if not include_inactive:
        stmt = stmt.where(PrintFormat.is_active.is_(True))
    return db.scalars(stmt).all()


@router.post("", response_model=PrintFormatOut, status_code=status.HTTP_201_CREATED)
def create_format(payload: PrintFormatCreate, db: DbSession, _: AdminUser):
    code = payload.code.strip().upper()
    if db.scalar(select(PrintFormat.id).where(PrintFormat.code == code)):
        raise HTTPException(status.HTTP_409_CONFLICT, f"Format code '{code}' already exists")

    try:
        width, height = psd_dimensions(payload.psd_path)
    except Exception as exc:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, f"Cannot read PSD: {exc}"
        ) from exc

    fmt = PrintFormat(
        code=code,
        name=payload.name,
        psd_path=payload.psd_path,
        width_px=width,
        height_px=height,
        dpi=payload.dpi,
        text_box=payload.text_box.model_dump(),
        text_layer_name=payload.text_layer_name,
        font_size=payload.font_size,
        font_color=payload.font_color,
        align=payload.align,
        font_path=payload.font_path,
        placeholder_color=payload.placeholder_color,
        colorspace=payload.colorspace,
        preserve_alpha=payload.preserve_alpha,
        page_size=payload.page_size,
        print_passes=payload.print_passes,
        white_passes=payload.white_passes,
        is_active=payload.is_active,
    )
    db.add(fmt)
    db.commit()
    db.refresh(fmt)
    return fmt


@router.patch("/{format_id}", response_model=PrintFormatOut)
def update_format(format_id: int, payload: PrintFormatUpdate, db: DbSession, _: AdminUser):
    fmt = db.get(PrintFormat, format_id)
    if fmt is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Print format not found")

    data = payload.model_dump(exclude_unset=True)
    if box := data.pop("text_box", None):
        fmt.text_box = box
    if new_path := data.get("psd_path"):
        try:
            fmt.width_px, fmt.height_px = psd_dimensions(new_path)
        except Exception as exc:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY, f"Cannot read PSD: {exc}"
            ) from exc
    for field, value in data.items():
        setattr(fmt, field, value)

    db.commit()
    db.refresh(fmt)
    return fmt


@router.delete("/{format_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_format(format_id: int, db: DbSession, _: AdminUser):
    fmt = db.get(PrintFormat, format_id)
    if fmt is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Print format not found")
    if db.scalar(select(func.count(Order.id)).where(Order.print_format_id == format_id)):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Format is referenced by orders — deactivate it instead",
        )
    db.delete(fmt)
    db.commit()


@router.post("/detect-placeholder", response_model=DetectPlaceholderResponse)
def detect_placeholder_box(payload: DetectPlaceholderRequest, _: AdminUser):
    """Find the baked-in placeholder in a design and return its box.

    Lets an admin place the text box by pointing at the placeholder's colour
    instead of reading coordinates out of Photoshop.
    """
    expected = (
        (payload.expected_w, payload.expected_h)
        if payload.expected_w and payload.expected_h
        else None
    )
    try:
        box = detect_in_psd(
            payload.psd_path,
            payload.color,
            tolerance=payload.tolerance,
            expected_size=expected,
        )
    except PlaceholderError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc
    except (RenderError, OSError) as exc:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, f"Cannot read PSD: {exc}"
        ) from exc
    return DetectPlaceholderResponse(
        text_box=TextBox(x=box.x, y=box.y, w=box.w, h=box.h), fill=box.fill
    )


@router.get("/page-sizes", response_model=list[PageSizeOut])
def list_page_sizes(_: CurrentUser):
    """Paper sizes a format can lay its label out on, for the format editor."""
    return [
        PageSizeOut(name=name, width_in=w, height_in=h)
        for name, (w, h) in sorted(PAGE_SIZES_IN.items())
    ]


@router.get("/fonts", response_model=list[FontOut])
def list_fonts(_: CurrentUser):
    """Font files installed in the fonts directory, for the format editor."""
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


@router.post("/upload-font", status_code=status.HTTP_201_CREATED)
async def upload_font(_: AdminUser, file: UploadFile = File(...)):
    name = Path(file.filename or "").name
    if Path(name).suffix.lower() not in (".ttf", ".otf", ".ttc"):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "Only .ttf, .otf and .ttc fonts are accepted"
        )
    dest = settings.fonts_dir / name
    dest.write_bytes(await file.read())
    try:
        family = ImageFont.truetype(str(dest), 20).getname()[0]
    except OSError as exc:
        dest.unlink(missing_ok=True)
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, f"File is not a readable font: {exc}"
        ) from exc
    return {"filename": name, "family": family}


@router.post("/upload-psd", status_code=status.HTTP_201_CREATED)
async def upload_psd(_: AdminUser, file: UploadFile = File(...)):
    """Store a .psd in the template directory and report its pixel dimensions."""
    name = Path(file.filename or "").name
    if not name.lower().endswith(".psd"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Only .psd files are accepted")

    dest = settings.psd_dir / name
    dest.write_bytes(await file.read())
    try:
        width, height = psd_dimensions(dest)
    except Exception as exc:
        dest.unlink(missing_ok=True)
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, f"File is not a readable PSD: {exc}"
        ) from exc
    return {"psd_path": name, "width_px": width, "height_px": height}
