"""TDD: POST /api/proposal/runs/{run_id}/select-service — STEP 2 (content) — T023.

Covers:
  - 200 with an updated ProposalRunLog: status "content_selected", a
    CONTENT_SELECTED event appended, and the CompletePlan in the newly
    appended evidence entry (referencing real frozen-P2 track ids, no
    plan_score anywhere).
  - journey_state.active_service_id reflects the (possibly overridden)
    selected service.
  - 422 when selected_service_id is not in opportunity.allowed_service_ids.
  - 422 when the content package does not support the (allowed) service
    (unsupported_service).
  - 404 when the run is unknown.
  - Determinism: identical create+select requests reproduce identical mock
    outputs.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from aica_api.main import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def isolate_proposal_runs_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("AICA_PROPOSAL_RUNS_DIR", str(tmp_path))
    yield


def _create_run_body(**overrides) -> dict:
    body = {
        "trigger_purpose": "rest_recommended",
        "lifecycle_stage": "after_rest_before_restart",
        "motion_state": "stopped",
        "world_snapshot": {"feature_snapshot": {}, "feature_provenance": {}},
        "service_package_id": "mock_service_selector_v1",
        "content_package_id": "mock_content_selector_v1",
        "mode": "interactive",
        "enabled_feature_extensions": [],
        "parameters": {},
        "hyperparameters": {},
        "run_seed": "seed-1",
        "simulation_time": "2026-07-16T10:00:00Z",
    }
    body.update(overrides)
    return body


def _create_run(**overrides) -> dict:
    resp = client.post("/api/proposal/runs", json=_create_run_body(**overrides))
    assert resp.status_code == 201
    return resp.json()


# ---------------------------------------------------------------------------
# Success path
# ---------------------------------------------------------------------------


def test_select_service_returns_200_content_selected():
    run = _create_run()
    allowed = run["opportunity"]["allowed_service_ids"]
    # After-rest allowed set = {live_viewing, stretch_video, full_karaoke,
    # oshi_reexperience, call_response_stopped}; only full_karaoke is in the
    # mock content package's supported_services.
    assert "full_karaoke" in allowed

    resp = client.post(
        f"/api/proposal/runs/{run['run_id']}/select-service",
        json={"selected_service_id": "full_karaoke"},
    )
    assert resp.status_code == 200
    body = resp.json()

    assert body["status"] == "content_selected"
    assert len(body["evidence"]) == 2
    content_ev = body["evidence"][1]
    assert content_ev["step"] == "content"
    assert content_ev["package_id"] == "mock_content_selector_v1"
    assert content_ev["error"] is None
    assert content_ev["output"]["decision_type"] == "complete_plan"
    assert content_ev["output"]["selected_service_id"] == "full_karaoke"
    assert content_ev["output"]["ordered_items"]

    event_types = [e["event_type"] for e in body["events"]]
    assert event_types == ["OPPORTUNITY_OPENED", "SERVICE_SELECTED", "CONTENT_SELECTED"]

    assert body["journey_state"]["active_service_id"] == "full_karaoke"


def test_select_service_no_plan_score_anywhere():
    run = _create_run()
    resp = client.post(
        f"/api/proposal/runs/{run['run_id']}/select-service",
        json={"selected_service_id": "full_karaoke"},
    )
    output = resp.json()["evidence"][1]["output"]

    def _walk(node):
        if isinstance(node, dict):
            assert "plan_score" not in node
            assert "aggregate_score" not in node
            assert "plan_fit" not in node
            for v in node.values():
                _walk(v)
        elif isinstance(node, list):
            for v in node:
                _walk(v)

    _walk(output)


def test_select_service_items_reference_real_p2_track_ids():
    run = _create_run()
    resp = client.post(
        f"/api/proposal/runs/{run['run_id']}/select-service",
        json={"selected_service_id": "full_karaoke"},
    )
    ordered_items = resp.json()["evidence"][1]["output"]["ordered_items"]
    assert ordered_items
    for item in ordered_items:
        assert item["item_id"].startswith("synthetic-track-")


# ---------------------------------------------------------------------------
# 422s / 404
# ---------------------------------------------------------------------------


def test_select_service_422_when_not_in_allowed_set():
    run = _create_run()
    # music_playlist is not part of the after_rest_before_restart allowed set.
    assert "music_playlist" not in run["opportunity"]["allowed_service_ids"]
    resp = client.post(
        f"/api/proposal/runs/{run['run_id']}/select-service",
        json={"selected_service_id": "music_playlist"},
    )
    assert resp.status_code == 422


def test_select_service_422_when_content_package_does_not_support_allowed_service():
    run = _create_run()
    # live_viewing IS in the after_rest_before_restart allowed set, but the
    # mock content package does not declare it in supported_services.
    assert "live_viewing" in run["opportunity"]["allowed_service_ids"]
    resp = client.post(
        f"/api/proposal/runs/{run['run_id']}/select-service",
        json={"selected_service_id": "live_viewing"},
    )
    assert resp.status_code == 422


def test_select_service_404_on_unknown_run():
    resp = client.post(
        "/api/proposal/runs/prun_does_not_exist/select-service",
        json={"selected_service_id": "full_karaoke"},
    )
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Determinism
# ---------------------------------------------------------------------------


def test_create_and_select_are_deterministic_across_runs():
    run1 = _create_run()
    run2 = _create_run()
    assert run1["evidence"][0]["output"] == run2["evidence"][0]["output"]

    resp1 = client.post(
        f"/api/proposal/runs/{run1['run_id']}/select-service",
        json={"selected_service_id": "full_karaoke"},
    )
    resp2 = client.post(
        f"/api/proposal/runs/{run2['run_id']}/select-service",
        json={"selected_service_id": "full_karaoke"},
    )
    assert resp1.json()["evidence"][1]["output"] == resp2.json()["evidence"][1]["output"]
