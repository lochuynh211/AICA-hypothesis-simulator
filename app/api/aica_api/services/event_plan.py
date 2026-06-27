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

from typing import Any

from aica_api.models.run import EventPlan, RestOpportunity, RouteFacts, TickPlanEntry, TrafficEvent, WeatherEvent
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

    # ── Drowsiness schedule (now stored as extra data; removed from declared fields in M2) ──
    _extra = scenario.event_presets.model_extra or {}
    drowsiness_schedule = _extra.get("drowsiness_schedule", [])

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


# ---------------------------------------------------------------------------
# M2 Public API — build_event_plan (no per-tick ticks[])
# ---------------------------------------------------------------------------


def build_event_plan(
    route_facts: RouteFacts,
    scenario: ScenarioDef,
    presets: dict[str, Any] | None = None,
) -> EventPlan:
    """Build the M2 EventPlan from RouteFacts and scenario presets.

    Returns an EventPlan with M2 fields (tick_seconds, traffic_events,
    weather_events, rest_opportunities) and NO per-tick ticks[] entries.
    This is the deterministic, declarative event schedule the M2 tick engine
    uses to resolve active events at each tick.

    Caller-supplied ``presets`` are merged on top of ``scenario.presets``
    (caller wins on key conflict).  Supported preset keys:

    - ``tick_seconds`` (int)  — overrides ``scenario.tick_seconds``.
    - ``traffic_events`` (list[dict])  — replaces any traffic events from
      ``scenario.presets``; each dict must satisfy the ``TrafficEvent`` schema.
    - ``weather_events`` (list[dict])  — replaces weather events from
      ``scenario.presets``; each dict must satisfy the ``WeatherEvent`` schema.

    Args:
        route_facts: RouteFacts derived from analyze_route(scenario).
        scenario:    Validated ScenarioDef (M2, with profiles + presets).
        presets:     Optional caller overrides merged on top of scenario.presets.

    Returns:
        EventPlan with tick_seconds and event lists; ticks=[] (M2 mode).
    """
    # Merge scenario presets with caller presets (caller takes priority)
    merged_presets: dict[str, Any] = dict(scenario.presets or {})
    if presets:
        merged_presets.update(presets)

    # ── Tick seconds ──────────────────────────────────────────────────────────
    tick_seconds: int = int(merged_presets.get("tick_seconds", scenario.tick_seconds))

    # ── Traffic events ────────────────────────────────────────────────────────
    traffic_events: list[TrafficEvent] = []
    for raw in merged_presets.get("traffic_events", []):
        traffic_events.append(TrafficEvent(**raw))

    # ── Weather events ────────────────────────────────────────────────────────
    weather_events: list[WeatherEvent] = []
    for raw in merged_presets.get("weather_events", []):
        weather_events.append(WeatherEvent(**raw))

    # ── Rest opportunities from route_facts ───────────────────────────────────
    rest_opportunities: list[RestOpportunity] = []
    for i, pos_km in enumerate(route_facts.rest_spot_positions):
        rest_opportunities.append(
            RestOpportunity(
                id=f"rest_{i}",
                route_position_km=pos_km,
            )
        )

    return EventPlan(
        ticks=[],
        tick_seconds=tick_seconds,
        traffic_events=traffic_events,
        weather_events=weather_events,
        rest_opportunities=rest_opportunities,
    )
