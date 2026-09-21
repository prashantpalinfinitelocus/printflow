# Test run 01 — baseline (red)

- **Date:** 2026-09-21
- **Git SHA:** 778a4a3 (branch `feat/csv-intake-sku-brand-fields`)
- **Runner:** `./docker-test.sh tests/test_flow.py` → `pytest -q` in the `api` container, Postgres 16 in `db`
- **Layers run:** unit / integration only. **Playwright E2E: not run** — no FE test tooling exists in this repo and the frontend change is a type declaration. Agreed skip.

## Results

| Layer | Total | Passed | Failed | Skipped |
|---|---|---|---|---|
| Unit / integration (pytest) | 81 | 33 | 48 | 0 |
| Playwright E2E | — | — | — | skipped by agreement |

## Why 48 and not 16

The new `CSV_HEADER` omits `amount` and adds `sku_code` / `brand`, which the
parser does not know yet. Every upload in the suite is therefore rejected at the
header check with 422, so all 32 downstream tests that rely on an imported order
fail with `IndexError` on an empty `items` list. That is the expected shape of
this baseline: the contract moved, the parser has not.

## Failure groups

| Group | Count | Representative failure |
|---|---|---|
| New contract specs (the 16 written for this change) | 16 | `KeyError: 'sku_code'` — field absent from `OrderOut` |
| Existing CSV-import specs reshaped onto the new header | 6 | `AssertionError` — 422 "missing required column(s): sku_code, brand" |
| Downstream render / print / page-size / pass specs | 26 | `IndexError: list index out of range` — no order to print, upload was rejected |

## Still green (33)

Auth, authorization, printer discovery, format-configuration endpoints, user
management, placeholder detection — everything that never touches CSV intake.
Confirms the blast radius is the intake path and nothing wider.
