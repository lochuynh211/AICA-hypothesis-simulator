"""TDD run_manager tests (T021) — uses plan flow (create_draft → create_run).

Tests for:
  create_run(plan_id, run_id, runs_dir) -> RunState
  tick(run_id) -> TickOutcome
  action(run_id, action) -> RunState

Feature 009 (signal-tier redesign): repointed from the retired
uc01_fatigue_friend_drive_v0_1 scenario + rest_rule_based_v0_1 (declarative_rule)
package to the surviving uc01_fatigue_recovery_v0_1 scenario +
aica_transparent_hybrid_trigger_v1 (python_module) package.  The package declares
tick_seconds=30 (overriding the scenario's tick_seconds=60 — see
run_plan._build_effective_setup's precedence), and the scenario has
recovery_options (accept_rest now requires recovery_option_id + rest_spot instead
of completing the run outright).  Tick budgets and REST_PROPOSAL counts below are
regenerated from actual behavior (FR-018): with default hyperparameters and
run_seed_default=42, the hybrid trigger fires exactly one REST_PROPOSAL at tick 111
(~56km in) over the full 120km route — consistent with test_end_to_end_run.py's
independently-verified e2e behavior.

The overtime-scenario / weighted_score tests are deleted — uc01_overtime_driver_v0_1
and rest_weighted_score_v0_1 are both retired (no declarative_rule/weighted_score
built-in algorithms, no overtime scenario file survives feature 009).
"""

from __future__ import annotations

import json
import pathlib

import pytest

from aica_api.models.decision import ResultType
from aica_api.models.log import AlgorithmError, RunLog
from aica_api.models.package import PackageManifest
from aica_api.models.run import RestSpot, RunStatus
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
_SCENARIO_PATH = _REPO_ROOT / "scenarios" / "uc01_fatigue_recovery_v0_1.json"
_PACKAGE_PATH = _REPO_ROOT / "packages" / "aica_transparent_hybrid_trigger_v1" / "package.json"

# Generous tick budget covering the full 120km route at the package's 30s cadence
# (observed: REST_PROPOSAL fires once at tick 111; the full route completes well
# within 400 — see test_end_to_end_run.py's independently-verified ~217-tick figure).
_MAX_TICKS = 400

# The scenario's one is_rest_facility segment sits at route_fraction 0.5.
_REST_SPOT = RestSpot(id="p1", label={"ja": "SA", "en": "SA"}, route_fraction=0.5)


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
    data.pop("_comment", None)
    return ScenarioDef(**data)


@pytest.fixture
def uc01_package() -> PackageManifest:
    data = json.loads(_PACKAGE_PATH.read_text(encoding="utf-8"))
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


def _tick_to_proposal(run_id: str) -> None:
    """Helper: tick until REST_PROPOSAL pauses the run (or completion, or budget exhausted)."""
    for _ in range(_MAX_TICKS):
        outcome = tick(run_id)
        if outcome.paused or outcome.completed:
            break


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
    # The package declares its own tick_seconds (30), which takes precedence over
    # the scenario's (60) — see run_plan._build_effective_setup's precedence rule.
    assert state.event_plan.tick_seconds == uc01_package.algorithm.tick_seconds
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
    """route_facts.bands is populated from package.features (run_plan.create_draft),
    keyed by the package's own feature keys — not the retired M1
    "drowsiness_level"/"fatigue_level" band-parameter names."""
    state = _plan_and_run(uc01_package, uc01_scenario, "run_bands", tmp_path)
    assert "drowsiness" in state.route_facts.bands
    assert "fatigue" in state.route_facts.bands


# ─── M5 T003 — create_run persists profiles into the RunLog ──────────────────


