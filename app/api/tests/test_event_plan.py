"""Event plan tests (T012) — tests for both M1 freeze_event_plan and M2 build_event_plan.

M1 tests for freeze_event_plan are retained while run_manager still uses it.
M2 tests for build_event_plan validate the new profile-driven event schedule.
"""

from __future__ import annotations

import json
import pathlib

import pytest

from aica_api.models.run import EventPlan
from aica_api.models.scenario import ScenarioDef
from aica_api.services.event_plan import build_event_plan, freeze_event_plan
from aica_api.services.route_analysis import analyze_route

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

_REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
_SCENARIO_PATH = _REPO_ROOT / "scenarios" / "uc01_fatigue_friend_drive_v0_1.json"


@pytest.fixture
def uc01_scenario() -> ScenarioDef:
    """Load the real UC-01 scenario fixture from disk."""
    data = json.loads(_SCENARIO_PATH.read_text(encoding="utf-8"))
    data.pop("_comment", None)
    return ScenarioDef.model_validate(data)


def _minimal_scenario(
    *,
    total_duration: int = 3600,
    tick_seconds: int = 60,
    drowsiness_schedule: list[dict] | None = None,
    signal_duration_schedule: list[dict] | None = None,
    signal_duration_at_trigger: str = "transient",
    rest_spot_eta_near_before: str | None = None,
    presets: dict | None = None,
) -> ScenarioDef:
    """Build a minimal ScenarioDef for isolated event-plan tests."""
    ds = drowsiness_schedule or [{"at": 0.0, "band": "none"}]
    ep_data: dict = {
        "drowsiness_schedule": ds,
        "signal_duration_at_trigger": signal_duration_at_trigger,
    }
    if signal_duration_schedule is not None:
        ep_data["signal_duration_schedule"] = signal_duration_schedule
    if rest_spot_eta_near_before is not None:
        ep_data["rest_spot_eta_near_before"] = rest_spot_eta_near_before

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
        id="test_scenario",
        version="0.1.0",
        type="uc01_fatigue",
        persona={"name": "Test Driver"},
        route_intent={
            "rest_facility": {"label": {"ja": "テスト", "en": "Test"}},
            "segments": segments,
        },
        initial_state={"drowsiness_level": "none", "fatigue_level": "low"},
        event_presets=ep_data,
        total_duration_seconds=total_duration,
        tick_seconds=tick_seconds,
        allowed_actions=["accept_rest", "postpone"],
        presets=presets or {},
    )


# ---------------------------------------------------------------------------
# M1: freeze_event_plan (kept while run_manager still uses it)
# ---------------------------------------------------------------------------


def test_freeze_returns_event_plan(uc01_scenario):
    from aica_api.models.run import EventPlan
    plan = freeze_event_plan(uc01_scenario)
    assert isinstance(plan, EventPlan)


def test_tick_count_equals_duration_over_tick_seconds(uc01_scenario):
    """Plan has total_duration // tick_seconds entries (0..N-1)."""
    plan = freeze_event_plan(uc01_scenario)
    expected = uc01_scenario.total_duration_seconds // uc01_scenario.tick_seconds
    assert len(plan.ticks) == expected


def test_tick_indices_are_sequential(uc01_scenario):
    plan = freeze_event_plan(uc01_scenario)
    for i, entry in enumerate(plan.ticks):
        assert entry.tick_index == i


def test_route_fraction_at_tick_zero_is_zero(uc01_scenario):
    plan = freeze_event_plan(uc01_scenario)
    assert plan.ticks[0].route_fraction == 0.0


def test_route_fraction_grows_monotonically(uc01_scenario):
    plan = freeze_event_plan(uc01_scenario)
    fracs = [e.route_fraction for e in plan.ticks]
    for a, b in zip(fracs, fracs[1:]):
        assert b >= a


def test_route_fraction_clamped_to_one(uc01_scenario):
    """The last tick's route_fraction must be ≤ 1.0."""
    plan = freeze_event_plan(uc01_scenario)
    assert all(e.route_fraction <= 1.0 for e in plan.ticks)


def test_drowsiness_band_none_at_start(uc01_scenario):
    """Tick 0 (fraction 0.0) → drowsiness = 'none'."""
    plan = freeze_event_plan(uc01_scenario)
    assert plan.ticks[0].drowsiness_band == "none"


def test_drowsiness_band_weak_at_fraction_030():
    """M1: drowsiness_schedule step-hold → 'weak' at fraction 0.30."""
    scenario = _minimal_scenario(
        drowsiness_schedule=[
            {"at": 0.0, "band": "none"},
            {"at": 0.3, "band": "weak"},
            {"at": 0.42, "band": "moderate"},
        ]
    )
    plan = freeze_event_plan(scenario)
    tick_seconds = scenario.tick_seconds
    total = scenario.total_duration_seconds
    tick_030 = int(0.30 * total / tick_seconds)
    assert plan.ticks[tick_030].drowsiness_band == "weak"


