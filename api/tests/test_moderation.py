"""Text moderation: the LLM gate between a CSV row and a printable order.

Unit tests drive `moderate_texts` directly through the fake Gemini client; the
integration tests go through the API to prove the hold actually blocks a print
and that an admin can lift it.
"""

from __future__ import annotations

import pytest

from tests.test_flow import _csv, _upload

# ---------------- unit: service ----------------


def test_clear_text_yields_clear_verdict(fake_gemini):
    from app.models import ModerationStatus
    from app.services.moderation import moderate_texts

    outcome = moderate_texts(["Happy Birthday, Riya!"])

    assert [v.status for v in outcome.verdicts] == [ModerationStatus.CLEAR]
    assert outcome.verdicts[0].categories == []
    assert outcome.verdicts[0].reason is None


def test_flagged_text_carries_categories_and_reason(fake_gemini):
    from app.models import ModerationStatus
    from app.services.moderation import moderate_texts

    fake_gemini.flag["Pepsi is better"] = (["COMPETITOR_BRAND"], "Names a competitor brand")

    outcome = moderate_texts(["Cheers!", "Pepsi is better"])

    assert [v.status for v in outcome.verdicts] == [ModerationStatus.CLEAR, ModerationStatus.FLAGGED]
    assert outcome.verdicts[1].categories == ["COMPETITOR_BRAND"]
    assert outcome.verdicts[1].reason == "Names a competitor brand"


def test_texts_are_split_into_batches_and_mapped_back_in_order(fake_gemini, monkeypatch):
    from app.config import settings
    from app.models import ModerationStatus
    from app.services.moderation import moderate_texts

    monkeypatch.setattr(settings, "moderation_batch_size", 25)
    texts = [f"tag {n}" for n in range(60)]
    fake_gemini.flag["tag 30"] = (["POLITICS"], "political slogan")
    fake_gemini.flag["tag 59"] = (["ABUSE_PROFANITY"], "profanity")

    outcome = moderate_texts(texts)

    assert [len(c["texts"]) for c in fake_gemini.calls] == [25, 25, 10]
    assert len(outcome.verdicts) == 60
    flagged = [i for i, v in enumerate(outcome.verdicts) if v.status == ModerationStatus.FLAGGED]
    assert flagged == [30, 59]


def test_a_failed_batch_only_holds_its_own_rows(fake_gemini, monkeypatch):
    from app.config import settings
    from app.models import ModerationStatus
    from app.services.moderation import moderate_texts

    monkeypatch.setattr(settings, "moderation_batch_size", 2)
    fake_gemini.fail_on_call = {2}

    outcome = moderate_texts(["a", "b", "c", "d", "e"])

    statuses = [v.status for v in outcome.verdicts]
    assert statuses == [
        ModerationStatus.CLEAR,
        ModerationStatus.CLEAR,
        ModerationStatus.NEEDS_REVIEW,
        ModerationStatus.NEEDS_REVIEW,
        ModerationStatus.CLEAR,
    ]
    assert "unavailable" in outcome.verdicts[2].reason.lower()
    assert "simulated Gemini outage" in outcome.verdicts[2].reason


def test_a_row_the_model_skipped_is_held_not_cleared(fake_gemini):
    from app.models import ModerationStatus
    from app.services.moderation import moderate_texts

    fake_gemini.drop_indexes = {1}

    outcome = moderate_texts(["fine", "silently skipped", "also fine"])

    assert outcome.verdicts[1].status == ModerationStatus.NEEDS_REVIEW
    assert "no verdict" in outcome.verdicts[1].reason.lower()
    assert outcome.verdicts[0].status == ModerationStatus.CLEAR
    assert outcome.verdicts[2].status == ModerationStatus.CLEAR


def test_disabled_moderation_returns_unchecked_without_calling_the_api(fake_gemini, monkeypatch):
    from app.config import settings
    from app.models import ModerationStatus
    from app.services.moderation import moderate_texts

    monkeypatch.setattr(settings, "moderation_enabled", False)

    outcome = moderate_texts(["anything"])

    assert outcome.verdicts[0].status == ModerationStatus.UNCHECKED
    assert fake_gemini.calls == []


