"""Driver signals tests (feature 009, renamed from test_driver_model.py).

Tests for advance_driver_state and apply_rest_recovery — drowsiness/fatigue
only.  The attention signal is retired (feature 009 signal-tier redesign).
"""

from __future__ import annotations

import pytest

from aica_api.models.profile import (
    ActivityRecovery,
    DriverSignalParams,
    DrowsinessModel,
    FatigueModel,
)
from aica_api.services.behavior.driver_signals import (
    DriverState,
    advance_driver_state,
    apply_rest_recovery,
)

# ─── Fixtures ──────────────────────────────────────────────────────────────────

_PARAMS = DriverSignalParams(
    id="test_driver",
    drowsiness_model=DrowsinessModel(
        base_growth_per_min=0.5,
        night_add_per_min=0.4,
        monotony_add_per_min=0.3,
        traffic_jam_add_per_min=0.2,
    ),
    fatigue_model=FatigueModel(
        base_growth_per_min=0.1,
        continuous_driving_add_per_min_after_60_min=0.04,
        mountain_road_add_per_min=0.05,
        traffic_jam_add_per_min=0.03,
    ),
    recovery_model={
        "stretch": ActivityRecovery(drowsiness=20.0, fatigue=15.0),
        "sleep": ActivityRecovery(drowsiness=35.0, fatigue=30.0),
    },
)

_INITIAL = DriverState(drowsiness=0.0, fatigue=30.0)

_TICK_60 = 60  # 60-second tick


# ─── Basic advance ─────────────────────────────────────────────────────────────


def test_advance_returns_driver_update():
    from aica_api.services.behavior.driver_signals import DriverUpdate

    update = advance_driver_state(
        _PARAMS, _INITIAL, _TICK_60,
        is_night=False, is_monotonous=False,
        is_traffic_jam=False, is_mountain_road=False,
        continuous_driving_min=0.0,
    )
    assert isinstance(update, DriverUpdate)


def test_advance_previous_state_preserved():
    update = advance_driver_state(
        _PARAMS, _INITIAL, _TICK_60,
        is_night=False, is_monotonous=False,
        is_traffic_jam=False, is_mountain_road=False,
        continuous_driving_min=0.0,
    )
    assert update.previous.drowsiness == _INITIAL.drowsiness
    assert update.previous.fatigue == _INITIAL.fatigue


def test_advance_drowsiness_base_only():
    """With no modifiers, drowsiness grows by base_growth_per_min * scale."""
    update = advance_driver_state(
        _PARAMS, _INITIAL, _TICK_60,
        is_night=False, is_monotonous=False,
        is_traffic_jam=False, is_mountain_road=False,
        continuous_driving_min=0.0,
    )
    # scale = 60/60 = 1; drowsiness += 0.5 * 1 = 0.5
    expected = _INITIAL.drowsiness + 0.5
    assert abs(update.next.drowsiness - expected) < 1e-9


def test_advance_drowsiness_with_night():
    update = advance_driver_state(
        _PARAMS, _INITIAL, _TICK_60,
        is_night=True, is_monotonous=False,
        is_traffic_jam=False, is_mountain_road=False,
        continuous_driving_min=0.0,
    )
    # drowsiness += (0.5 + 0.4) * 1 = 0.9
    expected = 0.0 + 0.9
    assert abs(update.next.drowsiness - expected) < 1e-9


def test_advance_drowsiness_with_monotony():
    update = advance_driver_state(
        _PARAMS, _INITIAL, _TICK_60,
        is_night=False, is_monotonous=True,
        is_traffic_jam=False, is_mountain_road=False,
        continuous_driving_min=0.0,
    )
    expected = 0.0 + (0.5 + 0.3)
    assert abs(update.next.drowsiness - expected) < 1e-9


def test_advance_drowsiness_with_traffic_jam():
    update = advance_driver_state(
        _PARAMS, _INITIAL, _TICK_60,
        is_night=False, is_monotonous=False,
        is_traffic_jam=True, is_mountain_road=False,
        continuous_driving_min=0.0,
    )
    expected = 0.0 + (0.5 + 0.2)
    assert abs(update.next.drowsiness - expected) < 1e-9


def test_advance_drowsiness_all_modifiers():
    update = advance_driver_state(
        _PARAMS, _INITIAL, _TICK_60,
        is_night=True, is_monotonous=True,
        is_traffic_jam=True, is_mountain_road=False,
        continuous_driving_min=0.0,
    )
    expected = 0.0 + (0.5 + 0.4 + 0.3 + 0.2)
    assert abs(update.next.drowsiness - expected) < 1e-9


