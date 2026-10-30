"""Builds the HLD/LLD diagrams (SVG, then PNG through rsvg-convert).

    python3 docs/hld/diagrams/build.py

The icons are simple hexagon glyphs drawn here in the style of docs/portal/*.png; they are
not Google's official icon set. Swap `icon()` for the official SVGs if a brand-exact
diagram is required.
"""

from __future__ import annotations

import subprocess
from pathlib import Path
from xml.sax.saxutils import escape

OUT = Path(__file__).resolve().parent
BLUE, DARK, GREY, RED, SLATE = "#4a78e0", "#252b33", "#5f6b7a", "#d93025", "#6b7a8d"
FONT = "font-family='Helvetica, Arial, sans-serif'"
MONO = "font-family='Menlo, Courier, monospace'"

GLYPHS = {  # drawn in a 40x40 box centred on the icon, white strokes
    "user": "<circle cx='20' cy='14' r='6'/><path d='M8 32c0-7 5-11 12-11s12 4 12 11'/>",
    "run": "<path d='M9 10l10 10-10 10M20 10l10 10-10 10'/>",
    "sql": "<ellipse cx='20' cy='11' rx='10' ry='4'/><path d='M10 11v18c0 2 4.5 4 10 4s10-2 10-4V11M10 20c0 2 4.5 4 10 4s10-2 10-4'/>",
    "bucket": "<path d='M9 12h22l-3 20H12z'/><ellipse cx='20' cy='12' rx='11' ry='3'/>",
    "shield": "<path d='M20 7l11 4v9c0 7-5 11-11 14-6-3-11-7-11-14v-9z'/>",
    "lock": "<rect x='10' y='18' width='20' height='14' rx='2'/><path d='M14 18v-4a6 6 0 0112 0v4'/>",
    "list": "<path d='M10 12h20M10 20h20M10 28h14'/>",
    "nat": "<path d='M9 14h20l-5-5M31 26H11l5 5'/>",
    "lb": "<path d='M30 12L14 20l16 8M14 20h18'/>",
    "star": "<path d='M20 7l3 10 10 3-10 3-3 10-3-10-10-3 10-3z'/>",
    "mail": "<rect x='8' y='11' width='24' height='18' rx='2'/><path d='M8 13l12 10 12-10'/>",
    "phone": "<rect x='13' y='7' width='14' height='26' rx='3'/><path d='M18 29h4'/>",
    "build": "<circle cx='20' cy='20' r='9'/><path d='M20 6v6M20 28v6M6 20h6M28 20h6'/>",
    "monitor": "<rect x='8' y='10' width='24' height='16' rx='2'/><path d='M14 33h12M20 26v7M12 21l5-5 4 3 6-6'/>",
}


