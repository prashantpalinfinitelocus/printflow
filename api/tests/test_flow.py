"""End-to-end coverage of the paths that matter: auth, store scoping, CSV
import rules, rendering, printer dispatch, and reprint accounting."""

from __future__ import annotations

CSV_HEADER = "order_id,store_id,amount,print_format,text\n"


def _csv(*rows: str) -> bytes:
    return (CSV_HEADER + "\n".join(rows) + "\n").encode()


def _upload(client, headers, payload: bytes, name: str = "orders.csv"):
    return client.post(
        "/csv/upload",
        headers=headers,
        files={"file": (name, payload, "text/csv")},
    )


# ---------------- auth ----------------


def test_login_rejects_bad_password(client):
    res = client.post("/auth/login", json={"email": "admin@test.local", "password": "wrong"})
    assert res.status_code == 401


def test_endpoints_require_authentication(client):
    assert client.get("/orders").status_code == 401
    assert client.get("/stores").status_code == 401


def test_operator_cannot_reach_admin_endpoints(client, operator_headers):
    assert client.get("/users", headers=operator_headers).status_code == 403
    assert (
        client.post("/stores", headers=operator_headers, json={"code": "X", "name": "X"}).status_code
        == 403
    )


# ---------------- CSV import ----------------


def test_import_accepts_good_rows_and_reports_bad_ones(client, admin_headers):
    payload = _csv(
        "ORD-A1,TST01,100.00,TEST_FMT,Hello there",
        "ORD-A2,NOPE,100.00,TEST_FMT,Unknown store",
        "ORD-A3,TST01,100.00,MISSING_FMT,Unknown format",
        "ORD-A4,TST01,not-a-number,TEST_FMT,Bad amount",
        "ORD-A5,TST01,250.50,TEST_FMT,Second good row",
        "ORD-A1,TST01,100.00,TEST_FMT,Duplicate in file",
    )
    body = _upload(client, admin_headers, payload).json()

    assert body["total_rows"] == 6
    assert body["imported"] == 2
    assert body["skipped"] == 4
    reasons = " ".join(e["reason"] for e in body["errors"])
    assert "unknown store" in reasons
    assert "unknown print format" in reasons
    assert "not a number" in reasons
    assert "duplicate" in reasons


def test_import_rejects_a_csv_with_the_wrong_header(client, admin_headers):
    res = _upload(client, admin_headers, b"foo,bar\n1,2\n")
    assert res.status_code == 422
    assert "missing required column" in res.json()["detail"]


def test_reimporting_the_same_order_id_is_skipped(client, admin_headers):
    payload = _csv("ORD-DUP,TST01,10.00,TEST_FMT,First")
    assert _upload(client, admin_headers, payload).json()["imported"] == 1

    second = _upload(client, admin_headers, payload).json()
    assert second["imported"] == 0
    assert "already exists" in second["errors"][0]["reason"]


def test_column_aliases_are_accepted(client, admin_headers):
    payload = (
        b"Order ID,Store Code,Amount,Design,Message\n"
        b"ORD-ALIAS,TST01,75.00,TEST_FMT,Aliased header\n"
    )
    assert _upload(client, admin_headers, payload).json()["imported"] == 1


# ---------------- store scoping ----------------


def test_operator_sees_only_their_own_store(client, admin_headers, operator_headers, seeded):
    _upload(
        client,
        admin_headers,
        _csv(
            "ORD-MINE,TST01,10.00,TEST_FMT,Mine",
            "ORD-THEIRS,TST02,10.00,TEST_FMT,Theirs",
        ),
        name="scoping.csv",
    )

    refs = {o["order_ref"] for o in client.get("/orders", headers=operator_headers).json()["items"]}
    assert "ORD-MINE" in refs
    assert "ORD-THEIRS" not in refs

    all_orders = client.get("/orders", headers=admin_headers).json()["items"]
    theirs = next(o for o in all_orders if o["order_ref"] == "ORD-THEIRS")

    # Direct access and printing are both blocked, not just the listing.
    assert client.get(f"/orders/{theirs['id']}", headers=operator_headers).status_code == 404
    assert (
        client.post(
            f"/orders/{theirs['id']}/print",
            headers=operator_headers,
            json={"kind": "TIFF", "send_to_printer": False},
        ).status_code
        == 404
    )


# ---------------- printers ----------------


def test_printer_discovery_parses_lpstat(client, operator_headers):
    printers = client.get("/printers", headers=operator_headers).json()
    by_name = {p["name"]: p for p in printers}
    assert by_name["TEST_PRINTER"]["status"] == "idle"
    assert by_name["TEST_PRINTER"]["is_default"] is True
    assert by_name["OFFLINE_PRINTER"]["status"] == "disabled"


# ---------------- render + print ----------------


def _make_order(client, admin_headers, ref: str, text: str = "Print me"):
    _upload(client, admin_headers, _csv(f"{ref},TST01,99.00,TEST_FMT,{text}"), name=f"{ref}.csv")
    orders = client.get(f"/orders?q={ref}", headers=admin_headers).json()["items"]
    return orders[0]


def test_proof_render_produces_artifacts_without_printing(client, admin_headers, operator_headers, stub_log):
    order = _make_order(client, admin_headers, "ORD-PROOF")
    before = stub_log.read_text() if stub_log.exists() else ""

    res = client.post(
        f"/orders/{order['id']}/print",
        headers=operator_headers,
        json={"kind": "PDF", "send_to_printer": False},
    )
    assert res.status_code == 200, res.text
    body = res.json()

    assert body["job"]["status"] == "RENDERED"
    assert body["order"]["status"] == "PENDING"  # a proof must not advance the order
    assert (stub_log.read_text() if stub_log.exists() else "") == before  # lp never ran

    for kind, content_type in (("tiff", "image/tiff"), ("pdf", "application/pdf"), ("preview", "image/png")):
        artifact = client.get(
            f"/orders/{order['id']}/artifact/{kind}?job_id={body['job']['id']}",
            headers=operator_headers,
        )
        assert artifact.status_code == 200
        assert artifact.headers["content-type"] == content_type
        assert len(artifact.content) > 500


def test_tiff_artifact_is_cmyk_at_the_template_dpi(client, admin_headers, operator_headers):
    from io import BytesIO

    from PIL import Image

    order = _make_order(client, admin_headers, "ORD-CMYK")
    job = client.post(
        f"/orders/{order['id']}/print",
        headers=operator_headers,
        json={"kind": "TIFF", "send_to_printer": False},
    ).json()["job"]

    raw = client.get(
        f"/orders/{order['id']}/artifact/tiff?job_id={job['id']}", headers=operator_headers
    ).content
    image = Image.open(BytesIO(raw))

    assert image.mode == "CMYK"
    assert image.size == (600, 400)
    assert image.info["dpi"] == (300, 300)


