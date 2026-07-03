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
    AnomalySignalParams,
    DriverSignalParams,
    DrowsinessModel,
    FatigueModel,
    RecoveryModel,
    SpeedProfile,
)
from aica_api.models.run import EventPlan, NamedRestSpot, RouteFacts
from aica_api.models.scenario import RecoveryOption, RecoveryStage, ScenarioDef
from aica_api.services.event_plan import build_event_plan
from aica_api.services.route_analysis import analyze_route

_REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
# Feature 009: rest_rule_based_v0_1 (declarative_rule) is retired — the only
# surviving packages are python_module.  Use nri_fatigue_score_v1: its
# tick_seconds=60 cadence matches this fixture's original tick-budget
# assumptions (the compact hybrid trigger overrides tick_seconds=30, which
# would double every distance/time-based tick count below).
_PACKAGE_PATH = _REPO_ROOT / "packages" / "nri_fatigue_score_v1" / "package.json"


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
                            "weak" makes REST_PROPOSAL fire sooner (~tick 71
                            with total_km=150, on nri_fatigue_score_v1's
                            cumulative fatigue score — see create_paused_rest_run).
    """
    driver_signal_params = DriverSignalParams(
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
        recovery_model=RecoveryModel(
            short_rest_drowsiness_recovery=20.0,
            short_rest_fatigue_recovery=15.0,
            long_rest_drowsiness_recovery=35.0,
            long_rest_fatigue_recovery=30.0,
        ),
    )
    speed_profile = SpeedProfile(
        normal_road_kph=60, highway_kph=100,
        mountain_road_kph=40, sightseeing_road_kph=30,
        traffic_jam_kph=20,
    )
    anomaly_signal_params = AnomalySignalParams(
        lambda_base=0.02, lambda_gain=0.15, theta=40.0, window_min=5.0,
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
        driver_signal_params=driver_signal_params,
        anomaly_signal_params=anomaly_signal_params,
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

    Feature 009: repointed from the retired rest_rule_based_v0_1 (declarative_rule)
    package to nri_fatigue_score_v1 (python_module, tick_seconds=60 — matching this
    fixture's original tick-cadence assumptions).  Its cumulative fatigue score
    (S_total = S_base + S_env + S_realtime) is driven by elapsed driving time, not
    by the old band-threshold rules, so the tick budget was regenerated from actual
    behavior (FR-018): with total_km=150.0 and initial_drowsiness="weak", the score
    crosses threshold_fire=80 and REST_PROPOSAL fires at tick 71 (~72km in, safely
    before the route's midpoint rest spot at 75km, so the post-fire rest-spot-ETA
    filter passes).  After accepting recovery with the 3-stage nap_karaoke option,
    the full recovery sequence plus remaining route (~78km) completes in ~82 more
    ticks — within the tick budget used by test_recovery_runs_to_resume_and_completes.

    The caller's autouse fixture must clear both run_manager and run_plan
    registries between tests (as test_run_manager_recovery.py does).

    Returns:
        The run_id of the newly paused run.
    """
    from aica_api.services.run_manager import create_run, tick
    from aica_api.services.run_plan import create_draft

    scenario = m2_scenario_with_recovery(total_km=150.0, initial_drowsiness="weak")
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

    # Tick until REST_PROPOSAL pauses the run (fires around tick 71).
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


