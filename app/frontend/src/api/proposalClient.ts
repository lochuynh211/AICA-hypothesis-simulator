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
  /** Content package's frozen setup-time overrides (FR-002a); {} until STEP 2. */
  content_parameters?: Record<string, unknown>
  content_hyperparameters?: Record<string, unknown>
  journey_state: JourneyState
  events: DiscreteEvent[]
  evidence: AlgorithmEvidence[]
  status: ProposalRunStatus
}

// ── P3 (feature 014): typed World / seeds / profiles / datasets ────────────
//
// Mirrors `app/api/aica_api/models/proposal/{world,dataset,enums}.py`. Field
// names and nesting are verbatim from the backend Pydantic models so that a
// `World` object built here round-trips through `POST /worlds/validate` and
// `POST /runs` unchanged. See `specs/014-proposal-p3-editable-world/`
// `contracts/proposal-p3-api.md` and `data-model.md`.

export type TrafficStateValue = 'normal' | 'congested'
export type RoadTypeValue = 'highway' | 'local' | 'mountain' | 'parking'
export type NightStateValue = 'day' | 'night'
export type RestSpotTypeValue = 'sa_pa' | 'convenience_store' | 'parking' | 'oshi_spot' | 'other' | 'unknown'
export type OshiModeValue = 'on' | 'off'
export type OshiTypeValue =
  | 'artist'
  | 'artist_member'
  | 'group'
  | 'character'
  | 'voice_actor'
  | 'franchise'
  | 'creator'
  | 'other'
export type AgeBandValue = 'teens' | '20s' | '30s' | '40s' | '50s' | '60plus'
export type GenderValue = 'male' | 'female' | 'non_binary' | 'unspecified'
export type RecencyStateValue = 'never' | 'long_unused' | 'recent'
export type ScheduledEventTypeValue = 'none' | 'live_show' | 'radio_program' | 'concert' | 'oshi_event' | 'other'
export type ScheduledEventTimingValue = 'now' | 'soon' | 'later' | 'unknown'
export type UsageLevelValue = 'never' | 'low' | 'med' | 'high'
export type GenreLiteralValue =
  | 'j-pop'
  | 'j-rock'
  | 'city pop'
  | 'anime'
  | 'vocaloid'
  | 'enka'
  | "children's music"
  | 'classical'
  | 'jazz'
  | 'ambient'
  | 'electronic'
  | 'japanese folk'

/** The 14 catalog service identifiers (spec §7.1-7.2). Kept as a plain
 * string here (not reusing a narrower literal) since map keys/values in
 * driver-profile fields are validated server-side; the UI only needs a
 * stable option list (see `WorldPanel`'s `SERVICE_ID_OPTIONS`). */
export type ServiceIdValue = string

export const GENRE_VOCABULARY: GenreLiteralValue[] = [
  'j-pop',
  'j-rock',
  'city pop',
  'anime',
  'vocaloid',
  'enka',
  "children's music",
  'classical',
  'jazz',
  'ambient',
  'electronic',
  'japanese folk',
]

export const SERVICE_ID_OPTIONS: ServiceIdValue[] = [
  'music_playlist',
  'humming_karaoke',
  'call_response_driving',
  'quiz',
  'ranking_creation',
  'radio_style',
  'conversation_audio',
  'live_viewing',
  'stretch_video',
  'full_karaoke',
  'call_response_stopped',
  'oshi_reexperience',
  'relaxation_multisensory',
  'linked_video_recommendation',
]

// ── Timestamped item/event sub-shapes (data-model.md) ───────────────────────

export type PlayedItem = { track_id: string; last_played_at: string }
export type SkippedItem = { track_id: string; skipped_at: string }
export type ChangedFromItem = { track_id: string; changed_at: string }
export type CompletedItem = { track_id: string; completed_at: string }
export type ManuallySelectedItem = { track_id: string; selected_at: string }
export type RepeatedItem = { track_id: string; repeated_at: string }
export type CancelledContentPlan = { plan_id: string; cancelled_at: string }
export type ServiceRejection = { service_id: ServiceIdValue; rejected_at: string }

