"""Integration test for the merged-runs rest-journey auto-drive (feature 020,
Slice-2 core, Task 3).

Exercises the full HTTP stack across ``accept-rest`` + repeated ``tick``:
  1. Trigger fires REST_PROPOSAL -> slice-1 auto-creates a before-rest
     ``rest_recommended``/``before_rest_until_stop`` proposal run.
  2. ``POST /api/merged-runs/{id}/accept-rest`` starts the trigger's staged
     recovery (``run_manager.action(..., "accept_rest", ...)``), optionally
     overriding the chosen option's nap-stage duration via ``nap_minutes``.
  3. Further ``tick`` calls auto-drive the SAME proposal run through the
     journey engine as the trigger recovery advances: motion "stopped"
     (arrival) -> ``rest_spot_arrived``+``rest_started`` ->
     ``during_rest_stopped``; recovery complete -> ``rest_completed`` (with
     the recovered drowsiness/fatigue as ``post_rest``) ->
     ``after_rest_before_restart`` -> a ``recompute`` that ranks the 5
     after-rest ("stopped") services.

Reuses the SAME trigger fixture pairing as ``test_merged_runs_router.py``
(``nri_fatigue_score_v1`` x ``uc01_fatigue_recovery_v0_1``, fires ~tick 45)
and the mock service/content selector packages. ``uc01_fatigue_recovery_v0_1``
is the scenario with ``recovery_options`` (nap_karaoke/convenience_stretch/
postpone) proven by ``test_uc01_recovery_e2e.py``'s
``accept_rest(nap_karaoke)`` sequence.
"""
from __future__ import annotations

import json

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from aica_api.config import settings
from aica_api.main import app
from aica_api.services import run_manager
from aica_api.services.run_manager import clear_registry
from aica_api.services.run_plan import clear_draft_registry

client = TestClient(app)

_TRIGGER_PACKAGE_ID = "nri_fatigue_score_v1"
_TRIGGER_SCENARIO_ID = "uc01_fatigue_recovery_v0_1"
_SEED_ID = "seed-night-highway-oshi"
_SERVICE_PACKAGE_ID = "mock_service_selector_v1"
_CONTENT_PACKAGE_ID = "mock_content_selector_v1"
_RECOVERY_OPTION_ID = "nap_karaoke"
_AFTER_REST_SERVICE_IDS = {
    "live_viewing",
    "stretch_video",
    "full_karaoke",
    "oshi_reexperience",
    "call_response_stopped",
}
_MAX_TICKS_TO_FIRE = 400
_MAX_TICKS_TO_AFTER_REST = 300


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


def _create_merged_run(rest_plan_id: str, base_world_dict: dict) -> tuple[str, str]:
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
    body = r.json()
    return body["merged_run_id"], body["trigger_run_id"]


def _tick_until_proposal(mid: str) -> dict:
    for _ in range(_MAX_TICKS_TO_FIRE):
        tr = client.post(f"/api/merged-runs/{mid}/tick")
        assert tr.status_code == 200, tr.text
        body = tr.json()
        if body["proposal"]:
            return body["proposal"]
        assert not body["trigger"].get("completed"), "run completed before a REST fire"
    pytest.fail("no REST fire within budget")


def _drowsiness(proposal: dict) -> int:
    return proposal["world_snapshot"]["feature_snapshot"]["situation"]["drowsiness_level"]


