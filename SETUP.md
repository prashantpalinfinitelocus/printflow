# PrintFlow — setup

**Docker is the supported path.** The app and database run in containers; your
designs, fonts, CSV inbox and rendered output stay in `./data` on the laptop,
bind-mounted in. Nothing that matters lives inside a container.

Every command here was run end to end before this was written.

- [Quick start](#quick-start) — five commands
- [Printing](#printing) — read this, Docker changes it
- [Day-to-day](#day-to-day)
- [Troubleshooting](#troubleshooting)
- [Running without Docker](#appendix--running-without-docker)

---

## Prerequisites

Docker Desktop (or Docker Engine + Compose v2). That is the whole list —
Python, Node and Postgres all live in the images.

```bash
docker --version && docker compose version
```

---

## Quick start

### 1. Copy the project

Not a git repository yet, so copy the folder. Skip what gets rebuilt:

```bash
rsync -av --exclude 'api/.venv' --exclude 'web/node_modules' --exclude 'web/.next' \
      --exclude 'data/output' --exclude '.DS_Store' \
      /path/to/printflow/ /destination/printflow/
```

Two directories **must** come across — they cannot be regenerated:

| Path | Size | Contents |
|---|---|---|
| `data/psd/` | 24 MB | The 8 client designs + 3 generated samples |
| `data/fonts/` | 312 KB | You2013 Regular + two TCCC Unity Headline faces |

`data/output/` is rendered artifacts. Skip it; anything printed can be
re-rendered from its order.

### 2. Configure

```bash
cd printflow
cp .env.example .env
```

Edit `.env` and set the one required value:

```bash
PRINTFLOW_JWT_SECRET=<paste output of: openssl rand -hex 32>
```

Compose refuses to start without it — the default would let anyone holding this
repo forge a session token.

Also set `GEMINI_API_KEY` (free key from <https://aistudio.google.com/apikey>).
It powers the text check that runs on every CSV import — see README → Text
moderation. Without a key the app still starts, but every imported row is held
for admin review because the check cannot run. To skip the check entirely set
`PRINTFLOW_MODERATION_ENABLED=false`.

If a host port collides with another stack (check `docker ps`), change
`WEB_PORT`, `API_PORT` or `DB_PORT` in the same file.

### 3. Build and start

```bash
docker compose up -d --build
```

First build takes a few minutes. Check all three came up healthy:

```bash
docker compose ps
```

```
SERVICE   STATUS                    PORTS
api       Up 26 seconds (healthy)   0.0.0.0:8000->8000/tcp
db        Up 34 seconds (healthy)   0.0.0.0:15432->5432/tcp
web       Up 20 seconds             0.0.0.0:3000->3000/tcp
```

### 4. Seed stores, users and sample templates

```bash
docker compose exec api python -m scripts.seed
```

Idempotent — re-running updates rows rather than duplicating them.

| Role | Email | Password | Store |
|---|---|---|---|
| Admin | `admin@printflow.local` | `admin123` | — |
| Operator | `mumbai@printflow.local` | `operator123` | MUM01 |
| Operator | `delhi@printflow.local` | `operator123` | DEL01 |
| Operator | `bengaluru@printflow.local` | `operator123` | BLR01 |

**Change these before anyone else can reach the app.**

### 5. Register the 300 ml designs

The PSDs came across in step 1, but the database rows describing them — text
box, font, colours, DPI — did not. The `--exclude` flags leave the three
generated sample templates alone:

```bash
docker compose exec api python scripts/import_designs.py \
    --psd-dir /data/psd \
    --font "You2013 Regular.ttf" \
    --placeholder-color "#ED1C24" \
    --dpi 508 \
    --exclude 'bottle_label.psd' --exclude 'gift_tag.psd' --exclude 'thank_you.psd'
```

Expect **all eight found, none needing manual placement**:

```
psd   CHEERS                   2260x2290 @508dpi  box 956,1052 609x78
psd   DRD                      2260x2290 @508dpi  box 956,1073 609x78
psd   FUN_STICKERS             2260x2290 @508dpi  box 957,1273 609x78
psd   POLAR_BEAR_SUNSET        2260x2290 @508dpi  box 956,1080 609x78
psd   POLAR_BEAR_AND_FRIENDS   2260x2290 @508dpi  box 978,1026 608x78
psd   STAMPS                   2260x2290 @508dpi  box 957,1066 609x78
psd   VALENTINE                2260x2290 @508dpi  box 957,862 609x78
psd   HAPPY_BIRTHDAY           2260x2290 @508dpi  box 957,1076 609x78

imported 8 format(s); 0 needed manual placement
```

Add `--dry-run` to see what it would detect without writing anything.

If a design reports **"needed manual placement"**, the import still succeeded —
that format just has no text box. Set it in the UI: **Print Formats → Edit →
Detect from artwork**, or type the coordinates.

### Open it

**http://localhost:3000** — log in as an operator to see a store queue, or as
admin for stores, users, formats and CSV intake.

---

## Printing

There are two ways a rendered file reaches paper, and which one you get depends
on whether the **server** can see a printer.

| Mode | When it applies | What happens |
|---|---|---|
| **Download** | Server has no printer — Docker, and any cloud deployment | Operator clicks **Download TIFF & mark printed**, opens the file and prints it from their own machine. Order is marked printed. |
| **Server print** | Printer reachable from the API host | API hands the file to CUPS via `lp`. Order is marked printed. |

The UI picks automatically: no printers visible → the download button becomes
the primary action and the printer dropdown is hidden.

### Download mode is the one that works over the internet

If PrintFlow runs on a cloud server and operators use it from their own Windows
laptops, **the server can never reach their printers** — no firewall rule or
config fixes that. Download mode is the answer: the browser saves the TIFF and
Windows prints it locally.

Windows prints TIFF natively: right-click the file → **Print**, or open it in
Photos → **Print**.

> **Set a page size on each format.** The Windows print wizard defaults to
> **"Fit picture to frame"**, which rescales the image — handed a label-sized
> file and a sheet of A4 it enlarges 2.52x and crops 29% of the artwork off the
> sides. Set **Print on** to the paper the store loads (Print Formats → edit →
> *Print on*) and the file arrives already laid out on that page, so the default
> has nothing left to scale. Operators just load that paper and print at 100%.
>
> On formats left as **Label only** the old advice still applies: untick
> **"Fit picture to frame"** and choose **Actual size**. The TIFF carries its dpi
> metadata, so at actual size it comes out correct. The print dialog in PrintFlow
> tells the operator which of the two applies.

### Why Docker has no printer on macOS

macOS CUPS listens on `localhost:631` and a Unix socket only. A container is not
on localhost, so `lp` inside the container cannot reach it. Opening CUPS up needs
`sudo` and loosens access control for every remote host — not worth it. The API
container therefore ships with `PRINTFLOW_PRINTING_ENABLED=false` and uses
download mode.

**Everything else works in Docker:** CSV import, queues, rendering TIFFs and
PDFs, previews, reprint accounting.

### If you do want server-side printing on this laptop

Run the API natively — it is the only piece that needs CUPS. Verified working:

```bash
# 1. Database and web stay in Docker
docker compose up -d db

# 2. API runs on the laptop, against the container's Postgres
cd api
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
PRINTFLOW_DATABASE_URL="postgresql+psycopg://printflow:printflow@localhost:15432/printflow" \
PRINTFLOW_JWT_SECRET="<same secret as .env>" \
  .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000

# 3. Point the web container at the host API
cd ..
WEB_API_BASE_URL=http://host.docker.internal:8000 docker compose up -d --no-deps web
```

`curl localhost:8000/health` returns `{"status":"ok"}`. To see the printers, log in as an admin and call `GET /printers` (the web app shows them in the printer drop-down).

On **Linux**, add `network_mode: host` to the `api` service or mount
`/var/run/cups/cups.sock`, and server printing works in the container.

### If manual printing becomes the bottleneck

Download mode costs a few clicks per order and relies on the operator getting
the scaling right. At volume, the usual fix is a small **print agent** installed
on each laptop: it polls the server, downloads the TIFF and prints it silently
through the Windows spooler at exact size — outbound HTTPS only, no firewall
changes. That is a separate build; nothing here blocks it later.

---

## Day-to-day

```bash
docker compose up -d          # start
docker compose down           # stop (database survives)
docker compose logs -f api    # follow API logs
docker compose logs -f web
docker compose ps             # health
```

**After changing code** — the images copy source in at build time, so rebuild:

```bash
docker compose up -d --build
```

**Run the tests** (43, against a throwaway database, `lp` stubbed so nothing
prints):

```bash
./docker-test.sh
```

**A psql shell:**

```bash
docker compose exec db psql -U printflow printflow
```

**Import a CSV** — drop it in `data/inbox/` on the laptop, then use
**CSV Intake → Server inbox** in the UI. The container sees it immediately;
that folder is the bind mount.

**Find rendered files** — `data/output/<ORDER>/<ORDER>-v<n>.{tif,pdf,png}` on
the laptop, openable in Finder.

### Start completely fresh

```bash
docker compose down -v        # -v also deletes the database volume
```

Your `data/` folder is untouched by this — only the database is wiped. Re-run
steps 3–5.

---

## Verify the install

**a. Services healthy** — `docker compose ps` shows `api` and `db` as
`(healthy)`.

**b. API responds**

```bash
curl -s http://localhost:8000/health
```

It answers `{"status":"ok"}`. `curl -s http://localhost:8000/health/ready` also checks the
database. Printers are not listed there; with no CUPS in Docker the web app simply shows no
printer drop-down and uses download mode — see [Printing](#printing).

**c. Tests pass** — `./docker-test.sh` → **43 passed**.

**d. Designs registered** — log in as admin → **Print Formats**. Each 300 ml
card reads `RGB @ 508dpi · transparent` with `You2013 Regular.ttf`.

**e. A real render** — as an operator, open an order → **Generate PDF proof
only**. Nothing is sent to a printer, status is unchanged, and the preview shows
the order text where the `XXXXXXXX` placeholder was. The files appear in
`data/output/` on your laptop.

---

## Troubleshooting

**`Bind for 0.0.0.0:8000 failed: port is already allocated`**
Another stack holds that port. Change `WEB_PORT` / `API_PORT` / `DB_PORT` in
`.env`. List what's taken: `docker ps --format '{{.Ports}}'`.

**`error while interpolating services.api.environment: required variable PRINTFLOW_JWT_SECRET is missing`**
Step 2. Set it in `.env`.

**"This server has no printer attached"**
Expected in Docker and in any cloud deployment. Use the download button — see
[Printing](#printing).

**The press reports no white channel / W1 and W2 are missing**
The format's **White passes** is 0, so the file has no spot channels for the RIP
to build white from. Set it to 1 (or more for a denser base) under Print Formats
→ edit. Note the file will not show its channels in Photopea — that is expected,
and Photoshop shows them correctly.

**The print is see-through — the can's own artwork shows through it**
One pass of light ink on aluminium or glass is translucent. Set **Passes per
object** to 2 or 3 on that format (Print Formats → edit) and keep the can in the
jig until every pass is done. If the *background* is what shows through rather
than the artwork, also untick **Keep transparency** — a transparent background
prints as bare substrate however many passes you run.

**Printed labels come out far too big, zoomed in, cropped at the edges**
The format has no page size, so the print dialog scaled the label-sized file up
to fill the sheet. Set **Print on** to the paper that store loads (Print Formats
→ edit → *Print on*) and reprint. See [Printing](#printing).

**Printed labels are slightly the wrong size / off the die-cut**
"Fit picture to frame" was left ticked in the Windows print dialog. Print at
**Actual size**. If it is off by ~5% on the server-side CUPS route, the printer's
unprintable margin is wider than `PRINTFLOW_PAGE_MARGIN_IN` (0.25in per side) —
raise it and reprint. See [Printing](#printing).

**Web shows a connection error**
The API container is unhealthy. `docker compose logs api`. Most often the
database was still starting — `docker compose restart api`.

**Changes to code do nothing**
Source is copied at build time, not mounted. `docker compose up -d --build`.

**Text renders as empty boxes (tofu)**
No installed font covers that script. The image carries DejaVu plus Noto for
Devanagari, Gujarati, Tamil, Telugu, Kannada, Bengali and Arabic. For anything
else, add the font to `data/fonts/` and select it on the format.

**The TIFF looks black in Preview / QuickLook**
That is the transparency, not a colour fault. The 300 ml labels are die-cut and
print on transparent stock; macOS composites transparent TIFFs onto black. The
client's own reference TIFFs preview identically. **Use the PDF proof** — it
flattens onto white.

**`AssertionError: Invalid version 8` reading a PSD**
Only possible outside Docker with a stale environment. `requirements.txt` pins
psd-tools 1.18.0; older versions reject Smart Object records from current
Photoshop.

---

## Before this leaves a laptop

1. **`PRINTFLOW_JWT_SECRET`** — a real random value, per environment.
2. **Change every seeded password**, admin included.
3. **Put it behind TLS.** The session cookie only sets `secure` when
   `NODE_ENV=production` (the web image sets this; a reverse proxy still needs
   to terminate TLS).
4. **`PRINTFLOW_CORS_ORIGINS`** — the real web origin, not `localhost:3000`.
5. **Do not publish the `db` port.** Remove the `ports:` block on the `db`
   service; only `api` needs to reach it.
6. If you move any format to CMYK, point `PRINTFLOW_CMYK_ICC_PROFILE` at your
   printer's press profile. The image ships Ghostscript's generic CMYK profile,
   which is correct but not your vendor's.

---

## Appendix — running without Docker

Needed only if you want the API native for printing, or prefer no containers.

Requires Python 3.12, Node 22+, PostgreSQL 14+, CUPS.

```bash
createdb printflow

cd api
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env          # set PRINTFLOW_JWT_SECRET
.venv/bin/python -m scripts.seed

cd ../web
npm install

cd ..
./run.sh                      # both servers, Ctrl-C stops both
```

Then register the designs as in step 5, pointing `--psd-dir` at `data/psd` and
dropping the `/data` prefix. Tests: `cd api && .venv/bin/python -m pytest tests -q`.

On macOS the renderer finds system fonts and the ColorSync CMYK profile
automatically; on Linux install `fonts-dejavu-core`, `fonts-noto-core` and
`ghostscript` to match what the container has.
