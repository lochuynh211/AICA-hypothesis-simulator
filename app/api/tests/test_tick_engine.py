"""Tick engine tests (T013 migration) — M1 + M2 tick engine tests.

M1 tests: compute_tick_state(plan, tick_index, scenario) — kept while M1 path used.
M2 tests: advance_tick(prior_state, tick_index, event_plan, route_facts, scenario) — new.

Key assertions:
  - M2: feature_groups.ordinal are strings; raw_state is present with numeric values.
  - M2: determinism (same inputs → identical TickState).
  - (NOT M1's test_adapter_context_no_raw_numbers — raw_state is intentionally numeric in M2)
"""

from __future__ import annotations

import json
import pathlib

import pytest

from aica_api.models.decision import ResultType
from aica_api.models.run import EventPlan, FeatureGroups, RouteFacts, TickState
from aica_api.models.scenario import ScenarioDef
from aica_api.models.package import PackageManifest
from aica_api.services.event_plan import build_event_plan, freeze_event_plan
from aica_api.services.route_analysis import analyze_route
from aica_api.services.tick_engine import advance_tick, build_adapter_context, compute_tick_state

_REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
_SCENARIO_PATH = _REPO_ROOT / "scenarios" / "uc01_fatigue_friend_drive_v0_1.json"
_PACKAGE_PATH = _REPO_ROOT / "packages" / "rest_rule_based_v0_1" / "package.json"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def uc01_scenario() -> ScenarioDef:
    data = json.loads(_SCENARIO_PATH.read_text(encoding="utf-8"))
    data.pop("_comment", None)
    return ScenarioDef.model_validate(data)


@pytest.fixture
def uc01_package() -> PackageManifest:
    data = json.loads(_PACKAGE_PATH.read_text(encoding="utf-8"))
    return PackageManifest(**data)


def _make_m2_scenario(*, total_km: float = 120.0) -> ScenarioDef:
    """Build a minimal M2 ScenarioDef with driver/vehicle/speed profiles."""
    from aica_api.models.profile import (
        AdasWarningProfile,
        AttentionModel,
        DrowsinessModel,
        DriverModelProfile,
        FatigueModel,
        LaneDepartureProfile,
        PedalAbnormalityProfile,
        RecoveryModel,
        SpeedProfile,
        SteeringInstabilityProfile,
        VehicleBehaviorProfile,
    )

    driver_profile = DriverModelProfile(
        id="test_driver",
        drowsiness_model=DrowsinessModel(
            base_growth_per_min=0.5,
            night_add_per_min=0.3,
            monotony_add_per_min=0.3,
            traffic_jam_add_per_min=0.1,
        ),
        fatigue_model=FatigueModel(
            base_growth_per_min=0.3,
            continuous_driving_add_per_min_after_60_min=0.2,
            mountain_road_add_per_min=0.2,
            traffic_jam_add_per_min=0.05,
        ),
        attention_model=AttentionModel(
            base_recovery_per_min=0.1,
            monotony_drop_per_min=0.15,
            drowsiness_drop_factor=0.3,
            active_content_recovery_per_min=0.5,
        ),
        recovery_model=RecoveryModel(
            short_rest_drowsiness_recovery=20.0,
            short_rest_fatigue_recovery=15.0,
            long_rest_drowsiness_recovery=35.0,
            long_rest_fatigue_recovery=30.0,
        ),
    )
    vehicle_profile = VehicleBehaviorProfile(
        rolling_window_seconds=300,
        steering_instability=SteeringInstabilityProfile(
            base_level=5.0, drowsiness_factor=0.2, fatigue_factor=0.1,
            mountain_road_add=8.0, traffic_jam_reduce=3.0,
        ),
        lane_departure=LaneDepartureProfile(
            enabled_on=["highway", "normal_road"],
            drowsiness_threshold=60.0, fatigue_threshold=70.0,
            count_when_threshold_exceeded=1,
        ),
        pedal_abnormality=PedalAbnormalityProfile(
            base_level=3.0, fatigue_factor=0.1,
            traffic_jam_add=8.0, mountain_road_add=5.0,
        ),
        adas_warning=AdasWarningProfile(
            lane_departure_warning_threshold=1.0,
            steering_instability_warning_threshold=55.0,
        ),
    )
    speed_profile = SpeedProfile(
        normal_road_kph=60, highway_kph=100,
        mountain_road_kph=40, sightseeing_road_kph=30,
        traffic_jam_kph=20,
    )

    segments = [
        {
            "id": "seg_start", "name": {"ja": "出発", "en": "Start"},
            "type": "start", "at": 0.0,
            "speed_band": "slow", "length_band": "short", "is_rest_facility": False,
        },
        {
            "id": "seg_rest", "name": {"ja": "休憩", "en": "Rest"},
            "type": "rest", "at": 0.5,
            "speed_band": "slow", "length_band": "short", "is_rest_facility": True,
        },
        {
            "id": "seg_end", "name": {"ja": "終点", "en": "End"},
            "type": "end", "at": 1.0,
            "speed_band": "slow", "length_band": "short", "is_rest_facility": False,
        },
    ]

    return ScenarioDef(
        id="test_m2",
        version="0.1.0",
        type="uc01_fatigue",
        persona={"name": "Test Driver"},
        route_intent={
            "rest_facility": {"label": {"ja": "休憩", "en": "Rest"}},
            "segments": segments,
        },
        initial_state={"drowsiness_level": "none", "fatigue_level": "low"},
        event_presets={"signal_duration_at_trigger": "transient"},
        total_duration_seconds=7200,
        tick_seconds=60,
        allowed_actions=["accept_rest", "postpone"],
        driver_profile=driver_profile,
        vehicle_profile=vehicle_profile,
        speed_profile=speed_profile,
        presets={"total_route_distance_km": total_km},
    )


