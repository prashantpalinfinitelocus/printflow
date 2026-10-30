"""Every campaign substitution in the Cloud Build files must reach Cloud Run's environment.

A substitution that is declared but missing from --set-env-vars looks configurable but does nothing.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
FILES = ["cloudbuild-api.yaml", "cloudbuild-prod-api.yaml"]


def _env_arg(text: str) -> str:
    match = re.search(r"^\s*'--set-env-vars=(.*)',?\s*$", text, re.MULTILINE)
    assert match, "no --set-env-vars argument found"
    return match.group(1)


def _substitutions(text: str) -> list[str]:
    block = text.split("substitutions:", 1)[1].split("\nsteps:", 1)[0]
    return re.findall(r"^  (_CAMPAIGN_[A-Z_]+):", block, re.MULTILINE)


@pytest.mark.parametrize("name", FILES)
def test_every_campaign_substitution_is_deployed(name):
    text = (ROOT / name).read_text()
    env = _env_arg(text)

    missing = [s for s in _substitutions(text) if "${" + s + "}" not in env]

    assert not missing, f"declared but never deployed: {missing}"


@pytest.mark.parametrize("name", FILES)
def test_the_env_list_uses_the_alternate_delimiter_consistently(name):
    env = _env_arg((ROOT / name).read_text())

    assert env.startswith("^@^")
    assert all("=" in part for part in env[3:].split("@")), "a segment has no KEY=value"


def test_prod_never_enables_the_otp_bypass():
    env = _env_arg((ROOT / "cloudbuild-prod-api.yaml").read_text())

    assert "PRINTFLOW_CAMPAIGN_OTP_BYPASS=false" in env
    assert "BYPASS_CODE" not in env
