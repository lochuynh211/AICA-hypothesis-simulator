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
  kind: 'band' | 'bool'
  band_values?: string[]
  default: string | boolean
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
  total_duration_seconds: number
  tick_seconds: number
  allowed_actions: string[]
  review_focus: string
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
}

export type RunSummary = {
  run_id: string
  created_at: string
  package_id: string
  scenario_id: string
  status: string
}

// ── Decision domain (§11 normalized shape) ────────────────────────────────

export type ResultType =
  | 'NO_TRIGGER'
  | 'SOFT_WARNING'
  | 'REST_PROPOSAL'
  | 'SEVERE_INTERVENTION'
  | 'NO_PRACTICAL_ACTION_FALLBACK'

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
  paused: false
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

export type RunLogEvent = TickEvent | ActionEvent | AlgorithmErrorEvent

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