@pytest.fixture
def m2_scenario() -> ScenarioDef:
    return _make_m2_scenario()


def _make_m1_scenario() -> ScenarioDef:
    """Build a minimal M1 ScenarioDef with a drowsiness schedule (no driver_profile).

    Replicates the old M1 UC-01 schedule so M1 compute_tick_state tests remain valid
    after the real scenario file was re-authored to M2 format.
    """
    segments = [
        {
            "id": "seg_start", "name": {"ja": "出発", "en": "Start"},
            "type": "start", "at": 0.0,
            "speed_band": "slow", "length_band": "short", "is_rest_facility": False,
        },
        {
            "id": "seg_rest", "name": {"ja": "休憩", "en": "Rest"},
            "type": "rest", "at": 0.5,
            "speed_band": "slow", "length_band": "short", "is_rest_facility": True,
        },
        {
            "id": "seg_end", "name": {"ja": "終点", "en": "End"},
            "type": "end", "at": 1.0,
            "speed_band": "slow", "length_band": "short", "is_rest_facility": False,
        },
    ]
    return ScenarioDef(
        id="test_m1",
        version="0.1.0",
        type="uc01_fatigue",
        persona={"name": "Test Driver"},
        route_intent={
            "rest_facility": {"label": {"ja": "休憩", "en": "Rest"}},
            "segments": segments,
        },
        initial_state={"drowsiness_level": "none", "fatigue_level": "medium"},
        event_presets={
            "drowsiness_schedule": [
                {"at": 0.0, "band": "none"},
                {"at": 0.3, "band": "weak"},
                {"at": 0.42, "band": "moderate"},
            ],
            "signal_duration_at_trigger": "sustained",
            "signal_duration_schedule": [
                {"at": 0.0, "band": "transient"},
                {"at": 0.3, "band": "brief"},
                {"at": 0.42, "band": "sustained"},
            ],
            "rest_spot_eta_near_before": "seg_rest",
        },
        total_duration_seconds=7200,
        tick_seconds=60,
        allowed_actions=["accept_rest", "postpone"],
    )


@pytest.fixture
def m1_scenario() -> ScenarioDef:
    """M1-style scenario with explicit drowsiness_schedule for M1 compute_tick_state tests."""
    return _make_m1_scenario()


