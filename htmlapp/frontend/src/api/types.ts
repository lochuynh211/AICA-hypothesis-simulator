// Shared API types mirroring backend Pydantic models (M1)
// See specs/002-m1-first-vertical-slice/data-model.md and contracts/

// ── Package domain ─────────────────────────────────────────────────────────

export type PackageSummary = {
  id: string
  version: string
  label: { ja: string; en: string }
  algorithm_type: string
  compatible_scenario_types: string[]
}

export type RegistryError = {
  source: string
  message: string
}

export type ParameterDef = {
  key: string
  label: { ja: string; en: string }
  kind: 'band' | 'bool'
  band_values?: string[]
  default: string | boolean
}

export type HyperparameterDef = {
  key: string
  label: { ja: string; en: string }
  kind: 'band' | 'bool' | 'numeric'
  band_values?: string[]
  default: string | boolean | number
  min?: number
  max?: number
  step?: number
}

export type FeatureDef = {
  key: string
  band_values: string[]
}

export type TriggerCategoryDef = {
  id: string
  priority: number
}

export type ProposalDef = {
  id: string
  message: { ja: string; en: string }
  options: string[]
}

export type FireControlRule = {
  threshold_source: string
  actionability_guard: Record<string, unknown>
}

export type PackageManifest = {
  id: string
  version: string
  label: { ja: string; en: string }
  compatible_scenario_types: string[]
  algorithm: { type: string; entrypoint: string; tick_seconds?: number | null; error_mode?: string }
  parameters: ParameterDef[]
  features: FeatureDef[]
  hyperparameters: HyperparameterDef[]
  trigger_categories: TriggerCategoryDef[]
  rules: Record<string, unknown>[]
  fire_control: FireControlRule
  proposals: ProposalDef[]
  feedback_schema: Record<string, unknown>[]
  evidence_metrics: string[]
}

// ── Scenario domain ────────────────────────────────────────────────────────

export type ScenarioSummary = {
  id: string
  version: string
  type: string
  persona_label: string
  review_focus: string
}

export type RouteSegment = {
  id: string
  name: { ja: string; en: string }
  type: 'start' | 'urban' | 'highway' | 'national' | 'residential' | 'rest' | 'end'
  at: number
  speed_band: string
  length_band: string
  is_rest_facility: boolean
}

export type RouteIntent = {
  rest_facility: { label: string }
  segments: RouteSegment[]
}

export type EventPreset = {
  drowsiness_schedule: { at: number; band: string }[]
  signal_duration_at_trigger: string
  rest_spot_eta_schedule?: unknown
  rest_spot_eta_near_before?: string
}

// ── Feature 009: tiered-signal generator params ───────────────────────────
// Mirrors app/api/aica_api/models/profile.py. driver_profile/vehicle_profile
// (M1-M8) are retired; driver_signal_params/anomaly_signal_params replace them.
// The vehicle behaviour model (steering/pedal/lane/ADAS) is removed entirely.

export type DrowsinessModel = {
  base_growth_per_min: number
  night_add_per_min: number
  monotony_add_per_min: number
  traffic_jam_add_per_min: number
}

export type FatigueModel = {
  base_growth_per_min: number
  continuous_driving_add_per_min_after_60_min: number
  mountain_road_add_per_min: number
  traffic_jam_add_per_min: number
}

/** Fixed recovery for one rest activity, applied once when performed. */
export type ActivityRecovery = {
  drowsiness: number
  fatigue: number
}

/** Per-activity recovery, keyed by a recovery-option stage's `content`
 * (e.g. "sleep", "audio_karaoke", "stretch"). Replaces the old short/long
 * RecoveryModel — see app/api/aica_api/models/profile.py. */
export type RecoveryModel = Record<string, ActivityRecovery>

/** Driver signal generator parameters (drowsiness, fatigue, recovery). Renamed
 * from DriverModelProfile; the attention sub-model is retired. */
export type DriverSignalParams = {
  id: string
  drowsiness_model: DrowsinessModel
  fatigue_model: FatigueModel
  recovery_model: RecoveryModel
}

