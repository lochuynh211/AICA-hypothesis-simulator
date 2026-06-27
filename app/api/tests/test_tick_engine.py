"""TDD tick_engine tests (T016) — written BEFORE implementation; confirm RED then GREEN.

Tests for:
  compute_tick_state(plan, tick_index, scenario) -> TickState
  build_adapter_context(tick_state) -> dict (ordinal bands only)

Key assertion: exactly ONE tick across the UC-01 fixture returns REST_PROPOSAL
when running the engine+adapter tick-by-tick with accept-rest after the first
proposal (simulating the pause/resume mechanism).
"""

from __future__ import annotations

import json
import pathlib

import pytest

from aica_api.models.decision import ResultType
from aica_api.models.run import TickState
from aica_api.models.scenario import ScenarioDef
from aica_api.models.package import PackageManifest
from aica_api.services.event_plan import freeze_event_plan
from aica_api.services.tick_engine import build_adapter_context, compute_tick_state

_REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
_SCENARIO_PATH = _REPO_ROOT / "scenarios" / "uc01_fatigue_friend_drive_v0_1.json"
_PACKAGE_PATH = _REPO_ROOT / "packages" / "rest_rule_based_v0_1" / "package.json"


@pytest.fixture
def uc01_scenario() -> ScenarioDef:
    data = json.loads(_SCENARIO_PATH.read_text(encoding="utf-8"))
    return ScenarioDef(**data)


@pytest.fixture
def uc01_package() -> PackageManifest:
    data = json.loads(_PACKAGE_PATH.read_text(encoding="utf-8"))
    return PackageManifest(**data)


# ---------------------------------------------------------------------------
# compute_tick_state — basic structure
# ---------------------------------------------------------------------------


def test_compute_tick_state_returns_tick_state(uc01_scenario):
    plan = freeze_event_plan(uc01_scenario)
    ts = compute_tick_state(plan, 0, uc01_scenario)
    assert isinstance(ts, TickState)


def test_tick_state_tick_index(uc01_scenario):
    plan = freeze_event_plan(uc01_scenario)
    ts = compute_tick_state(plan, 5, uc01_scenario)
    assert ts.tick_index == 5


def test_tick_state_elapsed_seconds(uc01_scenario):
    plan = freeze_event_plan(uc01_scenario)
    ts = compute_tick_state(plan, 10, uc01_scenario)
    assert ts.elapsed_seconds == 10 * uc01_scenario.tick_seconds


def test_tick_state_route_fraction_tick_zero(uc01_scenario):
    plan = freeze_event_plan(uc01_scenario)
    ts = compute_tick_state(plan, 0, uc01_scenario)
    assert ts.route_fraction == 0.0


def test_tick_state_route_fraction_mid(uc01_scenario):
    plan = freeze_event_plan(uc01_scenario)
    n = len(plan.ticks)
    mid = n // 2
    ts = compute_tick_state(plan, mid, uc01_scenario)
    expected = plan.ticks[mid].route_fraction
    assert abs(ts.route_fraction - expected) < 1e-9


def test_tick_state_fatigue_level_from_initial_state(uc01_scenario):
    """fatigue_level comes from initial_state (constant throughout run)."""
    plan = freeze_event_plan(uc01_scenario)
    ts = compute_tick_state(plan, 0, uc01_scenario)
    assert ts.fatigue_level == uc01_scenario.initial_state["fatigue_level"]


def test_tick_state_drowsiness_level_at_start(uc01_scenario):
    plan = freeze_event_plan(uc01_scenario)
    ts = compute_tick_state(plan, 0, uc01_scenario)
    assert ts.drowsiness_level == "none"


def test_tick_state_drowsiness_level_at_moderate_tick(uc01_scenario):
    """At tick 51 (fraction 0.425 ≥ 0.42), drowsiness_level = 'moderate'."""
    plan = freeze_event_plan(uc01_scenario)
    ts = compute_tick_state(plan, 51, uc01_scenario)
    assert ts.drowsiness_level == "moderate"


