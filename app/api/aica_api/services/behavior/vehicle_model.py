"""Vehicle behavior model (T010) — per-tick vehicle signal computation.

Pure, deterministic, side-effect-free.  Same (profile, driver_state, context,
event_history) → same VehicleState every call.

Signal model (R1):
  steeringInstabilityLevel = max(0,
      base + drowsiness_factor * drowsiness
           + fatigue_factor * fatigue
           + mountain_road_add * is_mountain
           - traffic_jam_reduce * is_jam)

  pedalAbnormalityLevel = max(0,
      base + fatigue_factor * fatigue
           + traffic_jam_add * is_jam
           + mountain_road_add * is_mountain)

Rolling-window event counts (default 300 s):
  laneDepartureCount  — events within the last rolling_window_seconds
  adasWarningCount    — ditto

Lane departure event generated when:
  segment_type in LaneDepartureProfile.enabled_on AND
  (drowsiness >= drowsiness_threshold OR fatigue >= fatigue_threshold)

ADAS warning event generated when:
  new lane departure count (incl. current tick) >= lane_departure_warning_threshold  OR
  steering_instability_level >= steering_instability_warning_threshold
"""

from __future__ import annotations

from dataclasses import dataclass, field

from aica_api.models.profile import VehicleBehaviorProfile


# ─── Public data types ────────────────────────────────────────────────────────


@dataclass
class VehicleEvent:
    """A discrete event (lane departure or ADAS warning) at a specific tick."""

    tick_index: int
    event_type: str  # "lane_departure" | "adas_warning"


@dataclass
class VehicleState:
    """Computed vehicle signal state for a single tick."""

    steering_instability_level: float
    pedal_abnormality_level: float
    lane_departure_count: int
    adas_warning_count: int

    # Full event list (historic + new) after rolling-window pruning.
    # Pass this back in as event_history for the next tick.
    event_history: list[VehicleEvent] = field(default_factory=list)


# ─── Public API ──────────────────────────────────────────────────────────────


def advance_vehicle_state(
    profile: VehicleBehaviorProfile,
    drowsiness: float,
    fatigue: float,
    segment_type: str,
    is_traffic_jam: bool,
    tick_index: int,
    tick_seconds: int,
    event_history: list[VehicleEvent],
) -> VehicleState:
    """Compute vehicle state for the current tick.

    Args:
        profile:       Validated VehicleBehaviorProfile.
        drowsiness:    Current drowsiness level [0, 100].
        fatigue:       Current fatigue level [0, 100].
        segment_type:  Active road segment type (e.g. "highway", "mountain_road").
        is_traffic_jam: True if a traffic jam event is active.
        tick_index:    Current tick index (0-based).
        tick_seconds:  Duration of each tick in seconds.
        event_history: Prior VehicleEvent list (passed through from previous tick).

    Returns:
        VehicleState with signal levels, rolling-window counts, and updated
        event_history (pruned to rolling window, new events appended).
    """
    is_mountain = segment_type == "mountain_road"

    # ── Steering instability ──────────────────────────────────────────────────
    si = profile.steering_instability
    steering_level = max(
        0.0,
        si.base_level
        + si.drowsiness_factor * drowsiness
        + si.fatigue_factor * fatigue
        + (si.mountain_road_add if is_mountain else 0.0)
        - (si.traffic_jam_reduce if is_traffic_jam else 0.0),
    )

    # ── Pedal abnormality ─────────────────────────────────────────────────────
    pa = profile.pedal_abnormality
    pedal_level = max(
        0.0,
        pa.base_level
        + pa.fatigue_factor * fatigue
        + (pa.traffic_jam_add if is_traffic_jam else 0.0)
        + (pa.mountain_road_add if is_mountain else 0.0),
    )

    # ── Lane departure event this tick? ──────────────────────────────────────
    ld = profile.lane_departure
    new_events: list[VehicleEvent] = []

    lane_dep_triggered = (
        segment_type in ld.enabled_on
        and (drowsiness >= ld.drowsiness_threshold or fatigue >= ld.fatigue_threshold)
    )
    if lane_dep_triggered:
        for _ in range(ld.count_when_threshold_exceeded):
            new_events.append(VehicleEvent(tick_index=tick_index, event_type="lane_departure"))

    # ── Prune history to rolling window ──────────────────────────────────────
    current_time = tick_index * tick_seconds
    window = profile.rolling_window_seconds
    pruned = [
        e for e in event_history
        if current_time - e.tick_index * tick_seconds < window
    ]

    # Combine pruned history with new lane departure events (before ADAS check)
    combined = pruned + [e for e in new_events if e.event_type == "lane_departure"]

    # Count lane departures within rolling window (including this tick)
    lane_dep_count = sum(1 for e in combined if e.event_type == "lane_departure")

    # ── ADAS warning event this tick? ─────────────────────────────────────────
    aw = profile.adas_warning
    adas_triggered = (
        lane_dep_count >= aw.lane_departure_warning_threshold
        or steering_level >= aw.steering_instability_warning_threshold
    )
    if adas_triggered:
        new_events.append(VehicleEvent(tick_index=tick_index, event_type="adas_warning"))

    # Final event history (pruned + all new events)
    final_history = pruned + new_events

    # Count rolling-window totals from final history
    adas_count = sum(1 for e in final_history if e.event_type == "adas_warning")
    final_lane_dep_count = sum(1 for e in final_history if e.event_type == "lane_departure")

    return VehicleState(
        steering_instability_level=steering_level,
        pedal_abnormality_level=pedal_level,
        lane_departure_count=final_lane_dep_count,
        adas_warning_count=adas_count,
        event_history=final_history,
    )