@pytest.fixture
def m2_route_facts(m2_scenario) -> RouteFacts:
    return analyze_route(m2_scenario)


@pytest.fixture
def m2_event_plan(m2_route_facts, m2_scenario) -> EventPlan:
    return build_event_plan(m2_route_facts, m2_scenario)


# ---------------------------------------------------------------------------
# M1: compute_tick_state — kept while M1 path is still used by run_manager
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
    plan = freeze_event_plan(uc01_scenario)
    ts = compute_tick_state(plan, 0, uc01_scenario)
    assert ts.fatigue_level == uc01_scenario.initial_state["fatigue_level"]


def test_tick_state_drowsiness_level_at_start(uc01_scenario):
    plan = freeze_event_plan(uc01_scenario)
    ts = compute_tick_state(plan, 0, uc01_scenario)
    assert ts.drowsiness_level == "none"


def test_tick_state_drowsiness_level_at_moderate_tick(m1_scenario):
    """M1: drowsiness reaches 'moderate' at the expected tick index."""
    plan = freeze_event_plan(m1_scenario)
    ts = compute_tick_state(plan, 51, m1_scenario)
    assert ts.drowsiness_level == "moderate"


def test_tick_state_completed_false_for_valid_tick(uc01_scenario):
    plan = freeze_event_plan(uc01_scenario)
    ts = compute_tick_state(plan, 0, uc01_scenario)
    assert ts.completed is False


def test_tick_state_completed_true_past_last_index(uc01_scenario):
    plan = freeze_event_plan(uc01_scenario)
    past_last = len(plan.ticks)
    ts = compute_tick_state(plan, past_last, uc01_scenario)
    assert ts.completed is True


def test_tick_state_completed_true_far_past_last(uc01_scenario):
    plan = freeze_event_plan(uc01_scenario)
    ts = compute_tick_state(plan, 9999, uc01_scenario)
    assert ts.completed is True


def test_tick_state_completed_route_fraction_one_past_last(uc01_scenario):
    plan = freeze_event_plan(uc01_scenario)
    ts = compute_tick_state(plan, len(plan.ticks), uc01_scenario)
    assert ts.route_fraction == 1.0


def test_tick_state_has_active_segment_id(uc01_scenario):
    plan = freeze_event_plan(uc01_scenario)
    ts = compute_tick_state(plan, 0, uc01_scenario)
    assert ts.active_segment_id == "seg_start"


# ---------------------------------------------------------------------------
# M1: build_adapter_context
# ---------------------------------------------------------------------------


def test_build_adapter_context_returns_dict(uc01_scenario):
    plan = freeze_event_plan(uc01_scenario)
    ts = compute_tick_state(plan, 0, uc01_scenario)
    ctx = build_adapter_context(ts)
    assert isinstance(ctx, dict)


def test_adapter_context_all_string_values(uc01_scenario):
    """M1: context contains only string (ordinal) values."""
    plan = freeze_event_plan(uc01_scenario)
    ts = compute_tick_state(plan, 51, uc01_scenario)
    ctx = build_adapter_context(ts)
    for key, val in ctx.items():
        assert isinstance(val, str), f"Context key {key!r} has non-string value: {val!r}"


def test_adapter_context_has_required_keys(uc01_scenario):
    plan = freeze_event_plan(uc01_scenario)
    ts = compute_tick_state(plan, 51, uc01_scenario)
    ctx = build_adapter_context(ts)
    required = {
        "drowsiness_level", "fatigue_level", "signal_duration",
        "continuous_driving_time", "rest_spot_eta",
    }
    assert required.issubset(ctx.keys())


def test_adapter_context_drowsiness_at_trigger_tick(m1_scenario):
    """M1: adapter context has drowsiness_level='moderate' at the trigger tick."""
    plan = freeze_event_plan(m1_scenario)
    ts = compute_tick_state(plan, 51, m1_scenario)
    ctx = build_adapter_context(ts)
    assert ctx["drowsiness_level"] == "moderate"