def test_create_run_persists_driver_profile_in_log(tmp_path, uc01_package, uc01_scenario):
    """create_run writes driver_profile into the persisted RunLog (M5 T003).

    uc01_fatigue_recovery_v0_1 has driver_signal_params — confirm it is
    threaded through into RunLog.driver_profile on disk.
    """
    _plan_and_run(uc01_package, uc01_scenario, "run_dp", tmp_path)
    data = json.loads((tmp_path / "run_dp.json").read_text(encoding="utf-8"))
    log = RunLog(**data)
    # The uc01 scenario has driver_signal_params — must be present in the log
    assert log.driver_profile is not None
    assert isinstance(log.driver_profile, dict)
    # Spot-check: DriverSignalParams has an "id" key
    assert "id" in log.driver_profile


def test_create_run_vehicle_profile_always_none_in_log(tmp_path, uc01_package, uc01_scenario):
    """Feature 009: the vehicle behaviour model is retired — vehicle_profile is
    always None in the persisted RunLog, regardless of scenario content."""
    _plan_and_run(uc01_package, uc01_scenario, "run_vp", tmp_path)
    data = json.loads((tmp_path / "run_vp.json").read_text(encoding="utf-8"))
    log = RunLog(**data)
    assert log.vehicle_profile is None


def test_create_run_persists_speed_profile_in_log(tmp_path, uc01_package, uc01_scenario):
    """create_run writes speed_profile into the persisted RunLog (M5 T003)."""
    _plan_and_run(uc01_package, uc01_scenario, "run_sp", tmp_path)
    data = json.loads((tmp_path / "run_sp.json").read_text(encoding="utf-8"))
    log = RunLog(**data)
    assert log.speed_profile is not None
    assert isinstance(log.speed_profile, dict)


def test_create_run_profiles_none_for_m1_scenario(tmp_path, uc01_package, uc01_scenario):
    """A scenario without profiles produces None profile fields in the log (backward compat, M5 T003).

    Both surviving packages declare their own algorithm.tick_seconds, which
    create_run only permits for M2 (driver_signal_params-bearing) scenarios — see
    the "package-declared tick_seconds is only supported for M2" guard.  To
    exercise the M1 legacy path here, use a package variant with tick_seconds
    cleared (M1/M2 dispatch is driven by the SCENARIO, not the package identity).
    """
    from aica_api.models.scenario import ScenarioDef

    m1_package = uc01_package.model_copy(
        update={"algorithm": uc01_package.algorithm.model_copy(update={"tick_seconds": None})}
    )

    # Build a minimal M1-style scenario without profiles
    m1_data = {
        "id": "uc01_fatigue_friend_drive_v0_1",
        "version": "0.1.0",
        "type": "uc01_fatigue",
        "persona": {"name": "Kenji", "description": "A tired commuter"},
        "route_intent": {
            "rest_facility": {"label": {"ja": "SA花輪", "en": "Hanawa SA"}},
            "segments": [
                {"id": "s0", "name": {"ja": "出発", "en": "Start"}, "type": "start",
                 "at": 0.0, "speed_band": "low", "length_band": "short", "is_rest_facility": False},
                {"id": "s1", "name": {"ja": "SA", "en": "SA"}, "type": "rest",
                 "at": 0.6, "speed_band": "low", "length_band": "short", "is_rest_facility": True},
                {"id": "s2", "name": {"ja": "到着", "en": "End"}, "type": "end",
                 "at": 1.0, "speed_band": "low", "length_band": "short", "is_rest_facility": False},
            ],
        },
        "initial_state": {"drowsiness_level": "mild", "fatigue_level": "medium"},
        "event_presets": {
            "drowsiness_schedule": [{"at": 0.0, "band": "mild"}],
            "signal_duration_at_trigger": "sustained",
            "rest_spot_eta_near_before": "s1",
        },
        "total_duration_seconds": 7200,
        "tick_seconds": 60,
        "allowed_actions": ["accept_rest", "postpone"],
    }
    scenario_no_profiles = ScenarioDef(**m1_data)
    _plan_and_run(m1_package, scenario_no_profiles, "run_m1_no_prof", tmp_path)
    data = json.loads((tmp_path / "run_m1_no_prof.json").read_text(encoding="utf-8"))
    log = RunLog(**data)
    assert log.driver_profile is None
    assert log.vehicle_profile is None
    assert log.speed_profile is None


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
    """First tick (NO_PROPOSAL) should not pause."""
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


