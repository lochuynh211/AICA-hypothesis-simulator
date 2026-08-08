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
from aica_api.services.merged_run_coordinator import get_handle
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


def _trigger_actions(trigger_run_id: str) -> list[str]:
    """The action events recorded on the paired TRIGGER run, in order."""
    log = client.get(f"/api/runs/{trigger_run_id}/log").json()
    return [e["action"] for e in log["events"] if e["kind"] == "action"]


def _tick_until_proposal(mid: str, result_type: str | None = None) -> dict | None:
    """Tick until a proposal run is spawned; with `result_type`, until one is
    spawned by a fire of THAT kind.

    The filter exists because the trigger packages fire two categories now: NRI
    bands its single score with a lower monotony threshold, so a run reaches
    MONOTONY_PROPOSAL before REST_PROPOSAL. A test that means "the rest fire"
    must say so rather than take whatever fires first.
    """
    proposal = None
    for _ in range(_MAX_TICKS):
        tr = client.post(f"/api/merged-runs/{mid}/tick")
        assert tr.status_code == 200, tr.text
        body = tr.json()
        decision = body["trigger"].get("decision")
        matches = result_type is None or (decision or {}).get("result_type") == result_type
        if body["proposal"] and matches:
            proposal = body["proposal"]
            assert body["correlation"]["trigger_tick_index"] >= 0
            break
        if body["trigger"].get("completed"):
            break
    return proposal


def test_create_then_tick_until_rest_fire_creates_proposal(rest_plan_id, base_world_dict):
    mid = _create_merged_run(rest_plan_id, base_world_dict)

    proposal = _tick_until_proposal(mid, result_type="REST_PROPOSAL")

    assert proposal is not None
    assert proposal["opportunity"]["trigger_purpose"] == "rest_recommended"
    assert proposal["opportunity"]["lifecycle_stage"] == "before_rest_until_stop"
    assert len(proposal["evidence"]) >= 1  # a service evaluate() ran => eligibility+ranking happened


def test_tick_carries_the_driver_state_signals_the_live_chart_plots(rest_plan_id, base_world_dict):
    """A tick must report drowsiness / fatigue / monotony_level.

    These are the SAME three quantities the projection's ``signal_series``
    carries (``services/preview.py``); the Combined screen's live chart is
    drawn from them, so without them on the tick response the live chart has
    no driver-state band at all. They come from the evaluated ``TickState``
    (``signals.simulated`` / ``signals.dynamic.monotonyLevel``), not from a
    frontend estimate — a driver's state is run evidence.
    """
    mid = _create_merged_run(rest_plan_id, base_world_dict)

    first = client.post(f"/api/merged-runs/{mid}/tick").json()["trigger"]
    for key in ("drowsiness", "fatigue", "monotony_level"):
        assert isinstance(first[key], (int, float)), (key, first)
        assert 0.0 <= first[key] <= 100.0, (key, first)

    # …and they TRACK the run: this scenario's drowsiness grows while driving,
    # so a later tick must not report the same starting value forever.
    later = first
    for _ in range(30):
        later = client.post(f"/api/merged-runs/{mid}/tick").json()["trigger"]
    assert later["drowsiness"] > first["drowsiness"], (first, later)


def test_proposal_action_select_service(rest_plan_id, base_world_dict):
    mid = _create_merged_run(rest_plan_id, base_world_dict)
    proposal = _tick_until_proposal(mid, result_type="REST_PROPOSAL")
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


def test_proposal_action_invalid_selected_service_id_422(rest_plan_id, base_world_dict):
    """Review fix: an unknown ``selected_service_id`` must surface as a 422
    (SelectServiceBody's enum-typed field rejects it), not an unhandled 500.
    """
    mid = _create_merged_run(rest_plan_id, base_world_dict)
    proposal = _tick_until_proposal(mid, result_type="REST_PROPOSAL")
    assert proposal is not None

    resp = client.post(
        f"/api/merged-runs/{mid}/proposal-action",
        json={"kind": "select_service", "selected_service_id": "not_a_real_service"},
    )
    assert resp.status_code == 422, resp.text


def test_proposal_action_invalid_action_type_422(rest_plan_id, base_world_dict):
    """Review fix: an unknown ``action_type`` must surface as a 422
    (JourneyAction's enum-typed field rejects it), not an unhandled 500.
    """
    mid = _create_merged_run(rest_plan_id, base_world_dict)
    proposal = _tick_until_proposal(mid, result_type="REST_PROPOSAL")
    assert proposal is not None

    resp = client.post(
        f"/api/merged-runs/{mid}/proposal-action",
        json={"kind": "journey_action", "action_type": "not_a_real_action"},
    )
    assert resp.status_code == 422, resp.text


def test_tick_with_invalid_proposal_mode_422_not_500(rest_plan_id, base_world_dict):
    """Review fix: `CreateMergedRunBody.proposal_mode` is an unconstrained
    ``str`` (no ``Literal``/enum), so ``POST /api/merged-runs`` accepts any
    string and returns 201. When the trigger later fires, the tick endpoint
    manually constructs ``CreateProposalRunBody(..., mode=handle.proposal_mode,
    ...)`` — an enum-typed field — which must surface as a structured 422,
    not an unhandled 500 (ValidationError propagating out of the endpoint).
    """
    r = client.post(
        "/api/merged-runs",
        json={
            "trigger_plan_id": rest_plan_id,
            "world": base_world_dict,
            "service_package_id": _SERVICE_PACKAGE_ID,
            "content_package_id": _CONTENT_PACKAGE_ID,
            "proposal_mode": "not_a_real_mode",
            "run_seed": "7",
        },
    )
    assert r.status_code == 201, r.text
    mid = r.json()["merged_run_id"]

    saw_422 = False
    for _ in range(_MAX_TICKS):
        tr = client.post(f"/api/merged-runs/{mid}/tick")
        if tr.status_code == 422:
            saw_422 = True
            break
        assert tr.status_code == 200, tr.text
        body = tr.json()
        if body["proposal"]:
            pytest.fail("proposal run must not be created with an invalid proposal_mode")
        if body["trigger"].get("completed"):
            break
    assert saw_422, "expected a 422 on the fire tick, not a 500 or silent success"


