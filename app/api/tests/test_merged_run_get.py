"""Integration test for the merged-run GET (+ list) replay-assembly endpoint
(feature 020, Slice-2c, Task 4).

Exercises the full HTTP stack:
  POST /api/merged-runs                      — trigger run + handle
  POST /api/merged-runs/{id}/tick             — tick the trigger until a
    REST fire auto-creates a proposal run (real handle + real trigger
    RunLog + real ProposalRunLog, all persisted to disk)
  GET  /api/merged-runs/{id}                  — pure disk-read reassembly:
    {handle, trigger_log, proposal_logs}
  GET  /api/merged-runs                       — glob-listing of summaries

Reuses the same proven fire-producing pairing and fixtures as
``test_merged_runs_router.py`` (nri_fatigue_score_v1 x
uc01_fatigue_recovery_v0_1, fires ~tick 45; the committed
``seed-night-highway-oshi`` typed World seed already shaped for
trigger_purpose=rest_recommended / lifecycle_stage=before_rest_until_stop).
"""
from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from aica_api.config import settings
from aica_api.main import app
from aica_api.services.run_manager import clear_registry
from aica_api.services.run_plan import clear_draft_registry

client = TestClient(app)

_TRIGGER_PACKAGE_ID = "nri_fatigue_score_v1"
_TRIGGER_SCENARIO_ID = "uc01_fatigue_recovery_v0_1"
_SEED_ID = "seed-night-highway-oshi"
_SERVICE_PACKAGE_ID = "mock_service_selector_v1"
_CONTENT_PACKAGE_ID = "mock_content_selector_v1"
_MAX_TICKS = 400


@pytest.fixture(autouse=True)
def isolate_dirs(tmp_path, monkeypatch):
    """Never let these tests write into real runs/proposal_runs/merged_runs."""
    monkeypatch.setenv("AICA_RUNS_DIR", str(tmp_path / "runs"))
    monkeypatch.setenv("AICA_PROPOSAL_RUNS_DIR", str(tmp_path / "proposal_runs"))
    monkeypatch.setenv("AICA_MERGED_RUNS_DIR", str(tmp_path / "merged_runs"))
    clear_registry()
    clear_draft_registry()
    yield
    clear_registry()
    clear_draft_registry()


@pytest.fixture()
def rest_plan_id() -> str:
    resp = client.post(
        "/api/run-plans",
        json={"package_id": _TRIGGER_PACKAGE_ID, "scenario_id": _TRIGGER_SCENARIO_ID},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["plan_id"]


@pytest.fixture()
def base_world_dict() -> dict:
    path = settings.proposal_contracts_dir / "seeds" / f"{_SEED_ID}.json"
    return json.loads(path.read_text(encoding="utf-8"))["world"]


def _create_merged_run(rest_plan_id: str, base_world_dict: dict) -> str:
    r = client.post(
        "/api/merged-runs",
        json={
            "trigger_plan_id": rest_plan_id,
            "world": base_world_dict,
            "service_package_id": _SERVICE_PACKAGE_ID,
            "content_package_id": _CONTENT_PACKAGE_ID,
            "run_seed": "7",
        },
    )
    assert r.status_code == 201, r.text
    return r.json()["merged_run_id"]


def _tick_until_proposal(mid: str) -> dict | None:
    proposal = None
    for _ in range(_MAX_TICKS):
        tr = client.post(f"/api/merged-runs/{mid}/tick")
        assert tr.status_code == 200, tr.text
        body = tr.json()
        if body["proposal"]:
            proposal = body["proposal"]
            break
        if body["trigger"].get("completed"):
            break
    return proposal


def test_get_merged_run_after_fire_reassembles_handle_trigger_and_proposal(
    rest_plan_id, base_world_dict
):
    mid = _create_merged_run(rest_plan_id, base_world_dict)
    proposal = _tick_until_proposal(mid)
    assert proposal is not None

    resp = client.get(f"/api/merged-runs/{mid}")
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert set(body.keys()) == {"handle", "trigger_log", "proposal_logs"}

    handle = body["handle"]
    assert handle["merged_run_id"] == mid
    assert handle["trigger_run_id"]
    assert handle["proposal_run_ids"] == [proposal["run_id"]]

    trigger_log = body["trigger_log"]
    assert trigger_log is not None
    assert trigger_log["run_id"] == handle["trigger_run_id"]
    tick_events = [e for e in trigger_log["events"] if e["kind"] == "tick"]
    assert len(tick_events) >= 1

    proposal_logs = body["proposal_logs"]
    assert len(proposal_logs) == 1
    plog = proposal_logs[0]
    assert plog["run_id"] == proposal["run_id"]
    assert plog["opportunity"]["trigger_purpose"] == "rest_recommended"
    assert plog["opportunity"]["lifecycle_stage"] == "before_rest_until_stop"
    assert len(plog["events"]) >= 1


def test_get_merged_run_unknown_id_404():
    resp = client.get("/api/merged-runs/mrun_does_not_exist")
    assert resp.status_code == 404


def test_list_merged_runs_lists_created_run(rest_plan_id, base_world_dict):
    mid = _create_merged_run(rest_plan_id, base_world_dict)
    proposal = _tick_until_proposal(mid)
    assert proposal is not None

    resp = client.get("/api/merged-runs")
    assert resp.status_code == 200, resp.text
    items = resp.json()["merged_runs"]

    matches = [i for i in items if i["merged_run_id"] == mid]
    assert len(matches) == 1
    summary = matches[0]
    assert summary["trigger_run_id"]
    assert summary["proposal_run_ids_count"] == 1


def test_list_merged_runs_empty_when_no_runs():
    resp = client.get("/api/merged-runs")
    assert resp.status_code == 200, resp.text
    assert resp.json()["merged_runs"] == []
