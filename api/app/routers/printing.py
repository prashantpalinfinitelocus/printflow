from datetime import UTC, datetime
from pathlib import Path

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from ..config import settings
from ..deps import CurrentUser, DbSession
from ..models import JobKind, JobStatus, Order, OrderStatus, PrintJob, Role
from ..schemas import (
    Delivery,
    OrderOut,
    PrinterOut,
    PrintJobOut,
    PrintRequest,
    PrintResponse,
)
from ..services import printing as printing_service
from ..services.renderer import RenderError, render_order

router = APIRouter(tags=["printing"])

ARTIFACT_SUFFIX = {"tiff": ".tif", "pdf": ".pdf", "preview": ".png"}
ARTIFACT_MEDIA = {
    "tiff": "image/tiff",
    "pdf": "application/pdf",
    "preview": "image/png",
}


def _load_order(db, user, order_id: int) -> Order:
    stmt = select(Order).where(Order.id == order_id)
    if user.role != Role.ADMIN:
        stmt = stmt.where(Order.store_id == (user.store_id or -1))
    order = db.scalar(
        stmt.options(
            selectinload(Order.store),
            selectinload(Order.print_format),
            selectinload(Order.printed_by),
        )
    )
    if order is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Order not found or not in your store")
    return order


def _output_base(order: Order, attempt: int) -> Path:
    safe_ref = "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in order.order_ref)
    return settings.output_dir / safe_ref / f"{safe_ref}-v{attempt}"


@router.get("/printers", response_model=list[PrinterOut])
def list_printers(_: CurrentUser):
    return [
        PrinterOut(name=p.name, status=p.status, is_default=p.is_default)
        for p in printing_service.list_printers()
    ]


