"""Run domain models — RunState, EventPlan, TickState, RouteFacts, Snapshot.

M2 extensions: RouteFacts (full), EventPlan (full with traffic/weather/rest events),
RunPlanDraft, TickState (raw_state/feature_groups/distance_km/continuous_driving_min),
RunState (profiles, run_mode, evidence_status, parameter snapshots).
"""

from __future__ import annotations

from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel

from aica_api.models.scenario import RouteSegment


class RunStatus(str, Enum):
    """State machine for a simulator run."""

    created = "created"
    playing = "playing"
    paused = "paused"
    completed = "completed"


# ─── Snapshot ────────────────────────────────────────────────────────────────


class ArtifactRef(BaseModel):
    """Lightweight identifier for a versioned artifact (package or scenario)."""

    id: str
    version: str
    hash: str


class Snapshot(BaseModel):
    """Frozen package + scenario references captured at run start."""

    package: ArtifactRef
    scenario: ArtifactRef


# ─── M2 EventPlan event sub-models ───────────────────────────────────────────


class TrafficEvent(BaseModel):
    """A traffic congestion event on the route."""

    id: str
    start_min: float
    duration_min: float
    affected_segment_id: str
    speed_kph: float

    model_config = {"extra": "allow"}


class WeatherEvent(BaseModel):
    """A weather condition event on the route."""

    id: str
    start_min: float
    duration_min: float

    model_config = {"extra": "allow"}


class RestOpportunity(BaseModel):
    """A rest opportunity location on the route."""

    id: str
    route_position_km: float

    model_config = {"extra": "allow"}


# ─── EventPlan ───────────────────────────────────────────────────────────────


class TickPlanEntry(BaseModel):
    """Per-tick schedule entry generated from event_presets at run start (M1)."""

    tick_index: int
    drowsiness_band: str
    route_fraction: float
    signal_duration: str
    rest_spot_eta: str

    model_config = {"extra": "allow"}


class EventPlan(BaseModel):
    """Frozen, deterministic event schedule for a run.

    M1 fields: ticks[] (per-tick plan entries).
    M2 fields: tick_seconds, traffic_events[], weather_events[], rest_opportunities[].
    Both field sets are optional (with empty defaults) so M1 and M2 run-states
    can coexist until the engine layer is migrated in a later M2 unit.
    """

    # M1 — per-tick plan (populated by freeze_event_plan)
    ticks: list[TickPlanEntry] = []

    # M2 — event-level schedule (populated by the M2 run planner)
    tick_seconds: int = 60
    traffic_events: list[TrafficEvent] = []
    weather_events: list[WeatherEvent] = []
    rest_opportunities: list[RestOpportunity] = []

    model_config = {"extra": "allow"}


# ─── RouteFacts ──────────────────────────────────────────────────────────────


class RouteSegmentFact(BaseModel):
    """A route segment as expressed in RouteFacts (M2).

    Uses the M2 segment-type vocabulary (highway / normal_road / mountain_road /
    sightseeing_road) and carries physical kilometre extents.
    """

    segment_type: Literal["highway", "normal_road", "mountain_road", "sightseeing_road"]
    start_km: float
    length_km: float

    model_config = {"extra": "allow"}


class RouteFacts(BaseModel):
    """Route evidence — M1 fields kept for backward compat; M2/M4 fields added.

    M1: segments (RouteSegment list), bands dict.
    M2: total_route_distance_km, estimated_route_duration_min, route_segments[],
        rest_spot_positions[], route_progress_checkpoints[].
    M4: route_source (provenance flag — "local" or "maps").
    """

    # M1 fields (kept for backward compat with existing engine/tests)
    segments: list[RouteSegment] = []
    bands: dict[str, list[str]] = {}

    # M2 fields
    total_route_distance_km: float | None = None
    estimated_route_duration_min: float | None = None
    route_segments: list[RouteSegmentFact] = []
    rest_spot_positions: list[float] = []
    route_progress_checkpoints: list[float] = []

    # M4: route provenance — default "local" keeps all M1/M2/M3 data valid
    route_source: Literal["maps", "local"] = "local"

    model_config = {"extra": "allow"}


