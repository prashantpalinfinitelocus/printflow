# Test run — print without text (green)

- **Date:** 2026-09-21
- **Branch:** `feat/print-without-text` (off main)
- **Runner:** `./docker-test.sh tests` → `pytest -q` in the `api` container

| Layer | Total | Passed | Failed |
|---|---|---|---|
| Unit / integration (pytest) | 127 | **127** | 0 |
| Frontend typecheck (`tsc --noEmit`) | — | clean | 0 |
| Manual UI verification | — | done | — |

119 → 127: 8 new specs (9 written, one folded into an existing assertion).

## Baseline

8 of the 9 new specs failed before implementation — the flag did not exist, so
every blank-print request was rejected 409 by the hold. The ninth
(`test_a_held_order_still_cannot_be_printed_with_its_text`) passed at baseline
by construction, since it asserts the *old* behaviour is preserved.

One baseline failure was my own test bug, not a product bug: the helper flagged
text with category `ABUSE`, which is not in the `Category` enum, so the fake
model's reply failed schema validation and the order fell through to the
fail-closed `NEEDS_REVIEW` path instead of `FLAGGED`. Corrected to
`ABUSE_PROFANITY`. Worth recording: the fail-closed path demonstrably works.

## Manual UI verification

Ran against the real stack (seeded DB, 8 orders imported). With no
`GEMINI_API_KEY` configured, all 8 imported as `NEEDS_REVIEW` — the
fail-closed behaviour, and a convenient source of genuinely held orders.

Confirmed on ORD-1008:

- Hold banner shows the reason, then the new explanation and a
  **Download TIFF without the text** button (DOWNLOAD because no printer is
  attached; it reads **Print** when one is).
- After clicking: order → `PRINTED`, text check → still `NEEDS REVIEW`.
- **The rendered preview's text box is empty** — the artwork's "THANK YOU"
  header is intact and the flagged dedication is absent.
- Job history shows `#1 TIFF no text DOWNLOADED`.
- **Re-download TIFF** and **PDF proof only** remain disabled — the normal
  path stays blocked while held.

## Defect found during UI verification

The dialog displayed **TYPE SIZE 118px** for a label with no type on it:
`fit_text("")` returns the starting size unchanged, so `font_size_used` was
recorded for a blank render. Fixed by setting it to `NULL` on a blank job, and
pinned in `test_the_job_records_that_it_went_out_blank`.

Found by looking at the screen, not by a test — the suite was green when it
surfaced.

## Gates

| Gate | Status |
|---|---|
| 6.2 test review | Approved by user |
| 6.3 HLD | Skipped — no new component. LLD written. |
| 6.4/6.5 inner gates | Waived ("proceed, implement and push") |
| 6.7 sec/perf/obs | Performed inline; see LLD §7 |
| Step 7 JIRA | N/A — no ticket |
| Step 8 cross-browser | Skipped — no Playwright. Manual check in the built container instead. |
| Test-pass gate | **Enforced** — 127/127 green before push |
