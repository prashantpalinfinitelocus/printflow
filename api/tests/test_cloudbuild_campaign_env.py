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


def _secret_names(text: str) -> list[str]:
    match = re.search(r"'--set-secrets=(.*?)'", text)
    assert match, "no --set-secrets argument found"
    return [pair.split("=", 1)[0] for pair in match.group(1).split(",")]


@pytest.mark.parametrize("name", FILES)
def test_no_name_is_both_a_plain_env_var_and_a_secret(name):
    text = (ROOT / name).read_text()
    env_names = {part.split("=", 1)[0] for part in _env_arg(text)[3:].split("@")}

    assert not env_names & set(_secret_names(text))


def test_test_env_reads_the_bypass_code_and_infobip_key_from_secret_manager():
    names = _secret_names((ROOT / "cloudbuild-api.yaml").read_text())

    assert "PRINTFLOW_CAMPAIGN_OTP_BYPASS_CODE" in names
    assert "PRINTFLOW_CAMPAIGN_INFOBIP_API_KEY" in names


def test_prod_does_not_depend_on_secrets_that_only_exist_in_test():
    names = _secret_names((ROOT / "cloudbuild-prod-api.yaml").read_text())

    assert "PRINTFLOW_CAMPAIGN_OTP_BYPASS_CODE" not in names


# The approved DLT template (header COKEBY). The text with {#num#} written as {otp}.
DIET_COKE_DLT = {
    "_CAMPAIGN_INFOBIP_SENDER_ID": "COKEBY",
    "_CAMPAIGN_INFOBIP_DLT_ENTITY_ID": "1101393580000056521",
    "_CAMPAIGN_INFOBIP_DLT_TEMPLATE_ID": "1177179363488364821",
    "_CAMPAIGN_INFOBIP_MESSAGE": (
        "Your One Time Password for Diet Coke - Make It Yours is {otp}. Please do not share it with anyone."
    ),
}


def _substitution_values(text: str) -> dict[str, str]:
    block = text.split("substitutions:", 1)[1].split("\nsteps:", 1)[0]
    return {k: v.strip("'") for k, v in re.findall(r"^  (_[A-Z_]+): ?(.*)$", block, re.MULTILINE)}


@pytest.mark.parametrize("name", FILES)
def test_infobip_uses_the_approved_diet_coke_dlt_template(name):
    values = _substitution_values((ROOT / name).read_text())

    assert {k: values[k] for k in DIET_COKE_DLT} == DIET_COKE_DLT


@pytest.mark.parametrize("name", FILES)
def test_the_dlt_message_survives_the_env_list_and_cloud_build(name):
    message = _substitution_values((ROOT / name).read_text())["_CAMPAIGN_INFOBIP_MESSAGE"]

    assert message.count("{otp}") == 1
    assert not set("@'$") & set(message)
