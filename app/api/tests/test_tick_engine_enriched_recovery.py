"""Tick engine — enriched recovery application (feature 020, Slice-2 core Task 2).

Verifies the tick_engine recovery block applies the Task-1 enriched functions
(apply_rest_recovery_minutes / apply_rest_recovery_rate) from
services/behavior/driver_signals.py:

  (a) STOPPED nap stage whose recovery_model[content] entry has any
      ``*_per_min`` field set recovers MORE with a LARGER stage.ticks
      (duration-scaled via apply_rest_recovery_minutes, applied once on
      activity entry — minutes = stage.ticks * tick_seconds / 60).
  (b) A MOVING content stage (motion=="MOVING", phase=="content") whose
      recovery_model[content] entry has drowsiness_per_min set accrues a
      small per-tick recovery (apply_rest_recovery_rate) EVERY moving tick
      while en route — additive; the recovery/no-recovery gap after 3 ticks
      is larger than after 1 tick.
  (c) A legacy flat-only recovery_model entry (no per-min fields set) still
      recovers EXACTLY the flat amount once, unchanged (back-compat with
      feature 009's apply_rest_recovery — no regression).

Minimal ScenarioDef fixtures are built locally in this file (per the task
brief), independent of tests/helpers_recovery.py's fixture.
"""

from __future__ import annotations

import pytest

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


def _zero_growth_models() -> tuple[DrowsinessModel, FatigueModel]:
    """Drowsiness/fatigue models with all growth rates at 0 — isolates recovery
    arithmetic from concurrent growth so recovered amounts are exact."""
    dm = DrowsinessModel(
        base_growth_per_min=0.0, night_add_per_min=0.0,
        monotony_add_per_min=0.0, traffic_jam_add_per_min=0.0,
    )
    fm = FatigueModel(
        base_growth_per_min=0.0, continuous_driving_add_per_min_after_60_min=0.0,
        mountain_road_add_per_min=0.0, traffic_jam_add_per_min=0.0,
    )
    return dm, fm