def test_tick_pauses_on_rest_proposal(tmp_path, uc01_package, uc01_scenario):
    """At the trigger tick, the run pauses and pending_proposal is set."""
    _plan_and_run(uc01_package, uc01_scenario, "run_pause", tmp_path)
    _tick_to_proposal("run_pause")
    from aica_api.services.run_manager import get_run
    state = get_run("run_pause")
    assert state is not None
    assert state.status == RunStatus.paused
    assert state.pending_proposal is not None


def test_exactly_one_rest_proposal_in_full_run(tmp_path, uc01_package, uc01_scenario):
    """The uc01 recovery fixture fires exactly one REST_PROPOSAL across the full run.

    Regenerated from actual behavior (FR-018): consistent with
    test_end_to_end_run.py's independently-verified single-REST_PROPOSAL result.
    """
    _plan_and_run(uc01_package, uc01_scenario, "run_one_r3", tmp_path)
    rest_proposals = 0
    for _ in range(_MAX_TICKS):
        outcome = tick("run_one_r3")
        if outcome.decision and outcome.decision.result_type == ResultType.REST_PROPOSAL:
            rest_proposals += 1
        if outcome.paused:
            action("run_one_r3", "accept_rest", recovery_option_id="nap_karaoke", rest_spot=_REST_SPOT)
            break
        if outcome.completed:
            break
    assert rest_proposals == 1


# ---------------------------------------------------------------------------
# tick — completed state is a no-op
# ---------------------------------------------------------------------------


def test_tick_past_end_returns_completed(tmp_path, uc01_package, uc01_scenario):
    """Ticking all the way through (declining every proposal) reaches completed=True,
    and a further tick() call after that is a no-op returning completed=True."""
    _plan_and_run(uc01_package, uc01_scenario, "run_completed", tmp_path)
    for _ in range(_MAX_TICKS):
        outcome = tick("run_completed")
        if outcome.paused:
            action("run_completed", "decline")
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
    """On adapter failure with default blocking error_mode:
    - AlgorithmError is appended; decision is None; run is PAUSED (not continued).
    - current_tick does NOT advance.
    - run_state.last_error is populated.
    MIGRATED from M1/M2 continue-on-error to pause-by-default (M3 T009).
    """
    from aica_api.algorithms import adapter as adapter_mod
    from aica_api.algorithms.adapter import AlgorithmAdapterError

    # Patch the adapter to always raise
    def _raise(*args, **kwargs):
        raise AlgorithmAdapterError("algorithm_exception", "injected error")

    monkeypatch.setattr(adapter_mod, "evaluate", _raise)

    # aica_transparent_hybrid_trigger_v1 uses default error_mode="blocking"
    pkg_data = json.loads((_PACKAGE_PATH).read_text(encoding="utf-8"))
    package = PackageManifest(**pkg_data)

    _plan_and_run(package, uc01_scenario, "run_err_test", tmp_path)
    outcome = tick("run_err_test")

    assert outcome.decision is None
    assert outcome.algorithm_error is not None
    # Blocking pause-by-default: the run halts at the broken tick
    assert outcome.paused is True
    assert outcome.run_state.status == RunStatus.paused
    assert outcome.run_state.last_error is not None
    assert outcome.run_state.last_error["error_type"] == "algorithm_exception"
    # current_tick must NOT advance on a blocking error
    assert outcome.run_state.current_tick == 0

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


