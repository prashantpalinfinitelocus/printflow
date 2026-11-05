# Consumer campaign: configuration and routing

The consumer campaign is served at the **domain root** (`/`, with the rest of the journey under `/user-campaign/*`). The
staff app stays under **`/offline-store`**. They are separate URL spaces served by the same web container.

## Routing

| URL | What | Notes |
|---|---|---|
| `/` | Consumer landing (the campaign) | The bare domain. `web/next.config.ts` proxies it to the server's own `/offline-store/user-campaign` (Next refuses an internal rewrite out of a basePath). `/?login=1` opens the login. |
| `/user-campaign` | Old landing address | Redirects (307) to `/`, keeping the query. |
| `/user-campaign/*` | Rest of the journey: `create`, `preview`, `success`, `terms`, `privacy`, `admin` | Proxied the same way. In-journey navigation is a full page load (`web/lib/campaign/nav.ts`) so the address bar stays on the root domain. |
| `/offline-store/*` | Staff app, static files (`/offline-store/_next/*`), the campaign proxy (`/offline-store/api/campaign/*`) | Unchanged. Staff now open `/offline-store` directly: the bare domain used to redirect there and no longer does. |
| `/campaign/*` | Old URL | No longer served (404). |

**Load balancer:** on the test domain no new rule was needed (unknown paths already reach the web service). Verify the same on production before launch, including that `/` itself reaches the web service. The rewrite target assumes the container listens on port 3000 (the Dockerfile sets `PORT=3000`); it is fixed when the image is built.

## OTP behaviour

* **Infobip flag off (default):** nothing is texted. With the bypass on, only `PRINTFLOW_CAMPAIGN_OTP_BYPASS_CODE` logs in.
  With the bypass off too, login answers `503 OTP_UNAVAILABLE`.
* **Infobip flag on:** a random code is generated, stored only as an HMAC-SHA256 hash, and texted through Infobip's
  `/sms/3/messages` on the DLT-approved template. If any Infobip setting below is blank the API answers
  `503 OTP_UNAVAILABLE` and sends nothing. The code defaults are blank; the Diet Coke template ids are set in the Cloud Build files (below).
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
| `CAMPAIGN_OTP_BYPASS` / `_CODE` | false / blank | test file only: `_CAMPAIGN_OTP_BYPASS` (substitution) and the code from Secret Manager `PRINTFLOW_CAMPAIGN_OTP_BYPASS_CODE`. **Prod hard-codes `false`.** |
| `CAMPAIGN_INFOBIP_ENABLED` | **false** | `_CAMPAIGN_INFOBIP_ENABLED` (test: **true**, prod: false) |
| `CAMPAIGN_INFOBIP_BASE_URL` | blank | Secret Manager `PRINTFLOW_CAMPAIGN_INFOBIP_BASE_URL` (test and prod) |
| `CAMPAIGN_INFOBIP_SENDER_ID`, `_DLT_ENTITY_ID`, `_DLT_TEMPLATE_ID`, `_MESSAGE` | blank | `_CAMPAIGN_INFOBIP_*`, set to the Diet Coke template below in both Cloud Build files |
| `CAMPAIGN_INFOBIP_API_KEY` | blank | Secret Manager `PRINTFLOW_CAMPAIGN_INFOBIP_API_KEY` (test and prod) |

`_MESSAGE` must match the DLT template text exactly with `{otp}` where the code goes. It must not contain `@`, `'` or `$`
(the env var list uses `@` as its delimiter and Cloud Build substitutes `$`).

## Turning Infobip on

1. DLT template (done, set in both Cloud Build files):

   | Field | Value |
   |---|---|
   | Template name | Diet Coke Make It Yours |
   | Header (sender id) | `COKEBY` |
   | Entity | Coca-Cola India Private Limited, principal entity id `1101393580000056521` (same entity as Thums Up) |
   | Content template id | `1177179363488364821` |
   | Approved text | `Your One Time Password for Diet Coke - Make It Yours is {#num#}. Please do not share it with anyone.` |
   | `_MESSAGE` | the same text with `{#num#}` written as `{otp}` |

   The request matches thums-up-be's OTP SMS (`vendors/infobip.go`): `POST /sms/3/messages`, `Authorization: App <key>`,
   `to` = `91` + the 10-digit number, and `options.regional.indiaDlt` carrying the entity and template ids.
2. Secrets (done 2026-11-05, test and prod): `PRINTFLOW_CAMPAIGN_INFOBIP_API_KEY` and `PRINTFLOW_CAMPAIGN_INFOBIP_BASE_URL`,
   copied from Thums Up's `INFOBIP_API_KEY` / `INFOBIP_BASE_URL` (same Infobip account), readable by each project's
   Cloud Run service account and listed in `--set-secrets` of both API Cloud Build files.
3. Test (done): `_CAMPAIGN_INFOBIP_ENABLED=true` and `_CAMPAIGN_OTP_BYPASS=false`.
4. Prod: after a real phone receives the code on test, set `_CAMPAIGN_INFOBIP_ENABLED=true` in `cloudbuild-prod-api.yaml`.

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
* **Test environment login:** `_CAMPAIGN_OTP_BYPASS` is `true` and the code comes from the Secret Manager secret
  `PRINTFLOW_CAMPAIGN_OTP_BYPASS_CODE`. Production login is unavailable until the Infobip flag is on.
* The Infobip response status per message (for example a DLT rejection returned with HTTP 200) is not inspected yet.
