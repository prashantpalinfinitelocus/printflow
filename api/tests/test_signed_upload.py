"""Direct-to-bucket CSV upload: the signed URL the browser PUTs to, bypassing the load balancer."""

from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace

import pytest


def _service():
    from app.services import signed_upload

    return signed_upload


# ---------------- unit: file naming ----------------


def test_inbox_filename_is_unique_per_second_and_keeps_the_stem():
    name = _service().inbox_filename("Orders Oct.csv", now=datetime(2026, 10, 23, 10, 15, 0, tzinfo=UTC))
    assert name == "Orders Oct-20261023-101500.csv"


@pytest.mark.parametrize("bad", ["orders.txt", "orders", "", "orders.csv.exe"])
def test_inbox_filename_rejects_anything_that_is_not_csv(bad):
    with pytest.raises(ValueError):
        _service().inbox_filename(bad)


def test_inbox_filename_cannot_escape_the_inbox_folder():
    name = _service().inbox_filename("../../etc/passwd.csv")
    assert "/" not in name and ".." not in name
    assert name.startswith("passwd-")


def test_inbox_filename_replaces_odd_characters():
    name = _service().inbox_filename("a%b?c&d=e.csv")
    assert all(ch not in name for ch in "%?&=")


# ---------------- unit: signing ----------------


def _fake_gcp(monkeypatch, sink):
    import google.auth
    from google.cloud import storage

    creds = SimpleNamespace(
        token="tok", service_account_email="run-sa@proj.iam.gserviceaccount.com", refresh=lambda _req: None
    )
    monkeypatch.setattr(google.auth, "default", lambda scopes=None: (creds, "proj"))

    class FakeClient:
        def __init__(self, **_kw):
            pass

        def generate_signed_post_policy_v4(self, bucket, path, **kwargs):
            sink.update(kwargs, bucket=bucket, path=path)
            return {"url": "https://storage.googleapis.com/my-bucket/", "fields": {"key": path, "policy": "p"}}

    monkeypatch.setattr(storage, "Client", FakeClient)


def test_signed_form_targets_the_inbox_folder_and_is_signed_through_iam(monkeypatch):
    from app.config import settings

    sink: dict = {}
    _fake_gcp(monkeypatch, sink)
    monkeypatch.setattr(settings, "upload_bucket", "my-bucket")
    monkeypatch.setattr(settings, "upload_max_bytes", 1000)

    signed = _service().create_inbox_upload_url("orders.csv")

    assert signed.url.startswith("https://storage.googleapis.com/")
    assert sink["bucket"] == "my-bucket"
    assert sink["path"] == f"inbox/{signed.filename}" == signed.fields["key"]
    # No private key on Cloud Run: signing goes through IAM with the service account's own token.
    assert sink["service_account_email"] == "run-sa@proj.iam.gserviceaccount.com"
    assert sink["access_token"] == "tok"
    # Size cap and content type are part of the signed policy, so the browser cannot change them.
    assert ["content-length-range", 0, 1000] in sink["conditions"]
    assert ["eq", "$Content-Type", "text/csv"] in sink["conditions"]
    assert sink["fields"] == {"Content-Type": "text/csv"}


def test_signing_refuses_when_no_bucket_is_configured(monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "upload_bucket", "")
    with pytest.raises(_service().UploadNotConfigured):
        _service().create_inbox_upload_url("orders.csv")


# ---------------- integration: route ----------------


def test_upload_url_is_503_without_a_bucket_so_the_page_falls_back(client, admin_headers, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "upload_bucket", "")
    res = client.post("/csv/upload-url", json={"filename": "orders.csv"}, headers=admin_headers)
    assert res.status_code == 503


def test_upload_url_returns_what_the_browser_needs(client, admin_headers, monkeypatch):
    from app.routers import orders

    fake = _service().SignedUpload(
        url="https://storage.googleapis.com/signed",
        filename="orders-20261023-101500.csv",
        fields={"key": "inbox/orders-20261023-101500.csv"},
        expires_in=600,
    )
    monkeypatch.setattr(orders, "create_inbox_upload_url", lambda name: fake)

    res = client.post("/csv/upload-url", json={"filename": "orders.csv"}, headers=admin_headers)

    assert res.status_code == 200
    body = res.json()
    assert body["url"] == fake.url
    assert body["filename"] == "orders-20261023-101500.csv"
    assert body["fields"] == {"key": "inbox/orders-20261023-101500.csv"}


def test_upload_url_rejects_a_non_csv_name(client, admin_headers, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "upload_bucket", "my-bucket")
    res = client.post("/csv/upload-url", json={"filename": "orders.exe"}, headers=admin_headers)
    assert res.status_code == 422


def test_upload_url_is_admin_only(client, operator_headers):
    res = client.post("/csv/upload-url", json={"filename": "orders.csv"}, headers=operator_headers)
    assert res.status_code == 403


def test_upload_url_needs_a_login(client):
    res = client.post("/csv/upload-url", json={"filename": "orders.csv"})
    assert res.status_code in (401, 403)
