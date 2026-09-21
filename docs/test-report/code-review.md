# Self code review — feat/csv-intake-sku-brand-fields

Target: `git diff origin/main...HEAD` — 14 files, +459 / −59.
Reviewed as if someone else had written it.

No **Blocker** findings. The change is green, the migration is verified against
a populated database, and the security posture improved rather than regressed.

## Major

> **Both Major findings were fixed** after review — see
> `run-final-postreview.md`. They are kept here as written, so the record
> shows what was found rather than only what survived.

### M1 — `MAX_LENGTHS` hand-copies column widths from `models.py` — FIXED

`api/app/services/csv_import.py:57`

The parser's length limits are a second, hand-maintained copy of the widths
declared on `Order`. A comment asks the next person to keep them in sync, which
is the weakest possible enforcement. Widen `orders.sku_code` to `VARCHAR(128)`
and the importer silently keeps rejecting at 64 — a validation rule drifting
out from under the schema it exists to protect, with no test that would catch
it.

SQLAlchemy already knows the answer:

```python
MAX_LENGTHS = {
    name: Order.__table__.c[name].type.length
    for name in ("order_ref", "store_name", "city", "sku_code", "brand")
}
```

(`order_id` maps to the `order_ref` column, so that one needs the alias handled.)
Self-maintaining, and the duplication disappears.

### M2 — `"label": "brand"` is a dangerous alias in a printing system — FIXED

`api/app/services/csv_import.py:86`

"label" is at least as likely to mean *the thing being printed* as *the brand* —
this product's whole domain is printing labels. A file whose `label` column
holds the printed text would have that text silently land in `brand`, with no
error, because `text` is satisfied by its own column. Wrong data in a field,
reported as a clean import.

Suggest dropping `label` and keeping `brandname`. `outlet`/`location` carry a
milder version of the same risk but are less likely to collide.

## Minor

### m1 — `amount` is advertised as optional but absent from the template header

`api/app/routers/orders.py:200`

`columns` comes from `COLUMN_ORDER`, which deliberately omits `amount` so the
template stops promoting a deprecated field. But the new `optional` key lists
it. A UI rendering "optional columns: store_name, city, amount" alongside a
template header that has no `amount` column is telling two stories. Either drop
`amount` from the advertised `optional` list or add a `deprecated` key for it.

### m2 — the sample CSV exists twice with nothing pinning them together

`api/scripts/seed.py:36` and `data/inbox/sample_orders.csv`

Pre-existing duplication, preserved rather than introduced. They are identical
as of this commit (verified), but nothing fails if they drift. The earlier
attempt to have `seed.py` read the file at import time was reverted because
the path does not resolve inside the container — so the duplication stands.
A test comparing the two is awkward (the test harness redirects `inbox_dir` to
a temp directory), which is why it was not added.

### m3 — extra unknown columns are dropped silently and untested

`api/app/services/csv_import.py:144`

`parse_rows` keeps only canonical columns, so a file with a stray `warehouse`
column imports fine and the column vanishes. That is almost certainly the right
behaviour and it is pre-existing, but nothing pins it.

## Nit

### n1 — `_quote` is defined below its only caller

`api/tests/test_flow.py` — resolves fine at call time, reads oddly.

### n2 — `order_id` length validation is a behaviour change in disguise

`_too_long` now covers `order_ref` too. Previously a >128-char order id raised
`DataError` at COMMIT and took the batch down; now it is one skipped row. This
is a strict improvement and consistent with the change's intent, but it is not
mentioned in the commit message or the README.

## What the review confirmed as sound

- The snapshot-vs-upsert decision is enforced by an invariant test, not a
  convention — a CSV provably cannot write to `stores`.
- The length check sits before the insert rather than relying on COMMIT, which
  closes a pre-existing "one bad cell destroys a good batch" failure.
- The template endpoint is now derived from the parser's own constants and
  pinned by a test, closing the drift between advertised and accepted contract.
- Nullable columns for CSV-required fields is the right call: the constraint
  lives where the truth is visible, and no historical row needs invented data.
