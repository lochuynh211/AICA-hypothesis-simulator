"""TDD: GET /api/proposal/runs/{run_id} — T033 (full log, no recompute).

Covers:
  - Returns the full ``ProposalRunLog`` loaded from disk — the reopened
    body deep-equals what was returned at creation time (renders from the
    stored record; no recomputation of selectors).
  - 404 for an unknown run_id.
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
        "world_snapshot": {
            "feature_snapshot": {"drowsiness_level": 72, "fatigue_level": 55},
            "feature_provenance": {},
            "profile_id": "profile-test-1",
        },
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


def test_get_run_returns_full_log_matching_created_record():
    created = client.post("/api/proposal/runs", json=_create_run_body()).json()

    resp = client.get(f"/api/proposal/runs/{created['run_id']}")
    assert resp.status_code == 200
    reopened = resp.json()

    assert reopened == created


def test_get_run_reflects_recorded_evidence_after_select_service():
    created = client.post("/api/proposal/runs", json=_create_run_body()).json()
    run_id = created["run_id"]

    selected = client.post(
        f"/api/proposal/runs/{run_id}/select-service",
        json={"selected_service_id": "full_karaoke"},
    ).json()

    resp = client.get(f"/api/proposal/runs/{run_id}")
    assert resp.status_code == 200
    reopened = resp.json()

    assert reopened == selected
    assert reopened["status"] == "content_selected"
    assert len(reopened["evidence"]) == 2


def test_get_run_404_on_unknown_run():
    resp = client.get("/api/proposal/runs/prun_does_not_exist")
    assert resp.status_code == 404
