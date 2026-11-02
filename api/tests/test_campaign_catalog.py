"""Designs a campaign admin adds, beyond the nine built into the site.

An added design has a name, a category and a sticker image. Once shown, it is listed for
users, its sticker is served to them, it can be entered, and its PSD is set up and its
winners' TIFFs made exactly like a built-in design's. Hidden designs disappear for users
but stay for the admin.
"""

from __future__ import annotations

import io
from datetime import UTC, datetime, timedelta

import pytest
from PIL import Image


def png(size=(400, 300), mode="RGBA", fmt="PNG") -> bytes:
    out = io.BytesIO()
    Image.new(mode, size, (200, 30, 40, 255) if mode == "RGBA" else (200, 30, 40)).save(out, fmt)
    return out.getvalue()


@pytest.fixture
def clean_catalog(app_modules, seeded):
    from app.db import SessionLocal
    from app.models import (
        CampaignCatalogDesign,
        CampaignDesign,
        CampaignDraw,
        CampaignEntry,
        CampaignHiddenDesign,
        CampaignWinner,
    )

    def wipe():
        db = SessionLocal()
        db.query(CampaignHiddenDesign).delete()
        db.query(CampaignWinner).delete()
        db.query(CampaignDraw).delete()
        db.query(CampaignEntry).filter(CampaignEntry.design_id.like("SUMMER%")).delete(synchronize_session=False)
        db.query(CampaignDesign).delete()
        db.query(CampaignCatalogDesign).delete()
        db.commit()
        db.close()

    wipe()
    yield
    wipe()


def add(client, headers, name="Summer splash", category="Travel", image=None, filename="summer.png"):
    return client.post(
        "/campaign-admin/catalog",
        data={"name": name, "category": category},
        files={"file": (filename, image if image is not None else png(), "image/png")},
        headers=headers,
    )


# ---------------- the admin adds a design ----------------


def test_an_admin_adds_a_design_with_a_name_category_and_sticker(client, ca_headers, clean_catalog):
    res = add(client, ca_headers)

    assert res.status_code == 201, res.text
    body = res.json()
    assert body["design_id"] == "SUMMER_SPLASH"
    assert (body["name"], body["category"], body["active"]) == ("Summer splash", "Travel", True)
    assert body["version"] >= 1


def test_the_id_never_clashes_with_a_built_in_or_another_added_design(client, ca_headers, clean_catalog):
    assert add(client, ca_headers, name="Disco ball").json()["design_id"] == "DISCO_BALL_2"
    assert add(client, ca_headers, name="Summer splash").json()["design_id"] == "SUMMER_SPLASH"
    assert add(client, ca_headers, name="Summer splash!").json()["design_id"] == "SUMMER_SPLASH_2"


@pytest.mark.parametrize(
    "field,value,status",
    [("name", "", 422), ("name", "x" * 41, 422), ("category", "Spooky", 422)],
)
def test_a_design_needs_a_short_name_and_a_known_category(client, ca_headers, clean_catalog, field, value, status):
    kwargs = {"name": "Summer splash", "category": "Travel", field: value}
    assert add(client, ca_headers, **kwargs).status_code == status


@pytest.mark.parametrize(
    "image,filename",
    [(b"not an image", "x.png"), (b"<svg onload=alert(1)></svg>", "x.svg"), (b"GIF89a" + b"0" * 10, "x.gif")],
)
def test_only_real_png_webp_or_jpeg_stickers_are_accepted(client, ca_headers, clean_catalog, image, filename):
    res = add(client, ca_headers, image=image, filename=filename)
    assert res.status_code == 422
    assert "PNG, WebP or JPEG" in res.json()["detail"]


def test_a_sticker_over_5_mb_is_refused(client, ca_headers, clean_catalog):
    res = add(client, ca_headers, image=b"\x89PNG" + b"0" * (5 * 1024 * 1024 + 1))
    assert res.status_code == 413


def test_a_sticker_is_re_saved_as_a_clean_png_no_bigger_than_1024px(client, ca_headers, clean_catalog):
    from app.config import settings

    design = add(client, ca_headers, image=png((3000, 1500), mode="RGB", fmt="JPEG"), filename="big.jpg").json()
    with Image.open(settings.campaign_sticker_dir / f"{design['design_id']}.png") as saved:
        assert saved.format == "PNG"
        assert max(saved.size) == 1024
        assert saved.mode == "RGBA"