def test_empty_input_makes_no_calls(fake_gemini):
    from app.services.moderation import moderate_texts

    outcome = moderate_texts([])

    assert outcome.verdicts == []
    assert fake_gemini.calls == []
    assert outcome.prompt_tokens == 0


def test_token_usage_is_summed_across_batches(fake_gemini, monkeypatch):
    from app.config import settings
    from app.services.moderation import moderate_texts

    monkeypatch.setattr(settings, "moderation_batch_size", 2)
    fake_gemini.usage = {"prompt": 100, "candidates": 40, "thoughts": 5}

    outcome = moderate_texts(["a", "b", "c"])  # two batches

    assert outcome.prompt_tokens == 200
    assert outcome.output_tokens == 80
    assert outcome.thought_tokens == 10


def test_request_uses_the_configured_model_json_schema_and_minimal_thinking(fake_gemini, monkeypatch):
    from google.genai import types

    from app.config import settings
    from app.services.moderation import BatchResult, moderate_texts

    monkeypatch.setattr(settings, "moderation_model", "gemini-3.5-flash")

    moderate_texts(["hello"])

    call = fake_gemini.calls[0]
    cfg: types.GenerateContentConfig = call["config"]
    assert call["model"] == "gemini-3.5-flash"
    assert cfg.response_mime_type == "application/json"
    assert cfg.response_schema is BatchResult
    assert cfg.thinking_config.thinking_level == types.ThinkingLevel.MINIMAL
    assert cfg.temperature == 0
    assert "Coca-Cola" in cfg.system_instruction
    assert "Pepsi" in cfg.system_instruction
    assert "Thums Up" in cfg.system_instruction  # own brand, must not be treated as a competitor


def test_extra_competitors_from_config_land_in_the_prompt(fake_gemini, monkeypatch):
    from app.config import settings
    from app.services.moderation import moderate_texts

    monkeypatch.setattr(settings, "moderation_extra_competitors", "Frooti, Jumpin")

    moderate_texts(["hello"])

    system = fake_gemini.calls[0]["config"].system_instruction
    assert "Frooti" in system
    assert "Jumpin" in system


# ---------------- integration: import -> hold -> review -> print ----------------


def _import_one(client, admin_headers, ref: str, text: str):
    body = _upload(client, admin_headers, _csv(f"{ref},TST01,99.00,TEST_FMT,{text}"), name=f"{ref}.csv").json()
    order = client.get(f"/orders?q={ref}", headers=admin_headers).json()["items"][0]
    return body, order


def test_clear_rows_import_as_clear_and_print(client, admin_headers, operator_headers):
    batch, order = _import_one(client, admin_headers, "ORD-MOD-OK", "Happy Birthday, Riya!")

    assert batch["flagged"] == 0
    assert order["moderation_status"] == "CLEAR"
    res = client.post(f"/orders/{order['id']}/print", headers=operator_headers, json={"kind": "TIFF", "delivery": "DOWNLOAD"})
    assert res.status_code == 200, res.text


def test_flagged_rows_are_held_and_cannot_be_printed(client, admin_headers, operator_headers, fake_gemini):
    fake_gemini.flag["Vote for XYZ party"] = (["POLITICS"], "Political campaign message")

    batch, order = _import_one(client, admin_headers, "ORD-MOD-POL", "Vote for XYZ party")

    assert batch["imported"] == 1, "a flagged row is imported, not skipped"
    assert batch["flagged"] == 1
    assert order["status"] == "PENDING"
    assert order["moderation_status"] == "FLAGGED"
    assert order["moderation_categories"] == ["POLITICS"]
    assert order["moderation_reason"] == "Political campaign message"

    res = client.post(f"/orders/{order['id']}/print", headers=operator_headers, json={"kind": "TIFF", "delivery": "DOWNLOAD"})
    assert res.status_code == 409
    assert "Political campaign message" in res.json()["detail"]
    # Not even a proof render: the text must not be composited onto brand artwork.
    res = client.post(f"/orders/{order['id']}/print", headers=operator_headers, json={"kind": "PDF", "delivery": "PROOF"})
    assert res.status_code == 409


