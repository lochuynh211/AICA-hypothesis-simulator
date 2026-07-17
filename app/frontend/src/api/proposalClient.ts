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

/**
 * P5 Unit A (specs/016-proposal-p5-transparent-service-selector,
 * contracts/service_output_extension.md) — the §14 optional explainability
 * extension. Every field is optional (`?:`); `mock_service_selector_v1`
 * emits none of them, and the panel falls back to the current lean
 * rendering when they're absent.
 */
export type FeatureContribution = {
  feature_id: string
  feature_value: string | number
  response_coefficient: number
  weight: number
  contribution: number
  // --- P5 §14 optional extension ---
  source_reference?: string | null
  raw_value?: string | number | null
  normalization_function?: string | null
  normalized_evidence?: number | null
  response_provenance?: string | null
  normalized_feature_response?: number | null
  hierarchy_path?: string | null
  base_weight?: number | null
  purpose_multiplier?: number | null
  effective_weight?: number | null
  status?: string | null
}

/**
 * Per-candidate and/or run-level safety-dominance configuration readout
 * (data-model.md §2 / algorithm doc §6.4). Every field is required WITHIN
 * this object — the object itself is optional on its parents.
 */
export type DominanceReadout = {
  status: string
  w_d: number
  w_l: number
  required_gap: number
  material_safety_gap: number
  safety_share: number
  safety_share_warning: boolean
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
  // --- P5 §14 optional extension ---
  situation_fit?: number | null
  preference_fit?: number | null
  history_fit?: number | null
  strongest_support?: { feature_id: string; contribution: number } | null
  strongest_oppose?: { feature_id: string; contribution: number } | null
  dominance?: DominanceReadout | null
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
  // --- P5 §14 optional extension ---
  dominance?: DominanceReadout | null
  effective_weights?: Record<string, number> | null
  resolved_config_versions?: Record<string, unknown> | null
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
  // §14 explainability roll-up (mirrors service RankedCandidate) — optional.
  situation_fit?: number | null
  preference_fit?: number | null
  history_fit?: number | null
  strongest_support?: { feature_id: string; contribution: number } | null
  strongest_oppose?: { feature_id: string; contribution: number } | null
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

export type PlaybackStateValue = 'idle' | 'active' | 'backgrounded' | 'paused' | 'completed' | 'stopped'

export type PreviousContent = { service_id: string | null; plan_ref: string | null }

export type JourneyState = {
  lifecycle_stage: LifecycleStage
  motion_state: MotionState
  active_service_id: string | null
  active_plan_id: string | null
  // P4 additions (data-model.md "JourneyState (extend journey.py)") — optional
  // here so pre-P4 test fixtures/fixture literals built without them still
  // type-check; the backend defaults them the same way.
  playback_state?: PlaybackStateValue
  current_plan_ref?: string | null
  previous_content?: PreviousContent | null
  rejected_service_ids?: string[]
}

export type ProposalOpportunity = {
  opportunity_id: string
  trigger_purpose: TriggerPurpose
  lifecycle_stage: LifecycleStage
  allowed_service_ids: string[]
  simulation_time: string | number
  run_seed: string
}

export type ProposalRunStatus =
  | 'created'
  | 'service_selected'
  | 'content_selected'
  | 'error'
  // P4 additions (enums.py ProposalRunStatus — new members)
  | 'content_started'
  | 'content_completed'
  | 'content_stopped'

/** Per-run mode, frozen at create time (P7 — `enums.py ProposalRunMode`).
 * `interactive` stops at each reviewer decision point; `quick_check`
 * auto-selects the rank-1 service + dispatches content in the same call
 * (FR-011-FR-014). */
export type ProposalRunMode = 'interactive' | 'quick_check'

/** Minimal shape read by the P7 UI — the backend `SetupSnapshot` (P3
 * `models/proposal/world.py`) has more fields; this UI only ever renders it
 * verbatim from history, never edits it, so an index signature covers the
 * rest without duplicating the whole backend model. */
export type SetupSnapshot = {
  origin: { seed_id: string | null; clone_id: string | null; profile_id: string | null }
  matrix_version: string
  dataset_id: string
  service_package_id: string
  content_package_id: string | null
  [extra: string]: unknown
}

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
  // ── P7 additions (data-model.md "Modified: ProposalRunLog") — additive,
  // all optional so pre-P7 fixtures/log literals built without them still
  // type-check; the backend defaults them the same way. ──────────────────
  /** The run's base typed World (typed-world path only); absent/`null` for
   * legacy world_snapshot-only runs (recompute 422s on those — FR-006). */
  world?: World | null
  /** Prior decision points, EXCLUDING the current head (`opportunity`),
   * oldest → newest (FR-004/SC-002). */
  opportunity_history?: ProposalOpportunity[]
  setup_snapshot_history?: SetupSnapshot[]
  /** Frozen per-run (FR-011). Defaults to 'interactive' on pre-P7 runs. */
  mode?: ProposalRunMode
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

/** A catalog song (subset the content panel needs — track id → display name).
 * The track id/name live under `spotify_track` (mirrors the Song schema). */
export type CatalogSong = { spotify_track: { id: string; name: string } }

/** Read-only full song catalog for a dataset (used to resolve item_id → name). */
export async function getDatasetCatalog(datasetId: string): Promise<{ total: number; songs: CatalogSong[] }> {
  return apiFetch(`/datasets/${encodeURIComponent(datasetId)}/catalog`, { method: 'GET' })
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

// ── Field overrides (shared type — used by P7 recompute; contrast clones,
// the other former consumer, were removed) ──────────────────────────────────

export type FieldOverride = { path: string; value: unknown }
export type FieldDiff = { path: string; before: unknown; after: unknown }

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
  /** feature 018 — which committed preset (if any) the world/overrides came
   * from; frozen into `SetupSnapshot.origin.origin_preset_id`. */
  origin_preset_id?: string | null
  /** feature 018 — the selected preset's isolated per-selector config
   * deltas; `.service` is merged over the resolved service hyperparameters
   * before STEP 1 (and `.content` before the inline STEP-2 dispatch, for a
   * `quick_check` run). Null/absent when no preset is selected or it has none. */
  algorithm_config_overrides?: AlgorithmConfigOverrides
  service_package_id: string
  content_package_id: string
  mode?: ProposalRunMode
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
  overrides: {
    parameters?: Record<string, unknown>
    hyperparameters?: Record<string, unknown>
    /** feature 018 — the selected preset's isolated content-selector config
     * delta (`.service` is irrelevant at this step — there is no service
     * dispatch in select-service). Omitted (not sent as an explicit `null`)
     * when undefined, so a caller that never passes this keeps sending the
     * exact same request body as before feature 018 (byte-for-byte). */
    algorithm_config_overrides?: AlgorithmConfigOverrides
  } = {},
): Promise<ProposalRunLog> {
  const body: Record<string, unknown> = {
    selected_service_id: serviceId,
    parameters: overrides.parameters ?? {},
    hyperparameters: overrides.hyperparameters ?? {},
  }
  if (overrides.algorithm_config_overrides !== undefined) {
    body.algorithm_config_overrides = overrides.algorithm_config_overrides
  }
  return apiFetch(`/runs/${encodeURIComponent(runId)}/select-service`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// ── POST /api/proposal/runs/{run_id}/recompute (P7 Unit F T033, contracts/recompute-api.md) ─

/** Optional per-recompute setup overrides (contracts/recompute-api.md). Every
 * field defaults to `{}` (falls back to the current head's frozen params, or
 * — for the `content_*` fields — the content package's manifest defaults,
 * used only when the run's `mode` is `quick_check`). */
export type RecomputeOpts = {
  parameters?: Record<string, unknown>
  hyperparameters?: Record<string, unknown>
  content_parameters?: Record<string, unknown>
  content_hyperparameters?: Record<string, unknown>
}

/**
 * Recompute the proposal for an existing run at its CURRENT lifecycle stage
 * and motion, applying explicit reviewer overrides (`FieldOverride[]` — may
 * be empty for a pure stage recompute). DISPLAY-ONLY: this never decides
 * anything itself — it POSTs
 * and returns whatever `ProposalRunLog` the backend computed and appended
 * (a fresh head opportunity/setup_snapshot, the prior head pushed into
 * history, and the new events/evidence — contracts/recompute-api.md).
 */
export async function recompute(
  runId: string,
  overrides: FieldOverride[],
  opts: RecomputeOpts = {},
): Promise<ProposalRunLog> {
  return apiFetch(`/runs/${encodeURIComponent(runId)}/recompute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      overrides,
      parameters: opts.parameters ?? {},
      hyperparameters: opts.hyperparameters ?? {},
      content_parameters: opts.content_parameters ?? {},
      content_hyperparameters: opts.content_hyperparameters ?? {},
    }),
  })
}

// ── POST /api/proposal/runs/{run_id}/journey/action (P4 T031) ──────────────

/** Journey action kinds surfaced in the run-area action bar (US5). The
 * backend accepts a few additional rest-lifecycle actions
 * (`rest_spot_arrived`/`rest_started`/`rest_completed`) not exposed as
 * buttons here (spec P4 assumption: automatic post-rest supply is P7) — kept
 * as a plain `string` param below so the client stays forward-compatible. */
export type JourneyActionType =
  | 'accept'
  | 'reject'
  | 'postpone'
  | 'choose_another'
  | 'request_more'
  | 'complete'
  | 'continue'
  | 'stop'
  | 'motion_change'
  | 'rest_spot_arrived'
  | 'rest_started'
  | 'rest_completed'

export async function journeyAction(
  runId: string,
  actionType: string,
  payload: Record<string, unknown> = {},
): Promise<ProposalRunLog> {
  return apiFetch(`/runs/${encodeURIComponent(runId)}/journey/action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action_type: actionType, payload }),
  })
}