def test_advance_fatigue_base_only():
    update = advance_driver_state(
        _PARAMS, _INITIAL, _TICK_60,
        is_night=False, is_monotonous=False,
        is_traffic_jam=False, is_mountain_road=False,
        continuous_driving_min=0.0,
    )
    expected = 30.0 + 0.1
    assert abs(update.next.fatigue - expected) < 1e-9


def test_advance_fatigue_continuous_after_60min():
    """continuous_driving_add kicks in when continuous_driving_min >= 60."""
    update = advance_driver_state(
        _PARAMS, _INITIAL, _TICK_60,
        is_night=False, is_monotonous=False,
        is_traffic_jam=False, is_mountain_road=False,
        continuous_driving_min=60.0,
    )
    # fatigue += (0.1 + 0.04) = 0.14
    expected = 30.0 + 0.1 + 0.04
    assert abs(update.next.fatigue - expected) < 1e-9


def test_advance_fatigue_continuous_before_60min():
    """continuous_driving_add does NOT kick in when continuous_driving_min < 60."""
    update = advance_driver_state(
        _PARAMS, _INITIAL, _TICK_60,
        is_night=False, is_monotonous=False,
        is_traffic_jam=False, is_mountain_road=False,
        continuous_driving_min=59.0,
    )
    expected = 30.0 + 0.1
    assert abs(update.next.fatigue - expected) < 1e-9


def test_advance_fatigue_mountain_road():
    update = advance_driver_state(
        _PARAMS, _INITIAL, _TICK_60,
        is_night=False, is_monotonous=False,
        is_traffic_jam=False, is_mountain_road=True,
        continuous_driving_min=0.0,
    )
    expected = 30.0 + 0.1 + 0.05
    assert abs(update.next.fatigue - expected) < 1e-9


def test_advance_fatigue_traffic_jam():
    update = advance_driver_state(
        _PARAMS, _INITIAL, _TICK_60,
        is_night=False, is_monotonous=False,
        is_traffic_jam=True, is_mountain_road=False,
        continuous_driving_min=0.0,
    )
    expected = 30.0 + 0.1 + 0.03
    assert abs(update.next.fatigue - expected) < 1e-9


# ─── Clamping ──────────────────────────────────────────────────────────────────


def test_drowsiness_clamped_at_100():
    state = DriverState(drowsiness=99.9, fatigue=0.0)
    update = advance_driver_state(
        _PARAMS, state, _TICK_60,
        is_night=True, is_monotonous=True,
        is_traffic_jam=True, is_mountain_road=False,
        continuous_driving_min=0.0,
    )
    assert update.next.drowsiness <= 100.0


def test_fatigue_clamped_at_100():
    state = DriverState(drowsiness=0.0, fatigue=99.9)
    update = advance_driver_state(
        _PARAMS, state, _TICK_60,
        is_night=False, is_monotonous=False,
        is_traffic_jam=True, is_mountain_road=True,
        continuous_driving_min=60.0,
    )
    assert update.next.fatigue <= 100.0


# ─── Tick seconds scaling ─────────────────────────────────────────────────────


def test_tick_30s_half_rate():
    """30-second tick gives half the growth of a 60-second tick."""
    update_60 = advance_driver_state(
        _PARAMS, _INITIAL, 60,
        is_night=False, is_monotonous=False,
        is_traffic_jam=False, is_mountain_road=False,
        continuous_driving_min=0.0,
    )
    update_30 = advance_driver_state(
        _PARAMS, _INITIAL, 30,
        is_night=False, is_monotonous=False,
        is_traffic_jam=False, is_mountain_road=False,
        continuous_driving_min=0.0,
    )
    d60 = update_60.next.drowsiness - _INITIAL.drowsiness
    d30 = update_30.next.drowsiness - _INITIAL.drowsiness
    assert abs(d30 - d60 / 2.0) < 1e-9


# ─── Component deltas ─────────────────────────────────────────────────────────


def test_delta_base_drowsiness():
    update = advance_driver_state(
        _PARAMS, _INITIAL, _TICK_60,
        is_night=False, is_monotonous=False,
        is_traffic_jam=False, is_mountain_road=False,
        continuous_driving_min=0.0,
    )
    assert abs(update.delta.drowsiness_base - 0.5) < 1e-9


