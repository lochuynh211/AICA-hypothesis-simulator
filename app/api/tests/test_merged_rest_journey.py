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
        json={
            "package_id": _TRIGGER_PACKAGE_ID,
            "scenario_id": _TRIGGER_SCENARIO_ID,
            # These are rest-JOURNEY mechanics tests (before/during/after-rest
            # lifecycle, decline cooldown, content relief) — orthogonal to the
            # rest-after-monotony spacing rule, which owns its own coverage in
            # test_rest_min_gap_guard.py / test_forecast_parity.py. NRI's manifest
            # now defaults `rest_min_gap_after_monotony_min` to 20, and on this
            # scenario that delays the first REST fire ~12 min past the point where
            # the sole rest spot is still ahead of the vehicle — so the rest never
            # surfaces actionably where these tests expect it. Disabling the gap
            # (0 = off) restores the exact pre-feature timing these tests were
            # authored against, mirroring test_forecast_parity's own override.
            "hyperparameters": {"rest_min_gap_after_monotony_min": 0.0},
        },
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
    """Tick until a proposal run is spawned by a REST fire.

    Both trigger packages fire two categories now — NRI bands its single score
    with a lower monotony threshold, so a run reaches MONOTONY_PROPOSAL before
    REST_PROPOSAL. Every test in this file is about the REST journey
    (accept-rest, before_rest_until_stop, recovery), so it must wait for the
    rest fire rather than take whatever fires first.
    """
    for _ in range(_MAX_TICKS_TO_FIRE):
        tr = client.post(f"/api/merged-runs/{mid}/tick")
        assert tr.status_code == 200, tr.text
        body = tr.json()
        decision = body["trigger"].get("decision")
        is_rest_fire = (decision or {}).get("result_type") == "REST_PROPOSAL"
        if body["proposal"] and is_rest_fire:
            return body["proposal"]
        assert not body["trigger"].get("completed"), "run completed before a REST fire"
    pytest.fail("no REST fire within budget")


def _drowsiness(proposal: dict) -> int:
    return proposal["world_snapshot"]["feature_snapshot"]["situation"]["drowsiness_level"]


# ── Task 9 helpers: real content episodes derived from playback_state ──────


def _run_until_rest_fire(rest_plan_id: str, base_world_dict: dict) -> str:
    """Create a merged run and tick until a REST fire spawns a proposal run;
    returns the merged_run_id."""
    mid, _trigger_run_id = _create_merged_run(rest_plan_id, base_world_dict)
    _tick_until_proposal(mid)
    return mid


def _choose_service(mid: str, selected_service_id: str) -> dict:
    """Select a service for the run's current proposal AND accept it, so the
    proposal's journey_state.playback_state becomes 'active' — select_service
    alone only reaches 'content_selected'; accepting is what actually starts
    the content episode `_derive_content_context` reads."""
    resp = client.post(
        f"/api/merged-runs/{mid}/proposal-action",
        json={"kind": "select_service", "selected_service_id": selected_service_id},
    )
    assert resp.status_code == 200, resp.text
    accept_resp = client.post(
        f"/api/merged-runs/{mid}/proposal-action",
        json={"kind": "journey_action", "action_type": "accept"},
    )
    assert accept_resp.status_code == 200, accept_resp.text
    return accept_resp.json()


def _accept_rest(mid: str, nap_minutes: int = 15) -> dict:
    """Fetch the paired trigger run's rest spots and accept the first one —
    same sequence ``test_full_rest_journey_before_during_after_one_proposal_run``
    exercises inline, extracted for reuse by the content-episode tests."""
    from aica_api.services.merged_run_coordinator import get_handle

    handle = get_handle(mid, settings.merged_runs_dir)
    assert handle is not None
    spots_resp = client.get(f"/api/runs/{handle.trigger_run_id}/rest-spots")
    assert spots_resp.status_code == 200, spots_resp.text
    spots = spots_resp.json()["rest_spots"]
    assert spots, "expected at least one rest spot ahead"
    accept_resp = client.post(
        f"/api/merged-runs/{mid}/accept-rest",
        json={
            "recovery_option_id": _RECOVERY_OPTION_ID,
            "rest_spot": spots[0],
            "nap_minutes": nap_minutes,
        },
    )
    assert accept_resp.status_code == 200, accept_resp.text
    return accept_resp.json()