/** Parameters for the seeded-Poisson anomaly-event generator (Tier 3b). */
export type AnomalySignalParams = {
  lambda_base: number
  lambda_gain: number
  theta: number
  window_min: number
}

export type ScenarioDef = {
  id: string
  version: string
  type: string
  persona: Record<string, unknown>
  route_intent: RouteIntent
  initial_state: Record<string, string>
  event_presets: EventPreset
  /** Feature 009: tiered-signal generator params — optional (older/M1 fixtures omit them). */
  driver_signal_params?: DriverSignalParams | null
  anomaly_signal_params?: AnomalySignalParams | null
  /** Feature 009: the seed suggested at setup time, frozen per run. Optional
   * for back-compat with fixtures/older responses; the backend always
   * serializes it (defaults to 42) so treat an absent value as 42. */
  run_seed_default?: number
  /** M6 T009: speed profile — optional for back-compat with older scenarios. */
  speed_profile?: Record<string, unknown>
  total_duration_seconds: number
  tick_seconds: number
  allowed_actions: string[]
  review_focus: string
  /** M7 UC-01: recovery options defined per scenario. Absent in pre-M7 scenarios. */
  recovery_options?: RecoveryOption[]
  /** NRI: scenario-level context flags (editable via package parameters). */
  child_passenger?: boolean
  familiar_route?: boolean
  /** Feature 009 (FE2): Tier-1 fixed signal — true if the scenario drives at night.
   * Editable at setup time via `context_overrides.is_night` (a boolean context
   * override like child_passenger/familiar_route — see run_plan.py
   * _VALID_CONTEXT_OVERRIDE_KEYS). */
  is_night?: boolean
  /** Feature 009 (UX-BE/FE1): Fixed-tier weather-risk signal, float [0, 100].
   * Editable at setup time via `context_overrides.weather_risk` — same override
   * mechanism as child_passenger/familiar_route. Defaults to 0.0 on the backend
   * when a scenario file omits it. */
  weather_risk?: number
  /** Feature 020: drowsiness ceiling for rest-spot scoring. Defaults to 100.0
   * on the backend when a scenario file omits it. Optional for back-compat. */
  rest_drowsiness_ceiling?: number
  /** Scenario-level preset values. Passed through as-is. */
  presets?: Record<string, unknown>
}

/**
 * Feature 009 (UX-BE/FE1): Fixed-tier scenario-context overrides, changed-
 * from-scenario-default only (a component should delete a key once its value
 * reverts to the scenario's own default — mirrors the editedHyperparameters
 * convention). Sent verbatim as `context_overrides` to BOTH
 * POST /api/runs/preview and POST /api/run-plans.
 */
export type ContextOverrides = {
  child_passenger?: boolean
  familiar_route?: boolean
  /** Day/night Fixed-tier constant; toggles ScenarioDef.is_night on the backend. */
  is_night?: boolean
  /** Float in [0, 100]. */
  weather_risk?: number
}

/**
 * Sparse profile overrides for the run-plan body (U5/T008 backend contract).
 * Each sub-object is optional and deep-merged on the backend.
 * Send ONLY changed fields; omit this entirely when nothing changed.
 * Feature 009: `vehicle` is retired (the vehicle behaviour model is gone);
 * `anomaly` is new — overrides the Tier-3b seeded anomaly-rate generator.
 */
export type ProfileOverrides = {
  driver?: Record<string, unknown>
  anomaly?: Record<string, unknown>
  speed?: Record<string, unknown>
}

/** Numeric starting driver-state override (0–100). Omit a key to use the scenario default. */
export type InitialStateOverride = {
  drowsiness_level?: number
  fatigue_level?: number
}

// ── Setup / run-plan domain (M2) ───────────────────────────────────────────

export type RouteSegmentFact = {
  segment_type: 'highway' | 'normal_road' | 'mountain_road' | 'sightseeing_road'
  start_km: number
  length_km: number
}

