"""US2 capstone: persistence round-trip + determinism + isolation (T035).

Asserts the User-Story-2 success criteria end to end:
  - SC-004: create -> a file exists under the isolated proposal_runs_dir ->
    GET it deep-equals the created record (reopen renders from the stored
    log; no recomputation of selectors) -> delete -> gone from both list
    and disk.
  - Isolation: creating (and completing, via select-service) a proposal run
    writes ONLY under proposal_runs_dir and never under the trigger
    ``runs/`` dir.
"""
from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from aica_api.main import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def isolate_dirs(tmp_path, monkeypatch):
    proposal_runs_dir = tmp_path / "proposal_runs"
    trigger_runs_dir = tmp_path / "runs"
    proposal_runs_dir.mkdir()
    trigger_runs_dir.mkdir()
    monkeypatch.setenv("AICA_PROPOSAL_RUNS_DIR", str(proposal_runs_dir))
    monkeypatch.setenv("AICA_RUNS_DIR", str(trigger_runs_dir))
    yield proposal_runs_dir, trigger_runs_dir


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


def test_persist_reopen_delete_round_trip(isolate_dirs):
    proposal_runs_dir, _trigger_runs_dir = isolate_dirs

    # ---- create -----------------------------------------------------------
    created = client.post("/api/proposal/runs", json=_create_run_body()).json()
    run_id = created["run_id"]

    on_disk_path = proposal_runs_dir / f"{run_id}.json"
    assert on_disk_path.exists()
    on_disk = json.loads(on_disk_path.read_text(encoding="utf-8"))
    assert on_disk == created

    # ---- reopen: deep-equals the created record, no recompute -------------
    reopened = client.get(f"/api/proposal/runs/{run_id}").json()
    assert reopened == created

    # ---- delete -------------------------------------------------------------
    del_resp = client.delete(f"/api/proposal/runs/{run_id}")
    assert del_resp.status_code == 204
    assert not on_disk_path.exists()

    assert client.get(f"/api/proposal/runs/{run_id}").status_code == 404
    assert run_id not in {s["run_id"] for s in client.get("/api/proposal/runs").json()}


def test_full_flow_writes_only_under_proposal_runs_dir_never_trigger_runs(isolate_dirs):
    """SC-004 isolation: create + select-service touches proposal_runs/ only."""
    proposal_runs_dir, trigger_runs_dir = isolate_dirs

    created = client.post("/api/proposal/runs", json=_create_run_body()).json()
    run_id = created["run_id"]
    client.post(
        f"/api/proposal/runs/{run_id}/select-service",
        json={"selected_service_id": "full_karaoke"},
    )

    assert (proposal_runs_dir / f"{run_id}.json").exists()
    assert list(trigger_runs_dir.iterdir()) == []