def _tick_until_event(mid: str, event_type: str, max_ticks: int = _MAX_TICKS_TO_AFTER_REST) -> dict:
    """Tick until the merged run's CURRENT proposal has recorded `event_type`
    among its events; returns the proposal log dict from that tick's response."""
    for _ in range(max_ticks):
        tr = client.post(f"/api/merged-runs/{mid}/tick")
        assert tr.status_code == 200, tr.text
        body = tr.json()
        proposal = body.get("proposal")
        if proposal:
            event_types = [e["event_type"] for e in proposal["events"]]
            if event_type in event_types:
                return proposal
        if body["trigger"].get("completed"):
            break
    pytest.fail(f"{event_type!r} not observed within {max_ticks} ticks")


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
                # Slice-2 fix: the response must be paused on THIS tick so
                # the frontend auto-drive loop (which halts only on
                # `trigger.paused || trigger.completed`) stops here and
                # surfaces the after-rest proposal, instead of ticking past
                # it before the reviewer/user ever sees it.
                assert body["trigger"]["paused"] is True, (
                    "after-rest tick response must be paused so Play halts on it"
                )
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


# ── Decline (reject) — owner-review on-map rest overlay's "reject" button ──────


def test_decline_resumes_ticking_and_rearms_the_fire_guard(rest_plan_id, base_world_dict):
    """POST /api/merged-runs/{id}/decline clears the pending REST proposal and
    keeps the run tickable (no recovery started), and resets
    handle.current_proposal_run_id so a later re-fire spawns a fresh proposal.
    """
    from aica_api.config import settings
    from aica_api.services.merged_run_coordinator import get_handle

    mid, trigger_run_id = _create_merged_run(rest_plan_id, base_world_dict)
    _tick_until_proposal(mid)

    # After the fire, the run is paused and a proposal run is recorded.
    handle = get_handle(mid, settings.merged_runs_dir)
    assert handle.current_proposal_run_id is not None

    r = client.post(f"/api/merged-runs/{mid}/decline")
    assert r.status_code == 200, r.text
    run_state = r.json()
    # Declining returns the run to a playing state with no pending proposal.
    assert run_state["status"] == "playing"
    assert run_state.get("pending_proposal") is None

    # The fire guard is re-armed so a later re-fire is NOT swallowed.
    handle_after = get_handle(mid, settings.merged_runs_dir)
    assert handle_after.current_proposal_run_id is None

    # And the run keeps ticking (does not 500 / stay stuck).
    tr = client.post(f"/api/merged-runs/{mid}/tick")
    assert tr.status_code == 200, tr.text


def test_decline_unknown_merged_run_id_404():
    r = client.post("/api/merged-runs/mrun_does_not_exist/decline")
    assert r.status_code == 404


def _last_tick_elapsed_seconds(trigger_run_id: str) -> float:
    """The ``elapsed_seconds`` of the most recently ticked TickEvent on the
    paired TRIGGER run — same sim-time convention ``_derive_response_
    suppression`` uses internally, read back through the log endpoint so
    this test never has to guess at tick_seconds*tick_index math.
    """
    log = client.get(f"/api/runs/{trigger_run_id}/log").json()
    tick_events = [e for e in log["events"] if e["kind"] == "tick"]
    return float(tick_events[-1]["tick_state"]["elapsed_seconds"])


