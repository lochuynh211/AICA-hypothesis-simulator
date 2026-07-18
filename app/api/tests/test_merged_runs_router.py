"""Integration test for the merged-runs router (feature 020, Task 4 — the
integration seam).

Exercises the full HTTP stack:
  POST /api/merged-runs                              — trigger run + handle
  POST /api/merged-runs/{id}/tick                     — tick the trigger; on
    the first REST fire, auto-creates a ``rest_recommended`` proposal run via
    the EXISTING ``create_proposal_run`` handler (eligibility-before-ranking
    is preserved because it runs INSIDE that handler)
  POST /api/merged-runs/{id}/proposal-action          — dispatches
    select_service/apply_journey_action against the spawned proposal run

The trigger side reuses the proven fire-producing pairing from
``test_uc01_recovery_e2e.py`` (nri_fatigue_score_v1 × uc01_fatigue_recovery_v0_1,
fires ~tick 45). The proposal side reuses a committed typed World seed
(``proposal_contracts/seeds/seed-night-highway-oshi.json``) as the merged
run's ``world`` template — already shaped for
trigger_purpose=rest_recommended / lifecycle_stage=before_rest_until_stop.
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
            assert body["correlation"]["trigger_tick_index"] >= 0
            break
        if body["trigger"].get("completed"):
            break
    return proposal


def test_create_then_tick_until_rest_fire_creates_proposal(rest_plan_id, base_world_dict):
    mid = _create_merged_run(rest_plan_id, base_world_dict)

    proposal = _tick_until_proposal(mid)

    assert proposal is not None
    assert proposal["opportunity"]["trigger_purpose"] == "rest_recommended"
    assert proposal["opportunity"]["lifecycle_stage"] == "before_rest_until_stop"
    assert len(proposal["evidence"]) >= 1  # a service evaluate() ran => eligibility+ranking happened


def test_proposal_action_select_service(rest_plan_id, base_world_dict):
    mid = _create_merged_run(rest_plan_id, base_world_dict)
    proposal = _tick_until_proposal(mid)
    assert proposal is not None

    first_ranked = proposal["evidence"][0]["output"]["ranked_candidates"][0]["candidate_id"]

    action_resp = client.post(
        f"/api/merged-runs/{mid}/proposal-action",
        json={"kind": "select_service", "selected_service_id": first_ranked},
    )
    assert action_resp.status_code == 200, action_resp.text
    updated = action_resp.json()

    event_types = [e["event_type"] for e in updated["events"]]
    has_content_evidence = any(ev.get("step") == "content" for ev in updated["evidence"])
    assert "CONTENT_SELECTED" in event_types or has_content_evidence


def test_tick_unknown_merged_run_id_404():
    resp = client.post("/api/merged-runs/mrun_does_not_exist/tick")
    assert resp.status_code == 404


def test_proposal_action_before_any_fire_404(rest_plan_id, base_world_dict):
    mid = _create_merged_run(rest_plan_id, base_world_dict)
    resp = client.post(
        f"/api/merged-runs/{mid}/proposal-action",
        json={"kind": "select_service", "selected_service_id": "music_playlist"},
    )
    assert resp.status_code == 404