def test_cmyk_tiff_embeds_its_icc_profile(client, admin_headers, operator_headers):
    """An untagged CMYK TIFF is interpreted by the viewer's own default press
    profile — which rendered these files near-black in macOS Preview. The
    profile must travel with the file."""
    from io import BytesIO

    from PIL import Image

    from app.services.renderer import find_cmyk_profile

    order = _make_order(client, admin_headers, "ORD-ICC")
    job = client.post(
        f"/orders/{order['id']}/print",
        headers=operator_headers,
        json={"kind": "TIFF", "send_to_printer": False},
    ).json()["job"]

    raw = client.get(
        f"/orders/{order['id']}/artifact/tiff?job_id={job['id']}", headers=operator_headers
    ).content
    image = Image.open(BytesIO(raw))

    if find_cmyk_profile() is None:
        # No profile on this host: we must fall back to RGB, never ship
        # untagged CMYK that nobody can interpret.
        assert image.mode == "RGB"
        return

    assert image.mode == "CMYK"
    assert image.info.get("icc_profile"), "CMYK TIFF shipped without an ICC profile"


def test_separation_uses_real_black_generation(client, admin_headers, operator_headers):
    """A colour-managed separation puts ink in K. The naive 255-R transform
    always left K=0, which is what made the files unreadable."""
    from app.services.renderer import find_cmyk_profile, to_cmyk

    if find_cmyk_profile() is None:
        import pytest

        pytest.skip("no CMYK profile on this host")

    from PIL import Image

    dark = Image.new("RGB", (8, 8), (30, 30, 30))
    separated, profile = to_cmyk(dark)
    assert profile, "profile bytes must be returned for embedding"
    assert separated.mode == "CMYK"
    assert separated.getpixel((4, 4))[3] > 0, "no black generation — naive transform is back"


def test_printing_dispatches_to_lp_and_marks_the_order_printed(
    client, admin_headers, operator_headers, stub_log
):
    order = _make_order(client, admin_headers, "ORD-PRINT")

    res = client.post(
        f"/orders/{order['id']}/print",
        headers=operator_headers,
        json={"kind": "TIFF", "printer_name": "TEST_PRINTER", "send_to_printer": True, "copies": 3},
    )
    assert res.status_code == 200, res.text
    body = res.json()

    assert body["job"]["status"] == "SENT_TO_PRINTER"
    assert body["job"]["cups_job_id"] == "TEST-42"
    assert body["order"]["status"] == "PRINTED"
    assert body["order"]["reprint_count"] == 0
    assert body["order"]["printed_at"] is not None

    invocation = stub_log.read_text().strip().splitlines()[-1]
    assert "-d TEST_PRINTER" in invocation
    assert "-n 3" in invocation
    assert invocation.endswith(".tif")  # the TIFF, not the PDF proof


def test_printing_a_pdf_sends_the_pdf_file(client, admin_headers, operator_headers, stub_log):
    order = _make_order(client, admin_headers, "ORD-PDFSEND")
    client.post(
        f"/orders/{order['id']}/print",
        headers=operator_headers,
        json={"kind": "PDF", "printer_name": "TEST_PRINTER", "send_to_printer": True},
    )
    assert stub_log.read_text().strip().splitlines()[-1].endswith(".pdf")


def test_reprint_increments_the_counter_and_flags_the_job(client, admin_headers, operator_headers):
    order = _make_order(client, admin_headers, "ORD-REPRINT")
    print_body = {"kind": "TIFF", "printer_name": "TEST_PRINTER", "send_to_printer": True}

    first = client.post(f"/orders/{order['id']}/print", headers=operator_headers, json=print_body).json()
    assert first["job"]["is_reprint"] is False
    assert first["order"]["reprint_count"] == 0

    second = client.post(f"/orders/{order['id']}/print", headers=operator_headers, json=print_body).json()
    assert second["job"]["is_reprint"] is True
    assert second["order"]["reprint_count"] == 1
    assert second["order"]["status"] == "PRINTED"

    third = client.post(f"/orders/{order['id']}/print", headers=operator_headers, json=print_body).json()
    assert third["order"]["reprint_count"] == 2

    jobs = client.get(f"/orders/{order['id']}/jobs", headers=operator_headers).json()
    assert len(jobs) == 3
    assert [j["is_reprint"] for j in jobs] == [True, True, False]  # newest first


def test_non_latin_text_picks_a_font_that_covers_it(client, admin_headers, operator_headers):
    """Devanagari must not silently print as tofu boxes."""
    from app.services.renderer import select_font_path

    path, missing = select_font_path("जन्मदिन की शुभकामनाएं")
    if path is None:
        import pytest

        pytest.skip("no fonts installed on this host")
    assert missing == "", f"no font covers: {missing}"

    order = _make_order(client, admin_headers, "ORD-HINDI", "जन्मदिन की शुभकामनाएं")
    res = client.post(
        f"/orders/{order['id']}/print",
        headers=operator_headers,
        json={"kind": "TIFF", "send_to_printer": False},
    )
    assert res.status_code == 200
    assert res.json()["warning"] is None


def test_latin_text_keeps_using_the_preferred_face(client):
    """Adding fallbacks must not change how existing Latin designs render."""
    from app.services.renderer import FONT_CANDIDATES, select_font_path

    path, missing = select_font_path("Happy Birthday, Riya!")
    assert missing == ""
    if path is not None:
        assert path in FONT_CANDIDATES


def test_uncoverable_characters_are_reported_not_hidden(client, admin_headers, operator_headers):
    """Emoji have no glyphs in any text font here — the operator must be told."""
    from app.services.renderer import select_font_path

    _, missing = select_font_path("Cheers 🎉")
    if not missing:
        import pytest

        pytest.skip("this host has an emoji-capable text font")

    order = _make_order(client, admin_headers, "ORD-EMOJI", "Cheers 🎉")
    body = client.post(
        f"/orders/{order['id']}/print",
        headers=operator_headers,
        json={"kind": "TIFF", "send_to_printer": False},
    ).json()

    assert body["job"]["status"] == "RENDERED"  # still produces a file
    assert body["warning"] is not None
    assert "🎉" in body["warning"]


