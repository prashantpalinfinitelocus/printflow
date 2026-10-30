# Performance report: campaign OTP and entry window

Date: 2026-10-30. Branch `feat/diet-coke-campaign`.

## Setup

* Laptop run (macOS, local Postgres 5432, one uvicorn worker, `next start`), not the Cloud Run topology.
* Client: threaded httpx load script, 1,000–2,000 requests per scenario.
* Config: bypass on, moderation off, defaults for all OTP limits.
* Two targets: the API directly (`:8000`), and through the web campaign proxy (`/offline-store/api/campaign/*`).

## Results (latency in ms)

| Scenario | Target | Conc. | Req/s | p50 | p95 | p99 | Statuses |
|---|---|---|---|---|---|---|---|
| GET window | API | 50 | 562 | 86.6 | 115.6 | 127.5 | 2000×200 |
| POST otp/send, unique phones | API | 25 | 222 | 73.9 | 271.8 | 982.8 | 1000×200 |
| POST otp/verify (bypass), unique phones | API | 25 | 428 | 49.3 | 114.7 | 151.9 | 1000×200 |
| POST otp/send, ONE phone | API | 50 | 457 | 82.5 | 164.1 | 211.9 | **5×200, 95×429** |
| GET window | Web proxy | 50 | 473 | 96.2 | 152.6 | 185.5 | 2000×200 |
| POST otp/send, unique phones | Web proxy | 25 | 379 | 57.1 | 127.9 | 168.3 | 1000×200 |
| POST otp/verify (bypass), unique phones | Web proxy | 25 | 355 | 61.6 | 139.0 | 191.1 | 1000×200 |
| POST otp/send, ONE phone | Web proxy | 50 | 407 | 97.2 | 198.9 | 226.4 | 100×429 (that phone was already blocked by the API run) |

## What this shows

* **The send limit holds under a race.** 100 concurrent sends for one phone produced exactly 5 accepted and 95 blocked.
  The per-phone row lock serialises them; without it concurrent requests could all read "4 sends so far".
* No 5xx and no errors in the API log across about 7,000 requests.
* The p99 of 983 ms on the first unique-phone send run is the cold start (first inserts into the new guard table);
  the proxy leg of the same scenario had p99 168 ms.
* The proxy adds roughly 10–20 ms at p50.

## Limits of this test

Single worker on a laptop with a local database says nothing about Cloud Run capacity or the real SMS vendor's latency.
Before launch, rerun against the test environment with Infobip enabled (vendor latency dominates `otp/send` then) and a
realistic user mix; the PRD asks for thresholds to come from load testing, and the OTP limits are all configurable.
