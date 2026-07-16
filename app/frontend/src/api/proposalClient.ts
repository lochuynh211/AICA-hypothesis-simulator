/**
 * proposalClient — typed client for the `/api/proposal/*` endpoints (P1 T024).
 *
 * Follows `api/client.ts` conventions: a thin `apiFetch` wrapper over the
 * platform `fetch`, relative paths (no absolute host — the Vite dev-server
 * proxy and the production container both serve the API same-origin), and
 * throws on a non-OK response. Types mirror the shapes documented in
 * `specs/013-proposal-p1-screen-foundation/{data-model.md,contracts/proposal-api.md}`
 * and the backend Pydantic models under `app/api/aica_api/models/proposal/`.
 *
 * ISOLATION: this module must not import anything from the trigger
 * `api/client.ts` / `api/types.ts` — the Proposal Simulator's API surface is
 * deliberately separate from the trigger's.
 */

/** Base path for every Proposal Simulator endpoint. */
export const PROPOSAL_API_BASE = '/api/proposal'

// ── Internal helper (mirrors api/client.ts's apiFetch) ──────────────────────

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${PROPOSAL_API_BASE}${path}`, init)
  if (!response.ok) {
    let detail = ''
    try {
      const body = await response.json()
      detail = typeof body?.detail === 'string' ? body.detail : JSON.stringify(body?.detail ?? body)
    } catch {
      // response body was not JSON (or empty) — fall back to the status alone
    }
    throw new Error(
      detail ? `Proposal API error: ${response.status} — ${detail}` : `Proposal API error: ${response.status}`,
    )
  }
  return response.json() as Promise<T>
}

// Re-exported for future endpoint methods added in later tasks; referencing
// it here (as a no-op type-only usage) keeps the linter from flagging an
// unused import while the skeleton has no endpoints yet.
export type ProposalApiFetch = typeof apiFetch

// ── Shared bilingual + enum-ish types ───────────────────────────────────────

export type BilingualLabel = { ja: string; en: string }

export type TriggerPurpose =
  | 'rest_recommended'
  | 'inattentive_driving_prevention_recovery'
  | 'route_music'
  | 'child_passenger_experience'

export type LifecycleStage =
  | 'before_rest_until_stop'
  | 'during_rest_stopped'
  | 'after_rest_before_restart'
  | 'active_driving_content'

export type MotionState = 'driving' | 'stopped'

export type ProposalPackageFamily = 'service_selector' | 'content_selector'
export type ProposalPackageApproach = 'transparent' | 'constrained_llm'

export type FeatureOriginProvenance =
  | 'cdc_su_baseline'
  | 'normalized_cdc_su_concept'
  | 'proposed_addition'

// ── GET /api/proposal/matrix ─────────────────────────────────────────────────

export type MatrixRow = {
  trigger_purpose: TriggerPurpose
  lifecycle_stage: LifecycleStage
  allowed_service_ids: string[]
}

export type MatrixResponse = {
  matrix_version: string
  rows: MatrixRow[]
}

export async function getMatrix(): Promise<MatrixResponse> {
  return apiFetch('/matrix', { method: 'GET' })
}

// ── GET /api/proposal/packages ───────────────────────────────────────────────

/**
 * A single hyperparameter definition rendered as an editable control.
 * `kind`-specific extra fields (e.g. `min`/`max`/`step` for `numeric`,
 * `values` for `enum`) are left open via the index signature — the manifest
 * is the source of truth, not this type.
 */
export type HyperparameterDef = {
  key: string
  kind: 'matrix' | 'table' | 'map' | 'numeric' | 'enum' | 'string'
  label: BilingualLabel
  default: unknown
  [extra: string]: unknown
}

export type ProposalPackageSummary = {
  id: string
  version: string
  label: BilingualLabel
  family: ProposalPackageFamily
  approach: ProposalPackageApproach
  contract_version: string
  supported_services: string[]
  parameters: Record<string, unknown>
  hyperparameters: HyperparameterDef[]
}

export type ProposalPackageSlot = {
  family: ProposalPackageFamily
  approach: ProposalPackageApproach
  package_id: string | null
}

export type ProposalPackageLoadError = {
  package_dir: string
  error: string
}

export type ProposalPackagesResponse = {
  slots: ProposalPackageSlot[]
  packages: ProposalPackageSummary[]
  errors: ProposalPackageLoadError[]
}

export async function getPackages(): Promise<ProposalPackagesResponse> {
  return apiFetch('/packages', { method: 'GET' })
}

// ── Shared: selector output shapes ──────────────────────────────────────────

export type FeatureContribution = {
  feature_id: string
  feature_value: string | number
  response_coefficient: number
  weight: number
  contribution: number
}

/**
 * `rationale` is a POSITIONAL bilingual pair — `[ja_text, en_text]` — as
 * emitted by the mock packages' `algorithm.py` (NOT the `{ja,en}` object
 * shape `t()` expects). Use `pickRationale()` below to resolve it.
 */
export type RankedCandidate = {
  rank: number
  candidate_id: string
  score: number | null
  rationale: string[]
  supporting_feature_ids: string[]
  opposing_feature_ids: string[]
  uncertainty: string | null
  feature_contributions: FeatureContribution[]
}

export type ExcludedCandidate = {
  candidate_id: string
  platform_reason: string
}

export type ServiceSelectorOutput = {
  decision_type: 'ranked_candidates' | 'no_proposal'
  ranked_candidates: RankedCandidate[]
  excluded_candidates: ExcludedCandidate[]
  unused_available_features: string[]
  missing_features: string[]
  next_package_runtime_state: Record<string, unknown>
  algorithm_provenance: Record<string, unknown>
}

export type ItemFeatureContribution = {
  feature_id: string
  e_i: number
  a_i: number
  alpha: number | null
  beta: number | null
  exact_match: boolean | null
  response_provenance: string | null
  r_i: number
  base_weight: number
  purpose_multiplier: number
  mask: number
  effective_weight: number
  contribution: number
  formula_version: string
}

export type OrderedItem = {
  position: number
  item_id: string
  item_fit: number | null
  trait_values: Record<string, number> | null
  feature_contributions: ItemFeatureContribution[]
  rationale: string[]
}

export type PlanMode = {
  service_id: string
  mode_kind: 'playlist' | 'humming' | 'full_karaoke'
  chorus_only: boolean | null
  guide_vocal: boolean | null
  driving_lyrics: boolean | null
  fixed_segment_sec: number | null
  stopped_only: boolean | null
  simulated_queue: boolean | null
}

export type LightingConfiguration = {
  enabled: boolean
  cue_basis: string | null
  notes: string | null
} | null

export type ExcludedItem = {
  item_id: string
  reason_codes: string[]
}

export type CompletePlan = {
  decision_type: string
  selected_service_id: string
  requested_item_count: number
  returned_item_count: number
  ordered_items: OrderedItem[]
  mode: PlanMode
  expected_duration_sec: number
  lighting_configuration: LightingConfiguration
  approval_policy: string
  completion_rule: string
  next_transition_policy: string
  excluded_items: ExcludedItem[]
  unused_available_features: string[]
  missing_features: string[]
  algorithm_provenance: Record<string, unknown>
}

// ── Evidence / events / journey / run log ──────────────────────────────────

export type EvidenceError = { category: string; message: string }

export type AlgorithmEvidence = {
  step: 'service' | 'content'
  package_id: string
  contract_version: string
  schema_version: string
  matrix_version: string
  input_snapshot: Record<string, unknown>
  /** ServiceSelectorOutput-shaped or CompletePlan-shaped dict, or null on error. */
  output: Record<string, unknown> | null
  error: EvidenceError | null
  used_feature_ids: string[]
  unused_available_features: string[]
  missing_features: string[]
}

export type DiscreteEvent = {
  event_type: string
  at: string | number
  payload: Record<string, unknown>
}

export type JourneyState = {
  lifecycle_stage: LifecycleStage
  motion_state: MotionState
  active_service_id: string | null
  active_plan_id: string | null
}

export type ProposalOpportunity = {
  opportunity_id: string
  trigger_purpose: TriggerPurpose
  lifecycle_stage: LifecycleStage
  allowed_service_ids: string[]
  simulation_time: string | number
  run_seed: string
}

export type ProposalRunStatus = 'created' | 'service_selected' | 'content_selected' | 'error'

export type ProposalRunLog = {
  run_id: string
  created_at: string
  opportunity: ProposalOpportunity
  matrix_version: string
  world_snapshot: Record<string, unknown>
  service_package_id: string
  content_package_id: string | null
  parameters: Record<string, unknown>
  hyperparameters: Record<string, unknown>
  journey_state: JourneyState
  events: DiscreteEvent[]
  evidence: AlgorithmEvidence[]
  status: ProposalRunStatus
}

// ── POST /api/proposal/runs — create + STEP 1 ───────────────────────────────

export type CreateProposalRunBody = {
  trigger_purpose: TriggerPurpose
  lifecycle_stage: LifecycleStage
  motion_state: MotionState
  world_snapshot?: Record<string, unknown>
  service_package_id: string
  content_package_id: string
  mode?: string
  enabled_feature_extensions?: string[]
  parameters?: Record<string, unknown>
  hyperparameters?: Record<string, unknown>
  run_seed: string
  simulation_time: string | number
}

export async function createRun(body: CreateProposalRunBody): Promise<ProposalRunLog> {
  return apiFetch('/runs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// ── POST /api/proposal/runs/{run_id}/select-service — STEP 2 ───────────────

export async function selectService(runId: string, serviceId: string): Promise<ProposalRunLog> {
  return apiFetch(`/runs/${encodeURIComponent(runId)}/select-service`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ selected_service_id: serviceId }),
  })
}

// ── GET /api/proposal/runs — list summaries (P1 T036) ───────────────────────

/** Summary shape for run listings (mirrors backend `ProposalRun`). */
export type ProposalRunSummary = {
  run_id: string
  status: ProposalRunStatus
  opportunity_id: string
  created_at: string
  service_package_id: string
  content_package_id: string | null
}

export async function listRuns(): Promise<ProposalRunSummary[]> {
  return apiFetch('/runs', { method: 'GET' })
}

// ── GET /api/proposal/runs/{run_id} — full log, no recompute (P1 T036) ─────

export async function getRun(runId: string): Promise<ProposalRunLog> {
  return apiFetch(`/runs/${encodeURIComponent(runId)}`, { method: 'GET' })
}

// ── DELETE /api/proposal/runs/{run_id} (P1 T036) ────────────────────────────

export async function deleteRun(runId: string): Promise<void> {
  const response = await fetch(`${PROPOSAL_API_BASE}/runs/${encodeURIComponent(runId)}`, {
    method: 'DELETE',
  })
  if (!response.ok) {
    throw new Error(`Proposal API error: ${response.status}`)
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Resolve a positional bilingual `[ja, en]` rationale pair (see
 * `RankedCandidate.rationale` / `OrderedItem.rationale`) to a single string —
 * distinct from `t()`, which resolves the `{ja,en}` OBJECT shape.
 */
export function pickRationale(rationale: string[] | undefined, lang: 'ja' | 'en'): string {
  if (!rationale || rationale.length === 0) return ''
  const index = lang === 'ja' ? 0 : 1
  return rationale[index] ?? rationale[0] ?? ''
}