class Svg:
    def __init__(self, w: int, h: int):
        self.w, self.h, self.parts = w, h, []
        self.parts.append(
            f"<defs><marker id='a' viewBox='0 0 10 10' refX='9' refY='5' markerWidth='8' markerHeight='8' orient='auto-start-reverse'>"
            f"<path d='M0 0L10 5L0 10z' fill='{DARK}'/></marker>"
            f"<marker id='ab' viewBox='0 0 10 10' refX='9' refY='5' markerWidth='8' markerHeight='8' orient='auto-start-reverse'>"
            f"<path d='M0 0L10 5L0 10z' fill='{BLUE}'/></marker>"
            f"<pattern id='g' width='24' height='24' patternUnits='userSpaceOnUse'><path d='M24 0H0V24' fill='none' stroke='#eef0f3'/></pattern></defs>"
            f"<rect width='{w}' height='{h}' fill='#fff'/><rect width='{w}' height='{h}' fill='url(#g)'/>"
        )

    def zone(self, x, y, w, h, title, fill):
        self.parts.append(
            f"<rect x='{x}' y='{y}' width='{w}' height='{h}' fill='{fill}' stroke='#b9bec6'/>"
            f"<rect x='{x}' y='{y}' width='44' height='40' fill='{GREY}' opacity='.85'/>"
            f"<circle cx='{x+22}' cy='{y+15}' r='5' fill='none' stroke='#fff' stroke-width='2'/>"
            f"<path d='M{x+22} {y+20}v8' stroke='#fff' stroke-width='2'/>"
            f"<text x='{x+58}' y='{y+27}' {FONT} font-size='20' fill='#3c4043'>{escape(title)}</text>"
        )

    def icon(self, cx, cy, glyph, label, sub="", fill=BLUE, off=False):
        pts = " ".join(f"{cx + 34*dx:.0f},{cy + 34*dy:.0f}" for dx, dy in
                       [(0, -1), (.87, -.5), (.87, .5), (0, 1), (-.87, .5), (-.87, -.5)])
        op = " opacity='.45'" if off else ""
        self.parts.append(
            f"<g{op}><polygon points='{pts}' fill='{fill}' stroke='{fill}' stroke-width='6' stroke-linejoin='round'/>"
            f"<g transform='translate({cx-20},{cy-20})' fill='none' stroke='#fff' stroke-width='2.6' stroke-linecap='round' stroke-linejoin='round'>{GLYPHS[glyph]}</g></g>"
            f"<text x='{cx}' y='{cy+62}' text-anchor='middle' {FONT} font-size='17' font-weight='700' fill='{DARK}'>{escape(label)}</text>"
        )
        for i, line in enumerate(filter(None, sub.split("\n"))):
            self.parts.append(
                f"<text x='{cx}' y='{cy+80+i*16}' text-anchor='middle' {FONT} font-size='13' fill='#454b54'>{escape(line)}</text>"
            )

    def arrow(self, pts, label="", color=DARK, both=False, dash=False, lx=None, ly=None, mono=True):
        d = "M" + " L".join(f"{x} {y}" for x, y in pts)
        mk = "ab" if color == BLUE else "a"
        self.parts.append(
            f"<path d='{d}' fill='none' stroke='{color}' stroke-width='2.2' marker-end='url(#{mk})'"
            f"{' marker-start=\"url(#' + mk + ')\"' if both else ''}{' stroke-dasharray=\"7 5\"' if dash else ''}/>"
        )
        if label:
            x, y = (lx, ly) if lx is not None else ((pts[0][0] + pts[-1][0]) / 2, (pts[0][1] + pts[-1][1]) / 2 - 8)
            self.parts.append(
                f"<text x='{x}' y='{y}' text-anchor='middle' {MONO if mono else FONT} font-size='13' fill='{color}'>{escape(label)}</text>"
            )

    def text(self, x, y, s, size=14, weight="400", fill=DARK, anchor="start", mono=False):
        self.parts.append(
            f"<text x='{x}' y='{y}' text-anchor='{anchor}' {MONO if mono else FONT} font-size='{size}' font-weight='{weight}' fill='{fill}'>{escape(s)}</text>"
        )

    def box(self, x, y, w, h, title, lines=(), fill="#fff", stroke="#9aa3ad", head="#e8eaed"):
        self.parts.append(
            f"<rect x='{x}' y='{y}' width='{w}' height='{h}' rx='6' fill='{fill}' stroke='{stroke}'/>"
            f"<rect x='{x}' y='{y}' width='{w}' height='30' rx='6' fill='{head}' stroke='{stroke}'/>"
            f"<text x='{x+10}' y='{y+20}' {FONT} font-size='15' font-weight='700' fill='{DARK}'>{escape(title)}</text>"
        )
        for i, ln in enumerate(lines):
            self.parts.append(f"<text x='{x+10}' y='{y+50+i*19}' {MONO} font-size='12.5' fill='#30343a'>{escape(ln)}</text>")

    def save(self, name):
        svg = f"<svg xmlns='http://www.w3.org/2000/svg' width='{self.w}' height='{self.h}' viewBox='0 0 {self.w} {self.h}'>{''.join(self.parts)}</svg>"
        (OUT / f"{name}.svg").write_text(svg)
        subprocess.run(["rsvg-convert", "-z", "1.5", "-o", str(OUT / f"{name}.png"), str(OUT / f"{name}.svg")], check=True)