def test_long_text_still_renders_within_the_box(client, admin_headers, operator_headers):
    long_text = "A dedication long enough to force several wrapped lines and a smaller font size"
    order = _make_order(client, admin_headers, "ORD-LONG", long_text)
    res = client.post(
        f"/orders/{order['id']}/print",
        headers=operator_headers,
        json={"kind": "TIFF", "send_to_printer": False},
    )
    assert res.status_code == 200
    assert res.json()["job"]["status"] == "RENDERED"


# ---------------- user + store administration ----------------


def test_admin_creates_deactivates_and_blocks_deactivated_login(client, admin_headers, seeded):
    created = client.post(
        "/users",
        headers=admin_headers,
        json={
            "email": "New.Operator@Test.local",
            "password": "secret123",
            "role": "OPERATOR",
            "store_id": seeded["store_id"],
        },
    )
    assert created.status_code == 201
    user = created.json()
    assert user["email"] == "new.operator@test.local"  # normalised

    login = {"email": "new.operator@test.local", "password": "secret123"}
    assert client.post("/auth/login", json=login).status_code == 200

    client.patch(f"/users/{user['id']}", headers=admin_headers, json={"is_active": False})
    assert client.post("/auth/login", json=login).status_code == 403


def test_operator_must_have_a_store(client, admin_headers):
    res = client.post(
        "/users",
        headers=admin_headers,
        json={"email": "nostore@test.local", "password": "secret123", "role": "OPERATOR"},
    )
    assert res.status_code == 422


def test_admin_cannot_deactivate_themselves(client, admin_headers):
    me = client.get("/auth/me", headers=admin_headers).json()
    res = client.patch(f"/users/{me['id']}", headers=admin_headers, json={"is_active": False})
    assert res.status_code == 400


def test_store_with_orders_cannot_be_deleted(client, admin_headers, seeded):
    _upload(client, admin_headers, _csv("ORD-KEEP,TST01,10.00,TEST_FMT,Keep"), name="keep.csv")
    res = client.delete(f"/stores/{seeded['store_id']}", headers=admin_headers)
    assert res.status_code == 409
    assert "deactivate" in res.json()["detail"]


def test_inactive_store_rejects_new_csv_rows(client, admin_headers, seeded):
    client.patch(f"/stores/{seeded['other_store_id']}", headers=admin_headers, json={"is_active": False})
    body = _upload(
        client, admin_headers, _csv("ORD-INACTIVE,TST02,10.00,TEST_FMT,Nope"), name="inactive.csv"
    ).json()
    assert body["imported"] == 0
    assert "inactive" in body["errors"][0]["reason"]
    client.patch(f"/stores/{seeded['other_store_id']}", headers=admin_headers, json={"is_active": True})


# ---------- format configuration endpoints ----------


def test_fonts_endpoint_lists_installed_fonts(client, admin_headers, app_modules):
    """Fonts dropped into the fonts dir become selectable in the format editor."""
    from app.config import settings

    fonts = client.get("/print-formats/fonts", headers=admin_headers).json()
    # The fixture data dir starts empty, so this pins the contract, not content.
    assert all({"filename", "family"} <= set(f) for f in fonts)
    assert {f["filename"] for f in fonts} <= {p.name for p in settings.fonts_dir.glob("*")}


def test_upload_font_rejects_a_non_font(client, admin_headers):
    res = client.post(
        "/print-formats/upload-font",
        headers=admin_headers,
        files={"file": ("notafont.ttf", b"this is not a font", "font/ttf")},
    )
    assert res.status_code == 422
    assert "not a readable font" in res.json()["detail"]


def test_upload_font_rejects_wrong_extension(client, admin_headers):
    res = client.post(
        "/print-formats/upload-font",
        headers=admin_headers,
        files={"file": ("design.psd", b"8BPS", "application/octet-stream")},
    )
    assert res.status_code == 422


def test_operators_cannot_upload_fonts(client, operator_headers):
    res = client.post(
        "/print-formats/upload-font",
        headers=operator_headers,
        files={"file": ("x.ttf", b"x", "font/ttf")},
    )
    assert res.status_code == 403


def test_detect_placeholder_reports_a_missing_colour(client, admin_headers, seeded):
    """A colour that is not in the artwork must explain itself, not return a box."""
    fmt = client.get("/print-formats", headers=admin_headers).json()[0]
    res = client.post(
        "/print-formats/detect-placeholder",
        headers=admin_headers,
        json={"psd_path": fmt["psd_path"], "color": "#00FF7F"},
    )
    assert res.status_code == 422
    assert "No pixels matching" in res.json()["detail"]


