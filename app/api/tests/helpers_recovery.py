"""Test helpers for recovery-related tick engine tests.

Build a minimal M2 scenario with a recovery_model (positive recovery amounts),
one is_rest_facility segment at at=0.5, and a nap_karaoke recovery option.
Based on _make_m2_scenario() from test_tick_engine.py.
"""
from __future__ import annotations

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
from aica_api.models.run import EventPlan, RouteFacts
from aica_api.models.scenario import RecoveryOption, RecoveryStage, ScenarioDef
from aica_api.services.event_plan import build_event_plan
from aica_api.services.route_analysis import analyze_route


def m2_scenario_with_recovery(*, total_km: float = 120.0) -> ScenarioDef:
    """Minimal M2 ScenarioDef with recovery_model + nap_karaoke recovery option.

    Driver profile has positive short/long rest recovery amounts so that
    apply_rest_recovery() lowers drowsiness/fatigue on each STOPPED tick.
    Route includes exactly one is_rest_facility segment at at=0.5.
    """
    driver_profile = DriverModelProfile(
        id="test_driver_recovery",
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

    # nap_karaoke: stage 0 = wakefulness (MOVING, no fixed ticks — lasts until spot);
    #              stage 1 = nap (STOPPED, 3 ticks dwell)
    nap_karaoke = RecoveryOption(
        id="nap_karaoke",
        label={"ja": "仮眠＋カラオケ", "en": "Nap + Karaoke"},
        rest_type="short",
        stages=[
            RecoveryStage(phase="wakefulness", content="audio_karaoke", motion="MOVING"),
            RecoveryStage(phase="nap", content="sleep", motion="STOPPED", ticks=3),
        ],
    )

    segments = [
        {
            "id": "seg_start", "name": {"ja": "出発", "en": "Start"},
            "type": "start", "at": 0.0,
            "speed_band": "slow", "length_band": "short", "is_rest_facility": False,
        },
        {
            "id": "seg_rest", "name": {"ja": "SA", "en": "SA"},
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
        id="test_m2_recovery",
        version="0.1.0",
        type="uc01_fatigue",
        persona={"name": "Test Driver Recovery"},
        route_intent={
            "rest_facility": {"label": {"ja": "SA", "en": "SA"}},
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
        recovery_options=[nap_karaoke],
    )


def m2_route_facts(scenario: ScenarioDef) -> RouteFacts:
    """Return RouteFacts for the given scenario."""
    return analyze_route(scenario)


def m2_event_plan(scenario: ScenarioDef, tick_seconds: int = 60) -> EventPlan:
    """Return a frozen EventPlan for the given scenario.

    tick_seconds is accepted for call-site compatibility; the scenario's own
    tick_seconds value drives the plan.
    """
    facts = analyze_route(scenario)
    return build_event_plan(facts, scenario)
