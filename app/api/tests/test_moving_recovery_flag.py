"""MOVING-recovery explicit flag (feature 020, Slice-2b Task 3).

Hardens the Slice-2 core Task 2 MOVING-recovery gate: it used to infer
"this MOVING stage grants en-route recovery" from the stage's *name*
(``phase == "content" or content != "wakefulness"``). That is a landmine —
any real scenario author who names a MOVING stage's content anything other
than the literal string ``"wakefulness"`` (e.g. ``"audio_karaoke"`` for a
plain sing-along with no recovery intended) would silently start accruing
en-route recovery the moment its ``recovery_model`` entry ever gained a
``*_per_min`` field, with no explicit opt-in anywhere.

This test file verifies the replacement: an explicit
``RecoveryStage.grants_moving_recovery: bool = False`` gate.

  (a) A MOVING stage WITHOUT the flag (default False) recovers NOTHING
      en-route, even when its ``recovery_model`` entry has ``*_per_min``
      fields set and its content name is not "wakefulness" (closes the
      landmine — today's real scenarios never set this flag and must see
      zero MOVING recovery, matching current inert behavior).
  (b) A MOVING stage WITH ``grants_moving_recovery=True`` and a `*_per_min`
      recovery_model entry DOES accrue en-route recovery (unchanged from
      Slice-2 core Task 2's behavior, now reached via the explicit flag
      instead of the name heuristic).
"""

from __future__ import annotations

from aica_api.models.profile import (
    ActivityRecovery,
    AnomalySignalParams,
    DriverSignalParams,
    DrowsinessModel,
    FatigueModel,
    SpeedProfile,
)
from aica_api.models.run import RecoveryState, RestSpot
from aica_api.models.scenario import RecoveryOption, RecoveryStage, ScenarioDef
from aica_api.services.event_plan import build_event_plan
from aica_api.services.route_analysis import analyze_route
from aica_api.services.tick_engine import advance_tick

_SEGMENTS = [
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

_ZERO_ANOMALY = AnomalySignalParams(lambda_base=0.0, lambda_gain=0.0, theta=40.0, window_min=5.0)
_SPEED_PROFILE = SpeedProfile(
    normal_road_kph=60, highway_kph=100,
    mountain_road_kph=40, sightseeing_road_kph=30,
    traffic_jam_kph=20,
)
_SPOT = RestSpot(id="p1", label={"ja": "SA", "en": "SA"}, route_fraction=0.5)


def _build_scenario(*, stage: RecoveryStage, total_km: float = 120.0) -> ScenarioDef:
    dm = DrowsinessModel(
        base_growth_per_min=0.0, night_add_per_min=0.0,
        monotony_add_per_min=0.0, traffic_jam_add_per_min=0.0,
    )
    fm = FatigueModel(
        base_growth_per_min=0.0, continuous_driving_add_per_min_after_60_min=0.0,
        mountain_road_add_per_min=0.0, traffic_jam_add_per_min=0.0,
    )
    driver_signal_params = DriverSignalParams(
        id="test_driver_moving_recovery_flag",
        drowsiness_model=dm,
        fatigue_model=fm,
        recovery_model={
            # not "wakefulness" and phase=="content" -- would have tripped the
            # old name-heuristic (phase=="content" or content!="wakefulness").
            "video_karaoke": ActivityRecovery(drowsiness_per_min=2.0, fatigue_per_min=1.0),
        },
    )
    option = RecoveryOption(id="opt", label={"ja": "x", "en": "x"}, stages=[stage])
    return ScenarioDef(
        id="test_moving_recovery_flag",
        version="0.1.0",
        type="uc01_fatigue",
        persona={"name": "Test Driver Moving Recovery Flag"},
        route_intent={
            "rest_facility": {"label": {"ja": "SA", "en": "SA"}},
            "segments": _SEGMENTS,
        },
        initial_state={"drowsiness_level": 50.0, "fatigue_level": 50.0},
        event_presets={"signal_duration_at_trigger": "transient"},
        total_duration_seconds=7200,
        tick_seconds=60,
        allowed_actions=["accept_rest", "postpone"],
        driver_signal_params=driver_signal_params,
        anomaly_signal_params=_ZERO_ANOMALY,
        speed_profile=_SPEED_PROFILE,
        presets={"total_route_distance_km": total_km},
        recovery_options=[option],
    )


def _drowsiness_after(*, grants_moving_recovery: bool, n_ticks: int = 3) -> float:
    stage = RecoveryStage(
        phase="content", content="video_karaoke", motion="MOVING",
        grants_moving_recovery=grants_moving_recovery,
    )
    scenario = _build_scenario(stage=stage)
    facts = analyze_route(scenario)
    plan = build_event_plan(facts, scenario)
    rec = RecoveryState(
        active=True, option_id="opt", rest_spot=_SPOT,
        phase="content", stage_index=0, stage_ticks_remaining=0,
    )
    state = advance_tick(None, 0, plan, facts, scenario)  # tick 0 baseline (no recovery)
    for i in range(1, n_ticks + 1):
        state = advance_tick(state, i, plan, facts, scenario, recovery=rec)
    return float(state.signals["simulated"]["drowsiness"])


def test_moving_stage_without_flag_recovers_nothing_even_with_per_min_entry():
    """The landmine: a MOVING stage whose recovery_model entry has
    drowsiness_per_min set, but grants_moving_recovery defaults to False,
    must accrue ZERO en-route recovery -- matching plain wakefulness-MOVING
    (inert) behavior, not the enriched activity's per-min rate."""
    baseline = _drowsiness_after(grants_moving_recovery=False)
    # zero growth models + no recovery applied -> drowsiness stays at initial 50.0
    assert baseline == 50.0


def test_moving_stage_with_flag_accrues_en_route_recovery():
    """Explicit opt-in: grants_moving_recovery=True + a *_per_min entry
    accrues per-tick recovery while MOVING (Slice-2 core Task 2 behavior,
    now reached via the explicit flag)."""
    recovered = _drowsiness_after(grants_moving_recovery=True)
    # zero growth + 2.0/min drowsiness recovery over 3 one-minute ticks -> -6.0
    assert recovered == 50.0 - 6.0


def test_default_grants_moving_recovery_is_false():
    stage = RecoveryStage(phase="content", content="video_karaoke", motion="MOVING")
    assert stage.grants_moving_recovery is False
