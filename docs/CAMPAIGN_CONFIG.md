# Consumer campaign: configuration and routing

The consumer journey is served at **`/user-campaign`** on the domain root. The staff app stays under
**`/offline-store`**. They are separate URL spaces served by the same web container.

## Routing

| URL | What | Notes |
|---|---|---|
| `/user-campaign`, `/user-campaign/*` | Consumer journey | `web/next.config.ts` proxies it to the server's own `/offline-store/user-campaign/*` (Next refuses an internal rewrite out of a basePath). In-journey navigation is a full page load (`web/lib/campaign/nav.ts`) so the address bar stays on the root URL. |
| `/offline-store/*` | Staff app, static files (`/offline-store/_next/*`), the campaign proxy (`/offline-store/api/campaign/*`) | Unchanged. |
| `/campaign/*` | Old URL | No longer served (404). |

**Load balancer (action needed, not applied from this repo):** add a path rule sending `/user-campaign/*` to the web
backend service, next to the existing `/offline-store/*` rule. Until it exists, `/user-campaign` is only reachable
as `/offline-store/user-campaign`. The rewrite target assumes the container listens on port 3000 (the Dockerfile sets
`PORT=3000`); it is fixed when the image is built.

## OTP behaviour

* **Infobip flag off (default):** nothing is texted. With the bypass on, only `PRINTFLOW_CAMPAIGN_OTP_BYPASS_CODE` logs in.
  With the bypass off too, login answers `503 OTP_UNAVAILABLE`.
* **Infobip flag on:** a random code is generated, stored only as an HMAC-SHA256 hash, and texted through Infobip's
  `/sms/3/messages` on the DLT-approved template. If any Infobip setting below is blank the API answers
  `503 OTP_UNAVAILABLE` and sends nothing. The Thums Up DLT ids are **not** reused: the defaults are blank.
* **Send limit:** a phone may request 5 codes in 5 minutes; the 6th request blocks it for 2 hours (`429 OTP_BLOCKED`,
  with `retry_after` seconds in the body and a `Retry-After` header). A blocked phone cannot verify either.
* **Verify limit:** 5 wrong codes lock verification for 2 hours (`429 OTP_LOCKED`).
* **Expiry:** a code is valid for 5 minutes and works once; a newer code replaces the previous one.
* Per-phone state lives in Postgres (`campaign_otps`, `campaign_phone_guards`) and the guard row is locked per request,
  so the limits hold across Cloud Run instances and under concurrent requests.

## Session tokens

A participant token must carry `sub`, `iat`, `exp`, `aud=campaign`, `iss=printflow-campaign`, `jti` and `ver`.
`ver` must equal the participant's `token_version`; `POST /campaign/logout` increments it and so revokes every token
issued earlier. Staff tokens (no audience) are rejected, and campaign tokens are rejected by staff routes.

## Settings

Every value is an environment variable (prefix `PRINTFLOW_`). On Cloud Run they come from Cloud Build substitutions
(`cloudbuild-api.yaml`, `cloudbuild-prod-api.yaml`), so a trigger can change any of them without a code change.

