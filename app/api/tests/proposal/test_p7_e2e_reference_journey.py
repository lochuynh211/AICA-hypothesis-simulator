"""TDD: P7 Unit C T019-T021 -- the full pre-rest -> rest -> post-rest ->
return-to-driving reference journey, end to end, from ONE built-in seed.

Covers (specs/017-proposal-p7-e2e-vertical-slice/):
  - quickstart.md "End-to-end reference journey (API walk-through)" steps 1-8.
  - spec.md User Story 2 (Acceptance Scenarios 1-3); FR-015, FR-018.
  - spec.md SC-001 (full journey, ordered events) / SC-009 (deterministic
    replay -- reopen renders without recomputation).

Drives the REAL FastAPI TestClient against the REAL transparent packages
(``aica_transparent_service_selector_v1`` / ``aica_transparent_content_selector_v1``)
and the committed ``seed-night-highway-oshi`` seed, in interactive mode
throughout (US2 scope) -- loaded via ``GET /api/proposal/seeds/{seed_id}``,
per the P7 quickstart's own walk-through convention.

One single run crosses TWO opportunities (pre-rest, then the recomputed
after-rest one) and is asserted as one continuous, ordered event timeline.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from aica_api.main import app

client = TestClient(app)

_SEED_ID = "seed-night-highway-oshi"
_REAL_SERVICE_PACKAGE_ID = "aica_transparent_service_selector_v1"
_REAL_CONTENT_PACKAGE_ID = "aica_transparent_content_selector_v1"


@pytest.fixture(autouse=True)
def isolate_proposal_runs_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("AICA_PROPOSAL_RUNS_DIR", str(tmp_path))
    yield


def _load_seed_world() -> dict:
    resp = client.get(f"/api/proposal/seeds/{_SEED_ID}")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["seed_id"] == _SEED_ID
    return body["world"]


def _select_service(run_id: str, selected_service_id: str) -> dict:
    resp = client.post(
        f"/api/proposal/runs/{run_id}/select-service",
        json={"selected_service_id": selected_service_id},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def _journey_action(run_id: str, action_type: str, payload: dict | None = None) -> dict:
    resp = client.post(
        f"/api/proposal/runs/{run_id}/journey/action",
        json={"action_type": action_type, "payload": payload or {}},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def _get_run(run_id: str) -> dict:
    resp = client.get(f"/api/proposal/runs/{run_id}")
    assert resp.status_code == 200, resp.text
    return resp.json()


def _service_evidence(run_log: dict) -> list[dict]:
    return [ev for ev in run_log["evidence"] if ev["step"] == "service"]


def _content_evidence(run_log: dict) -> list[dict]:
    return [ev for ev in run_log["evidence"] if ev["step"] == "content"]


def _event_types(run_log: dict) -> list[str]:
    return [e["event_type"] for e in run_log["events"]]


# ---------------------------------------------------------------------------
# T019/T020/T021 -- the full 8-step reference journey (single test; the
# whole point is that ONE continuous run crosses both opportunities).
# ---------------------------------------------------------------------------


def test_full_reference_journey_from_builtin_seed():
    # -------------------------------------------------------------
    # Step 1: create run (interactive), real service + content packages,
    # the built-in seed's world. Rank-1 must be a driving-content service
    # (the seed is before_rest_until_stop/driving).
    # -------------------------------------------------------------
    world = _load_seed_world()
    assert world["control_inputs"]["trigger_purpose"] == "rest_recommended"
    assert world["control_inputs"]["lifecycle_stage"] == "before_rest_until_stop"
    assert world["control_inputs"]["motion_state"] == "driving"

    create_resp = client.post(
        "/api/proposal/runs",
        json={
            "world": world,
            "service_package_id": _REAL_SERVICE_PACKAGE_ID,
            "content_package_id": _REAL_CONTENT_PACKAGE_ID,
            "mode": "interactive",
            "run_seed": "seed-1",
            "simulation_time": "2026-07-17T10:00:00Z",
        },
    )
    assert create_resp.status_code == 201, create_resp.text
    run = create_resp.json()
    run_id = run["run_id"]
    assert run["status"] == "service_selected"

    pre_rest_opportunity_id = run["opportunity"]["opportunity_id"]
    assert run["opportunity"]["lifecycle_stage"] == "before_rest_until_stop"

    pre_rest_ranked = _service_evidence(run)[0]["output"]["ranked_candidates"]
    assert pre_rest_ranked
    pre_rest_service_id = pre_rest_ranked[0]["candidate_id"]
    # Rank-1 must be a service the driving row actually allows and that is
    # driving-capable (not stopped-only) -- a "driving-content service".
    assert pre_rest_service_id in run["opportunity"]["allowed_service_ids"]
    assert pre_rest_service_id in {
        "music_playlist",
        "humming_karaoke",
        "quiz",
        "ranking_creation",
        "radio_style",
        "call_response_driving",
    }

    # -------------------------------------------------------------
    # Step 2: select-service -> content_selected, a concrete plan grounded
    # in frozen-catalog track IDs.
    # -------------------------------------------------------------
    run = _select_service(run_id, pre_rest_service_id)
    assert run["status"] == "content_selected"
    pre_rest_content_ev = _content_evidence(run)[-1]
    assert pre_rest_content_ev["package_id"] == _REAL_CONTENT_PACKAGE_ID
    assert pre_rest_content_ev["error"] is None
    pre_rest_plan = pre_rest_content_ev["output"]
    assert pre_rest_plan["decision_type"] == "complete_plan"
    assert pre_rest_plan["selected_service_id"] == pre_rest_service_id
    assert pre_rest_plan["ordered_items"]
    for item in pre_rest_plan["ordered_items"]:
        assert item["item_id"].startswith("synthetic-track-")

    # -------------------------------------------------------------
    # Step 3: accept -> content_started; complete -> content_completed
    # (arrival to the rest spot on the drive).
    # -------------------------------------------------------------
    run = _journey_action(run_id, "accept")
    assert run["status"] == "content_started"
    assert run["journey_state"]["playback_state"] == "active"

    run = _journey_action(run_id, "complete")
    assert run["journey_state"]["playback_state"] == "completed"

    # -------------------------------------------------------------
    # Step 4: rest_spot_arrived -> stopped, during_rest_stopped;
    # rest_started.
    # -------------------------------------------------------------
    run = _journey_action(run_id, "rest_spot_arrived")
    assert run["journey_state"]["motion_state"] == "stopped"
    assert run["journey_state"]["lifecycle_stage"] == "during_rest_stopped"

    run = _journey_action(run_id, "rest_started")
    assert run["journey_state"]["lifecycle_stage"] == "during_rest_stopped"

    # -------------------------------------------------------------
    # Step 5: rest_completed with explicit post-rest state ->
    # after_rest_before_restart.
    # -------------------------------------------------------------
    post_rest_drowsiness, post_rest_fatigue = 20, 30
    run = _journey_action(
        run_id,
        "rest_completed",
        {"post_rest": {"drowsiness_level": post_rest_drowsiness, "fatigue_level": post_rest_fatigue}},
    )
    assert run["journey_state"]["lifecycle_stage"] == "after_rest_before_restart"
    assert run["journey_state"]["motion_state"] == "stopped"
    pre_recompute_run = run

    # -------------------------------------------------------------
    # Step 6: recompute the stopped-stage proposal with overrides matching
    # the post-rest values -> new decision point; new head opportunity for
    # the after-rest stage; new frozen snapshot appended to history.
    # -------------------------------------------------------------
    recompute_resp = client.post(
        f"/api/proposal/runs/{run_id}/recompute",
        json={
            "overrides": [
                {"path": "situation.drowsiness_level", "value": post_rest_drowsiness},
                {"path": "situation.fatigue_level", "value": post_rest_fatigue},
            ]
        },
    )
    assert recompute_resp.status_code == 200, recompute_resp.text
    run = recompute_resp.json()
    assert run["status"] == "service_selected"

    after_rest_opportunity = run["opportunity"]
    assert after_rest_opportunity["opportunity_id"] != pre_rest_opportunity_id
    assert after_rest_opportunity["lifecycle_stage"] == "after_rest_before_restart"
    assert set(after_rest_opportunity["allowed_service_ids"]) == {
        "live_viewing",
        "stretch_video",
        "full_karaoke",
        "oshi_reexperience",
        "call_response_stopped",
    }
    assert "full_karaoke" in after_rest_opportunity["allowed_service_ids"]

    # A new frozen snapshot was appended to history (the pre-rest head moved
    # there), and the recompute's own service evidence is genuinely new.
    assert len(run["opportunity_history"]) == 1
    assert run["opportunity_history"][0] == pre_recompute_run["opportunity"]
    assert len(run["setup_snapshot_history"]) == 1

    after_rest_service_ev = _service_evidence(run)[-1]
    assert after_rest_service_ev["error"] is None
    after_rest_ranked = after_rest_service_ev["output"]["ranked_candidates"]
    assert after_rest_ranked
    # The recomputed rank-1 is SOME after-rest service (need not be
    # full_karaoke -- interactive mode lets the reviewer pick full_karaoke
    # explicitly at the next step regardless of rank).
    assert after_rest_ranked[0]["candidate_id"] in after_rest_opportunity["allowed_service_ids"]

    # -------------------------------------------------------------
    # Step 7: select-service full_karaoke (stopped-only; motion is stopped
    # here) -> concrete stopped plan with lighting fields.
    # -------------------------------------------------------------
    run = _select_service(run_id, "full_karaoke")
    assert run["status"] == "content_selected"
    fk_content_ev = _content_evidence(run)[-1]
    assert fk_content_ev["package_id"] == _REAL_CONTENT_PACKAGE_ID
    assert fk_content_ev["error"] is None
    fk_plan = fk_content_ev["output"]
    # A genuinely concrete plan -- NOT the "denied while moving" error-shaped
    # decision (the run really is motion_state=stopped at this point; this
    # is the P7 Unit C seam fix: recompute now also syncs
    # `situation.motion_state` -- not just `control_inputs.motion_state` --
    # onto the effective World it re-projects, so the real content
    # selector's own stopped-motion gate reads the CURRENT motion state
    # instead of the seed's stale "driving").
    assert fk_plan["decision_type"] == "complete_plan"
    assert fk_plan["selected_service_id"] == "full_karaoke"
    assert fk_plan["ordered_items"]
    for item in fk_plan["ordered_items"]:
        assert item["item_id"].startswith("synthetic-track-")
    # full_karaoke is lighting_compatible -- the plan carries lighting fields.
    assert fk_plan["lighting_configuration"] is not None

    # -------------------------------------------------------------
    # Step 8: accept full_karaoke; motion_change -> driving -> full_karaoke
    # is NOT left active as a driving experience.
    # -------------------------------------------------------------
    run = _journey_action(run_id, "accept")
    assert run["status"] == "content_started"
    assert run["journey_state"]["active_service_id"] == "full_karaoke"
    assert run["journey_state"]["playback_state"] == "active"

    run = _journey_action(run_id, "motion_change", {"motion_state": "driving"})
    assert run["journey_state"]["motion_state"] == "driving"
    # The motion policy applied deterministically: full_karaoke is
    # stopped_only (research.md D5 / service_capabilities.v1.json) -- its
    # playback is forced out of "active" the instant motion becomes
    # "driving", so it is never left active as a driving experience
    # (FR-018).
    assert run["journey_state"]["playback_state"] == "stopped"
    motion_changed_event = [e for e in run["events"] if e["event_type"] == "MOTION_CHANGED"][-1]
    assert motion_changed_event["payload"]["active_plan_disposition"] == "stopped"
    assert "full_karaoke" not in motion_changed_event["payload"]["eligible"]

    # Previous-content restoration behavior per the engine (research.md D5 /
    # data-model.md PreviousContent): `motion_change` records the plan's
    # disposition and re-evaluates eligibility -- it does not itself replay
    # a distinct prior driving service (that is `stop`'s job, from P4); the
    # journey_state still carries a well-formed `previous_content` reference
    # rather than losing the field across the recompute + reselect.
    assert run["journey_state"]["previous_content"] is not None

    final_run = run

    # -------------------------------------------------------------
    # Full ordered event timeline across BOTH opportunities.
    # -------------------------------------------------------------
    assert _event_types(final_run) == [
        "OPPORTUNITY_OPENED",
        "SERVICE_SELECTED",
        "CONTENT_SELECTED",
        "CONTENT_STARTED",
        "CONTENT_COMPLETED",
        "REST_SPOT_ARRIVED",
        "REST_STARTED",
        "REST_COMPLETED",
        "OPPORTUNITY_OPENED",
        "CONTEXT_EDITED",
        "OPPORTUNITY_OPENED",
        "RECOMPUTED",
        "SERVICE_SELECTED",
        "CONTENT_SELECTED",
        "CONTENT_STARTED",
        "MOTION_CHANGED",
    ]

    # -------------------------------------------------------------
    # Reopen renders identically without recomputation (SC-009).
    # -------------------------------------------------------------
    reopened = _get_run(run_id)
    assert reopened == final_run
