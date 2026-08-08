"""Driver signal generator (feature 009, renamed from driver_model.py) —
additive per-tick drowsiness/fatigue progression.

Pure, deterministic, side-effect-free.  Same (params, state, context) →
same DriverUpdate every call.

Rate model (R1):
  drowsiness += (base_growth + night_add * is_night
                 + monotony_add * is_monotonous
                 + jam_add * is_traffic_jam) * tick_seconds / 60
  fatigue    += (base_growth + continuous_add * (continuous_min >= 60)
                 + mountain_add * is_mountain_road
                 + jam_add * is_traffic_jam) * tick_seconds / 60

The attention signal is retired (feature 009 signal-tier redesign) — this
module now advances ONLY drowsiness and fatigue.  All levels clamped
[0, 100].  Component deltas recorded in DriverDelta.
"""

from __future__ import annotations

from dataclasses import dataclass

from aica_api.models.profile import DriverSignalParams


@dataclass
class DriverState:
    """Instantaneous numeric driver state (all in [0, 100] range)."""

    drowsiness: float
    fatigue: float


@dataclass
class DriverDelta:
    """Component-level deltas for this tick (for the evidence trace)."""

    drowsiness_base: float
    drowsiness_night: float
    drowsiness_monotony: float
    drowsiness_jam: float

    fatigue_base: float
    fatigue_continuous: float
    fatigue_mountain: float
    fatigue_jam: float


@dataclass
class DriverUpdate:
    """Result of one tick: previous state, deltas, next state."""

    previous: DriverState
    delta: DriverDelta
    next: DriverState


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def advance_driver_state(
    params: DriverSignalParams,
    current: DriverState,
    tick_seconds: int,
    *,
    is_night: bool,
    is_monotonous: bool,
    is_traffic_jam: bool,
    is_mountain_road: bool,
    continuous_driving_min: float,
    suppress_monotony_growth: bool = False,
) -> DriverUpdate:
    """Advance driver state by one tick.

    Args:
        params:                  Validated DriverSignalParams.
        current:                 State at the START of this tick.
        tick_seconds:             Duration of this tick in seconds.
        is_night:                 True if driving at night.
        is_monotonous:            True if segment is monotonous (highway / normal_road).
        is_traffic_jam:           True if a traffic jam is active.
        is_mountain_road:         True if segment is mountain_road.
        continuous_driving_min:   Elapsed continuous driving minutes (for >60-min term).
        suppress_monotony_growth: When True, the monotony-sourced drowsiness
            growth term is zeroed for this tick. Set by the tick engine while
            driving content is playing: the driver is receiving stimulus, so
            boredom is not driving drowsiness upward (CDC-SU slide 31,
            刺激がない状態の継続). Every other growth component is unaffected.

    Returns:
        A DriverUpdate with previous, delta, and next states.
    """
    scale = tick_seconds / 60.0  # per-minute rates → per-tick

    dm = params.drowsiness_model
    fm = params.fatigue_model

    # ── Drowsiness deltas ─────────────────────────────────────────────────
    d_base = dm.base_growth_per_min * scale
    d_night = dm.night_add_per_min * scale if is_night else 0.0
    d_monotony = (
        0.0
        if suppress_monotony_growth
        else (dm.monotony_add_per_min * scale if is_monotonous else 0.0)
    )
    d_jam = dm.traffic_jam_add_per_min * scale if is_traffic_jam else 0.0

    new_drowsiness = _clamp(current.drowsiness + d_base + d_night + d_monotony + d_jam)

    # ── Fatigue deltas ────────────────────────────────────────────────────
    f_base = fm.base_growth_per_min * scale
    f_continuous = (
        fm.continuous_driving_add_per_min_after_60_min * scale
        if continuous_driving_min >= 60.0
        else 0.0
    )
    f_mountain = fm.mountain_road_add_per_min * scale if is_mountain_road else 0.0
    f_jam = fm.traffic_jam_add_per_min * scale if is_traffic_jam else 0.0

    new_fatigue = _clamp(current.fatigue + f_base + f_continuous + f_mountain + f_jam)

    delta = DriverDelta(
        drowsiness_base=d_base,
        drowsiness_night=d_night,
        drowsiness_monotony=d_monotony,
        drowsiness_jam=d_jam,
        fatigue_base=f_base,
        fatigue_continuous=f_continuous,
        fatigue_mountain=f_mountain,
        fatigue_jam=f_jam,
    )

    return DriverUpdate(
        previous=current,
        delta=delta,
        next=DriverState(
            drowsiness=new_drowsiness,
            fatigue=new_fatigue,
        ),
    )


