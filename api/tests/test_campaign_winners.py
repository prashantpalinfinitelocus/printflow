"""Daily lucky draw and the admin winners panel (PRD 11 and 15).

The draw is a service (`app.services.campaign_draw`) the admin page and a
scheduled job both call. These tests pin the campaign clock, put entries in
the database directly, and check the PRD rules: at most the daily maximum of
winners, one win per phone per day, five per phone per month, more entries
mean more chances, and running a day twice never changes its winners.
"""

from __future__ import annotations

import csv
import io
import random
from pathlib import Path
from datetime import UTC, date, datetime, timedelta

import pytest
from PIL import Image

DAY = date(2026, 10, 30)


def ist(day: date, hh: int, mm: int = 0) -> datetime:
    """hh:mm India time (UTC+05:30) on `day`."""
    return datetime(day.year, day.month, day.day, hh, mm, tzinfo=UTC) - timedelta(hours=5, minutes=30)


@pytest.fixture
def clock(monkeypatch):
    """Pins the campaign clock to the morning after DAY; set `clock.now` to move it."""
    from app.services import campaign

    class Clock:
        now = ist(DAY + timedelta(days=1), 9)

    monkeypatch.setattr(campaign, "now", lambda: Clock.now)
    return Clock


@pytest.fixture
def db(app_modules, seeded):
    """A session over a clean campaign: no participants, entries, draws or winners."""
    from app.db import SessionLocal
    from app.models import CampaignDesign, CampaignDraw, CampaignEntry, CampaignParticipant, CampaignWinner

    session = SessionLocal()
    for model in (CampaignWinner, CampaignDraw, CampaignEntry, CampaignParticipant, CampaignDesign):
        session.query(model).delete()
    session.commit()
    yield session
    session.rollback()
    for model in (CampaignWinner, CampaignDraw, CampaignEntry, CampaignParticipant, CampaignDesign):
        session.query(model).delete()
    session.commit()
    session.close()


def add_entries(db, phone: str, count: int = 1, *, day: date = DAY, design: str = "DISCO_BALL", text: str = "Aanya"):
    """`count` entries for `phone` on `day`; creates the participant on first use."""
    from app.models import CampaignEntry, CampaignParticipant

    person = db.query(CampaignParticipant).filter_by(phone=phone).one_or_none()
    if person is None:
        person = CampaignParticipant(phone=phone, email=f"{phone}@example.com")
        db.add(person)
        db.flush()
    for i in range(count):
        db.add(
            CampaignEntry(
                participant_id=person.id,
                idempotency_key=f"{day}-{phone}-{i}-{random.random()}",
                design_id=design,
                text=text,
                campaign_day=day,
                created_at=ist(day, 12, i % 60),
            )
        )
    db.commit()
    return person


def phones(n: int, start: int = 0) -> list[str]:
    return [f"9{start + i:09d}" for i in range(n)]


# ---------------- the draw: PRD 11 rules ----------------


def test_draw_picks_at_most_the_daily_maximum(db, clock, monkeypatch):
    from app.config import settings
    from app.services.campaign_draw import run_draw

    monkeypatch.setattr(settings, "campaign_daily_winners", 5)
    for phone in phones(12):
        add_entries(db, phone)

    draw = run_draw(db, DAY, rng=random.Random(1))

    assert draw.eligible_entries == 12
    assert draw.winner_count == 5
    assert [w.rank for w in draw.winners] == [1, 2, 3, 4, 5]


def test_a_phone_wins_at_most_once_a_day_however_many_entries(db, clock):
    from app.services.campaign_draw import run_draw

    add_entries(db, "9000000001", 40)
    add_entries(db, "9000000002", 1)

    draw = run_draw(db, DAY, rng=random.Random(7))

    winners = {w.participant.phone for w in draw.winners}
    assert winners == {"9000000001", "9000000002"}
    assert draw.winner_count == 2


def test_more_entries_mean_more_chances(db, clock, monkeypatch):
    """With one prize, a phone with 9 of 10 entries should win about 90% of draws."""
    from app.config import settings
    from app.services.campaign_draw import pick_winners

    monkeypatch.setattr(settings, "campaign_daily_winners", 1)
    heavy = add_entries(db, "9000000001", 9)
    add_entries(db, "9000000002", 1)
    from app.models import CampaignEntry

    entries = db.query(CampaignEntry).all()
    rng = random.Random(3)
    heavy_wins = sum(pick_winners(entries, set(), rng)[0].participant_id == heavy.id for _ in range(1000))
    assert 850 < heavy_wins < 950


