"""Test helpers for recovery-related tick engine and run-manager tests.

Build a minimal M2 scenario with a recovery_model (positive recovery amounts),
one is_rest_facility segment at at=0.5, and a nap_karaoke recovery option.
Based on _make_m2_scenario() from test_tick_engine.py.

create_paused_rest_run() builds a run via run_manager, ticks until a
REST_PROPOSAL pauses it, and returns the run_id for action/tick tests.
"""
from __future__ import annotations

import json
import pathlib
import tempfile

from aica_api.models.package import PackageManifest
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

_REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
_PACKAGE_PATH = _REPO_ROOT / "packages" / "rest_rule_based_v0_1" / "package.json"


def m2_scenario_with_recovery(
    *,
    total_km: float = 120.0,
    initial_drowsiness: str = "none",
) -> ScenarioDef:
    """Minimal M2 ScenarioDef with recovery_model + nap_karaoke recovery option.

    Driver profile has positive short/long rest recovery amounts so that
    apply_rest_recovery() lowers drowsiness/fatigue on each STOPPED tick.
    Route includes exactly one is_rest_facility segment at at=0.5.

    Args:
        total_km:           Total route distance in km (default 120.0).
        initial_drowsiness: Starting drowsiness band ("none", "weak", etc.).
                            "weak" makes REST_PROPOSAL fire sooner (~tick 29
                            with total_km=64, which lets the recovery sequence
                            complete within 40 ticks after acceptance).
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

    # nap_karaoke: stage 0 = wakefulness (MOVING, lasts until rest spot);
    #              stage 1 = nap (STOPPED, 3 ticks dwell);
    #              stage 2 = content (STOPPED, 2 ticks dwell — karaoke post-nap)
    # Adding a "content" stage ensures the run_manager recovery tests can verify
    # multi-phase sequencing (phase "content" in raw_state).
    nap_karaoke = RecoveryOption(
        id="nap_karaoke",
        label={"ja": "仮眠＋カラオケ", "en": "Nap + Karaoke"},
        rest_type="short",
        stages=[
            RecoveryStage(phase="wakefulness", content="audio_karaoke", motion="MOVING"),
            RecoveryStage(phase="nap", content="sleep", motion="STOPPED", ticks=3),
            RecoveryStage(phase="content", content="karaoke", motion="STOPPED", ticks=2),
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
        initial_state={"drowsiness_level": initial_drowsiness, "fatigue_level": "low"},
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


def create_paused_rest_run() -> str:
    """Create a run via run_manager for m2_scenario_with_recovery(), tick until
    a REST_PROPOSAL pauses it, and return the run_id.

    Uses total_km=64.0 and initial_drowsiness="weak" so the REST_PROPOSAL fires
    at approximately tick 29 (when drowsiness reaches 'moderate' and continuous
    driving crosses the 30-min threshold with a persistent signal).  After
    accepting recovery with the 3-stage nap_karaoke option, the full recovery
    sequence plus remaining route completes in ~39 ticks — within the 40-tick
    budget used by test_recovery_runs_to_resume_and_completes.

    The caller's autouse fixture must clear both run_manager and run_plan
    registries between tests (as test_run_manager_recovery.py does).

    Returns:
        The run_id of the newly paused run.
    """
    from aica_api.services.run_manager import create_run, tick
    from aica_api.services.run_plan import create_draft

    scenario = m2_scenario_with_recovery(total_km=64.0, initial_drowsiness="weak")
    package_data = json.loads(_PACKAGE_PATH.read_text(encoding="utf-8"))
    package = PackageManifest(**package_data)

    run_id = "paused_rest_run"
    plan_id = f"plan_{run_id}"
    runs_dir = pathlib.Path(tempfile.mkdtemp())

    create_draft(
        plan_id=plan_id,
        package=package,
        scenario=scenario,
        presets={},
        parameters={},
        hyperparameters={},
        run_mode="standard",
    )
    create_run(plan_id, run_id, runs_dir)

    # Tick until REST_PROPOSAL pauses the run (fires around tick 29).
    for _ in range(200):
        outcome = tick(run_id)
        if outcome.paused:
            break
        if outcome.completed:
            raise RuntimeError(
                "create_paused_rest_run: run completed without a REST_PROPOSAL pause"
            )
    else:
        raise RuntimeError(
            "create_paused_rest_run: REST_PROPOSAL did not fire within 200 ticks"
        )

    return run_id