def test_delta_night_zero_when_not_night():
    update = advance_driver_state(
        _PARAMS, _INITIAL, _TICK_60,
        is_night=False, is_monotonous=False,
        is_traffic_jam=False, is_mountain_road=False,
        continuous_driving_min=0.0,
    )
    assert update.delta.drowsiness_night == 0.0


def test_delta_night_nonzero_when_night():
    update = advance_driver_state(
        _PARAMS, _INITIAL, _TICK_60,
        is_night=True, is_monotonous=False,
        is_traffic_jam=False, is_mountain_road=False,
        continuous_driving_min=0.0,
    )
    assert update.delta.drowsiness_night == pytest.approx(0.4)


def test_delta_continuous_zero_before_60min():
    update = advance_driver_state(
        _PARAMS, _INITIAL, _TICK_60,
        is_night=False, is_monotonous=False,
        is_traffic_jam=False, is_mountain_road=False,
        continuous_driving_min=30.0,
    )
    assert update.delta.fatigue_continuous == 0.0


def test_delta_continuous_nonzero_at_60min():
    update = advance_driver_state(
        _PARAMS, _INITIAL, _TICK_60,
        is_night=False, is_monotonous=False,
        is_traffic_jam=False, is_mountain_road=False,
        continuous_driving_min=60.0,
    )
    assert update.delta.fatigue_continuous == pytest.approx(0.04)


# ─── Recovery ──────────────────────────────────────────────────────────────────


def test_activity_reduces_drowsiness():
    state = DriverState(drowsiness=50.0, fatigue=40.0)
    recovered = apply_rest_recovery(_PARAMS, state, "stretch")
    assert recovered.drowsiness == pytest.approx(50.0 - 20.0)


def test_activity_reduces_fatigue():
    state = DriverState(drowsiness=50.0, fatigue=40.0)
    recovered = apply_rest_recovery(_PARAMS, state, "stretch")
    assert recovered.fatigue == pytest.approx(40.0 - 15.0)


def test_higher_recovery_activity_reduces_drowsiness_more():
    state = DriverState(drowsiness=50.0, fatigue=50.0)
    recovered = apply_rest_recovery(_PARAMS, state, "sleep")
    assert recovered.drowsiness == pytest.approx(50.0 - 35.0)


def test_higher_recovery_activity_reduces_fatigue_more():
    state = DriverState(drowsiness=50.0, fatigue=50.0)
    recovered = apply_rest_recovery(_PARAMS, state, "sleep")
    assert recovered.fatigue == pytest.approx(50.0 - 30.0)


def test_unknown_activity_recovers_nothing():
    state = DriverState(drowsiness=50.0, fatigue=40.0)
    recovered = apply_rest_recovery(_PARAMS, state, "unlisted_activity")
    assert recovered.drowsiness == pytest.approx(50.0)
    assert recovered.fatigue == pytest.approx(40.0)


def test_rest_recovery_clamped_at_zero():
    state = DriverState(drowsiness=5.0, fatigue=5.0)
    recovered = apply_rest_recovery(_PARAMS, state, "sleep")
    assert recovered.drowsiness >= 0.0
    assert recovered.fatigue >= 0.0


# ─── Determinism ──────────────────────────────────────────────────────────────


def test_advance_deterministic():
    u1 = advance_driver_state(
        _PARAMS, _INITIAL, _TICK_60,
        is_night=False, is_monotonous=True,
        is_traffic_jam=False, is_mountain_road=False,
        continuous_driving_min=0.0,
    )
    u2 = advance_driver_state(
        _PARAMS, _INITIAL, _TICK_60,
        is_night=False, is_monotonous=True,
        is_traffic_jam=False, is_mountain_road=False,
        continuous_driving_min=0.0,
    )
    assert u1.next.drowsiness == u2.next.drowsiness
    assert u1.next.fatigue == u2.next.fatigue


def test_driver_state_has_no_attention_field():
    """DriverState is drowsiness/fatigue only — attention is retired (feature 009)."""
    import dataclasses

    field_names = {f.name for f in dataclasses.fields(DriverState)}
    assert field_names == {"drowsiness", "fatigue"}


# ── Recovery-semantics refactor (Task 2) ────────────────────────────────────

from aica_api.models.profile import ActivityRecovery
from aica_api.services.behavior.driver_signals import (
    apply_stage_recovery_tick,
    apply_stimulus_relief,
    stage_recovery_total,
)