# ---------------------------------------------------------------- architecture
def architecture():
    s = Svg(2150, 1720)
    s.text(40, 50, "Diet Coke custom-can campaign: GCP architecture (test: ai0017287-dca-diet-coke-test, asia-northeast1)", 24, "700")
    s.text(40, 78, "Consumer journey at /user-campaign (domain root). Staff app at /offline-store. Both are served by the same web service.", 15, fill="#454b54")

    s.icon(760, 190, "phone", "Consumers", "Instagram bio link\n/user-campaign", DARK)
    s.icon(1180, 190, "user", "Staff", "Admin · Operator\n/offline-store", DARK)
    s.icon(970, 440, "shield", "Cloud Armor", "WAF · login throttle\nOTP throttle (rule 1050)", RED)
    s.icon(970, 660, "lb", "Global Application LB", "HTTPS · managed cert\n/user-campaign/*  /offline-store/*  /backend/*")
    s.arrow([(760, 300), (760, 360), (935, 360), (935, 404)], "HTTPS", lx=820, ly=352)
    s.arrow([(1180, 300), (1180, 360), (1005, 360), (1005, 404)], "HTTPS", lx=1120, ly=352)
    s.arrow([(970, 548), (970, 624)])

    s.zone(300, 830, 1480, 400, "Private subnet: Cloud Run (Direct VPC egress)", "#e8eaee")
    s.icon(700, 1030, "run", "Cloud Run · web", "Next.js :3000\n/user-campaign (self-rewrite)\n/offline-store · /api/campaign proxy")
    s.icon(1300, 1030, "run", "Cloud Run · api", "FastAPI :8000 · /campaign/*\nOTP · window · moderation · entries")
    s.arrow([(930, 790), (930, 900), (700, 900), (700, 994)], "path routing", lx=815, ly=892)
    s.arrow([(1010, 790), (1010, 940), (1300, 940), (1300, 994)], "/backend/*", lx=1155, ly=932)
    s.arrow([(738, 1030), (1262, 1030)], "Bearer participant JWT", lx=1000, ly=1020)

    s.icon(1620, 930, "lock", "Secret Manager", "JWT secret · DB URL\nInfobip key (when enabled)", SLATE)
    s.arrow([(1586, 940), (1340, 1010)], "injected at start", lx=1470, ly=962)
    s.icon(1620, 1110, "list", "Cloud Logging", "masked phone · no OTP")
    s.arrow([(1340, 1052), (1586, 1110)], "logs", lx=1470, ly=1070)

    s.icon(1000, 1480, "bucket", "Cloud Storage", "data bucket mounted at /data\nPSD · fonts · inbox · output")
    s.arrow([(1240, 1150), (1240, 1300), (1000, 1300), (1000, 1440)], "read PSD · write TIFF", lx=1120, ly=1292)
    s.icon(1500, 1480, "sql", "Cloud SQL", "PostgreSQL 16 · private IP\ncampaign_* tables")
    s.arrow([(1360, 1150), (1360, 1300), (1500, 1300), (1500, 1440)], "SQL (psycopg)", lx=1430, ly=1292)

    s.icon(1960, 1030, "nat", "Cloud NAT", "egress to internet", BLUE)
    s.arrow([(1330, 996), (1330, 880), (1960, 880), (1960, 994)], "443 to internet", lx=1700, ly=872)
    s.icon(1960, 1290, "mail", "Infobip SMS", "DLT template · flag OFF\nbypass OTP while off", SLATE, off=True)
    s.arrow([(1960, 1140), (1960, 1250)], "flag ON", dash=True, lx=2010, ly=1200)
    s.icon(1960, 1530, "star", "Vertex AI · Gemini", "text moderation\nfail-closed", SLATE)
    s.arrow([(1996, 1030), (2090, 1030), (2090, 1530), (1996, 1530)], "moderation", lx=2062, ly=1285, mono=False)

    s.zone(60, 830, 200, 330, "Build", "#eae1dc")
    s.icon(160, 960, "build", "Cloud Build", "api · web triggers\nsubstitutions = config")
    s.arrow([(200, 960), (300, 960)], "deploy", lx=250, ly=950)
    s.text(60, 1230, "Config (cloudbuild-*.yaml substitutions):", 13, "700")
    for i, t in enumerate(["_CAMPAIGN_OTP_SEND_LIMIT=5 / WINDOW=300s",
                           "_CAMPAIGN_OTP_BLOCK_SECONDS=7200",
                           "_CAMPAIGN_INFOBIP_ENABLED=false",
                           "_CAMPAIGN_OPEN/CLOSE_HOUR=10/22 IST",
                           "prod: OTP bypass hard-coded false"]):
        s.text(60, 1252 + i * 18, t, 12, mono=True)
    s.save("architecture")