def test_declined_rest_proposal_does_not_respawn_within_cooldown(rest_plan_id, base_world_dict):
    """Regression (fixbug-0804 merged/live-mode Bug 2): declining a REST
    proposal on the Combined Simulator screen must not make the rest-spot
    overlay reappear on the very next tick, nor keep respawning a fresh
    proposal (a later one carrying a stale/old rest spot) for the rest of
    the 30-minute post-decline cooldown.

    Root cause: the merged tick endpoint used to spawn a fresh proposal run
    keyed on the RAW ``fire_control.fired`` flag, which stays True even
    once ``_derive_response_suppression``'s 30-minute post-response
    de-duplication has decided this fire must NOT re-pause the run.
    ``/decline`` re-arms ``handle.current_proposal_run_id = None``, so the
    still-``fired`` (but suppressed) proposal re-spawned a brand-new
    proposal run on every tick until the cooldown lapsed. The fix gates the
    spawn on ``outcome.paused`` (post-suppression) instead of raw ``fired``.
    """
    from aica_api.services.merged_run_coordinator import get_handle

    mid, trigger_run_id = _create_merged_run(rest_plan_id, base_world_dict)

    first_proposal = _tick_until_proposal(mid)
    first_run_id = first_proposal["run_id"]

    handle = get_handle(mid, settings.merged_runs_dir)
    assert handle.current_proposal_run_id == first_run_id

    decline_sim_sec = _last_tick_elapsed_seconds(trigger_run_id)

    r = client.post(f"/api/merged-runs/{mid}/decline")
    assert r.status_code == 200, r.text

    # Existing behavior: the fire guard is re-armed immediately.
    handle_after_decline = get_handle(mid, settings.merged_runs_dir)
    assert handle_after_decline.current_proposal_run_id is None

    # New behavior under test: while still inside the 30-minute post-decline
    # cooldown, every tick where the TRIGGER reports a REST_PROPOSAL fire
    # (fire_control.fired stays True — declining never resets the raw flag,
    # only `outcome.paused` changes once `_derive_response_suppression`
    # kicks in) must NOT come with a spawned proposal. A different category
    # (e.g. monotony_prevention) firing and spawning its OWN proposal run
    # during this window is unrelated/legitimate (a different fire guard
    # clause) and must not fail this assertion — only a same-category REST
    # respawn is the bug (2a/2b).
    saw_rest_refire_in_cooldown = False
    for _ in range(_MAX_TICKS_TO_FIRE):
        body = client.post(f"/api/merged-runs/{mid}/tick").json()
        elapsed = _last_tick_elapsed_seconds(trigger_run_id)
        if elapsed - decline_sim_sec >= 1800.0:
            break  # left the cooldown window — stop before the positive case
        decision = body["trigger"].get("decision")
        rest_refired = bool(
            decision
            and decision["fire_control"]["fired"]
            and decision.get("result_type") == "REST_PROPOSAL"
        )
        if rest_refired:
            saw_rest_refire_in_cooldown = True
            assert body["proposal"] is None, (
                "a REST_PROPOSAL fire suppressed by the 30-minute post-decline "
                "cooldown must not spawn/replace the proposal run — this is "
                "exactly the stale-overlay/stale-rest-spot regression (2a/2b)"
            )
        if body["trigger"].get("completed"):
            break

    assert saw_rest_refire_in_cooldown, (
        "setup: expected the trigger to keep reporting REST_PROPOSAL fires "
        "during the cooldown window (fatigue does not improve without an "
        "accepted rest) — otherwise this test never exercises the guard"
    )

    # Positive-path coverage for "a genuine re-fire must still spawn a fresh
    # proposal run" (i.e. the fix must not over-suppress forever) already
    # exists elsewhere and is not duplicated here:
    #   - test_second_rest_trigger_spawns_a_fresh_proposal_run (this file) —
    #     accept-rest path, current_proposal_run_id is None again after
    #     `rest_stage_synced == "after"`.
    #   - test_a_rest_fire_after_a_monotony_fire_gets_its_own_proposal_run
    #     (test_merged_runs_router.py) — category-change path.
    # A genuine decline-then-recover-then-refire positive case is not
    # reachable on this fixture: `uc01_fatigue_recovery_v0_1` has a fixed
    # `total_duration_seconds` (7200s / 40 ticks), and — unlike accept_rest,
    # which pauses the tick engine's completion clock for the whole
    # recovery — decline does not extend elapsed time, so there are too few
    # ticks left after the 30-minute cooldown lapses for fatigue to climb
    # into a second genuine REST fire before route completion.


