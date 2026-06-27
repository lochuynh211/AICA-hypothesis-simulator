"""Tick engine (T016) — advances simulation ticks over the frozen event plan.

Pure, deterministic, side-effect-free.  Same (plan, tick_index, scenario)
inputs → same TickState and context output every time.

Design constraints:
  - Derives ordinal bands from the frozen EventPlan; never passes raw numbers
    to the adapter context (qualitative discipline).
  - No timestamps, UUIDs, or randomness inside this module.
  - "Completed" TickState is returned when tick_index >= total_ticks (the
    number of plan entries); ticking past the end does not advance state.
"""

from __future__ import annotations

from aica_api.models.run import EventPlan, TickState
from aica_api.models.scenario import ScenarioDef
from aica_api.services.binning import bin_context


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def compute_tick_state(
    plan: EventPlan,
    tick_index: int,
    scenario: ScenarioDef,
) -> TickState:
    """Compute the TickState for a given tick index from the frozen plan.

    Args:
        plan:       The frozen EventPlan for the run.
        tick_index: The tick to evaluate (0-based).
        scenario:   The scenario definition (for initial_state + segment info).

    Returns:
        A TickState.  When tick_index >= len(plan.ticks) the returned state
        has completed=True, route_fraction=1.0, and the last known segment.
    """
    total_ticks = len(plan.ticks)
    fatigue_level = scenario.initial_state.get("fatigue_level", "low")
    segments = scenario.route_intent.segments
    last_segment_id = segments[-1].id if segments else "unknown"

    # ── Completed: past the last valid index ──────────────────────────────
    if tick_index >= total_ticks:
        elapsed_seconds = scenario.total_duration_seconds
        return TickState(
            tick_index=tick_index,
            elapsed_seconds=elapsed_seconds,
            route_fraction=1.0,
            active_segment_id=last_segment_id,
            drowsiness_level=_last_drowsiness(plan),
            fatigue_level=fatigue_level,
            signal_duration="transient",
            continuous_driving_time=_drive_time_band(elapsed_seconds),
            rest_spot_eta="none",
            completed=True,
        )

    # ── Normal tick ───────────────────────────────────────────────────────
    entry = plan.ticks[tick_index]

    # Access extra fields stored on TickPlanEntry (extra="allow")
    extra = entry.model_extra or {}
    elapsed_seconds = extra.get("elapsed_seconds", tick_index * scenario.tick_seconds)
    continuous_driving_time = extra.get(
        "continuous_driving_time",
        _drive_time_band(elapsed_seconds),
    )
    active_segment_id = extra.get("active_segment_id", last_segment_id)

    return TickState(
        tick_index=tick_index,
        elapsed_seconds=elapsed_seconds,
        route_fraction=entry.route_fraction,
        active_segment_id=active_segment_id,
        drowsiness_level=entry.drowsiness_band,
        fatigue_level=fatigue_level,
        signal_duration=entry.signal_duration,
        continuous_driving_time=continuous_driving_time,
        rest_spot_eta=entry.rest_spot_eta,
        completed=False,
    )


def build_adapter_context(tick_state: TickState) -> dict:
    """Build the adapter context dict from a TickState.

    Returns a dict containing only ordinal-band string values.  No raw
    numeric values are included — the context is already fully banded by
    the time it reaches this function (qualitative discipline).

    Args:
        tick_state: The computed TickState for the current tick.

    Returns:
        A dict with exactly the five feature keys required by the adapter:
        drowsiness_level, fatigue_level, signal_duration,
        continuous_driving_time, rest_spot_eta.
    """
    return {
        "drowsiness_level": tick_state.drowsiness_level,
        "fatigue_level": tick_state.fatigue_level,
        "signal_duration": tick_state.signal_duration,
        "continuous_driving_time": tick_state.continuous_driving_time,
        "rest_spot_eta": tick_state.rest_spot_eta,
    }


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------


def _drive_time_band(elapsed_seconds: int) -> str:
    """Convert elapsed seconds to a continuous_driving_time band via binning."""
    banded = bin_context({"travel_time_sec": elapsed_seconds})
    return banded["continuous_driving_time"]


def _last_drowsiness(plan: EventPlan) -> str:
    """Return the drowsiness band of the last tick in the plan."""
    if plan.ticks:
        return plan.ticks[-1].drowsiness_band
    return "none"