# ---------------------------------------------------------------- sequence
def sequence(name, title, actors, steps, h):
    w = 250 * len(actors) + 300
    s = Svg(w, h)
    s.text(30, 40, title, 22, "700")
    xs = [140 + 250 * i for i in range(len(actors))]
    for x, a in zip(xs, actors):
        s.parts.append(f"<rect x='{x-75}' y='64' width='150' height='38' rx='6' fill='{BLUE}'/>")
        s.text(x, 88, a, 14, "700", "#fff", "middle")
        s.parts.append(f"<path d='M{x} 102V{h-30}' stroke='#9aa3ad' stroke-dasharray='5 5'/>")
    y = 140
    for st in steps:
        if st[0] == "note":
            s.parts.append(f"<rect x='{xs[st[1]]-70}' y='{y-16}' width='{xs[st[2]]-xs[st[1]]+140}' height='{26*len(st[3])+8}' fill='#fff8d6' stroke='#d9c86a'/>")
            for i, ln in enumerate(st[3]):
                s.text(xs[st[1]] - 62, y + 4 + i * 22, ln, 12.5)
            y += 26 * len(st[3]) + 22
            continue
        a, b, label, *rest = st
        dash = bool(rest and rest[0])
        x1, x2 = xs[a], xs[b]
        d = 10 if x2 > x1 else -10
        s.arrow([(x1 + (d if a != b else 0), y), (x2 - d, y)] if a != b else [(x1, y), (x1 + 50, y), (x1 + 50, y + 24), (x1, y + 24)],
                dash=dash)
        s.text(min(x1, x2) + 14 if a != b else x1 + 56, y - 8 if a != b else y + 8, label, 12.5, "400", DARK, "start", mono=True)
        y += 44 if a != b else 52
    s.save(name)