export type RouteFacts = {
  total_route_distance_km: number | null
  estimated_route_duration_min: number | null
  route_segments: RouteSegmentFact[]
  rest_spot_positions: number[]
  route_progress_checkpoints: number[]
  segments?: unknown[]
  bands?: Record<string, string[]>
}

/** Display data for a Maps alternative; null for the local path. */
export type DisplayRoute = {
  summary: string
  encoded_polyline: string
  start_label: string
  end_label: string
}

export type RouteNotice = 'no_rest_stops_found' | 'rest_data_degraded' | 'rest_data_unavailable'

/** A single alternative from POST /api/routes/analyze (M4). */
export type RouteAlternative = {
  route_id: string
  summary: string
  route_facts: RouteFacts
  display: DisplayRoute | null
  notices: RouteNotice[]
}

/** Response envelope from POST /api/routes/analyze (M4). */
export type RouteEnvelope = {
  route_source: 'maps' | 'local'
  alternatives: RouteAlternative[]
}

/** A route preset summary from GET /api/routes/presets. */
export type RoutePresetSummary = {
  id: string
  label: { ja: string; en: string }
  start: string
  end: string
  distance_km: number
  duration_min: number
  summary: string
}

/** Structured error body from HTTP 502 on Maps API failure. */
export type MapsErrorBody = {
  error_type: string
  message: string
  suggestion: string
}

/**
 * Runtime error thrown by routesAnalyze when the backend returns 502.
 * Carries the structured detail body so the UI can surface the message
 * and offer a "Use local route" fallback.
 * The API key is never included in this error body.
 */
export class MapsError extends Error {
  readonly body: MapsErrorBody
  constructor(body: MapsErrorBody) {
    super(body.message)
    this.name = 'MapsError'
    this.body = body
  }
}

/** A single field-level validation error from /api/run-plans. */
export type ValidationError = {
  field: string
  message: string
}

/** Setup-time parameter/hyperparameter value (band/bool/numeric). */
export type SetupValue = string | boolean | number

/** Response from POST /api/run-plans and the regenerate endpoint. */
export type RunPlanResponse = {
  plan_id: string
  draft_plan: unknown
  effective_setup: Record<string, unknown>
  validation_errors: ValidationError[]
}

// ── Feature 009: RunConfig + ephemeral preview (InstantResult) ────────────

/**
 * Setup-time run configuration (mirrors backend RunConfig, data-model.md §4).
 * hyperparameter_overrides holds changed-from-manifest-default values only.
 * run_seed is frozen at run start (or per-preview) and drives anomaly_rate.
 */
export type RunConfig = {
  package_id: string
  scenario_id: string
  hyperparameter_overrides: Record<string, SetupValue>
  run_seed: number
  expert_override?: boolean
  /** Feature 009 (FE1): sparse profile overrides threaded through to the preview
   * (same shape/semantics as createRunPlan's `profiles`). Omit/null when unchanged. */
  profiles?: ProfileOverrides | null
  /** Feature 009 (FE1): sparse Fixed-tier context overrides (child_passenger/
   * familiar_route/weather_risk) threaded through to the preview. Omit/null when unchanged. */
  context_overrides?: ContextOverrides | null
  /** UX fix: the selected Maps/preset route, threaded into the preview so the
   * strip reflects the chosen route (distance/duration/segments/rest spots),
   * not the scenario's default local route. Omit for the local scenario route. */
  route_id?: string | null
  route_source?: string
  route_facts?: RouteFacts | null
  display_route?: DisplayRoute | null
}

/** The first actionable "rest_required" fire observed during a preview run.
 *  Mirrors `app/api/aica_api/models/run.py`'s `FirePoint` model exactly,
 *  including the two trace fields added alongside it there: `feature_
 *  contributions` (the trigger chain recorded AT this fire — {} for
 *  packages/previews that don't populate it) and `criteria` (thresholds/
 *  ladders in force at this tick). */
export type FirePoint = {
  category: string | null
  strength: string | null
  tick: number
  time_min: number
  feature_contributions: Record<string, unknown>
  criteria: Record<string, unknown>
}

