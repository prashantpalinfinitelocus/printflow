"""The campaign admin's own login and its design (PSD) setup.

Campaign admins are a separate set of accounts from PrintFlow's staff: their
tokens open only /campaign-admin, and staff or consumer tokens open none of it.
"""

from __future__ import annotations

import pytest
from PIL import Image

from tests.conftest import CAMPAIGN_ADMIN


# ---------------- login ----------------


def test_a_campaign_admin_logs_in_with_user_id_and_password(client, campaign_admin):
    res = client.post("/campaign-admin/auth/login", json=campaign_admin)

    assert res.status_code == 200
    body = res.json()
    assert body["admin"] == {"username": CAMPAIGN_ADMIN[0]}
    assert body["token"] and body["expires_in"] > 0
    me = client.get("/campaign-admin/auth/me", headers={"Authorization": f"Bearer {body['token']}"})
    assert me.json() == {"username": CAMPAIGN_ADMIN[0]}


def test_the_user_id_is_not_case_sensitive(client, campaign_admin):
    res = client.post("/campaign-admin/auth/login", json={**campaign_admin, "username": CAMPAIGN_ADMIN[0].upper()})
    assert res.status_code == 200


@pytest.mark.parametrize(
    "credentials",
    [
        {"username": CAMPAIGN_ADMIN[0], "password": "wrong"},
        {"username": "nobody", "password": CAMPAIGN_ADMIN[1]},
    ],
)
def test_a_wrong_user_id_or_password_gets_one_message(client, campaign_admin, credentials):
    res = client.post("/campaign-admin/auth/login", json=credentials)
    assert res.status_code == 401
    assert res.json()["detail"] == "Wrong user ID or password"


def test_a_printflow_account_cannot_log_in_here(client, campaign_admin):
    res = client.post("/campaign-admin/auth/login", json={"username": "admin@test.local", "password": "adminpw"})
    assert res.status_code == 401


def test_a_deactivated_admin_cannot_log_in_or_keep_using_a_token(client, campaign_admin, ca_headers):
    from app.db import SessionLocal
    from app.models import CampaignAdmin

    db = SessionLocal()
    db.query(CampaignAdmin).filter_by(username=CAMPAIGN_ADMIN[0]).update({"is_active": False})
    db.commit()
    db.close()

    assert client.post("/campaign-admin/auth/login", json=campaign_admin).status_code == 401
    assert client.get("/campaign-admin/auth/me", headers=ca_headers).status_code == 401


def test_logging_out_revokes_the_token(client, ca_headers):
    assert client.post("/campaign-admin/auth/logout", headers=ca_headers).status_code == 204
    assert client.get("/campaign-admin/auth/me", headers=ca_headers).status_code == 401


def test_a_campaign_admin_token_opens_nothing_in_printflow(client, ca_headers):
    assert client.get("/auth/me", headers=ca_headers).status_code == 401
    assert client.get("/print-formats", headers=ca_headers).status_code == 401
    assert client.get("/orders", headers=ca_headers).status_code == 401


def test_a_campaign_admin_token_is_not_a_consumer_session(client, ca_headers):
    res = client.post("/campaign/entries", json={"design_id": "DISCO_BALL", "text": "Hi", "idempotency_key": "k"}, headers=ca_headers)
    assert res.status_code == 401


# ---------------- designs ----------------


@pytest.fixture
def clean_designs(app_modules, seeded):
    """No campaign design is set up, before and after."""
    from app.db import SessionLocal
    from app.models import CampaignDesign

    def wipe():
        db = SessionLocal()
        db.query(CampaignDesign).delete()
        db.commit()
        db.close()

    wipe()
    yield
    wipe()


def _psd_bytes(tmp_path, size=(932, 2304)) -> bytes:
    from app.services.psd_writer import write_psd

    path = tmp_path / "art.psd"
    write_psd(Image.new("RGB", size, (200, 200, 200)), path, 300)
    return path.read_bytes()


