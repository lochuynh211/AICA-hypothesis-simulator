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
    """A traffic congestion event on the route.

    A jam is authored in KM (``start_km``/``end_km``): the tick engine gates
    congestion on POSITION, the correct axis since routes are not time-linear
    in distance once segment speeds and auto-rest stops are involved. See
    ``_active_traffic_jam`` in ``services/tick_engine.py``.

    ``start_min``/``duration_min`` are OPTIONAL TIME-native fields, retained
    for the Maps/route-preset path and the painter's fallback (a Maps jam may
    carry no km). When km is absent, the engine falls back to gating on elapsed
    time. A jam is valid with EITHER a km pair or a time pair.
    """

    id: str
    start_min: float | None = None
    duration_min: float | None = None
    affected_segment_id: str
    speed_kph: float
    start_km: float | None = None
    end_km: float | None = None

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

    # Feature 009: the run's frozen seed (Principle III — determinism). Threaded
    # into advance_tick's anomaly generator; frozen here alongside the rest of
    # the deterministic event schedule.
    run_seed: int = 42

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


class NamedRestSpot(BaseModel):
    """A rest facility with a human name and kilometre position (M8).

    Populated from Google Places results (maps path) or from the scenario's
    rest-facility segments (local path).  Carries optional lat/lng for future
    map rendering.  Extra fields are allowed for forward-compatibility.
    """

    name: str
    position_km: float
    lat: float | None = None
    lng: float | None = None
    synthetic: bool = False

    model_config = {"extra": "allow"}