def test_action_accept_rest_with_option_resumes_into_recovery(tmp_path, uc01_package, uc01_scenario):
    """accept_rest with a valid recovery_option_id starts recovery (status=playing).

    Feature 009: uc01_fatigue_recovery_v0_1 has recovery_options — accept_rest no
    longer completes the run outright (that back-compat path only applies to
    scenarios WITHOUT recovery_options; see test_action_when_not_paused_raises's
    sibling coverage in test_run_manager_recovery.py).
    """
    _plan_and_run(uc01_package, uc01_scenario, "run_accept", tmp_path)
    _tick_to_proposal("run_accept")

    from aica_api.services.run_manager import get_run
    state_before = get_run("run_accept")
    assert state_before.status == RunStatus.paused

    state_after = action(
        "run_accept", "accept_rest", recovery_option_id="nap_karaoke", rest_spot=_REST_SPOT
    )
    assert state_after.status == RunStatus.playing
    assert state_after.pending_proposal is None
    assert state_after.recovery is not None and state_after.recovery.active


def test_action_postpone_resumes_run(tmp_path, uc01_package, uc01_scenario):
    """postpone while paused resumes the run (status back to playing)."""
    _plan_and_run(uc01_package, uc01_scenario, "run_postpone", tmp_path)
    _tick_to_proposal("run_postpone")

    state_after = action("run_postpone", "postpone")
    assert state_after.status == RunStatus.playing
    assert state_after.pending_proposal is None


def test_action_appends_action_event_to_log(tmp_path, uc01_package, uc01_scenario):
    _plan_and_run(uc01_package, uc01_scenario, "run_act_log", tmp_path)
    _tick_to_proposal("run_act_log")

    action("run_act_log", "accept_rest", recovery_option_id="nap_karaoke", rest_spot=_REST_SPOT)

    data = json.loads((tmp_path / "run_act_log.json").read_text(encoding="utf-8"))
    action_events = [e for e in data["events"] if e["kind"] == "action"]
    assert len(action_events) == 1
    assert action_events[0]["action"] == "accept_rest"
    # uc01_fatigue_recovery_v0_1 has recovery_options — accept_rest starts a
    # recovery sequence (status=playing), it does not complete the run outright.
    assert action_events[0]["resulting_status"] == "playing"


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
    _tick_to_proposal("run_bad_act")

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
# T026 — decline action
# ---------------------------------------------------------------------------


def test_action_decline_resumes_run(tmp_path, uc01_package, uc01_scenario):
    """decline while paused resumes the run (status -> playing)."""
    _plan_and_run(uc01_package, uc01_scenario, "run_decline", tmp_path)
    _tick_to_proposal("run_decline")

    state_after = action("run_decline", "decline")
    assert state_after.status == RunStatus.playing
    assert state_after.pending_proposal is None


def test_action_decline_appends_action_event(tmp_path, uc01_package, uc01_scenario):
    """decline is persisted as an ActionEvent with action='decline' and resulting_status='playing'."""
    _plan_and_run(uc01_package, uc01_scenario, "run_decline_log", tmp_path)
    _tick_to_proposal("run_decline_log")

    action("run_decline_log", "decline")

    data = json.loads((tmp_path / "run_decline_log.json").read_text(encoding="utf-8"))
    action_events = [e for e in data["events"] if e["kind"] == "action"]
    assert len(action_events) == 1
    assert action_events[0]["action"] == "decline"
    assert action_events[0]["resulting_status"] == "playing"


def test_decline_repeatedly_reaches_completion(tmp_path, uc01_package, uc01_scenario):
    """Declining every REST_PROPOSAL never gets the run stuck — it keeps resuming
    and eventually reaches completion at route end.

    Regenerated from actual behavior (FR-018): unlike the retired declarative_rule
    package (which fired at most once per run), the hybrid trigger's persistence
    counter + category-specific cooldown (rest_cooldown_sec=600s) let a REST_PROPOSAL
    re-fire after the cooldown window elapses if drowsiness/fatigue are still high —
    observed: 6 REST_PROPOSALs fire over the full 120km route (each declined),
    completing at tick 216.  The invariant worth pinning is not "fires once" but
    "decline always resumes the run, and it always reaches completion."
    """
    _plan_and_run(uc01_package, uc01_scenario, "run_no_reprop", tmp_path)

    declined_count = 0
    rest_proposals = 0
    for _ in range(_MAX_TICKS):
        outcome = tick("run_no_reprop")
        if outcome.decision and outcome.decision.result_type == ResultType.REST_PROPOSAL:
            rest_proposals += 1
        if outcome.paused:
            action("run_no_reprop", "decline")
            declined_count += 1
        if outcome.completed:
            break

    from aica_api.services.run_manager import get_run
    final_state = get_run("run_no_reprop")
    assert declined_count >= 1
    assert rest_proposals >= 1
    assert final_state.status == RunStatus.completed