def test_full_rest_journey_before_during_after_one_proposal_run(rest_plan_id, base_world_dict):
    mid, trigger_run_id = _create_merged_run(rest_plan_id, base_world_dict)

    proposal_at_fire = _tick_until_proposal(mid)
    run_id = proposal_at_fire["run_id"]
    assert proposal_at_fire["journey_state"]["lifecycle_stage"] == "before_rest_until_stop"
    drowsiness_at_fire = _drowsiness(proposal_at_fire)

    spots_resp = client.get(f"/api/runs/{trigger_run_id}/rest-spots")
    assert spots_resp.status_code == 200, spots_resp.text
    spots = spots_resp.json()["rest_spots"]
    assert spots, "expected at least one rest spot ahead"
    first_spot = spots[0]

    accept_resp = client.post(
        f"/api/merged-runs/{mid}/accept-rest",
        json={
            "recovery_option_id": _RECOVERY_OPTION_ID,
            "rest_spot": first_spot,
            "nap_minutes": 15,
        },
    )
    assert accept_resp.status_code == 200, accept_resp.text
    assert accept_resp.json()["status"] == "playing"

    seen_run_ids: set[str] = set()
    lifecycle_stages_seen: list[str] = []
    after_rest_proposal = None
    for _ in range(_MAX_TICKS_TO_AFTER_REST):
        tr = client.post(f"/api/merged-runs/{mid}/tick")
        assert tr.status_code == 200, tr.text
        body = tr.json()
        if body["proposal"]:
            seen_run_ids.add(body["proposal"]["run_id"])
            stage = body["proposal"]["journey_state"]["lifecycle_stage"]
            lifecycle_stages_seen.append(stage)
            if stage == "after_rest_before_restart":
                after_rest_proposal = body["proposal"]
                assert body["correlation"] is not None
                break
        if body["trigger"].get("completed"):
            break

    assert after_rest_proposal is not None, (
        f"expected an after-rest proposal within budget; stages seen: {lifecycle_stages_seen}"
    )
    assert seen_run_ids == {run_id}, "only ONE proposal run must be used throughout the rest journey"
    assert lifecycle_stages_seen == ["during_rest_stopped", "after_rest_before_restart"], (
        lifecycle_stages_seen
    )

    final_log = client.get(f"/api/proposal/runs/{run_id}").json()
    event_types = [e["event_type"] for e in final_log["events"]]
    assert "REST_SPOT_ARRIVED" in event_types
    assert "REST_STARTED" in event_types
    assert "REST_COMPLETED" in event_types
    assert "RECOMPUTED" in event_types
    assert "OPPORTUNITY_OPENED" in event_types
    assert "SERVICE_SELECTED" in event_types

    service_selected_events = [e for e in final_log["events"] if e["event_type"] == "SERVICE_SELECTED"]
    after_rest_selection = service_selected_events[-1]
    assert after_rest_selection["payload"]["selected_service_id"] in _AFTER_REST_SERVICE_IDS

    drowsiness_after_rest = _drowsiness(final_log)
    assert drowsiness_after_rest < drowsiness_at_fire, (
        f"expected recovery: after-rest drowsiness {drowsiness_after_rest} "
        f"should be lower than at-fire drowsiness {drowsiness_at_fire}"
    )


def test_accept_rest_unknown_merged_run_id_404():
    resp = client.post(
        "/api/merged-runs/mrun_does_not_exist/accept-rest",
        json={
            "recovery_option_id": _RECOVERY_OPTION_ID,
            "rest_spot": {"id": "rest_0", "label": {"ja": "x", "en": "x"}, "route_fraction": 0.5},
        },
    )
    assert resp.status_code == 404


def test_accept_rest_invalid_recovery_option_id_422(rest_plan_id, base_world_dict):
    mid, _trigger_run_id = _create_merged_run(rest_plan_id, base_world_dict)
    _tick_until_proposal(mid)

    resp = client.post(
        f"/api/merged-runs/{mid}/accept-rest",
        json={
            "recovery_option_id": "not_a_real_option",
            "rest_spot": {"id": "rest_0", "label": {"ja": "x", "en": "x"}, "route_fraction": 0.9},
        },
    )
    assert resp.status_code == 422, resp.text


def _nap_stage_ticks(scenario, recovery_option_id: str = _RECOVERY_OPTION_ID) -> int:
    option = next(o for o in scenario.recovery_options if o.id == recovery_option_id)
    stage = next(s for s in option.stages if s.phase == "nap" and s.motion == "STOPPED")
    return stage.ticks


def test_accept_rest_nap_override_does_not_leak_to_other_run_sharing_plan_id(
    rest_plan_id, base_world_dict
):
    """CRITICAL fix regression: two merged runs created off the SAME
    ``trigger_plan_id`` (an ordinary, fully-supported workflow -- e.g.
    re-running a scenario with a different run_seed for comparison, exactly
    like a second ``POST /api/run-plans``-backed ``POST /api/runs``) must NOT
    share ScenarioDef state. ``nap_minutes`` supplied to run A's accept-rest
    must never change run B's (untouched) nap_karaoke stage duration -- even
    though ``run_manager.create_run`` stores whatever ScenarioDef is cached
    in ``run_plan._draft_registry[plan_id]`` without copying it, so two runs
    built from the same plan_id start out pointing at the IDENTICAL object.
    """
    mid_a, trigger_run_id_a = _create_merged_run(rest_plan_id, base_world_dict)
    mid_b, trigger_run_id_b = _create_merged_run(rest_plan_id, base_world_dict)

    # Before any override, both runs really do share the same ScenarioDef
    # object (create_run never copies it) -- this is the precondition that
    # makes the in-place mutation dangerous.
    assert run_manager.get_scenario(trigger_run_id_a) is run_manager.get_scenario(trigger_run_id_b)
    assert _nap_stage_ticks(run_manager.get_scenario(trigger_run_id_b)) == 3

    _tick_until_proposal(mid_a)

    spots_resp = client.get(f"/api/runs/{trigger_run_id_a}/rest-spots")
    assert spots_resp.status_code == 200, spots_resp.text
    first_spot = spots_resp.json()["rest_spots"][0]

    accept_resp = client.post(
        f"/api/merged-runs/{mid_a}/accept-rest",
        json={
            "recovery_option_id": _RECOVERY_OPTION_ID,
            "rest_spot": first_spot,
            "nap_minutes": 15,
        },
    )
    assert accept_resp.status_code == 200, accept_resp.text

    scenario_a = run_manager.get_scenario(trigger_run_id_a)
    scenario_b = run_manager.get_scenario(trigger_run_id_b)
    assert scenario_a is not scenario_b, (
        "run A must own an isolated ScenarioDef copy after accept-rest with nap_minutes"
    )
    assert _nap_stage_ticks(scenario_a) == 5, "run A's own override should apply (round(15*60/180)=5)"
    assert _nap_stage_ticks(scenario_b) == 3, (
        "run B (never touched) must keep the scenario-authored default nap duration"
    )