def test_designs_lists_the_nine_with_their_setup(client, ca_headers, clean_designs):
    body = client.get("/campaign-admin/designs", headers=ca_headers).json()

    assert len(body) == 9
    assert {d["design_id"] for d in body} >= {"DISCO_BALL", "BEACH_VIBES"}
    assert all(d["format"] is None for d in body)


def test_uploading_a_psd_sets_the_design_up_on_the_cans_name_line(client, ca_headers, clean_designs, tmp_path):
    res = client.post(
        "/campaign-admin/designs/BEACH_VIBES/psd",
        files={"file": ("beach vibes.psd", _psd_bytes(tmp_path), "image/vnd.adobe.photoshop")},
        headers=ca_headers,
    )

    assert res.status_code == 200, res.text
    fmt = res.json()["format"]
    assert fmt["width_px"] == 932 and fmt["height_px"] == 2304 and fmt["dpi"] == 300
    # The can's name line, in Diet Coke red, with no placeholder erased.
    assert fmt["text_box"] == {"x": 140, "y": 1081, "w": 652, "h": 86}
    assert fmt["font_size"] == 54
    assert fmt["font_color"] == "#F40009"
    assert fmt["placeholder_color"] is None
    # Each design keeps its own file, whatever the upload was called.
    assert fmt["psd_path"] == "campaign-BEACH_VIBES.psd"


def test_designs_are_the_campaigns_own_and_never_show_in_printflow(client, ca_headers, admin_headers, clean_designs, tmp_path):
    from app.db import SessionLocal
    from app.models import CampaignDesign, PrintFormat

    before = client.get("/print-formats", headers=admin_headers).json()
    client.post(
        "/campaign-admin/designs/BEACH_VIBES/psd",
        files={"file": ("b.psd", _psd_bytes(tmp_path), "image/vnd.adobe.photoshop")},
        headers=ca_headers,
    )

    assert client.get("/print-formats", headers=admin_headers).json() == before
    db = SessionLocal()
    assert db.query(PrintFormat).filter_by(code="BEACH_VIBES").count() == 0
    assert db.get(CampaignDesign, "BEACH_VIBES").width_px == 932
    db.close()


def test_replacing_a_psd_keeps_the_text_settings(client, ca_headers, clean_designs, tmp_path):
    upload = lambda: client.post(  # noqa: E731
        "/campaign-admin/designs/BEACH_VIBES/psd",
        files={"file": ("b.psd", _psd_bytes(tmp_path), "image/vnd.adobe.photoshop")},
        headers=ca_headers,
    )
    upload()
    client.patch("/campaign-admin/designs/BEACH_VIBES", json={"font_size": 70}, headers=ca_headers)

    fmt = upload().json()["format"]
    assert fmt["font_size"] == 70


def test_text_settings_can_be_edited(client, ca_headers, clean_designs, tmp_path):
    client.post(
        "/campaign-admin/designs/DISCO_BALL/psd",
        files={"file": ("d.psd", _psd_bytes(tmp_path), "image/vnd.adobe.photoshop")},
        headers=ca_headers,
    )
    res = client.patch(
        "/campaign-admin/designs/DISCO_BALL",
        json={
            "text_box": {"x": 10, "y": 20, "w": 300, "h": 60},
            "font_path": "TCCC-UnityText-Bold.ttf",
            "font_size": 40,
            "font_color": "#000000",
            "placeholder_color": "#ED1C24",
        },
        headers=ca_headers,
    )
    assert res.status_code == 200, res.text
    fmt = res.json()["format"]
    assert fmt["text_box"] == {"x": 10, "y": 20, "w": 300, "h": 60}
    assert (fmt["font_path"], fmt["font_size"], fmt["font_color"], fmt["placeholder_color"]) == (
        "TCCC-UnityText-Bold.ttf",
        40,
        "#000000",
        "#ED1C24",
    )