/** One rest_required_score sample (for the setup-screen preview curve). */
export type ScoreSeriesPoint = {
  t: number
  score: number
}

/** One anomaly-spike event marked on the preview timeline. `t` aligns with
 *  score_series.t (tick index); `time_min` is the same instant in minutes. */
export type SpikePoint = {
  t: number
  time_min: number
}

/** A contiguous run of one segment type over the previewed route. */
export type PreviewSegment = {
  type: string | null
  from_min: number
  to_min: number
}

/** The rest spot the auto-chosen recovery stopped at. */
export type PreviewRestSpot = {
  at_km: number
  eta_min: number | null
}

/** The recovery option auto-accepted when the first proposal fired. */
export type PreviewRestOption = {
  id: string
  auto_chosen: boolean
  recovery_from_min: number | null
  to_min: number | null
}

/** An algorithm/context error surfaced during the preview (never a faked decision). */
export type PreviewError = {
  tick_index: number
  error_type: string
  message: string
}

/** A single hyperparameter override as echoed back by the preview endpoint. */
export type PreviewOverrideEntry = {
  key: string
  default: unknown
  value: unknown
}

/** Feature 020: per-tick route-progress sample (distance axis alignment). */
export type ProgressPoint = {
  t: number
  min: number
  frac: number
}

/** Feature 020: a traffic-jam range on the previewed route (minutes axis). */
export type PreviewTrafficJam = {
  from_min: number
  to_min: number
}

/**
 * Ephemeral, non-persisting preview result — response body of POST /api/runs/preview
 * (feature 009, US1). Never stored; a pure computation over a RunConfig.
 */
export type InstantResult = {
  fired: boolean
  fire: FirePoint | null
  /** Every actionable trigger across the run (first entry == `fire`). Optional so
   * pre-existing fixtures/constructors still typecheck; the backend always sends it. */
  fires?: FirePoint[]
  peak_score: number
  threshold: number | null
  score_series: ScoreSeriesPoint[]
  /** Second curve: the hybrid's monotony-prevention score/threshold. Empty for
   * algorithms (NRI) with a single rest-required score → strip renders one curve.
   * Optional so hand-built fixtures/constructors predating the field still typecheck;
   * the backend always sends them (defaulting to [] / null). */
  monotony_series?: ScoreSeriesPoint[]
  monotony_threshold?: number | null
  /** Anomaly-spike events over the run. Optional so hand-built fixtures predating
   * the field still typecheck; the backend always sends it (defaulting to []). */
  spikes?: SpikePoint[]
  segments: PreviewSegment[]
  rest_spot: PreviewRestSpot | null
  rest_option: PreviewRestOption | null
  /** Every auto-accepted rest across the run (rest_spot/rest_option == first of each).
   * Optional so pre-existing fixtures still typecheck; the backend always sends them. */
  rest_spots?: PreviewRestSpot[]
  rest_options?: PreviewRestOption[]
  completed_min: number | null
  seed: number
  overrides: PreviewOverrideEntry[]
  error: PreviewError | null
  /** Feature 020: per-tick route-progress (distance axis alignment). Empty for pre-020 consumers. */
  progress?: ProgressPoint[]
  /** Feature 020: traffic-jam ranges (minutes axis). Empty when no jams. */
  traffic_jams?: PreviewTrafficJam[]
}

// ── Run domain ─────────────────────────────────────────────────────────────

export type Snapshot = {
  package: { id: string; version: string; hash: string }
  scenario: { id: string; version: string; hash: string }
}

export type RunState = {
  run_id: string
  status: 'created' | 'playing' | 'paused' | 'completed'
  current_tick: number
  pending_proposal: string | null
  package_runtime_state: Record<string, unknown>
  snapshot: Snapshot
  event_plan: unknown
  route_facts: unknown
  allowed_actions?: string[]
  /**
   * M3: populated by the backend when a blocking algorithm error halts the run.
   * Shape mirrors run_state.last_error in the RunState model.
   * null when the run has not been halted by a blocking error.
   */
  last_error?: { tick_index: number; error_type: string; message: string } | null
  /** M7: current recovery state; null when no recovery is active. */
  recovery?: RecoveryStateT | null
}

