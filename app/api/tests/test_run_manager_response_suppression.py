"""TDD tests for the centralized post-response trigger de-duplication gate.

RED PHASE — see `docs/fixbug-0804-trigger-dedup-plan.md` (§5, §7).  This file
intentionally targets code that DOES NOT YET EXIST:

  - `aica_api.services.run_manager._DECLINE_COOLDOWN_SEC` (module constant, 1800.0)
  - `aica_api.services.run_manager._derive_response_suppression(events,
    current_sim_sec, tick_seconds) -> dict[str, bool]`

Bug being fixed (plan §1): in live/animation mode, an ACCEPTED trigger
re-pauses the run almost immediately (monotony `acknowledge` should stay
suppressed until a REST_PROPOSAL fires; rest `accept_rest` is already
suppressed by the existing `recovery_active` gate), and a DECLINED trigger
re-pauses within the same 30-minute window it was just declined in. Both
`nri_fatigue_score_v1` and `aica_transparent_hybrid_trigger_v1` are affected
(neither package implements this itself — see plan §3).

The pure helper's contract (plan §5 state machine table), per category
(`rest_required` / `monotony_prevention`), independently:

  Monotony ACCEPTED  (`acknowledge`) -> suppress monotony_prevention
                                         until ANY REST_PROPOSAL fires after it.
  Monotony DECLINED  (`decline`)     -> suppress monotony_prevention
                                         while `current_sim_sec - declineTimeSec < 1800`.
  Rest DECLINED      (`decline`)     -> suppress rest_required
                                         while `current_sim_sec - declineTimeSec < 1800`.
  Rest POSTPONED     (`postpone`)    -> same 30-min cooldown as decline.
  Rest ACCEPTED      (`accept_rest`) -> NOT this helper's job (existing
                                         `recovery_active` gate in run_manager.tick()
                                         already covers it) — verified by an
                                         integration regression test below, not
                                         by the unit tests on the pure helper.

§7.1 unit-tests the pure helper directly with hand-built event lists.
§7.2 integration-tests the real `tick()`/`action()` loop for BOTH packages on
the `uc01_fatigue_recovery_v0_1` scenario (the only scenario with
`recovery_options` + the full `acknowledge`/`decline`/`postpone`/`accept_rest`
vocabulary in `allowed_actions` — see that scenario's `_comment`).

Do NOT modify run_manager.py or any package algorithm.py from this file.
"""

from __future__ import annotations

import json
import pathlib

import pytest

from aica_api.models.decision import DecisionResult, FireControl, Proposal
from aica_api.models.log import ActionEvent, TickEvent, TraceEntry
from aica_api.models.package import PackageManifest
from aica_api.models.run import RestSpot, TickState
from aica_api.models.scenario import ScenarioDef
from aica_api.services.run_manager import (
    action,
    clear_registry,
    create_run,
    tick,
)
from aica_api.services.run_plan import clear_draft_registry, create_draft

_REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]


# ---------------------------------------------------------------------------
# §7.1 — Unit tests on the pure helper `_derive_response_suppression`
# ---------------------------------------------------------------------------
#
# Event-list builders mirroring test_evidence_recorder.py's construction style.
# Deliberately mirrors real run_manager.action() behavior: an ActionEvent's
# tick_index is always the SAME tick_index as the proposal it answers
# (run_manager.action() records `tick_index=run_state.current_tick - 1`, i.e.
# the tick that fired the pending proposal) — so a fired-proposal TickEvent's
# elapsed_seconds IS the "declineTimeSec" / "acknowledgeTimeSec" the plan's
# state-machine table refers to.


def _tick_state(tick_index: int, elapsed_seconds: float) -> TickState:
    return TickState(
        tick_index=tick_index,
        elapsed_seconds=int(elapsed_seconds),
        route_fraction=0.0,
        active_segment_id="seg_start",
        drowsiness_level="none",
        fatigue_level="low",
        signal_duration="transient",
        continuous_driving_time="short",
        rest_spot_eta="none",
        completed=False,
    )