# ---------------------------------------------------------------------------
# M1: Exactly one REST_PROPOSAL (using M1 path)
# ---------------------------------------------------------------------------


def test_uc01_exactly_one_rest_proposal(m1_scenario, uc01_package):
    from aica_api.algorithms.adapter import evaluate

    hyperparameters = {hp.key: hp.default for hp in uc01_package.hyperparameters}
    plan = freeze_event_plan(m1_scenario)
    n_ticks = len(plan.ticks)

    pre_trigger_results = []
    rest_proposals = 0

    for tick_idx in range(n_ticks):
        ts = compute_tick_state(plan, tick_idx, m1_scenario)
        if ts.completed:
            break
        ctx = build_adapter_context(ts)
        result = evaluate(uc01_package, ctx, {}, hyperparameters, [], {})

        if result.result_type == ResultType.REST_PROPOSAL:
            rest_proposals += 1
            break
        else:
            pre_trigger_results.append(result.result_type)

    assert rest_proposals == 1
    assert all(
        rt in (ResultType.NO_TRIGGER, ResultType.SOFT_WARNING)
        for rt in pre_trigger_results
    )


def test_uc01_pre_trigger_ticks_have_no_trigger_or_soft_warning(uc01_scenario, uc01_package):
    """M2: pre-proposal ticks are NO_TRIGGER or SOFT_WARNING under the profile-driven engine.

    Uses the M2 advance_tick path so drowsiness actually builds from the
    driver profile, giving meaningful signal before the REST_PROPOSAL fires.
    """
    from aica_api.algorithms.adapter import evaluate

    hyperparameters = {hp.key: hp.default for hp in uc01_package.hyperparameters}
    route_facts = analyze_route(uc01_scenario)
    event_plan = build_event_plan(route_facts, uc01_scenario)
    n_ticks = uc01_scenario.total_duration_seconds // uc01_scenario.tick_seconds

    ts = None
    for tick_idx in range(n_ticks):
        ts = advance_tick(ts, tick_idx, event_plan, route_facts, uc01_scenario)
        if ts.completed:
            break
        ctx = build_adapter_context(ts)
        result = evaluate(uc01_package, ctx, {}, hyperparameters, [], {})
        if result.result_type == ResultType.REST_PROPOSAL:
            break
        assert result.result_type in (ResultType.NO_TRIGGER, ResultType.SOFT_WARNING), (
            f"tick {tick_idx}: expected NO_TRIGGER or SOFT_WARNING, got {result.result_type}"
        )


# ---------------------------------------------------------------------------
# M1: Determinism
# ---------------------------------------------------------------------------


def test_tick_engine_deterministic_two_passes(uc01_scenario, uc01_package):
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

    assert _run_pass() == _run_pass()


def test_same_plan_same_tick_states(uc01_scenario):
    plan = freeze_event_plan(uc01_scenario)
    ts_a = compute_tick_state(plan, 51, uc01_scenario)
    ts_b = compute_tick_state(plan, 51, uc01_scenario)
    assert ts_a.model_dump() == ts_b.model_dump()


# ---------------------------------------------------------------------------
# M2: advance_tick — basic structure
# ---------------------------------------------------------------------------


def test_advance_tick_returns_tick_state(m2_scenario, m2_event_plan, m2_route_facts):
    ts = advance_tick(None, 0, m2_event_plan, m2_route_facts, m2_scenario)
    assert isinstance(ts, TickState)


def test_advance_tick_tick_index_set(m2_scenario, m2_event_plan, m2_route_facts):
    ts = advance_tick(None, 5, m2_event_plan, m2_route_facts, m2_scenario)
    assert ts.tick_index == 5


def test_advance_tick_has_raw_state(m2_scenario, m2_event_plan, m2_route_facts):
    ts = advance_tick(None, 0, m2_event_plan, m2_route_facts, m2_scenario)
    assert isinstance(ts.raw_state, dict)
    assert len(ts.raw_state) > 0


