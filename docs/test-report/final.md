# Test run — final (green)

- **Date:** 2026-09-21
- **Base SHA:** 778a4a3 (branch `feat/csv-intake-sku-brand-fields`)
- **Runner:** `./docker-test.sh tests` → `pytest -q` in the `api` container, Postgres 16 in `db`

## Results

| Layer | Total | Passed | Failed | Skipped |
|---|---|---|---|---|
| Unit / integration (pytest) | 89 | **89** | 0 | 0 |
| Frontend typecheck (`tsc --noEmit`) | — | clean | 0 | — |
| Playwright E2E | — | — | — | not run (see below) |

```
89 passed, 1 warning in 43.48s
```

The single warning is pre-existing: a starlette/anyio `DeprecationWarning`
unrelated to this change.

## What changed since baseline

| | Baseline (run 01) | Final |
|---|---|---|
| Passed | 33 | 89 |
| Failed | 48 | 0 |

Green on the first implementation pass — no fix iterations were needed, so
there are no `run-02..NN` reports between the baseline and this one.

## Verification the test suite could not provide

Two things pytest does not exercise, checked by hand:

1. **Migration against a pre-existing database.** The suite builds its schema
   with `create_all` on a throwaway DB, which never runs `migrations.py`. The
   `printflow` database in the `db` container was created from the *old*
   models, so the startup migration was a real forward migration. `\d orders`
   afterwards shows `store_name`, `city`, `sku_code`, `brand` appended after
   `last_error` — the ordering signature of `ALTER TABLE ADD COLUMN`, not of a
   fresh create.
2. **Idempotency.** The API container was restarted; `run_migrations()` ran a
   second time over the same database with zero errors (`ADD COLUMN IF NOT
   EXISTS`).

## Coverage of the new behaviour

| Area | Tests |
|---|---|
| Field persistence + snapshot semantics | 3 |
| Required vs optional columns | 6 |
| `amount` demotion | 3 |
| Edge cases (unicode, quoting, over-long values) | 2 |
| Template / parser drift | 1 |
| Reshaped pre-existing CSV specs | 12 |

No coverage tooling is configured in this repo, so no line-coverage figure is
reported rather than an invented one.

## Gates skipped, and why

Recorded here as the workflow requires.

| Gate | Status | Reason |
|---|---|---|
| 6.3 HLD | Skipped by agreement | No new component, service or integration. LLD written. |
| 6.4 baseline gate | Waived by user ("implement and push") | Baseline was still run and reported. |
| 6.5 per-iteration gates | Waived by user | Moot — green on the first pass. |
| 6.7 sec/perf/obs gate | Waived by user | Review still performed; see `review-sec-perf-obs.md`. |
| Step 7 JIRA comment | N/A | No ticket for this work. |
| Step 8 cross-browser | Skipped | No Playwright in the repo; FE change is a type declaration with no runtime behaviour. Typecheck run instead. |
| Step 9 push gate | Pre-approved by user | Test-pass gate **not** skipped — suite is green. |
