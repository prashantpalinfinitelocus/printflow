#!/usr/bin/env python3
"""Attach the UT evidence to the Confluence UT page and embed it in the page.

Uses the Confluence Cloud REST API with *your* API token; nothing is stored.

    export CONFLUENCE_EMAIL="you@company.com"
    export CONFLUENCE_API_TOKEN="<token from https://id.atlassian.com/manage-profile/security/api-tokens>"
    python3 docs/ut/upload_to_confluence.py --dry-run     # list what would be uploaded, no network
    python3 docs/ut/upload_to_confluence.py               # upload and embed

Safe to re-run: files that already exist on the page get a new version, and the
embedded evidence section is replaced, not duplicated. Python 3.8+, standard library
and `curl` only.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_BASE = "https://zapgift.atlassian.net/wiki"
DEFAULT_PAGE = "3686105163"  # "Diet Coke Campaign: UT report (full)"
MARKER = "<!-- ut-evidence-start -->"

SCREENSHOTS = [
    ("01-landing.png", "UT-01 Landing page on the domain root"),
    ("02-login-empty.png", "UT-02 Login dialog"),
    ("03-login-filled.png", "UT-03 Details filled, terms ticked"),
    ("04-otp-step.png", "UT-04 OTP step"),
    ("05-otp-wrong.png", "UT-05 Wrong OTP error"),
    ("06-create-design.png", "UT-06 After login: customiser"),
    ("07-create-text-entered.png", "UT-07 Beach vibes and the text Aanya"),
    ("08-preview.png", "UT-08 Preview"),
    ("09-success.png", "UT-09 Thank-you page"),
    ("10-terms.png", "UT-10 Terms and Conditions"),
    ("11-privacy.png", "UT-11 Privacy Policy"),
]
DIAGRAMS = [
    ("architecture.png", "GCP architecture"),
    ("sequence-login-otp.png", "Sequence: login with phone OTP and email"),
    ("sequence-entry.png", "Sequence: moderation, preview and entry"),
    ("flow.png", "Flow: journey and OTP rate-limit decision"),
    ("erd.png", "Database: campaign tables"),
]


def inventory() -> list[Path]:
    ut, hld = ROOT / "docs/ut", ROOT / "docs/hld"
    files = [ut / "Diet-Coke-Campaign-UT-Report.docx", ut / "ut-flow.mp4"]
    files += [ut / "screenshots" / n for n, _ in SCREENSHOTS]
    files += sorted((ut / "video-stills").glob("still-*.png"))
    files += [hld / "diagrams" / n for n, _ in DIAGRAMS]
    files += [hld / "campaign-openapi.json", hld / "campaign-schema.sql", ROOT / "docs/test-report/campaign-otp-performance.md"]
    return files


class Confluence:
    def __init__(self, base: str, email: str, token: str):
        self.base, self.email, self.token = base.rstrip("/"), email, token
        self.auth = "Basic " + base64.b64encode(f"{email}:{token}".encode()).decode()

    def json(self, method: str, path: str, body: dict | None = None):
        req = urllib.request.Request(
            f"{self.base}{path}", method=method,
            data=json.dumps(body).encode() if body is not None else None,
            headers={"Authorization": self.auth, "Accept": "application/json", "Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as res:
                return json.load(res)
        except urllib.error.HTTPError as exc:
            sys.exit(f"{method} {path} -> HTTP {exc.code}: {exc.read().decode()[:300]}")

    def upload(self, page: str, file: Path) -> str:
        """Attach `file` to the page, as a new version if a file of that name is already attached."""
        name = urllib.parse.quote(file.name)
        existing = self.json("GET", f"/rest/api/content/{page}/child/attachment?filename={name}").get("results", [])
        path = f"/rest/api/content/{page}/child/attachment" + (f"/{existing[0]['id']}/data" if existing else "")
        config = f'user = "{self.email}:{self.token}"\nheader = "X-Atlassian-Token: no-check"\n'  # keeps the token off argv
        out = subprocess.run(
            ["curl", "-sS", "-K", "-", "-o", "-", "-w", "\n%{http_code}", "-F", f"file=@{file}", "-F", "minorEdit=true", self.base + path],
            input=config, capture_output=True, text=True,
        )
        body, _, code = out.stdout.rpartition("\n")
        if out.returncode != 0 or not code.startswith("2"):
            sys.exit(f"upload of {file.name} failed (HTTP {code or '?'}): {(body or out.stderr)[:300]}")
        return "new version" if existing else "added"

    def page(self, page: str) -> dict:
        return self.json("GET", f"/rest/api/content/{page}?expand=body.storage,version")

    def replace_body(self, page: str, current: dict, storage: str) -> None:
        self.json("PUT", f"/rest/api/content/{page}", {
            "id": page, "type": current["type"], "title": current["title"],
            "version": {"number": current["version"]["number"] + 1, "message": "Embed UT evidence attachments"},
            "body": {"storage": {"value": storage, "representation": "storage"}},
        })


def image(name: str, width: int) -> str:
    return f'<ac:image ac:width="{width}"><ri:attachment ri:filename="{name}"/></ac:image>'


def evidence_section(stills: list[str]) -> str:
    def cell(name, caption, width):
        return f"<td><p>{image(name, width)}</p><p><em>{caption}</em></p></td>"

    def grid(items, cols, width):
        rows = [items[i:i + cols] for i in range(0, len(items), cols)]
        return "<table><tbody>" + "".join(
            "<tr>" + "".join(cell(n, c, width) for n, c in row) + "</tr>" for row in rows) + "</tbody></table>"

    video = ('<ac:structured-macro ac:name="view-file"><ac:parameter ac:name="name">'
             '<ri:attachment ri:filename="ut-flow.mp4"/></ac:parameter></ac:structured-macro>')
    doc = ('<ac:structured-macro ac:name="view-file"><ac:parameter ac:name="name">'
           '<ri:attachment ri:filename="Diet-Coke-Campaign-UT-Report.docx"/></ac:parameter></ac:structured-macro>')
    return (
        f"{MARKER}<h1>Evidence</h1>"
        "<h2>Full UT report (Word, 41 pages)</h2>" + doc +
        "<h2>Screen recording</h2><p>About 56 seconds: landing, login, OTP, bypass login, customiser, preview, entry, thank-you, Terms, Privacy.</p>" + video +
        "<h2>Screenshots (402x775 at 2x)</h2>" + grid(SCREENSHOTS, 3, 260) +
        "<h2>Video stills</h2>" + grid([(s, s.replace('.png', '')) for s in stills], 4, 190) +
        "<h2>Diagrams</h2>" + "".join(f"<h3>{c}</h3><p>{image(n, 700)}</p>" for n, c in DIAGRAMS) +
        "<h2>Supporting files</h2><ul>"
        '<li><ac:link><ri:attachment ri:filename="campaign-openapi.json"/></ac:link> (OpenAPI export)</li>'
        '<li><ac:link><ri:attachment ri:filename="campaign-schema.sql"/></ac:link> (table DDL)</li>'
        '<li><ac:link><ri:attachment ri:filename="campaign-otp-performance.md"/></ac:link> (performance report)</li></ul>'
    )


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true", help="list the files and exit without any network call")
    ap.add_argument("--no-embed", action="store_true", help="upload only; do not edit the page body")
    ap.add_argument("--base", default=os.environ.get("CONFLUENCE_BASE", DEFAULT_BASE))
    ap.add_argument("--page", default=os.environ.get("CONFLUENCE_PAGE_ID", DEFAULT_PAGE))
    args = ap.parse_args()

    files = inventory()
    missing = [str(f.relative_to(ROOT)) for f in files if not f.is_file()]
    if missing:
        sys.exit("missing files: " + ", ".join(missing))
    total = sum(f.stat().st_size for f in files) / 1048576
    print(f"{len(files)} files, {total:.1f} MB -> page {args.page} on {args.base}")
    if args.dry_run:
        for f in files:
            print(f"  {f.relative_to(ROOT)}  ({f.stat().st_size / 1024:.0f} KB)")
        return

    email, token = os.environ.get("CONFLUENCE_EMAIL"), os.environ.get("CONFLUENCE_API_TOKEN")
    if not email or not token:
        sys.exit("set CONFLUENCE_EMAIL and CONFLUENCE_API_TOKEN (see the top of this file)")
    cf = Confluence(args.base, email, token)

    for i, f in enumerate(files, 1):
        print(f"[{i:2}/{len(files)}] {f.name}: {cf.upload(args.page, f)}")

    if args.no_embed:
        return
    current = cf.page(args.page)
    body = current["body"]["storage"]["value"]
    body = body.split(MARKER)[0]  # replace a previous run's section instead of duplicating it
    stills = [f.name for f in files if f.name.startswith("still-")]
    cf.replace_body(args.page, current, body + evidence_section(stills))
    print("embedded the evidence section in the page body")


if __name__ == "__main__":
    main()