def sequences():
    A = ["Browser", "Web (Next.js)", "API (FastAPI)", "Postgres", "Infobip SMS"]
    sequence(
        "sequence-login-otp", "Sequence: login with phone OTP and email (Infobip flag OFF = bypass; ON = real SMS)", A,
        [
            (0, 1, "POST /offline-store/api/campaign/otp/send {phone,email}"),
            (1, 2, "POST /campaign/otp/send"),
            (2, 3, "lock guard row (FOR UPDATE); count sends in window"),
            ("note", 2, 3, ["send #1-5 in 300 s: allowed.  send #6: set blocked_until = now+7200 s,", "answer 429 OTP_BLOCKED {retry_after:7200} + Retry-After header"]),
            (2, 3, "expire live OTP; INSERT campaign_otps (HMAC hash; NULL when bypass)"),
            (2, 4, "flag ON only: POST /sms/3/messages (DLT template)"),
            (4, 2, "202/200 (4xx -> 503 OTP_SEND_FAILED)", True),
            (2, 1, "200 {resend_after:30}", True),
            (1, 0, "200", True),
            (0, 1, "POST .../otp/verify {phone,email,code}"),
            (1, 2, "POST /campaign/otp/verify"),
            (2, 3, "lock guard; blocked? -> 429.  bypass code or hash compare"),
            ("note", 2, 3, ["wrong code: failed_verifies+1; 5th -> 429 OTP_LOCKED for 7200 s", "right code: mark consumed, reset failures, upsert participant"]),
            (2, 2, "mint JWT (aud, iss, jti, ver, iat, exp)"),
            (2, 1, "200 {token, expires_in, phone, email}", True),
            (1, 0, "Set-Cookie dc_token (httpOnly, SameSite=Lax); body without token", True),
        ], 1020)
    sequence(
        "sequence-entry", "Sequence: moderation, preview and entry submission", A[:4],
        [
            (0, 1, "POST /api/campaign/moderate {text}   (cookie dc_token)"),
            (1, 2, "POST /campaign/moderate  Authorization: Bearer"),
            (2, 3, "participant lookup; token ver must equal participants.token_version"),
            ("note", 1, 2, ["text rules (allowlist, <=12 chars) then Gemini on Vertex AI.", "moderation down -> 503 MODERATION_UNAVAILABLE (never approves)"]),
            (2, 1, "200 {result: APPROVED|REJECTED}", True),
            (1, 0, "200", True),
            (0, 0, "preview renders PNG in the browser (no entry yet)"),
            (0, 1, "POST /api/campaign/entries {design_id,text,idempotency_key}"),
            (1, 2, "POST /campaign/entries"),
            (2, 3, "same key already stored? -> 200 same entry_id"),
            ("note", 2, 3, ["window state (server clock): not OPEN -> 409 WINDOW_CLOSED", "entries >= cap (50) -> 409 ENTRY_LIMIT_REACHED", "re-validate + re-moderate text (fail-closed)"]),
            (2, 3, "INSERT campaign_entries (campaign_day in campaign tz)"),
            (2, 1, "201 {entry_id}", True),
            (1, 0, "201 -> navigate to /user-campaign/success", True),
        ], 900)


# ---------------------------------------------------------------- ERD
def erd():
    s = Svg(1500, 760)
    s.text(30, 40, "Database: campaign tables (PostgreSQL 16, created by create_all + additive migrations)", 22, "700")
    s.box(40, 80, 380, 230, "campaign_participants", [
        "id             int PK", "phone          varchar(16) UNIQUE", "email          varchar(255)",
        "token_version  int default 0", "created_at     timestamptz", "", "one row per phone; latest email wins"])
    s.box(520, 80, 420, 250, "campaign_entries", [
        "id               varchar(36) PK (uuid)", "participant_id   FK -> participants.id", "idempotency_key  varchar(64)",
        "design_id        varchar(64)", "text             varchar(64)", "campaign_day     date (campaign tz)", "created_at       timestamptz",
        "UNIQUE(participant_id, idempotency_key)"])
    s.box(40, 400, 420, 210, "campaign_otps  (send log + code)", [
        "id          int PK", "phone       varchar(16) idx", "code_hash   varchar(64) NULL (HMAC-SHA256)",
        "expires_at  timestamptz", "consumed_at timestamptz NULL", "created_at  timestamptz idx", "NULL hash = bypass send"])
    s.box(560, 400, 420, 170, "campaign_phone_guards", [
        "phone            varchar(16) PK", "blocked_until    timestamptz NULL", "block_reason     varchar(32) NULL",
        "failed_verifies  int default 0", "row lock serialises per phone"])
    s.arrow([(420, 160), (520, 160)], "1 : N", lx=470, ly=150, mono=False)
    s.arrow([(460, 480), (560, 480)], "by phone", lx=510, ly=470, mono=False, dash=True)
    s.box(1040, 80, 420, 250, "Existing PrintFlow tables (unchanged)", [
        "users, stores, print_formats", "orders, csv_batches, print_jobs", "app_settings", "", "Cloud Storage (/data):", "psd/ fonts/ inbox/ output/"], head="#dfe7fb")
    s.save("erd")


