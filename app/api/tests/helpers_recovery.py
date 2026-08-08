"""Test helpers for recovery-related tick engine and run-manager tests.

Build a minimal M2 scenario with a recovery_model (positive recovery amounts),
one is_rest_facility segment at at=0.5, and a nap_karaoke recovery option.
Based on _make_m2_scenario() from test_tick_engine.py.

create_paused_rest_run() builds a run via run_manager, ticks until a
REST_PROPOSAL pauses it, and returns the run_id for action/tick tests.
"""
from __future__ import annotations

import dataclasses
import json
import pathlib
import tempfile
import types

from aica_api.models.package import PackageManifest
from aica_api.models.profile import (
    ActivityRecovery,
    AnomalySignalParams,
    DriverSignalParams,
    DrowsinessModel,
    FatigueModel,
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
    extra_recovery_entries: dict[str, dict] | None = None,
    default_content_episode_min: float | None = None,
    default_content_service_id: str | None = None,
    allowed_actions: list[str] | None = None,
) -> ScenarioDef:
    """Minimal M2 ScenarioDef with recovery_model + nap_karaoke recovery option.

    Driver profile has positive per-activity recovery amounts (keyed by stage
    content: "sleep", "karaoke") so the STOPPED-stage recovery curve
    (apply_stage_recovery_tick) lowers drowsiness/fatigue across each
    activity's dwell. Route includes exactly one is_rest_facility segment at
    at=0.5.

    Args:
        total_km:           Total route distance in km (default 120.0).
        initial_drowsiness: Starting drowsiness band ("none", "weak", etc.).
                            "weak" makes REST_PROPOSAL fire sooner (~tick 71
                            with total_km=150, on nri_fatigue_score_v1's
                            cumulative fatigue score — see create_paused_rest_run).
        extra_recovery_entries: Additional `<key>: ActivityRecovery(**values)`
                            entries merged into the driver's recovery_model
                            (e.g. `<service_id>@<purpose>` content-relief keys
                            for the recovery-semantics-refactor tick-engine
                            tests). None = no extras.
        default_content_episode_min: Passed through to
                            ScenarioDef.default_content_episode_min.
        default_content_service_id: Passed through to
                            ScenarioDef.default_content_service_id.
        allowed_actions:    Override for scenario.allowed_actions.  None (default)
                            keeps ["accept_rest", "postpone"] — the fixture's
                            long-standing default that create_paused_rest_run()
                            and create_paused_rest_run_multi_spots() depend on
                            for their exact tick/km pause position (adding
                            "acknowledge" makes monotony_prevention proposals
                            actionable, which can pause the run much earlier
                            than their documented ~tick-71 REST_PROPOSAL).
                            create_content_run() passes an explicit list that
                            includes "acknowledge".
    """
    recovery_model = {
        "sleep": ActivityRecovery(drowsiness=35.0, fatigue=30.0),
        "karaoke": ActivityRecovery(drowsiness=8.0, fatigue=5.0),
    }
    for key, values in (extra_recovery_entries or {}).items():
        recovery_model[key] = ActivityRecovery(**values)

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
        recovery_model=recovery_model,
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
        allowed_actions=allowed_actions or ["accept_rest", "postpone"],
        driver_signal_params=driver_signal_params,
        anomaly_signal_params=anomaly_signal_params,
        speed_profile=speed_profile,
        presets={"total_route_distance_km": total_km},
        recovery_options=[nap_karaoke],
        default_content_episode_min=default_content_episode_min,
        default_content_service_id=default_content_service_id,
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
    crosses threshold_fire and REST_PROPOSAL fires at tick 71 (~72km in, safely
    before the route's midpoint rest spot at 75km, so the post-fire rest-spot-ETA
    filter passes).  After accepting recovery with the 3-stage nap_karaoke option,
    the full recovery sequence plus remaining route (~78km) completes in ~82 more
    ticks — within the tick budget used by test_recovery_runs_to_resume_and_completes.

    Slice 025 (S5a): the package manifest's default threshold_fire was raised
    80 -> 100 (owner-requested rest/monotony rebalance, unrelated to this
    fixture). At 100 the same climb only crosses threshold at ~81km — PAST
    the 75km rest spot above, so the post-fire ETA filter (and every rest-spot
    test built on this fixture) starts failing for a reason that has nothing
    to do with what those tests exist to check. So threshold_fire is pinned
    to 80.0 via a hyperparameters override below (same pattern as
    create_paused_rest_run_multi_spots's rest_spot_eta_filter_min pin): this
    fixture depends on a SPECIFIC tick/km pause position, not on whatever the
    manifest's default happens to be today.

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
        # Pinned to the pre-raise manifest default (80.0) so this fixture keeps
        # pausing at the tick/km position its docstring and downstream tests
        # depend on, regardless of what the manifest's own default is today —
        # see the docstring above.
        hyperparameters={"threshold_fire": 80.0},
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

    Slice 025 (S5a): threshold_fire is ALSO pinned (to 80.0, the pre-raise
    manifest default) for the same reason as create_paused_rest_run() above —
    the manifest default moved to 100, which pushes this pause out to ~81 km
    and puts named spots between 72km and 81km (e.g. the 80km spot used by
    test_rest_spots_real_named_spot_passes_filter) behind the driver instead
    of ahead of it. Pinning both hyperparameters keeps the ~72 km pause this
    fixture's docstring and every caller's km arithmetic below assume.

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
        # threshold_fire pinned to the pre-raise manifest default (80.0) so the
        # ~72km pause position doesn't drift when the manifest default changes
        # (see the docstring above).
        hyperparameters={"rest_spot_eta_filter_min": 60.0, "threshold_fire": 80.0},
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


def create_content_run(
    *,
    default_content_episode_min: float | None = None,
    default_content_service_id: str | None = None,
) -> str:
    """A started M2 run whose scenario carries a `quiz@monotony` recovery entry
    and, optionally, the §11 trigger-only fallback defaults.

    Unlike `create_paused_rest_run` this does NOT tick until a fire — the
    content-relief tests drive the ticks themselves so they control exactly
    which tick the episode opens on.

    `allowed_actions` includes "acknowledge" (m2_scenario_with_recovery's
    default omits it -- see that function's docstring for why it isn't the
    shared default) and the nri_fatigue_score_v1 hyperparameters are pinned so
    a monotony_prevention proposal (options include "acknowledge") fires and
    pauses the run within the first 3 ticks, deterministically, regardless of
    the package manifest's own defaults:
      - threshold_monotony at its minimum (10.0) -- the lowest band the score
        can cross.
      - w_base / w_monotonous at their maximums (2.0 each) -- fastest possible
        S_total growth from driving_min_since_rest + cumulative_monotonous_min
        (this scenario's segments are all "normal_road", so w_highway never
        applies -- see route_analysis.py's M1->M2 segment_type mapping).
      - threshold_fire pinned to its current manifest default (100.0) so a
        REST_PROPOSAL can never preempt the monotony band during these tests'
        first handful of ticks, regardless of future manifest changes.
    With these pins, S_total reaches 12.0 by tick_index=2 (the third tick),
    comfortably inside [10.0, 100.0).

    The caller's autouse fixture must clear both the run_manager and run_plan
    registries between tests.
    """
    from aica_api.services.run_manager import create_run
    from aica_api.services.run_plan import create_draft

    scenario = m2_scenario_with_recovery(
        extra_recovery_entries={
            "quiz@monotony": {"stimulus_relief_per_min": 2.0, "cap_stimulus": 20.0},
        },
        default_content_episode_min=default_content_episode_min,
        default_content_service_id=default_content_service_id,
        allowed_actions=["accept_rest", "postpone", "acknowledge"],
    )
    package = PackageManifest(**json.loads(_PACKAGE_PATH.read_text(encoding="utf-8")))

    run_id = "content_relief_run"
    plan_id = f"plan_{run_id}"
    runs_dir = pathlib.Path(tempfile.mkdtemp())

    create_draft(
        plan_id=plan_id,
        package=package,
        scenario=scenario,
        presets={},
        parameters={},
        hyperparameters={
            "threshold_monotony": 10.0,
            "w_base": 2.0,
            "w_monotonous": 2.0,
            "threshold_fire": 100.0,
        },
        run_mode="standard",
    )
    create_run(plan_id, run_id, runs_dir)
    return run_id


def fired_tick_event(*, tick_index: int, category: str, elapsed_seconds: float):
    """A TickEvent stand-in carrying a FIRED proposal of `category`.

    Shaped for `run_manager._derive_response_suppression`, which reads only
    `.kind`, `.tick_index`, `.trace.decision_result.{fire_control.fired,
    proposal, selected_category}` and `.tick_state.elapsed_seconds`.
    """
    return types.SimpleNamespace(
        kind="tick",
        tick_index=tick_index,
        tick_state=types.SimpleNamespace(elapsed_seconds=elapsed_seconds),
        trace=types.SimpleNamespace(
            decision_result=types.SimpleNamespace(
                fire_control=types.SimpleNamespace(fired=True),
                proposal=types.SimpleNamespace(id="p"),
                selected_category=category,
            )
        ),
    )


def action_event(*, tick_index: int, action: str):
    """An ActionEvent stand-in: the driver's answer to the proposal that fired
    at this SAME tick_index (run_manager.action always stamps it that way)."""
    return types.SimpleNamespace(kind="action", tick_index=tick_index, action=action)


@dataclasses.dataclass
class StreamResult:
    """Everything one package produced over a fixed tick stream."""

    tick_states: list
    runtime_states: list
    decisions: list


_PACKAGE_PATHS = {
    "nri_fatigue_score_v1": _PACKAGE_PATH,
    "aica_transparent_hybrid_trigger_v1": (
        _REPO_ROOT / "packages" / "aica_transparent_hybrid_trigger_v1" / "package.json"
    ),
}


def run_identical_stream(
    package_id: str,
    *,
    ticks: int = 60,
    accept_monotony_at_tick: int | None = None,
    is_night: bool = False,
    familiar_route: bool = False,
) -> StreamResult:
    """Run ONE fixed scenario against `package_id` and capture every tick.

    Both packages receive the same scenario (module-driving content relief via
    `quiz@monotony`), the same run seed and the same tick count, so any
    divergence in the captured series is attributable to the algorithms
    themselves -- which is exactly what the parity tests in
    test_recovery_parity.py assert.

    `allowed_actions` includes "acknowledge" (unlike the shared
    m2_scenario_with_recovery default) so `accept_monotony_at_tick` can
    actually acknowledge a pending monotony_prevention proposal and open the
    synthetic content episode (`_synthetic_content_context` in run_manager.py
    requires a real "acknowledge" ActionEvent -- see create_content_run's
    docstring for the same reasoning).

    NOTE the two packages both declare `tick_seconds` via their manifests
    (see packages/*/package.json `algorithm.tick_seconds`), so compare SERIES
    SHAPE and freeze-tick alignment, never absolute minute values, across
    packages.

    The caller's autouse fixture must clear both the run_manager and run_plan
    registries between tests.
    """
    from aica_api.services.run_manager import ActionNotAllowedError, action, create_run, tick
    from aica_api.services.run_plan import create_draft

    scenario = m2_scenario_with_recovery(
        total_km=300.0,
        initial_drowsiness="weak",
        extra_recovery_entries={
            "quiz@monotony": {"stimulus_relief_per_min": 2.0, "cap_stimulus": 20.0},
        },
        default_content_episode_min=15.0,
        default_content_service_id="quiz",
        allowed_actions=["accept_rest", "postpone", "acknowledge"],
    )
    scenario = scenario.model_copy(
        update={"is_night": is_night, "familiar_route": familiar_route}
    )
    package = PackageManifest(
        **json.loads(_PACKAGE_PATHS[package_id].read_text(encoding="utf-8"))
    )

    run_id = f"parity_{package_id}"
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

    tick_states, runtime_states, decisions = [], [], []
    for index in range(ticks):
        outcome = tick(run_id)
        if outcome.tick_state is None:
            break                      # run completed early
        tick_states.append(outcome.tick_state)
        runtime_states.append(dict(outcome.run_state.package_runtime_state))
        decisions.append(outcome.decision)
        # Try >= accept_monotony_at_tick, not == : the monotony_prevention
        # proposal's actual fire tick depends on persistence (Hybrid) / band
        # crossing (NRI) and drifts with is_night/familiar_route, so a driver
        # who is willing to acknowledge from this tick onward must seize the
        # FIRST tick a proposal is actually pending, not just the requested
        # one (a one-shot `==` silently no-ops when nothing is pending yet,
        # which starves the freeze/relief path this parameter exists to
        # exercise). Stops retrying once acknowledged (ActionNotAllowedError
        # after that point just means "not paused" again, which is fine).
        if accept_monotony_at_tick is not None and index >= accept_monotony_at_tick:
            try:
                action(run_id, "acknowledge")
            except ActionNotAllowedError:
                pass                   # not paused on a proposal at this tick
    return StreamResult(tick_states, runtime_states, decisions)
