# PrintFlow

Store-scoped print order queue. An admin uploads a CSV of orders; each row lands
in one store's queue; the operator for that store opens an order, and the system
composes the named PSD template with the order's text, writes a **CMYK TIFF** for
the printer and a **PDF proof** for cross-checking, and hands the file to CUPS.

```
CSV ─▶ import ─▶ text check ─▶ orders (per store) ─▶ operator ─▶ render ─┬─▶ TIFF ─┬─▶ CUPS
                     │                                                    │         └─▶ download
                     └─▶ flagged ─▶ admin review ─▶ approve / reject       └─▶ PDF proof
```

Setup lives in **[SETUP.md](SETUP.md)** — Docker is the supported path.

## Stack

| Layer | Technology |
|---|---|
| Web | Next.js 15 (App Router), React 19, Tailwind v4 |
| API | FastAPI, SQLAlchemy 2, Pydantic v2 |
| Database | PostgreSQL |
| Imaging | psd-tools + Pillow |
| Printing | CUPS via `lp` / `lpstat` |
| Text moderation | Google Gemini (`google-genai`), `gemini-3.5-flash` |

## Setup

Installing on a fresh machine? **[SETUP.md](SETUP.md)** has the full,
verified walkthrough including prerequisites, what to copy, and how to check it
worked. The short version:

```bash
createdb printflow

cd api
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env          # then change PRINTFLOW_JWT_SECRET
.venv/bin/python -m scripts.seed

cd ../web
npm install
```

`scripts.seed` creates the schema, generates three sample PSD templates, seeds a
store master, users, and a starter CSV in `data/inbox/`.

To register a folder of real client designs, use `scripts/import_designs.py` —
it copies the PSDs and fonts into place, finds each baked-in text placeholder by
colour, and writes the format rows. See [SETUP.md](SETUP.md) step 6.

## Run

```bash
./run.sh
```

Web at http://localhost:3000, API docs at http://127.0.0.1:8000/docs.

### Seeded logins

| Role | Email | Password | Store |
|---|---|---|---|
| Admin | `admin@printflow.local` | `admin123` | — |
| Operator | `mumbai@printflow.local` | `operator123` | MUM01 |
| Operator | `delhi@printflow.local` | `operator123` | DEL01 |
| Operator | `bengaluru@printflow.local` | `operator123` | BLR01 |

Change these before exposing the app anywhere.

## CSV format

```csv
order_id,store_id,store_name,city,sku_code,brand,print_format,text
ORD-1001,MUM01,499.00,GIFT_TAG,"Happy Birthday, Riya!"
```

| Column | Meaning |
|---|---|
| `order_id` | Required. Unique across the system. Duplicates are skipped, never overwritten. |
| `store_id` | Required. Must match a `Store.code`. Decides whose queue the row lands in. |
| `store_name` | Optional. What the upstream system calls the store, recorded on the order. Never overwrites the store master. |
| `city` | Optional. Same — a snapshot, not a source of truth. |
| `sku_code` | Required. Product identity for the order. |
| `brand` | Required. |
| `print_format` | Required. Must match a `PrintFormat.code` — the PSD template. |
| `text` | Required. The text stamped into the template's text box. |
| `amount` | Optional, and no longer part of the contract. Still stored when a file carries it; defaults to `0`. |

A file missing any required column is rejected whole, before a single row
imports. A row missing a required *value* is skipped on its own and reported in
the batch's error list — the rest of the file still lands.

Header matching is case-, space- and underscore-insensitive, and common aliases
(`Order ID`, `Store Code`, `Design`, `Message`) are accepted. A bad row is
skipped and reported with its line number; the rest of the file still imports.

Two intake routes exist: browser upload, and importing a file dropped into
`data/inbox/` on the API host (**CSV Intake → Server inbox**).

## Text moderation

