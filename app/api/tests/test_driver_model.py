"""TDD driver_model tests (T009) — RED first, then GREEN.

Tests for advance_driver_state and apply_rest_recovery.
"""

from __future__ import annotations

import pytest

from aica_api.models.profile import (
    AttentionModel,
    DriverModelProfile,
    DrowsinessModel,
    FatigueModel,
    RecoveryModel,
)
from aica_api.services.behavior.driver_model import (
    DriverState,
    advance_driver_state,
    apply_rest_recovery,
)

# ─── Fixtures ──────────────────────────────────────────────────────────────────

_PROFILE = DriverModelProfile(
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
    attention_model=AttentionModel(
        base_recovery_per_min=0.01,
        monotony_drop_per_min=0.05,
        drowsiness_drop_factor=0.2,
        active_content_recovery_per_min=0.04,
    ),
    recovery_model=RecoveryModel(
        short_rest_drowsiness_recovery=20.0,
        short_rest_fatigue_recovery=15.0,
        long_rest_drowsiness_recovery=35.0,
        long_rest_fatigue_recovery=30.0,
    ),
)

_INITIAL = DriverState(drowsiness=0.0, fatigue=30.0, attention=80.0)

_TICK_60 = 60  # 60-second tick


# ─── Basic advance ─────────────────────────────────────────────────────────────


def test_advance_returns_driver_update():
    from aica_api.services.behavior.driver_model import DriverUpdate

    update = advance_driver_state(
        _PROFILE, _INITIAL, _TICK_60,
        is_night=False, is_monotonous=False,
        is_traffic_jam=False, is_mountain_road=False,
        continuous_driving_min=0.0,
    )
    assert isinstance(update, DriverUpdate)


def test_advance_previous_state_preserved():
    update = advance_driver_state(
        _PROFILE, _INITIAL, _TICK_60,
        is_night=False, is_monotonous=False,
        is_traffic_jam=False, is_mountain_road=False,
        continuous_driving_min=0.0,
    )
    assert update.previous.drowsiness == _INITIAL.drowsiness
    assert update.previous.fatigue == _INITIAL.fatigue
    assert update.previous.attention == _INITIAL.attention


def test_advance_drowsiness_base_only():
    """With no modifiers, drowsiness grows by base_growth_per_min * scale."""
    update = advance_driver_state(
        _PROFILE, _INITIAL, _TICK_60,
        is_night=False, is_monotonous=False,
        is_traffic_jam=False, is_mountain_road=False,
        continuous_driving_min=0.0,
    )
    # scale = 60/60 = 1; drowsiness += 0.5 * 1 = 0.5
    expected = _INITIAL.drowsiness + 0.5
    assert abs(update.next.drowsiness - expected) < 1e-9


def test_advance_drowsiness_with_night():
    update = advance_driver_state(
        _PROFILE, _INITIAL, _TICK_60,
        is_night=True, is_monotonous=False,
        is_traffic_jam=False, is_mountain_road=False,
        continuous_driving_min=0.0,
    )
    # drowsiness += (0.5 + 0.4) * 1 = 0.9
    expected = 0.0 + 0.9
    assert abs(update.next.drowsiness - expected) < 1e-9


def test_advance_drowsiness_with_monotony():
    update = advance_driver_state(
        _PROFILE, _INITIAL, _TICK_60,
        is_night=False, is_monotonous=True,
        is_traffic_jam=False, is_mountain_road=False,
        continuous_driving_min=0.0,
    )
    expected = 0.0 + (0.5 + 0.3)
    assert abs(update.next.drowsiness - expected) < 1e-9


def test_advance_drowsiness_with_traffic_jam():
    update = advance_driver_state(
        _PROFILE, _INITIAL, _TICK_60,
        is_night=False, is_monotonous=False,
        is_traffic_jam=True, is_mountain_road=False,
        continuous_driving_min=0.0,
    )
    expected = 0.0 + (0.5 + 0.2)
    assert abs(update.next.drowsiness - expected) < 1e-9


def test_advance_drowsiness_all_modifiers():
    update = advance_driver_state(
        _PROFILE, _INITIAL, _TICK_60,
        is_night=True, is_monotonous=True,
        is_traffic_jam=True, is_mountain_road=False,
        continuous_driving_min=0.0,
    )
    expected = 0.0 + (0.5 + 0.4 + 0.3 + 0.2)
    assert abs(update.next.drowsiness - expected) < 1e-9


def test_advance_fatigue_base_only():
    update = advance_driver_state(
        _PROFILE, _INITIAL, _TICK_60,
        is_night=False, is_monotonous=False,
        is_traffic_jam=False, is_mountain_road=False,
        continuous_driving_min=0.0,
    )
    expected = 30.0 + 0.1
    assert abs(update.next.fatigue - expected) < 1e-9


