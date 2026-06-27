"""TDD run_manager tests (T021) — uses plan flow (create_draft → create_run).

Tests for:
  create_run(plan_id, run_id, runs_dir) -> RunState
  tick(run_id) -> TickOutcome
  action(run_id, action) -> RunState
"""

from __future__ import annotations

import json
import pathlib

import pytest

from aica_api.models.decision import ResultType
from aica_api.models.log import AlgorithmError, RunLog
from aica_api.models.package import PackageManifest
from aica_api.models.run import RunStatus
from aica_api.models.scenario import ScenarioDef
from aica_api.services.run_manager import (
    ActionNotAllowedError,
    RunNotFoundError,
    action,
    clear_registry,
    create_run,
    tick,
)
from aica_api.services.run_plan import clear_draft_registry, create_draft

_REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
_SCENARIO_PATH = _REPO_ROOT / "scenarios" / "uc01_fatigue_friend_drive_v0_1.json"
_PACKAGE_PATH = _REPO_ROOT / "packages" / "rest_rule_based_v0_1" / "package.json"
_OVERTIME_SCENARIO_PATH = _REPO_ROOT / "scenarios" / "uc01_overtime_driver_v0_1.json"
_WEIGHTED_PACKAGE_PATH = _REPO_ROOT / "packages" / "rest_weighted_score_v0_1" / "package.json"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def reset_registry():
    """Isolate each test — clear both in-memory registries."""
    clear_registry()
    clear_draft_registry()
    yield
    clear_registry()
    clear_draft_registry()


@pytest.fixture
def uc01_scenario() -> ScenarioDef:
    data = json.loads(_SCENARIO_PATH.read_text(encoding="utf-8"))
    return ScenarioDef(**data)


@pytest.fixture
def uc01_package() -> PackageManifest:
    data = json.loads(_PACKAGE_PATH.read_text(encoding="utf-8"))
    return PackageManifest(**data)


@pytest.fixture
def overtime_scenario() -> ScenarioDef:
    data = json.loads(_OVERTIME_SCENARIO_PATH.read_text(encoding="utf-8"))
    return ScenarioDef(**data)


@pytest.fixture
def weighted_package() -> PackageManifest:
    data = json.loads(_WEIGHTED_PACKAGE_PATH.read_text(encoding="utf-8"))
    return PackageManifest(**data)


# ---------------------------------------------------------------------------
# Helper: create a draft then a run from it
# ---------------------------------------------------------------------------


def _plan_and_run(package, scenario, run_id, tmp_path):
    """Helper: create a draft plan and a run from it."""
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
    return create_run(plan_id, run_id, tmp_path)


# ---------------------------------------------------------------------------
# create_run
# ---------------------------------------------------------------------------


def test_create_run_returns_run_state(tmp_path, uc01_package, uc01_scenario):
    from aica_api.models.run import RunState
    state = _plan_and_run(uc01_package, uc01_scenario, "run_001", tmp_path)
    assert isinstance(state, RunState)


def test_create_run_status_is_created(tmp_path, uc01_package, uc01_scenario):
    state = _plan_and_run(uc01_package, uc01_scenario, "run_create_status", tmp_path)
    assert state.status == RunStatus.created


def test_create_run_current_tick_zero(tmp_path, uc01_package, uc01_scenario):
    state = _plan_and_run(uc01_package, uc01_scenario, "run_tick0", tmp_path)
    assert state.current_tick == 0


def test_create_run_no_pending_proposal(tmp_path, uc01_package, uc01_scenario):
    state = _plan_and_run(uc01_package, uc01_scenario, "run_no_prop", tmp_path)
    assert state.pending_proposal is None


def test_create_run_snapshot_set(tmp_path, uc01_package, uc01_scenario):
    state = _plan_and_run(uc01_package, uc01_scenario, "run_snap", tmp_path)
    assert state.snapshot.package.id == uc01_package.id
    assert state.snapshot.scenario.id == uc01_scenario.id


def test_create_run_event_plan_frozen(tmp_path, uc01_package, uc01_scenario):
    state = _plan_and_run(uc01_package, uc01_scenario, "run_plan", tmp_path)
    # M2 scenario: build_event_plan returns no per-tick ticks[] (M2 uses advance_tick)
    assert len(state.event_plan.ticks) == 0
    # M2 event plan carries tick_seconds and at least one rest opportunity
    assert state.event_plan.tick_seconds == uc01_scenario.tick_seconds
    assert len(state.event_plan.rest_opportunities) > 0