def test_decline_rejected_when_not_in_allowed_actions(tmp_path, uc01_package, uc01_scenario):
    """decline is rejected (ActionNotAllowedError) when not in scenario.allowed_actions."""
    scenario_no_decline = uc01_scenario.model_copy(
        update={"allowed_actions": ["accept_rest", "postpone"]}
    )
    _plan_and_run(uc01_package, scenario_no_decline, "run_no_decline", tmp_path)
    _tick_to_proposal("run_no_decline")

    with pytest.raises(ActionNotAllowedError):
        action("run_no_decline", "decline")


def test_run_state_has_allowed_actions(tmp_path, uc01_package, uc01_scenario):
    """RunState exposes allowed_actions from the scenario."""
    state = _plan_and_run(uc01_package, uc01_scenario, "run_allowed", tmp_path)
    assert "decline" in state.allowed_actions
    assert "accept_rest" in state.allowed_actions


# ---------------------------------------------------------------------------
# Fix 1: non-actionable proposal must not pause a run (monotony SOFT_WARNING)
# ---------------------------------------------------------------------------


def test_create_run_local_m2_zero_rest_opportunities_raises(
    tmp_path, uc01_package, uc01_scenario
):
    """Fix 1 (Critical): LOCAL M2 scenario with zero rest opportunities must raise ValueError.

    The guard in create_run rejects local-route M2 plans with no rest opportunities
    (signals a failed/empty plan build — failures must never be disguised as a
    normal empty-plan run).  This pins the LOCAL side of the guard.

    The MAPS side (empty Places result is allowed) is covered by
    TestEndToEndEmptyRestRun in test_t012_rest_handling.py.
    """
    from aica_api.models.run import RouteFacts

    # Build route_facts with NO rest spots and local provenance
    empty_rest_route_facts = RouteFacts(
        total_route_distance_km=120.0,
        estimated_route_duration_min=120.0,
        rest_spot_positions=[],   # no rest stops → event_plan.rest_opportunities == []
        route_source="local",     # local, not maps → guard must fire
    )

    plan_id = "plan_local_zero_rest"
    create_draft(
        plan_id=plan_id,
        package=uc01_package,
        scenario=uc01_scenario,   # M2 scenario (has driver_signal_params)
        presets={},
        parameters={},
        hyperparameters={},
        run_mode="standard",
        route_facts=empty_rest_route_facts,
        route_source="local",
    )

    # create_run must reject this draft: local M2 + no rest opportunities
    with pytest.raises(ValueError, match="no rest opportunities"):
        create_run(plan_id, "run_local_zero_rest", tmp_path)