def test_advance_tick_has_feature_groups(m2_scenario, m2_event_plan, m2_route_facts):
    ts = advance_tick(None, 0, m2_event_plan, m2_route_facts, m2_scenario)
    assert isinstance(ts.feature_groups, FeatureGroups)


def test_advance_tick_feature_groups_ordinal_are_strings(m2_scenario, m2_event_plan, m2_route_facts):
    """M2: feature_groups.ordinal values are all strings (qualitative bands)."""
    ts = advance_tick(None, 0, m2_event_plan, m2_route_facts, m2_scenario)
    for key, val in ts.feature_groups.ordinal.items():
        assert isinstance(val, str), f"ordinal[{key!r}] = {val!r} is not a string"


def test_advance_tick_raw_state_has_numeric_drowsiness(m2_scenario, m2_event_plan, m2_route_facts):
    """M2: raw_state carries numeric drowsiness (allowed; simulator-internal)."""
    ts = advance_tick(None, 0, m2_event_plan, m2_route_facts, m2_scenario)
    assert "drowsinessLevel" in ts.raw_state
    assert isinstance(ts.raw_state["drowsinessLevel"], (int, float))


def test_advance_tick_distance_km_advances(m2_scenario, m2_event_plan, m2_route_facts):
    """After one tick at 60 kph with 60s tick: distance = 1 km."""
    ts = advance_tick(None, 0, m2_event_plan, m2_route_facts, m2_scenario)
    assert ts.distance_km == pytest.approx(1.0)  # 60 kph * 60s / 3600 = 1 km


def test_advance_tick_position_advances_correctly(m2_scenario, m2_event_plan, m2_route_facts):
    """Position after k ticks = k * speed * tick_seconds / 3600."""
    # Run 10 ticks to accumulate position
    ts = None
    for i in range(10):
        ts = advance_tick(ts, i, m2_event_plan, m2_route_facts, m2_scenario)
    # 10 ticks × 60 kph × 60s / 3600 = 10 km
    assert ts.distance_km == pytest.approx(10.0)


def test_advance_tick_drowsiness_increases(m2_scenario, m2_event_plan, m2_route_facts):
    """Drowsiness increases each tick (base_growth=0.5/min, monotony=0.3/min = 0.8/min)."""
    ts0 = advance_tick(None, 0, m2_event_plan, m2_route_facts, m2_scenario)
    ts1 = advance_tick(ts0, 1, m2_event_plan, m2_route_facts, m2_scenario)
    d0 = ts0.raw_state["drowsinessLevel"]
    d1 = ts1.raw_state["drowsinessLevel"]
    assert d1 > d0


def test_advance_tick_completed_when_distance_past_total(m2_scenario, m2_event_plan, m2_route_facts):
    """Advance until distance >= total_km → completed=True."""
    total_km = m2_route_facts.total_route_distance_km  # 120 km
    # At 60 kph for 60s/tick, need 120 ticks to travel 120 km
    ts = None
    n_ticks = int(total_km)  # ≥ ticks needed at 1 km/tick
    for i in range(n_ticks + 5):
        ts = advance_tick(ts, i, m2_event_plan, m2_route_facts, m2_scenario)
        if ts.completed:
            break
    assert ts.completed is True


def test_advance_tick_not_completed_early(m2_scenario, m2_event_plan, m2_route_facts):
    """First tick should not be completed (route is much longer than 1 tick)."""
    ts = advance_tick(None, 0, m2_event_plan, m2_route_facts, m2_scenario)
    assert ts.completed is False


# ---------------------------------------------------------------------------
# M2: build_adapter_context with M2 tick state
# ---------------------------------------------------------------------------


def test_m2_build_adapter_context_has_feature_groups(m2_scenario, m2_event_plan, m2_route_facts):
    """M2 context: build_adapter_context returns feature_groups + raw_state."""
    ts = advance_tick(None, 0, m2_event_plan, m2_route_facts, m2_scenario)
    ctx = build_adapter_context(ts)
    assert "feature_groups" in ctx
    assert "raw_state" in ctx