def test_create_run_writes_log_file(tmp_path, uc01_package, uc01_scenario):
    _plan_and_run(uc01_package, uc01_scenario, "run_log_file", tmp_path)
    log_file = tmp_path / "run_log_file.json"
    assert log_file.exists()


def test_create_run_log_file_is_valid_run_log(tmp_path, uc01_package, uc01_scenario):
    _plan_and_run(uc01_package, uc01_scenario, "run_valid_log", tmp_path)
    data = json.loads((tmp_path / "run_valid_log.json").read_text(encoding="utf-8"))
    log = RunLog(**data)
    assert log.run_id == "run_valid_log"
    assert log.events == []


def test_create_run_route_facts_has_segments(tmp_path, uc01_package, uc01_scenario):
    state = _plan_and_run(uc01_package, uc01_scenario, "run_rf", tmp_path)
    assert len(state.route_facts.segments) > 0


def test_create_run_route_facts_has_bands(tmp_path, uc01_package, uc01_scenario):
    state = _plan_and_run(uc01_package, uc01_scenario, "run_bands", tmp_path)
    assert "drowsiness_level" in state.route_facts.bands


# ---------------------------------------------------------------------------
# tick — normal advance
# ---------------------------------------------------------------------------


def test_tick_returns_run_state(tmp_path, uc01_package, uc01_scenario):
    from aica_api.models.run import RunState
    _plan_and_run(uc01_package, uc01_scenario, "run_tick_state", tmp_path)
    outcome = tick("run_tick_state")
    assert isinstance(outcome.run_state, RunState)


def test_tick_advances_current_tick(tmp_path, uc01_package, uc01_scenario):
    _plan_and_run(uc01_package, uc01_scenario, "run_advance", tmp_path)
    outcome = tick("run_advance")
    assert outcome.run_state.current_tick == 1


def test_first_tick_status_playing(tmp_path, uc01_package, uc01_scenario):
    """After the first tick (no proposal), status is 'playing'."""
    _plan_and_run(uc01_package, uc01_scenario, "run_playing", tmp_path)
    outcome = tick("run_playing")
    assert outcome.run_state.status == RunStatus.playing


def test_tick_decision_result_present(tmp_path, uc01_package, uc01_scenario):
    from aica_api.models.decision import DecisionResult
    _plan_and_run(uc01_package, uc01_scenario, "run_decision", tmp_path)
    outcome = tick("run_decision")
    assert outcome.decision is not None
    assert isinstance(outcome.decision, DecisionResult)


def test_tick_no_algorithm_error_on_normal_run(tmp_path, uc01_package, uc01_scenario):
    _plan_and_run(uc01_package, uc01_scenario, "run_no_err", tmp_path)
    outcome = tick("run_no_err")
    assert outcome.algorithm_error is None


def test_tick_not_paused_on_no_trigger(tmp_path, uc01_package, uc01_scenario):
    """First tick (NO_TRIGGER) should not pause."""
    _plan_and_run(uc01_package, uc01_scenario, "run_no_pause", tmp_path)
    outcome = tick("run_no_pause")
    assert outcome.paused is False


def test_tick_event_written_to_log(tmp_path, uc01_package, uc01_scenario):
    _plan_and_run(uc01_package, uc01_scenario, "run_log_tick", tmp_path)
    tick("run_log_tick")
    data = json.loads((tmp_path / "run_log_tick.json").read_text(encoding="utf-8"))
    assert len(data["events"]) == 1
    assert data["events"][0]["kind"] == "tick"


# ---------------------------------------------------------------------------
# tick — REST_PROPOSAL fires (run pauses)
# ---------------------------------------------------------------------------


def _tick_to_proposal(run_id: str, package: PackageManifest, scenario: ScenarioDef) -> None:
    """Helper: tick until REST_PROPOSAL fires."""
    n_ticks = scenario.total_duration_seconds // scenario.tick_seconds
    for _ in range(n_ticks):
        outcome = tick(run_id)
        if outcome.paused or outcome.completed:
            break