def create_paused_rest_run_multi_spots(
    named_spots: list[dict] | None = None,
) -> str:
    """Create a paused rest run and seed multiple named rest spots on its route_facts.

    Uses total_km=200.0 so spots can be spread across the full route.  Feature 009:
    repointed to nri_fatigue_score_v1 (the retired rest_rule_based_v0_1 package is
    gone).  Its cumulative fatigue score's post-fire rest-spot-ETA filter is
    overridden (rest_spot_eta_filter_min=60.0, the hyperparameter's max) so the
    proposal fires on the ordinary "threshold_passed_persisted" path instead of
    waiting for the emergency-override threshold — this pins a deterministic,
    reproducible pause at tick 71 / ~72 km (regenerated from actual behavior,
    FR-018), well ahead of the scenario's own rest facility at 100 km.

    After the run is paused, this helper replaces route_facts.named_rest_spots
    in-memory so the rest-spots endpoint returns the supplied spots.  It also
    clears rest_spot_positions so the endpoint uses named_rest_spots exclusively.

    Default named_spots (if None) — pause position is ~72 km, so spots at/under
    65 km are behind the driver and filtered by the AHEAD filter:
      - "Behind SA"  at  20 km  (behind — filtered)
      - "Near SA"    at  35 km  (behind — filtered)
      - "Close SA"   at  45 km  (behind — filtered)
      - "Mid SA 1"   at  65 km  (behind — filtered)
      - "Mid SA 2"   at  85 km  (taken first)
      - "Far SA 1"   at 105 km
      - "Far SA 2"   at 125 km
      - "Far SA 3"   at 145 km

    Args:
        named_spots: list of dicts accepted by NamedRestSpot (name, position_km,
                     optional lat/lng).  If None the default set above is used.

    Returns:
        run_id of the paused run.
    """
    from aica_api.services.run_manager import create_run, get_run, tick
    from aica_api.services.run_plan import create_draft

    if named_spots is None:
        named_spots = [
            {"name": "Behind SA",  "position_km": 20.0},
            {"name": "Near SA",    "position_km": 35.0},
            {"name": "Close SA",   "position_km": 45.0},
            {"name": "Mid SA 1",   "position_km": 65.0},
            {"name": "Mid SA 2",   "position_km": 85.0},
            {"name": "Far SA 1",   "position_km": 105.0},
            {"name": "Far SA 2",   "position_km": 125.0},
            {"name": "Far SA 3",   "position_km": 145.0},
        ]

    scenario = m2_scenario_with_recovery(total_km=200.0, initial_drowsiness="weak")
    package_data = json.loads(_PACKAGE_PATH.read_text(encoding="utf-8"))
    package = PackageManifest(**package_data)

    run_id = "paused_rest_run_multi"
    plan_id = f"plan_{run_id}"
    runs_dir = pathlib.Path(tempfile.mkdtemp())

    create_draft(
        plan_id=plan_id,
        package=package,
        scenario=scenario,
        presets={},
        parameters={},
        # rest_spot_eta_filter_min at its max (60.0): the scenario's own rest
        # facility is 100km out, far beyond the default 15-min ETA filter — this
        # override lets the ordinary persisted-threshold path fire deterministically
        # around tick 71 instead of waiting for the emergency-override threshold.
        hyperparameters={"rest_spot_eta_filter_min": 60.0},
        run_mode="standard",
    )
    create_run(plan_id, run_id, runs_dir)

    # Tick until REST_PROPOSAL pauses the run (fires at tick 71, ~72 km in).
    for _ in range(200):
        outcome = tick(run_id)
        if outcome.paused:
            break
        if outcome.completed:
            raise RuntimeError(
                "create_paused_rest_run_multi_spots: run completed without a REST_PROPOSAL pause"
            )
    else:
        raise RuntimeError(
            "create_paused_rest_run_multi_spots: REST_PROPOSAL did not fire within 200 ticks"
        )

    # Patch the in-memory RunState's route_facts with the desired named spots.
    # get_run() returns the actual RunState object from the registry, so mutating
    # it propagates to all callers (including the rest-spots endpoint).
    rs = get_run(run_id)
    if rs is None:  # pragma: no cover
        raise RuntimeError("create_paused_rest_run_multi_spots: run not found after creation")

    named_spot_objs = [NamedRestSpot(**s) for s in named_spots]
    rs.route_facts = rs.route_facts.model_copy(update={
        "named_rest_spots": named_spot_objs,
        # Clear generic positions so the endpoint uses named_rest_spots exclusively
        "rest_spot_positions": [],
    })

    return run_id
