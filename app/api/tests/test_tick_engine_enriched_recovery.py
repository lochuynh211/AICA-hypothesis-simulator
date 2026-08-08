"""Tick engine — enriched recovery application (feature 020, Slice-2 core Task 2;
retargeted by the recovery-semantics refactor, Task 3).

Verifies the tick_engine recovery block applies the STOPPED-stage curve
(apply_stage_recovery_tick) from services/behavior/driver_signals.py:

  (a) STOPPED nap stage whose recovery_model[content] entry has any
      ``*_per_min`` field set recovers as a per-tick CURVE spread across the
      dwell — same whole-dwell TOTAL as the retired one-shot-on-entry model
      (stage_recovery_total over minutes = stage.ticks * tick_seconds / 60),
      just shaped differently: drowsiness strictly decreases on every tick of
      the dwell instead of dropping all at once on the entry tick.
  (b) [retired] MOVING content recovery via RecoveryStage.grants_moving_recovery
      is gone — recovery-semantics refactor replaces it with a MOVING +
      ContentContext path keyed by `<service_id>@<purpose>` (independent of
      RecoveryState), covered by tests/test_content_relief.py. A plain MOVING
      stage recovers nothing regardless of RecoveryState (see
      test_moving_wakefulness_stage_recovers_nothing below).
  (c) A legacy flat-only recovery_model entry (no per-min fields set) still
      recovers EXACTLY the flat amount in total across the dwell — the total
      is unchanged, only its per-tick shape moved from one-shot to spread
      (back-compat with feature 009's retired apply_rest_recovery).

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


# ─── (a) STOPPED nap stage — spread across the dwell, total preserved ────────


def _stopped_dwell_drowsiness_series(nap_ticks: int, *, recovery_model: dict) -> list[float]:
    """Walk every tick of a STOPPED nap stage of ``nap_ticks`` length, threading
    the accrued totals via `_recovery_next` the same way run_manager.py's
    production tick loop does (required to exercise apply_stage_recovery_tick's
    per-tick accrual, which lives ON RecoveryState).

    Returns the drowsiness signal after each of the ``nap_ticks`` ticks.
    """
    dm, fm = _zero_growth_models()
    scenario = _build_scenario(
        recovery_model=recovery_model,
        stages=[
            RecoveryStage(phase="wakefulness", content="wakefulness", motion="MOVING"),
            RecoveryStage(phase="nap", content="sleep", motion="STOPPED", ticks=nap_ticks),
        ],
        drowsiness_model=dm,
        fatigue_model=fm,
    )
    plan, facts = _tick_and_facts(scenario)
    state = advance_tick(None, 0, plan, facts, scenario)  # tick 0: establishes baseline
    rec = RecoveryState(
        active=True, option_id="opt", rest_spot=_SPOT,
        phase="nap", stage_index=1, stage_ticks_remaining=nap_ticks,
    )
    series = []
    for i in range(1, nap_ticks + 1):
        state = advance_tick(state, i, plan, facts, scenario, recovery=rec)
        series.append(float(state.signals["simulated"]["drowsiness"]))
        rec_next = (state.model_extra or {}).get("_recovery_next")
        if rec_next is not None:
            rec = rec_next
    return series


def test_stopped_nap_recovery_spreads_across_the_dwell_and_preserves_the_total():
    """Recovery-semantics refactor: the whole-dwell TOTAL matches the retired
    one-shot model exactly, but it lands as a strictly-decreasing curve across
    every tick of the dwell instead of all at once on the entry tick."""
    recovery_model = {"sleep": ActivityRecovery(drowsiness_per_min=1.0, fatigue_per_min=0.5)}

    series_short = _stopped_dwell_drowsiness_series(nap_ticks=3, recovery_model=recovery_model)
    series_long = _stopped_dwell_drowsiness_series(nap_ticks=6, recovery_model=recovery_model)

    # Strictly decreasing on every tick of the dwell (a curve, not a step).
    assert all(a > b for a, b in zip(series_short, series_short[1:]))
    assert all(a > b for a, b in zip(series_long, series_long[1:]))

    # Same whole-dwell totals as the retired one-shot model: 90 - (3*1.0) = 87;
    # 90 - (6*1.0) = 84.
    assert series_short[-1] == pytest.approx(87.0)
    assert series_long[-1] == pytest.approx(84.0)


def test_stopped_nap_dwell_total_scales_with_ticks_not_flat():
    """The whole-dwell recovered TOTAL must scale with stage.ticks, not be a
    fixed constant — unchanged invariant from the retired one-shot model."""
    recovery_model = {"sleep": ActivityRecovery(drowsiness_per_min=1.0, fatigue_per_min=0.5)}

    series_3 = _stopped_dwell_drowsiness_series(nap_ticks=3, recovery_model=recovery_model)
    series_9 = _stopped_dwell_drowsiness_series(nap_ticks=9, recovery_model=recovery_model)
    recovered_3 = 90.0 - series_3[-1]
    recovered_9 = 90.0 - series_9[-1]
    assert recovered_9 == pytest.approx(recovered_3 * 3)


# ─── (b) MOVING content stage — retired ───────────────────────────────────────
#
# The old grants_moving_recovery-gated per-tick MOVING recovery (keyed by
# RecoveryState + RecoveryStage) is retired by the recovery-semantics
# refactor. Its replacement is MOVING + a ContentContext, independent of
# RecoveryState — see tests/test_content_relief.py
# (test_content_active_freezes_the_engine_monotony_accumulator,
# test_content_relief_accrual_is_threaded_out_for_the_next_tick,
# test_a_new_episode_resets_the_accrual) for the equivalent coverage.
# test_moving_wakefulness_stage_recovers_nothing below still holds: a MOVING
# stage with an active RecoveryState but NO content plays recovers nothing.


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


# ─── (c) Legacy flat-only entry — total unchanged, now spread across dwell ───


def test_legacy_flat_only_recovers_exactly_the_flat_amount_in_total():
    """Recovery-semantics refactor: the flat amount is still recovered in
    full across the dwell (not per-tick) — the TOTAL is unchanged from the
    retired one-shot apply_rest_recovery, only its per-tick shape moved."""
    recovery_model = {"sleep": ActivityRecovery(drowsiness=35.0, fatigue=30.0)}  # flat only
    series = _stopped_dwell_drowsiness_series(nap_ticks=3, recovery_model=recovery_model)
    # Strictly decreasing across the dwell (spread, not a single step).
    assert all(a > b for a, b in zip(series, series[1:]))
    # Zero growth -> total recovered across the whole dwell == the flat amount.
    assert series[-1] == pytest.approx(90.0 - 35.0)


def test_legacy_flat_only_dwell_total_unaffected_by_stage_ticks_length():
    """Unchanged (feature 009) semantics: the flat TOTAL does NOT scale with
    stage.ticks when no *_per_min field is set (back-compat) — only how many
    ticks it takes to fully land changes."""
    recovery_model = {"sleep": ActivityRecovery(drowsiness=35.0, fatigue=30.0)}

    final_3 = _stopped_dwell_drowsiness_series(nap_ticks=3, recovery_model=recovery_model)[-1]
    final_6 = _stopped_dwell_drowsiness_series(nap_ticks=6, recovery_model=recovery_model)[-1]
    assert final_3 == pytest.approx(90.0 - 35.0)
    assert final_6 == pytest.approx(90.0 - 35.0)
