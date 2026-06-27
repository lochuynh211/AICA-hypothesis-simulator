"""Tick engine (T013 migration) — M1 and M2 tick advancement.

Pure, deterministic, side-effect-free.  Same inputs → same outputs every call.

M1 API (stateless, reads from frozen per-tick plan):
  compute_tick_state(plan, tick_index, scenario) -> TickState
  build_adapter_context(tick_state) -> dict

M2 API (stateful, profile-driven, no pre-computed per-tick plan):
  advance_tick(prior_state, tick_index, event_plan, route_facts, scenario) -> TickState

M2 design:
  - Position: effective_speed_kph = traffic_jam_kph if jam else
    speed_profile[segment_type]; distance_km += effective_speed * tick_seconds / 3600.
  - Driver: drowsiness/fatigue/attention advance from profile rate components; clamped.
  - Vehicle: steeringInstabilityLevel/pedalAbnormalityLevel/laneDeparture/adasWarning.
  - raw_state carries simulator-internal numerics (allowed — constitution IV bans only
    external-service raw numerics, none exist until M4).
  - feature_groups derived from raw_state via binning.build_feature_groups.
  - completed = True when distance_km >= total_route_distance_km.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from aica_api.models.run import EventPlan, FeatureGroups, RouteFacts, TickState
from aica_api.models.scenario import ScenarioDef
from aica_api.services.binning import bin_context, build_feature_groups

if TYPE_CHECKING:
    pass

# ---------------------------------------------------------------------------
# M1 Public API
# ---------------------------------------------------------------------------


def compute_tick_state(
    plan: EventPlan,
    tick_index: int,
    scenario: ScenarioDef,
) -> TickState:
    """Compute the TickState for a given tick index from the frozen M1 plan.

    Args:
        plan:       The frozen EventPlan (must have per-tick ticks[]).
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

    For M1 TickStates (no raw_state/feature_groups): returns dict with only
    ordinal-band string values (qualitative discipline preserved).

    For M2 TickStates (has raw_state/feature_groups): returns dict with both
    'raw_state' and 'feature_groups' (plus the flat ordinal keys at the top
    level for backward compat with declarative_rule's M1 code path).

    Args:
        tick_state: The computed TickState for the current tick.

    Returns:
        A context dict.  For M1: only flat ordinal bands.
        For M2: {raw_state, feature_groups, + flat ordinal bands at top level}.
    """
    # If the tick_state has feature_groups populated (M2 path), return full context
    if tick_state.raw_state and tick_state.feature_groups.ordinal:
        ordinal = tick_state.feature_groups.ordinal
        return {
            "raw_state": tick_state.raw_state,
            "feature_groups": {
                "normalized": tick_state.feature_groups.normalized,
                "ordinal": ordinal,
            },
            # Flat ordinal keys at top level for algorithms that access context directly
            **ordinal,
        }

    # M1: flat ordinal bands only
    return {
        "drowsiness_level": tick_state.drowsiness_level,
        "fatigue_level": tick_state.fatigue_level,
        "signal_duration": tick_state.signal_duration,
        "continuous_driving_time": tick_state.continuous_driving_time,
        "rest_spot_eta": tick_state.rest_spot_eta,
    }


# ---------------------------------------------------------------------------
# M2 Public API
# ---------------------------------------------------------------------------


def advance_tick(
    prior_state: TickState | None,
    tick_index: int,
    event_plan: EventPlan,
    route_facts: RouteFacts,
    scenario: ScenarioDef,
) -> TickState:
    """Advance the simulation by one tick using the M2 profile-driven model.

    Args:
        prior_state: TickState from the previous tick (None for tick 0).
        tick_index:  Current tick index (0-based).
        event_plan:  Frozen M2 EventPlan (tick_seconds + event lists).
        route_facts: RouteFacts from analyze_route(scenario).
        scenario:    Validated ScenarioDef with M2 profiles.

    Returns:
        TickState with raw_state, feature_groups, distance_km,
        continuous_driving_min, and M1 backward-compat ordinal fields.
        completed=True when distance_km >= total_route_distance_km.
    """
    tick_seconds = event_plan.tick_seconds
    total_km = route_facts.total_route_distance_km or 120.0
    sp = scenario.speed_profile

    # ── Get prior numeric values ──────────────────────────────────────────
    if prior_state is None or not prior_state.raw_state:
        # Tick 0: initialize from scenario.initial_state
        drowsiness = _initial_drowsiness(scenario.initial_state.get("drowsiness_level", "none"))
        fatigue = _initial_fatigue(scenario.initial_state.get("fatigue_level", "low"))
        attention = 100.0
        distance_km = 0.0
        continuous_driving_min = 0.0
        above_weak = 0
        vehicle_event_history: list = []
    else:
        raw = prior_state.raw_state
        drowsiness = float(raw["drowsinessLevel"])
        fatigue = float(raw["fatigueLevel"])
        attention = float(raw["attentionLevel"])
        distance_km = prior_state.distance_km or 0.0
        continuous_driving_min = prior_state.continuous_driving_min or 0.0
        above_weak = int(raw.get("drowsinessAboveWeakTicks", 0))
        vehicle_event_history = (prior_state.model_extra or {}).get(
            "_vehicle_event_history", []
        )

    # ── Determine active segment type at current distance ─────────────────
    segment_type = _segment_type_at(distance_km, route_facts)

    # ── Check active events at this tick ──────────────────────────────────
    elapsed_min = tick_index * tick_seconds / 60.0
    is_traffic_jam = _active_traffic_jam(elapsed_min, event_plan)
    is_night = scenario.is_night
    is_monotonous = segment_type in ("highway", "normal_road")
    is_mountain_road = segment_type == "mountain_road"

    # ── Advance position ──────────────────────────────────────────────────
    if is_traffic_jam:
        effective_speed = float(sp.traffic_jam_kph) if sp else 20.0
    else:
        speed_map = {
            "normal_road": float(sp.normal_road_kph) if sp else 60.0,
            "highway": float(sp.highway_kph) if sp else 100.0,
            "mountain_road": float(sp.mountain_road_kph) if sp else 40.0,
            "sightseeing_road": float(sp.sightseeing_road_kph) if sp else 30.0,
        }
        effective_speed = speed_map.get(segment_type, 60.0)

    new_distance_km = distance_km + effective_speed * tick_seconds / 3600.0
    route_fraction = min(1.0, new_distance_km / total_km)
    completed = new_distance_km >= total_km
    new_continuous_min = continuous_driving_min + tick_seconds / 60.0

    # ── Advance driver state ──────────────────────────────────────────────
    if scenario.driver_profile is not None:
        from aica_api.services.behavior.driver_model import DriverState, advance_driver_state
        driver_state = DriverState(
            drowsiness=drowsiness, fatigue=fatigue, attention=attention
        )
        driver_update = advance_driver_state(
            scenario.driver_profile, driver_state, tick_seconds,
            is_night=is_night,
            is_monotonous=is_monotonous,
            is_traffic_jam=is_traffic_jam,
            is_mountain_road=is_mountain_road,
            continuous_driving_min=continuous_driving_min,
        )
        new_drowsiness = driver_update.next.drowsiness
        new_fatigue = driver_update.next.fatigue
        new_attention = driver_update.next.attention
    else:
        new_drowsiness = drowsiness
        new_fatigue = fatigue
        new_attention = attention

    # ── Update drowsinessAboveWeakTicks counter ───────────────────────────
    if new_drowsiness >= 20.0:
        new_above_weak = above_weak + 1
    else:
        new_above_weak = 0

    # ── Advance vehicle state ─────────────────────────────────────────────
    if scenario.vehicle_profile is not None:
        from aica_api.services.behavior.vehicle_model import advance_vehicle_state
        vehicle_state = advance_vehicle_state(
            scenario.vehicle_profile,
            drowsiness=new_drowsiness,
            fatigue=new_fatigue,
            segment_type=segment_type,
            is_traffic_jam=is_traffic_jam,
            tick_index=tick_index,
            tick_seconds=tick_seconds,
            event_history=vehicle_event_history,
        )
        steering = vehicle_state.steering_instability_level
        pedal = vehicle_state.pedal_abnormality_level
        lane_dep = vehicle_state.lane_departure_count
        adas_warn = vehicle_state.adas_warning_count
        new_vehicle_history = vehicle_state.event_history
    else:
        steering = 0.0
        pedal = 0.0
        lane_dep = 0
        adas_warn = 0
        new_vehicle_history = []

    # ── Compute nextRestSpotKm ────────────────────────────────────────────
    next_rest_km = -1.0
    for pos_km in sorted(route_facts.rest_spot_positions):
        if pos_km > new_distance_km:
            next_rest_km = pos_km - new_distance_km
            break

    # ── Build raw_state ───────────────────────────────────────────────────
    raw_state: dict = {
        "drowsinessLevel": new_drowsiness,
        "fatigueLevel": new_fatigue,
        "attentionLevel": new_attention,
        "speedKph": effective_speed,
        "steeringInstabilityLevel": steering,
        "pedalAbnormalityLevel": pedal,
        "laneDepartureCount": lane_dep,
        "adasWarningCount": adas_warn,
        "nextRestSpotKm": next_rest_km,
        "routeFraction": route_fraction,
        "continuousDrivingMin": new_continuous_min,
        "isNight": is_night,
        "weatherRiskLevel": 0.0,
        "segmentType": segment_type,
        "drowsinessAboveWeakTicks": new_above_weak,
    }

    # ── Build feature_groups ──────────────────────────────────────────────
    fg_dict = build_feature_groups(raw_state)
    feature_groups = FeatureGroups(
        normalized=fg_dict["normalized"],
        ordinal=fg_dict["ordinal"],
    )
    ordinal = fg_dict["ordinal"]

    # ── Active segment ID (for M1 compat field) ───────────────────────────
    active_segment_id = _active_segment_id(route_fraction, scenario)

    return TickState(
        tick_index=tick_index,
        elapsed_seconds=(tick_index + 1) * tick_seconds,
        route_fraction=route_fraction,
        active_segment_id=active_segment_id,
        drowsiness_level=ordinal["drowsiness_level"],
        fatigue_level=ordinal["fatigue_level"],
        signal_duration=ordinal["signal_duration"],
        continuous_driving_time=ordinal["continuous_driving_time"],
        rest_spot_eta=ordinal["rest_spot_eta"],
        completed=completed,
        raw_state=raw_state,
        feature_groups=feature_groups,
        distance_km=new_distance_km,
        continuous_driving_min=new_continuous_min,
        # Pass vehicle event history through extra fields
        _vehicle_event_history=new_vehicle_history,
    )


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


def _initial_drowsiness(band: str) -> float:
    """Convert a drowsiness band label to an initial numeric value."""
    return {
        "none": 0.0,
        "weak": 20.0,
        "moderate": 40.0,
        "strong": 60.0,
        "severe": 80.0,
    }.get(band, 0.0)


def _initial_fatigue(band: str) -> float:
    """Convert a fatigue band label to an initial numeric value."""
    return {
        "low": 0.0,
        "medium": 30.0,
        "high": 60.0,
    }.get(band, 0.0)


# M2 segment type from km position along route_facts
_ROUTE_SEGMENT_TYPES = {"highway", "mountain_road", "sightseeing_road", "normal_road"}


def _segment_type_at(distance_km: float, route_facts: RouteFacts) -> str:
    """Return the segment type at the given distance along the route."""
    current_type = "normal_road"
    for seg in route_facts.route_segments:
        if seg.start_km <= distance_km:
            current_type = seg.segment_type
    return current_type


def _active_traffic_jam(elapsed_min: float, event_plan: EventPlan) -> bool:
    """Check if a traffic jam event is active at elapsed_min."""
    for event in event_plan.traffic_events:
        if event.start_min <= elapsed_min < event.start_min + event.duration_min:
            return True
    return False


def _active_segment_id(route_fraction: float, scenario: ScenarioDef) -> str:
    """Return the active segment ID for the given route_fraction."""
    segments = scenario.route_intent.segments
    active = segments[0].id if segments else "unknown"
    for seg in segments:
        if seg.at <= route_fraction:
            active = seg.id
    return active