class RouteFacts(BaseModel):
    """Route evidence — M1 fields kept for backward compat; M2/M4/M8 fields added.

    M1: segments (RouteSegment list), bands dict.
    M2: total_route_distance_km, estimated_route_duration_min, route_segments[],
        rest_spot_positions[], route_progress_checkpoints[].
    M4: route_source (provenance flag — "local" or "maps").
    M8: named_rest_spots[] — facility names + positions (additive, default empty
        so all existing route_facts remain valid).
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

    # M8: named rest facilities — additive field; empty default preserves all
    # existing route_facts. Populated by analyze_route() (local/offline path,
    # from is_rest_facility segments) and analyze_route_maps() (Maps path,
    # from Google Places results).
    named_rest_spots: list[NamedRestSpot] = []

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
    M2 additions: feature_groups, distance_km, continuous_driving_min.
    Feature 020 (Slice-3): monotony_accrued_min carries the simulator-owned
    monotony-proxy accumulator tick-to-tick (see tick_engine.advance_tick).
    Feature 009 (signal-tier redesign): the flat M2 `raw_state` dict is replaced by
    `signals` — the tiered {fixed, dynamic, simulated} dict (see
    specs/009-signal-tier-redesign/contracts/tiered-context.md).  `anomaly_events`
    and `above_weak_ticks` are carried-through numeric state the engine needs to
    compute the NEXT tick (anomaly rolling window; signal_duration streak).
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
    feature_groups: FeatureGroups = FeatureGroups()
    distance_km: float | None = None
    continuous_driving_min: float | None = None
    monotony_accrued_min: float | None = None

    # Feature 009: tiered signals {fixed, dynamic, simulated} — replaces raw_state.
    signals: dict[str, Any] = {}
    # Carry-throughs the engine needs tick-to-tick (not part of the adapter context).
    anomaly_events: list[int] = []
    above_weak_ticks: int = 0

    model_config = {"extra": "allow"}


# ─── RunConfig ────────────────────────────────────────────────────────────────


class RunConfig(BaseModel):
    """Setup-time run configuration (data-model.md §4).

    package_id/scenario_id select the algorithm + scenario; hyperparameter_overrides
    holds changed-from-default values only (resolved hyperparameters = manifest
    defaults ⊕ overrides, injected into the adapter context by run_manager).
    run_seed is frozen at run start into the event plan and drives anomaly_rate
    (Principle III — determinism: same RunConfig → identical trace).

    UX-BE (feature 009 UX iteration): profiles/context_overrides mirror
    CreateRunPlanBody's fields of the same name (routers/run_plans.py) and
    PreviewRunBody's (routers/runs.py) — same shape for a real run and for the
    ephemeral preview, so both are faithful to each other.
    """

    package_id: str
    scenario_id: str
    hyperparameter_overrides: dict[str, Any] = {}
    run_seed: int
    expert_override: bool = False
    profiles: dict[str, Any] | None = None
    context_overrides: dict[str, Any] | None = None


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

    # U5: raw sparse profile override dict submitted by user (None = no override)
    profile_overrides: dict | None = None


# ─── Recovery models ─────────────────────────────────────────────────────────


class RestSpot(BaseModel):
    id: str
    label: dict
    lat: float | None = None
    lng: float | None = None
    route_fraction: float
    model_config = {"extra": "allow"}


class RecoveryState(BaseModel):
    active: bool = False
    option_id: str | None = None
    rest_spot: RestSpot | None = None
    phase: str | None = None              # wakefulness|arriving|nap|content|resuming
    stage_index: int = 0
    stage_ticks_remaining: int = 0
    # Feature 020 (Slice-2 core, review fix): cumulative recovery already
    # granted during the CURRENT en-route MOVING stage (accrued across ticks
    # by the tick engine via apply_rest_recovery_rate_capped), so a
    # cap_drowsiness/cap_fatigue can bound the TOTAL recovered over the whole
    # stage, not just a single tick's amount. Reset to 0.0 whenever a stage
    # transition happens (services/recovery.py::_enter_stage). Defaults to
    # 0.0 for back-compat with persisted runs/fixtures predating this field.
    moving_recovery_accrued_drowsiness: float = 0.0
    moving_recovery_accrued_fatigue: float = 0.0
    model_config = {"extra": "allow"}


class ContentContext(BaseModel):
    """Which content is playing, and which trigger purpose it answers.

    Recovery-semantics refactor. The pair — not the content alone — selects the
    `recovery_model` entry, because the same content means different things on
    different channels: 鼻歌カラオケ offered for 漫然運転予防 is stimulus, the
    same content offered en route to a rest spot is 覚醒支援 (CDC-SU slides
    35/38/46). `purpose` is closed: monotony | pre_rest | post_rest.
    """

    service_id: str
    purpose: Literal["monotony", "pre_rest", "post_rest"]

    @property
    def recovery_key(self) -> str:
        """The `driver_signal_params.recovery_model` key for this pair."""
        return f"{self.service_id}@{self.purpose}"


class ContentReliefState(BaseModel):
    """Per-episode accrual for driving-content relief.

    Threaded across ticks by the tick engine so `cap_drowsiness` /
    `cap_fatigue` / `cap_stimulus` bound the TOTAL granted over one content
    episode rather than a single tick's amount. Reset whenever `content_key`
    changes — i.e. on every new episode. Case 1 (inattentive) has no
    `RecoveryState` to hang this on, which is why it is its own model.
    """

    content_key: str
    accrued_drowsiness: float = 0.0
    accrued_fatigue: float = 0.0
    accrued_stimulus: float = 0.0


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
    # Recovery-semantics refactor: live driving-content episode accrual.
    # None whenever no content is playing. Orthogonal to `recovery` — a driver
    # can be en route to a rest spot (recovery active) WITH content playing.
    content_relief: ContentReliefState | None = None

    # M2 extensions — all optional with safe defaults so M1 create_run still works
    run_mode: str = "standard"
    evidence_status: str = "standard"

    # Feature 009: frozen run seed — sourced from scenario.run_seed_default at
    # create_run time; threaded into advance_tick's anomaly generator so the same
    # (scenario, run_seed) always reproduces the same anomaly_rate series.
    run_seed: int = 42

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

    # M7: recovery state machine block (None until recovery begins)
    recovery: RecoveryState | None = None

    # M4: route provenance + display snapshot (optional; defaults preserve M1-M3 compat)
    route_source: Literal["maps", "local"] = "local"
    display_route: DisplayRoute | None = None


# ─── InstantResult (feature 009, US1 — ephemeral preview) ────────────────────


class FirePoint(BaseModel):
    """The first actionable "rest_required" fire observed during a preview run."""

    category: str | None = None
    strength: str | None = None
    tick: int
    time_min: float
    # The trigger chain recorded AT this fire (B1). Empty for packages that emit
    # no contributions and for previews recorded before this field existed —
    # consumers report the trigger stage unavailable rather than inferring.
    feature_contributions: dict = {}
    # Thresholds and ladders in force at this tick, so the review can show
    # "firing threshold 0.70 · clearance +0.010" without a second lookup.
    criteria: dict = {}


class ScoreSeriesPoint(BaseModel):
    """One rest_required_score sample (for the setup-screen preview curve)."""

    t: int
    score: float


class SignalSeriesPoint(BaseModel):
    """One per-tick sample of the DRIVER-STATE signals behind the score curves.

    The score series answers "what did the algorithm decide"; this answers
    "what was the driver doing" — so a reviewer watching the Combined screen
    can see drowsiness plateau under en-route content, or monotony go flat and
    bend down while a proposal is taken up, instead of inferring it from a
    score that blends several terms.

    All three are 0-100 on the same scale the engine emits them:
    ``simulated.drowsiness`` / ``simulated.fatigue`` /
    ``dynamic.monotonyLevel``. ``t`` aligns with ``score_series.t``.
    """

    t: int
    drowsiness: float
    fatigue: float
    monotony: float


class ProgressPoint(BaseModel):
    """One per-tick route-progress sample (feature 020 — trigger-point alignment).

    Pairs a tick's elapsed ``min`` (same axis as segments/fires) with its DISTANCE
    ``frac`` (route_fraction, 0-1). Lets a distance-axis consumer (the Combined
    Simulator's quickview) remap any minute/tick x-coordinate onto the distance
    axis so its fires line up with the distance-axis live animation. ``frac`` is
    flat across a stopped rest (car parked while time advances)."""

    t: int
    min: float
    frac: float


class SpikePoint(BaseModel):
    """One anomaly-spike event (for the setup-screen preview timeline marker).

    `t` is the tick index (aligns with score_series.t); `time_min` is the same
    instant in minutes (aligns with segment bands / markers plotted by minute).
    """

    t: int
    time_min: float


class PreviewSegment(BaseModel):
    """A contiguous run of one segment type over the previewed route."""

    type: str | None = None
    from_min: float
    to_min: float


class PreviewTrafficJam(BaseModel):
    """A traffic-jam range on the previewed route, in MINUTES on the same axis
    as ``PreviewSegment`` (feature 020 — the Combined Simulator draws a thin
    jam sub-bar above the road-type bar). Derived from the event plan's
    ``traffic_events`` (start_min .. start_min+duration_min).

    ``from_frac``/``to_frac`` are the route-fraction bounds derived DIRECTLY
    from a km-authored jam's ``start_km``/``end_km`` (fixbug-0806); ``None``
    for legacy time-only jams (Maps/route-preset path), which the frontend
    remaps via minutes instead. For a km jam, ``from_min``/``to_min`` are
    derived from the real progress curve (``_km_to_min``) so both axes agree.

    ``from_min``/``to_min`` are optional: a km jam previewed with an empty
    progress curve, or a legacy jam missing time fields, yields ``None``.
    """

    from_min: float | None = None
    to_min: float | None = None
    from_frac: float | None = None
    to_frac: float | None = None


class PreviewRestSpot(BaseModel):
    """The rest spot the auto-chosen recovery stopped at."""

    at_km: float
    eta_min: float | None = None


class PreviewRestOption(BaseModel):
    """The recovery option auto-accepted when the first proposal fired."""

    id: str
    auto_chosen: bool = True
    recovery_from_min: float | None = None
    to_min: float | None = None


class PreviewError(BaseModel):
    """An algorithm/context error surfaced during the preview (never a faked decision)."""

    tick_index: int
    error_type: str
    message: str


class InstantResult(BaseModel):
    """Ephemeral, non-persisting preview result (data-model.md §7).

    Returned by POST /runs/preview. Never stored — the preview is a pure
    computation over a RunConfig, never written to runs/.
    """

    fired: bool
    fire: FirePoint | None = None
    # Every actionable trigger across the run (first entry == `fire`) — lets the
    # setup strip mark multiple triggers like the Review timeline. Empty on error.
    fires: list[FirePoint] = []
    peak_score: float
    threshold: float | None = None
    score_series: list[ScoreSeriesPoint] = []
    # Per-tick driver-state signals behind the curves (drowsiness/fatigue/monotony).
    # Additive: empty for any consumer that predates it.
    signal_series: list[SignalSeriesPoint] = []
    # Per-tick route-progress map (feature 020 — trigger-point alignment): remaps
    # the Combined Simulator's quickview onto the DISTANCE axis so its fires align
    # with the distance-axis live animation. Empty is fine (consumer falls back to
    # the time axis). Additive — the trigger screen's own strip ignores it.
    progress: list[ProgressPoint] = []
    # Second (monotony-prevention) curve — populated only by algorithms that emit
    # a `monotony_prevention_score` (the transparent hybrid); empty for NRI, which
    # has a single rest-required score. `monotony_threshold` is its trigger level.
    monotony_series: list[ScoreSeriesPoint] = []
    monotony_threshold: float | None = None
    # Anomaly-spike events over the run — one marker per Poisson spike so the
    # reviewer can see the rest-propose curve step up right after a spike.
    spikes: list[SpikePoint] = []
    segments: list[PreviewSegment] = []
    # Manually-painted traffic-jam ranges (minutes, same axis as `segments`) —
    # feature 020 Combined Simulator jam sub-bar. Empty when no jam was painted.
    traffic_jams: list[PreviewTrafficJam] = []
    rest_spot: PreviewRestSpot | None = None
    rest_option: PreviewRestOption | None = None
    # Every auto-accepted rest across the run (rest_spot/rest_option == first of each).
    rest_spots: list[PreviewRestSpot] = []
    rest_options: list[PreviewRestOption] = []
    completed_min: float | None = None
    seed: int
    overrides: list[dict[str, Any]] = []
    error: PreviewError | None = None