| Setting | Default | Substitution |
|---|---|---|
| `CAMPAIGN_OTP_SEND_LIMIT` | 5 | `_CAMPAIGN_OTP_SEND_LIMIT` |
| `CAMPAIGN_OTP_SEND_WINDOW_SECONDS` | 300 | `_CAMPAIGN_OTP_SEND_WINDOW_SECONDS` |
| `CAMPAIGN_OTP_BLOCK_SECONDS` | 7200 | `_CAMPAIGN_OTP_BLOCK_SECONDS` |
| `CAMPAIGN_OTP_VERIFY_MAX_FAILURES` | 5 | `_CAMPAIGN_OTP_VERIFY_MAX_FAILURES` |
| `CAMPAIGN_OTP_VERIFY_LOCK_SECONDS` | 7200 | `_CAMPAIGN_OTP_VERIFY_LOCK_SECONDS` |
| `CAMPAIGN_OTP_VERIFY_WINDOW_SECONDS` | 1800 (wrong codes count together only while each is within this of the last) | `_CAMPAIGN_OTP_VERIFY_WINDOW_SECONDS` |
| `CAMPAIGN_OTP_TTL_SECONDS` | 300 | `_CAMPAIGN_OTP_TTL_SECONDS` |
| `CAMPAIGN_OTP_LENGTH` | 6 | — |
| `CAMPAIGN_OTP_RESEND_AFTER_SECONDS` | 30 | — |
| `CAMPAIGN_MAX_ENTRIES_PER_PARTICIPANT` | 50 (0 = no cap) | `_CAMPAIGN_MAX_ENTRIES` |
| `CAMPAIGN_PAUSED` | false | `_CAMPAIGN_PAUSED` |
| `CAMPAIGN_OPEN_HOUR` / `CAMPAIGN_CLOSE_HOUR` | 10 / 22 (24 = midnight) | `_CAMPAIGN_OPEN_HOUR`, `_CAMPAIGN_CLOSE_HOUR` |
| `CAMPAIGN_TIMEZONE` | Asia/Kolkata | `_CAMPAIGN_TIMEZONE` |
| `CAMPAIGN_OTP_BYPASS` / `_CODE` | false / blank | test file only: `_CAMPAIGN_OTP_BYPASS`, `_CAMPAIGN_OTP_BYPASS_CODE`. **Prod hard-codes `false`.** |
| `CAMPAIGN_INFOBIP_ENABLED` | **false** | `_CAMPAIGN_INFOBIP_ENABLED` |
| `CAMPAIGN_INFOBIP_BASE_URL`, `_SENDER_ID`, `_DLT_ENTITY_ID`, `_DLT_TEMPLATE_ID`, `_MESSAGE` | blank | `_CAMPAIGN_INFOBIP_*` |
| `CAMPAIGN_INFOBIP_API_KEY` | blank | **Secret Manager, see below** |

`_MESSAGE` must match the DLT template text exactly with `{otp}` where the code goes. It must not contain `@`, `'` or `$`
(the env var list uses `@` as its delimiter and Cloud Build substitutes `$`).

## Turning Infobip on

1. Get the Diet Coke DLT entity id, template id, sender id and the approved text.
2. Create the secret and give the Cloud Run service account access:
   `gcloud secrets create PRINTFLOW_CAMPAIGN_INFOBIP_API_KEY --data-file=-` then grant `secretmanager.secretAccessor`.
3. Add `PRINTFLOW_CAMPAIGN_INFOBIP_API_KEY=PRINTFLOW_CAMPAIGN_INFOBIP_API_KEY:latest` to `--set-secrets` in the API
   Cloud Build file (not added yet: a missing secret fails the deploy).
4. Set the `_CAMPAIGN_INFOBIP_*` substitutions on the trigger and `_CAMPAIGN_INFOBIP_ENABLED=true`.
5. On test, switch `_CAMPAIGN_OTP_BYPASS` to `false`. Verify with a real phone before prod.

## Edge protection

`infra/cloud-armor.sh` adds rule 1050: 30 POSTs per minute per IP on `/offline-store/api/campaign/otp/(send|verify)`.
This is a loose edge limit because many users share carrier IPs; the per-phone limits above are the real control.

## Behaviour to know before release

* **Failed sends are free.** If Infobip refuses or is down, that attempt is removed from the send log, so a vendor outage
  cannot block users. A successful send still counts.
* **Resend cooldown is shown by the web app (30 s) but not enforced by the server.** The server enforces the
  5-in-5-minutes limit only. Say if a server-side minimum gap is wanted.
* **Sign-out is not wired into the web app** (the design has no sign-out screen). `POST /campaign/logout` exists and revokes
  every earlier token; the cookie otherwise simply expires after 24 h.
* **Existing sessions end on deploy.** Tokens issued before this change lack `iss`, `jti` and `ver`.
* **Lock-out of a number is possible by anyone who knows it** (6 sends or 5 wrong codes block that phone for 2 hours).
  This follows from the specified limits; the verify lock and block lengths are settings.
* **Still hard-coded in the web app:** the "10AM to 10PM" text in the heads-up popup, the `WINDOW_MESSAGE` copy and the
  6-digit OTP length. They match the defaults; change them together with the settings until the API exposes them.
* **Test environment login:** `_CAMPAIGN_OTP_BYPASS` is `true` with an empty code, which never matches. Supply
  `_CAMPAIGN_OTP_BYPASS_CODE` on the trigger or staging login stays unavailable. Production login is unavailable until
  the Infobip flag is on.
* The Infobip response status per message (for example a DLT rejection returned with HTTP 200) is not inspected yet.