def test_tick_pauses_on_rest_proposal(tmp_path, uc01_package, uc01_scenario):
    """At the trigger tick, the run pauses and pending_proposal is set."""
    _plan_and_run(uc01_package, uc01_scenario, "run_pause", tmp_path)
    _tick_to_proposal("run_pause", uc01_package, uc01_scenario)
    outcome = tick.__wrapped__("run_pause") if hasattr(tick, "__wrapped__") else None
    # Re-check by reading state via separate tick after proposal
    # We need to read state from registry — use get_run
    from aica_api.services.run_manager import get_run
    state = get_run("run_pause")
    assert state is not None
    assert state.status == RunStatus.paused
    assert state.pending_proposal is not None


def test_exactly_one_rest_proposal_in_full_run(tmp_path, uc01_package, uc01_scenario):
    """The UC-01 fixture fires exactly one REST_PROPOSAL across the full run."""
    _plan_and_run(uc01_package, uc01_scenario, "run_one_r3", tmp_path)
    n_ticks = uc01_scenario.total_duration_seconds // uc01_scenario.tick_seconds
    rest_proposals = 0
    for _ in range(n_ticks):
        outcome = tick("run_one_r3")
        if outcome.decision and outcome.decision.result_type == ResultType.REST_PROPOSAL:
            rest_proposals += 1
        if outcome.paused:
            action("run_one_r3", "accept_rest")  # complete the run
            break
        if outcome.completed:
            break
    assert rest_proposals == 1


# ---------------------------------------------------------------------------
# tick — completed state is a no-op
# ---------------------------------------------------------------------------


def test_tick_past_end_returns_completed(tmp_path, uc01_package, uc01_scenario):
    """Ticking past the last valid index returns completed=True."""
    _plan_and_run(uc01_package, uc01_scenario, "run_completed", tmp_path)
    n_ticks = uc01_scenario.total_duration_seconds // uc01_scenario.tick_seconds
    # Tick all the way through, accepting any proposals
    for _ in range(n_ticks + 5):
        outcome = tick("run_completed")
        if outcome.paused:
            action("run_completed", "accept_rest")
        if outcome.completed:
            break
    outcome = tick("run_completed")
    assert outcome.completed is True


# ---------------------------------------------------------------------------
# tick — unknown run_id raises RunNotFoundError
# ---------------------------------------------------------------------------


def test_tick_unknown_run_raises(tmp_path):
    with pytest.raises(RunNotFoundError):
        tick("unknown_run_id")


# ---------------------------------------------------------------------------
# tick — adapter failure records AlgorithmError (not a faked decision)
# ---------------------------------------------------------------------------


def test_tick_adapter_failure_records_algorithm_error(tmp_path, uc01_scenario, monkeypatch):
    """On adapter failure, an AlgorithmError is appended; decision is None."""
    from aica_api.algorithms import adapter as adapter_mod
    from aica_api.algorithms.adapter import AlgorithmAdapterError

    # Patch the adapter to always raise
    def _raise(*args, **kwargs):
        raise AlgorithmAdapterError("algorithm_exception", "injected error")

    monkeypatch.setattr(adapter_mod, "evaluate", _raise)

    # Use a minimal package that will trigger the patched adapter
    pkg_data = json.loads((_PACKAGE_PATH).read_text(encoding="utf-8"))
    package = PackageManifest(**pkg_data)

    _plan_and_run(package, uc01_scenario, "run_err_test", tmp_path)
    outcome = tick("run_err_test")

    assert outcome.decision is None
    assert outcome.algorithm_error is not None
    assert outcome.paused is False

    # The log must contain an algorithm_error event, not a tick event
    data = json.loads((tmp_path / "run_err_test.json").read_text(encoding="utf-8"))
    assert any(e["kind"] == "algorithm_error" for e in data["events"])
    assert not any(e["kind"] == "tick" for e in data["events"])


# ---------------------------------------------------------------------------
# T021 R6 — package_runtime_state threaded tick-to-tick
# ---------------------------------------------------------------------------