def test_advance_fatigue_continuous_after_60min():
    """continuous_driving_add kicks in when continuous_driving_min >= 60."""
    update = advance_driver_state(
        _PROFILE, _INITIAL, _TICK_60,
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
        _PROFILE, _INITIAL, _TICK_60,
        is_night=False, is_monotonous=False,
        is_traffic_jam=False, is_mountain_road=False,
        continuous_driving_min=59.0,
    )
    expected = 30.0 + 0.1
    assert abs(update.next.fatigue - expected) < 1e-9


def test_advance_fatigue_mountain_road():
    update = advance_driver_state(
        _PROFILE, _INITIAL, _TICK_60,
        is_night=False, is_monotonous=False,
        is_traffic_jam=False, is_mountain_road=True,
        continuous_driving_min=0.0,
    )
    expected = 30.0 + 0.1 + 0.05
    assert abs(update.next.fatigue - expected) < 1e-9


def test_advance_fatigue_traffic_jam():
    update = advance_driver_state(
        _PROFILE, _INITIAL, _TICK_60,
        is_night=False, is_monotonous=False,
        is_traffic_jam=True, is_mountain_road=False,
        continuous_driving_min=0.0,
    )
    expected = 30.0 + 0.1 + 0.03
    assert abs(update.next.fatigue - expected) < 1e-9


def test_advance_attention_base_recovery_only():
    """With no monotony or drowsiness, attention recovers by base_recovery_per_min."""
    state = DriverState(drowsiness=0.0, fatigue=0.0, attention=50.0)
    update = advance_driver_state(
        _PROFILE, state, _TICK_60,
        is_night=False, is_monotonous=False,
        is_traffic_jam=False, is_mountain_road=False,
        continuous_driving_min=0.0,
    )
    # attention += base_recovery(0.01) - monotony_drop(0) - drowsiness_drop(0.2*0/100) + 0
    expected = 50.0 + 0.01
    assert abs(update.next.attention - expected) < 1e-9


def test_advance_attention_monotony_drop():
    update = advance_driver_state(
        _PROFILE, _INITIAL, _TICK_60,
        is_night=False, is_monotonous=True,
        is_traffic_jam=False, is_mountain_road=False,
        continuous_driving_min=0.0,
    )
    # attention += 0.01 - 0.05 - 0.2*(0/100)
    expected = 80.0 + 0.01 - 0.05
    assert abs(update.next.attention - expected) < 1e-9


def test_advance_attention_drowsiness_drop():
    """drowsiness_drop_factor * drowsiness/100 reduces attention."""
    state = DriverState(drowsiness=50.0, fatigue=0.0, attention=60.0)
    update = advance_driver_state(
        _PROFILE, state, _TICK_60,
        is_night=False, is_monotonous=False,
        is_traffic_jam=False, is_mountain_road=False,
        continuous_driving_min=0.0,
    )
    # attention += 0.01 - 0.2*(50/100) = 0.01 - 0.1 = -0.09
    expected = 60.0 + 0.01 - 0.2 * (50.0 / 100.0)
    assert abs(update.next.attention - expected) < 1e-9


def test_advance_attention_active_content_recovery():
    update = advance_driver_state(
        _PROFILE, _INITIAL, _TICK_60,
        is_night=False, is_monotonous=False,
        is_traffic_jam=False, is_mountain_road=False,
        continuous_driving_min=0.0,
        active_content=True,
    )
    # attention += 0.01 + 0.04 = 0.05
    expected = 80.0 + 0.01 + 0.04
    assert abs(update.next.attention - expected) < 1e-9


# ─── Clamping ──────────────────────────────────────────────────────────────────


def test_drowsiness_clamped_at_100():
    state = DriverState(drowsiness=99.9, fatigue=0.0, attention=80.0)
    update = advance_driver_state(
        _PROFILE, state, _TICK_60,
        is_night=True, is_monotonous=True,
        is_traffic_jam=True, is_mountain_road=False,
        continuous_driving_min=0.0,
    )
    assert update.next.drowsiness <= 100.0


def test_fatigue_clamped_at_100():
    state = DriverState(drowsiness=0.0, fatigue=99.9, attention=80.0)
    update = advance_driver_state(
        _PROFILE, state, _TICK_60,
        is_night=False, is_monotonous=False,
        is_traffic_jam=True, is_mountain_road=True,
        continuous_driving_min=60.0,
    )
    assert update.next.fatigue <= 100.0


def test_attention_clamped_at_0():
    state = DriverState(drowsiness=0.0, fatigue=0.0, attention=0.05)
    update = advance_driver_state(
        _PROFILE, state, _TICK_60,
        is_night=False, is_monotonous=True,
        is_traffic_jam=False, is_mountain_road=False,
        continuous_driving_min=0.0,
    )
    assert update.next.attention >= 0.0