// ── GET /api/proposal/runs/{run_id}/journey/preview (P4 T031) ───────────────

export type JourneyPreviewStep = { label: string; lifecycle_stage: string; note: string | null }

export type JourneyPreviewResponse = { binding: boolean; steps: JourneyPreviewStep[] }

export async function journeyPreview(runId: string): Promise<JourneyPreviewResponse> {
  return apiFetch(`/runs/${encodeURIComponent(runId)}/journey/preview`, { method: 'GET' })
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

// ── Presets (feature 018) — committed, read-only test-case worlds ──────────
//
// Mirrors `app/api/aica_api/models/proposal/preset.py` /
// `specs/018-proposal-preset-testcases/{data-model.md,contracts/preset_endpoints.md}`.
// A preset binds a full `World` (like a seed) with a bilingual brief and a
// machine-checkable `ExpectationContract`, plus optional isolated
// `algorithm_config_overrides`. Read-only — no mutation endpoints (FR-018).

export type PresetFamily =
  | 'mood_coherence'
  | 'driver_state'
  | 'oshi_personalization'
  | 'genre_usage'
  | 'route_genre'
  | 'era_age'
  | 'passenger_genre'
  | 'singability_service'
  | 'history_mechanics'
  | 'baseline'
  | 'combo'

/** Lightweight projection returned by `GET /api/proposal/presets` (avoids
 * shipping full worlds in the list) — enough to render the picker + the
 * on-selection brief blurb without a second fetch. */
export type PresetSummary = {
  preset_id: string
  label: BilingualLabel
  brief: BilingualLabel
  family: PresetFamily
  contrast_with: string | null
  hypothesis: string
}

export type ArousalBandValue = 'high' | 'mid' | 'low'

/** A predicate on the top candidate; at least one field is set (generator/
 * schema invariant — not re-checked client-side). */
export type ExpectedTop = {
  track_id?: string | null
  genre?: string | null
  arousal_band?: ArousalBandValue | null
  must_be_oshi?: boolean
}

export type ExpectationGradient = 'arousal_up_implies_fit_up' | 'arousal_down_implies_fit_up' | 'none'

export type ExpectationContract = {
  hypothesis: string
  expected_top: ExpectedTop
  top_fit_min: number
  gradient: ExpectationGradient
  should_rank_below?: ExpectedTop[]
  expected_service: { top_should_be_in: string[] }
  override_required: boolean
}

/** Isolated per-preset config deltas merged over the package defaults at
 * dispatch (`merge_algorithm_config`, backend). Null when unused. */
export type AlgorithmConfigOverrides = {
  content: Record<string, unknown> | null
  service: Record<string, unknown> | null
} | null

/** The full committed preset (`GET /api/proposal/presets/{id}`). */
export type Preset = {
  preset_id: string
  schema_version: string
  label: BilingualLabel
  brief: BilingualLabel
  family: PresetFamily
  contrast_with: string | null
  world: World
  algorithm_config_overrides: AlgorithmConfigOverrides
  expectation: ExpectationContract
}

export async function getPresets(): Promise<{ presets: PresetSummary[] }> {
  return apiFetch('/presets', { method: 'GET' })
}

export async function getPreset(presetId: string): Promise<Preset> {
  return apiFetch(`/presets/${encodeURIComponent(presetId)}`, { method: 'GET' })
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
