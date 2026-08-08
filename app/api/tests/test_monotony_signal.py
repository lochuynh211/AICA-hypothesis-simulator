"""Tests for the simulator-owned monotony proxy signal (feature 020, Slice-3, Task 1).

Package-agnostic 0-100 monotony level derived purely from segment_type/motion_state/
is_night in the tick engine (``tick_engine.advance_tick``), fed into the proposal
``World.situation.monotony_level`` via ``merged_adapter.build_world_from_tick``.

This signal does NOT read or touch any package's internal monotony state (e.g. the
Hybrid package's own ``mono_min``) -- it is entirely simulator-owned, threaded through
``TickState.monotony_accrued_min`` / ``signals["dynamic"]["monotonyLevel"]``.
"""
from __future__ import annotations

import types

import pytest

from aica_api.models.proposal.dataset import CatalogRef, DatasetVersion
from aica_api.models.proposal.enums import (
    AgeBand,
    Gender,
    LifecycleStage,
    MotionState,
    NightState,
    OshiMode,
    RestSpotType,
    RoadType,
    TrafficState,
    TriggerPurpose,
)
from aica_api.models.proposal.world import ControlInputs, DriverProfile, Situation, World
from aica_api.models.run import EventPlan, RouteFacts, RouteSegmentFact, TickState
from aica_api.models.scenario import EventPreset, Persona, RestFacilityRef, RouteIntent, RouteSegment, ScenarioDef
from aica_api.services.merged_adapter import build_world_from_tick
from aica_api.services.tick_engine import advance_tick

# ---------------------------------------------------------------------------
# Fixtures / helpers — minimal valid ScenarioDef/RouteFacts/EventPlan, fully
# under test control (no driver_signal_params/anomaly_signal_params so the
# drowsiness/fatigue/anomaly branches stay inert and don't interfere).
# ---------------------------------------------------------------------------


def _make_scenario(*, is_night: bool, tick_seconds: int = 60) -> ScenarioDef:
    return ScenarioDef(
        id="test_monotony",
        version="1.0.0",
        type="test",
        persona=Persona(name="Test Driver"),
        route_intent=RouteIntent(
            rest_facility=RestFacilityRef(label={"en": "Rest"}),
            segments=[
                RouteSegment(
                    id="seg_start", name={"en": "Start"}, type="start", at=0.0,
                    speed_band="slow", length_band="short", is_rest_facility=False,
                ),
                RouteSegment(
                    id="seg_rest", name={"en": "Rest"}, type="rest", at=0.5,
                    speed_band="slow", length_band="short", is_rest_facility=True,
                ),
                RouteSegment(
                    id="seg_end", name={"en": "End"}, type="end", at=1.0,
                    speed_band="slow", length_band="short", is_rest_facility=False,
                ),
            ],
        ),
        initial_state={"drowsiness_level": "none", "fatigue_level": "low"},
        event_presets=EventPreset(signal_duration_at_trigger="transient"),
        total_duration_seconds=3600,
        tick_seconds=tick_seconds,
        allowed_actions=["acknowledge", "decline"],
        is_night=is_night,
    )


def _route_facts_single_segment(segment_type: str, total_km: float = 1000.0) -> RouteFacts:
    return RouteFacts(
        total_route_distance_km=total_km,
        route_segments=[RouteSegmentFact(segment_type=segment_type, start_km=0.0, length_km=total_km)],
        rest_spot_positions=[],
    )


def _event_plan(tick_seconds: int = 60) -> EventPlan:
    return EventPlan(tick_seconds=tick_seconds, traffic_events=[], weather_events=[], rest_opportunities=[])