export type RunSummary = {
  run_id: string
  created_at: string
  package_id: string
  scenario_id: string
  status: string
}

// ── Decision domain (§11 normalized shape) ────────────────────────────────

// M3: the backend records result_type VERBATIM — built-in algorithms emit the
// five values below; Python packages (e.g. the transparent hybrid) emit their
// own categories (MONOTONY_PROPOSAL / SUPPRESSED / NO_PROPOSAL) or package-defined
// values. The `(string & {})` arm keeps the union open while preserving editor
// autocomplete for the known constants. The trace renders the value as text; do
// not write an exhaustive switch over this type.
export type ResultType =
  | 'NO_TRIGGER'
  | 'SOFT_WARNING'
  | 'REST_PROPOSAL'
  | 'SEVERE_INTERVENTION'
  | 'NO_PRACTICAL_ACTION_FALLBACK'
  | 'MONOTONY_PROPOSAL'
  | 'SUPPRESSED'
  | 'NO_PROPOSAL'
  // eslint-disable-next-line @typescript-eslint/ban-types
  | (string & {})

export type FireControl = {
  fired: boolean
  suppressed: boolean
  override: boolean
  reason: string | null
}

export type Candidate = {
  category: string
  exists: boolean
  score: number
  state: string | null
  strength: string | null
  fire_control: FireControl
}

export type Proposal = {
  id: string
  message: { ja: string; en: string }
  options: string[]
}

export type DecisionResult = {
  result_type: ResultType
  trigger_candidate: boolean
  selected_category: string | null
  score: number | null
  features: Record<string, string>
  scores: Record<string, unknown>
  states: Record<string, unknown>
  criteria: Record<string, number>
  /** Per-category per-feature terms recorded by transparent packages (B1) —
   *  mirrors `app/api/aica_api/models/decision.py`'s `DecisionResult.
   *  feature_contributions: dict = {}`. Optional/absent for packages that do
   *  not populate it (e.g. the not-yet-re-ported hybrid TS port) — consumers
   *  must report the trigger stage as unavailable rather than inferring. */
  feature_contributions?: Record<string, unknown>
  candidates: Candidate[]
  fire_control: FireControl
  proposal: Proposal | null
  reason_inputs: string[]
  explanation: string
  next_package_runtime_state: Record<string, unknown>
}

export type AlgorithmError = {
  tick_index: number
  error_type: string
  message: string
}

// ── Recovery domain (M7 UC-01 Rest & Recovery) ────────────────────────────

export type RecoveryStage = {
  phase: string
  content: string
  motion: 'MOVING' | 'STOPPED'
  ticks?: number | null
}

export type RecoveryOption = {
  id: string
  label: { ja: string; en: string }
  stages?: RecoveryStage[]
  postpone?: boolean
}

export type RestSpot = {
  id: string
  label: { ja: string; en: string }
  lat?: number | null
  lng?: number | null
  route_fraction: number
  distance_km?: number | null
  eta_min?: number | null
  reachable?: boolean
  reachable_fallback?: boolean
  synthetic?: boolean
}

export type RecoveryStateT = {
  active: boolean
  option_id: string | null
  rest_spot: RestSpot | null
  phase: string | null
  stage_index: number
  stage_ticks_remaining: number
  /** Feature 020 Slice-2: cumulative drowsiness recovered via en-route MOVING
   * recovery this stage. Reset on stage transition. Defaults to 0.0 (not yet
   * implemented in the offline JS build; Python adds this via Pydantic default). */
  moving_recovery_accrued_drowsiness: number
  /** Feature 020 Slice-2: cumulative fatigue recovered via en-route MOVING
   * recovery this stage. Reset on stage transition. Defaults to 0.0 (not yet
   * implemented in the offline JS build; Python adds this via Pydantic default). */
  moving_recovery_accrued_fatigue: number
}