def _fired_event(
    tick_index: int,
    elapsed_seconds: float,
    category: str,
    result_type: str,
) -> TickEvent:
    """A TickEvent whose fire_control.fired=True with a proposal for `category`.

    `category` must be "rest_required" or "monotony_prevention"; `result_type`
    "REST_PROPOSAL" or "MONOTONY_PROPOSAL" (plan §3.5 — identical strings
    across both packages).
    """
    fc = FireControl(fired=True, suppressed=False, override=False, reason=None)
    proposal = Proposal(
        id=f"{category}_proposal",
        message={"ja": "x", "en": "x"},
        options=["accept_rest", "postpone", "decline", "acknowledge"],
    )
    dr = DecisionResult(
        result_type=result_type,
        trigger_candidate=True,
        selected_category=category,
        score=0.9,
        features={},
        criteria={},
        candidates=[],
        fire_control=fc,
        proposal=proposal,
        reason_inputs=[],
        explanation="fired",
    )
    ts = _tick_state(tick_index, elapsed_seconds)
    trace = TraceEntry(tick_index=tick_index, decision_result=dr)
    return TickEvent(kind="tick", tick_index=tick_index, tick_state=ts, trace=trace)


def _action_event(tick_index: int, action_str: str) -> ActionEvent:
    return ActionEvent(
        kind="action", tick_index=tick_index, action=action_str, resulting_status="playing"
    )


def _get_helper():
    """Local import so collection of THIS module succeeds even before the fix
    exists — only the unit tests below (which actually call the helper) raise
    ImportError/AttributeError at test-run time. This keeps §7.2's integration
    tests runnable (and their own, behavioral, red failures visible) instead
    of being masked by a module-level collection error.
    """
    from aica_api.services.run_manager import _derive_response_suppression
    return _derive_response_suppression


# --- Monotony acknowledge (accept) --------------------------------------------


def test_monotony_acknowledge_suppresses_monotony_until_rest_fires():
    """An acknowledged monotony proposal stays suppressed with no timer."""
    derive = _get_helper()
    events = [
        _fired_event(0, 0, "monotony_prevention", "MONOTONY_PROPOSAL"),
        _action_event(0, "acknowledge"),
    ]
    # Even a very long time later — no REST_PROPOSAL has fired since — it
    # must still be suppressed (accept-monotony has no timer, per plan §5).
    result = derive(events, current_sim_sec=10_000.0, tick_seconds=180.0)
    assert result["monotony_prevention"] is True
    assert result["rest_required"] is False


def test_monotony_acknowledge_released_when_rest_proposal_fires():
    """The moment ANY REST_PROPOSAL fires after the acknowledge, monotony is released."""
    derive = _get_helper()
    events = [
        _fired_event(0, 0, "monotony_prevention", "MONOTONY_PROPOSAL"),
        _action_event(0, "acknowledge"),
        _fired_event(5, 900, "rest_required", "REST_PROPOSAL"),
    ]
    result = derive(events, current_sim_sec=900.0, tick_seconds=180.0)
    assert result["monotony_prevention"] is False


# --- Monotony decline (30-min cooldown) ---------------------------------------


def test_monotony_decline_suppresses_for_30min():
    derive = _get_helper()
    events = [
        _fired_event(0, 0, "monotony_prevention", "MONOTONY_PROPOSAL"),
        _action_event(0, "decline"),
    ]
    # 15 minutes later — still inside the 30-min window.
    result = derive(events, current_sim_sec=900.0, tick_seconds=180.0)
    assert result["monotony_prevention"] is True


def test_monotony_decline_released_after_30min():
    """Boundary: suppression is `< 1800`, so AT exactly 1800s it is released."""
    derive = _get_helper()
    events = [
        _fired_event(0, 0, "monotony_prevention", "MONOTONY_PROPOSAL"),
        _action_event(0, "decline"),
    ]
    just_inside = derive(events, current_sim_sec=1799.0, tick_seconds=180.0)
    assert just_inside["monotony_prevention"] is True

    at_boundary = derive(events, current_sim_sec=1800.0, tick_seconds=180.0)
    assert at_boundary["monotony_prevention"] is False


# --- Rest decline (30-min cooldown) + per-category independence --------------


def test_rest_decline_suppresses_rest_for_30min():
    derive = _get_helper()
    events = [
        _fired_event(0, 0, "rest_required", "REST_PROPOSAL"),
        _action_event(0, "decline"),
    ]
    result = derive(events, current_sim_sec=900.0, tick_seconds=180.0)
    assert result["rest_required"] is True


