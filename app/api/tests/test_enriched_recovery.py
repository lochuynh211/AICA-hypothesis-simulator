"""Slice-2 (feature 020) enriched recovery model tests.

Covers:
  * ActivityRecovery opt-in fields (drowsiness_per_min, fatigue_per_min,
    cap_drowsiness, cap_fatigue) — additive, non-neg, extra="forbid" kept.
  * apply_stage_recovery_tick (stage_ticks=1) — duration-scaled recovery for
    a STOPPED activity of `minutes` length: flat_amount + min(cap, per_min *
    minutes). Flat-only entries must recover the flat amount regardless of
    minutes (back-compat with the retired one-shot apply_rest_recovery;
    recovery-semantics refactor, Task 3).
  * apply_rest_recovery_rate — per-tick accrual for a MOVING/en-route
    activity: subtract per_min * tick_minutes each call, capped, never < 0.

Recovery-semantics refactor (Task 3): apply_rest_recovery and
apply_rest_recovery_minutes are retired. A single apply_stage_recovery_tick
call with stage_ticks=1 grants the whole activity's total in one shot,
reproducing their exact behavior (see test_driver_signals.py for the
one-shot-only assertions).
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
    apply_rest_recovery_rate,
    apply_rest_recovery_rate_capped,
    apply_stage_recovery_tick,
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


# ─── apply_stage_recovery_tick (stage_ticks=1) — back-compat (flat-only) ──────


def _recover_minutes(activity: str, state: DriverState, minutes: float) -> DriverState:
    """A single stage_ticks=1 call grants the whole activity's total in one
    shot — the same shape the retired apply_rest_recovery_minutes had."""
    recovered, _acc_d, _acc_f = apply_stage_recovery_tick(
        _PARAMS, state, activity,
        stage_ticks=1, tick_seconds=minutes * 60.0,
        accrued_drowsiness=0.0, accrued_fatigue=0.0,
    )
    return recovered


def test_minutes_flat_only_recovers_flat_amount_regardless_of_minutes():
    state = DriverState(drowsiness=80.0, fatigue=80.0)
    short = _recover_minutes("stretch_flat_only", state, minutes=1)
    long = _recover_minutes("stretch_flat_only", state, minutes=100)
    assert short.drowsiness == pytest.approx(80.0 - 20.0)
    assert short.fatigue == pytest.approx(80.0 - 15.0)
    assert short.drowsiness == long.drowsiness
    assert short.fatigue == long.fatigue


def test_minutes_flat_only_matches_stage_recovery_total_exactly():
    """stage_ticks=1 grants stage_recovery_total's full amount in one call —
    the invariant apply_stage_recovery_tick relies on to be calibration-
    preserving (byte-identical to the retired one-shot apply_rest_recovery)."""
    from aica_api.services.behavior.driver_signals import stage_recovery_total

    state = DriverState(drowsiness=63.0, fatigue=47.0)
    expected_d, expected_f = stage_recovery_total(_PARAMS, "stretch_flat_only", minutes=42.0)
    actual = _recover_minutes("stretch_flat_only", state, minutes=42.0)
    assert actual.drowsiness == pytest.approx(63.0 - expected_d)
    assert actual.fatigue == pytest.approx(47.0 - expected_f)


# ─── apply_stage_recovery_tick (stage_ticks=1) — rate-scaled ──────────────────


def test_minutes_rate_only_scales_by_duration_no_cap():
    state = DriverState(drowsiness=80.0, fatigue=80.0)
    result = _recover_minutes("nap_rate_only", state, minutes=20)
    assert result.drowsiness == pytest.approx(80.0 - 20.0)  # 1.0 * 20
    assert result.fatigue == pytest.approx(80.0 - 10.0)  # 0.5 * 20


def test_minutes_rate_capped_by_cap_drowsiness_and_cap_fatigue():
    state = DriverState(drowsiness=80.0, fatigue=80.0)
    result = _recover_minutes("nap_capped", state, minutes=20)
    # raw drowsiness recovery would be 1.0*20=20, capped at 15
    assert result.drowsiness == pytest.approx(80.0 - 15.0)
    # raw fatigue recovery would be 0.5*20=10, capped at 8
    assert result.fatigue == pytest.approx(80.0 - 8.0)


def test_minutes_flat_plus_rate_combined():
    state = DriverState(drowsiness=80.0, fatigue=80.0)
    result = _recover_minutes("combo", state, minutes=10)
    # drowsiness: flat 5.0 + rate 1.0*10=10.0 -> total 15.0
    assert result.drowsiness == pytest.approx(80.0 - 15.0)
    # fatigue: flat 2.0 + rate 0.5*10=5.0 -> total 7.0
    assert result.fatigue == pytest.approx(80.0 - 7.0)


def test_minutes_unknown_activity_recovers_nothing():
    state = DriverState(drowsiness=50.0, fatigue=40.0)
    result = _recover_minutes("unlisted_activity", state, minutes=30)
    assert result.drowsiness == pytest.approx(50.0)
    assert result.fatigue == pytest.approx(40.0)


def test_minutes_recovery_clamped_at_zero():
    state = DriverState(drowsiness=5.0, fatigue=5.0)
    result = _recover_minutes("nap_rate_only", state, minutes=100)
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


# ─── apply_rest_recovery_rate_capped — AGGREGATE cap across a whole stage ─────
#
# Review fix (Slice-2 core Task 2 findings): apply_rest_recovery_rate caps only
# the CURRENT call's amount, so calling it every MOVING tick for N ticks lets
# total recovery grow to N * per_min * tick_minutes with no ceiling across the
# stage. apply_rest_recovery_rate_capped instead takes the accrued-so-far
# totals (threaded by the caller, e.g. on RecoveryState, reset per stage) and
# shrinks this call's amount to the remaining headroom under the cap.


def test_rate_capped_aggregate_first_call_uncapped_when_room_remains():
    state = DriverState(drowsiness=80.0, fatigue=80.0)
    new_state, accrued_d, accrued_f = apply_rest_recovery_rate_capped(
        _PARAMS, state, "nap_capped", tick_minutes=1.0,
        accrued_drowsiness=0.0, accrued_fatigue=0.0,
    )
    assert new_state.drowsiness == pytest.approx(80.0 - 1.0)
    assert new_state.fatigue == pytest.approx(80.0 - 0.5)
    assert accrued_d == pytest.approx(1.0)
    assert accrued_f == pytest.approx(0.5)


def test_rate_capped_aggregate_shrinks_as_cap_approached():
    # cap_drowsiness=15.0; already accrued 14.5 -> only 0.5 headroom left,
    # even though the raw per-tick amount (1.0 * 1.0min = 1.0) is well under
    # the per-call cap of 15.0 -- this is exactly the gap apply_rest_recovery_rate
    # (per-call only) misses.
    state = DriverState(drowsiness=80.0, fatigue=80.0)
    new_state, accrued_d, accrued_f = apply_rest_recovery_rate_capped(
        _PARAMS, state, "nap_capped", tick_minutes=1.0,
        accrued_drowsiness=14.5, accrued_fatigue=0.0,
    )
    assert new_state.drowsiness == pytest.approx(80.0 - 0.5)   # only headroom, not full 1.0
    assert accrued_d == pytest.approx(15.0)                    # saturates exactly at cap


def test_rate_capped_aggregate_zero_once_cap_already_reached():
    state = DriverState(drowsiness=80.0, fatigue=80.0)
    new_state, accrued_d, accrued_f = apply_rest_recovery_rate_capped(
        _PARAMS, state, "nap_capped", tick_minutes=1.0,
        accrued_drowsiness=15.0, accrued_fatigue=8.0,   # already at both caps
    )
    assert new_state.drowsiness == 80.0     # no further recovery once cap reached
    assert new_state.fatigue == 80.0
    assert accrued_d == 15.0
    assert accrued_f == 8.0


def test_rate_capped_aggregate_over_many_ticks_saturates_at_cap_not_beyond():
    """30 ticks * 1.0/min raw would sum to 30.0 (double the cap=15.0 for
    nap_capped's drowsiness) if capped only per-call -- the aggregate-capped
    function must saturate the SUM at the cap instead."""
    state = DriverState(drowsiness=80.0, fatigue=80.0)
    accrued_d, accrued_f = 0.0, 0.0
    for _ in range(30):
        state, accrued_d, accrued_f = apply_rest_recovery_rate_capped(
            _PARAMS, state, "nap_capped", tick_minutes=1.0,
            accrued_drowsiness=accrued_d, accrued_fatigue=accrued_f,
        )
    assert accrued_d == pytest.approx(15.0)
    assert accrued_f == pytest.approx(8.0)
    assert state.drowsiness == pytest.approx(80.0 - 15.0)
    assert state.fatigue == pytest.approx(80.0 - 8.0)


def test_rate_capped_uncapped_activity_accrues_without_limit():
    state = DriverState(drowsiness=80.0, fatigue=80.0)
    accrued_d, accrued_f = 0.0, 0.0
    for _ in range(5):
        state, accrued_d, accrued_f = apply_rest_recovery_rate_capped(
            _PARAMS, state, "nap_rate_only", tick_minutes=1.0,
            accrued_drowsiness=accrued_d, accrued_fatigue=accrued_f,
        )
    assert accrued_d == pytest.approx(5.0)   # no cap on nap_rate_only -> keeps growing
    assert state.drowsiness == pytest.approx(80.0 - 5.0)


def test_rate_capped_unknown_activity_recovers_nothing_and_accrued_unchanged():
    state = DriverState(drowsiness=50.0, fatigue=40.0)
    new_state, accrued_d, accrued_f = apply_rest_recovery_rate_capped(
        _PARAMS, state, "unlisted_activity", tick_minutes=1.0,
        accrued_drowsiness=3.0, accrued_fatigue=2.0,
    )
    assert new_state.drowsiness == 50.0
    assert new_state.fatigue == 40.0
    assert accrued_d == 3.0
    assert accrued_f == 2.0


def test_rate_capped_never_goes_below_zero():
    state = DriverState(drowsiness=0.3, fatigue=0.1)
    new_state, _, _ = apply_rest_recovery_rate_capped(
        _PARAMS, state, "nap_rate_only", tick_minutes=5.0,
        accrued_drowsiness=0.0, accrued_fatigue=0.0,
    )
    assert new_state.drowsiness == 0.0
    assert new_state.fatigue == 0.0
