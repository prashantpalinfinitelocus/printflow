# Diet Coke campaign admin

The campaign's admin is its own system, apart from PrintFlow (the offline-store app):

- It answers at **`/user-campaign/admin`**, signs in at **`/user-campaign/admin/login`**, and its API route is `/user-campaign/api/admin`. Nothing in it links to or calls a PrintFlow page.
- **Accounts are separate.** Campaign admins are their own user list (`campaign_admins`). A PrintFlow login does not open the campaign admin, and a campaign admin login opens nothing in PrintFlow.
- **Data is separate.** Each design's PSD and text settings live in `campaign_designs`, never in PrintFlow's print formats. Draws and winners live in `campaign_draws` and `campaign_winners`.
- **Files are separate.** Design PSDs are stored in `PRINTFLOW_CAMPAIGN_PSD_DIR`, and winners' TIFFs in `PRINTFLOW_CAMPAIGN_OUTPUT_DIR`. If these are not set they default to `<data dir>/campaign/psd` and `<data dir>/campaign/output`, which is `/data/campaign/...` in the Docker image.
- **The only shared piece is the PSD-to-TIFF renderer.** TIFFs are CMYK, LZW-compressed, with the colour profile embedded and the design's DPI, the same quality as store prints.

## Creating an admin

**On a deployed environment (test):** run the runbook from a machine where you are signed in with `gcloud auth login`:

```
infra/create-campaign-admin.sh                    # user ID "campaign-admin", generated password
USER_ID=ankit infra/create-campaign-admin.sh      # another user ID
DRY_RUN=1 infra/create-campaign-admin.sh          # show the steps, change nothing
```

The database is on a private IP, so the script runs a short-lived Cloud Run job from the API's own image. The password
reaches the job through a temporary Secret Manager secret (never a command line), only a bcrypt hash is stored in
`campaign_admins`, and the job and the secret are deleted afterwards even if the run fails. The password is printed once
at the end: hand it over through a password manager. Running it again for the same user ID sets a new password.

**Locally, or in any shell with the API's environment:**

```
python -m scripts.create_campaign_admin <user-id>
```

- It asks for the password twice. Passwords must be at least 10 characters, and user IDs at most 64.
- With no terminal (a job), set `CAMPAIGN_ADMIN_PASSWORD` instead and it will not prompt.
- Running it again for an existing user ID sets a new password and signs out that admin's existing sessions.
- After `PRINTFLOW_CAMPAIGN_ADMIN_MAX_FAILED_LOGINS` wrong passwords in a row (default 5), the account is locked for `PRINTFLOW_CAMPAIGN_ADMIN_LOCK_MINUTES` (default 15).

## The nightly draw

```
python -m scripts.run_campaign_draw            # every closed, undrawn day with entries in the last 7 days
python -m scripts.run_campaign_draw 2026-10-30 # one given day
```

When to run it:

- Schedule it once a night, any time after the entry window closes plus the grace period: 10 PM IST + `PRINTFLOW_CAMPAIGN_DRAW_GRACE_MINUTES` (default 10), so **10:15 PM IST or later**.
- A run that finds nothing new to draw changes nothing, so retries are safe.
- A night the job missed is drawn by the next run, as long as it is within `PRINTFLOW_CAMPAIGN_DRAW_CATCHUP_DAYS` (default 7).
- On GCP, the job is a Cloud Run Job using the API image with the same environment, with Cloud Scheduler triggering it at `15 22 * * *` in the Asia/Kolkata time zone.

An admin can also run a day's draw from the panel ("Run draw") once that day has closed. A day is drawn only once, whichever runs first.

### The draw's rules

- Up to `PRINTFLOW_CAMPAIGN_DAILY_WINNERS` winners a day (default 100).
- Every entry is one ticket.
- A phone wins at most once a day, and not at all once it has `PRINTFLOW_CAMPAIGN_MONTHLY_WIN_LIMIT` wins (default 5) in the calendar month.

Each draw records:

- its random seed;
- the number of entries;
- the phones the monthly limit kept out;
- who ran it.

With these, a draw can be replayed: shuffle the day's entries, ordered by `(created_at, id)`, with `random.Random(seed)`.

## Each day in the panel

1. **Designs.** Upload each design's PSD once. The text starts on the can's name line in Diet Coke red. If the PSD has a red XXXXXXXX placeholder, find it under Edit text settings and choose whether to erase it.
2. **Draw day.** Pick the day (it opens on today, so pick yesterday for the last finished draw). Run the draw if it has not run yet.
3. **Generate TIFFs**, then **Download sheet**. The sheet is a CSV for Excel listing every winner, with a link to each TIFF. The links open for a signed-in campaign admin.
