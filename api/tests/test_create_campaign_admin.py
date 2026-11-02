"""scripts.create_campaign_admin: creates a campaign admin, interactively or from the environment.

A deployed server has no terminal to type a password into, so a job passes it in an
environment variable (from Secret Manager). Either way only a bcrypt hash is stored.
"""

from __future__ import annotations

import itertools

import pytest

_names = itertools.count(1)


@pytest.fixture
def make(app_modules, seeded, monkeypatch):
    """Runs the script's main() with an optional environment password; returns (exit code, output)."""
    from scripts import create_campaign_admin as script

    def run(argv, *, env_password=None, prompts=None, capsys=None):
        if env_password is None:
            monkeypatch.delenv("CAMPAIGN_ADMIN_PASSWORD", raising=False)
        else:
            monkeypatch.setenv("CAMPAIGN_ADMIN_PASSWORD", env_password)
        answers = iter(prompts or [])
        monkeypatch.setattr(script.getpass, "getpass", lambda *_a, **_k: next(answers))
        return script.main(argv)

    return run


def uid() -> str:
    return f"ut-admin-{next(_names)}"


def admin_row(username):
    from app.db import SessionLocal
    from app.models import CampaignAdmin

    with SessionLocal() as db:
        row = db.query(CampaignAdmin).filter_by(username=username).one_or_none()
        if row is not None:
            db.expunge(row)
        return row


def test_an_environment_password_creates_the_admin_without_prompting(make):
    name = uid()

    code = make([name], env_password="a-long-enough-pass-1")

    assert code == 0
    row = admin_row(name)
    assert row is not None and row.is_active


def test_only_a_bcrypt_hash_is_stored_and_it_verifies(make):
    from app.security import verify_password

    name = uid()
    make([name], env_password="a-long-enough-pass-1")

    row = admin_row(name)
    assert "a-long-enough-pass-1" not in row.password_hash
    assert row.password_hash.startswith("$2")
    assert verify_password("a-long-enough-pass-1", row.password_hash)
    assert not verify_password("another-password-1", row.password_hash)


def test_the_created_admin_can_log_in_through_the_api(make, client):
    name = uid()
    make([name], env_password="a-long-enough-pass-1")

    res = client.post("/campaign-admin/auth/login", json={"username": name, "password": "a-long-enough-pass-1"})

    assert res.status_code == 200
    assert res.json()["admin"] == {"username": name}


def test_a_short_environment_password_is_refused_and_nothing_is_created(make):
    name = uid()

    code = make([name], env_password="short")

    assert code == 1
    assert admin_row(name) is None


def test_running_again_sets_a_new_password_and_signs_the_admin_out(make):
    from app.security import verify_password

    name = uid()
    make([name], env_password="the-first-password-1")
    before = admin_row(name)

    code = make([name], env_password="the-second-password-2")

    after = admin_row(name)
    assert code == 0
    assert verify_password("the-second-password-2", after.password_hash)
    assert not verify_password("the-first-password-1", after.password_hash)
    assert after.token_version == before.token_version + 1


def test_the_user_id_is_trimmed_and_lower_cased(make):
    name = uid()

    make([f"  {name.upper()}  "], env_password="a-long-enough-pass-1")

    assert admin_row(name) is not None


def test_an_over_long_user_id_is_refused(make):
    assert make(["x" * 65], env_password="a-long-enough-pass-1") == 2


def test_without_the_environment_password_it_still_asks_twice(make):
    name = uid()

    code = make([name], prompts=["typed-at-a-prompt-1", "typed-at-a-prompt-1"])

    assert code == 0
    assert admin_row(name) is not None


def test_the_interactive_passwords_must_match(make):
    name = uid()

    code = make([name], prompts=["typed-at-a-prompt-1", "something-different-9"])

    assert code == 1
    assert admin_row(name) is None


def test_an_empty_environment_password_falls_back_to_asking(make):
    name = uid()

    code = make([name], env_password="", prompts=["typed-at-a-prompt-1", "typed-at-a-prompt-1"])

    assert code == 0