def test_per_format_config_round_trips(client, admin_headers):
    """The renderer reads these four columns on every print — they must persist."""
    fmt = client.get("/print-formats", headers=admin_headers).json()[0]
    res = client.patch(
        f"/print-formats/{fmt['id']}",
        headers=admin_headers,
        json={
            "font_path": "You2013 Regular.ttf",
            "placeholder_color": "#ED1C24",
            "colorspace": "RGB",
            "preserve_alpha": True,
            "dpi": 508,
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["font_path"] == "You2013 Regular.ttf"
    assert body["placeholder_color"] == "#ED1C24"
    assert body["colorspace"] == "RGB"
    assert body["preserve_alpha"] is True
    assert body["dpi"] == 508

    # And again on a fresh read, not just the write response.
    reread = next(
        f for f in client.get("/print-formats", headers=admin_headers).json() if f["id"] == fmt["id"]
    )
    assert reread["preserve_alpha"] is True
    assert reread["dpi"] == 508


def test_download_delivery_marks_printed_without_touching_cups(
    client, admin_headers, operator_headers, stub_log
):
    """Cloud deployments have no printer — the operator prints the file locally.

    The order must still count as printed, and `lp` must never be invoked.
    """
    order = _make_order(client, admin_headers, "ORD-DL1")
    before = stub_log.read_text() if stub_log.exists() else ""

    res = client.post(
        f"/orders/{order['id']}/print",
        headers=operator_headers,
        json={"kind": "TIFF", "delivery": "DOWNLOAD"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["job"]["status"] == "DOWNLOADED"
    assert body["job"]["cups_job_id"] is None
    assert body["order"]["status"] == "PRINTED"
    assert (stub_log.read_text() if stub_log.exists() else "") == before, "lp must not run"

    # The file the operator is about to print must actually be fetchable, and
    # must download rather than render in the tab.
    artifact = client.get(
        f"/orders/{order['id']}/artifact/tiff?job_id={body['job']['id']}",
        headers=operator_headers,
    )
    assert artifact.status_code == 200
    assert artifact.headers["content-type"] == "image/tiff"
    assert "attachment" in artifact.headers["content-disposition"]


def test_download_delivery_counts_as_a_reprint_the_second_time(
    client, admin_headers, operator_headers
):
    order = _make_order(client, admin_headers, "ORD-DL2")
    body = {"kind": "TIFF", "delivery": "DOWNLOAD"}

    first = client.post(f"/orders/{order['id']}/print", headers=operator_headers, json=body).json()
    assert first["order"]["reprint_count"] == 0
    assert first["job"]["is_reprint"] is False

    second = client.post(f"/orders/{order['id']}/print", headers=operator_headers, json=body).json()
    assert second["order"]["reprint_count"] == 1
    assert second["job"]["is_reprint"] is True


def test_proof_delivery_leaves_the_order_alone(client, admin_headers, operator_headers):
    order = _make_order(client, admin_headers, "ORD-DL3")
    res = client.post(
        f"/orders/{order['id']}/print",
        headers=operator_headers,
        json={"kind": "PDF", "delivery": "PROOF"},
    )
    assert res.status_code == 200
    assert res.json()["order"]["status"] == "PENDING"


def test_delivery_overrides_the_legacy_send_to_printer_flag(
    client, admin_headers, operator_headers, stub_log
):
    """Old clients send send_to_printer; new ones send delivery. When both are
    present delivery wins, so a DOWNLOAD never leaks into a real dispatch."""
    order = _make_order(client, admin_headers, "ORD-DL4")
    before = stub_log.read_text() if stub_log.exists() else ""

    res = client.post(
        f"/orders/{order['id']}/print",
        headers=operator_headers,
        json={"kind": "TIFF", "delivery": "DOWNLOAD", "send_to_printer": True},
    )
    assert res.json()["job"]["status"] == "DOWNLOADED"
    assert (stub_log.read_text() if stub_log.exists() else "") == before


# ---------------- page-sized output ----------------
#
# A label-sized artifact is the one every consumer print path enlarges: handed a
# 2in canvas and a sheet of A4, Windows Photos' default "Fit picture to frame"
# scales it up and crops into the artwork. These cover the padding that removes
# the room for that.


def _usable(name: str, dpi: int) -> tuple[int, int]:
    """The page a format of this size lays out on, in pixels, landscape-first.

    Derived from the same registry and margin the renderer uses, so these tests
    check the padding rather than restating its arithmetic.
    """
    from app.config import settings
    from app.services.renderer import PAGE_SIZES_IN

    short_in, long_in = (side - 2 * settings.page_margin_in for side in PAGE_SIZES_IN[name])
    return round(long_in * dpi), round(short_in * dpi)


def _page_format(client, admin_headers, code: str, **overrides):
    """A second print format so page tests never mutate the shared TEST_FMT."""
    body = {
        "code": code,
        "name": code.title(),
        "psd_path": "test.psd",
        "text_box": {"x": 50, "y": 150, "w": 500, "h": 100},
        "dpi": 300,
        "font_size": 48,
        "font_color": "#FFFFFF",
        "align": "center",
        **overrides,
    }
    res = client.post("/print-formats", headers=admin_headers, json=body)
    assert res.status_code == 201, res.text
    return res.json()


def _render(client, admin_headers, operator_headers, ref: str, format_code: str):
    _upload(
        client,
        admin_headers,
        _csv(f"{ref},TST01,99.00,{format_code},Print me"),
        name=f"{ref}.csv",
    )
    order = client.get(f"/orders?q={ref}", headers=admin_headers).json()["items"][0]
    res = client.post(
        f"/orders/{order['id']}/print",
        headers=operator_headers,
        json={"kind": "TIFF", "delivery": "PROOF"},
    )
    assert res.status_code == 200, res.text
    return order, res.json()


def _artifact(client, operator_headers, order_id: int, job_id: int, kind: str):
    from io import BytesIO

    from PIL import Image

    raw = client.get(
        f"/orders/{order_id}/artifact/{kind}?job_id={job_id}", headers=operator_headers
    ).content
    return Image.open(BytesIO(raw))


def test_page_sizes_endpoint_lists_the_sheets_a_format_can_use(client, operator_headers):
    sizes = client.get("/print-formats/page-sizes", headers=operator_headers).json()
    by_name = {s["name"]: s for s in sizes}
    assert "A4" in by_name and "4X6" in by_name
    assert by_name["A4"]["width_in"] == 8.27
    assert by_name["A4"]["height_in"] == 11.69


def test_page_size_round_trips_and_normalises(client, admin_headers):
    fmt = _page_format(client, admin_headers, "PAGE_RT")
    assert fmt["page_size"] is None  # off unless asked for

    res = client.patch(
        f"/print-formats/{fmt['id']}", headers=admin_headers, json={"page_size": "a4"}
    )
    assert res.status_code == 200, res.text
    assert res.json()["page_size"] == "A4"

    reread = next(
        f for f in client.get("/print-formats", headers=admin_headers).json()
        if f["id"] == fmt["id"]
    )
    assert reread["page_size"] == "A4"

    # Blank clears it, back to a label-sized file.
    cleared = client.patch(
        f"/print-formats/{fmt['id']}", headers=admin_headers, json={"page_size": ""}
    )
    assert cleared.json()["page_size"] is None


def test_unknown_page_size_is_rejected_at_the_api(client, admin_headers):
    """A typo must not slip through to become a label-sized file on A4 paper."""
    fmt = _page_format(client, admin_headers, "PAGE_BAD")
    res = client.patch(
        f"/print-formats/{fmt['id']}", headers=admin_headers, json={"page_size": "A3"}
    )
    assert res.status_code == 422
    assert "unknown page size" in res.text


def test_no_page_size_leaves_the_artifact_label_sized(client, admin_headers, operator_headers):
    """The default must not change what existing formats emit."""
    order, body = _render(client, admin_headers, operator_headers, "ORD-PG0", "TEST_FMT")
    tiff = _artifact(client, operator_headers, order["id"], body["job"]["id"], "tiff")
    assert tiff.size == (600, 400)


def test_page_size_pads_the_artifact_out_to_the_sheet(client, admin_headers, operator_headers):
    _page_format(client, admin_headers, "PAGE_A4", page_size="A4")
    order, body = _render(client, admin_headers, operator_headers, "ORD-PG1", "PAGE_A4")

    tiff = _artifact(client, operator_headers, order["id"], body["job"]["id"], "tiff")
    # 600x400 @ 300dpi is a 2.00x1.33in label, so it lands on A4 landscape —
    # inset by the safe margin, because CUPS shrinks a full-bleed page to fit.
    assert tiff.size == _usable("A4", 300)
    assert tiff.info["dpi"] == (300, 300)
    assert body["warning"] is None

    # The PDF proof carries the same page, so it prints 1:1 too.
    pdf_bytes = client.get(
        f"/orders/{order['id']}/artifact/pdf?job_id={body['job']['id']}", headers=operator_headers
    ).content
    import re

    box = re.search(rb"/MediaBox\s*\[([^\]]*)\]", pdf_bytes)
    left, bottom, right, top = (float(v) for v in box.group(1).split())
    page_w, page_h = _usable("A4", 300)
    assert abs((right - left) / 72 - page_w / 300) < 0.02  # inches
    assert abs((top - bottom) / 72 - page_h / 300) < 0.02


def test_page_size_keeps_the_label_at_true_size_and_centres_it(
    client, admin_headers, operator_headers
):
    """The whole point: the artwork must be padded, never scaled."""
    from PIL import Image, ImageChops

    _page_format(client, admin_headers, "PAGE_TRUE", page_size="A4")
    order, body = _render(client, admin_headers, operator_headers, "ORD-PG2", "PAGE_TRUE")
    tiff = _artifact(client, operator_headers, order["id"], body["job"]["id"], "tiff")

    rgb = tiff.convert("RGB")
    white = Image.new("RGB", rgb.size, (255, 255, 255))
    x0, y0, x1, y1 = ImageChops.difference(rgb, white).getbbox()
    assert (x1 - x0, y1 - y0) == (600, 400)  # unscaled

    # Centred, so "fit to page" has nothing to shift and cannot crop the art.
    assert abs(x0 - (rgb.width - 600) // 2) <= 1
    assert abs(y0 - (rgb.height - 400) // 2) <= 1


def test_page_uses_the_labels_own_orientation(client, admin_headers, operator_headers):
    """A wide label belongs on a landscape sheet, not a tall one."""
    _page_format(client, admin_headers, "PAGE_ORIENT", page_size="A5")
    order, body = _render(client, admin_headers, operator_headers, "ORD-PG3", "PAGE_ORIENT")
    tiff = _artifact(client, operator_headers, order["id"], body["job"]["id"], "tiff")
    assert tiff.width > tiff.height  # the 600x400 label is landscape


def test_a_label_too_big_for_the_sheet_is_not_shrunk_but_reported(
    client, admin_headers, operator_headers
):
    """Scaling the label down to fit would push the artwork off the die-cut line.
    Leaving it alone and telling the operator beats silently misprinting it."""
    # 600x400 at 72dpi is 8.33x5.56in — wider than a 4x6 sheet either way round.
    _page_format(client, admin_headers, "PAGE_BIG", page_size="4X6", dpi=72)
    order, body = _render(client, admin_headers, operator_headers, "ORD-PG4", "PAGE_BIG")

    tiff = _artifact(client, operator_headers, order["id"], body["job"]["id"], "tiff")
    assert tiff.size == (600, 400)  # untouched, not squeezed onto the sheet
    assert "does not fit" in body["warning"]
    assert "4X6" in body["warning"]


def test_padding_stays_transparent_for_die_cut_formats(
    client, admin_headers, operator_headers
):
    """A white matte around a die-cut label is the bug the RGBA path exists to
    avoid — the padding must not reintroduce it."""
    _page_format(
        client,
        admin_headers,
        "PAGE_ALPHA",
        page_size="A4",
        colorspace="RGB",
        preserve_alpha=True,
    )
    order, body = _render(client, admin_headers, operator_headers, "ORD-PG5", "PAGE_ALPHA")
    tiff = _artifact(client, operator_headers, order["id"], body["job"]["id"], "tiff")

    assert tiff.mode == "RGBA"
    assert tiff.getpixel((0, 0))[3] == 0  # corner of the sheet is transparent
    # The label itself stays opaque in the middle.
    assert tiff.getpixel((tiff.width // 2, tiff.height // 2))[3] == 255


def test_the_page_is_inset_so_cups_does_not_shrink_it(client, admin_headers, operator_headers):
    """A page that fills the sheet edge-to-edge is worse than no page at all:
    CUPS scales anything wider than the printer's printable area down to fit, so
    a full-bleed A4 artifact printed at 0.94x on the one route that was correct
    before. The artifact must stay inside the sheet by the safe margin."""
    from app.config import settings
    from app.services.renderer import PAGE_SIZES_IN

    _page_format(client, admin_headers, "PAGE_INSET", page_size="A4")
    order, body = _render(client, admin_headers, operator_headers, "ORD-PG6", "PAGE_INSET")
    tiff = _artifact(client, operator_headers, order["id"], body["job"]["id"], "tiff")

    sheet_short, sheet_long = PAGE_SIZES_IN["A4"]
    assert settings.page_margin_in > 0
    assert tiff.width / 300 < sheet_long
    assert tiff.height / 300 < sheet_short
    # Inset on both axes by the configured margin, not cropped on one.
    assert abs(sheet_long - tiff.width / 300 - 2 * settings.page_margin_in) < 0.01
    assert abs(sheet_short - tiff.height / 300 - 2 * settings.page_margin_in) < 0.01


# ---------------- multi-pass printing ----------------
#
# A single pass of light ink on aluminium goes down translucent — the can's own
# artwork reads through it. Opacity is built with 2-3 passes over the same can.
# These cover the pass count reaching CUPS, and staying out of reprint accounting.


def test_print_passes_defaults_to_one(client, admin_headers):
    fmt = _page_format(client, admin_headers, "PASS_DEFAULT")
    assert fmt["print_passes"] == 1


def test_print_passes_round_trips_and_is_bounded(client, admin_headers):
    fmt = _page_format(client, admin_headers, "PASS_RT")

    res = client.patch(
        f"/print-formats/{fmt['id']}", headers=admin_headers, json={"print_passes": 3}
    )
    assert res.status_code == 200, res.text
    assert res.json()["print_passes"] == 3

    reread = next(
        f for f in client.get("/print-formats", headers=admin_headers).json()
        if f["id"] == fmt["id"]
    )
    assert reread["print_passes"] == 3

    for bad in (0, -1, 11):
        assert (
            client.patch(
                f"/print-formats/{fmt['id']}", headers=admin_headers, json={"print_passes": bad}
            ).status_code
            == 422
        )


def test_each_pass_is_submitted_to_cups(client, admin_headers, operator_headers, stub_log):
    """Three passes must reach the printer as three impressions on one object."""
    _page_format(client, admin_headers, "PASS_CUPS", print_passes=3)
    _upload(
        client,
        admin_headers,
        _csv("ORD-PASS1,TST01,99.00,PASS_CUPS,Aditya"),
        name="ORD-PASS1.csv",
    )
    order = client.get("/orders?q=ORD-PASS1", headers=admin_headers).json()["items"][0]
    before = len(stub_log.read_text().splitlines()) if stub_log.exists() else 0

    res = client.post(
        f"/orders/{order['id']}/print",
        headers=operator_headers,
        json={"kind": "TIFF", "delivery": "PRINTER"},
    )
    assert res.status_code == 200, res.text
    job = res.json()["job"]

    after = stub_log.read_text().splitlines()
    assert len(after) - before == 3  # lp ran once per pass
    assert job["passes"] == 3
    assert len(job["cups_job_id"].split(",")) == 3
    assert job["status"] == "SENT_TO_PRINTER"


def test_passes_are_one_job_and_never_count_as_reprints(
    client, admin_headers, operator_headers
):
    """Three passes are one fulfilment. Logging them as three jobs would read as
    one print plus two reprints and make reprint_count meaningless."""
    _page_format(client, admin_headers, "PASS_REPRINT", print_passes=3)
    _upload(
        client,
        admin_headers,
        _csv("ORD-PASS2,TST01,99.00,PASS_REPRINT,Sonali"),
        name="ORD-PASS2.csv",
    )
    order = client.get("/orders?q=ORD-PASS2", headers=admin_headers).json()["items"][0]

    first = client.post(
        f"/orders/{order['id']}/print",
        headers=operator_headers,
        json={"kind": "TIFF", "delivery": "PRINTER"},
    ).json()
    assert first["order"]["status"] == "PRINTED"
    assert first["order"]["reprint_count"] == 0  # 3 passes, still the first print

    # A genuine reprint — the operator running the order again — counts once.
    second = client.post(
        f"/orders/{order['id']}/print",
        headers=operator_headers,
        json={"kind": "TIFF", "delivery": "PRINTER"},
    ).json()
    assert second["order"]["reprint_count"] == 1
    assert second["job"]["is_reprint"] is True

    jobs = client.get(f"/orders/{order['id']}/jobs", headers=admin_headers).json()
    assert len(jobs) == 2  # two jobs, not six
    assert [j["passes"] for j in jobs] == [3, 3]


def test_a_failed_pass_records_how_many_actually_printed(
    client, admin_headers, operator_headers, monkeypatch
):
    """Half an opacity build is worse than none — the operator has to be told
    which pass died, not just that printing failed."""
    from app.services import printing as printing_service

    _page_format(client, admin_headers, "PASS_FAIL", print_passes=3)
    _upload(
        client,
        admin_headers,
        _csv("ORD-PASS3,TST01,99.00,PASS_FAIL,Aditya"),
        name="ORD-PASS3.csv",
    )
    order = client.get("/orders?q=ORD-PASS3", headers=admin_headers).json()["items"][0]

    calls = {"n": 0}
    real = printing_service.send_to_printer

    def flaky(file_path, printer_name, copies=1):
        calls["n"] += 1
        if calls["n"] == 2:
            raise printing_service.PrintingError("printer jammed")
        return real(file_path, printer_name, copies)

    monkeypatch.setattr(printing_service, "send_to_printer", flaky)

    res = client.post(
        f"/orders/{order['id']}/print",
        headers=operator_headers,
        json={"kind": "TIFF", "delivery": "PRINTER"},
    )
    assert res.status_code == 502
    assert "pass 2 of 3" in res.json()["detail"]

    reread = client.get(f"/orders/{order['id']}", headers=admin_headers).json()
    assert reread["status"] == "FAILED"
    job = client.get(f"/orders/{order['id']}/jobs", headers=admin_headers).json()[0]
    assert job["passes"] == 1  # one impression made it down before the jam
    assert "pass 2 of 3" in job["error"]


def test_download_delivery_records_the_passes_the_operator_was_told_to_run(
    client, admin_headers, operator_headers, stub_log
):
    """The server never sees the printer on this route, so the pass count is the
    instruction given — it still has to be on the job for the audit trail."""
    _page_format(client, admin_headers, "PASS_DL", print_passes=3)
    _upload(
        client,
        admin_headers,
        _csv("ORD-PASS4,TST01,99.00,PASS_DL,Sonali"),
        name="ORD-PASS4.csv",
    )
    order = client.get("/orders?q=ORD-PASS4", headers=admin_headers).json()["items"][0]
    before = stub_log.read_text() if stub_log.exists() else ""

    body = client.post(
        f"/orders/{order['id']}/print",
        headers=operator_headers,
        json={"kind": "TIFF", "delivery": "DOWNLOAD"},
    ).json()

    assert body["job"]["passes"] == 3
    assert body["job"]["status"] == "DOWNLOADED"
    assert body["order"]["reprint_count"] == 0
    assert (stub_log.read_text() if stub_log.exists() else "") == before  # lp untouched


def test_a_single_pass_format_submits_once(client, admin_headers, operator_headers, stub_log):
    """The default must not change what existing formats do at the printer."""
    order = _make_order(client, admin_headers, "ORD-PASS5")
    before = len(stub_log.read_text().splitlines()) if stub_log.exists() else 0

    body = client.post(
        f"/orders/{order['id']}/print",
        headers=operator_headers,
        json={"kind": "TIFF", "delivery": "PRINTER"},
    ).json()

    assert len(stub_log.read_text().splitlines()) - before == 1
    assert body["job"]["passes"] == 1


# ---------------- white spot channels ----------------
#
# A UV press lays white ink first, and it will not derive that plate from an
# alpha channel on its own — it wants named spot channels. The operator was
# adding them by hand in Photoshop on every job. These lock the structure to the
# file the press already accepts, because a Pillow or tifffile upgrade would
# otherwise drop it silently and the artwork would print translucent.


def _ps_resources(blob: bytes) -> dict[int, bytes]:
    """Split a Photoshop image-resource block into {resource_id: payload}."""
    import struct

    pos, out = 0, {}
    while pos < len(blob) - 8 and blob[pos : pos + 4] == b"8BIM":
        rid = struct.unpack_from(">H", blob, pos + 4)[0]
        q = pos + 6
        name_len = blob[q]
        q += 1 + name_len
        if (1 + name_len) % 2:
            q += 1
        size = struct.unpack_from(">I", blob, q)[0]
        q += 4
        out[rid] = blob[q : q + size]
        pos = q + size + (size % 2)
    return out


def _channel_names(blob: bytes) -> list[str]:
    """Decode resource 1045, the unicode channel names."""
    import struct

    data = _ps_resources(blob)[1045]
    i, names = 0, []
    while i + 4 <= len(data):
        length = struct.unpack_from(">I", data, i)[0]
        i += 4
        names.append(data[i : i + length * 2].decode("utf-16-be").rstrip("\x00"))
        i += length * 2
    return names


def _job_artifact_path(client, headers, order_id: int, job_id: int, kind: str = "tiff"):
    """Download an artifact to a temp file.

    Not just convenience: Pillow refuses more than six samples per pixel, so a
    three-pass file cannot be opened with it at all — these have to go through
    tifffile, which wants a path.
    """
    import pathlib
    import tempfile

    raw = client.get(
        f"/orders/{order_id}/artifact/{kind}?job_id={job_id}", headers=headers
    ).content
    path = pathlib.Path(tempfile.mkstemp(suffix=".tif")[1])
    path.write_bytes(raw)
    return path


def _tiff_tags(path) -> dict:
    """Tags only. Decoding is deliberately avoided: the plain path writes LZW,
    which tifffile cannot expand without the optional imagecodecs package."""
    import tifffile

    with tifffile.TiffFile(str(path)) as tf:
        return {t.code: t.value for t in tf.pages[0].tags}


def _read_spot_tiff(path):
    import tifffile

    with tifffile.TiffFile(str(path)) as tf:
        page = tf.pages[0]
        tags = {t.code: t.value for t in page.tags}
        return page.asarray(), tags


def test_white_plate_names_follow_the_press_convention():
    """The press file carries the W1/W2 pair; extra opacity appends more W1."""
    from app.services.renderer import white_plate_names

    assert white_plate_names(0) == []
    assert white_plate_names(1) == ["W1", "W2"]
    assert white_plate_names(2) == ["W1", "W2", "W1"]
    assert white_plate_names(3) == ["W1", "W2", "W1", "W1"]
    # The count that matters to the press is how many W1 plates it gets.
    assert white_plate_names(3).count("W1") == 3


def test_white_passes_round_trips_and_is_bounded(client, admin_headers):
    fmt = _page_format(client, admin_headers, "WHITE_RT")
    assert fmt["white_passes"] == 0  # off unless asked for

    res = client.patch(
        f"/print-formats/{fmt['id']}", headers=admin_headers, json={"white_passes": 3}
    )
    assert res.status_code == 200, res.text
    assert res.json()["white_passes"] == 3

    reread = next(
        f for f in client.get("/print-formats", headers=admin_headers).json()
        if f["id"] == fmt["id"]
    )
    assert reread["white_passes"] == 3
    for bad in (-1, 7):
        assert (
            client.patch(
                f"/print-formats/{fmt['id']}", headers=admin_headers, json={"white_passes": bad}
            ).status_code
            == 422
        )


def test_no_white_passes_leaves_the_tiff_alone(client, admin_headers, operator_headers):
    """The default must not add channels to formats that never asked for them."""
    _page_format(
        client, admin_headers, "WHITE_OFF", colorspace="RGB", preserve_alpha=True, white_passes=0
    )
    order, body = _render(client, admin_headers, operator_headers, "ORD-W0", "WHITE_OFF")
    tags = _tiff_tags(_job_artifact_path(client, admin_headers, order["id"], body["job"]["id"]))

    assert tags[277] == 4  # R, G, B, alpha — nothing more
    assert 34377 not in tags  # no Photoshop channel-name block
    assert 37724 not in tags  # no document block


def test_white_passes_writes_named_spot_plates(client, admin_headers, operator_headers):
    """One pass of white is the W1/W2 pair, each plate the inverse of the alpha."""
    import numpy as np

    _page_format(
        client, admin_headers, "WHITE_ONE",
        colorspace="RGB", preserve_alpha=True, white_passes=1,
    )
    order, body = _render(client, admin_headers, operator_headers, "ORD-W1", "WHITE_ONE")
    assert body["warning"] is None

    path = _job_artifact_path(client, admin_headers, order["id"], body["job"]["id"])
    arr, tags = _read_spot_tiff(path)

    assert tags[277] == 6  # R, G, B, Transparency, W1, W2
    assert tuple(int(e) for e in tags[338]) == (1, 0, 0)  # associated alpha, then plates
    assert tags[262] == 2  # RGB photometric
    assert tags[259] == 1  # uncompressed, as the press files are
    assert _channel_names(bytes(tags[34377])) == ["Transparency", "W1", "W2"]
    # No Photoshop document data block. It makes Photopea list the channels, but
    # it announces a layered document and Photoshop then refuses the file — see
    # the note beside the channel-info builder before adding it back.
    assert 37724 not in tags

    alpha, w1, w2 = arr[..., 3], arr[..., 4], arr[..., 5]
    # Spot channels store ink inverted: 0 is full ink, so white goes under the art.
    assert np.array_equal(w1, 255 - alpha)
    assert np.array_equal(w2, w1)
    # Associated alpha means the colour is premultiplied down.
    assert not arr[..., :3][alpha == 0].any()


def test_three_white_passes_emit_three_w1_plates(client, admin_headers, operator_headers):
    import numpy as np

    _page_format(
        client, admin_headers, "WHITE_THREE",
        colorspace="RGB", preserve_alpha=True, white_passes=3,
    )
    order, body = _render(client, admin_headers, operator_headers, "ORD-W3", "WHITE_THREE")
    path = _job_artifact_path(client, admin_headers, order["id"], body["job"]["id"])
    arr, tags = _read_spot_tiff(path)

    # W1, W2, W1, W1 is four plates, so RGB + alpha + 4 = 8 samples.
    assert tags[277] == 8
    assert tuple(int(e) for e in tags[338]) == (1, 0, 0, 0, 0)
    names = _channel_names(bytes(tags[34377]))
    assert names == ["Transparency", "W1", "W2", "W1", "W1"]
    assert names.count("W1") == 3

    alpha = arr[..., 3]
    for i in range(4, 8):
        assert np.array_equal(arr[..., i], 255 - alpha)


def test_channel_names_are_not_truncated(client, admin_headers, operator_headers):
    """Photoshop counts its own null terminator in a unicode string's length.
    Declaring the bare character count makes readers eat the last letter, and the
    channels arrive as 'Transparenc' and 'W' — which the press cannot use."""
    _page_format(
        client, admin_headers, "WHITE_NAMES",
        colorspace="RGB", preserve_alpha=True, white_passes=1,
    )
    order, body = _render(client, admin_headers, operator_headers, "ORD-WN", "WHITE_NAMES")
    path = _job_artifact_path(client, admin_headers, order["id"], body["job"]["id"])
    _, tags = _read_spot_tiff(path)
    for name in _channel_names(bytes(tags[34377])):
        assert name in ("Transparency", "W1", "W2"), f"truncated channel name: {name!r}"


def test_cmyk_gives_way_to_the_white_plates(client, admin_headers, operator_headers):
    """Spot plates are derived from the alpha and sit alongside RGB — a CMYK
    conversion destroys both, so RGB has to win."""
    _page_format(
        client, admin_headers, "WHITE_CMYK",
        colorspace="CMYK", preserve_alpha=True, white_passes=1,
    )
    order, body = _render(client, admin_headers, operator_headers, "ORD-WC", "WHITE_CMYK")
    path = _job_artifact_path(client, admin_headers, order["id"], body["job"]["id"])
    _, tags = _read_spot_tiff(path)
    assert tags[262] == 2  # RGB, not separated
    assert tags[277] == 6


# ---------------- font size is a ceiling, not a setting ----------------
#
# `font_size` is a starting point the renderer shrinks from until the text fits
# the box, so a short box silently caps the type. An admin set 400 on a 79px box,
# saw no change, and reasonably concluded the field was broken. These cover the
# two things that make it legible: a probe the editor can ask, and a record of
# what the type actually came out at.


def test_font_size_is_capped_by_the_box_height(client, operator_headers):
    """Raising font_size above the box's ceiling must change nothing — that is
    the behaviour, and the reason the editor has to surface it."""
    box = {"x": 0, "y": 0, "w": 616, "h": 79}
    sizes = {}
    for asked in (112, 200, 400, 1000):
        res = client.post(
            "/print-formats/fit-text",
            headers=operator_headers,
            json={"text_box": box, "font_size": asked, "text": "Anjali"},
        )
        assert res.status_code == 200, res.text
        sizes[asked] = res.json()

    used = {asked: body["font_size_used"] for asked, body in sizes.items()}
    assert len(set(used.values())) == 1, f"box should cap them all equally, got {used}"
    assert all(body["capped"] for body in sizes.values())
    # And the ceiling is set by the box, not by the request.
    assert used[400] < 400


def test_a_taller_box_raises_the_ceiling(client, operator_headers):
    """The box is the lever, so growing it has to actually move the size."""
    previous = 0
    for h in (79, 120, 160, 220):
        body = client.post(
            "/print-formats/fit-text",
            headers=operator_headers,
            json={
                "text_box": {"x": 0, "y": 0, "w": 900, "h": h},
                "font_size": 400,
                "text": "Anjali",
            },
        ).json()
        assert body["font_size_used"] > previous, f"h={h} did not grow the type"
        previous = body["font_size_used"]


def test_fit_text_reports_when_nothing_is_capping(client, operator_headers):
    body = client.post(
        "/print-formats/fit-text",
        headers=operator_headers,
        json={
            "text_box": {"x": 0, "y": 0, "w": 2000, "h": 400},
            "font_size": 48,
            "text": "Anjali",
        },
    ).json()
    assert body["font_size_used"] == 48
    assert body["capped"] is False
    assert body["lines"] == 1


def test_fit_text_reports_wrapping(client, operator_headers):
    """Width binds before height on a long name — the editor needs to say so,
    because two lines halves the size for a reason that is not obvious."""
    body = client.post(
        "/print-formats/fit-text",
        headers=operator_headers,
        json={
            "text_box": {"x": 0, "y": 0, "w": 300, "h": 400},
            "font_size": 200,
            "text": "Priya and Arjun forever",
        },
    ).json()
    assert body["lines"] > 1
    assert body["font_size_used"] < 200


def test_the_job_records_the_size_the_type_came_out_at(
    client, admin_headers, operator_headers
):
    """The only place that records what actually went on the object."""
    fmt = _page_format(client, admin_headers, "FS_RECORD", font_size=400)
    order, body = _render(client, admin_headers, operator_headers, "ORD-FS1", "FS_RECORD")

    used = body["job"]["font_size_used"]
    assert used is not None
    assert used < 400, "a 100px-tall box cannot fit 400pt type"

    # And it survives on the job history, not just the print response.
    jobs = client.get(f"/orders/{order['id']}/jobs", headers=admin_headers).json()
    assert jobs[0]["font_size_used"] == used

    # The probe and the renderer must agree, or the editor lies to the admin.
    probe = client.post(
        "/print-formats/fit-text",
        headers=operator_headers,
        json={
            "text_box": fmt["text_box"],
            "font_size": 400,
            "font_path": fmt["font_path"],
            "text": "Print me",
        },
    ).json()
    assert probe["font_size_used"] == used


def test_fit_text_reports_points_and_the_box_a_size_needs(client, operator_headers):
    """A pixel cap means nothing to a designer. At 508 dpi a 79px-tall box caps
    the type at 9.6pt, and the number that lets an admin act is the box a
    requested point size actually needs."""
    px_per_pt = 508 / 72
    want_pt = 24
    body = client.post(
        "/print-formats/fit-text",
        headers=operator_headers,
        json={
            "text_box": {"x": 817, "y": 1228, "w": 616, "h": 79},
            "font_size": round(want_pt * px_per_pt),
            "font_path": "You2013 Regular.ttf",
            "text": "Janhavi",
            "dpi": 508,
        },
    ).json()

    assert body["requested_pt"] == 24.0
    assert body["capped"] is True
    # The 79px box is under 10pt — the whole reason "68" reads as meaningless.
    assert body["font_size_used_pt"] < 10
    # And the box it would take is reported, height being the real blocker here.
    assert body["min_box_height"] > 79
    assert body["min_box_width"] <= 616


def test_growing_the_box_to_the_reported_size_reaches_the_request(client, operator_headers):
    """The advice has to actually work: adopt min_box_* and the request is met."""
    px_per_pt = 508 / 72
    ask = {
        "font_size": round(24 * px_per_pt),
        "font_path": "You2013 Regular.ttf",
        "text": "Janhavi",
        "dpi": 508,
    }
    first = client.post(
        "/print-formats/fit-text",
        headers=operator_headers,
        json={"text_box": {"x": 0, "y": 0, "w": 616, "h": 79}, **ask},
    ).json()

    grown = client.post(
        "/print-formats/fit-text",
        headers=operator_headers,
        json={
            "text_box": {
                "x": 0,
                "y": 0,
                "w": max(616, first["min_box_width"]),
                "h": first["min_box_height"],
            },
            **ask,
        },
    ).json()
    assert grown["capped"] is False
    assert grown["font_size_used_pt"] >= 24.0