def test_editing_a_design_with_no_psd_is_not_found(client, ca_headers, clean_designs):
    assert client.patch("/campaign-admin/designs/DISCO_BALL", json={"font_size": 40}, headers=ca_headers).status_code == 404


def test_only_the_nine_campaign_designs_can_be_set_up(client, ca_headers, tmp_path):
    res = client.post(
        "/campaign-admin/designs/TEST_FMT/psd",
        files={"file": ("x.psd", _psd_bytes(tmp_path), "image/vnd.adobe.photoshop")},
        headers=ca_headers,
    )
    assert res.status_code == 404


def test_a_file_that_is_not_a_psd_is_refused(client, ca_headers, clean_designs):
    res = client.post(
        "/campaign-admin/designs/DISCO_BALL/psd",
        files={"file": ("x.psd", b"not a psd", "image/vnd.adobe.photoshop")},
        headers=ca_headers,
    )
    assert res.status_code == 422
    assert client.get("/campaign-admin/designs", headers=ca_headers).json()[0]["format"] is None


def test_fonts_are_listed_for_the_text_settings(client, ca_headers):
    assert isinstance(client.get("/campaign-admin/fonts", headers=ca_headers).json(), list)


def test_design_endpoints_need_a_campaign_admin_login(client, admin_headers):
    for method, url in [
        ("get", "/campaign-admin/designs"),
        ("get", "/campaign-admin/fonts"),
        ("patch", "/campaign-admin/designs/DISCO_BALL"),
        ("post", "/campaign-admin/designs/DISCO_BALL/psd"),
        ("post", "/campaign-admin/designs/DISCO_BALL/find-placeholder"),
    ]:
        assert getattr(client, method)(url, headers=admin_headers).status_code == 401, url


# ---------------- account script ----------------


def test_the_script_creates_an_admin_and_resets_a_password(app_modules, seeded, monkeypatch, capsys):
    from app.db import SessionLocal
    from app.models import CampaignAdmin
    from app.security import verify_password
    from scripts.create_campaign_admin import main

    monkeypatch.setattr("getpass.getpass", lambda prompt="": "first-password-1")
    assert main(["Night-Ops"]) == 0
    monkeypatch.setattr("getpass.getpass", lambda prompt="": "second-password-2")
    assert main(["night-ops"]) == 0

    db = SessionLocal()
    admins = db.query(CampaignAdmin).filter_by(username="night-ops").all()
    assert len(admins) == 1
    assert verify_password("second-password-2", admins[0].password_hash)
    db.close()


def test_the_script_refuses_a_short_password(app_modules, seeded, monkeypatch, capsys):
    from scripts.create_campaign_admin import main

    monkeypatch.setattr("getpass.getpass", lambda prompt="": "short")
    assert main(["someone"]) == 1
    assert "at least 10 characters" in capsys.readouterr().err


# ---------------- review fixes ----------------


def test_campaign_psds_live_in_the_campaigns_own_folder(client, ca_headers, clean_designs, tmp_path):
    from app.config import settings

    client.post(
        "/campaign-admin/designs/BEACH_VIBES/psd",
        files={"file": ("b.psd", _psd_bytes(tmp_path), "image/vnd.adobe.photoshop")},
        headers=ca_headers,
    )

    assert (settings.campaign_psd_dir / "campaign-BEACH_VIBES.psd").is_file()
    assert not (settings.psd_dir / "campaign-BEACH_VIBES.psd").exists()
    assert settings.campaign_psd_dir != settings.psd_dir