def _base_world_template() -> World:
    return World(
        control_inputs=ControlInputs(
            trigger_purpose=TriggerPurpose.rest_recommended,
            lifecycle_stage=LifecycleStage.before_rest_until_stop,
            motion_state=MotionState.driving,
            matrix_version="1.0.0",
            dataset_id="soundcharts-grounded-spotify-compatible-demonstration-seed-1042",
        ),
        situation=Situation(
            drowsiness_level=10,
            fatigue_level=10,
            traffic_state=TrafficState.normal,
            road_type=RoadType.highway,
            night_state=NightState.day,
            monotony_level=0,
            route_tags=["highway"],
            destination_tags=["urban"],
            child_present=False,
            multiple_passengers=False,
            motion_state=MotionState.driving,
            estimated_min_until_rest_spot=25,
            rest_spot_type=RestSpotType.sa_pa,
            active_service=None,
            recent_service_rejections=[],
        ),
        driver_profile=DriverProfile(
            oshi_registered=False,
            oshi_mode=OshiMode.off,
            age_band=AgeBand.thirties,
            gender=Gender.unspecified,
            hobby_interest_tags=["music", "driving"],
        ),
        catalog_ref=CatalogRef(
            dataset_id="soundcharts-grounded-spotify-compatible-demonstration-seed-1042",
            dataset_version=DatasetVersion(
                schema_version="1.0.0",
                spotify_track_reference_version="1.0.0",
                spotify_audio_features_reference_version="1.0.0",
            ),
            dataset_hash="deadbeef",
        ),
    )


# ---------------------------------------------------------------------------
# (a) tick_engine.advance_tick — accrual rises on consecutive highway MOVING ticks
# ---------------------------------------------------------------------------


def test_monotony_level_rises_on_highway_moving():
    scenario = _make_scenario(is_night=False, tick_seconds=60)
    route_facts = _route_facts_single_segment("highway")
    plan = _event_plan(tick_seconds=60)

    prior: TickState | None = None
    levels: list[int] = []
    # 20 one-minute ticks, not 5: the proxy now saturates over 60 minutes rather
    # than 30, so a single minute of accrual is ~1.3 points and successive ticks
    # can round to the SAME integer. Ties are expected at this resolution — what
    # must still hold is that the level never falls while driving a monotonous
    # segment, and that it visibly climbs over a real span.
    for i in range(20):
        ts = advance_tick(prior, i, plan, route_facts, scenario, run_seed=1)
        assert ts.signals["dynamic"]["segmentType"] == "highway"
        assert ts.signals["dynamic"]["motionState"] == "MOVING"
        levels.append(ts.signals["dynamic"]["monotonyLevel"])
        prior = ts

    # Monotonically non-decreasing while accrual is under the cap...
    assert levels == sorted(levels)
    # ...and genuinely CLIMBING, not stuck flat: 20 minutes of monotonous highway
    # is (20/60)*80 ≈ 27 points. Asserting a real rise is what makes this a
    # regression guard rather than a tautology a frozen signal would also pass.
    assert levels[-1] - levels[0] >= 10, levels
    assert all(0 <= lv <= 100 for lv in levels)


# ---------------------------------------------------------------------------
# (b) decay on a non-monotonous segment (mountain_road)
# ---------------------------------------------------------------------------


def test_monotony_level_decays_on_mountain_road():
    scenario = _make_scenario(is_night=False, tick_seconds=60)
    route_facts = _route_facts_single_segment("mountain_road")
    plan = _event_plan(tick_seconds=60)

    prior = TickState(
        tick_index=0,
        elapsed_seconds=60,
        route_fraction=0.0,
        active_segment_id="seg_start",
        drowsiness_level="none",
        fatigue_level="low",
        signal_duration="transient",
        continuous_driving_time="short",
        rest_spot_eta="none",
        completed=False,
        signals={"fixed": {}, "dynamic": {}, "simulated": {"drowsiness": 0.0, "fatigue": 0.0}},
        distance_km=0.0,
        continuous_driving_min=0.0,
        monotony_accrued_min=10.0,
    )

    ts = advance_tick(prior, 1, plan, route_facts, scenario, run_seed=1)

    assert ts.signals["dynamic"]["segmentType"] == "mountain_road"
    assert ts.monotony_accrued_min == pytest.approx(8.0)  # 10.0 - 2.0*60/60
    assert ts.signals["dynamic"]["monotonyLevel"] == 11  # round((8/60)*80)
    # Sanity: strictly less than the level that accrued=10.0 would have produced.
    assert ts.signals["dynamic"]["monotonyLevel"] < round(min(100.0, (10.0 / 30.0) * 80.0))