def test_tick_threads_package_runtime_state(tmp_path, uc01_package, uc01_scenario, monkeypatch):
    """T021 R6: package_runtime_state is threaded tick-to-tick.

    A stub algorithm returns a non-empty next_package_runtime_state.
    After the tick, run_state.package_runtime_state == the returned value.
    The persisted log also carries this value.
    """
    import aica_api.algorithms.adapter as adapter_mod
    from aica_api.models.decision import (
        Candidate, DecisionResult, FireControl, ResultType,
    )

    stub_prs = {"stub_counter": 42}

    def _stub(*args, **kwargs):
        return DecisionResult(
            result_type=ResultType.NO_TRIGGER,
            trigger_candidate=False,
            selected_category=None,
            score=0.0,
            features={},
            scores={},
            states={},
            criteria={},
            candidates=[],
            fire_control=FireControl(fired=False, suppressed=False, override=False, reason="stub"),
            proposal=None,
            reason_inputs=[],
            explanation="stub",
            next_package_runtime_state=stub_prs,
        )

    monkeypatch.setattr(adapter_mod, "evaluate", _stub)

    _plan_and_run(uc01_package, uc01_scenario, "run_prs_test", tmp_path)
    outcome1 = tick("run_prs_test")

    # run_state should now carry the stub's returned state
    assert outcome1.run_state.package_runtime_state == stub_prs

    # Second tick: the adapter receives the stub_prs as package_runtime_state
    captured_prs = {}
    original_stub = _stub

    def _stub2(*args, **kwargs):
        captured_prs["got"] = kwargs.get("package_runtime_state", {})
        return original_stub(*args, **kwargs)

    monkeypatch.setattr(adapter_mod, "evaluate", _stub2)
    tick("run_prs_test")
    assert captured_prs.get("got") == stub_prs

    # Check persisted log carries package_runtime_state in TickEvent
    data = json.loads((tmp_path / "run_prs_test.json").read_text(encoding="utf-8"))
    tick_events = [e for e in data["events"] if e.get("kind") == "tick"]
    assert len(tick_events) >= 1
    assert tick_events[0].get("package_runtime_state") == stub_prs


# ---------------------------------------------------------------------------
# action — valid action while paused
# ---------------------------------------------------------------------------


def test_action_accept_rest_completes_run(tmp_path, uc01_package, uc01_scenario):
    """accept_rest while paused transitions the run to completed."""
    _plan_and_run(uc01_package, uc01_scenario, "run_accept", tmp_path)
    _tick_to_proposal("run_accept", uc01_package, uc01_scenario)

    from aica_api.services.run_manager import get_run
    state_before = get_run("run_accept")
    assert state_before.status == RunStatus.paused

    state_after = action("run_accept", "accept_rest")
    assert state_after.status == RunStatus.completed
    assert state_after.pending_proposal is None


def test_action_postpone_resumes_run(tmp_path, uc01_package, uc01_scenario):
    """postpone while paused resumes the run (status back to playing)."""
    _plan_and_run(uc01_package, uc01_scenario, "run_postpone", tmp_path)
    _tick_to_proposal("run_postpone", uc01_package, uc01_scenario)

    state_after = action("run_postpone", "postpone")
    assert state_after.status == RunStatus.playing
    assert state_after.pending_proposal is None


def test_action_appends_action_event_to_log(tmp_path, uc01_package, uc01_scenario):
    _plan_and_run(uc01_package, uc01_scenario, "run_act_log", tmp_path)
    _tick_to_proposal("run_act_log", uc01_package, uc01_scenario)

    action("run_act_log", "accept_rest")

    data = json.loads((tmp_path / "run_act_log.json").read_text(encoding="utf-8"))
    action_events = [e for e in data["events"] if e["kind"] == "action"]
    assert len(action_events) == 1
    assert action_events[0]["action"] == "accept_rest"
    assert action_events[0]["resulting_status"] == "completed"


# ---------------------------------------------------------------------------
# action — error cases
# ---------------------------------------------------------------------------


def test_action_when_not_paused_raises(tmp_path, uc01_package, uc01_scenario):
    """Taking an action while not paused (no pending proposal) raises."""
    _plan_and_run(uc01_package, uc01_scenario, "run_not_paused", tmp_path)
    # Don't tick to a proposal — run is in 'created' state
    with pytest.raises(ActionNotAllowedError):
        action("run_not_paused", "accept_rest")


def test_action_unknown_run_raises(tmp_path):
    with pytest.raises(RunNotFoundError):
        action("unknown_run", "accept_rest")


def test_action_invalid_action_raises(tmp_path, uc01_package, uc01_scenario):
    """An action not in scenario.allowed_actions raises ActionNotAllowedError."""
    _plan_and_run(uc01_package, uc01_scenario, "run_bad_act", tmp_path)
    _tick_to_proposal("run_bad_act", uc01_package, uc01_scenario)

    with pytest.raises(ActionNotAllowedError):
        action("run_bad_act", "invalid_action_xyz")


# ---------------------------------------------------------------------------
# T028 — suppressed candidate survives into the persisted trace (FR-008)
# ---------------------------------------------------------------------------