def _params_with(recovery_model):
    """Minimal DriverSignalParams carrying only the recovery map under test."""
    from aica_api.models.profile import DriverSignalParams, DrowsinessModel, FatigueModel

    return DriverSignalParams(
        id="test",
        drowsiness_model=DrowsinessModel(
            base_growth_per_min=0.1,
            night_add_per_min=0.2,
            monotony_add_per_min=0.5,
            traffic_jam_add_per_min=0.3,
        ),
        fatigue_model=FatigueModel(
            base_growth_per_min=0.1,
            continuous_driving_add_per_min_after_60_min=0.2,
            mountain_road_add_per_min=0.3,
            traffic_jam_add_per_min=0.1,
        ),
        recovery_model=recovery_model,
    )


def test_suppress_monotony_growth_zeroes_only_the_monotony_term():
    params = _params_with({})
    state = DriverState(drowsiness=10.0, fatigue=10.0)
    kwargs = dict(
        is_night=True,
        is_monotonous=True,
        is_traffic_jam=True,
        is_mountain_road=False,
        continuous_driving_min=0.0,
    )
    normal = advance_driver_state(params, state, 60, **kwargs)
    suppressed = advance_driver_state(
        params, state, 60, suppress_monotony_growth=True, **kwargs
    )
    assert normal.delta.drowsiness_monotony == pytest.approx(0.5)
    assert suppressed.delta.drowsiness_monotony == 0.0
    # every other component is untouched
    assert suppressed.delta.drowsiness_base == normal.delta.drowsiness_base
    assert suppressed.delta.drowsiness_night == normal.delta.drowsiness_night
    assert suppressed.delta.drowsiness_jam == normal.delta.drowsiness_jam
    assert suppressed.next.drowsiness == pytest.approx(normal.next.drowsiness - 0.5)


def test_stage_recovery_total_matches_the_legacy_duration_scaled_amount():
    params = _params_with(
        {"sleep": ActivityRecovery(drowsiness=10.0, drowsiness_per_min=1.0, cap_drowsiness=20.0)}
    )
    # flat 10 + min(cap 20, 1.0 * 30 min) = 10 + 20 = 30
    drowsiness_total, fatigue_total = stage_recovery_total(params, "sleep", minutes=30.0)
    assert drowsiness_total == pytest.approx(30.0)
    assert fatigue_total == pytest.approx(0.0)


def test_stage_recovery_tick_spreads_the_total_evenly_and_never_exceeds_it():
    params = _params_with({"sleep": ActivityRecovery(drowsiness=30.0)})
    state = DriverState(drowsiness=100.0, fatigue=100.0)
    accrued_d = accrued_f = 0.0
    # 3 ticks of 600s = 10 min each => 30 minutes total dwell
    for _ in range(3):
        state, accrued_d, accrued_f = apply_stage_recovery_tick(
            params, state, "sleep",
            stage_ticks=3, tick_seconds=600.0,
            accrued_drowsiness=accrued_d, accrued_fatigue=accrued_f,
        )
    assert accrued_d == pytest.approx(30.0)
    assert state.drowsiness == pytest.approx(70.0)
    # a fourth tick grants nothing — the aggregate total is spent
    state, accrued_d, accrued_f = apply_stage_recovery_tick(
        params, state, "sleep",
        stage_ticks=3, tick_seconds=600.0,
        accrued_drowsiness=accrued_d, accrued_fatigue=accrued_f,
    )
    assert accrued_d == pytest.approx(30.0)
    assert state.drowsiness == pytest.approx(70.0)


def test_stimulus_relief_drains_per_minute_and_saturates_at_the_cap():
    params = _params_with(
        {"quiz@monotony": ActivityRecovery(stimulus_relief_per_min=2.0, cap_stimulus=5.0)}
    )
    drained, accrued = apply_stimulus_relief(
        params, "quiz@monotony", tick_minutes=2.0, accrued_stimulus=0.0
    )
    assert drained == pytest.approx(4.0)
    assert accrued == pytest.approx(4.0)
    # next tick may only take the remaining 1.0 of headroom
    drained, accrued = apply_stimulus_relief(
        params, "quiz@monotony", tick_minutes=2.0, accrued_stimulus=accrued
    )
    assert drained == pytest.approx(1.0)
    assert accrued == pytest.approx(5.0)


def test_stimulus_relief_for_an_unknown_key_drains_nothing():
    params = _params_with({})
    drained, accrued = apply_stimulus_relief(
        params, "no_such@monotony", tick_minutes=5.0, accrued_stimulus=0.0
    )
    assert drained == 0.0
    assert accrued == 0.0