def test_a_phone_with_five_wins_this_month_cannot_win_again(db, clock):
    from app.services.campaign_draw import run_draw

    earlier_days = [date(2026, 10, d) for d in (1, 2, 3, 4, 5)]
    for d in earlier_days:
        add_entries(db, "9000000001", day=d)
        clock.now = ist(d + timedelta(days=1), 9)
        assert run_draw(db, d, rng=random.Random(0)).winner_count == 1

    add_entries(db, "9000000001", 30)
    add_entries(db, "9000000002", 1)
    clock.now = ist(DAY + timedelta(days=1), 9)

    draw = run_draw(db, DAY, rng=random.Random(0))
    assert {w.participant.phone for w in draw.winners} == {"9000000002"}


def test_four_wins_this_month_still_allow_a_fifth(db, clock):
    from app.services.campaign_draw import run_draw

    for d in [date(2026, 10, n) for n in (1, 2, 3, 4)]:
        add_entries(db, "9000000001", day=d)
        clock.now = ist(d + timedelta(days=1), 9)
        run_draw(db, d, rng=random.Random(0))

    add_entries(db, "9000000001")
    clock.now = ist(DAY + timedelta(days=1), 9)
    assert run_draw(db, DAY, rng=random.Random(0)).winner_count == 1


def test_the_monthly_limit_counts_wins_on_later_days_drawn_first(db, clock):
    """A missed night drawn afterwards must still see the wins from the days after it."""
    from app.services.campaign_draw import run_draw

    clock.now = ist(date(2026, 11, 1), 9)
    for d in [date(2026, 10, n) for n in (1, 2, 3, 4, 31)]:
        add_entries(db, "9000000001", day=d)
        run_draw(db, d, rng=random.Random(0))

    add_entries(db, "9000000001")
    add_entries(db, "9000000002")
    draw = run_draw(db, DAY, rng=random.Random(0))
    assert {w.participant.phone for w in draw.winners} == {"9000000002"}


def test_a_draw_records_its_seed_so_it_can_be_replayed(db, clock):
    from app.services.campaign_draw import pick_winners, run_draw
    from app.models import CampaignEntry

    for phone in phones(20):
        add_entries(db, phone)
    draw = run_draw(db, DAY)
    assert draw.seed

    entries = db.query(CampaignEntry).order_by(CampaignEntry.created_at, CampaignEntry.id).all()
    replay = pick_winners(entries, set(), random.Random(draw.seed))
    assert [e.id for e in replay] == [w.entry_id for w in draw.winners]


def test_a_draw_that_loses_a_race_returns_the_winners_already_recorded(db, clock, monkeypatch):
    """Two runs of one day at once: the second's insert fails and it reports the first's result."""
    from app.models import CampaignDraw
    from app.services import campaign_draw

    for phone in phones(3):
        add_entries(db, phone)
    first = [w.entry_id for w in campaign_draw.run_draw(db, DAY, rng=random.Random(1)).winners]

    real_get = db.get
    calls = {"n": 0}

    def stale_get(model, key, *a, **kw):
        # The racing run checked before the first run committed, so it saw no draw.
        if model is CampaignDraw and calls["n"] == 0:
            calls["n"] += 1
            return None
        return real_get(model, key, *a, **kw)

    monkeypatch.setattr(db, "get", stale_get)
    again = campaign_draw.run_draw(db, DAY, rng=random.Random(99))
    assert [w.entry_id for w in again.winners] == first


def test_the_daily_maximum_is_filled_when_there_are_enough_phones(db, clock, monkeypatch):
    from app.config import settings
    from app.services.campaign_draw import run_draw

    monkeypatch.setattr(settings, "campaign_daily_winners", 30)
    for i, phone in enumerate(phones(40)):
        add_entries(db, phone, 1 + i % 4)
    draw = run_draw(db, DAY, rng=random.Random(5))
    assert draw.winner_count == 30
    assert len({w.participant_id for w in draw.winners}) == 30


def test_a_draw_records_the_phones_the_monthly_limit_kept_out(db, clock):
    """The seed alone cannot replay a draw if the limit's exclusions change later; the record keeps them."""
    from app.services.campaign_draw import run_draw

    for d in [date(2026, 10, n) for n in (1, 2, 3, 4, 5)]:
        add_entries(db, "9000000001", day=d)
        clock.now = ist(d + timedelta(days=1), 9)
        run_draw(db, d, rng=random.Random(0))
    capped = add_entries(db, "9000000001")
    add_entries(db, "9000000002")
    clock.now = ist(DAY + timedelta(days=1), 9)

    assert run_draw(db, DAY, rng=random.Random(0)).excluded_participants == [capped.id]


