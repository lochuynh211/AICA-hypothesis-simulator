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

    Returns:
        A DriverUpdate with previous, delta, and next states.
    """
    scale = tick_seconds / 60.0  # per-minute rates → per-tick

    dm = params.drowsiness_model
    fm = params.fatigue_model

    # ── Drowsiness deltas ─────────────────────────────────────────────────
    d_base = dm.base_growth_per_min * scale
    d_night = dm.night_add_per_min * scale if is_night else 0.0
    d_monotony = dm.monotony_add_per_min * scale if is_monotonous else 0.0
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


def apply_rest_recovery(
    params: DriverSignalParams,
    current: DriverState,
    activity: str,
) -> DriverState:
    """Apply a rest activity's fixed recovery to the current driver state.

    Feature 009 (UX iteration): recovery is now keyed by the activity performed
    (a recovery-option stage's ``content`` — e.g. "sleep", "audio_karaoke",
    "stretch"), not by a short/long rest type. The amount is a FIXED number
    applied ONCE per activity (the caller invokes this once, on activity entry),
    independent of the stage's duration. An unknown activity recovers nothing.

    Args:
        params:   DriverSignalParams (provides the per-activity recovery map).
        current:  State before the activity.
        activity: The stage ``content`` naming the rest activity.

    Returns:
        Recovered DriverState (drowsiness/fatigue reduced).
    """
    rec = params.recovery_model.get(activity)
    if rec is None:
        return DriverState(drowsiness=current.drowsiness, fatigue=current.fatigue)

    return DriverState(
        drowsiness=_clamp(current.drowsiness - rec.drowsiness),
        fatigue=_clamp(current.fatigue - rec.fatigue),
    )


def apply_rest_recovery_minutes(
    params: DriverSignalParams,
    current: DriverState,
    activity: str,
    minutes: float,
) -> DriverState:
    """Duration-scaled recovery for a STOPPED activity of ``minutes`` length.

    Feature 020 (Slice-2, merged simulator). Recovery per component is::

        flat_amount + min(cap, per_min * minutes)

    where ``cap`` is the activity's ``cap_drowsiness``/``cap_fatigue`` (no cap
    when ``None``). The cap applies ONLY to the accrued (rate-derived)
    portion — the legacy flat amount is never capped.

    Back-compat: an entry with only the legacy flat fields set (``per_min``
    fields left at their 0.0 default) recovers exactly the flat amount
    regardless of ``minutes`` — identical to ``apply_rest_recovery``.

    Args:
        params:   DriverSignalParams (provides the per-activity recovery map).
        current:  State before the activity.
        activity: The stage ``content`` naming the rest activity.
        minutes:  Length of the stopped activity, in minutes.

    Returns:
        Recovered DriverState (drowsiness/fatigue reduced, clamped >= 0).
    """
    rec = params.recovery_model.get(activity)
    if rec is None:
        return DriverState(drowsiness=current.drowsiness, fatigue=current.fatigue)

    drowsiness_rate = rec.drowsiness_per_min * minutes
    if rec.cap_drowsiness is not None:
        drowsiness_rate = min(drowsiness_rate, rec.cap_drowsiness)

    fatigue_rate = rec.fatigue_per_min * minutes
    if rec.cap_fatigue is not None:
        fatigue_rate = min(fatigue_rate, rec.cap_fatigue)

    return DriverState(
        drowsiness=_clamp(current.drowsiness - (rec.drowsiness + drowsiness_rate)),
        fatigue=_clamp(current.fatigue - (rec.fatigue + fatigue_rate)),
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


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------


def _clamp(value: float, lo: float = 0.0, hi: float = 100.0) -> float:
    """Clamp value to [lo, hi]."""
    return max(lo, min(hi, value))