def test_adding_designs_is_for_campaign_admins_only(client, admin_headers, clean_catalog):
    assert add(client, None).status_code == 401
    assert add(client, admin_headers).status_code == 401


# ---------------- users see it ----------------


def test_users_get_shown_designs_and_their_stickers(client, ca_headers, clean_catalog):
    design = add(client, ca_headers).json()

    listed = client.get("/campaign/designs").json()
    assert listed == {
        "added": [{"design_id": "SUMMER_SPLASH", "name": "Summer splash", "category": "Travel", "version": design["version"]}],
        "hidden": [],
    }
    sticker = client.get("/campaign/designs/SUMMER_SPLASH/sticker")
    assert sticker.status_code == 200
    assert sticker.headers["content-type"] == "image/png"
    assert "max-age" in sticker.headers["cache-control"]


def test_a_hidden_design_disappears_for_users_but_stays_for_the_admin(client, ca_headers, clean_catalog):
    add(client, ca_headers)
    res = client.patch("/campaign-admin/catalog/SUMMER_SPLASH", json={"active": False}, headers=ca_headers)
    assert res.status_code == 200 and res.json()["active"] is False

    assert client.get("/campaign/designs").json()["added"] == []
    assert client.get("/campaign/designs/SUMMER_SPLASH/sticker").status_code == 404
    admin_list = client.get("/campaign-admin/designs", headers=ca_headers).json()
    summer = next(d for d in admin_list if d["design_id"] == "SUMMER_SPLASH")
    assert summer["builtin"] is False and summer["active"] is False
    assert client.get("/campaign-admin/catalog/SUMMER_SPLASH/sticker", headers=ca_headers).status_code == 200


def test_the_admin_renames_recategorises_and_replaces_the_sticker(client, ca_headers, clean_catalog):
    first = add(client, ca_headers).json()
    renamed = client.patch(
        "/campaign-admin/catalog/SUMMER_SPLASH", json={"name": "Summer waves", "category": "Fun"}, headers=ca_headers
    ).json()
    assert (renamed["design_id"], renamed["name"], renamed["category"]) == ("SUMMER_SPLASH", "Summer waves", "Fun")

    replaced = client.post(
        "/campaign-admin/catalog/SUMMER_SPLASH/sticker", files={"file": ("n.png", png((200, 200)), "image/png")}, headers=ca_headers
    ).json()
    # A new version, so browsers fetch the new sticker instead of a cached old one.
    assert replaced["version"] > first["version"]


def test_built_in_designs_cannot_be_edited_in_the_catalog(client, ca_headers, clean_catalog):
    assert client.patch("/campaign-admin/catalog/DISCO_BALL", json={"active": False}, headers=ca_headers).status_code == 404


def test_the_admin_list_shows_built_in_and_added_designs(client, ca_headers, clean_catalog):
    add(client, ca_headers)
    designs = {d["design_id"]: d for d in client.get("/campaign-admin/designs", headers=ca_headers).json()}
    assert designs["DISCO_BALL"]["builtin"] is True
    assert designs["SUMMER_SPLASH"] | {"version": 0} == {
        "design_id": "SUMMER_SPLASH",
        "name": "Summer splash",
        "category": "Travel",
        "builtin": False,
        "active": True,
        "version": 0,
        "format": None,
    }


# ---------------- it works like a built-in design ----------------


@pytest.fixture
def clock(monkeypatch):
    from app.services import campaign

    class Clock:
        now = datetime(2026, 10, 30, 12, tzinfo=UTC) - timedelta(hours=5, minutes=30)

    monkeypatch.setattr(campaign, "now", lambda: Clock.now)
    return Clock


def test_users_can_enter_with_a_shown_design_but_not_a_hidden_one(client, ca_headers, participant_headers, clean_catalog, clock):
    add(client, ca_headers)
    entry = {"design_id": "SUMMER_SPLASH", "text": "Aanya", "idempotency_key": "summer-1"}
    assert client.post("/campaign/entries", json=entry, headers=participant_headers).status_code == 201

    client.patch("/campaign-admin/catalog/SUMMER_SPLASH", json={"active": False}, headers=ca_headers)
    res = client.post("/campaign/entries", json={**entry, "idempotency_key": "summer-2"}, headers=participant_headers)
    assert res.status_code == 422