# ---------------------------------------------------------------- flow
def flow():
    s = Svg(1900, 900)
    s.text(30, 40, "Flow: consumer journey and the OTP rate limit (arrow diagram)", 22, "700")
    def node(x, y, w, h, t, fill="#dfe7fb"):
        s.parts.append(f"<rect x='{x}' y='{y}' width='{w}' height='{h}' rx='10' fill='{fill}' stroke='{BLUE}' stroke-width='2'/>")
        for i, ln in enumerate(t.split("\n")):
            s.text(x + w / 2, y + h / 2 + 5 + (i - (t.count("\n")) / 2) * 18, ln, 14, "600", DARK, "middle")
    row = [("Landing\n/user-campaign", 40), ("Login\nphone + email", 280), ("OTP verify", 520), ("Design + text\n/create", 760), ("Moderation\n(server)", 1000), ("Preview\ndownload/share", 1240), ("Submit entry\n(server window)", 1480), ("Thank-you\n/success", 1720)]
    for t, x in row:
        node(x, 90, 150, 70, t)
    for (_, a), (_, b) in zip(row, row[1:]):
        s.arrow([(a + 150, 125), (b, 125)])
    s.text(40, 210, "Refusals along the journey", 16, "700")
    refusals = [(520, "wrong code: 400 OTP_WRONG\n5 wrong: 429 OTP_LOCKED (2 h)"), (1000, "rejected: 422 TEXT_REJECTED\nchecker down: 503, never approved"), (1480, "409 WINDOW_CLOSED\n409 ENTRY_LIMIT_REACHED\n401 UNAUTHORIZED -> login")]
    for x, t in refusals:
        node(x - 10, 250, 190, 80 if t.count("\n") < 2 else 100, t, "#fde8e6")
        s.arrow([(x + 75, 160), (x + 85, 250)], color=RED)

    s.text(40, 430, "OTP send decision", 16, "700")
    node(40, 460, 200, 70, "POST /otp/send")
    node(320, 460, 240, 70, "phone blocked_until > now ?")
    node(660, 460, 240, 70, "sends in last 300 s >= 5 ?")
    node(1000, 460, 220, 70, "expire live code\nstore HMAC hash")
    node(1320, 460, 210, 70, "Infobip flag ON ?")
    node(1630, 400, 230, 70, "send DLT SMS", "#e3f4e6")
    node(1630, 520, 230, 70, "bypass: no SMS", "#fff8d6")
    node(320, 640, 240, 70, "429 OTP_BLOCKED\nretry_after = remaining", "#fde8e6")
    node(660, 640, 240, 70, "set blocked_until\n= now + 7200 s -> 429", "#fde8e6")
    s.arrow([(240, 495), (320, 495)])
    s.arrow([(560, 495), (660, 495)], "no", mono=False, lx=610, ly=485)
    s.arrow([(900, 495), (1000, 495)], "no", mono=False, lx=950, ly=485)
    s.arrow([(1220, 495), (1320, 495)])
    s.arrow([(1530, 480), (1630, 440)], "yes", mono=False, lx=1580, ly=450)
    s.arrow([(1530, 510), (1630, 550)], "no", mono=False, lx=1580, ly=545)
    s.arrow([(440, 530), (440, 640)], "yes", mono=False, lx=462, ly=590, color=RED)
    s.arrow([(780, 530), (780, 640)], "yes", mono=False, lx=802, ly=590, color=RED)
    s.text(40, 770, "Limits are settings: send limit 5, window 300 s, block 7200 s, verify failures 5, verify lock 7200 s, code TTL 300 s.", 14)
    s.text(40, 795, "State is in Postgres (campaign_otps, campaign_phone_guards), so the limits hold across Cloud Run instances and concurrent requests.", 14)
    s.save("flow")


if __name__ == "__main__":
    architecture()
    sequences()
    erd()
    flow()
    print("built:", ", ".join(sorted(p.name for p in OUT.glob("*.png"))))
