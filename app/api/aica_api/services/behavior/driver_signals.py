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
    rest_type: str,
) -> DriverState:
    """Apply rest recovery to the current driver state.

    Args:
        params:    DriverSignalParams (provides recovery amounts).
        current:   State before rest.
        rest_type: "short" or "long".

    Returns:
        Recovered DriverState (drowsiness/fatigue reduced).
    """
    rm = params.recovery_model
    if rest_type == "long":
        d_rec = rm.long_rest_drowsiness_recovery
        f_rec = rm.long_rest_fatigue_recovery
    else:  # "short" (default)
        d_rec = rm.short_rest_drowsiness_recovery
        f_rec = rm.short_rest_fatigue_recovery

    return DriverState(
        drowsiness=_clamp(current.drowsiness - d_rec),
        fatigue=_clamp(current.fatigue - f_rec),
    )


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------


def _clamp(value: float, lo: float = 0.0, hi: float = 100.0) -> float:
    """Clamp value to [lo, hi]."""
    return max(lo, min(hi, value))
