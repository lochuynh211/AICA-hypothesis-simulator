"""TDD: DELETE /api/proposal/runs/{run_id} — T034.

Covers:
  - 204 on success; removes ONLY ``proposal_runs/<run_id>.json`` — no
    trigger run (``runs/``) is affected.
  - 404 for an unknown run_id.
  - After delete, the run disappears from both GET-by-id (404) and the
    list.
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


def test_delete_run_returns_204_and_removes_file(tmp_path):
    created = client.post("/api/proposal/runs", json=_create_run_body()).json()
    run_id = created["run_id"]
    assert (tmp_path / f"{run_id}.json").exists()

    resp = client.delete(f"/api/proposal/runs/{run_id}")
    assert resp.status_code == 204
    assert not (tmp_path / f"{run_id}.json").exists()

    assert client.get(f"/api/proposal/runs/{run_id}").status_code == 404
    assert run_id not in {s["run_id"] for s in client.get("/api/proposal/runs").json()}


def test_delete_run_404_on_unknown_run():
    resp = client.delete("/api/proposal/runs/prun_does_not_exist")
    assert resp.status_code == 404


def test_delete_run_never_touches_sibling_trigger_runs_dir(tmp_path, monkeypatch):
    trigger_runs_dir = tmp_path / "sibling_trigger_runs"
    trigger_runs_dir.mkdir()
    monkeypatch.setenv("AICA_RUNS_DIR", str(trigger_runs_dir))

    created = client.post("/api/proposal/runs", json=_create_run_body()).json()
    resp = client.delete(f"/api/proposal/runs/{created['run_id']}")
    assert resp.status_code == 204

    assert list(trigger_runs_dir.iterdir()) == []