def test_second_rest_trigger_spawns_a_fresh_proposal_run(rest_plan_id, base_world_dict):
    """After an accepted rest journey COMPLETES, a genuine SECOND rest trigger
    later in the same run must spawn a NEW proposal run — not be silently
    swallowed by the once-per-run fire guard (owner review issue 3). This is the
    accept-path analogue of ``test_decline_resumes_ticking_and_rearms_the_fire_guard``.
    """
    mid, trigger_run_id = _create_merged_run(rest_plan_id, base_world_dict)

    # First fire → accept a rest.
    first = _tick_until_proposal(mid)
    first_run_id = first["run_id"]
    spots = client.get(f"/api/runs/{trigger_run_id}/rest-spots").json()["rest_spots"]
    assert spots
    accept_resp = client.post(
        f"/api/merged-runs/{mid}/accept-rest",
        json={"recovery_option_id": _RECOVERY_OPTION_ID, "rest_spot": spots[0], "nap_minutes": None},
    )
    assert accept_resp.status_code == 200, accept_resp.text

    # Drive through the journey until the after-rest recompute pauses the run.
    saw_after_rest = False
    for _ in range(_MAX_TICKS_TO_AFTER_REST):
        body = client.post(f"/api/merged-runs/{mid}/tick").json()
        if body["proposal"] and body["proposal"]["journey_state"]["lifecycle_stage"] == "after_rest_before_restart":
            saw_after_rest = True
            break
        if body["trigger"].get("completed"):
            break
    assert saw_after_rest, "expected to reach the after-rest proposal"

    # Keep ticking (resume) — a SECOND rest fire must eventually spawn a fresh
    # proposal run (different run_id) before the route completes.
    second_run_id = None
    for _ in range(_MAX_TICKS_TO_FIRE):
        body = client.post(f"/api/merged-runs/{mid}/tick").json()
        if body["proposal"] and body["proposal"]["run_id"] != first_run_id:
            second_run_id = body["proposal"]["run_id"]
            break
        if body["trigger"].get("completed"):
            break

    assert second_run_id is not None, (
        "a SECOND rest trigger after a completed journey must spawn a NEW proposal run "
        "(the re-fire guard must be re-armed once rest_stage_synced == 'after')"
    )
    assert second_run_id != first_run_id


# ── Task 9: real content episodes derived from playback_state ──────────────


def test_pre_rest_content_is_torn_down_at_arrival_not_after_the_nap(
    monkeypatch, rest_plan_id, base_world_dict
):
    """CDC-SU slide 46 ⑤ 選択コンテンツを開始し、休憩所に到着したら終了.

    `_committed_plan_duration_sec` is monkeypatched to always return None,
    disabling the natural episode-duration expiry (Task 9 content-episode
    lifetime block) — this isolates the ARRIVAL teardown specifically.
    Without that isolation, humming_karaoke's own real `expected_duration_sec`
    (plan_item_count(5) * fixed_humming_segment_sec(30) = 150s) is short
    enough that it would naturally expire within a tick or two anyway (this
    scenario's tick_seconds=180) — which would make this test pass even if
    the arrival-teardown code were deleted, a false negative for exactly the
    regression it exists to catch.
    """
    import aica_api.routers.merged_runs as merged_runs_module

    monkeypatch.setattr(merged_runs_module, "_committed_plan_duration_sec", lambda plog: None)

    mid = _run_until_rest_fire(rest_plan_id, base_world_dict)
    choose_result = _choose_service(mid, "humming_karaoke")
    assert choose_result["journey_state"]["playback_state"] == "active", choose_result
    _accept_rest(mid)

    # `_tick_until_event` returns the proposal snapshot from the SAME tick
    # response where REST_SPOT_ARRIVED first appears — the router's "before"
    # branch appends REST_SPOT_ARRIVED/REST_STARTED and (Task 9) the
    # complete/stop teardown in that exact order within ONE tick, so `plog`
    # here is that arrival tick's FINAL state, not some later tick's. The
    # REST_STARTED assertion below pins down that this really is the arrival
    # tick (not an earlier tick that happened to already carry a stale
    # REST_SPOT_ARRIVED from a partially-failed retry).
    plog = _tick_until_event(mid, "REST_SPOT_ARRIVED")
    event_types = [e["event_type"] for e in plog["events"]]
    assert "REST_STARTED" in event_types, event_types
    assert plog["journey_state"]["playback_state"] in ("completed", "stopped"), plog["journey_state"]


def test_exposure_keeps_accruing_while_driving_to_the_rest_spot(rest_plan_id, base_world_dict):
    mid = _run_until_rest_fire(rest_plan_id, base_world_dict)
    _accept_rest(mid)

    first = client.post(f"/api/merged-runs/{mid}/tick").json()
    second = client.post(f"/api/merged-runs/{mid}/tick").json()
    assert first["trigger"].get("error") is None, first["trigger"]
    assert second["trigger"].get("error") is None, second["trigger"]

    a = first["trigger"]["continuous_driving_min"]
    b = second["trigger"]["continuous_driving_min"]
    assert b > a
