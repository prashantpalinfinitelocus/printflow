# Test run — final, post code-review

- **Date:** 2026-09-21
- **Parent commit:** 5915310 (branch `feat/csv-intake-sku-brand-fields`)
- **Runner:** `./docker-test.sh tests` → `pytest -q` in the `api` container, Postgres 16 in `db`

## Results

| Layer | Total | Passed | Failed | Skipped |
|---|---|---|---|---|
| Unit / integration (pytest) | 91 | **91** | 0 | 0 |
| Playwright E2E | — | — | — | not run (no FE tooling; unchanged from final.md) |

```
91 passed, 1 warning in 37.82s
```

89 → 91: two regression tests added alongside the two fixes.

## Review items applied

### M1 — length limits now derived from the schema

`MAX_LENGTHS` is built from `Order.__table__.c[...].type.length` instead of
restating the widths. The CSV-column → model-column mapping lives in
`_LENGTH_SOURCES` (only `order_id` → `order_ref` differs). `_too_long` now
skips a `None` limit, so switching a column to `TEXT` degrades to "unbounded"
rather than raising `TypeError`.

New test — `test_the_length_limit_is_the_column_width_itself`: asserts
`MAX_LENGTHS["sku_code"]` equals the model's width, then imports a value of
exactly that width (accepted) and one character more (skipped). A boundary
test rather than a tautology — it would catch an off-by-one or a mis-mapped
column, which is what the hand-copied version could have hidden.

### M2 — `label` dropped as a brand alias

Removed from `ALIASES`, with a comment recording why so it does not get
re-added as an obvious omission. `brandname` remains.

New test — `test_label_is_not_an_alias_for_brand`: a file with a `label`
column and no `brand` column is rejected 422 for the missing required column,
rather than quietly importing print text into `brand`.

`outlet` and `location` were flagged in the review as carrying a milder
version of the same ambiguity. Left in place — not part of the selected fixes.

## Unchanged

The migration verification from `final.md` still holds: neither fix touches
`migrations.py`, `models.py` or the schema. No rebuild of the database was
needed, and the four columns remain as verified.

## Note on this run

The Docker daemon exited partway through this step and was restarted; the suite
above was run after it came back. No test was skipped or reported from a stale
run — the numbers are from a full clean execution against a rebuilt image.