def test_last_months_wins_do_not_count_towards_this_month(db, clock):
    from app.services.campaign_draw import run_draw

    september = [date(2026, 9, d) for d in (25, 26, 27, 28, 29)]
    for d in september:
        add_entries(db, "9000000001", day=d)
        clock.now = ist(d + timedelta(days=1), 9)
        run_draw(db, d, rng=random.Random(0))

    add_entries(db, "9000000001", day=date(2026, 10, 1))
    clock.now = ist(date(2026, 10, 2), 9)
    assert run_draw(db, date(2026, 10, 1), rng=random.Random(0)).winner_count == 1


def test_running_a_day_again_keeps_its_winners(db, clock):
    from app.services.campaign_draw import run_draw

    for phone in phones(10):
        add_entries(db, phone)
    first = [w.entry_id for w in run_draw(db, DAY, rng=random.Random(1)).winners]
    again = [w.entry_id for w in run_draw(db, DAY, rng=random.Random(99)).winners]
    assert again == first


def test_a_day_cannot_be_drawn_until_its_entry_window_has_closed(db, clock):
    from app.services.campaign_draw import DrawNotReady, run_draw

    add_entries(db, "9000000001")
    clock.now = ist(DAY, 21, 59)
    with pytest.raises(DrawNotReady):
        run_draw(db, DAY)
    # A grace period after closing, so an entry sent at 9:59:59 PM has landed before the draw.
    clock.now = ist(DAY, 22, 9)
    with pytest.raises(DrawNotReady):
        run_draw(db, DAY)
    clock.now = ist(DAY, 22, 10)
    assert run_draw(db, DAY, rng=random.Random(0)).winner_count == 1


def test_a_day_with_no_entries_records_an_empty_draw(db, clock):
    from app.services.campaign_draw import run_draw

    draw = run_draw(db, DAY)
    assert draw.eligible_entries == 0
    assert draw.winner_count == 0


# ---------------- admin API ----------------


def test_winners_api_needs_a_campaign_admin_login(client, admin_headers, operator_headers, participant_headers, db, clock):
    """PrintFlow staff logins, admin or not, and consumer logins are all refused here."""
    csv_url = f"/campaign-admin/days/{DAY}/winners.csv?link_base=https://x.test"
    requests = [
        ("get", f"/campaign-admin/days/{DAY}"),
        ("post", f"/campaign-admin/days/{DAY}/draw"),
        ("post", "/campaign-admin/winners/1/tiff"),
        ("get", "/campaign-admin/winners/1/tiff"),
        ("get", csv_url),
    ]
    for method, url in requests:
        for headers in (None, admin_headers, operator_headers, participant_headers):
            assert getattr(client, method)(url, headers=headers).status_code == 401, (method, url, headers)


def test_a_day_before_its_draw_shows_entries_and_offers_the_draw(client, ca_headers, db, clock):
    add_entries(db, "9000000001", 3)
    add_entries(db, "9000000002", 2)

    body = client.get(f"/campaign-admin/days/{DAY}", headers=ca_headers).json()

    assert body == {
        "day": str(DAY),
        "entries": 5,
        "can_draw": True,
        "draw": None,
        "winners": [],
        "missing_formats": [],
    }


def test_today_cannot_be_drawn_while_entries_are_open(client, ca_headers, db, clock):
    clock.now = ist(DAY, 15)
    add_entries(db, "9000000001")

    assert client.get(f"/campaign-admin/days/{DAY}", headers=ca_headers).json()["can_draw"] is False
    res = client.post(f"/campaign-admin/days/{DAY}/draw", headers=ca_headers)
    assert res.status_code == 409
    assert "10 PM IST" in res.json()["detail"]


def test_running_the_draw_lists_the_winners_with_contact_details(client, ca_headers, db, clock):
    add_entries(db, "9000000001", design="BEACH_VIBES", text="Riya")

    body = client.post(f"/campaign-admin/days/{DAY}/draw", headers=ca_headers).json()

    assert body["can_draw"] is False
    assert body["draw"]["winner_count"] == 1
    assert body["draw"]["eligible_entries"] == 1
    (winner,) = body["winners"]
    assert winner["rank"] == 1
    assert winner["phone"] == "9000000001"
    assert winner["email"] == "9000000001@example.com"
    assert winner["design_id"] == "BEACH_VIBES"
    assert winner["text"] == "Riya"
    assert winner["tiff_ready"] is False
    assert winner["tiff_error"] is None
    # No PSD has been set up as the BEACH_VIBES print format yet.
    assert body["missing_formats"] == ["BEACH_VIBES"]


# ---------------- TIFFs ----------------