def test_m2_build_adapter_context_feature_groups_ordinal_present(m2_scenario, m2_event_plan, m2_route_facts):
    """M2 context: feature_groups.ordinal has required keys."""
    ts = advance_tick(None, 0, m2_event_plan, m2_route_facts, m2_scenario)
    ctx = build_adapter_context(ts)
    ordinal = ctx["feature_groups"]["ordinal"]
    required = {"drowsiness_level", "fatigue_level", "signal_duration",
                "rest_spot_eta", "continuous_driving_time"}
    assert required.issubset(ordinal.keys())


def test_m2_build_adapter_context_ordinal_values_are_strings(m2_scenario, m2_event_plan, m2_route_facts):
    ts = advance_tick(None, 0, m2_event_plan, m2_route_facts, m2_scenario)
    ctx = build_adapter_context(ts)
    for key, val in ctx["feature_groups"]["ordinal"].items():
        assert isinstance(val, str), f"ordinal[{key!r}] = {val!r}"


# ---------------------------------------------------------------------------
# M2: Determinism
# ---------------------------------------------------------------------------


def test_advance_tick_deterministic(m2_scenario, m2_event_plan, m2_route_facts):
    """Same inputs → same TickState (pure function)."""
    ts_a = advance_tick(None, 0, m2_event_plan, m2_route_facts, m2_scenario)
    ts_b = advance_tick(None, 0, m2_event_plan, m2_route_facts, m2_scenario)
    assert ts_a.raw_state == ts_b.raw_state
    assert ts_a.feature_groups.ordinal == ts_b.feature_groups.ordinal


def test_advance_tick_two_passes_identical(m2_scenario, m2_event_plan, m2_route_facts):
    """Two independent 10-tick runs produce identical raw_state sequences."""
    def _run():
        ts = None
        states = []
        for i in range(10):
            ts = advance_tick(ts, i, m2_event_plan, m2_route_facts, m2_scenario)
            states.append(ts.raw_state.copy())
        return states

    assert _run() == _run()


# ---------------------------------------------------------------------------
# _initial_drowsiness / _initial_fatigue — numeric branch (Task A)
# ---------------------------------------------------------------------------


from aica_api.services.tick_engine import _initial_drowsiness, _initial_fatigue


def test_initial_drowsiness_numeric():
    """Numeric input is clamped to [0, 100] and returned as float."""
    assert _initial_drowsiness(80) == 80.0
    assert _initial_drowsiness(0) == 0.0
    assert _initial_drowsiness(100) == 100.0
    assert _initial_drowsiness(150) == 100.0   # clamped at upper bound
    assert _initial_drowsiness(-10) == 0.0     # clamped at lower bound
    assert isinstance(_initial_drowsiness(80), float)


def test_initial_fatigue_numeric():
    """Numeric input is clamped to [0, 100] and returned as float."""
    assert _initial_fatigue(30) == 30.0
    assert _initial_fatigue(0) == 0.0
    assert _initial_fatigue(100) == 100.0
    assert _initial_fatigue(150) == 100.0      # clamped
    assert _initial_fatigue(-10) == 0.0        # clamped
    assert isinstance(_initial_fatigue(30), float)


def test_initial_drowsiness_band_unchanged():
    """Band-string path is unchanged by the numeric branch."""
    assert _initial_drowsiness("none") == 0.0
    assert _initial_drowsiness("weak") == 20.0
    assert _initial_drowsiness("moderate") == 40.0
    assert _initial_drowsiness("strong") == 60.0
    assert _initial_drowsiness("severe") == 80.0
    assert _initial_drowsiness("unknown_band") == 0.0  # default


def test_initial_fatigue_band_unchanged():
    """Band-string path is unchanged by the numeric branch."""
    assert _initial_fatigue("low") == 0.0
    assert _initial_fatigue("medium") == 30.0
    assert _initial_fatigue("high") == 60.0
    assert _initial_fatigue("unknown_band") == 0.0  # default