# ─── DisplayRoute ─────────────────────────────────────────────────────────────


class DisplayRoute(BaseModel):
    """Minimal, render-only route snapshot for frontend replay (M4).

    Captures only what the frontend needs to draw the route.  No API key,
    no raw Maps payload — those are request-scoped and never persisted.
    """

    summary: str
    encoded_polyline: str
    start_label: str
    end_label: str


# ─── TickState ───────────────────────────────────────────────────────────────


class FeatureGroups(BaseModel):
    """Normalized and ordinal feature band groupings for a tick."""

    normalized: dict[str, float] = {}
    ordinal: dict[str, str] = {}


class TickState(BaseModel):
    """Computed state at a single simulation tick.

    M1 fields: tick_index through completed.
    M2 additions: raw_state, feature_groups, distance_km, continuous_driving_min.
    """

    tick_index: int
    elapsed_seconds: int
    route_fraction: float
    active_segment_id: str
    drowsiness_level: str
    fatigue_level: str
    signal_duration: str
    continuous_driving_time: str
    rest_spot_eta: str
    completed: bool

    # M2 extensions
    raw_state: dict[str, float | int | bool | str] = {}
    feature_groups: FeatureGroups = FeatureGroups()
    distance_km: float | None = None
    continuous_driving_min: float | None = None

    model_config = {"extra": "allow"}


# ─── RunPlanDraft ─────────────────────────────────────────────────────────────


class RunPlanDraft(BaseModel):
    """In-memory draft run plan (not persisted until frozen).

    Created from a package + scenario before a run starts; validated against
    schema constraints; frozen into a run_id on user confirmation.

    M4: route_source + display_route added (optional, safe defaults).
    """

    plan_id: str
    package_id: str
    scenario_id: str
    route_facts: RouteFacts
    effective_setup: dict[str, Any] = {}
    draft_event_plan: EventPlan = EventPlan()
    validation_errors: list[dict] = []

    # M4: route provenance + display snapshot (optional; defaults preserve M1-M3 compat)
    route_source: Literal["maps", "local"] = "local"
    display_route: DisplayRoute | None = None


# ─── RunState ────────────────────────────────────────────────────────────────


class RunState(BaseModel):
    """Mutable runtime state for an active run.

    M1 fields: run_id, status, current_tick, pending_proposal,
               package_runtime_state, snapshot, event_plan, route_facts.
    M2 additions: driver/vehicle/speed profiles, run_mode, evidence_status,
                  parameter/hyperparameter snapshots, original/modified values.
    """

    run_id: str
    status: RunStatus
    current_tick: int
    pending_proposal: str | None
    package_runtime_state: dict[str, Any] = {}
    snapshot: Snapshot
    event_plan: EventPlan
    route_facts: RouteFacts

    # M2 extensions — all optional with safe defaults so M1 create_run still works
    run_mode: str = "standard"
    evidence_status: str = "standard"

    # Profile snapshots (set when profiles are selected at plan time)
    driver_profile: Any | None = None
    vehicle_profile: Any | None = None
    speed_profile: Any | None = None

    # Parameter/hyperparameter snapshots (frozen at run start)
    initial_parameters: dict[str, Any] = {}
    current_parameters: dict[str, Any] = {}
    initial_hyperparameters: dict[str, Any] = {}
    current_hyperparameters: dict[str, Any] = {}

    # Audit trail for expert overrides
    original_values: dict[str, Any] = {}
    modified_values: dict[str, Any] = {}

    # Scenario-level allowed actions (copied from scenario at run creation)
    allowed_actions: list[str] = []

    # M3: populated by run_manager when a blocking algorithm error halts the run.
    # Shape: {tick_index: int, error_type: str, message: str}.
    # None when the run has not been halted by an algorithm error.
    # A non-None value combined with status==paused triggers the halted-run guard
    # in tick(), preventing duplicate error events on stray re-calls.
    last_error: dict | None = None

    # M4: route provenance + display snapshot (optional; defaults preserve M1-M3 compat)
    route_source: Literal["maps", "local"] = "local"
    display_route: DisplayRoute | None = None
