"""TDD regression: STEP-2 select-service must reject an INELIGIBLE service,
not just an out-of-row one (whole-branch review Critical — SC-002/FR-002).

Bug: ``select_service`` validated ``selected_service_id`` only against the
FULL frozen row (``opportunity.allowed_service_ids``), never against the
CURRENT eligible subset (``resolve_eligibility`` narrows the row by
``journey_state.motion_state``/registered entities). That let a reviewer pick
an excluded service — e.g. ``full_karaoke`` while ``motion_state=driving`` —
and ``accept`` it, so it became active driving content: exactly the
full-screen-karaoke-while-driving case SC-002/FR-002 forbid.

Fix: ``select_service`` recomputes eligibility against
``run_log.journey_state.motion_state`` (the CURRENT motion, which may have
changed since create via a ``motion_change`` journey action) and 422s an
ineligible selection with ``code: "service_not_eligible"`` + reason codes,
before ever reaching the content package / selector dispatch.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from aica_api.main import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def isolate_proposal_runs_dir(tmp_path, monkeypatch):
    """Never let these tests write into the real proposal_runs/ directory."""
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


def test_select_service_rejects_ineligible_service_while_driving():
    """rest_recommended/after_rest_before_restart, motion_state=driving:
    eligible narrows to {live_viewing}; full_karaoke is EXCLUDED
    (full_karaoke_requires_stopped). Selecting it must 422, never 200."""
    run = _create_run(motion_state="driving")
    allowed = run["opportunity"]["allowed_service_ids"]
    # full_karaoke is still in the FULL frozen row (the old, insufficient
    # check) — this is exactly what let the bug through.
    assert "full_karaoke" in allowed

    resp = client.post(
        f"/api/proposal/runs/{run['run_id']}/select-service",
        json={"selected_service_id": "full_karaoke"},
    )
    assert resp.status_code == 422
    detail = resp.json()["detail"]
    assert detail["code"] == "service_not_eligible"
    assert "full_karaoke_requires_stopped" in detail["reason_codes"]

    # The run must NOT have advanced to content_selected, and no excluded
    # service may become active — reopen and confirm untouched.
    reopened = client.get(f"/api/proposal/runs/{run['run_id']}").json()
    assert reopened["status"] != "content_selected"
    assert reopened["journey_state"]["active_service_id"] != "full_karaoke"
    assert len(reopened["evidence"]) == 1  # no content evidence was appended
    event_types = [e["event_type"] for e in reopened["events"]]
    assert "CONTENT_SELECTED" not in event_types


def test_select_service_still_allows_eligible_service_while_stopped():
    """Sanity: motion_state=stopped keeps full_karaoke legitimately eligible
    — confirms the fix doesn't over-restrict the existing happy path."""
    run = _create_run(motion_state="stopped")
    resp = client.post(
        f"/api/proposal/runs/{run['run_id']}/select-service",
        json={"selected_service_id": "full_karaoke"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "content_selected"
    assert body["journey_state"]["active_service_id"] == "full_karaoke"
