"""Regression tests for the findings from the CodeQL and StackHawk scans."""

from __future__ import annotations

import pytest

from app.config import settings
from app.services.renderer import RenderError, resolve_font_file, resolve_psd_path


# --- StackHawk: an id too large for the database used to crash with a 500 -----------

@pytest.mark.parametrize(
    "path",
    [
        "/orders/95801529082932111608894156772924964738785347",
        "/orders/95801529082932111608894156772924964738785347/jobs",
        "/orders/2147483648",
        "/orders/0",
        "/orders/-1",
    ],
)
def test_out_of_range_order_id_is_rejected_not_a_server_error(client, admin_headers, path):
    res = client.get(path, headers=admin_headers)
    assert res.status_code == 422, res.text


def test_out_of_range_id_in_a_query_string_is_rejected(client, admin_headers):
    res = client.get("/orders", params={"store_id": 2**40}, headers=admin_headers)
    assert res.status_code == 422, res.text


def test_largest_valid_id_is_a_plain_not_found(client, admin_headers):
    res = client.get("/orders/2147483647", headers=admin_headers)
    assert res.status_code == 404, res.text


# --- StackHawk: every response says not to sniff the content type ------------------

def test_responses_carry_nosniff(client, admin_headers):
    for path in ("/health", "/auth/me"):
        res = client.get(path, headers=admin_headers)
        assert res.headers.get("x-content-type-options") == "nosniff", path


# --- CodeQL: a file name from a request must stay inside its folder ----------------

def test_psd_name_inside_the_psd_folder_resolves():
    resolved = resolve_psd_path("test.psd")
    assert resolved.parent == settings.psd_dir.resolve()


def test_absolute_psd_path_inside_the_folder_is_allowed():
    inside = settings.psd_dir / "test.psd"
    assert resolve_psd_path(inside) == inside.resolve()


@pytest.mark.parametrize("name", ["../secret.psd", "../../etc/passwd", "/etc/passwd", "sub/../../x.psd"])
def test_psd_path_that_escapes_the_folder_is_refused(name):
    with pytest.raises(RenderError):
        resolve_psd_path(name)


@pytest.mark.parametrize("name", ["../x.ttf", "../../etc/passwd", "/etc/passwd"])
def test_font_name_that_escapes_the_folder_is_ignored(name):
    assert resolve_font_file(name) is None


def test_symlink_inside_the_folder_cannot_lead_out(tmp_path):
    outside = tmp_path / "outside.psd"
    outside.write_bytes(b"x")
    link = settings.psd_dir / "link-out.psd"
    link.symlink_to(outside)
    try:
        with pytest.raises(RenderError):
            resolve_psd_path("link-out.psd")
    finally:
        link.unlink()


def test_creating_a_format_with_an_escaping_psd_path_is_a_422(client, admin_headers):
    res = client.post(
        "/print-formats",
        headers=admin_headers,
        json={
            "code": "ESCAPE",
            "name": "Escape attempt",
            "psd_path": "../../../../etc/passwd",
            "text_box": {"x": 0, "y": 0, "w": 10, "h": 10},
        },
    )
    assert res.status_code in (422, 400), res.text
