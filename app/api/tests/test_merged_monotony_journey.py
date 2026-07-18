"""Integration test for the merged-runs monotony path (feature 020, Slice-3,
Task 2 -- the monotony / inattentive-driving-prevention journey).

Exercises the full HTTP stack:
  POST /api/run-plans                                 -- trigger plan draft
    (``aica_transparent_hybrid_trigger_v1`` x ``uc02_monotony_v0_1``, the
    ONLY package that emits ``MONOTONY_PROPOSAL``)
  POST /api/merged-runs                                -- trigger run + handle
  POST /api/merged-runs/{id}/tick                       -- tick the trigger; on
    the first MONOTONY fire, auto-creates an
    ``inattentive_driving_prevention_recovery``/``active_driving_content``
    proposal run via the EXISTING ``create_proposal_run`` handler (real
    ``aica_transparent_service_selector_v1``/``aica_transparent_content_selector_v1``
    packages -- eligibility-before-ranking runs INSIDE that handler)
  POST /api/merged-runs/{id}/proposal-action            -- select_service
    dispatched against the spawned proposal run, advancing to content

``uc02_monotony_v0_1`` is authored (see the scenario's own ``_comment`` and
``docs/superpowers/plans/2026-07-18-merged-simulator-slice3-monotony.md``) so
that MONOTONY_PROPOSAL reliably fires (~tick 23) while REST_PROPOSAL never
approaches its threshold (base_safety_risk stays ~0.18, far under both
``minimum_risk_for_rest_bonus``=0.45 and ``threshold_suggest``=0.7) --
a long uninterrupted night highway drive, familiar route, a brief early
traffic jam (pushes env_load), and slow drowsiness/fatigue growth.
"""
from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from aica_api.config import settings
from aica_api.main import app
from aica_api.services.merged_run_coordinator import get_handle
from aica_api.services.run_manager import clear_registry
from aica_api.services.run_plan import clear_draft_registry

client = TestClient(app)

_TRIGGER_PACKAGE_ID = "aica_transparent_hybrid_trigger_v1"
_TRIGGER_SCENARIO_ID = "uc02_monotony_v0_1"
_SEED_ID = "seed-night-highway-oshi"
_SERVICE_PACKAGE_ID = "aica_transparent_service_selector_v1"
_CONTENT_PACKAGE_ID = "aica_transparent_content_selector_v1"
_ACTIVE_DRIVING_SERVICE_IDS = {
    "music_playlist",
    "humming_karaoke",
    "quiz",
    "ranking_creation",
    "radio_style",
    "call_response_driving",
}
_MAX_TICKS = 60


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
def monotony_plan_id() -> str:
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


def _create_merged_run(monotony_plan_id: str, base_world_dict: dict) -> str:
    r = client.post(
        "/api/merged-runs",
        json={
            "trigger_plan_id": monotony_plan_id,
            "world": base_world_dict,
            "service_package_id": _SERVICE_PACKAGE_ID,
            "content_package_id": _CONTENT_PACKAGE_ID,
            "run_seed": "7",
        },
    )
    assert r.status_code == 201, r.text
    return r.json()["merged_run_id"]


def _tick_until_fire(mid: str) -> dict:
    """Tick until a proposal-bearing response; fail loudly if none ever fires
    or REST_PROPOSAL fires instead of MONOTONY_PROPOSAL."""
    for _ in range(_MAX_TICKS):
        tr = client.post(f"/api/merged-runs/{mid}/tick")
        assert tr.status_code == 200, tr.text
        body = tr.json()
        assert body["trigger"].get("error") is None, body["trigger"]
        if body["proposal"]:
            return body
        if body["trigger"].get("completed"):
            pytest.fail("run completed before any proposal fired")
    pytest.fail(f"no proposal fired within {_MAX_TICKS} ticks")


def test_monotony_fire_pauses_and_creates_inattentive_driving_proposal(
    monotony_plan_id, base_world_dict
):
    mid = _create_merged_run(monotony_plan_id, base_world_dict)

    body = _tick_until_fire(mid)

    # ── The fire tick itself: paused, no rest chain triggered ─────────────
    assert body["trigger"]["paused"] is True
    assert body["trigger"]["decision"]["result_type"] == "MONOTONY_PROPOSAL"

    proposal = body["proposal"]
    assert proposal is not None
    opportunity = proposal["opportunity"]
    assert opportunity["trigger_purpose"] == "inattentive_driving_prevention_recovery"
    assert opportunity["lifecycle_stage"] == "active_driving_content"

    # ── Real ranked service evidence from the active-driving matrix row ───
    service_evidence = [ev for ev in proposal["evidence"] if ev["step"] == "service"]
    assert len(service_evidence) >= 1
    ranked_candidates = service_evidence[0]["output"]["ranked_candidates"]
    assert ranked_candidates
    ranked_ids = {c["candidate_id"] for c in ranked_candidates}
    assert ranked_ids <= _ACTIVE_DRIVING_SERVICE_IDS
    assert ranked_ids & _ACTIVE_DRIVING_SERVICE_IDS

    # ── The simulator-owned monotony proxy actually drove this fire ───────
    assert proposal["world"]["situation"]["monotony_level"] > 0

    # ── No rest journey: rest_stage_synced untouched, no REST_SPOT_ARRIVED ─
    handle = get_handle(mid, settings.merged_runs_dir)
    assert handle is not None
    assert handle.rest_stage_synced is None
    event_types = [e["event_type"] for e in proposal["events"]]
    assert "REST_SPOT_ARRIVED" not in event_types
    assert "REST_STARTED" not in event_types

    # ── select-service advances the spawned proposal run to content ───────
    first_ranked = ranked_candidates[0]["candidate_id"]
    action_resp = client.post(
        f"/api/merged-runs/{mid}/proposal-action",
        json={"kind": "select_service", "selected_service_id": first_ranked},
    )
    assert action_resp.status_code == 200, action_resp.text
    updated = action_resp.json()

    event_types_after = [e["event_type"] for e in updated["events"]]
    assert "CONTENT_SELECTED" in event_types_after
    assert "REST_SPOT_ARRIVED" not in event_types_after
    assert "REST_STARTED" not in event_types_after

    # Still no rest chain after the content selection either.
    handle_after = get_handle(mid, settings.merged_runs_dir)
    assert handle_after.rest_stage_synced is None