The `text` column ends up on Coca-Cola artwork, so every imported row is checked
by Gemini before an operator can render it. The check looks for politics, abuse
and profanity (including Hindi/Hinglish slang and leetspeak), hate, sexual or
violent content, **competitor brands** (Pepsi, Campa, Paper Boat, Red Bull, … —
Coca-Cola's own Thums Up, Sprite, Limca, Maaza etc. are not competitors),
disparagement of the brand, alcohol/drugs/tobacco, personal data, and anything
else a brand manager would refuse to print.

```
text ──▶ CLEAR ──────────────────────────────▶ printable
     └─▶ FLAGGED / NEEDS_REVIEW ─▶ admin ─┬─▶ APPROVED ─▶ printable
                                          └─▶ REJECTED ─▶ never prints
```

- **Held rows still import.** They show as *On hold* in the queue with the
  model's reason; the Print, Download and even PDF-proof buttons are refused by
  the API (`409`) until an admin acts. Held text never touches the artwork.
- **Admins review** under *All orders → On hold*: Approve, Reject, or Re-check.
  The model's reason and categories stay on the order beside the admin's note
  and identity, so the audit trail shows what was flagged and who overrode it.
- **Fail-closed.** If Gemini is unreachable, or skips a row, that row is held as
  `NEEDS_REVIEW` rather than printed unchecked. Re-check runs the model again.
- **Cost.** Texts go 25 to a call, output is a terse per-row verdict, and
  thinking is set to minimal — roughly **$2 per 10,000 rows** on
  `gemini-3.5-flash`. Each import records its prompt / output / thinking token
  counts, shown on the CSV Intake page. Per-row calls would cost 3–5x more;
  Gemini's implicit prompt cache does not apply because it only caches prefixes
  of 4,096+ tokens and the moderation prompt is far shorter.
- **Configuration** (`api/.env.example`): `GEMINI_API_KEY`,
  `PRINTFLOW_MODERATION_ENABLED`, `_MODEL`, `_BATCH_SIZE`, `_CONCURRENCY`,
  `_THINKING_LEVEL`, `_EXTRA_COMPETITORS` for brands specific to a campaign,
  `_CAMPAIGN_BRAND` (default `Diet Coke`) for the artwork the text is printed beside.
  With moderation disabled, rows import as `UNCHECKED` and print normally.

## Roles

**Admin** — store master, users (create / assign to store / deactivate /
delete), print formats, CSV intake, every store's orders, and moderation
review (approve / reject / re-check held text).

**Operator** — exactly one store, and only that store's orders. Scoping is
enforced in the API on every read and every print, not just in the UI: an
operator requesting another store's order gets a 404.

## Rendering

1. `psd_tools` composites the PSD to RGB. If the format names a placeholder
   layer, that layer is excluded and its bounding box becomes the text area.
2. The text is word-wrapped and the font shrunk until it fits the box, then
   drawn with the format's colour and alignment.
3. Three files are written to `data/output/<ORDER>/<ORDER>-v<n>.*`:
   - `.tif` — CMYK, LZW, DPI stamped. **This is what goes to the printer.**
   - `.pdf` — RGB proof at the same physical size, for cross-checking.
   - `.png` — downscaled preview for the browser.

   The TIFF and PDF carry the format's page size when it has one; the preview
   stays label-only, since it is for proofreading the text rather than printing.

Every render is a new version, so the artifact behind any past job stays on disk.

### Print formats

A format is a PSD plus a text box in pixels from the canvas top-left. Upload a
PSD under **Print Formats → New format**; the API reads its dimensions and
proposes a starting box, which you nudge with a live schematic of where the text
will land. Set `PRINTFLOW_TIFF_COLORSPACE=RGB` if your print path prefers RGB.

### Page size

**Print on** decides how big the delivered file is, and it is the difference
between a label that prints correctly and one that comes out 2.5x too big.

A label-sized artifact is what every consumer print path enlarges. A 300 ml
label is 4.45x4.51in; handed that and a sheet of A4, Windows Photos' default
*"Fit picture to frame"* scales it **2.52x and crops 29% of the artwork off the
sides**. macOS Preview and the Linux CUPS image filter default the same way.

Naming a page size centres the label, at true size and pixel-for-pixel
unresampled, on the paper the store actually loads. The file then already *is*
the page, so fit-to-page has nothing left to scale — it lands at 1.02x, and the
1% a fill-to-frame print trims is blank margin, never artwork.

The page is inset from the sheet by `PRINTFLOW_PAGE_MARGIN_IN` (0.25in per side)
rather than bleeding to the edge. That inset is load-bearing: CUPS scales any
image wider than the printer's printable area down to fit, so a full-bleed A4
artifact prints at 0.94x — worse than no page at all on the server-side route.
Raise the margin for a printer with wider unprintable edges.

Leave it on **Label only** for a die-cut roll or a label printer fed exact-size
stock, where the label *is* the page. A label too big for the chosen sheet is
left alone and reported in the print dialog rather than shrunk to fit, because
shrinking is what pushes artwork off the cut line.

### Passes per object

Direct-to-object printing lays light ink down translucent. One pass onto an
aluminium can leaves the can's own artwork reading straight through the print —
on a Diet Coke can the "NO SUGAR / CRISP TASTE" body copy is legible through a
pink heart. Opacity is built by printing the same design onto the same can two
or three times, without it leaving the jig.

**Passes per object** on the format carries that. It is a property of the
design's ink coverage, so it lives with the design rather than being retyped per
order.

- On the **`PRINTER`** route the API submits the file once per pass — separate
  submissions rather than `lp -n`, so a pass that fails is identifiable and the
  operator learns how many impressions actually went down.
- On the **`DOWNLOAD`** route the server never sees the printer, so the dialog
  states the count before the operator prints and the job records what they were
  told to run. That is what the audit trail can honestly claim.

Passes are **one job, N impressions** — never N jobs. Three jobs would read as
one print plus two reprints and make `reprint_count`, the number the floor is
measured on, useless.

`copies` is a different axis: it is how many *objects* to print, and it
multiplies with passes. For a jig holding one can, leave it at 1.

Passes multiply ink only where ink is laid down. A design whose background is
transparent prints as bare substrate no matter how many passes run — see
**Keep transparency** above. The format editor flags the combination.

### White ink (spot channels)

A UV press lays white first — on a clear or metallic substrate the colour is
transparent without it, and the can's own artwork reads straight through the
print. The press will not derive that plate from an alpha channel on its own: it
wants **named spot channels** in the TIFF, and the operator was adding them by
hand in Photoshop on every job.

**White passes** on the format does it instead:

| Setting | Channels written | W1 plates |
|---|---|---|
| `0` | none — a plain RGBA file | — |
| `1` | `Transparency, W1, W2` | 1 |
| `2` | `Transparency, W1, W2, W1` | 2 |
| `3` | `Transparency, W1, W2, W1, W1` | 3 |

The `W1`/`W2` pair is one pass of white; further opacity is another `W1`
appended, because a UV press builds density by repeating the plate.

Every plate is `255 - alpha`. Spot channels store ink inverted — 0 is full ink —
so white goes under every opaque pixel and none in the transparent margin, which
is what stops a die-cut label printing on a white rectangle. RGB is premultiplied
to match the associated alpha the press expects.

Pillow cannot write any of this: it caps out at RGBA, cannot set `ExtraSamples`,
and cannot name a channel. The spot path therefore goes through **tifffile**, and
the structure is a transcription of a file the press already accepts rather than
an interpretation of the spec:

```
SamplesPerPixel 6        R, G, B, Transparency, W1, W2
ExtraSamples    (1,0,0)  alpha associated, plates unspecified
Photometric     2 (RGB), chunky, uncompressed
34377 / 1006    channel names, Pascal
34377 / 1045    channel names, UTF-16 — length counts its own null terminator
34377 / 1053    channel ids 0, 5, 6
34377 / 1077    alpha kind=1; each plate kind=2 (spot)
```

Two traps worth knowing, both found the hard way:

- **The UTF-16 name length includes the terminator.** Declaring the bare
  character count makes readers eat the last letter, and the channels arrive as
  `Transparenc` and `W`.
- **Do not add TIFF tag 37724.** Photopea only lists spot channels when that tag
  is present, but it announces a layered document and Photoshop then refuses the
  file. Photoshop is the authority — the press accepts what it writes. The cost
  is that Photopea cannot preview these channels.

CMYK gives way to RGB when white passes are set: a CMYK conversion destroys both
the spot channels and the alpha they are derived from.

A design whose background is transparent still prints as bare substrate wherever
there is no ink — white plates put white *under the artwork*, not across the
whole label.

### Colour management

Separation is colour-managed through littleCMS: sRGB → CMYK using a real ICC
profile, with relative-colorimetric intent, and **the profile is embedded in the
TIFF**. Embedding is not cosmetic — an untagged CMYK TIFF is interpreted using
whatever default press profile the reader assumes, and macOS Preview rendered
untagged files near-black.

The profile is auto-detected (macOS ColorSync, then common Linux paths). Point
`PRINTFLOW_CMYK_ICC_PROFILE` at your press profile (SWOP, FOGRA, or whatever
your printer supplies) for output that matches their proofs:

```bash
PRINTFLOW_CMYK_ICC_PROFILE=/path/to/CoatedFOGRA39.icc
```

If no CMYK profile is available on the host, the renderer logs a warning and
writes an **RGB** TIFF instead — a correct RGB file beats a CMYK one nobody can
interpret. Expect saturated brand reds to shift slightly on separation: they sit
outside the CMYK gamut and are gamut-mapped, which is what a press would do too.

The three sample templates are generated by `scripts/make_sample_psds.py`, which
writes flattened PSDs through `app/services/psd_writer.py` — ImageMagick's PSD
encoder emits a layer section that psd_tools rejects, so the samples are written
directly instead. Real layered designer PSDs are read normally.

## Printing

A rendered file reaches paper one of two ways, chosen by `delivery` on the print
request:

- **`PRINTER`** — the API hands the file to CUPS with the requested copy count.
  Requires a printer reachable *from the server*.
- **`DOWNLOAD`** — the browser saves the file and the operator prints it from
  their own machine. The only route that works when the app runs in the cloud and
  the printer is attached to the operator's laptop. Windows prints TIFF natively.
- **`PROOF`** — renders the artifacts, sends nothing anywhere, and leaves the
  order status untouched.

`PRINTER` and `DOWNLOAD` both set the order to `PRINTED`. If it was already
`PRINTED`, the job is flagged as a reprint and `reprint_count` increments; the
button reads **Reprint** for such orders.

The dialog picks for you: when `lpstat` reports no printers, the download button
becomes the primary action and the printer dropdown is hidden. For a format with
a page size it says which paper to load and to print at 100%; for a **Label
only** format it tells the operator to untick *"Fit picture to frame"*, which
would otherwise rescale the image and push die-cut artwork off the cut line.

Every attempt is recorded in `print_jobs` with the operator, kind, printer, CUPS
job id, and any error — so a failed print is auditable rather than invisible. A
render or printer failure moves the order to `FAILED` with the reason attached;
printing it again clears it.

## Tests

```bash
cd api && .venv/bin/python -m pytest tests -q
```

92 tests over auth, RBAC, store scoping, CSV rules, text moderation, rendering,
TIFF colourspace, placeholder detection, format configuration, printer dispatch
and reprint accounting. They run against a throwaway `printflow_test` database,
replace `lp`/`lpstat` with a recording stub so the dispatch path is exercised for
real — argv, exit code, job-id parsing — without printing anything, and swap the
Gemini client for a scriptable fake so no test ever calls the network.

The database defaults to a local Postgres; point `PRINTFLOW_TEST_DATABASE_URL`
(plus libpq's `PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD` for `createdb`) at another
server, e.g. a `postgres:16-alpine` container.

## Security notes

- Passwords are bcrypt-hashed; sessions are JWTs held in an httpOnly cookie set
  by the Next.js server. Page scripts never see the token — browser calls go
  through `/api/proxy/*`, which attaches it server-side.
- `PRINTFLOW_JWT_SECRET` must be changed before any deployment; the default
  signs tokens anyone with this repo can forge.
- Uploaded filenames are reduced to their basename before touching the
  filesystem, so an inbox import cannot escape `data/inbox/`.
- The app is HTTP-only for local use. Behind TLS, `secure` is set on the session
  cookie automatically via `NODE_ENV=production`.

## Layout

```
printflow/
├─ api/
│  ├─ app/
│  │  ├─ main.py config.py db.py models.py schemas.py security.py deps.py
│  │  ├─ routers/   auth · stores · users · formats · orders · printing
│  │  └─ services/  renderer · printing · csv_import · psd_writer
│  ├─ scripts/      seed.py · make_sample_psds.py
│  └─ tests/
├─ web/
│  ├─ app/          login · (app)/queue · (app)/admin/* · api/auth · api/proxy
│  ├─ components/   Shell · OrderWorkspace · OrderTable · PrintDialog · ui
│  └─ lib/          session (server) · client (browser) · format · types
└─ data/            inbox/ (CSV drop) · psd/ (templates) · output/ (artifacts)
```