/**
 * A persisted record of an accepted rest — captured at accept time so the
 * chosen spot + option survive after the transient recovery state clears.
 * Drives the persistent rest markers (map + progress bar) and the event-log
 * "driver chose rest" line. Cleared on new run / scenario change / reset.
 */
export type RestChoice = {
  tickIndex: number
  optionId: string | null
  optionLabel: { ja: string; en: string } | null
  spot: RestSpot
}

// ── Tick response (discriminated union) ───────────────────────────────────

export type TickResponseSuccess = {
  run_state: RunState
  /** null when no evaluation happened (completed no-op). */
  decision: DecisionResult | null
  paused: boolean
  completed: boolean
  /**
   * The tick_index of the TickEvent persisted during this call — i.e.
   * current_tick BEFORE post-increment.  null when no evaluation happened
   * (completed no-op or tick_state.completed early-exit).
   */
  tick_index: number | null
  /** Authoritative speed-integrated position (0–1) from the evaluated TickState. */
  route_fraction?: number | null
  /** Distance travelled so far (km). */
  distance_km?: number | null
  /** Current effective speed (kph) at this tick. */
  speed_kph?: number | null
  /** Current motion state (e.g. 'MOVING', 'STOPPED') from the recovery engine. */
  motion_state?: string | null
  /** Current recovery phase label from the recovery engine. */
  recovery_phase?: string | null
  /** Active content string shown during a recovery stage. */
  active_content?: string | null
  /** True when the current segment is a traffic jam. */
  is_traffic_jam?: boolean | null
  /** Current road segment class from the tick engine (e.g. 'highway', 'normal_road'). */
  segment_type?: string | null
}

export type TickResponseError = {
  run_state: RunState
  error: AlgorithmError
  /**
   * True when the package's error_mode is "blocking" (the default).
   * False when error_mode is "non_blocking" (run continues after the error).
   * MIGRATED from literal `false` to `boolean` in M3 T010.
   */
  paused: boolean
  /** The tick_index of the AlgorithmError event persisted during this call. */
  tick_index: number | null
}

export type TickResponse = TickResponseSuccess | TickResponseError

// ── Log domain ─────────────────────────────────────────────────────────────

/**
 * In-memory store trace entry: DecisionResult flattened with tick_index.
 * Used by runStore.ts; NOT the same as the persisted JSON shape.
 */
export type TraceEntry = DecisionResult & {
  tick_index: number
  /** Authoritative route position (0–1) recorded with this tick, when available. */
  route_fraction?: number | null
  /** Motion state at this tick (e.g. 'MOVING', 'STOPPED'). */
  motion_state?: string | null
  /** Recovery phase label at this tick, if recovery was active. */
  recovery_phase?: string | null
  /** True when this tick was inside a traffic jam segment. */
  is_traffic_jam?: boolean | null
  /** Road segment class at this tick (from per-tick engine state). */
  segment_type?: string | null
  /** True when this tick's proposal actually paused the run (not suppressed by recovery guard). */
  proposal_paused?: boolean
  /** Current effective speed (kph) at this tick, when available. Mirrors
   *  TickResponseSuccess.speed_kph; state/runStore.ts already threads it onto
   *  every TraceEntry it builds (see the tick reducer) — this field was simply
   *  missing from the type declaration. */
  speed_kph?: number | null
  /** Active content string shown during a recovery stage, when available.
   *  Mirrors TickResponseSuccess.active_content; state/runStore.ts already
   *  threads it onto every TraceEntry it builds — this field was simply
   *  missing from the type declaration. */
  active_content?: string | null
}

/**
 * Persisted trace entry shape (inside a TickEvent in the run log JSON).
 * Nested: { tick_index, decision_result: DecisionResult }.
 */
export type LogTraceEntry = {
  tick_index: number
  decision_result: DecisionResult
}

export type TickEvent = {
  kind: 'tick'
  tick_index: number
  tick_state: Record<string, unknown>
  raw_state?: Record<string, unknown>
  trace: LogTraceEntry
}

export type ActionEvent = {
  kind: 'action'
  tick_index: number
  action: string
  resulting_status: string
}