# ---------------------------------------------------------------------------
# A fire of a DIFFERENT category gets its own proposal run.
# ---------------------------------------------------------------------------
#
# The once-per-fire guard keyed only on `current_proposal_run_id`, so the FIRST
# fire of a run latched it until an accept-rest journey completed or a decline
# re-armed it. That was invisible while a trigger package only ever fired one
# category. Both packages now fire two: NRI bands its single score with a lower
# monotony threshold, so a run reaches monotony first and escalates to rest
# afterwards — and that rest proposal, the consequential one, was being dropped
# with no service/content attached to it.


def test_a_rest_fire_after_a_monotony_fire_gets_its_own_proposal_run(rest_plan_id, base_world_dict):
    mid = _create_merged_run(rest_plan_id, base_world_dict)

    seen: list[tuple[str, bool]] = []
    for _ in range(_MAX_TICKS):
        body = client.post(f"/api/merged-runs/{mid}/tick").json()
        decision = body["trigger"].get("decision")
        if decision and decision["fire_control"]["fired"] and decision.get("proposal"):
            seen.append((decision["result_type"], body.get("proposal") is not None))
            if decision["result_type"] == "REST_PROPOSAL":
                break
        if body["trigger"].get("completed"):
            break

    assert seen, "no fire within budget"
    monotony = [s for s in seen if s[0] == "MONOTONY_PROPOSAL"]
    rest = [s for s in seen if s[0] == "REST_PROPOSAL"]
    assert monotony, "setup: NRI's lower band should fire before the rest band"
    assert rest, "setup: the score should go on to cross the rest threshold"

    # The FIRST fire of each category spawns a proposal run…
    assert monotony[0][1] is True, "the first monotony fire must spawn a proposal run"
    assert rest[0][1] is True, (
        "a REST fire following a monotony fire must spawn its OWN proposal run — "
        "it was being swallowed by the once-per-fire guard"
    )
    # …and repeats within the SAME category still do not (that guard is the point).
    assert all(created is False for _, created in monotony[1:])


# ---------------------------------------------------------------------------
# Taking up a monotony proposal is recorded on the TRIGGER run.
# ---------------------------------------------------------------------------
#
# Picking a service for a monotony opportunity is the driver accepting the
# content. Until this was recorded, the trigger side never learned that the
# proposal had been answered, so the Hybrid could not rebaseline its monotony
# accumulator: the score climbed for a whole run and only a rest ever brought it
# down. The projection assumes the same acknowledge, so both model one driver.


def test_selecting_a_service_for_a_monotony_fire_records_acknowledge_on_the_trigger(
    rest_plan_id, base_world_dict
):
    mid = _create_merged_run(rest_plan_id, base_world_dict)

    proposal = _tick_until_proposal(mid, result_type="MONOTONY_PROPOSAL")
    assert proposal is not None, "setup: the run must reach a monotony fire"
    handle = get_handle(mid, settings.merged_runs_dir)
    assert handle is not None
    trigger_run_id = handle.trigger_run_id

    before = _trigger_actions(trigger_run_id)
    ranked = [
        ev["output"]["ranked_candidates"] for ev in proposal["evidence"] if ev["step"] == "service"
    ]
    assert ranked and ranked[0], "setup: the monotony proposal must rank a service"
    chosen = ranked[0][0]["candidate_id"]

    resp = client.post(
        f"/api/merged-runs/{mid}/proposal-action",
        json={"kind": "select_service", "selected_service_id": chosen},
    )
    assert resp.status_code == 200, resp.text

    after = _trigger_actions(trigger_run_id)
    assert len(after) == len(before) + 1, f"expected one new trigger action; {before} -> {after}"
    assert after[-1] == "acknowledge", (
        "taking up a monotony proposal is an acknowledge, not a decline — decline "
        "is the driver refusing the content"
    )


def test_selecting_a_service_for_a_REST_fire_does_not_record_acknowledge(
    rest_plan_id, base_world_dict
):
    """A rest opportunity is answered by accept-rest / decline, not by the
    service pick that follows it — recording an acknowledge there would resolve
    the pending rest proposal out from under the reviewer."""
    mid = _create_merged_run(rest_plan_id, base_world_dict)
    proposal = _tick_until_proposal(mid, result_type="REST_PROPOSAL")
    assert proposal is not None
    handle = get_handle(mid, settings.merged_runs_dir)
    assert handle is not None
    trigger_run_id = handle.trigger_run_id

    before = _trigger_actions(trigger_run_id)
    ranked = [
        ev["output"]["ranked_candidates"] for ev in proposal["evidence"] if ev["step"] == "service"
    ]
    assert ranked and ranked[0]
    client.post(
        f"/api/merged-runs/{mid}/proposal-action",
        json={"kind": "select_service", "selected_service_id": ranked[0][0]["candidate_id"]},
    )

    assert _trigger_actions(trigger_run_id) == before