def test_monotony_level_decays_toward_zero_and_floors_at_zero():
    scenario = _make_scenario(is_night=False, tick_seconds=60)
    route_facts = _route_facts_single_segment("mountain_road")
    plan = _event_plan(tick_seconds=60)

    prior = TickState(
        tick_index=0,
        elapsed_seconds=60,
        route_fraction=0.0,
        active_segment_id="seg_start",
        drowsiness_level="none",
        fatigue_level="low",
        signal_duration="transient",
        continuous_driving_time="short",
        rest_spot_eta="none",
        completed=False,
        signals={"fixed": {}, "dynamic": {}, "simulated": {"drowsiness": 0.0, "fatigue": 0.0}},
        distance_km=0.0,
        continuous_driving_min=0.0,
        monotony_accrued_min=1.0,  # small enough that decay would go negative without the floor
    )

    ts = advance_tick(prior, 1, plan, route_facts, scenario, run_seed=1)

    assert ts.monotony_accrued_min == 0.0  # max(0.0, 1.0 - 2.0) floored at 0
    assert ts.signals["dynamic"]["monotonyLevel"] == 0


# ---------------------------------------------------------------------------
# (c) night bonus: +20 vs an otherwise-identical day tick
# ---------------------------------------------------------------------------


def test_monotony_level_night_bonus():
    route_facts = _route_facts_single_segment("highway")
    plan = _event_plan(tick_seconds=60)
    day_scenario = _make_scenario(is_night=False, tick_seconds=60)
    night_scenario = _make_scenario(is_night=True, tick_seconds=60)

    ts_day = advance_tick(None, 0, plan, route_facts, day_scenario, run_seed=1)
    ts_night = advance_tick(None, 0, plan, route_facts, night_scenario, run_seed=1)

    day_level = ts_day.signals["dynamic"]["monotonyLevel"]
    night_level = ts_night.signals["dynamic"]["monotonyLevel"]
    assert night_level - day_level == 20


# ---------------------------------------------------------------------------
# (d) merged_adapter.build_world_from_tick — feeds monotonyLevel into World
# ---------------------------------------------------------------------------


def test_build_world_from_tick_feeds_monotony_level():
    world_template = _base_world_template()
    tick_state = types.SimpleNamespace(
        signals={
            "fixed": {"isNight": False},
            "dynamic": {
                "motionState": "MOVING",
                "isTrafficJam": False,
                "segmentType": "highway",
                "nextRestSpotMin": 10,
                "monotonyLevel": 55,
            },
            "simulated": {"drowsiness": 10.0, "fatigue": 10.0},
        }
    )

    w = build_world_from_tick(
        world_template,
        tick_state,
        trigger_purpose="rest_recommended",
        lifecycle_stage="before_rest_until_stop",
    )

    assert w.situation.monotony_level == 55


def test_build_world_from_tick_defaults_monotony_level_to_zero_when_absent():
    world_template = _base_world_template()
    tick_state = types.SimpleNamespace(
        signals={
            "fixed": {"isNight": False},
            "dynamic": {
                "motionState": "MOVING",
                "isTrafficJam": False,
                "segmentType": "highway",
                "nextRestSpotMin": 10,
                # No "monotonyLevel" key at all.
            },
            "simulated": {"drowsiness": 10.0, "fatigue": 10.0},
        }
    )

    w = build_world_from_tick(
        world_template,
        tick_state,
        trigger_purpose="rest_recommended",
        lifecycle_stage="before_rest_until_stop",
    )

    assert w.situation.monotony_level == 0