def test_admin_approval_lifts_the_hold(client, admin_headers, operator_headers, fake_gemini):
    fake_gemini.flag["Borderline"] = (["OTHER"], "unsure")
    _, order = _import_one(client, admin_headers, "ORD-MOD-APP", "Borderline")

    res = client.post(
        f"/orders/{order['id']}/moderation/review",
        headers=admin_headers,
        json={"decision": "APPROVE", "note": "Reviewed, harmless"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["moderation_status"] == "APPROVED"
    assert body["moderation_reason"] == "unsure"  # the LLM's reason is kept for the audit trail
    assert body["moderation_note"] == "Reviewed, harmless"
    assert body["reviewed_by"]["email"] == "admin@test.local"

    res = client.post(f"/orders/{order['id']}/print", headers=operator_headers, json={"kind": "TIFF", "delivery": "DOWNLOAD"})
    assert res.status_code == 200, res.text


def test_admin_rejection_keeps_the_order_blocked(client, admin_headers, operator_headers, fake_gemini):
    fake_gemini.flag["Nasty"] = (["ABUSE_PROFANITY"], "abusive")
    _, order = _import_one(client, admin_headers, "ORD-MOD-REJ", "Nasty")

    res = client.post(f"/orders/{order['id']}/moderation/review", headers=admin_headers, json={"decision": "REJECT"})
    assert res.status_code == 200, res.text
    assert res.json()["moderation_status"] == "REJECTED"

    res = client.post(f"/orders/{order['id']}/print", headers=operator_headers, json={"kind": "TIFF", "delivery": "DOWNLOAD"})
    assert res.status_code == 409


def test_operators_cannot_review_moderation(client, admin_headers, operator_headers, fake_gemini):
    fake_gemini.flag["Held"] = (["OTHER"], "x")
    _, order = _import_one(client, admin_headers, "ORD-MOD-OPR", "Held")

    res = client.post(f"/orders/{order['id']}/moderation/review", headers=operator_headers, json={"decision": "APPROVE"})
    assert res.status_code == 403


def test_a_clear_order_cannot_be_reviewed(client, admin_headers):
    _, order = _import_one(client, admin_headers, "ORD-MOD-NOREV", "Plain")

    res = client.post(f"/orders/{order['id']}/moderation/review", headers=admin_headers, json={"decision": "APPROVE"})
    assert res.status_code == 409


def test_moderation_outage_holds_rows_for_review_but_still_imports_them(client, admin_headers, operator_headers, fake_gemini):
    fake_gemini.fail_on_call = {1}

    batch, order = _import_one(client, admin_headers, "ORD-MOD-DOWN", "Get well soon")

    assert batch["imported"] == 1
    assert batch["flagged"] == 1
    assert order["moderation_status"] == "NEEDS_REVIEW"
    assert "unavailable" in order["moderation_reason"].lower()
    res = client.post(f"/orders/{order['id']}/print", headers=operator_headers, json={"kind": "TIFF", "delivery": "DOWNLOAD"})
    assert res.status_code == 409


def test_recheck_reruns_the_model_on_one_order(client, admin_headers, operator_headers, fake_gemini):
    fake_gemini.fail_on_call = {1}
    _, order = _import_one(client, admin_headers, "ORD-MOD-RE", "Get well soon")
    assert order["moderation_status"] == "NEEDS_REVIEW"

    res = client.post(f"/orders/{order['id']}/moderation/recheck", headers=admin_headers)
    assert res.status_code == 200, res.text
    assert res.json()["moderation_status"] == "CLEAR"
    assert fake_gemini.calls[-1]["texts"] == ["Get well soon"]

    res = client.post(f"/orders/{order['id']}/print", headers=operator_headers, json={"kind": "TIFF", "delivery": "DOWNLOAD"})
    assert res.status_code == 200, res.text


def test_disabled_moderation_imports_as_unchecked_and_printable(client, admin_headers, operator_headers, monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "moderation_enabled", False)
    batch, order = _import_one(client, admin_headers, "ORD-MOD-OFF", "Anything goes")

    assert batch["flagged"] == 0
    assert order["moderation_status"] == "UNCHECKED"
    res = client.post(f"/orders/{order['id']}/print", headers=operator_headers, json={"kind": "TIFF", "delivery": "DOWNLOAD"})
    assert res.status_code == 200, res.text


def test_batch_records_token_spend(client, admin_headers, fake_gemini):
    fake_gemini.usage = {"prompt": 900, "candidates": 60, "thoughts": 3}

    batch, _ = _import_one(client, admin_headers, "ORD-MOD-TOK", "Cheers")

    assert batch["moderation_prompt_tokens"] == 900
    assert batch["moderation_output_tokens"] == 60
    assert batch["moderation_thought_tokens"] == 3


def test_orders_can_be_filtered_by_moderation_status_and_stats_count_holds(client, admin_headers, fake_gemini):
    fake_gemini.flag["Bad one"] = (["HATE"], "hate speech")
    _upload(
        client,
        admin_headers,
        _csv("ORD-MOD-F1,TST01,1.00,TEST_FMT,Bad one", "ORD-MOD-F2,TST01,1.00,TEST_FMT,Good one"),
        name="filter.csv",
    )

    held = client.get("/orders?moderation=FLAGGED&q=ORD-MOD-F", headers=admin_headers).json()["items"]
    assert [o["order_ref"] for o in held] == ["ORD-MOD-F1"]

    stats = client.get("/orders/stats", headers=admin_headers).json()
    assert stats["on_hold"] >= 1


def test_operator_sees_the_hold_but_scoping_still_applies(client, admin_headers, operator_headers, fake_gemini):
    fake_gemini.flag["Held for op"] = (["OTHER"], "x")
    _, order = _import_one(client, admin_headers, "ORD-MOD-OPV", "Held for op")

    mine = client.get(f"/orders/{order['id']}", headers=operator_headers).json()
    assert mine["moderation_status"] == "FLAGGED"
    assert mine["moderation_reason"] == "x"


def test_on_hold_filter_spans_every_held_status(client, admin_headers, fake_gemini):
    fake_gemini.flag["Hold A"] = (["OTHER"], "a")
    fake_gemini.fail_on_call = {2}
    _import_one(client, admin_headers, "ORD-MOD-H1", "Hold A")  # FLAGGED (call 1)
    _import_one(client, admin_headers, "ORD-MOD-H2", "Outage")  # NEEDS_REVIEW (call 2 fails)
    _import_one(client, admin_headers, "ORD-MOD-H3", "Clean")  # CLEAR

    held = client.get("/orders?on_hold=true&q=ORD-MOD-H", headers=admin_headers).json()["items"]
    assert sorted(o["order_ref"] for o in held) == ["ORD-MOD-H1", "ORD-MOD-H2"]


def test_a_client_that_cannot_be_built_holds_every_row(fake_gemini, monkeypatch):
    """No API key, bad SDK install — whatever it is, the import must not 500 and
    nothing may print unchecked."""
    from app.models import ModerationStatus
    from app.services import moderation

    def boom():
        raise ValueError("Missing key. Set GEMINI_API_KEY")

    monkeypatch.setattr(moderation, "_make_client", boom)

    outcome = moderation.moderate_texts(["a", "b"])

    assert [v.status for v in outcome.verdicts] == [ModerationStatus.NEEDS_REVIEW] * 2
    assert "GEMINI_API_KEY" in outcome.verdicts[0].reason


def test_prompt_names_indian_political_parties_and_gives_examples(fake_gemini):
    from app.services.moderation import moderate_texts

    moderate_texts(["hello"])

    system = fake_gemini.calls[0]["config"].system_instruction
    for term in ("BJP", "Congress", "AAP", "Modi", "Rahul Gandhi", "Kejriwal", "Abki baar"):
        assert term in system, term
    # Few-shot section: at least one flagged and one clear worked example.
    assert "Examples" in system
    assert '-> FLAGGED' in system and '-> CLEAR' in system