def _build_scenario(
    *,
    recovery_model: dict,
    stages: list[RecoveryStage],
    drowsiness_model: DrowsinessModel,
    fatigue_model: FatigueModel,
    initial_drowsiness: float = 90.0,
    initial_fatigue: float = 80.0,
    total_km: float = 120.0,
) -> ScenarioDef:
    driver_signal_params = DriverSignalParams(
        id="test_driver_enriched_tick",
        drowsiness_model=drowsiness_model,
        fatigue_model=fatigue_model,
        recovery_model=recovery_model,
    )
    option = RecoveryOption(
        id="opt", label={"ja": "x", "en": "x"}, stages=stages,
    )
    return ScenarioDef(
        id="test_m2_enriched_recovery",
        version="0.1.0",
        type="uc01_fatigue",
        persona={"name": "Test Driver Enriched Recovery"},
        route_intent={
            "rest_facility": {"label": {"ja": "SA", "en": "SA"}},
            "segments": _SEGMENTS,
        },
        initial_state={"drowsiness_level": initial_drowsiness, "fatigue_level": initial_fatigue},
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


def _tick_and_facts(scenario: ScenarioDef):
    facts = analyze_route(scenario)
    plan = build_event_plan(facts, scenario)
    return plan, facts


_SPOT = RestSpot(id="p1", label={"ja": "SA", "en": "SA"}, route_fraction=0.5)


# ─── (a) STOPPED nap stage — duration-scaled recovery via *_per_min ───────────


def _stopped_final_drowsiness(nap_ticks: int) -> float:
    dm, fm = _zero_growth_models()
    scenario = _build_scenario(
        recovery_model={
            "sleep": ActivityRecovery(drowsiness_per_min=1.0, fatigue_per_min=0.5),
        },
        stages=[
            RecoveryStage(phase="wakefulness", content="wakefulness", motion="MOVING"),
            RecoveryStage(phase="nap", content="sleep", motion="STOPPED", ticks=nap_ticks),
        ],
        drowsiness_model=dm,
        fatigue_model=fm,
    )
    plan, facts = _tick_and_facts(scenario)
    prior = advance_tick(None, 0, plan, facts, scenario)  # tick 0: establishes baseline
    rec = RecoveryState(
        active=True, option_id="opt", rest_spot=_SPOT,
        phase="nap", stage_index=1, stage_ticks_remaining=nap_ticks,
    )
    out = advance_tick(prior, 1, plan, facts, scenario, recovery=rec)
    return float(out.signals["simulated"]["drowsiness"])


def test_stopped_nap_duration_scaled_recovers_more_with_larger_ticks():
    final_short = _stopped_final_drowsiness(nap_ticks=3)   # 3 min dwell -> recover 3.0
    final_long = _stopped_final_drowsiness(nap_ticks=6)    # 6 min dwell -> recover 6.0
    assert final_long < final_short   # longer sleep -> more recovery -> lower drowsiness
    # zero-growth model makes this exact: 90 - (3*1.0) = 87; 90 - (6*1.0) = 84
    assert final_short == 87.0
    assert final_long == 84.0


def test_stopped_nap_duration_scaled_is_additive_not_flat():
    """The recovered amount must scale with stage.ticks, not be a fixed constant."""
    final_3 = _stopped_final_drowsiness(nap_ticks=3)
    final_9 = _stopped_final_drowsiness(nap_ticks=9)
    recovered_3 = 90.0 - final_3
    recovered_9 = 90.0 - final_9
    assert recovered_9 == recovered_3 * 3


# ─── (b) MOVING content stage — per-tick rate accrual, additive ──────────────


def _moving_content_drowsiness_after(n_ticks: int, *, with_recovery: bool) -> float:
    dm = DrowsinessModel(
        base_growth_per_min=0.3, night_add_per_min=0.0,
        monotony_add_per_min=0.0, traffic_jam_add_per_min=0.0,
    )
    fm = FatigueModel(
        base_growth_per_min=0.1, continuous_driving_add_per_min_after_60_min=0.0,
        mountain_road_add_per_min=0.0, traffic_jam_add_per_min=0.0,
    )
    scenario = _build_scenario(
        recovery_model={
            "video_karaoke": ActivityRecovery(drowsiness_per_min=2.0, fatigue_per_min=1.0),
        },
        stages=[
            RecoveryStage(phase="content", content="video_karaoke", motion="MOVING"),
        ],
        drowsiness_model=dm,
        fatigue_model=fm,
        initial_drowsiness=50.0,
        initial_fatigue=50.0,
    )
    plan, facts = _tick_and_facts(scenario)
    # rest_spot far ahead (route_fraction=0.5, ~60km) — well past reach in a few
    # 1-minute/1km ticks, so motion_state stays MOVING throughout.
    rec = RecoveryState(
        active=True, option_id="opt", rest_spot=_SPOT,
        phase="content", stage_index=0, stage_ticks_remaining=0,
    ) if with_recovery else None

    state = advance_tick(None, 0, plan, facts, scenario)  # tick 0 baseline (no recovery)
    for i in range(1, n_ticks + 1):
        state = advance_tick(state, i, plan, facts, scenario, recovery=rec)
    return float(state.signals["simulated"]["drowsiness"])


def test_moving_content_stage_accrues_small_recovery_growing_with_ticks():
    baseline_1 = _moving_content_drowsiness_after(1, with_recovery=False)
    recovery_1 = _moving_content_drowsiness_after(1, with_recovery=True)
    baseline_3 = _moving_content_drowsiness_after(3, with_recovery=False)
    recovery_3 = _moving_content_drowsiness_after(3, with_recovery=True)

    gap_1 = baseline_1 - recovery_1
    gap_3 = baseline_3 - recovery_3

    assert gap_1 > 0.0          # a small amount of recovery already after 1 tick
    assert gap_3 > gap_1        # the recovered amount grows with more moving ticks


def _moving_content_capped_drowsiness_after(n_ticks: int, *, cap_drowsiness: float | None) -> float:
    """Like _moving_content_drowsiness_after, but properly threads the
    RecoveryState's `_recovery_next` across ticks (mirroring run_manager.py's
    production tick loop) instead of reusing a static `rec` object -- required
    to exercise the aggregate-cap accrual, which lives ON RecoveryState."""
    dm = DrowsinessModel(
        base_growth_per_min=0.0, night_add_per_min=0.0,
        monotony_add_per_min=0.0, traffic_jam_add_per_min=0.0,
    )
    fm = FatigueModel(
        base_growth_per_min=0.0, continuous_driving_add_per_min_after_60_min=0.0,
        mountain_road_add_per_min=0.0, traffic_jam_add_per_min=0.0,
    )
    scenario = _build_scenario(
        recovery_model={
            "video_karaoke": ActivityRecovery(
                drowsiness_per_min=1.0, fatigue_per_min=0.5,
                cap_drowsiness=cap_drowsiness,
            ),
        },
        stages=[
            RecoveryStage(phase="content", content="video_karaoke", motion="MOVING"),
        ],
        drowsiness_model=dm,
        fatigue_model=fm,
        initial_drowsiness=90.0,
        initial_fatigue=90.0,
    )
    plan, facts = _tick_and_facts(scenario)
    rec = RecoveryState(
        active=True, option_id="opt", rest_spot=_SPOT,
        phase="content", stage_index=0, stage_ticks_remaining=0,
    )
    state = advance_tick(None, 0, plan, facts, scenario)  # tick 0 baseline
    for i in range(1, n_ticks + 1):
        state = advance_tick(state, i, plan, facts, scenario, recovery=rec)
        rec_next = (state.model_extra or {}).get("_recovery_next")
        if rec_next is not None:
            rec = rec_next
    return float(state.signals["simulated"]["drowsiness"])


def test_moving_content_stage_aggregate_recovery_is_capped_across_the_whole_stage():
    """Review fix (Slice-2 core Task 2 findings): a MOVING content stage with
    drowsiness_per_min=1.0 (per tick) and cap_drowsiness=5.0 must not recover
    more than 5.0 IN TOTAL across many en-route ticks, even though each
    single tick's raw amount (1.0) is well under the per-call cap of 5.0 --
    i.e. the cap must bound the SUM over the stage, not just each call.
    """
    # 20 ticks * 1.0/min = 20.0 raw if uncapped-per-tick would recover past the
    # cap many times over; the aggregate cap must stop total recovery at 5.0.
    capped_final = _moving_content_capped_drowsiness_after(20, cap_drowsiness=5.0)
    assert capped_final == pytest.approx(90.0 - 5.0)

    # An uncapped activity (cap_drowsiness=None) keeps recovering linearly --
    # confirms the cap (not some other clamp) is what bounded the capped case.
    uncapped_final = _moving_content_capped_drowsiness_after(20, cap_drowsiness=None)
    assert uncapped_final == pytest.approx(90.0 - 20.0)


def test_moving_wakefulness_stage_recovers_nothing():
    """A plain wakefulness MOVING stage (content=='wakefulness', no recovery_model
    entry) must still recover nothing — additive change does not touch it."""
    dm = DrowsinessModel(
        base_growth_per_min=0.3, night_add_per_min=0.0,
        monotony_add_per_min=0.0, traffic_jam_add_per_min=0.0,
    )
    fm = FatigueModel(
        base_growth_per_min=0.1, continuous_driving_add_per_min_after_60_min=0.0,
        mountain_road_add_per_min=0.0, traffic_jam_add_per_min=0.0,
    )
    scenario = _build_scenario(
        recovery_model={},  # no entries at all
        stages=[
            RecoveryStage(phase="wakefulness", content="wakefulness", motion="MOVING"),
        ],
        drowsiness_model=dm,
        fatigue_model=fm,
        initial_drowsiness=50.0,
        initial_fatigue=50.0,
    )
    plan, facts = _tick_and_facts(scenario)
    rec = RecoveryState(
        active=True, option_id="opt", rest_spot=_SPOT,
        phase="wakefulness", stage_index=0, stage_ticks_remaining=0,
    )
    no_rec_state = advance_tick(None, 0, plan, facts, scenario)
    with_rec_state = advance_tick(None, 0, plan, facts, scenario)
    for i in range(1, 4):
        no_rec_state = advance_tick(no_rec_state, i, plan, facts, scenario, recovery=None)
        with_rec_state = advance_tick(with_rec_state, i, plan, facts, scenario, recovery=rec)
    assert float(with_rec_state.signals["simulated"]["drowsiness"]) == float(
        no_rec_state.signals["simulated"]["drowsiness"]
    )


# ─── (c) Legacy flat-only entry — unchanged, exact fixed-once amount ─────────


def test_legacy_flat_only_recovers_exactly_the_flat_amount_once():
    dm, fm = _zero_growth_models()
    scenario = _build_scenario(
        recovery_model={
            "sleep": ActivityRecovery(drowsiness=35.0, fatigue=30.0),  # flat only
        },
        stages=[
            RecoveryStage(phase="wakefulness", content="wakefulness", motion="MOVING"),
            RecoveryStage(phase="nap", content="sleep", motion="STOPPED", ticks=3),
        ],
        drowsiness_model=dm,
        fatigue_model=fm,
        initial_drowsiness=90.0,
        initial_fatigue=80.0,
    )
    plan, facts = _tick_and_facts(scenario)
    prior = advance_tick(None, 0, plan, facts, scenario)
    rec = RecoveryState(
        active=True, option_id="opt", rest_spot=_SPOT,
        phase="nap", stage_index=1, stage_ticks_remaining=3,
    )
    out = advance_tick(prior, 1, plan, facts, scenario, recovery=rec)
    # Zero growth -> pre-recovery drowsiness/fatigue == initial values exactly.
    assert float(out.signals["simulated"]["drowsiness"]) == 90.0 - 35.0
    assert float(out.signals["simulated"]["fatigue"]) == 80.0 - 30.0


def test_legacy_flat_only_unaffected_by_stage_ticks_length():
    """Unchanged (feature 009) semantics: the flat amount does NOT scale with
    stage.ticks when no *_per_min field is set (back-compat)."""
    dm, fm = _zero_growth_models()

    def final_for(nap_ticks: int) -> float:
        scenario = _build_scenario(
            recovery_model={"sleep": ActivityRecovery(drowsiness=35.0, fatigue=30.0)},
            stages=[
                RecoveryStage(phase="wakefulness", content="wakefulness", motion="MOVING"),
                RecoveryStage(phase="nap", content="sleep", motion="STOPPED", ticks=nap_ticks),
            ],
            drowsiness_model=dm,
            fatigue_model=fm,
        )
        plan, facts = _tick_and_facts(scenario)
        prior = advance_tick(None, 0, plan, facts, scenario)
        rec = RecoveryState(
            active=True, option_id="opt", rest_spot=_SPOT,
            phase="nap", stage_index=1, stage_ticks_remaining=nap_ticks,
        )
        out = advance_tick(prior, 1, plan, facts, scenario, recovery=rec)
        return float(out.signals["simulated"]["drowsiness"])

    assert final_for(3) == final_for(6) == 90.0 - 35.0