@pytest.fixture
def disco_ball_format(db):
    """DISCO_BALL's PSD set up under Designs, as a campaign admin would."""
    from app.config import settings
    from app.models import CampaignDesign
    from app.services.psd_writer import write_psd

    settings.campaign_psd_dir.mkdir(parents=True, exist_ok=True)
    write_psd(Image.new("RGB", (600, 400), (220, 20, 34)), settings.campaign_psd_dir / "campaign-DISCO_BALL.psd", 300)
    design = CampaignDesign(
        design_id="DISCO_BALL",
        psd_path="campaign-DISCO_BALL.psd",
        width_px=600,
        height_px=400,
        dpi=300,
        text_box={"x": 50, "y": 150, "w": 500, "h": 100},
        font_size=48,
        font_color="#FFFFFF",
        align="center",
    )
    db.add(design)
    db.commit()
    yield design
    db.delete(design)
    db.commit()


def _draw_one(client, ca_headers, db, **entry) -> dict:
    add_entries(db, "9000000001", **entry)
    return client.post(f"/campaign-admin/days/{DAY}/draw", headers=ca_headers).json()["winners"][0]


def test_generates_a_print_quality_tiff_from_the_designs_psd(client, ca_headers, db, clock, disco_ball_format):
    from app.models import CampaignWinner

    winner = _draw_one(client, ca_headers, db, text="Aanya")

    res = client.post(f"/campaign-admin/winners/{winner['id']}/tiff", headers=ca_headers)

    assert res.status_code == 200, res.text
    assert res.json()["tiff_ready"] is True
    path = db.get(CampaignWinner, winner["id"]).tiff_path
    with Image.open(path) as tiff:
        # The same output the store orders get: CMYK at the format's DPI, colour profile embedded.
        assert tiff.mode == "CMYK"
        assert round(tiff.info["dpi"][0]) == 300
        assert tiff.info.get("icc_profile")


def test_the_tiff_downloads_for_admins(client, ca_headers, operator_headers, db, clock, disco_ball_format):
    winner = _draw_one(client, ca_headers, db)
    client.post(f"/campaign-admin/winners/{winner['id']}/tiff", headers=ca_headers)

    res = client.get(f"/campaign-admin/winners/{winner['id']}/tiff", headers=ca_headers)
    assert res.status_code == 200
    assert res.headers["content-type"] == "image/tiff"
    assert "attachment" in res.headers["content-disposition"]
    assert ".tif" in res.headers["content-disposition"]
    assert client.get(f"/campaign-admin/winners/{winner['id']}/tiff", headers=operator_headers).status_code == 401


def test_text_is_printed_in_capitals_like_the_can_preview(client, ca_headers, db, clock, disco_ball_format, monkeypatch):
    from app.routers import campaign_admin

    seen = {}
    real = campaign_admin.render_order

    def spy(**kwargs):
        seen["text"] = kwargs["text"]
        return real(**kwargs)

    monkeypatch.setattr(campaign_admin, "render_order", spy)
    winner = _draw_one(client, ca_headers, db, text="Aanya")
    client.post(f"/campaign-admin/winners/{winner['id']}/tiff", headers=ca_headers)
    assert seen["text"] == "AANYA"


def test_a_design_without_a_print_format_explains_what_to_set_up(client, ca_headers, db, clock):
    winner = _draw_one(client, ca_headers, db, design="BEACH_VIBES")

    res = client.post(f"/campaign-admin/winners/{winner['id']}/tiff", headers=ca_headers)

    assert res.status_code == 422
    assert "BEACH_VIBES" in res.json()["detail"]
    assert "Designs" in res.json()["detail"]


def test_a_tiff_not_yet_generated_is_not_found(client, ca_headers, db, clock):
    winner = _draw_one(client, ca_headers, db)
    assert client.get(f"/campaign-admin/winners/{winner['id']}/tiff", headers=ca_headers).status_code == 404


# ---------------- the winners sheet ----------------