def test_attention_clamped_at_100():
    state = DriverState(drowsiness=0.0, fatigue=0.0, attention=99.9)
    update = advance_driver_state(
        _PROFILE, state, _TICK_60,
        is_night=False, is_monotonous=False,
        is_traffic_jam=False, is_mountain_road=False,
        continuous_driving_min=0.0,
        active_content=True,
    )
    assert update.next.attention <= 100.0


# ─── Tick seconds scaling ─────────────────────────────────────────────────────


def test_tick_30s_half_rate():
    """30-second tick gives half the growth of a 60-second tick."""
    update_60 = advance_driver_state(
        _PROFILE, _INITIAL, 60,
        is_night=False, is_monotonous=False,
        is_traffic_jam=False, is_mountain_road=False,
        continuous_driving_min=0.0,
    )
    update_30 = advance_driver_state(
        _PROFILE, _INITIAL, 30,
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
        _PROFILE, _INITIAL, _TICK_60,
        is_night=False, is_monotonous=False,
        is_traffic_jam=False, is_mountain_road=False,
        continuous_driving_min=0.0,
    )
    assert abs(update.delta.drowsiness_base - 0.5) < 1e-9


def test_delta_night_zero_when_not_night():
    update = advance_driver_state(
        _PROFILE, _INITIAL, _TICK_60,
        is_night=False, is_monotonous=False,
        is_traffic_jam=False, is_mountain_road=False,
        continuous_driving_min=0.0,
    )
    assert update.delta.drowsiness_night == 0.0


def test_delta_night_nonzero_when_night():
    update = advance_driver_state(
        _PROFILE, _INITIAL, _TICK_60,
        is_night=True, is_monotonous=False,
        is_traffic_jam=False, is_mountain_road=False,
        continuous_driving_min=0.0,
    )
    assert update.delta.drowsiness_night == pytest.approx(0.4)


def test_delta_continuous_zero_before_60min():
    update = advance_driver_state(
        _PROFILE, _INITIAL, _TICK_60,
        is_night=False, is_monotonous=False,
        is_traffic_jam=False, is_mountain_road=False,
        continuous_driving_min=30.0,
    )
    assert update.delta.fatigue_continuous == 0.0


def test_delta_continuous_nonzero_at_60min():
    update = advance_driver_state(
        _PROFILE, _INITIAL, _TICK_60,
        is_night=False, is_monotonous=False,
        is_traffic_jam=False, is_mountain_road=False,
        continuous_driving_min=60.0,
    )
    assert update.delta.fatigue_continuous == pytest.approx(0.04)


# ─── Recovery ──────────────────────────────────────────────────────────────────


def test_short_rest_reduces_drowsiness():
    state = DriverState(drowsiness=50.0, fatigue=40.0, attention=40.0)
    recovered = apply_rest_recovery(_PROFILE, state, "short")
    assert recovered.drowsiness == pytest.approx(50.0 - 20.0)


def test_short_rest_reduces_fatigue():
    state = DriverState(drowsiness=50.0, fatigue=40.0, attention=40.0)
    recovered = apply_rest_recovery(_PROFILE, state, "short")
    assert recovered.fatigue == pytest.approx(40.0 - 15.0)


def test_long_rest_reduces_drowsiness():
    state = DriverState(drowsiness=50.0, fatigue=50.0, attention=40.0)
    recovered = apply_rest_recovery(_PROFILE, state, "long")
    assert recovered.drowsiness == pytest.approx(50.0 - 35.0)


def test_long_rest_reduces_fatigue():
    state = DriverState(drowsiness=50.0, fatigue=50.0, attention=40.0)
    recovered = apply_rest_recovery(_PROFILE, state, "long")
    assert recovered.fatigue == pytest.approx(50.0 - 30.0)


def test_rest_recovery_clamped_at_zero():
    state = DriverState(drowsiness=5.0, fatigue=5.0, attention=50.0)
    recovered = apply_rest_recovery(_PROFILE, state, "long")
    assert recovered.drowsiness >= 0.0
    assert recovered.fatigue >= 0.0


# ─── Determinism ──────────────────────────────────────────────────────────────


def test_advance_deterministic():
    u1 = advance_driver_state(
        _PROFILE, _INITIAL, _TICK_60,
        is_night=False, is_monotonous=True,
        is_traffic_jam=False, is_mountain_road=False,
        continuous_driving_min=0.0,
    )
    u2 = advance_driver_state(
        _PROFILE, _INITIAL, _TICK_60,
        is_night=False, is_monotonous=True,
        is_traffic_jam=False, is_mountain_road=False,
        continuous_driving_min=0.0,
    )
    assert u1.next.drowsiness == u2.next.drowsiness
    assert u1.next.fatigue == u2.next.fatigue
    assert u1.next.attention == u2.next.attention