def test_non_actionable_proposal_does_not_pause(
    tmp_path, uc01_package, uc01_scenario, monkeypatch
):
    """A fired proposal whose options have no overlap with scenario.allowed_actions
    must NOT pause the run.  The tick decision is still recorded in the trace.

    The injected option must be one the scenario genuinely does not allow. This
    used to be 'acknowledge', which stopped being an example when uc01 gained it
    so that a monotony proposal the driver took up could be recorded as
    acknowledged rather than declined — the rule under test is unchanged, only
    the option that demonstrates it.
    """
    import aica_api.algorithms.adapter as adapter_mod
    from aica_api.models.decision import (
        Candidate,
        DecisionResult,
        FireControl,
        Proposal,
        ResultType,
    )

    # Monotony SOFT_WARNING whose proposal options are NOT in allowed_actions
    monotony_fc = FireControl(
        fired=True,
        suppressed=False,
        override=False,
        reason="monotony_threshold_crossed",
    )
    monotony_proposal = Proposal(
        id="monotony_sw_001",
        message={"en": "You have been driving monotonously for a while."},
        options=["dismiss_forever"],  # deliberately absent from allowed_actions
    )
    monotony_result = DecisionResult(
        result_type=ResultType.SOFT_WARNING,
        trigger_candidate=True,
        selected_category="monotony_prevention",
        score=0.65,
        features={"monotony": "high"},
        scores={},
        states={},
        criteria={},
        candidates=[
            Candidate(
                category="monotony_prevention",
                exists=True,
                score=0.65,
                state=None,
                strength="gentle",
                fire_control=monotony_fc,
            )
        ],
        fire_control=monotony_fc,
        proposal=monotony_proposal,
        reason_inputs=["monotony"],
        explanation="Monotony SOFT_WARNING — advisory only.",
        next_package_runtime_state={},
    )

    monkeypatch.setattr(adapter_mod, "evaluate", lambda *a, **kw: monotony_result)

    _plan_and_run(uc01_package, uc01_scenario, "run_non_actionable", tmp_path)

    # The tick fires a SOFT_WARNING with options=['acknowledge'] not in allowed_actions.
    outcome = tick("run_non_actionable")

    # Run must NOT pause — options have no overlap with allowed_actions
    assert outcome.paused is False, (
        "A proposal with options outside allowed_actions must NOT pause the run"
    )
    assert outcome.run_state.status == RunStatus.playing, (
        "Run status must remain 'playing' after a non-actionable proposal"
    )
    assert outcome.run_state.pending_proposal is None, (
        "pending_proposal must remain None for a non-actionable proposal"
    )

    # The decision is still present in the outcome (evidence preserved)
    assert outcome.decision is not None, (
        "Decision must still be returned in the outcome even for non-actionable proposal"
    )
    assert outcome.decision.result_type == ResultType.SOFT_WARNING

    # Persisted log must carry the tick event with the decision
    data = json.loads((tmp_path / "run_non_actionable.json").read_text(encoding="utf-8"))
    tick_events = [e for e in data["events"] if e.get("kind") == "tick"]
    assert len(tick_events) == 1, (
        "Tick event must be persisted in the log even for a non-actionable proposal"
    )
    assert tick_events[0]["trace"]["decision_result"]["result_type"] == "SOFT_WARNING"


# ---------------------------------------------------------------------------
# `acknowledge` — the response to a proposal that was TAKEN UP, not dismissed.
# ---------------------------------------------------------------------------
#
# A monotony proposal's own options are ["acknowledge", "decline"], but
# uc01_fatigue_recovery_v0_1 allowed only accept_rest/postpone/decline, so the
# only response its reviewer could record for one was "decline" — the opposite
# of what happened when the driver actually took the content up. The action
# needs no new handling: `action()` already resumes play for anything that is
# not accept_rest; it only had to be admissible.


def test_acknowledge_is_an_allowed_action_on_the_rest_recovery_scenario(uc01_scenario):
    assert "acknowledge" in uc01_scenario.allowed_actions, (
        "a monotony proposal that the driver took up must be recordable as such, "
        "not only as a decline"
    )
    # The rest vocabulary is untouched.
    assert {"accept_rest", "postpone", "decline"} <= set(uc01_scenario.allowed_actions)


def test_action_acknowledge_resolves_a_pending_proposal_and_resumes_play(
    tmp_path, uc01_package, uc01_scenario
):
    _plan_and_run(uc01_package, uc01_scenario, "run_ack", tmp_path)
    _tick_to_proposal("run_ack")

    state_after = action("run_ack", "acknowledge")

    assert state_after.status == RunStatus.playing
    assert state_after.pending_proposal is None

    data = json.loads((tmp_path / "run_ack.json").read_text(encoding="utf-8"))
    acted = [e for e in data["events"] if e["kind"] == "action"]
    assert acted[-1]["action"] == "acknowledge"
    assert acted[-1]["resulting_status"] == "playing"
