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
  algorithm: { type: string; entrypoint: string }
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

export type ScenarioDef = {
  id: string
  version: string
  type: string
  persona: Record<string, unknown>
  route_intent: RouteIntent
  initial_state: Record<string, string>
  event_presets: EventPreset
  driver_profile: Record<string, unknown>
  vehicle_profile: Record<string, unknown>
  /** M6 T009: speed profile — optional for back-compat with older scenarios. */
  speed_profile?: Record<string, unknown>
  total_duration_seconds: number
  tick_seconds: number
  allowed_actions: string[]
  review_focus: string
}

/**
 * Sparse profile overrides for the run-plan body (U5/T008 backend contract).
 * Each sub-object is optional and deep-merged on the backend.
 * Send ONLY changed fields; omit this entirely when nothing changed.
 */
export type ProfileOverrides = {
  driver?: Record<string, unknown>
  vehicle?: Record<string, unknown>
  speed?: Record<string, unknown>
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
export type TraceEntry = DecisionResult & { tick_index: number }

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