def test_tick_state_completed_false_for_valid_tick(uc01_scenario):
    plan = freeze_event_plan(uc01_scenario)
    ts = compute_tick_state(plan, 0, uc01_scenario)
    assert ts.completed is False


def test_tick_state_completed_true_past_last_index(uc01_scenario):
    """Ticking past the last valid index returns completed=True."""
    plan = freeze_event_plan(uc01_scenario)
    past_last = len(plan.ticks)  # one beyond the valid range
    ts = compute_tick_state(plan, past_last, uc01_scenario)
    assert ts.completed is True


def test_tick_state_completed_true_far_past_last(uc01_scenario):
    """Ticking far past the end still returns completed=True."""
    plan = freeze_event_plan(uc01_scenario)
    ts = compute_tick_state(plan, 9999, uc01_scenario)
    assert ts.completed is True


def test_tick_state_completed_route_fraction_one_past_last(uc01_scenario):
    """route_fraction is 1.0 when completed."""
    plan = freeze_event_plan(uc01_scenario)
    ts = compute_tick_state(plan, len(plan.ticks), uc01_scenario)
    assert ts.route_fraction == 1.0


def test_tick_state_has_active_segment_id(uc01_scenario):
    plan = freeze_event_plan(uc01_scenario)
    ts = compute_tick_state(plan, 0, uc01_scenario)
    assert ts.active_segment_id == "seg_start"


# ---------------------------------------------------------------------------
# build_adapter_context — ordinal bands only
# ---------------------------------------------------------------------------


def test_build_adapter_context_returns_dict(uc01_scenario):
    plan = freeze_event_plan(uc01_scenario)
    ts = compute_tick_state(plan, 0, uc01_scenario)
    ctx = build_adapter_context(ts)
    assert isinstance(ctx, dict)


def test_adapter_context_all_string_values(uc01_scenario):
    """Qualitative discipline: context contains only string (ordinal) values."""
    plan = freeze_event_plan(uc01_scenario)
    ts = compute_tick_state(plan, 51, uc01_scenario)
    ctx = build_adapter_context(ts)
    for key, val in ctx.items():
        assert isinstance(val, str), f"Context key {key!r} has non-string value: {val!r}"


def test_adapter_context_has_required_keys(uc01_scenario):
    """Context must contain the five feature keys the adapter/algorithm expects."""
    plan = freeze_event_plan(uc01_scenario)
    ts = compute_tick_state(plan, 51, uc01_scenario)
    ctx = build_adapter_context(ts)
    required = {
        "drowsiness_level", "fatigue_level", "signal_duration",
        "continuous_driving_time", "rest_spot_eta",
    }
    assert required.issubset(ctx.keys())


def test_adapter_context_drowsiness_at_trigger_tick(uc01_scenario):
    """At tick 51 (first 'moderate' tick), drowsiness_level = 'moderate'."""
    plan = freeze_event_plan(uc01_scenario)
    ts = compute_tick_state(plan, 51, uc01_scenario)
    ctx = build_adapter_context(ts)
    assert ctx["drowsiness_level"] == "moderate"


def test_adapter_context_no_raw_numbers(uc01_scenario):
    """No numeric values appear in the context (qualitative discipline)."""
    plan = freeze_event_plan(uc01_scenario)
    for tick_idx in [0, 30, 51, 60]:
        if tick_idx < len(plan.ticks):
            ts = compute_tick_state(plan, tick_idx, uc01_scenario)
            ctx = build_adapter_context(ts)
            for key, val in ctx.items():
                assert not isinstance(val, (int, float)), (
                    f"Raw number {val!r} found at key {key!r} for tick {tick_idx}"
                )