def apply_rest_recovery_rate(
    params: DriverSignalParams,
    current: DriverState,
    activity: str,
    tick_minutes: float,
) -> DriverState:
    """Per-tick recovery accrual for a MOVING/en-route activity.

    Feature 020 (Slice-2, merged simulator). Subtracts
    ``per_min * tick_minutes`` per component on EACH call (the caller invokes
    this once per tick while the activity is ongoing), optionally capped by
    ``cap_drowsiness``/``cap_fatigue`` on that single call's amount. Unlike
    ``apply_rest_recovery_minutes`` this ignores the legacy flat
    ``drowsiness``/``fatigue`` fields — those are for one-shot STOPPED
    activities, not per-tick accrual. Result is always clamped >= 0 (never
    goes negative-current, i.e. never over-recovers below the floor).

    Args:
        params:       DriverSignalParams (provides the per-activity recovery map).
        current:      State before this tick's accrual.
        activity:     The stage ``content`` naming the rest activity.
        tick_minutes: Length of this tick, in minutes.

    Returns:
        Recovered DriverState (drowsiness/fatigue reduced, clamped >= 0).
    """
    rec = params.recovery_model.get(activity)
    if rec is None:
        return DriverState(drowsiness=current.drowsiness, fatigue=current.fatigue)

    drowsiness_amount = rec.drowsiness_per_min * tick_minutes
    if rec.cap_drowsiness is not None:
        drowsiness_amount = min(drowsiness_amount, rec.cap_drowsiness)

    fatigue_amount = rec.fatigue_per_min * tick_minutes
    if rec.cap_fatigue is not None:
        fatigue_amount = min(fatigue_amount, rec.cap_fatigue)

    return DriverState(
        drowsiness=_clamp(current.drowsiness - drowsiness_amount),
        fatigue=_clamp(current.fatigue - fatigue_amount),
    )


def apply_rest_recovery_rate_capped(
    params: DriverSignalParams,
    current: DriverState,
    activity: str,
    tick_minutes: float,
    accrued_drowsiness: float,
    accrued_fatigue: float,
) -> tuple[DriverState, float, float]:
    """Per-tick recovery accrual for a MOVING/en-route activity, with the
    activity's cap enforced as an AGGREGATE ceiling across the whole en-route
    stage instead of per call.

    Feature 020 (Slice-2 core, review fix). ``apply_rest_recovery_rate`` caps
    each call independently, so invoking it every tick for N ticks can let
    total recovery grow to ``N * per_min * tick_minutes`` with no ceiling
    across the stage even when ``cap_drowsiness``/``cap_fatigue`` are set.
    This function instead takes how much has already been recovered THIS
    stage (``accrued_drowsiness`` / ``accrued_fatigue`` — threaded by the
    caller across ticks, e.g. on ``RecoveryState``, reset to 0.0 whenever a
    new stage is entered) and only grants the remaining headroom under the
    cap this tick.

    Args:
        params:             DriverSignalParams (per-activity recovery map).
        current:            State before this tick's accrual.
        activity:           The stage ``content`` naming the rest activity.
        tick_minutes:       Length of this tick, in minutes.
        accrued_drowsiness: Cumulative drowsiness recovery already granted
                            this stage (before this tick).
        accrued_fatigue:    Cumulative fatigue recovery already granted this
                            stage (before this tick).

    Returns:
        ``(new_state, new_accrued_drowsiness, new_accrued_fatigue)`` — the
        accrued totals returned INCLUDE this tick's applied amount, for the
        caller to thread into the next tick. An activity with no cap set for
        a component keeps accruing without limit for that component (matches
        ``apply_rest_recovery_rate``'s uncapped behavior). Result state is
        always clamped >= 0 (never over-recovers below the floor). An
        unknown activity recovers nothing and returns the accrued totals
        unchanged.
    """
    rec = params.recovery_model.get(activity)
    if rec is None:
        return current, accrued_drowsiness, accrued_fatigue

    drowsiness_amount = rec.drowsiness_per_min * tick_minutes
    if rec.cap_drowsiness is not None:
        remaining_drowsiness = max(0.0, rec.cap_drowsiness - accrued_drowsiness)
        drowsiness_amount = min(drowsiness_amount, remaining_drowsiness)

    fatigue_amount = rec.fatigue_per_min * tick_minutes
    if rec.cap_fatigue is not None:
        remaining_fatigue = max(0.0, rec.cap_fatigue - accrued_fatigue)
        fatigue_amount = min(fatigue_amount, remaining_fatigue)

    new_state = DriverState(
        drowsiness=_clamp(current.drowsiness - drowsiness_amount),
        fatigue=_clamp(current.fatigue - fatigue_amount),
    )
    return (
        new_state,
        accrued_drowsiness + drowsiness_amount,
        accrued_fatigue + fatigue_amount,
    )


