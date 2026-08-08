"""Integration tests for the merged-runs proposal-side reject flow and its
Bug 1 companion (fixbug-0806).

Three bugs, one root: the Combined screen never told the backend the driver
had actually TAKEN the content (``journey_action: accept``) — it only ever
selected a service (``select_service``). That meant:

  * Bug 1 — ``_derive_content_context`` (routers/merged_runs.py) only derives
    a content episode while ``journey_state.playback_state`` is ``active``/
    ``backgrounded``, and ``playback_state`` only becomes ``active`` via
    ``accept``. With no ``accept`` ever sent, content relief never reached
    the tick engine live, even though the driver "took" the content.
  * Bugs 2/3 — the OLD code acknowledged the TRIGGER's pending proposal at
    ``select_service`` time (to rebaseline the Hybrid's monotony
    accumulator). That consumed the trigger's pending proposal before the
    driver had even seen the content, so a later reject had nothing left to
    decline via the trigger-side ``decline`` action (422:
    ``invalid_precondition`` / "No pending proposal"). The fix moves the
    acknowledge to fire on ``accept`` instead, and gives reject its OWN
    proposal-side endpoint (``reject-proposal``) that never depends on the
    trigger's pending-proposal precondition at all.

Reuses the SAME trigger fixture pairing as ``test_merged_runs_router.py`` /
``test_merged_rest_journey.py`` (``nri_fatigue_score_v1`` x
``uc01_fatigue_recovery_v0_1`` — this pairing fires BOTH REST_PROPOSAL and
MONOTONY_PROPOSAL) and the mock service/content selector packages.
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

_TRIGGER_PACKAGE_ID = "nri_fatigue_score_v1"
_TRIGGER_SCENARIO_ID = "uc01_fatigue_recovery_v0_1"
_SEED_ID = "seed-night-highway-oshi"
_SERVICE_PACKAGE_ID = "mock_service_selector_v1"
_CONTENT_PACKAGE_ID = "mock_content_selector_v1"
_RECOVERY_OPTION_ID = "nap_karaoke"
_MAX_TICKS = 400
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


def _tick_until_proposal(mid: str, result_type: str | None = None) -> dict | None:
    """Tick until a proposal run is spawned; with `result_type`, until one is
    spawned by a fire of THAT kind. Mirrors `test_merged_runs_router.py`'s
    helper of the same name — this trigger pairing fires BOTH categories, so
    a test that means "the rest fire" (or "the monotony fire") must say so."""
    proposal = None
    for _ in range(_MAX_TICKS):
        tr = client.post(f"/api/merged-runs/{mid}/tick")
        assert tr.status_code == 200, tr.text
        body = tr.json()
        decision = body["trigger"].get("decision")
        matches = result_type is None or (decision or {}).get("result_type") == result_type
        if body["proposal"] and matches:
            proposal = body["proposal"]
            break
        if body["trigger"].get("completed"):
            break
    return proposal


def _ranked_service_id(proposal: dict) -> str:
    ranked = [
        ev["output"]["ranked_candidates"] for ev in proposal["evidence"] if ev["step"] == "service"
    ]
    assert ranked and ranked[0], "setup: the proposal must rank a service"
    return ranked[0][0]["candidate_id"]


def _select_service(mid: str, selected_service_id: str) -> dict:
    resp = client.post(
        f"/api/merged-runs/{mid}/proposal-action",
        json={"kind": "select_service", "selected_service_id": selected_service_id},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def _accept_content(mid: str) -> dict:
    resp = client.post(
        f"/api/merged-runs/{mid}/proposal-action",
        json={"kind": "journey_action", "action_type": "accept"},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def _accept_rest(mid: str, trigger_run_id: str, nap_minutes: int = 15) -> dict:
    spots_resp = client.get(f"/api/runs/{trigger_run_id}/rest-spots")
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


def _trigger_actions(trigger_run_id: str) -> list[str]:
    log = client.get(f"/api/runs/{trigger_run_id}/log").json()
    return [e["action"] for e in log["events"] if e["kind"] == "action"]


# ---------------------------------------------------------------------------
# 1. reject-proposal at the pre-rest SERVICE step, AFTER accept-rest already
#    consumed the trigger's pending proposal (this exact sequence 422'd via
#    the old `/decline` endpoint — "No pending proposal for run ...
#    (status=playing, pending=None)"). declined must be False (nothing left
#    for the best-effort trigger decline to actually decline), and the rest
#    journey must still auto-drive to completion — rejecting the SERVICE
#    must not touch the trigger-side recovery state machine at all.
# ---------------------------------------------------------------------------


def test_reject_at_pre_rest_service_step_after_accept_rest(rest_plan_id, base_world_dict):
    mid, trigger_run_id = _create_merged_run(rest_plan_id, base_world_dict)
    proposal = _tick_until_proposal(mid, result_type="REST_PROPOSAL")
    assert proposal is not None, "setup: expected a REST fire"
    run_id = proposal["run_id"]
    service_id = _ranked_service_id(proposal)

    _accept_rest(mid, trigger_run_id)
    handle = get_handle(mid, settings.merged_runs_dir)
    assert handle.current_proposal_run_id == run_id

    selected = _select_service(mid, service_id)
    assert selected["status"] == "content_selected"

    r = client.post(f"/api/merged-runs/{mid}/reject-proposal")
    assert r.status_code == 200, r.text
    body = r.json()

    assert body["declined"] is False
    event_types = [e["event_type"] for e in body["proposal"]["events"]]
    assert "SERVICE_REJECTED" in event_types
    assert body["proposal"]["journey_state"]["active_service_id"] is None

    # The SAME proposal run stays current — re-arming here would orphan the
    # in-flight rest journey the tick loop is auto-driving (keyed off
    # current_proposal_run_id + rest_stage_synced).
    handle_after = get_handle(mid, settings.merged_runs_dir)
    assert handle_after.current_proposal_run_id == run_id
    assert handle_after.rest_stage_synced == "before"

    # The journey still auto-drives to the after-rest proposal despite the
    # rejected pre-rest service.
    reached_after_rest = False
    for _ in range(_MAX_TICKS_TO_AFTER_REST):
        tr = client.post(f"/api/merged-runs/{mid}/tick")
        assert tr.status_code == 200, tr.text
        tick_body = tr.json()
        if (
            tick_body["proposal"]
            and tick_body["proposal"]["journey_state"]["lifecycle_stage"] == "after_rest_before_restart"
        ):
            reached_after_rest = True
            break
        if tick_body["trigger"].get("completed"):
            break
    assert reached_after_rest, "expected the rest journey to still auto-drive to after_rest_before_restart"


def test_reject_proposal_unknown_merged_run_id_404():
    r = client.post("/api/merged-runs/mrun_does_not_exist/reject-proposal")
    assert r.status_code == 404


def test_reject_proposal_404_before_any_fire(rest_plan_id, base_world_dict):
    mid, _trigger_run_id = _create_merged_run(rest_plan_id, base_world_dict)
    r = client.post(f"/api/merged-runs/{mid}/reject-proposal")
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# 2. reject-proposal at the MONOTONY content step, straight after
#    select_service (no accept yet — B2 means select_service alone no
#    longer acknowledges the trigger). The trigger run is STILL paused on
#    the pending proposal here, so the best-effort trigger decline actually
#    runs: declined must be True and the fire guard re-armed.
# ---------------------------------------------------------------------------


def test_reject_at_monotony_content_step_rearms_fire_guard(rest_plan_id, base_world_dict):
    mid, _trigger_run_id = _create_merged_run(rest_plan_id, base_world_dict)
    proposal = _tick_until_proposal(mid, result_type="MONOTONY_PROPOSAL")
    assert proposal is not None, "setup: expected a MONOTONY fire"
    service_id = _ranked_service_id(proposal)

    _select_service(mid, service_id)

    r = client.post(f"/api/merged-runs/{mid}/reject-proposal")
    assert r.status_code == 200, r.text
    body = r.json()

    assert body["declined"] is True
    event_types = [e["event_type"] for e in body["proposal"]["events"]]
    assert "SERVICE_REJECTED" in event_types

    handle_after = get_handle(mid, settings.merged_runs_dir)
    assert handle_after.current_proposal_run_id is None
    assert handle_after.current_proposal_category is None


# ---------------------------------------------------------------------------
# 4. Regression test for Bug 1: accepting the pre-rest content
#    (`journey_action: accept`) after select_service makes `content_active`
#    True on the following MOVING ticks, with drowsiness strictly decreasing
#    across them. Without the fix, `content_active` is False on every tick
#    and drowsiness never gets relief from the accepted content.
# ---------------------------------------------------------------------------


def test_accepting_pre_rest_content_relieves_drowsiness_while_driving_to_the_spot(
    rest_plan_id, base_world_dict
):
    mid, trigger_run_id = _create_merged_run(rest_plan_id, base_world_dict)
    proposal = _tick_until_proposal(mid, result_type="REST_PROPOSAL")
    assert proposal is not None, "setup: expected a REST fire"
    service_id = _ranked_service_id(proposal)

    _accept_rest(mid, trigger_run_id)
    _select_service(mid, service_id)
    _accept_content(mid)

    drowsiness_values: list[float] = []
    for _ in range(6):
        tr = client.post(f"/api/merged-runs/{mid}/tick")
        assert tr.status_code == 200, tr.text
        trigger = tr.json()["trigger"]
        assert trigger.get("error") is None, trigger
        if trigger.get("motion_state") != "MOVING":
            # Arrived at the spot — the pre-rest drive under test is over.
            break
        assert trigger["content_active"] is True, trigger
        assert trigger["drowsiness"] is not None
        drowsiness_values.append(trigger["drowsiness"])

    assert len(drowsiness_values) >= 3, (
        f"expected several MOVING ticks to observe relief; got {drowsiness_values}"
    )
    assert all(b < a for a, b in zip(drowsiness_values, drowsiness_values[1:])), (
        f"expected strictly decreasing drowsiness under content relief; got {drowsiness_values}"
    )


# ---------------------------------------------------------------------------
# 5. The trigger-side acknowledge now fires on `accept`, not on
#    `select_service`, for a monotony_prevention proposal (B2). Direct
#    companion to test_merged_runs_router.py's equivalent pair of tests —
#    kept here too since it is the precondition this whole file's reject
#    flow depends on (an acknowledge at select_service time is what made
#    Bug 3's reject impossible in the first place).
# ---------------------------------------------------------------------------


def test_monotony_acknowledge_fires_on_accept_not_select_service(rest_plan_id, base_world_dict):
    mid, trigger_run_id = _create_merged_run(rest_plan_id, base_world_dict)
    proposal = _tick_until_proposal(mid, result_type="MONOTONY_PROPOSAL")
    assert proposal is not None, "setup: expected a MONOTONY fire"
    service_id = _ranked_service_id(proposal)

    before = _trigger_actions(trigger_run_id)
    _select_service(mid, service_id)
    assert _trigger_actions(trigger_run_id) == before, "select_service must not yet acknowledge the trigger"

    _accept_content(mid)
    after = _trigger_actions(trigger_run_id)
    assert len(after) == len(before) + 1, f"expected one new trigger action; {before} -> {after}"
    assert after[-1] == "acknowledge"
