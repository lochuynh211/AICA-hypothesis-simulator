"""TDD (T012): POST /api/proposal/runs/{run_id}/journey/action — scaffold.

Covers:
  - 404 for an unknown run_id.
  - For a real, freshly-created run: an action the (stub) engine rejects
    returns 422 with the structured ``{"code": ..., "message": ...}`` detail
    (contracts/journey-api.md), and the run's persisted log is unchanged
    (append-only — a rejected transition must not silently mutate state).
  - An unrecognized ``action_type`` string fails FastAPI/pydantic request
    validation (422) before the handler/engine ever runs.
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


def test_journey_action_404_for_unknown_run():
    resp = client.post(
        "/api/proposal/runs/prun_does_not_exist/journey/action",
        json={"action_type": "accept", "payload": {}},
    )
    assert resp.status_code == 404


def test_journey_action_422_structured_rejection_for_real_run():
    run = _create_run()
    run_id = run["run_id"]

    resp = client.post(
        f"/api/proposal/runs/{run_id}/journey/action",
        json={"action_type": "accept", "payload": {}},
    )

    assert resp.status_code == 422
    detail = resp.json()["detail"]
    assert detail["code"] == "invalid_precondition"
    assert isinstance(detail["message"], str) and detail["message"]

    # The run's persisted log is unchanged: no new event appended, status
    # untouched (append-only discipline — a rejection is a no-op).
    reopened = client.get(f"/api/proposal/runs/{run_id}").json()
    assert reopened["events"] == run["events"]
    assert reopened["status"] == run["status"]
    assert reopened["journey_state"] == run["journey_state"]


def test_journey_action_unrecognized_action_type_is_422_request_validation():
    run = _create_run()
    run_id = run["run_id"]

    resp = client.post(
        f"/api/proposal/runs/{run_id}/journey/action",
        json={"action_type": "not_a_real_action", "payload": {}},
    )

    # Rejected by FastAPI/pydantic request validation before the handler
    # runs (JourneyActionType is a closed enum) — still 422, but this is
    # distinct from the engine's own structured rejection shape above.
    assert resp.status_code == 422
