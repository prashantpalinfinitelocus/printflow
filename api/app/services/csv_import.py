"""Parse and import the order CSV.

Expected header (case/space/underscore insensitive):
    order_id, store_id, amount, print_format, text

`store_id` matches Store.code; `print_format` matches PrintFormat.code.
Rows referencing an unknown store/format, a duplicate order id, or a bad
amount are skipped and reported — the batch always imports what it can.
"""

from __future__ import annotations

import csv
import io
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import CsvBatch, Order, PrintFormat, Store

REQUIRED_COLUMNS = {"order_id", "store_id", "amount", "print_format", "text"}

# Accepted aliases -> canonical column name.
ALIASES = {
    "orderid": "order_id",
    "order": "order_id",
    "orderref": "order_id",
    "storeid": "store_id",
    "store": "store_id",
    "storecode": "store_id",
    "printformat": "print_format",
    "format": "print_format",
    "psd": "print_format",
    "design": "print_format",
    "amount": "amount",
    "value": "amount",
    "text": "text",
    "printtext": "text",
    "message": "text",
}


def _normalize(name: str) -> str:
    key = "".join(ch for ch in (name or "").strip().lower() if ch.isalnum())
    return ALIASES.get(key, key)


@dataclass
class ImportResult:
    total_rows: int = 0
    imported: int = 0
    skipped: int = 0
    errors: list[dict] = field(default_factory=list)

    def error(self, row: int, order_ref: str | None, reason: str) -> None:
        self.skipped += 1
        if len(self.errors) < 200:
            self.errors.append({"row": row, "order_ref": order_ref, "reason": reason})


class CsvFormatError(ValueError):
    pass


def parse_rows(raw: bytes) -> list[dict[str, str]]:
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("latin-1")

    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise CsvFormatError("CSV is empty or has no header row")

    mapping = {name: _normalize(name) for name in reader.fieldnames}
    present = set(mapping.values())
    missing = REQUIRED_COLUMNS - present
    if missing:
        raise CsvFormatError(
            f"CSV is missing required column(s): {', '.join(sorted(missing))}. "
            f"Expected header: {', '.join(sorted(REQUIRED_COLUMNS))}"
        )

    rows: list[dict[str, str]] = []
    for raw_row in reader:
        row = {}
        for original, canonical in mapping.items():
            if canonical in REQUIRED_COLUMNS:
                row[canonical] = (raw_row.get(original) or "").strip()
        rows.append(row)
    return rows


def import_csv(
    db: Session,
    *,
    raw: bytes,
    filename: str,
    source: str,
    uploaded_by_id: int | None,
) -> tuple[CsvBatch, ImportResult]:
    rows = parse_rows(raw)
    result = ImportResult(total_rows=len(rows))

    stores = {s.code.upper(): s for s in db.scalars(select(Store)).all()}
    formats = {f.code.upper(): f for f in db.scalars(select(PrintFormat)).all()}

    batch = CsvBatch(
        filename=filename,
        source=source,
        uploaded_by_id=uploaded_by_id,
        total_rows=len(rows),
    )
    db.add(batch)
    db.flush()

    seen_in_file: set[str] = set()
    for index, row in enumerate(rows, start=2):  # row 1 is the header
        order_ref = row.get("order_id", "")
        if not order_ref:
            result.error(index, None, "order_id is blank")
            continue
        if order_ref in seen_in_file:
            result.error(index, order_ref, "duplicate order_id within this file")
            continue

        store = stores.get(row.get("store_id", "").upper())
        if store is None:
            result.error(index, order_ref, f"unknown store code '{row.get('store_id')}'")
            continue
        if not store.is_active:
            result.error(index, order_ref, f"store '{store.code}' is inactive")
            continue

        fmt = formats.get(row.get("print_format", "").upper())
        if fmt is None:
            result.error(index, order_ref, f"unknown print format '{row.get('print_format')}'")
            continue
        if not fmt.is_active:
            result.error(index, order_ref, f"print format '{fmt.code}' is inactive")
            continue

        try:
            amount = Decimal(row.get("amount") or "0")
        except (InvalidOperation, ValueError):
            result.error(index, order_ref, f"amount '{row.get('amount')}' is not a number")
            continue

        exists = db.scalar(select(Order.id).where(Order.order_ref == order_ref))
        if exists:
            result.error(index, order_ref, "order_id already exists in the system")
            continue

        db.add(
            Order(
                order_ref=order_ref,
                store_id=store.id,
                amount=amount,
                print_format_id=fmt.id,
                print_text=row.get("text", ""),
                batch_id=batch.id,
            )
        )
        seen_in_file.add(order_ref)
        result.imported += 1

    batch.imported = result.imported
    batch.skipped = result.skipped
    batch.errors = result.errors
    db.commit()
    db.refresh(batch)
    return batch, result