def test_drowsiness_band_moderate_at_fraction_042():
    """M1: drowsiness_schedule step-hold → 'moderate' at fraction 0.42."""
    scenario = _minimal_scenario(
        drowsiness_schedule=[
            {"at": 0.0, "band": "none"},
            {"at": 0.3, "band": "weak"},
            {"at": 0.42, "band": "moderate"},
        ]
    )
    plan = freeze_event_plan(scenario)
    tick_seconds = scenario.tick_seconds
    total = scenario.total_duration_seconds
    tick_042 = int(0.42 * total / tick_seconds)
    tick_042_actual = tick_042 + 1 if (tick_042 * tick_seconds / total) < 0.42 else tick_042
    assert plan.ticks[tick_042_actual].drowsiness_band == "moderate"


def test_drowsiness_band_step_hold_persists():
    """M1: 'moderate' drowsiness_band persists to the end of the plan once set."""
    scenario = _minimal_scenario(
        drowsiness_schedule=[
            {"at": 0.0, "band": "none"},
            {"at": 0.3, "band": "weak"},
            {"at": 0.42, "band": "moderate"},
        ]
    )
    plan = freeze_event_plan(scenario)
    first_moderate = next(
        i for i, e in enumerate(plan.ticks) if e.drowsiness_band == "moderate"
    )
    for i in range(first_moderate, len(plan.ticks)):
        assert plan.ticks[i].drowsiness_band == "moderate"


def test_signal_duration_transient_at_start():
    """M1: signal_duration_schedule → 'transient' at tick 0."""
    scenario = _minimal_scenario(
        signal_duration_schedule=[
            {"at": 0.0, "band": "transient"},
            {"at": 0.3, "band": "brief"},
            {"at": 0.42, "band": "sustained"},
        ]
    )
    plan = freeze_event_plan(scenario)
    assert plan.ticks[0].signal_duration == "transient"


def test_signal_duration_sustained_at_trigger_fraction():
    """M1: signal_duration_schedule → 'sustained' from fraction 0.42 onward."""
    scenario = _minimal_scenario(
        signal_duration_schedule=[
            {"at": 0.0, "band": "transient"},
            {"at": 0.3, "band": "brief"},
            {"at": 0.42, "band": "sustained"},
        ]
    )
    plan = freeze_event_plan(scenario)
    first_sustained = next(
        (i for i, e in enumerate(plan.ticks) if e.signal_duration == "sustained"), None
    )
    assert first_sustained is not None
    frac = plan.ticks[first_sustained].route_fraction
    assert frac >= 0.42


def test_signal_duration_fallback_when_no_schedule():
    scenario = _minimal_scenario(signal_duration_at_trigger="sustained")
    plan = freeze_event_plan(scenario)
    for entry in plan.ticks:
        assert entry.signal_duration == "sustained"


def test_rest_spot_eta_near_before_rest_facility():
    """M1: rest_spot_eta_near_before → 'near' for ticks before the rest facility."""
    scenario = _minimal_scenario(rest_spot_eta_near_before="seg_rest")
    plan = freeze_event_plan(scenario)
    tick_before_rest = next(
        i for i, e in enumerate(plan.ticks)
        if e.route_fraction < 0.5
    )
    assert plan.ticks[tick_before_rest].rest_spot_eta == "near"


def test_rest_spot_eta_none_at_or_after_rest_facility(uc01_scenario):
    plan = freeze_event_plan(uc01_scenario)
    tick_at_rest = next(
        (i for i, e in enumerate(plan.ticks) if e.route_fraction >= 0.5), None
    )
    if tick_at_rest is not None:
        assert plan.ticks[tick_at_rest].rest_spot_eta == "none"


def test_rest_spot_eta_none_without_near_before():
    scenario = _minimal_scenario()
    plan = freeze_event_plan(scenario)
    for entry in plan.ticks:
        assert entry.rest_spot_eta == "none"


def test_continuous_driving_time_short_at_start(uc01_scenario):
    plan = freeze_event_plan(uc01_scenario)
    assert plan.ticks[0].continuous_driving_time == "short"


def test_continuous_driving_time_moderate_at_30min(uc01_scenario):
    plan = freeze_event_plan(uc01_scenario)
    tick_s = uc01_scenario.tick_seconds
    tick_30min = 1800 // tick_s
    assert plan.ticks[tick_30min].continuous_driving_time == "moderate"