def stage_recovery_total(
    params: DriverSignalParams,
    activity: str,
    minutes: float,
) -> tuple[float, float]:
    """Total (drowsiness, fatigue) recovery a STOPPED stage of ``minutes`` grants.

    Exactly the amount the retired ``apply_rest_recovery_minutes`` computed —
    ``flat + min(cap, per_min * minutes)`` per component, with the cap applying
    only to the rate-derived portion. Kept as its own function so the per-tick
    distribution in ``apply_stage_recovery_tick`` is provably
    calibration-preserving: same total, different shape.

    An unknown activity totals (0.0, 0.0).
    """
    rec = params.recovery_model.get(activity)
    if rec is None:
        return 0.0, 0.0

    drowsiness_rate = rec.drowsiness_per_min * minutes
    if rec.cap_drowsiness is not None:
        drowsiness_rate = min(drowsiness_rate, rec.cap_drowsiness)

    fatigue_rate = rec.fatigue_per_min * minutes
    if rec.cap_fatigue is not None:
        fatigue_rate = min(fatigue_rate, rec.cap_fatigue)

    return rec.drowsiness + drowsiness_rate, rec.fatigue + fatigue_rate


def apply_stage_recovery_tick(
    params: DriverSignalParams,
    current: DriverState,
    activity: str,
    stage_ticks: int,
    tick_seconds: float,
    accrued_drowsiness: float,
    accrued_fatigue: float,
) -> tuple[DriverState, float, float]:
    """Apply ONE tick's share of a STOPPED stage's recovery.

    The stage's whole-dwell total (``stage_recovery_total`` over
    ``stage_ticks * tick_seconds / 60`` minutes) is divided evenly across
    ``stage_ticks`` and granted one share per call, bounded by the remaining
    headroom under that total. So the driver recovers as a CURVE across the
    dwell instead of in one step on the entry tick, while the total is
    identical to the previous one-shot model.

    Args:
        stage_ticks:         The stage's full dwell length in ticks (>= 1).
        accrued_drowsiness:  Total drowsiness recovery already granted THIS stage.
        accrued_fatigue:     Total fatigue recovery already granted THIS stage.

    Returns:
        ``(new_state, new_accrued_drowsiness, new_accrued_fatigue)`` — the
        accrued totals INCLUDE this tick's share, for the caller to thread
        forward. Result state is clamped >= 0. An unknown activity or
        ``stage_ticks <= 0`` recovers nothing.
    """
    if stage_ticks <= 0:
        return current, accrued_drowsiness, accrued_fatigue

    minutes = stage_ticks * tick_seconds / 60.0
    total_drowsiness, total_fatigue = stage_recovery_total(params, activity, minutes)

    drowsiness_share = min(
        total_drowsiness / stage_ticks, max(0.0, total_drowsiness - accrued_drowsiness)
    )
    fatigue_share = min(
        total_fatigue / stage_ticks, max(0.0, total_fatigue - accrued_fatigue)
    )

    new_state = DriverState(
        drowsiness=_clamp(current.drowsiness - drowsiness_share),
        fatigue=_clamp(current.fatigue - fatigue_share),
    )
    return new_state, accrued_drowsiness + drowsiness_share, accrued_fatigue + fatigue_share


def apply_stimulus_relief(
    params: DriverSignalParams,
    activity: str,
    tick_minutes: float,
    accrued_stimulus: float,
) -> tuple[float, float]:
    """Accumulator-minutes of monotonous exposure drained by one tick of content.

    Driving content is stimulus, so it interrupts 刺激がない状態の継続 (CDC-SU
    slide 31). The FREEZE is the caller's job — this function supplies only the
    additional DRAIN: ``stimulus_relief_per_min * tick_minutes``, bounded by the
    remaining headroom under ``cap_stimulus`` across the episode.

    Args:
        activity:         The ``<service_id>@<purpose>`` recovery-model key.
        accrued_stimulus: Accumulator-minutes already drained THIS episode.

    Returns:
        ``(drained_minutes, new_accrued_stimulus)``. An unknown key or an entry
        with no stimulus rate drains 0.0. With ``cap_stimulus is None`` the
        drain is unbounded across the episode.
    """
    rec = params.recovery_model.get(activity)
    if rec is None:
        return 0.0, accrued_stimulus

    drained = rec.stimulus_relief_per_min * tick_minutes
    if rec.cap_stimulus is not None:
        drained = min(drained, max(0.0, rec.cap_stimulus - accrued_stimulus))

    return drained, accrued_stimulus + drained


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------


def _clamp(value: float, lo: float = 0.0, hi: float = 100.0) -> float:
    """Clamp value to [lo, hi]."""
    return max(lo, min(hi, value))
