"""Test harness.

Runs against a throwaway Postgres database and replaces the `lp`/`lpstat`
binaries with a recording stub, so the printer dispatch path is exercised for
real — argv, exit code, job-id parsing — without putting anything on paper.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest

API_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(API_DIR))

TEST_DB = "printflow_test"

# Defaults to a local Postgres with the current user, which is what a dev laptop
# has. In Docker the database lives on another host, so the URL is overridable —
# `createdb`/`dropdb` below pick the same server up from libpq's PG* variables.
TEST_DB_URL = os.environ.get(
    "PRINTFLOW_TEST_DATABASE_URL", f"postgresql+psycopg://localhost/{TEST_DB}"
)

STUB_LP = """#!/bin/sh
# Records argv, then mimics `lp`'s success output.
echo "$@" >> "$PRINTFLOW_STUB_LOG"
echo "request id is TEST-42 (1 file(s))"
"""

STUB_LPSTAT = """#!/bin/sh
case "$1" in
  -d) echo "system default destination: TEST_PRINTER" ;;
  *)  echo "printer TEST_PRINTER is idle.  enabled since today"
      echo "printer OFFLINE_PRINTER disabled since today" ;;
esac
"""


@pytest.fixture(scope="session", autouse=True)
def _environment(tmp_path_factory: pytest.TempPathFactory):
    data_dir = tmp_path_factory.mktemp("printflow-data")
    bin_dir = tmp_path_factory.mktemp("printflow-bin")
    stub_log = data_dir / "lp-invocations.log"

    for name, body in (("lp", STUB_LP), ("lpstat", STUB_LPSTAT)):
        path = bin_dir / name
        path.write_text(body)
        path.chmod(0o755)

    subprocess.run(["dropdb", "--if-exists", TEST_DB], check=False, capture_output=True)
    subprocess.run(["createdb", TEST_DB], check=True, capture_output=True)

    os.environ.update(
        {
            "PRINTFLOW_DATABASE_URL": TEST_DB_URL,
            "PRINTFLOW_DATA_DIR": str(data_dir),
            "PRINTFLOW_INBOX_DIR": str(data_dir / "inbox"),
            "PRINTFLOW_PSD_DIR": str(data_dir / "psd"),
            "PRINTFLOW_OUTPUT_DIR": str(data_dir / "output"),
            "PRINTFLOW_LP_BINARY": str(bin_dir / "lp"),
            "PRINTFLOW_LPSTAT_BINARY": str(bin_dir / "lpstat"),
            "PRINTFLOW_JWT_SECRET": "test-secret",
            "PRINTFLOW_STUB_LOG": str(stub_log),
        }
    )

    yield {"data_dir": data_dir, "stub_log": stub_log}

    subprocess.run(["dropdb", "--if-exists", TEST_DB], check=False, capture_output=True)


@pytest.fixture(scope="session")
def app_modules(_environment):
    from app.config import get_settings

    get_settings.cache_clear()

    from app.db import Base, engine
    from app.main import app

    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    return app


@pytest.fixture(scope="session")
def seeded(app_modules, _environment):
    """One store master, one PSD template, one admin and one operator."""
    from PIL import Image

    from app.config import settings
    from app.db import SessionLocal
    from app.models import PrintFormat, Role, Store, User
    from app.security import hash_password
    from app.services.psd_writer import write_psd

    settings.ensure_dirs()
    write_psd(Image.new("RGB", (600, 400), (220, 20, 34)), settings.psd_dir / "test.psd", 300)

    db = SessionLocal()
    try:
        store = Store(code="TST01", name="Test Store", city="Testville")
        other = Store(code="TST02", name="Other Store", city="Elsewhere")
        db.add_all([store, other])
        db.flush()

        fmt = PrintFormat(
            code="TEST_FMT",
            name="Test Format",
            psd_path="test.psd",
            width_px=600,
            height_px=400,
            dpi=300,
            text_box={"x": 50, "y": 150, "w": 500, "h": 100},
            font_size=48,
            font_color="#FFFFFF",
            align="center",
        )
        db.add(fmt)

        db.add_all(
            [
                User(
                    email="admin@test.local",
                    password_hash=hash_password("adminpw"),
                    role=Role.ADMIN,
                ),
                User(
                    email="op@test.local",
                    password_hash=hash_password("operatorpw"),
                    role=Role.OPERATOR,
                    store_id=store.id,
                ),
            ]
        )
        db.commit()
        return {"store_id": store.id, "other_store_id": other.id, "format_id": fmt.id}
    finally:
        db.close()


@pytest.fixture
def client(app_modules, seeded):
    from fastapi.testclient import TestClient

    with TestClient(app_modules) as test_client:
        yield test_client


def _token(client, email: str, password: str) -> str:
    res = client.post("/auth/login", json={"email": email, "password": password})
    assert res.status_code == 200, res.text
    return res.json()["access_token"]


@pytest.fixture
def admin_headers(client):
    return {"Authorization": f"Bearer {_token(client, 'admin@test.local', 'adminpw')}"}


@pytest.fixture
def operator_headers(client):
    return {"Authorization": f"Bearer {_token(client, 'op@test.local', 'operatorpw')}"}


@pytest.fixture
def stub_log(_environment) -> Path:
    return _environment["stub_log"]