def test_an_added_designs_psd_is_set_up_like_a_built_in_one(client, ca_headers, clean_catalog, tmp_path):
    from app.services.psd_writer import write_psd

    add(client, ca_headers)
    write_psd(Image.new("RGB", (932, 2304), (200, 200, 200)), tmp_path / "s.psd", 300)
    res = client.post(
        "/campaign-admin/designs/SUMMER_SPLASH/psd",
        files={"file": ("s.psd", (tmp_path / "s.psd").read_bytes(), "image/vnd.adobe.photoshop")},
        headers=ca_headers,
    )
    assert res.status_code == 200, res.text
    assert res.json()["format"]["psd_path"] == "campaign-SUMMER_SPLASH.psd"


# ---------------- removing designs, built-in ones included ----------------


def test_the_admin_hides_a_built_in_design_from_users_and_brings_it_back(
    client, ca_headers, participant_headers, clean_catalog, clock
):
    res = client.patch("/campaign-admin/designs/DISCO_BALL/visibility", json={"active": False}, headers=ca_headers)
    assert res.status_code == 200 and res.json()["active"] is False

    assert client.get("/campaign/designs").json()["hidden"] == ["DISCO_BALL"]
    entry = {"design_id": "DISCO_BALL", "text": "Aanya", "idempotency_key": "hidden-1"}
    assert client.post("/campaign/entries", json=entry, headers=participant_headers).status_code == 422
    disco = next(d for d in client.get("/campaign-admin/designs", headers=ca_headers).json() if d["design_id"] == "DISCO_BALL")
    assert disco["active"] is False

    client.patch("/campaign-admin/designs/DISCO_BALL/visibility", json={"active": True}, headers=ca_headers)
    assert client.get("/campaign/designs").json()["hidden"] == []
    assert client.post("/campaign/entries", json={**entry, "idempotency_key": "hidden-2"}, headers=participant_headers).status_code == 201


def test_hiding_works_for_added_designs_too(client, ca_headers, clean_catalog):
    add(client, ca_headers)
    client.patch("/campaign-admin/designs/SUMMER_SPLASH/visibility", json={"active": False}, headers=ca_headers)
    assert client.get("/campaign/designs").json() == {"added": [], "hidden": []}


def test_an_added_design_nobody_entered_with_can_be_deleted(client, ca_headers, clean_catalog):
    from app.config import settings

    add(client, ca_headers)
    assert client.delete("/campaign-admin/catalog/SUMMER_SPLASH", headers=ca_headers).status_code == 204

    assert not (settings.campaign_sticker_dir / "SUMMER_SPLASH.png").exists()
    assert all(d["design_id"] != "SUMMER_SPLASH" for d in client.get("/campaign-admin/designs", headers=ca_headers).json())
    # Its id is free again.
    assert add(client, ca_headers).json()["design_id"] == "SUMMER_SPLASH"


def test_a_design_with_entries_is_hidden_not_deleted_so_winners_keep_it(
    client, ca_headers, participant_headers, clean_catalog, clock
):
    add(client, ca_headers)
    client.post(
        "/campaign/entries",
        json={"design_id": "SUMMER_SPLASH", "text": "Aanya", "idempotency_key": "kept-1"},
        headers=participant_headers,
    )
    res = client.delete("/campaign-admin/catalog/SUMMER_SPLASH", headers=ca_headers)
    assert res.status_code == 409
    assert "Hide it instead" in res.json()["detail"]


def test_built_in_designs_cannot_be_deleted_only_hidden(client, ca_headers, clean_catalog):
    assert client.delete("/campaign-admin/catalog/DISCO_BALL", headers=ca_headers).status_code == 404


def test_hiding_and_deleting_are_for_campaign_admins_only(client, admin_headers, clean_catalog):
    assert client.patch("/campaign-admin/designs/DISCO_BALL/visibility", json={"active": False}, headers=admin_headers).status_code == 401
    assert client.delete("/campaign-admin/catalog/DISCO_BALL", headers=admin_headers).status_code == 401