def test_suppressed_candidate_persists_to_disk(tmp_path, uc01_package, uc01_scenario, monkeypatch):
    """T028 FR-008: a suppressed candidate is never dropped from the persisted log.

    Monkeypatches the adapter to return a DecisionResult shaped like R2
    (NO_PRACTICAL_ACTION_FALLBACK — rest candidate suppressed by the
    actionability guard) and then verifies that the persisted RunLog on disk
    retains that suppressed candidate verbatim, including
    fire_control.suppressed=True and the correct category.
    """
    import aica_api.algorithms.adapter as adapter_mod
    from aica_api.models.decision import (
        Candidate,
        DecisionResult,
        FireControl,
        ResultType,
    )

    # Build a DecisionResult with a suppressed rest_required candidate (R2 shape).
    suppressed_fc = FireControl(
        fired=False,
        suppressed=True,
        override=False,
        reason="actionability_guard_rest_not_reachable",
    )
    suppressed_candidate = Candidate(
        category="rest_required",
        exists=True,
        score=3.5,
        state=None,
        strength="clear",
        fire_control=suppressed_fc,
    )
    suppressed_result = DecisionResult(
        result_type=ResultType.NO_PRACTICAL_ACTION_FALLBACK,
        trigger_candidate=False,
        selected_category=None,
        score=3.5,
        features={"drowsiness_level": "moderate", "rest_spot_eta": "none"},
        scores={},
        states={},
        criteria={"reaction_point": 1.4, "proposal_cut": 3.0, "severe_cut": 4.0},
        candidates=[suppressed_candidate],
        fire_control=FireControl(
            fired=False,
            suppressed=True,
            override=False,
            reason="actionability_guard_rest_not_reachable",
        ),
        proposal=None,
        reason_inputs=["drowsiness_level", "rest_spot_eta"],
        explanation=(
            "Damped blend passed the proposal threshold but no actionable "
            "rest spot is reachable."
        ),
        next_package_runtime_state={},
    )

    monkeypatch.setattr(adapter_mod, "evaluate", lambda *a, **kw: suppressed_result)

    _plan_and_run(uc01_package, uc01_scenario, "run_suppressed_t028", tmp_path)
    outcome = tick("run_suppressed_t028")

    # ── In-memory outcome sanity ───────────────────────────────────────────
    assert outcome.decision is not None, "expected a decision, not an algorithm error"
    assert outcome.decision.result_type == ResultType.NO_PRACTICAL_ACTION_FALLBACK
    in_mem_suppressed = [
        c for c in outcome.decision.candidates if c.fire_control.suppressed
    ]
    assert len(in_mem_suppressed) == 1
    assert in_mem_suppressed[0].category == "rest_required"

    # ── Persisted log (read back from disk) ───────────────────────────────
    data = json.loads((tmp_path / "run_suppressed_t028.json").read_text(encoding="utf-8"))
    tick_events = [e for e in data["events"] if e.get("kind") == "tick"]
    assert len(tick_events) == 1, "exactly one tick event must be persisted"

    # Backend TraceEntry serializes as { tick_index, decision_result: { candidates, … } }
    trace = tick_events[0]["trace"]
    decision_result_data = trace.get("decision_result", {})
    persisted_candidates = decision_result_data.get("candidates", [])
    assert len(persisted_candidates) == 1, (
        "suppressed candidate must NOT be dropped from the persisted trace (FR-008); "
        f"trace keys: {list(trace.keys())}, decision_result keys: {list(decision_result_data.keys())}"
    )

    persisted_candidate = persisted_candidates[0]
    assert persisted_candidate["category"] == "rest_required"
    persisted_fc = persisted_candidate["fire_control"]
    assert persisted_fc["suppressed"] is True, (
        "fire_control.suppressed must be True in the persisted log (FR-008)"
    )
    assert persisted_fc["fired"] is False


# ---------------------------------------------------------------------------
# T025 — overtime scenario parses and fires exactly one REST_PROPOSAL
# ---------------------------------------------------------------------------


def test_overtime_scenario_parses(overtime_scenario):
    """T025: scenario file parses as a valid ScenarioDef."""
    assert overtime_scenario.id == "uc01_overtime_driver_v0_1"
    assert overtime_scenario.type == "uc01_fatigue"
    assert overtime_scenario.is_night is True
    assert "decline" in overtime_scenario.allowed_actions