def test_a_printflow_upload_with_the_same_name_cannot_touch_campaign_art(client, ca_headers, admin_headers, clean_designs, tmp_path):
    from app.config import settings

    client.post(
        "/campaign-admin/designs/BEACH_VIBES/psd",
        files={"file": ("b.psd", _psd_bytes(tmp_path), "image/vnd.adobe.photoshop")},
        headers=ca_headers,
    )
    campaign_art = (settings.campaign_psd_dir / "campaign-BEACH_VIBES.psd").read_bytes()

    res = client.post(
        "/print-formats/upload-psd",
        files={"file": ("campaign-BEACH_VIBES.psd", _psd_bytes(tmp_path, size=(100, 100)), "image/vnd.adobe.photoshop")},
        headers=admin_headers,
    )

    assert res.status_code == 201
    assert (settings.campaign_psd_dir / "campaign-BEACH_VIBES.psd").read_bytes() == campaign_art
    (settings.psd_dir / "campaign-BEACH_VIBES.psd").unlink()


@pytest.fixture
def lockable_admin(app_modules, seeded, monkeypatch):
    """A campaign admin with a clean failure count, and a pinned campaign clock."""
    from datetime import UTC, datetime

    from app.db import SessionLocal
    from app.models import CampaignAdmin
    from app.security import hash_password
    from app.services import campaign

    class Clock:
        now = datetime(2026, 10, 30, 12, tzinfo=UTC)

    monkeypatch.setattr(campaign, "now", lambda: Clock.now)
    db = SessionLocal()
    admin = db.query(CampaignAdmin).filter_by(username="lock-me").one_or_none() or CampaignAdmin(username="lock-me")
    admin.password_hash, admin.is_active, admin.failed_logins, admin.locked_until = hash_password("right-password-1"), True, 0, None
    db.add(admin)
    db.commit()
    db.close()
    return Clock


def _try(client, password):
    return client.post("/campaign-admin/auth/login", json={"username": "lock-me", "password": password})


def test_repeated_wrong_passwords_lock_the_account_for_a_while(client, lockable_admin):
    from datetime import timedelta

    for _ in range(5):
        assert _try(client, "wrong").status_code == 401
    res = _try(client, "right-password-1")
    assert res.status_code == 429
    assert "Too many wrong attempts" in res.json()["detail"]

    lockable_admin.now += timedelta(minutes=15)
    assert _try(client, "right-password-1").status_code == 200


def test_a_successful_sign_in_resets_the_count(client, lockable_admin):
    for _ in range(4):
        _try(client, "wrong")
    assert _try(client, "right-password-1").status_code == 200
    for _ in range(4):
        _try(client, "wrong")
    assert _try(client, "right-password-1").status_code == 200


@pytest.mark.parametrize(
    "body",
    [{"font_size": None}, {"font_color": None}, {"font_size": 0}, {"text_box": {"x": 0, "y": 0, "w": 0, "h": 40}}, {"text_box": {"x": -1, "y": 0, "w": 10, "h": 40}}],
)
def test_text_settings_refuse_empty_or_impossible_values(client, ca_headers, clean_designs, tmp_path, body):
    client.post(
        "/campaign-admin/designs/DISCO_BALL/psd",
        files={"file": ("d.psd", _psd_bytes(tmp_path), "image/vnd.adobe.photoshop")},
        headers=ca_headers,
    )
    assert client.patch("/campaign-admin/designs/DISCO_BALL", json=body, headers=ca_headers).status_code == 422


def test_the_script_asks_for_the_password_twice(app_modules, seeded, monkeypatch, capsys):
    from scripts.create_campaign_admin import main

    answers = iter(["first-password-1", "another-password-2"])
    monkeypatch.setattr("getpass.getpass", lambda prompt="": next(answers))
    assert main(["typo-ops"]) == 1
    assert "did not match" in capsys.readouterr().err


def test_the_script_refuses_a_user_id_too_long_to_store(app_modules, seeded, monkeypatch, capsys):
    from scripts.create_campaign_admin import main

    monkeypatch.setattr("getpass.getpass", lambda prompt="": "first-password-1")
    assert main(["x" * 65]) == 2
    assert "64 characters" in capsys.readouterr().err
