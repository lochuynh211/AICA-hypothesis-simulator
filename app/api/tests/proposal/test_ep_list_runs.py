"""TDD: GET /api/proposal/runs — T032 (list run summaries).

Covers:
  - Returns a list of ProposalRun summaries sourced from
    ``proposal_runs/*.json`` on disk.
  - Creating two runs makes both show up in the list, each with the summary
    shape (run_id, status, opportunity_id, created_at, service_package_id,
    content_package_id).
  - An empty (isolated) proposal_runs_dir returns an empty list.
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


def test_list_runs_empty_returns_empty_list():
    resp = client.get("/api/proposal/runs")
    assert resp.status_code == 200
    assert resp.json() == []


def test_list_runs_returns_created_run_summaries():
    r1 = client.post("/api/proposal/runs", json=_create_run_body())
    r2 = client.post("/api/proposal/runs", json=_create_run_body())
    assert r1.status_code == 201 and r2.status_code == 201
    run1, run2 = r1.json(), r2.json()

    resp = client.get("/api/proposal/runs")
    assert resp.status_code == 200
    summaries = resp.json()

    ids = {s["run_id"] for s in summaries}
    assert {run1["run_id"], run2["run_id"]} <= ids

    summary1 = next(s for s in summaries if s["run_id"] == run1["run_id"])
    assert summary1["status"] == run1["status"]
    assert summary1["opportunity_id"] == run1["opportunity"]["opportunity_id"]
    assert summary1["created_at"] == run1["created_at"]
    assert summary1["service_package_id"] == run1["service_package_id"]
    assert summary1["content_package_id"] == run1["content_package_id"]
    # Summary shape only — no evidence/events payload.
    assert "evidence" not in summary1
    assert "events" not in summary1