def test_the_sheet_lists_every_winner_with_a_link_to_their_tiff(client, ca_headers, db, clock, disco_ball_format):
    add_entries(db, "9000000001", text="Aanya")
    add_entries(db, "9000000002", design="BEACH_VIBES", text="Riya")
    winners = client.post(f"/campaign-admin/days/{DAY}/draw", headers=ca_headers).json()["winners"]
    disco = next(w for w in winners if w["design_id"] == "DISCO_BALL")
    client.post(f"/campaign-admin/winners/{disco['id']}/tiff", headers=ca_headers)

    # The campaign admin's own address for its API, which the web app passes.
    base = "https://diet-coke-test.coke2home.com/offline-store/api/campaign-admin"
    res = client.get(f"/campaign-admin/days/{DAY}/winners.csv", params={"link_base": base}, headers=ca_headers)

    assert res.status_code == 200
    assert res.headers["content-type"].startswith("text/csv")
    assert f"winners-{DAY}.csv" in res.headers["content-disposition"]
    rows = list(csv.DictReader(io.StringIO(res.text.lstrip("﻿"))))
    assert [r["Winner #"] for r in rows] == ["1", "2"]
    by_phone = {r["Phone"]: r for r in rows}
    assert by_phone["9000000001"]["Email"] == "9000000001@example.com"
    assert by_phone["9000000001"]["Design"] == "DISCO_BALL"
    assert by_phone["9000000001"]["Text"] == "Aanya"
    assert by_phone["9000000001"]["Draw day"] == str(DAY)
    assert by_phone["9000000001"]["TIFF status"] == "Ready"
    assert by_phone["9000000001"]["TIFF link"] == f"{base}/winners/{disco['id']}/tiff"
    assert by_phone["9000000002"]["TIFF status"] == "No PSD set up for BEACH_VIBES"
    assert by_phone["9000000002"]["TIFF link"] == ""


def test_the_sheet_refuses_a_link_base_that_is_not_a_web_address(client, ca_headers, db, clock):
    res = client.get(
        f"/campaign-admin/days/{DAY}/winners.csv", params={"link_base": "javascript:alert(1)"}, headers=ca_headers
    )
    assert res.status_code == 422


def test_a_text_starting_with_a_formula_sign_is_kept_as_text_in_the_sheet(client, ca_headers, db, clock):
    """Excel runs a cell starting with = + - @ as a formula; the sheet must not."""
    add_entries(db, "9000000001", text="=1+1")
    client.post(f"/campaign-admin/days/{DAY}/draw", headers=ca_headers)
    res = client.get(
        f"/campaign-admin/days/{DAY}/winners.csv", params={"link_base": "https://x.test/p"}, headers=ca_headers
    )
    (row,) = list(csv.DictReader(io.StringIO(res.text.lstrip("﻿"))))
    assert row["Text"] == "'=1+1"


# ---------------- the scheduled job ----------------


def test_a_late_evening_job_draws_today_once_it_has_closed(db, clock):
    from app.models import CampaignDraw
    from scripts.run_campaign_draw import main

    add_entries(db, "9000000001")
    clock.now = ist(DAY, 22, 30)

    assert main([]) == 0
    db.expire_all()
    assert db.get(CampaignDraw, DAY).winner_count == 1


def test_the_nightly_job_draws_yesterday_in_india_time(db, clock):
    from scripts.run_campaign_draw import main

    add_entries(db, "9000000001")
    clock.now = ist(DAY + timedelta(days=1), 0, 30)  # 12:30 AM IST, still the 30th in UTC

    assert main([]) == 0
    from app.models import CampaignDraw

    db.expire_all()
    assert db.get(CampaignDraw, DAY).winner_count == 1


def test_the_job_catches_up_on_missed_nights(db, clock):
    """A night the job did not run is drawn by the next run, oldest first."""
    from app.models import CampaignDraw
    from scripts.run_campaign_draw import main

    for d in (DAY - timedelta(days=2), DAY - timedelta(days=1), DAY):
        add_entries(db, "9000000001", day=d)
    clock.now = ist(DAY + timedelta(days=1), 0, 30)

    assert main([]) == 0
    db.expire_all()
    assert [db.get(CampaignDraw, d) is not None for d in (DAY - timedelta(days=2), DAY - timedelta(days=1), DAY)] == [True] * 3
    # One phone, three days: the job still keeps it to one win a day.
    assert [db.get(CampaignDraw, d).winner_count for d in (DAY - timedelta(days=2), DAY - timedelta(days=1), DAY)] == [1, 1, 1]


def test_tiffs_are_written_to_the_campaigns_own_folder(client, ca_headers, db, clock, disco_ball_format):
    from app.config import settings
    from app.models import CampaignWinner

    winner = _draw_one(client, ca_headers, db)
    client.post(f"/campaign-admin/winners/{winner['id']}/tiff", headers=ca_headers)

    path = Path(db.get(CampaignWinner, winner["id"]).tiff_path)
    assert path.is_relative_to(settings.campaign_output_dir)
    assert not path.is_relative_to(settings.output_dir)


def test_the_job_can_draw_a_given_day_and_reports_one_not_ready(db, clock, capsys):
    from scripts.run_campaign_draw import main

    clock.now = ist(DAY, 15)
    assert main([str(DAY)]) == 1
    assert "10 PM IST" in capsys.readouterr().err
