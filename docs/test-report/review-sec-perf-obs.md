# Security · performance · observability review

Scope: the CSV intake enrichment change on `feat/csv-intake-sku-brand-fields`.

## Security

| Check | Finding |
|---|---|
| Authz on changed endpoints | **Pass.** `/csv/upload` and `/csv/import-from-inbox` remain `AdminUser`. `/csv/template` remains unauthenticated but now returns only static column names and a placeholder example — no store codes, no format codes, no data. |
| Store scoping | **Pass, and tightened.** `GET /orders` scoping is untouched. The snapshot decision means an uploaded CSV cannot rename a store, reassign an order to another store, or create master data — `store_name`/`city` are inert strings on the order row. `test_a_csv_can_never_mutate_the_store_master` pins this. |
| Injection | **Pass.** All four values are bound as SQLAlchemy parameters on an ORM insert. Nothing is interpolated into SQL. No shell, no template, no eval on this path. |
| Input validation at the boundary | **Pass, newly added.** Every new field is length-bounded in `_too_long()` against its column width before the insert. Previously the importer had no length validation at all. |
| Unbounded input | **Partial — pre-existing.** `print_text` is `TEXT` with no length cap, and the upload endpoint does not limit request body size. Unchanged by this work; a very large file is still a memory risk since `parse_rows` reads the whole thing into a string. Flagged, not fixed. |
| Path traversal | **Pass, unchanged.** `import_from_inbox` still does `Path(payload.filename).name`. |
| Secrets | **Pass.** None introduced. The `.env` created for local testing is gitignored and not committed. |
| PII | **Pass.** `store_name` and `city` are business-location data; `sku_code` and `brand` are product data. No new personal data. `print_text` remains the only field that may carry a customer name, and its handling is untouched. |
| Error messages | **Pass.** Row errors echo the offending value (`unknown store code 'X'`) — already the existing style, and the endpoint is admin-only, so this is not an information-disclosure path to untrusted callers. |
| Dependencies | **Pass.** No new dependency. |

### One deliberate security-relevant design choice

The alternative to snapshotting was upserting the store master from the CSV.
That would have made an admin CSV upload a write path into master data —
a file could silently rename a store or create one. Snapshotting keeps the
intake path read-only with respect to `stores`, which is why the "never mutates
the master" property is testable as an invariant rather than a convention.

## Performance

| Check | Finding |
|---|---|
| New queries | **None.** `import_csv` already preloads all stores and formats into dicts before the loop. The four new fields are scalars on an INSERT that already happened. |
| N+1 | **One pre-existing, not introduced here.** The loop issues `SELECT orders.id WHERE order_ref = ?` once per row. At the file sizes this system handles (sample is 8 rows; production files are hundreds) it is not worth restructuring inside this change. Logged as LLD open item 2 — the fix is one batched `IN` against the file's refs. |
| Indexes | **None added, deliberately.** Nothing filters or sorts on the new columns. The queue's `q` filter still covers `order_ref` and `print_text` only. An index would be write cost with no reader. Revisit if/when the queue becomes searchable by SKU. |
| Added per-row cost | Four `len()` calls on short strings. Immeasurable against the existing per-row `SELECT`. |
| Migration blocking | **Non-blocking.** `ADD COLUMN` with no default and no `NOT NULL` is a catalogue-only change in Postgres — no table rewrite, no long lock, safe on a populated `orders` table. |
| Memory | Unchanged shape: the whole file is still decoded into one string. Pre-existing; see the security row on unbounded input. |

## Observability

| Check | Finding |
|---|---|
| Per-import outcome | **Adequate, pre-existing.** Every row rejection is persisted on `csv_batches.errors` (JSONB, capped at 200) with row number, order ref and reason, and surfaced in the admin UI. The three new rejection reasons (`sku_code is blank`, `brand is blank`, `<field> is too long`) flow through that same channel, so a failed import is diagnosable without server access. |
| Structured logging | **Absent — pre-existing gap.** There is no logger on the import path at all. This change does not add one; doing so properly means a logging convention the project does not yet have. LLD open item 3. |
| Metrics / traces / alerts | **Absent — pre-existing.** No metrics backend is wired into this project. Nothing to hook into, so nothing added. |
| Silent failure risk | **Reduced.** Before this change an over-long value would raise `DataError` at COMMIT and roll back the entire batch, including rows that had already validated — the operator would see a 500 and lose the whole import with no per-row explanation. It is now one reported skipped row. This was the single most valuable finding of the review and is covered by `test_an_overlong_value_skips_its_row_without_aborting_the_batch`. |

## Outcome

No blocking issues. Nothing sent back to the fix loop.

Three pre-existing gaps are documented rather than silently inherited:
unbounded upload size, the per-row existence `SELECT`, and the absence of
structured logging on the import path. All three predate this change and all
three are recorded as open items in `docs/LLD.md`.