// ── ControlInputs / Situation / DriverProfile / World ───────────────────────

export type ControlInputs = {
  trigger_purpose: TriggerPurpose
  lifecycle_stage: LifecycleStage
  motion_state: MotionState
  matrix_version: string
  dataset_id: string
}

export type Situation = {
  drowsiness_level: number
  fatigue_level: number
  traffic_state: TrafficStateValue
  road_type: RoadTypeValue
  night_state: NightStateValue
  monotony_level: number
  route_tags: string[]
  destination_tags: string[]
  child_present: boolean
  multiple_passengers: boolean
  motion_state: MotionState
  estimated_min_until_rest_spot: number | null
  rest_spot_type: RestSpotTypeValue
  active_service: ServiceIdValue | null
  recent_service_rejections: ServiceRejection[]
}

export type DriverProfile = {
  // Oshi information
  oshi_registered: boolean
  oshi_mode: OshiModeValue
  oshi_id: string | null
  oshi_type: OshiTypeValue | null
  oshi_tags: string[]
  // UPro information
  age_band: AgeBandValue
  gender: GenderValue
  hobby_interest_tags: string[]
  // Usage / recency / scene tendency
  service_usage_level: Record<string, UsageLevelValue>
  service_recency_state: Record<string, RecencyStateValue>
  scene_service_usage_level: Record<string, Record<string, UsageLevelValue>>
  catalog_item_usage_level: Record<string, UsageLevelValue>
  catalog_item_recency_state: Record<string, RecencyStateValue>
  content_tag_usage_level: Record<string, UsageLevelValue>
  content_tag_recency_state: Record<string, RecencyStateValue>
  scene_content_tag_usage_level: Record<string, Record<string, UsageLevelValue>>
  // Playback and user operations
  played_items: PlayedItem[]
  skipped_items: SkippedItem[]
  changed_from_items: ChangedFromItem[]
  cancelled_content_plans: CancelledContentPlan[]
  // Granular operations (Additional proposed)
  completed_items: CompletedItem[]
  manually_selected_items: ManuallySelectedItem[]
  repeated_items: RepeatedItem[]
  // History: proposal / recovery results
  service_proposal_acceptance_rate: Record<string, number>
  service_recovery_rate: Record<string, number>
  content_proposal_acceptance_rate: Record<string, number>
  content_recovery_rate: Record<string, number>
  // History: evidence reliability (Additional proposed)
  service_proposal_acceptance_confidence: Record<string, number>
  service_recovery_confidence: Record<string, number>
  content_proposal_acceptance_confidence: Record<string, number>
  content_recovery_confidence: Record<string, number>
  // History: schedule promotion
  scheduled_event_type: ScheduledEventTypeValue | null
  scheduled_event_timing: ScheduledEventTimingValue | null
  scheduled_event_tags: string[]
  // Genre extension (opt-in)
  genre_affinity_v1_enabled: boolean
  usage_by_genre: Partial<Record<GenreLiteralValue, UsageLevelValue>> | null
  scene_genre_usage: Record<string, Partial<Record<GenreLiteralValue, UsageLevelValue>>> | null
}

export type DatasetVersion = {
  schema_version: string
  spotify_track_reference_version: string
  spotify_audio_features_reference_version: string
}

export type CatalogRef = {
  dataset_id: string
  dataset_version: DatasetVersion
  dataset_hash: string
}

export type DatasetProvenance = {
  dataset_id: string
  dataset_version: DatasetVersion
  dataset_hash: string
  tier: string
  provenance_note: string
}

export type DatasetSummary = {
  dataset_id: string
  dataset_version: DatasetVersion
  dataset_hash: string
  tier: string
  synthetic_only: boolean
  song_count: number
}

export type World = {
  control_inputs: ControlInputs
  situation: Situation
  driver_profile: DriverProfile
  catalog_ref: CatalogRef
}

export type SeedSummary = { seed_id: string; label: BilingualLabel; description: BilingualLabel }

export type SeedWorld = {
  seed_id: string
  label: BilingualLabel
  description: BilingualLabel
  world: World
}

export type ProfileSummary = { profile_id: string; label: BilingualLabel; builtin: boolean }