@router.post("/orders/{order_id}/print", response_model=PrintResponse)
def print_order(order_id: int, payload: PrintRequest, db: DbSession, user: CurrentUser):
    """Render the PSD + text, then deliver it according to `delivery`.

    PRINTER dispatches to CUPS from the server. DOWNLOAD marks the order printed
    and leaves the operator to print the file locally — the only route that works
    when the app runs in the cloud and the printer is attached to the operator's
    own machine. PROOF renders the artifacts and leaves the order status alone.

    Both PRINTER and DOWNLOAD flip the order to PRINTED and, if it was already
    PRINTED, count as a reprint.
    """
    order = _load_order(db, user, order_id)
    fmt = order.print_format
    if fmt is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Order has no print format")

    is_reprint = order.status == OrderStatus.PRINTED
    attempt = len(order.jobs) + 1

    # Passes are impressions onto one object, so they belong to a single job.
    # Three jobs would read as one print plus two reprints and make
    # `reprint_count` — the number the floor is actually measured on — useless.
    passes = max(1, fmt.print_passes or 1)

    job = PrintJob(
        order_id=order.id,
        user_id=user.id,
        kind=payload.kind,
        is_reprint=is_reprint,
        printer_name=payload.printer_name,
        status=JobStatus.QUEUED,
        passes=passes,
    )
    db.add(job)

    previous_status = order.status
    order.status = OrderStatus.PRINTING
    order.last_error = None
    db.commit()
    db.refresh(job)

    try:
        result = render_order(
            psd_path=fmt.psd_path,
            text=order.print_text,
            text_box=fmt.text_box,
            text_layer_name=fmt.text_layer_name,
            font_size=fmt.font_size,
            font_color=fmt.font_color,
            align=fmt.align,
            dpi=fmt.dpi or settings.render_dpi,
            out_base=_output_base(order, attempt),
            colorspace=fmt.colorspace,
            font_file=fmt.font_path,
            placeholder_color=fmt.placeholder_color,
            preserve_alpha=fmt.preserve_alpha,
            page_size=fmt.page_size,
            white_passes=fmt.white_passes,
        )
    except (RenderError, OSError) as exc:
        job.status = JobStatus.FAILED
        job.error = str(exc)
        order.status = OrderStatus.FAILED
        order.last_error = f"Render failed: {exc}"
        db.commit()
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, f"Render failed: {exc}") from exc

    job.tiff_path = str(result.tiff_path)
    job.pdf_path = str(result.pdf_path)
    job.font_size_used = result.font_size_used
    job.status = JobStatus.RENDERED
    db.commit()

    def mark_printed() -> None:
        order.status = OrderStatus.PRINTED
        order.printed_at = datetime.now(UTC)
        order.printed_by_id = user.id
        if is_reprint:
            order.reprint_count += 1

    mode = payload.mode
    if mode is Delivery.PRINTER:
        target = result.tiff_path if payload.kind == JobKind.TIFF else result.pdf_path
        # One submission per pass, over the same object. Separate submissions
        # rather than `lp -n`, so a pass that fails is identifiable in the audit
        # trail and the operator knows how many actually went down.
        cups_ids: list[str] = []
        for attempt_no in range(1, passes + 1):
            try:
                cups_ids.append(
                    printing_service.send_to_printer(
                        target, payload.printer_name, payload.copies
                    )
                )
            except printing_service.PrintingError as exc:
                job.status = JobStatus.FAILED
                job.passes = len(cups_ids)
                job.cups_job_id = ",".join(cups_ids) or None
                detail = (
                    f"Printer error on pass {attempt_no} of {passes}: {exc}"
                    if passes > 1
                    else f"Printer error: {exc}"
                )
                job.error = detail
                order.status = OrderStatus.FAILED
                order.last_error = detail
                db.commit()
                raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail) from exc

        job.cups_job_id = ",".join(cups_ids)
        job.status = JobStatus.SENT_TO_PRINTER
        mark_printed()
    elif mode is Delivery.DOWNLOAD:
        # The operator prints from their own machine. We cannot observe whether
        # paper actually came out, so the order is marked printed on the operator's
        # word — the same trust the CUPS path places in the spooler accepting a job.
        #
        # `passes` here is therefore the count the operator was told to run, not
        # one we watched happen. The dialog states it before they print; this is
        # what the audit trail can honestly claim.
        job.status = JobStatus.DOWNLOADED
        job.printer_name = None
        mark_printed()
    else:
        # Proof run — restore whatever the order was before we flipped to PRINTING.
        order.status = previous_status

    db.commit()
    db.refresh(order)
    db.refresh(job)

    warnings: list[str] = []
    if result.missing_glyphs:
        warnings.append(
            f"No installed font can draw these characters: {result.missing_glyphs} — "
            "they printed as blank boxes. Install a font covering that script on the API host."
        )
    if fmt.placeholder_color and not result.placeholder_erased:
        warnings.append(
            f"The {fmt.placeholder_color} placeholder could not be removed from the artwork — "
            "the order text may be printing on top of it. Check the text box position."
        )
    if fmt.white_passes and not result.spot_channels:
        warnings.append(
            f"This format asks for {fmt.white_passes} pass(es) of white but the file was "
            "written without spot channels — the press will lay no white under the artwork."
        )
    if result.page_warning:
        warnings.append(result.page_warning)
    warning = " ".join(warnings) or None

    return PrintResponse(
        job=PrintJobOut.model_validate(job),
        order=OrderOut.model_validate(order),
        tiff_url=f"/orders/{order.id}/artifact/tiff?job_id={job.id}",
        pdf_url=f"/orders/{order.id}/artifact/pdf?job_id={job.id}",
        preview_url=f"/orders/{order.id}/artifact/preview?job_id={job.id}",
        warning=warning,
    )


@router.get("/orders/{order_id}/artifact/{kind}")
def get_artifact(order_id: int, kind: str, db: DbSession, user: CurrentUser, job_id: int | None = None):
    if kind not in ARTIFACT_SUFFIX:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown artifact type")
    order = _load_order(db, user, order_id)

    jobs = sorted(order.jobs, key=lambda j: j.id, reverse=True)
    job = next((j for j in jobs if j.id == job_id), None) if job_id else next(iter(jobs), None)
    if job is None or not job.tiff_path:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No rendered artifact for this order yet")

    path = Path(job.tiff_path).with_suffix(ARTIFACT_SUFFIX[kind])
    if not path.exists():
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Artifact file is missing: {path.name}")

    inline = kind in ("pdf", "preview")
    return FileResponse(
        path,
        media_type=ARTIFACT_MEDIA[kind],
        filename=path.name,
        content_disposition_type="inline" if inline else "attachment",
    )
