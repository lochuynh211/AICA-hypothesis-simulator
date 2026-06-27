"""Event plan freeze service (T015) — deterministic per-tick schedule.

Pure, side-effect-free. Same scenario → same EventPlan every call.

For each tick index i in 0..N-1 (N = total_duration // tick_seconds):
  - route_fraction = min(1.0, i * tick_seconds / total_duration)
  - drowsiness_band: step-held from event_presets.drowsiness_schedule
  - signal_duration: step-held from signal_duration_schedule (extra field) or
    fallback to signal_duration_at_trigger for all ticks
  - rest_spot_eta: 'near' before the rest_spot_eta_near_before segment's at
    position, 'none' at or after; or from rest_spot_eta_schedule if present;
    defaults to 'none' if neither is configured
  - continuous_driving_time: ordinal band from binning(elapsed_seconds)
  - active_segment_id: step-held from route_intent.segments by route_fraction
"""

from __future__ import annotations

from aica_api.models.run import EventPlan, TickPlanEntry
from aica_api.models.scenario import ScenarioDef
from aica_api.services.binning import bin_context


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _step_hold(
    schedule: list[dict],
    fraction: float,
    at_key: str = "at",
    val_key: str = "band",
    default: str = "",
) -> str:
    """Step-held schedule lookup: last entry whose at_key value ≤ fraction."""
    result = default
    for entry in schedule:
        if entry[at_key] <= fraction:
            result = entry[val_key]
    return result


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def freeze_event_plan(scenario: ScenarioDef) -> EventPlan:
    """Freeze a deterministic per-tick event plan for a run.

    This is the only place where the scenario's event_presets are resolved
    into a per-tick schedule.  The resulting EventPlan is stored in the run
    log and may not be mutated after the run starts.

    Args:
        scenario: A validated ScenarioDef.

    Returns:
        A fully-populated EventPlan with N = total_duration // tick_seconds
        TickPlanEntry instances, one per simulation tick.
    """
    total_duration = scenario.total_duration_seconds
    tick_seconds = scenario.tick_seconds
    n_ticks = total_duration // tick_seconds

    # ── Drowsiness schedule ────────────────────────────────────────────────
    drowsiness_schedule = [
        {"at": e.at, "band": e.band}
        for e in scenario.event_presets.drowsiness_schedule
    ]

    # ── Signal duration schedule (optional extra field) ────────────────────
    extra = scenario.event_presets.model_extra or {}
    signal_duration_schedule: list[dict] | None = extra.get("signal_duration_schedule")
    signal_duration_at_trigger: str = scenario.event_presets.signal_duration_at_trigger

    # ── Rest spot ETA ──────────────────────────────────────────────────────
    rest_spot_eta_near_before: str | None = scenario.event_presets.rest_spot_eta_near_before
    rest_spot_eta_schedule: list[dict] | None = scenario.event_presets.rest_spot_eta_schedule

    # Find the rest facility's at-fraction when using near_before logic
    rest_facility_at: float | None = None
    if rest_spot_eta_near_before is not None:
        for seg in scenario.route_intent.segments:
            if seg.id == rest_spot_eta_near_before:
                rest_facility_at = seg.at
                break

    # ── Segments for active_segment_id lookup ─────────────────────────────
    segments = scenario.route_intent.segments

    # ── Build ticks ───────────────────────────────────────────────────────
    ticks: list[TickPlanEntry] = []
    for i in range(n_ticks):
        elapsed_seconds = i * tick_seconds
        route_fraction = min(1.0, elapsed_seconds / total_duration)

        # Drowsiness band (step-held)
        drowsiness_band = _step_hold(drowsiness_schedule, route_fraction) or "none"

        # Signal duration
        if signal_duration_schedule:
            signal_duration = (
                _step_hold(signal_duration_schedule, route_fraction)
                or "transient"
            )
        else:
            # Fallback: use signal_duration_at_trigger for all ticks
            signal_duration = signal_duration_at_trigger

        # Rest spot ETA
        if rest_spot_eta_schedule:
            rest_spot_eta = (
                _step_hold(rest_spot_eta_schedule, route_fraction) or "none"
            )
        elif rest_facility_at is not None:
            # near before the facility, none at/after
            rest_spot_eta = "near" if route_fraction < rest_facility_at else "none"
        else:
            rest_spot_eta = "none"

        # Continuous driving time via boundary-binning
        banded = bin_context({"travel_time_sec": elapsed_seconds})
        continuous_driving_time = banded["continuous_driving_time"]

        # Active segment (step-held by at)
        active_segment_id = segments[0].id
        for seg in segments:
            if seg.at <= route_fraction:
                active_segment_id = seg.id

        entry = TickPlanEntry(
            tick_index=i,
            drowsiness_band=drowsiness_band,
            route_fraction=route_fraction,
            signal_duration=signal_duration,
            rest_spot_eta=rest_spot_eta,
            # Extra fields (model_config extra="allow"):
            elapsed_seconds=elapsed_seconds,
            continuous_driving_time=continuous_driving_time,
            active_segment_id=active_segment_id,
        )
        ticks.append(entry)

    return EventPlan(ticks=ticks)