export type DriverProfileRecord = {
  profile_id: string
  label: BilingualLabel
  builtin: boolean
  profile: DriverProfile
}

export type WorldValidationIssue = { path: string; code: string; message: string }

/** Minimal shape read by `CatalogView` — the real `Song` model has many more
 * fields (see `app/api/aica_api/models/proposal/song_schema.py`); the UI is
 * read-only and only ever displays identity + a couple of descriptive
 * fields, never edits them. */
export type CatalogSongSummary = {
  spotify_track: {
    id: string
    name: string
    artists?: { id: string; name: string }[] | null
  }
}

// ── GET /api/proposal/datasets (read-only) ──────────────────────────────────

export async function getDatasets(): Promise<{
  datasets: DatasetSummary[]
  errors: { dataset_id: string; message: string }[]
}> {
  return apiFetch('/datasets', { method: 'GET' })
}

// ── GET /api/proposal/datasets/{id}/catalog (read-only) ─────────────────────

export async function getCatalog(
  datasetId: string,
  offset = 0,
  limit?: number,
): Promise<{ provenance: DatasetProvenance; total: number; songs: CatalogSongSummary[] }> {
  const params = new URLSearchParams()
  params.set('offset', String(offset))
  if (limit !== undefined) params.set('limit', String(limit))
  return apiFetch(`/datasets/${encodeURIComponent(datasetId)}/catalog?${params.toString()}`, { method: 'GET' })
}

// ── GET /api/proposal/seeds[/{id}] ──────────────────────────────────────────

export async function getSeeds(): Promise<{ seeds: SeedSummary[] }> {
  return apiFetch('/seeds', { method: 'GET' })
}

export async function getSeed(seedId: string): Promise<SeedWorld> {
  return apiFetch(`/seeds/${encodeURIComponent(seedId)}`, { method: 'GET' })
}

// ── Driver-profile CRUD ──────────────────────────────────────────────────────

export async function listProfiles(): Promise<{ profiles: ProfileSummary[] }> {
  return apiFetch('/profiles', { method: 'GET' })
}

export async function getProfile(profileId: string): Promise<DriverProfileRecord> {
  return apiFetch(`/profiles/${encodeURIComponent(profileId)}`, { method: 'GET' })
}

export async function saveProfile(label: BilingualLabel, profile: DriverProfile): Promise<DriverProfileRecord> {
  return apiFetch('/profiles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label, profile }),
  })
}

export async function deleteProfile(profileId: string): Promise<void> {
  const response = await fetch(`${PROPOSAL_API_BASE}/profiles/${encodeURIComponent(profileId)}`, {
    method: 'DELETE',
  })
  if (!response.ok) {
    throw new Error(`Proposal API error: ${response.status}`)
  }
}

// ── POST /api/proposal/worlds/validate ──────────────────────────────────────

export async function validateWorld(world: World): Promise<{ valid: boolean; issues: WorldValidationIssue[] }> {
  return apiFetch('/worlds/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ world }),
  })
}

// ── POST /api/proposal/runs — create + STEP 1 ───────────────────────────────

export type CreateProposalRunBody = {
  trigger_purpose: TriggerPurpose
  lifecycle_stage: LifecycleStage
  motion_state: MotionState
  /** Typed world (P3) — wins over `world_snapshot` when both are present. */
  world?: World
  world_snapshot?: Record<string, unknown>
  /** Which committed artifact(s) the typed world was assembled from — frozen
   * verbatim into the run's `SetupSnapshot.origin` (data-model.md). */
  origin_seed_id?: string | null
  origin_clone_id?: string | null
  origin_profile_id?: string | null
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

export async function selectService(
  runId: string,
  serviceId: string,
  overrides: { parameters?: Record<string, unknown>; hyperparameters?: Record<string, unknown> } = {},
): Promise<ProposalRunLog> {
  return apiFetch(`/runs/${encodeURIComponent(runId)}/select-service`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      selected_service_id: serviceId,
      parameters: overrides.parameters ?? {},
      hyperparameters: overrides.hyperparameters ?? {},
    }),
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