def test_rest_decline_does_not_block_monotony():
    """Per-category independence: a rest decline never suppresses monotony."""
    derive = _get_helper()
    events = [
        _fired_event(0, 0, "rest_required", "REST_PROPOSAL"),
        _action_event(0, "decline"),
    ]
    result = derive(events, current_sim_sec=900.0, tick_seconds=180.0)
    assert result["rest_required"] is True
    assert result["monotony_prevention"] is False


def test_monotony_decline_does_not_block_rest_escalation():
    """Per-category independence, the other direction: a monotony decline

    must never suppress rest — a genuine safety escalation to REST_PROPOSAL
    must still be able to fire and pause the run during a monotony cooldown.
    """
    derive = _get_helper()
    events = [
        _fired_event(0, 0, "monotony_prevention", "MONOTONY_PROPOSAL"),
        _action_event(0, "decline"),
    ]
    result = derive(events, current_sim_sec=900.0, tick_seconds=180.0)
    assert result["monotony_prevention"] is True
    assert result["rest_required"] is False


# --- Rest postpone (treated as 30-min cooldown, plan §5 / Q1 default) --------


def test_postpone_rest_cooldown():
    derive = _get_helper()
    events = [
        _fired_event(0, 0, "rest_required", "REST_PROPOSAL"),
        _action_event(0, "postpone"),
    ]
    inside_window = derive(events, current_sim_sec=900.0, tick_seconds=180.0)
    assert inside_window["rest_required"] is True

    after_window = derive(events, current_sim_sec=1800.0, tick_seconds=180.0)
    assert after_window["rest_required"] is False


# --- No-op baseline -------------------------------------------------------------


def test_no_actions_no_suppression():
    """Fired proposals with no action taken yet must not suppress anything —

    an unanswered proposal is a pending pause, not an answered one; suppression
    only begins once a response (acknowledge/decline/postpone/accept_rest) is
    recorded.
    """
    derive = _get_helper()
    events = [
        _fired_event(0, 0, "monotony_prevention", "MONOTONY_PROPOSAL"),
        _fired_event(5, 900, "rest_required", "REST_PROPOSAL"),
    ]
    result = derive(events, current_sim_sec=1000.0, tick_seconds=180.0)
    assert result["monotony_prevention"] is False
    assert result["rest_required"] is False


# ---------------------------------------------------------------------------
# §7.2 — Integration tests through tick()/action() — BOTH packages
# ---------------------------------------------------------------------------
#
# Uses uc01_fatigue_recovery_v0_1 (the only scenario with recovery_options AND
# the full acknowledge/decline/postpone/accept_rest vocabulary — see
# test_run_manager.py / test_uc01_integration_s9.py, which repoint here for
# the same reason) with default hyperparameters on both surviving
# python_module packages, exactly like test_end_to_end_run.py and
# test_uc01_integration_s9.py.

_SCENARIO_PATH = _REPO_ROOT / "scenarios" / "uc01_fatigue_recovery_v0_1.json"
_PACKAGE_IDS = ["nri_fatigue_score_v1", "aica_transparent_hybrid_trigger_v1"]

# Generous ceiling: test_end_to_end_run.py / test_uc01_integration_s9.py
# observe both packages completing/firing well within 300-400 ticks on this
# scenario at default hyperparameters.
_MAX_TICKS = 400


@pytest.fixture(autouse=True)
def reset_registries():
    """Isolate each test — clear both in-memory registries."""
    clear_registry()
    clear_draft_registry()
    yield
    clear_registry()
    clear_draft_registry()


@pytest.fixture
def uc01_scenario() -> ScenarioDef:
    data = json.loads(_SCENARIO_PATH.read_text(encoding="utf-8"))
    data.pop("_comment", None)
    return ScenarioDef(**data)


def _load_package(package_id: str) -> PackageManifest:
    pkg_path = _REPO_ROOT / "packages" / package_id / "package.json"
    return PackageManifest(**json.loads(pkg_path.read_text(encoding="utf-8")))