def test_rest_journey_recovers_after_transient_post_completion_failure(
    monkeypatch, rest_plan_id, base_world_dict
):
    """IMPORTANT fix regression: a failure AFTER ``rest_completed`` has
    already succeeded (e.g. a future/edge-case rejection from the
    recompute step) must not permanently brick the merged run's ``/tick``
    endpoint. ``rest_completed``'s own state change (lifecycle_stage ->
    after_rest_before_restart) is already persisted, so a naive retry that
    blindly re-invokes ``rest_completed`` would 422 forever (its
    precondition -- lifecycle_stage == during_rest_stopped -- no longer
    holds). The endpoint must self-heal: re-read the actual current
    proposal state, skip the already-succeeded step, and complete the
    remaining ones on a later tick.
    """
    mid, trigger_run_id = _create_merged_run(rest_plan_id, base_world_dict)
    proposal_at_fire = _tick_until_proposal(mid)
    run_id = proposal_at_fire["run_id"]

    spots_resp = client.get(f"/api/runs/{trigger_run_id}/rest-spots")
    first_spot = spots_resp.json()["rest_spots"][0]
    accept_resp = client.post(
        f"/api/merged-runs/{mid}/accept-rest",
        json={
            "recovery_option_id": _RECOVERY_OPTION_ID,
            "rest_spot": first_spot,
            "nap_minutes": 15,
        },
    )
    assert accept_resp.status_code == 200, accept_resp.text

    import aica_api.routers.merged_runs as merged_runs_module

    real_recompute = merged_runs_module.recompute_proposal_run
    calls = {"n": 0}

    def _flaky_recompute(run_id_arg, body):
        calls["n"] += 1
        if calls["n"] == 1:
            raise HTTPException(status_code=422, detail="simulated transient recompute failure")
        return real_recompute(run_id_arg, body)

    monkeypatch.setattr(merged_runs_module, "recompute_proposal_run", _flaky_recompute)

    hit_failure = False
    for _ in range(_MAX_TICKS_TO_AFTER_REST):
        tr = client.post(f"/api/merged-runs/{mid}/tick")
        assert tr.status_code == 200, tr.text  # never a raw error out of /tick
        body = tr.json()
        if body["trigger"].get("proposal_error"):
            hit_failure = True
            break
        if body["trigger"].get("completed"):
            break
    assert hit_failure, "expected the simulated recompute failure to surface as proposal_error"
    assert calls["n"] == 1

    # rest_completed's own transition must already be persisted (NOT retried
    # -- a retry would 422 since the precondition no longer holds).
    stuck_log = client.get(f"/api/proposal/runs/{run_id}").json()
    assert stuck_log["journey_state"]["lifecycle_stage"] == "after_rest_before_restart"

    # The merged run must recover on a later tick -- NOT permanently bricked.
    after_rest_proposal = None
    for _ in range(_MAX_TICKS_TO_AFTER_REST):
        tr = client.post(f"/api/merged-runs/{mid}/tick")
        assert tr.status_code == 200, tr.text
        body = tr.json()
        if body["proposal"] and body["proposal"]["journey_state"]["lifecycle_stage"] == "after_rest_before_restart":
            after_rest_proposal = body["proposal"]
            break
        if body["trigger"].get("completed"):
            break
    assert after_rest_proposal is not None, "merged run must recover, not be permanently bricked"
    assert calls["n"] == 2

    # The recovered post-rest values must match what was captured at the
    # ORIGINAL rest_completed call, not re-derived from a later (already
    # advanced) tick's simulated signals.
    final_situation = after_rest_proposal["world_snapshot"]["feature_snapshot"]["situation"]
    rest_completed_events = [e for e in stuck_log["events"] if e["event_type"] == "REST_COMPLETED"]
    assert len(rest_completed_events) == 1
    assert final_situation["drowsiness_level"] == rest_completed_events[0]["payload"]["drowsiness_level"]
    assert final_situation["fatigue_level"] == rest_completed_events[0]["payload"]["fatigue_level"]