export type AlgorithmErrorEvent = {
  kind: 'algorithm_error'
} & AlgorithmError

// ── M5 Feedback domain ─────────────────────────────────────────────────────

/**
 * A single review label field definition (mirrors backend FieldDef).
 * type="choice": options list; note=true → reviewer may add a free-text note.
 * type="text":   free text only.
 * type="scale":  numeric within [min, max].
 */
export type FieldDef = {
  key: string
  label: { ja: string; en: string }
  type: 'choice' | 'text' | 'scale'
  options?: string[] | null
  note?: boolean
  min?: number | null
  max?: number | null
}

/** Identifies what a FeedbackEvent is about (run / decision / proposal / action). */
export type FeedbackTarget = {
  scope: 'run' | 'decision' | 'proposal' | 'action'
  event_ref?: number | null
  tick_index?: number | null
  proposal_id?: string | null
  action?: string | null
}

/**
 * Append-only reviewer feedback event (kind="feedback") in RunLog.events.
 * labels values may be a plain string, or {"choice": string, "note"?: string}
 * for note-enabled choice fields.
 */
export type FeedbackEvent = {
  kind: 'feedback'
  target: FeedbackTarget
  labels: Record<string, unknown>
  comment?: string | null
}

/** Response from GET /api/runs/{id}/feedback-schema. */
export type FeedbackSchema = {
  fields: FieldDef[]
}

/** POST body for /api/runs/{id}/feedback. */
export type FeedbackSubmitBody = {
  target: FeedbackTarget
  labels?: Record<string, unknown>
  comment?: string | null
}

/**
 * Runtime error thrown by submitFeedback when the backend returns 400.
 * Carries the structured validation_errors list.
 */
export class FeedbackValidationError extends Error {
  readonly validationErrors: { field: string; message: string }[]
  constructor(detail: { validation_errors?: { field: string; message: string }[] }) {
    super('Feedback validation failed')
    this.name = 'FeedbackValidationError'
    this.validationErrors = detail?.validation_errors ?? []
  }
}

export type RunLogEvent = TickEvent | ActionEvent | AlgorithmErrorEvent | FeedbackEvent

export type RunLog = {
  run_id: string
  created_at: string
  simulator_version: string
  snapshot: Snapshot
  route_facts: unknown
  event_plan: unknown
  run_mode: string
  evidence_status: string
  events: RunLogEvent[]
}

// ── M5 Evidence report (§14.2) ─────────────────────────────────────────────

/** §14.2 simulator facts — machine-recorded simulator outputs (no human feedback). */
export type EvidenceSimulatorFacts = {
  route_snapshot: unknown | null
  route_facts: unknown
  event_plan: unknown
  run_mode: string
  evidence_status: string
  initial_parameters: Record<string, unknown>
  final_parameters?: Record<string, unknown>
  initial_hyperparameters: Record<string, unknown>
  final_hyperparameters?: Record<string, unknown>
  driver_profile: Record<string, unknown> | null
  vehicle_profile: Record<string, unknown> | null
  timeline_events: unknown[]
  decision_trace: unknown[]
  proposal_events: unknown[]
  actions: unknown[]
  expert_override_events?: unknown[]
  algorithm_errors: unknown[]
  run_comparison_reference?: unknown | null
}

/** §14.2 human review — only human feedback values; never simulator facts. */
export type EvidenceHumanReview = {
  feedback_labels: Array<{
    target: FeedbackTarget
    labels: Record<string, unknown>
  }>
  free_text_comments: Array<{
    target: FeedbackTarget
    comment: string
  }>
}

/**
 * §14.2 Evidence report — derived from the persisted RunLog.
 * Separation invariant: FeedbackEvents appear ONLY under human_review;
 * simulator_facts NEVER contains a feedback value.
 */
export type EvidenceReport = {
  report_id: string
  run_id: string
  timestamp: string
  ui_language: string
  simulator_version: string
  package: { id: string; version: string }
  scenario: { id: string; version: string }
  simulator_facts: EvidenceSimulatorFacts
  human_review: EvidenceHumanReview
}
