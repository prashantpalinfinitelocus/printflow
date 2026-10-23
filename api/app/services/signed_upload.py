"""Signed URLs for uploading a CSV straight into the bucket behind the inbox.

The API runs on Cloud Run with no private key, so the policy is signed through the IAM Credentials
API as the service account (needs `roles/iam.serviceAccountTokenCreator` on itself). The browser
then POSTs a multipart form to storage.googleapis.com directly, which keeps the file body away from
the load balancer and its WAF. The app sees the file afterwards through the `/data/inbox` mount.

A form POST is a "simple" cross-origin request, so the browser sends no preflight and the bucket
needs no CORS configuration. The page cannot read the response, so it confirms the upload by
waiting for the file to appear in the inbox.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

from ..config import settings

CSV_CONTENT_TYPE = "text/csv"
_UNSAFE = re.compile(r"[^A-Za-z0-9._ -]+")


class UploadNotConfigured(RuntimeError):
    """No bucket is set, so direct upload is unavailable."""


@dataclass(frozen=True)
class SignedUpload:
    url: str
    #: Form fields to send before the file (key, policy, signature and so on).
    fields: dict[str, str]
    filename: str
    expires_in: int


def inbox_filename(requested: str, now: datetime | None = None) -> str:
    """A safe, unique inbox name: `orders.csv` -> `orders-20261023-101500.csv`.

    The timestamp keeps a second upload of the same name from silently replacing a file that
    has not been imported yet. Raises ValueError for anything that is not a .csv.
    """
    name = Path(requested or "").name.strip()
    if not name.lower().endswith(".csv"):
        raise ValueError("Only .csv files are accepted")
    stem = _UNSAFE.sub("_", name[: -len(".csv")]).strip(" .-_")[:100] or "upload"
    stamp = (now or datetime.now(UTC)).strftime("%Y%m%d-%H%M%S")
    return f"{stem}-{stamp}.csv"


def create_inbox_upload_url(requested_name: str) -> SignedUpload:
    if not settings.upload_bucket:
        raise UploadNotConfigured("Direct upload is not configured")
    filename = inbox_filename(requested_name)

    import google.auth
    from google.auth.transport.requests import Request
    from google.cloud import storage

    credentials, project = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
    credentials.refresh(Request())
    client = storage.Client(project=project, credentials=credentials)

    # The size cap and content type are part of the signed policy, so the browser cannot change them.
    policy = client.generate_signed_post_policy_v4(
        settings.upload_bucket,
        f"inbox/{filename}",
        expiration=timedelta(seconds=settings.upload_url_ttl_seconds),
        fields={"Content-Type": CSV_CONTENT_TYPE},
        conditions=[
            ["content-length-range", 0, settings.upload_max_bytes],
            ["eq", "$Content-Type", CSV_CONTENT_TYPE],
        ],
        service_account_email=credentials.service_account_email,
        access_token=credentials.token,
        scheme="https",
    )
    return SignedUpload(
        url=policy["url"], fields=policy["fields"], filename=filename, expires_in=settings.upload_url_ttl_seconds
    )