def _plan_and_run(package: PackageManifest, scenario: ScenarioDef, run_id: str, tmp_path) -> None:
    plan_id = f"plan_{run_id}"
    create_draft(
        plan_id=plan_id,
        package=package,
        scenario=scenario,
        presets={},
        parameters={},
        hyperparameters={},
        run_mode="standard",
    )
    create_run(plan_id, run_id, tmp_path)


def _tick_until_result_type(
    run_id: str,
    target_result_type: str,
    max_ticks: int = _MAX_TICKS,
):
    """Tick until a pause whose decision.result_type == target_result_type.

    Any OTHER actionable pause encountered on the way is resolved via
    "decline" (valid for both REST_PROPOSAL and MONOTONY_PROPOSAL options —
    see uc01_fatigue_recovery_v0_1's allowed_actions and each package's
    proposal `options`) so the run keeps advancing toward the target.

    Returns the TickOutcome for the target pause, or None if the run
    completed first (without ever producing that result_type).
    """
    for _ in range(max_ticks):
        outcome = tick(run_id)
        if outcome.paused:
            rt = outcome.decision.result_type if outcome.decision else None
            if rt == target_result_type:
                return outcome
            action(run_id, "decline")
            continue
        if outcome.completed:
            return None
    pytest.fail(
        f"Run {run_id!r} neither reached a {target_result_type} pause nor "
        f"completed within {max_ticks} ticks."
    )


@pytest.mark.parametrize("package_id", _PACKAGE_IDS)
def test_accepted_monotony_does_not_repause_before_rest(package_id, uc01_scenario, tmp_path):
    """Bug (plan §1, accept case): after `acknowledge`-ing a monotony proposal,

    continuing the run must NOT immediately re-pause with another
    MONOTONY_PROPOSAL — it must stay suppressed until a REST_PROPOSAL fires.
    """
    package = _load_package(package_id)
    run_id = f"run_ack_mono_{package_id}"
    _plan_and_run(package, uc01_scenario, run_id, tmp_path)

    mono_outcome = _tick_until_result_type(run_id, "MONOTONY_PROPOSAL")
    if mono_outcome is None:
        pytest.skip(
            f"{package_id}: MONOTONY_PROPOSAL never fired before completion on "
            "uc01_fatigue_recovery_v0_1's default hyperparameters — cannot "
            "exercise the accept-monotony gate on this combination."
        )

    action(run_id, "acknowledge")

    repaused_with_monotony = False
    for _ in range(_MAX_TICKS):
        outcome = tick(run_id)
        if outcome.completed:
            break
        if outcome.paused:
            rt = outcome.decision.result_type if outcome.decision else None
            if rt == "MONOTONY_PROPOSAL":
                repaused_with_monotony = True
                break
            if rt == "REST_PROPOSAL":
                # Release condition reached: monotony is now allowed to fire
                # again in principle. Nothing left to assert for this test.
                break
            action(run_id, "decline")

    assert not repaused_with_monotony, (
        f"{package_id}: MONOTONY_PROPOSAL re-paused the run before any "
        "REST_PROPOSAL fired, even though the prior monotony proposal was "
        "acknowledged — the harness must suppress a repeat monotony pause "
        "until rest escalates (plan §5)."
    )


@pytest.mark.parametrize("package_id", _PACKAGE_IDS)
def test_declined_monotony_does_not_repause_within_30min(package_id, uc01_scenario, tmp_path):
    """Bug (plan §1, decline case): a declined monotony proposal must not

    re-pause the run within the same 30-minute (1800s) sim-time window.
    """
    package = _load_package(package_id)
    run_id = f"run_decl_mono_{package_id}"
    _plan_and_run(package, uc01_scenario, run_id, tmp_path)

    mono_outcome = _tick_until_result_type(run_id, "MONOTONY_PROPOSAL")
    if mono_outcome is None:
        pytest.skip(
            f"{package_id}: MONOTONY_PROPOSAL never fired before completion on "
            "uc01_fatigue_recovery_v0_1's default hyperparameters — cannot "
            "exercise the decline-monotony cooldown on this combination."
        )

    decline_sim_sec = float(mono_outcome.tick_state.elapsed_seconds)
    action(run_id, "decline")

    repaused_with_monotony = False
    for _ in range(_MAX_TICKS):
        outcome = tick(run_id)
        if outcome.completed:
            break
        elapsed = float(outcome.tick_state.elapsed_seconds) if outcome.tick_state else None
        if elapsed is not None and elapsed - decline_sim_sec >= 1800.0:
            # Left the cooldown window — a fresh fire here would be legitimate.
            break
        if outcome.paused:
            rt = outcome.decision.result_type if outcome.decision else None
            if rt == "MONOTONY_PROPOSAL":
                repaused_with_monotony = True
                break
            action(run_id, "decline")

    assert not repaused_with_monotony, (
        f"{package_id}: MONOTONY_PROPOSAL re-paused the run within the "
        "30-minute decline cooldown window (plan §5)."
    )


