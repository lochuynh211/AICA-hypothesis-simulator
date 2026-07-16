"""US3 trust invariant — isolation (T037): creating/editing a proposal run

writes ONLY under ``proposal_runs/``, NEVER under the trigger ``runs/`` dir,
and never touches the trigger's in-memory run registry
(``aica_api.services.run_manager._registry``).

This complements ``test_us2_persistence.py``'s
``test_full_flow_writes_only_under_proposal_runs_dir_never_trigger_runs``
(which asserts the trigger dir stays EMPTY) by additionally:
  - pre-seeding the trigger ``runs/`` dir with a real file and confirming its
    bytes are byte-for-byte unchanged after a proposal create+select-service
    flow (not just "still empty" — "still exactly what it was before"),
  - asserting the trigger in-memory run registry (``run_manager._registry``)
    is not populated by any proposal-only request,
  - covering DELETE too (a proposal delete never touches trigger runs/).

FR-024, SC-004/SC-005.
"""
from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from aica_api.main import app
from aica_api.services import run_manager

client = TestClient(app)


@pytest.fixture(autouse=True)
def isolate_dirs(tmp_path, monkeypatch):
    proposal_runs_dir = tmp_path / "proposal_runs"
    trigger_runs_dir = tmp_path / "runs"
    proposal_runs_dir.mkdir()
    trigger_runs_dir.mkdir()
    monkeypatch.setenv("AICA_PROPOSAL_RUNS_DIR", str(proposal_runs_dir))
    monkeypatch.setenv("AICA_RUNS_DIR", str(trigger_runs_dir))
    run_manager.clear_registry()
    yield proposal_runs_dir, trigger_runs_dir
    run_manager.clear_registry()


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


def _seed_pre_existing_trigger_evidence(trigger_runs_dir):
    """Simulate a real, already-persisted trigger run log on disk, to prove
    the proposal endpoints never touch it (not merely "the dir stays empty",
    but "pre-existing trigger evidence survives byte-for-byte")."""
    fixture_path = trigger_runs_dir / "run_pretend_trigger_001.json"
    payload = {"run_id": "run_pretend_trigger_001", "status": "created", "sentinel": True}
    fixture_path.write_text(json.dumps(payload), encoding="utf-8")
    return fixture_path, fixture_path.read_bytes()


# ---------------------------------------------------------------------------
# Trigger runs/ dir: byte-for-byte unchanged across create + select-service + delete
# ---------------------------------------------------------------------------


def test_create_run_leaves_preexisting_trigger_evidence_untouched(isolate_dirs):
    _proposal_runs_dir, trigger_runs_dir = isolate_dirs
    fixture_path, before_bytes = _seed_pre_existing_trigger_evidence(trigger_runs_dir)

    resp = client.post("/api/proposal/runs", json=_create_run_body())
    assert resp.status_code == 201

    assert fixture_path.read_bytes() == before_bytes
    assert [p.name for p in trigger_runs_dir.iterdir()] == [fixture_path.name]


def test_full_flow_leaves_trigger_dir_content_set_unchanged(isolate_dirs):
    _proposal_runs_dir, trigger_runs_dir = isolate_dirs
    fixture_path, before_bytes = _seed_pre_existing_trigger_evidence(trigger_runs_dir)
    before_listing = sorted(p.name for p in trigger_runs_dir.iterdir())

    created = client.post("/api/proposal/runs", json=_create_run_body()).json()
    client.post(
        f"/api/proposal/runs/{created['run_id']}/select-service",
        json={"selected_service_id": "full_karaoke"},
    )
    client.delete(f"/api/proposal/runs/{created['run_id']}")

    after_listing = sorted(p.name for p in trigger_runs_dir.iterdir())
    assert after_listing == before_listing
    assert fixture_path.read_bytes() == before_bytes


def test_delete_proposal_run_does_not_touch_trigger_runs_dir(isolate_dirs):
    _proposal_runs_dir, trigger_runs_dir = isolate_dirs
    fixture_path, before_bytes = _seed_pre_existing_trigger_evidence(trigger_runs_dir)

    created = client.post("/api/proposal/runs", json=_create_run_body()).json()
    del_resp = client.delete(f"/api/proposal/runs/{created['run_id']}")
    assert del_resp.status_code == 204

    assert fixture_path.read_bytes() == before_bytes
    assert [p.name for p in trigger_runs_dir.iterdir()] == [fixture_path.name]


# ---------------------------------------------------------------------------
# Trigger in-memory run registry: never populated by proposal-only requests
# ---------------------------------------------------------------------------


def test_create_run_does_not_populate_trigger_in_memory_registry():
    assert run_manager._registry == {}

    client.post("/api/proposal/runs", json=_create_run_body())

    assert run_manager._registry == {}


def test_full_proposal_flow_does_not_populate_trigger_in_memory_registry():
    assert run_manager._registry == {}

    created = client.post("/api/proposal/runs", json=_create_run_body()).json()
    client.post(
        f"/api/proposal/runs/{created['run_id']}/select-service",
        json={"selected_service_id": "full_karaoke"},
    )
    client.get(f"/api/proposal/runs/{created['run_id']}")
    client.get("/api/proposal/runs")
    client.delete(f"/api/proposal/runs/{created['run_id']}")

    assert run_manager._registry == {}


# ---------------------------------------------------------------------------
# Proposal runs persist only under the isolated proposal_runs_dir
# ---------------------------------------------------------------------------


def test_created_run_file_lives_only_under_proposal_runs_dir(isolate_dirs):
    proposal_runs_dir, trigger_runs_dir = isolate_dirs
    created = client.post("/api/proposal/runs", json=_create_run_body()).json()
    run_id = created["run_id"]

    assert (proposal_runs_dir / f"{run_id}.json").exists()
    assert not (trigger_runs_dir / f"{run_id}.json").exists()