def test_continuous_driving_time_long_at_90min(uc01_scenario):
    plan = freeze_event_plan(uc01_scenario)
    tick_s = uc01_scenario.tick_seconds
    tick_90min = 5400 // tick_s
    if tick_90min < len(plan.ticks):
        assert plan.ticks[tick_90min].continuous_driving_time == "long"


def test_active_segment_id_start_at_tick_zero(uc01_scenario):
    plan = freeze_event_plan(uc01_scenario)
    assert plan.ticks[0].active_segment_id == "seg_start"


def test_active_segment_id_changes_with_fraction(uc01_scenario):
    plan = freeze_event_plan(uc01_scenario)
    tick_s = uc01_scenario.tick_seconds
    total = uc01_scenario.total_duration_seconds
    tick_020 = int(0.2 * total / tick_s)
    assert plan.ticks[tick_020].active_segment_id == "seg_urban"


def test_freeze_is_deterministic(uc01_scenario):
    plan_a = freeze_event_plan(uc01_scenario)
    plan_b = freeze_event_plan(uc01_scenario)
    assert plan_a.model_dump() == plan_b.model_dump()


def test_minimal_scenario_determinism():
    scenario = _minimal_scenario(
        drowsiness_schedule=[{"at": 0.0, "band": "none"}, {"at": 0.3, "band": "weak"}]
    )
    p1 = freeze_event_plan(scenario)
    p2 = freeze_event_plan(scenario)
    assert p1.model_dump() == p2.model_dump()


# ---------------------------------------------------------------------------
# M2: build_event_plan (T012 new tests)
# ---------------------------------------------------------------------------


def test_build_event_plan_returns_event_plan(uc01_scenario):
    """build_event_plan returns an EventPlan instance."""
    route_facts = analyze_route(uc01_scenario)
    plan = build_event_plan(route_facts, uc01_scenario)
    assert isinstance(plan, EventPlan)


def test_build_event_plan_has_no_per_tick_entries(uc01_scenario):
    """M2 event plan has NO per-tick ticks[] entries."""
    route_facts = analyze_route(uc01_scenario)
    plan = build_event_plan(route_facts, uc01_scenario)
    assert plan.ticks == []


def test_build_event_plan_has_tick_seconds(uc01_scenario):
    """tick_seconds matches the scenario value."""
    route_facts = analyze_route(uc01_scenario)
    plan = build_event_plan(route_facts, uc01_scenario)
    assert plan.tick_seconds == uc01_scenario.tick_seconds


def test_build_event_plan_rest_opportunities_from_route_facts(uc01_scenario):
    """Rest opportunities are derived from route_facts.rest_spot_positions."""
    route_facts = analyze_route(uc01_scenario)
    plan = build_event_plan(route_facts, uc01_scenario)
    assert len(plan.rest_opportunities) == len(route_facts.rest_spot_positions)


def test_build_event_plan_rest_opportunity_position_matches():
    """The rest opportunity's route_position_km matches the route_facts position."""
    scenario = _minimal_scenario(presets={"total_route_distance_km": 120.0})
    route_facts = analyze_route(scenario)
    plan = build_event_plan(route_facts, scenario)
    assert len(plan.rest_opportunities) == 1
    # Rest facility at at=0.5, total_km=120 → position = 60 km
    assert plan.rest_opportunities[0].route_position_km == pytest.approx(60.0)


def test_build_event_plan_empty_traffic_events_by_default(uc01_scenario):
    """When scenario.presets has no traffic_events, the list is empty."""
    route_facts = analyze_route(uc01_scenario)
    plan = build_event_plan(route_facts, uc01_scenario)
    assert plan.traffic_events == []


def test_build_event_plan_empty_weather_events_by_default(uc01_scenario):
    """When scenario.presets has no weather_events, the list is empty."""
    route_facts = analyze_route(uc01_scenario)
    plan = build_event_plan(route_facts, uc01_scenario)
    assert plan.weather_events == []


def test_build_event_plan_traffic_events_from_presets():
    """Traffic events from scenario.presets are included in the plan."""
    scenario = _minimal_scenario(presets={
        "traffic_events": [
            {
                "id": "jam_1",
                "start_min": 30.0,
                "duration_min": 15.0,
                "affected_segment_id": "seg_start",
                "speed_kph": 20.0,
            }
        ]
    })
    route_facts = analyze_route(scenario)
    plan = build_event_plan(route_facts, scenario)
    assert len(plan.traffic_events) == 1
    assert plan.traffic_events[0].id == "jam_1"


def test_build_event_plan_deterministic(uc01_scenario):
    """Same route_facts + scenario → same EventPlan every call."""
    route_facts = analyze_route(uc01_scenario)
    plan_a = build_event_plan(route_facts, uc01_scenario)
    plan_b = build_event_plan(route_facts, uc01_scenario)
    assert plan_a.model_dump() == plan_b.model_dump()