def test_overtime_scenario_fires_one_proposal_rule_package(
    tmp_path, uc01_package, overtime_scenario
):
    """T025: rule package fires exactly one REST_PROPOSAL on overtime scenario."""
    _plan_and_run(uc01_package, overtime_scenario, "run_ot_rule", tmp_path)
    n_ticks = overtime_scenario.total_duration_seconds // overtime_scenario.tick_seconds
    rest_proposals = 0
    for _ in range(n_ticks + 5):
        outcome = tick("run_ot_rule")
        if outcome.decision and outcome.decision.result_type == ResultType.REST_PROPOSAL:
            rest_proposals += 1
        if outcome.paused:
            action("run_ot_rule", "decline")
        if outcome.completed:
            break
    assert rest_proposals == 1


def test_overtime_scenario_fires_one_proposal_weighted_package(
    tmp_path, weighted_package, overtime_scenario
):
    """T025: weighted package fires exactly one REST_PROPOSAL on overtime scenario."""
    _plan_and_run(weighted_package, overtime_scenario, "run_ot_ws", tmp_path)
    n_ticks = overtime_scenario.total_duration_seconds // overtime_scenario.tick_seconds
    rest_proposals = 0
    for _ in range(n_ticks + 5):
        outcome = tick("run_ot_ws")
        if outcome.decision and outcome.decision.result_type == ResultType.REST_PROPOSAL:
            rest_proposals += 1
        if outcome.paused:
            action("run_ot_ws", "decline")
        if outcome.completed:
            break
    assert rest_proposals == 1


# ---------------------------------------------------------------------------
# T026 — decline action
# ---------------------------------------------------------------------------


def test_action_decline_resumes_run(tmp_path, uc01_package, overtime_scenario):
    """decline while paused resumes the run (status -> playing)."""
    _plan_and_run(uc01_package, overtime_scenario, "run_decline", tmp_path)
    _tick_to_proposal("run_decline", uc01_package, overtime_scenario)

    state_after = action("run_decline", "decline")
    assert state_after.status == RunStatus.playing
    assert state_after.pending_proposal is None


def test_action_decline_appends_action_event(tmp_path, uc01_package, overtime_scenario):
    """decline is persisted as an ActionEvent with action='decline' and resulting_status='playing'."""
    _plan_and_run(uc01_package, overtime_scenario, "run_decline_log", tmp_path)
    _tick_to_proposal("run_decline_log", uc01_package, overtime_scenario)

    action("run_decline_log", "decline")

    data = json.loads((tmp_path / "run_decline_log.json").read_text(encoding="utf-8"))
    action_events = [e for e in data["events"] if e["kind"] == "action"]
    assert len(action_events) == 1
    assert action_events[0]["action"] == "decline"
    assert action_events[0]["resulting_status"] == "playing"


def test_decline_then_no_further_proposal(tmp_path, uc01_package, overtime_scenario):
    """After decline, the run completes at route end with no further REST_PROPOSAL."""
    _plan_and_run(uc01_package, overtime_scenario, "run_no_reprop", tmp_path)
    n_ticks = overtime_scenario.total_duration_seconds // overtime_scenario.tick_seconds

    declined = False
    rest_proposals = 0
    for _ in range(n_ticks + 5):
        outcome = tick("run_no_reprop")
        if outcome.decision and outcome.decision.result_type == ResultType.REST_PROPOSAL:
            rest_proposals += 1
        if outcome.paused and not declined:
            action("run_no_reprop", "decline")
            declined = True
        if outcome.completed:
            break

    from aica_api.services.run_manager import get_run
    final_state = get_run("run_no_reprop")
    assert declined is True
    assert rest_proposals == 1
    assert final_state.status == RunStatus.completed


def test_decline_rejected_when_not_in_allowed_actions(tmp_path, uc01_package, uc01_scenario):
    """decline is rejected (ActionNotAllowedError) when not in scenario.allowed_actions."""
    _plan_and_run(uc01_package, uc01_scenario, "run_no_decline", tmp_path)
    _tick_to_proposal("run_no_decline", uc01_package, uc01_scenario)

    with pytest.raises(ActionNotAllowedError):
        action("run_no_decline", "decline")


def test_run_state_has_allowed_actions(tmp_path, uc01_package, overtime_scenario):
    """RunState exposes allowed_actions from the scenario."""
    state = _plan_and_run(uc01_package, overtime_scenario, "run_allowed", tmp_path)
    assert "decline" in state.allowed_actions
    assert "accept_rest" in state.allowed_actions