# ---------------------------------------------------------------------------
# Exactly one REST_PROPOSAL across the UC-01 run (assert by running the
# engine+adapter tick-by-tick with accept-rest after first proposal)
# ---------------------------------------------------------------------------


def test_uc01_exactly_one_rest_proposal(uc01_scenario, uc01_package):
    """Running the full engine+adapter tick loop (with pause on proposal) yields
    exactly ONE REST_PROPOSAL, and all pre-proposal results are NO_TRIGGER or
    SOFT_WARNING.
    """
    from aica_api.algorithms.adapter import evaluate

    hyperparameters = {hp.key: hp.default for hp in uc01_package.hyperparameters}
    parameters = {}

    plan = freeze_event_plan(uc01_scenario)
    n_ticks = len(plan.ticks)

    pre_trigger_results = []
    rest_proposals = 0

    for tick_idx in range(n_ticks):
        ts = compute_tick_state(plan, tick_idx, uc01_scenario)
        if ts.completed:
            break
        ctx = build_adapter_context(ts)
        result = evaluate(uc01_package, ctx, parameters, hyperparameters, [], {})

        if result.result_type == ResultType.REST_PROPOSAL:
            rest_proposals += 1
            # Simulate accept_rest → run pauses here and then completes.
            break
        else:
            pre_trigger_results.append(result.result_type)

    assert rest_proposals == 1, (
        f"Expected exactly 1 REST_PROPOSAL; got {rest_proposals}"
    )
    assert all(
        rt in (ResultType.NO_TRIGGER, ResultType.SOFT_WARNING)
        for rt in pre_trigger_results
    ), f"Pre-trigger results include unexpected types: {set(pre_trigger_results)}"


def test_uc01_pre_trigger_ticks_have_no_trigger_or_soft_warning(uc01_scenario, uc01_package):
    """No REST_PROPOSAL or higher should appear before the trigger tick."""
    from aica_api.algorithms.adapter import evaluate

    hyperparameters = {hp.key: hp.default for hp in uc01_package.hyperparameters}
    plan = freeze_event_plan(uc01_scenario)

    for tick_idx in range(len(plan.ticks)):
        ts = compute_tick_state(plan, tick_idx, uc01_scenario)
        ctx = build_adapter_context(ts)
        result = evaluate(uc01_package, ctx, {}, hyperparameters, [], {})
        if result.result_type == ResultType.REST_PROPOSAL:
            break
        assert result.result_type in (
            ResultType.NO_TRIGGER,
            ResultType.SOFT_WARNING,
        ), (
            f"Tick {tick_idx} returned {result.result_type!r} before R3 fired"
        )


# ---------------------------------------------------------------------------
# Determinism
# ---------------------------------------------------------------------------


def test_tick_engine_deterministic_two_passes(uc01_scenario, uc01_package):
    """Two independent tick-by-tick passes over the same plan produce identical results."""
    from aica_api.algorithms.adapter import evaluate

    hyperparameters = {hp.key: hp.default for hp in uc01_package.hyperparameters}
    plan = freeze_event_plan(uc01_scenario)

    def _run_pass():
        results = []
        for tick_idx in range(len(plan.ticks)):
            ts = compute_tick_state(plan, tick_idx, uc01_scenario)
            ctx = build_adapter_context(ts)
            result = evaluate(uc01_package, ctx, {}, hyperparameters, [], {})
            results.append(result.result_type)
            if result.result_type == ResultType.REST_PROPOSAL:
                break
        return results

    pass_a = _run_pass()
    pass_b = _run_pass()
    assert pass_a == pass_b


def test_same_plan_same_tick_states(uc01_scenario):
    """Same plan + tick_index → identical TickState."""
    plan = freeze_event_plan(uc01_scenario)
    ts_a = compute_tick_state(plan, 51, uc01_scenario)
    ts_b = compute_tick_state(plan, 51, uc01_scenario)
    assert ts_a.model_dump() == ts_b.model_dump()