@pytest.mark.parametrize("package_id", _PACKAGE_IDS)
def test_declined_rest_does_not_repause_within_30min(package_id, uc01_scenario, tmp_path):
    """Bug (plan §1, decline case): a declined REST_PROPOSAL must not re-pause

    the run within the same 30-minute (1800s) sim-time window.
    """
    package = _load_package(package_id)
    run_id = f"run_decl_rest_{package_id}"
    _plan_and_run(package, uc01_scenario, run_id, tmp_path)

    rest_outcome = _tick_until_result_type(run_id, "REST_PROPOSAL")
    assert rest_outcome is not None, (
        f"{package_id}: REST_PROPOSAL never fired within {_MAX_TICKS} ticks — "
        "test_uc01_integration_s9.py / test_end_to_end_run.py establish this "
        "fires reliably on this scenario+package at default hyperparameters, "
        "so this indicates a fixture problem, not the gate under test."
    )

    decline_sim_sec = float(rest_outcome.tick_state.elapsed_seconds)
    action(run_id, "decline")

    repaused_with_rest = False
    for _ in range(_MAX_TICKS):
        outcome = tick(run_id)
        if outcome.completed:
            break
        elapsed = float(outcome.tick_state.elapsed_seconds) if outcome.tick_state else None
        if elapsed is not None and elapsed - decline_sim_sec >= 1800.0:
            break
        if outcome.paused:
            rt = outcome.decision.result_type if outcome.decision else None
            if rt == "REST_PROPOSAL":
                repaused_with_rest = True
                break
            action(run_id, "decline")

    assert not repaused_with_rest, (
        f"{package_id}: REST_PROPOSAL re-paused the run within the 30-minute "
        "decline cooldown window (plan §5)."
    )


@pytest.mark.parametrize("package_id", _PACKAGE_IDS)
def test_accepted_rest_suppressed_until_arrival(package_id, uc01_scenario, tmp_path):
    """Regression guard (plan §5, "no new code" row + §7.2): the EXISTING

    `recovery_active` gate (run_manager.py:824-835) must still suppress a
    REST_PROPOSAL re-pause for the entire duration an accepted recovery is
    active. This is independent of `_derive_response_suppression` and should
    already be green — a red result here means the new gate broke something
    the old gate was already doing, not that the new gate is missing.
    """
    package = _load_package(package_id)
    run_id = f"run_accept_rest_{package_id}"
    _plan_and_run(package, uc01_scenario, run_id, tmp_path)

    rest_outcome = _tick_until_result_type(run_id, "REST_PROPOSAL")
    assert rest_outcome is not None, (
        f"{package_id}: REST_PROPOSAL never fired within {_MAX_TICKS} ticks."
    )

    spot = RestSpot(id="p1", label={"ja": "SA", "en": "SA"}, route_fraction=0.5)
    action(run_id, "accept_rest", recovery_option_id="nap_karaoke", rest_spot=spot)

    repaused_with_rest = False
    for _ in range(_MAX_TICKS):
        outcome = tick(run_id)
        if outcome.completed:
            break
        if outcome.paused:
            rt = outcome.decision.result_type if outcome.decision else None
            if rt == "REST_PROPOSAL":
                repaused_with_rest = True
                break
            action(run_id, "decline")

    assert not repaused_with_rest, (
        f"{package_id}: REST_PROPOSAL re-paused the run while an accepted "
        "recovery was still active — regression in the existing "
        "recovery_active fire-control gate."
    )
