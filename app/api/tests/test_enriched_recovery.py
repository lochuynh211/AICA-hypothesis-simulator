"""Slice-2 (feature 020) enriched recovery model tests.

Covers:
  * ActivityRecovery opt-in fields (drowsiness_per_min, fatigue_per_min,
    cap_drowsiness, cap_fatigue) — additive, non-neg, extra="forbid" kept.
  * apply_rest_recovery_minutes — duration-scaled recovery for a STOPPED
    activity of `minutes` length: flat_amount + min(cap, per_min * minutes).
    Flat-only entries must recover the flat amount regardless of minutes
    (back-compat, byte-identical to the existing apply_rest_recovery).
  * apply_rest_recovery_rate — per-tick accrual for a MOVING/en-route
    activity: subtract per_min * tick_minutes each call, capped, never < 0.

apply_rest_recovery itself is UNCHANGED (see test_driver_signals.py).
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from aica_api.models.profile import (
    ActivityRecovery,
    DriverSignalParams,
    DrowsinessModel,
    FatigueModel,
)
from aica_api.services.behavior.driver_signals import (
    DriverState,
    apply_rest_recovery,
    apply_rest_recovery_minutes,
    apply_rest_recovery_rate,
)

# ─── Fixtures ──────────────────────────────────────────────────────────────────

_PARAMS = DriverSignalParams(
    id="test_driver_enriched",
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
        # legacy flat-only entry (back-compat)
        "stretch_flat_only": ActivityRecovery(drowsiness=20.0, fatigue=15.0),
        # rate-only, no cap
        "nap_rate_only": ActivityRecovery(
            drowsiness_per_min=1.0, fatigue_per_min=0.5
        ),
        # rate + cap
        "nap_capped": ActivityRecovery(
            drowsiness_per_min=1.0,
            fatigue_per_min=0.5,
            cap_drowsiness=15.0,
            cap_fatigue=8.0,
        ),
        # flat + rate combined
        "combo": ActivityRecovery(
            drowsiness=5.0,
            fatigue=2.0,
            drowsiness_per_min=1.0,
            fatigue_per_min=0.5,
        ),
    },
)


# ─── ActivityRecovery model — opt-in fields ────────────────────────────────────


def test_activity_recovery_new_fields_default_zero_and_none():
    rec = ActivityRecovery()
    assert rec.drowsiness == 0.0
    assert rec.fatigue == 0.0
    assert rec.drowsiness_per_min == 0.0
    assert rec.fatigue_per_min == 0.0
    assert rec.cap_drowsiness is None
    assert rec.cap_fatigue is None


def test_activity_recovery_accepts_new_fields():
    rec = ActivityRecovery(
        drowsiness=10.0,
        fatigue=5.0,
        drowsiness_per_min=1.0,
        fatigue_per_min=0.5,
        cap_drowsiness=15.0,
        cap_fatigue=8.0,
    )
    assert rec.drowsiness_per_min == 1.0
    assert rec.fatigue_per_min == 0.5
    assert rec.cap_drowsiness == 15.0
    assert rec.cap_fatigue == 8.0


def test_activity_recovery_rejects_negative_drowsiness_per_min():
    with pytest.raises(ValidationError):
        ActivityRecovery(drowsiness_per_min=-1.0)


def test_activity_recovery_rejects_negative_fatigue_per_min():
    with pytest.raises(ValidationError):
        ActivityRecovery(fatigue_per_min=-1.0)


def test_activity_recovery_still_forbids_extra_fields():
    with pytest.raises(ValidationError):
        ActivityRecovery(bogus_field=1.0)


# ─── apply_rest_recovery_minutes — back-compat (flat-only) ────────────────────


def test_minutes_flat_only_recovers_flat_amount_regardless_of_minutes():
    state = DriverState(drowsiness=80.0, fatigue=80.0)
    short = apply_rest_recovery_minutes(_PARAMS, state, "stretch_flat_only", minutes=1)
    long = apply_rest_recovery_minutes(
        _PARAMS, state, "stretch_flat_only", minutes=100
    )
    assert short.drowsiness == pytest.approx(80.0 - 20.0)
    assert short.fatigue == pytest.approx(80.0 - 15.0)
    assert short.drowsiness == long.drowsiness
    assert short.fatigue == long.fatigue


def test_minutes_flat_only_matches_apply_rest_recovery_exactly():
    """Byte-identical to the existing (unchanged) apply_rest_recovery."""
    state = DriverState(drowsiness=63.0, fatigue=47.0)
    expected = apply_rest_recovery(_PARAMS, state, "stretch_flat_only")
    actual = apply_rest_recovery_minutes(
        _PARAMS, state, "stretch_flat_only", minutes=42.0
    )
    assert actual.drowsiness == expected.drowsiness
    assert actual.fatigue == expected.fatigue


# ─── apply_rest_recovery_minutes — rate-scaled ────────────────────────────────


def test_minutes_rate_only_scales_by_duration_no_cap():
    state = DriverState(drowsiness=80.0, fatigue=80.0)
    result = apply_rest_recovery_minutes(_PARAMS, state, "nap_rate_only", minutes=20)
    assert result.drowsiness == pytest.approx(80.0 - 20.0)  # 1.0 * 20
    assert result.fatigue == pytest.approx(80.0 - 10.0)  # 0.5 * 20


def test_minutes_rate_capped_by_cap_drowsiness_and_cap_fatigue():
    state = DriverState(drowsiness=80.0, fatigue=80.0)
    result = apply_rest_recovery_minutes(_PARAMS, state, "nap_capped", minutes=20)
    # raw drowsiness recovery would be 1.0*20=20, capped at 15
    assert result.drowsiness == pytest.approx(80.0 - 15.0)
    # raw fatigue recovery would be 0.5*20=10, capped at 8
    assert result.fatigue == pytest.approx(80.0 - 8.0)


def test_minutes_flat_plus_rate_combined():
    state = DriverState(drowsiness=80.0, fatigue=80.0)
    result = apply_rest_recovery_minutes(_PARAMS, state, "combo", minutes=10)
    # drowsiness: flat 5.0 + rate 1.0*10=10.0 -> total 15.0
    assert result.drowsiness == pytest.approx(80.0 - 15.0)
    # fatigue: flat 2.0 + rate 0.5*10=5.0 -> total 7.0
    assert result.fatigue == pytest.approx(80.0 - 7.0)


def test_minutes_unknown_activity_recovers_nothing():
    state = DriverState(drowsiness=50.0, fatigue=40.0)
    result = apply_rest_recovery_minutes(_PARAMS, state, "unlisted_activity", minutes=30)
    assert result.drowsiness == pytest.approx(50.0)
    assert result.fatigue == pytest.approx(40.0)


def test_minutes_recovery_clamped_at_zero():
    state = DriverState(drowsiness=5.0, fatigue=5.0)
    result = apply_rest_recovery_minutes(_PARAMS, state, "nap_rate_only", minutes=100)
    assert result.drowsiness == 0.0
    assert result.fatigue == 0.0


# ─── apply_rest_recovery_rate — per-tick accrual ──────────────────────────────


def test_rate_subtracts_per_min_times_tick_minutes():
    state = DriverState(drowsiness=80.0, fatigue=80.0)
    result = apply_rest_recovery_rate(_PARAMS, state, "nap_rate_only", tick_minutes=0.5)
    assert result.drowsiness == pytest.approx(80.0 - 0.5)  # 1.0 * 0.5
    assert result.fatigue == pytest.approx(80.0 - 0.25)  # 0.5 * 0.5


def test_rate_accumulates_across_repeated_calls():
    state = DriverState(drowsiness=80.0, fatigue=80.0)
    after_1 = apply_rest_recovery_rate(_PARAMS, state, "nap_rate_only", tick_minutes=1.0)
    after_2 = apply_rest_recovery_rate(
        _PARAMS, after_1, "nap_rate_only", tick_minutes=1.0
    )
    assert after_2.drowsiness == pytest.approx(80.0 - 2.0)
    assert after_2.fatigue == pytest.approx(80.0 - 1.0)


def test_rate_never_goes_below_zero():
    state = DriverState(drowsiness=0.3, fatigue=0.1)
    result = apply_rest_recovery_rate(_PARAMS, state, "nap_rate_only", tick_minutes=5.0)
    assert result.drowsiness == 0.0
    assert result.fatigue == 0.0


def test_rate_unknown_activity_recovers_nothing():
    state = DriverState(drowsiness=50.0, fatigue=40.0)
    result = apply_rest_recovery_rate(_PARAMS, state, "unlisted_activity", tick_minutes=1.0)
    assert result.drowsiness == pytest.approx(50.0)
    assert result.fatigue == pytest.approx(40.0)


def test_rate_capped_per_call():
    state = DriverState(drowsiness=80.0, fatigue=80.0)
    # tick_minutes=100 would give a huge raw amount without the cap
    result = apply_rest_recovery_rate(_PARAMS, state, "nap_capped", tick_minutes=100.0)
    assert result.drowsiness == pytest.approx(80.0 - 15.0)
    assert result.fatigue == pytest.approx(80.0 - 8.0)
