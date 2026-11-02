"""infra/create-campaign-admin.sh against a stand-in `gcloud` that records what it is asked to do.

What must hold: the password reaches Secret Manager through stdin and never appears in a command line,
the temporary job and secret are always deleted (even when the job fails), credentials are printed only
after a successful run, and the job copies the API service's image, service account and network.
"""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "infra" / "create-campaign-admin.sh"

SERVICE_JSON = {
    "spec": {
        "template": {
            "metadata": {
                "annotations": {
                    "run.googleapis.com/network-interfaces": json.dumps(
                        [{"network": "projects/p/global/networks/vpc1", "subnetwork": "projects/p/regions/r/subnetworks/sub1"}]
                    ),
                    "run.googleapis.com/vpc-access-egress": "all-traffic",
                }
            },
            "spec": {"serviceAccountName": "runtime-sa@p.iam.gserviceaccount.com", "containers": [{"image": "region-docker.pkg.dev/p/repo/api:abc"}]},
        }
    }
}

FAKE_GCLOUD = r"""#!/usr/bin/env bash
echo "$*" >> "$FAKE_LOG"
# Like the real gcloud's argument parser: a value starting with "-" after a bare flag is taken as another flag.
args=("$@")
for i in "${!args[@]}"; do
  if [[ "${args[$i]}" == "--args" && "${args[$((i+1))]:-}" == -* ]]; then
    echo "ERROR: argument --args: expected one argument" >&2; exit 2
  fi
done
case "$*" in
  "run services describe"*) cat "$FAKE_SERVICE_JSON" ;;
  "secrets create"*) cat > "$FAKE_STDIN" ;;
  "run jobs execute"*) [[ "${FAKE_FAIL_EXECUTE:-0}" == "1" ]] && { echo "job failed" >&2; exit 1; } ;;
esac
exit 0
"""


@pytest.fixture
def sandbox(tmp_path):
    (tmp_path / "gcloud").write_text(FAKE_GCLOUD)
    (tmp_path / "gcloud").chmod(0o755)
    (tmp_path / "service.json").write_text(json.dumps(SERVICE_JSON))
    env = {
        **os.environ,
        "PATH": f"{tmp_path}:{os.environ['PATH']}",
        "FAKE_LOG": str(tmp_path / "calls.log"),
        "FAKE_STDIN": str(tmp_path / "secret.stdin"),
        "FAKE_SERVICE_JSON": str(tmp_path / "service.json"),
    }
    env.pop("CAMPAIGN_ADMIN_PASSWORD", None)

    def run(**extra):
        proc = subprocess.run(["bash", str(SCRIPT)], env={**env, **extra}, capture_output=True, text=True)
        log = (tmp_path / "calls.log").read_text().splitlines() if (tmp_path / "calls.log").exists() else []
        stdin = (tmp_path / "secret.stdin").read_text() if (tmp_path / "secret.stdin").exists() else None
        return proc, log, stdin

    return run


def test_it_creates_the_admin_and_prints_the_credentials_once(sandbox):
    proc, log, stdin = sandbox(CAMPAIGN_ADMIN_PASSWORD="a-long-enough-pass-1", USER_ID="Ankit")

    assert proc.returncode == 0, proc.stderr
    assert "User ID : ankit" in proc.stdout
    assert "Password: a-long-enough-pass-1" in proc.stdout
    assert "/user-campaign/admin/login" in proc.stdout
    assert stdin == "a-long-enough-pass-1"


def test_the_password_is_never_on_a_command_line(sandbox):
    proc, log, _ = sandbox(CAMPAIGN_ADMIN_PASSWORD="a-long-enough-pass-1")

    assert proc.returncode == 0
    assert not any("a-long-enough-pass-1" in line for line in log)


def test_a_generated_password_is_strong_and_also_kept_off_command_lines(sandbox):
    proc, log, stdin = sandbox()

    password = proc.stdout.split("Password: ")[1].split()[0]
    assert len(password) >= 20
    assert stdin == password
    assert not any(password in line for line in log)


def test_the_job_copies_the_api_services_image_account_and_network(sandbox):
    _, log, _ = sandbox(CAMPAIGN_ADMIN_PASSWORD="a-long-enough-pass-1")

    create = next(line for line in log if line.startswith("run jobs create"))
    assert "--image region-docker.pkg.dev/p/repo/api:abc" in create
    assert "--service-account runtime-sa@p.iam.gserviceaccount.com" in create
    assert "--network projects/p/global/networks/vpc1" in create
    assert "--subnet projects/p/regions/r/subnetworks/sub1" in create
    assert "--args=-m,scripts.create_campaign_admin,campaign-admin" in create
    assert "PRINTFLOW_DATABASE_URL=PRINTFLOW_DATABASE_URL:latest" in create
    assert "CAMPAIGN_ADMIN_PASSWORD=PRINTFLOW_CAMPAIGN_ADMIN_PASSWORD_BOOTSTRAP:latest" in create


def test_the_temporary_job_and_secret_are_deleted_after_a_successful_run(sandbox):
    _, log, _ = sandbox(CAMPAIGN_ADMIN_PASSWORD="a-long-enough-pass-1")

    execute = next(i for i, line in enumerate(log) if line.startswith("run jobs execute"))
    after = log[execute + 1 :]
    assert any(line.startswith("run jobs delete campaign-admin-bootstrap") for line in after)
    assert any(line.startswith("secrets delete PRINTFLOW_CAMPAIGN_ADMIN_PASSWORD_BOOTSTRAP") for line in after)


def test_when_the_job_fails_nothing_is_printed_and_everything_is_still_deleted(sandbox):
    proc, log, _ = sandbox(CAMPAIGN_ADMIN_PASSWORD="a-long-enough-pass-1", FAKE_FAIL_EXECUTE="1")

    assert proc.returncode != 0
    assert "a-long-enough-pass-1" not in proc.stdout
    assert "Campaign admin ready" not in proc.stdout
    execute = next(i for i, line in enumerate(log) if line.startswith("run jobs execute"))
    assert any(line.startswith("run jobs delete") for line in log[execute + 1 :])
    assert any(line.startswith("secrets delete") for line in log[execute + 1 :])


def test_a_short_password_is_refused_before_anything_is_called(sandbox):
    proc, log, _ = sandbox(CAMPAIGN_ADMIN_PASSWORD="short")

    assert proc.returncode == 2
    assert log == []


def test_an_over_long_user_id_is_refused_before_anything_is_called(sandbox):
    proc, log, _ = sandbox(USER_ID="x" * 65)

    assert proc.returncode == 2
    assert log == []


def test_dry_run_changes_nothing(sandbox):
    proc, log, _ = sandbox(DRY_RUN="1", CAMPAIGN_ADMIN_PASSWORD="a-long-enough-pass-1")

    assert proc.returncode == 0
    assert log == []
    assert "a-long-enough-pass-1" not in proc.stdout
