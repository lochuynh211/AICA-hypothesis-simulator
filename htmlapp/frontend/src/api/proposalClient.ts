/**
 * proposalClient — htmlapp re-implementation of `app/frontend/src/api/proposalClient.ts`
 * (1,166 LOC, "the reference") over the worker RPC seam (feature 026, htmlapp
 * Combined export, slice C5 Task 2). Same convention `./mergedClient.ts`
 * (Task 1) established: a re-implementation, NOT a sync of the reference —
 * every exported TYPE is ported for compile-contract fidelity (see "Types"
 * below), but only the value exports the synced Combined surface actually
 * calls get a real body; everything else is either omitted (nothing imports
 * it) or made to fail loudly (imported but genuinely unbacked offline).
 *
 * ── Value exports — measured, not guessed (see this task's own report for
 * the exact commands) ───────────────────────────────────────────────────────
 * The synced tree (`components/merged/*`, `components/review/*`,
 * `components/proposal/panels/sections/*` + their siblings pulled in
 * transitively, `lib/review/chains.ts`, `state/proposalStore.ts`,
 * `state/mergedCoordinator.tsx`, `replay/mergedReplaySource.ts` — every file
 * reachable from `components/merged/MergedShell.tsx` +
 * `state/mergedCoordinator.tsx`, the Combined entry points) imports exactly
 * ELEVEN value exports from this module, all real:
 *   - `getPackages`            -> `proposal.packages.list`
 *   - `getPreset`              -> `proposal.presets.get`
 *   - `getPresets`             -> `proposal.presets.list`
 *   - `getCatalog`             -> `proposal.catalog.get` (paged)
 *   - `getDatasetCatalog`      -> `proposal.catalog.get` (unpaged — same op)
 *   - `explain`                -> `proposal.runs.explain` (feature 026, slice
 *     C5 Task 2b — see "The explain() gap, closed" below)
 *   - `explainInline`          -> `merged.explain`
 *   - `explainTrigger`         -> `merged.explainTrigger`
 *   - `pickRationale`          -> pure function, ported verbatim (no I/O)
 *   - `SERVICE_ID_OPTIONS`     -> static const, ported verbatim
 *   - `GENRE_VOCABULARY`       -> static const, ported verbatim
 *
 * Every other value export the reference has (`getMatrix`, `getSeeds`/
 * `getSeed`, `getDatasets`, `listProfiles`/`getProfile`/`saveProfile`/
 * `deleteProfile`, `validateWorld`, `createRun`, `selectService`,
 * `recompute`, `journeyAction`, `journeyPreview`, `listRuns`, `getRun`,
 * `deleteRun`) is OMITTED — confirmed, not assumed, that nothing in the
 * synced tree imports any of them (this task's own report has the grep).
 * Omitting is safe per this slice's own brief: "omitting them is fine if
 * nothing imports them."
 *
 * ── The explain() gap, closed (feature 026, htmlapp Combined export, slice
 * C5 Task 2b) ────────────────────────────────────────────────────────────
 * `useExplanation.ts` (synced verbatim in Task 3) imports THREE explain
 * functions, not two: `explain`, `explainInline`, `explainTrigger` — and
 * calls whichever of the three applies via its own `step`/`inlineProposal`
 * branch (see that file's `generate()`). `explainInline`/`explainTrigger`
 * are routed to C4 Task 8's `merged.explain`/`merged.explainTrigger` ops.
 * `explain(runId, ...)` — the RUN-ID-addressed sibling — mirrors `POST
 * /api/proposal/runs/{run_id}/explain` (`routers/proposal.py#explain_run`,
 * line 2270).
 *
 * Earlier task docs (C4a Task 7's own module doc, `../engine/proposal/
 * orchestrator/explain.ts`; C4a Task 8's boundary audit,
 * `.superpowers/sdd/2026-08-02-htmlapp-combined-c4a-proposal-orchestration/
 * task-8-report.md`) recorded `explain_run` as deliberately NOT ported
 * ("Port function bodies, not HTTP handlers") — accurate at the time, since
 * Task 2 (this file's first cut) shipped `explain()` THROWING
 * `ExplainByRunIdUnsupportedError` unconditionally rather than faking a
 * response. That gap turned out to be on the ORDINARY (non-"inspect")
 * Combined explain path, not a rarely-hit corner: `useExplanation.ts`'s
 * `generate()` calls `explain()` whenever `inlineProposal` is unset, which
 * `MergedProposalPanel.tsx` sets to `undefined` for the LIVE (non-"inspect")
 * service/content panel — `explanationInlineProposal = isInspecting ?
 * inspectedProposal : undefined`. Task 2b closed it: `explain()` now routes
 * to a real op, `proposal.runs.explain`
 * (`../engine/worker/handlers/proposal.ts#proposalRunsExplain`), which
 * `getRun`s the run, 404s if missing (mirroring `explain_run`'s own
 * `HTTPException(404, f"Proposal run {run_id!r} not found")` byte-for-byte),
 * and delegates to the ALREADY-PORTED `explainFromRunLog`
 * (`../engine/proposal/orchestrator/explain.ts`, C4a Task 7) with
 * `persist_run_id` set to the run's own id — the one behavioral difference
 * from `explainInline`'s `null`, see that function's own doc comment.
 * `ExplainByRunIdUnsupportedError` is gone (nothing else threw or caught
 * it — confirmed by grep, see this task's own report).
 *
 * ── Types ────────────────────────────────────────────────────────────────
 * Every type below is ported to be STRUCTURALLY IDENTICAL to the reference's
 * own declaration (verified line-by-line against `app/frontend/src/api/
 * proposalClient.ts` — see this task's report) because `World`/`Situation`/
 * `DriverProfile`/etc. are imported as whole composite types by five synced
 * files (`state/proposalStore.ts`'s ~700-line reducer chief among them) —
 * nothing in this port's own engine layer defines a richer shape than
 * `Record<string, unknown>` for any of them (`engine/proposal/run_manager.ts
 * #World`, `engine/proposal/world_overrides.ts#WorldDoc`), so a partial or
 * hand-reduced re-derivation here would risk silently breaking Task 3's
 * verbatim sync on some reducer-touched field this file's own author
 * couldn't fully audit without reading that whole reducer. Porting the
 * complete, self-contained type graph is the only way to GUARANTEE the
 * compile contract without that audit — this is the compile CONTRACT, not
 * the reference's runtime implementation (its `apiFetch`, or the 15+ value
 * exports this file omits): no logic is copied, only shapes.
 *
 * ISOLATION preserved from the reference: this module imports nothing from
 * the trigger `api/client.ts`/`api/types.ts`, and (htmlapp-specific) nothing
 * from `app/frontend` — only `./transport` + `./rpc`, exactly like
 * `./mergedClient.ts`.
 */
import { transport } from './transport'
import { unwrap, type RpcRequest, type RpcResponse } from './rpc'

// ── Internal helper (mirrors api/client.ts's / mergedClient.ts's own call<T>) ──
async function call<T>(op: RpcRequest['op'], params?: unknown): Promise<T> {
  return unwrap<T>(await transport.call({ op, params }) as RpcResponse<T>)
}

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

// ── GET /api/proposal/packages -> proposal.packages.list ────────────────────

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

/**
 * NOTE (disclosed, not fixed here — out of this task's file list): the
 * engine-layer projection behind `proposal.packages.list`
 * (`engine/proposal/stores.ts#toProposalSummary`) does not copy the
 * manifest's `version`/`contract_version` fields into its own
 * `ProposalPackageSummary`, even though it validates both exist on the raw
 * manifest. Every field this type declares IS present on the real backend
 * contract (and on the raw manifest data offline); `version`/
 * `contract_version` are simply `undefined` at runtime here until that
 * engine-layer gap is fixed. Confirmed (see this task's report) that no
 * file in the synced Combined tree reads `.version`/`.contract_version` off
 * a `ProposalPackageSummary` today, so this is latent, not a regression.
 */
export async function getPackages(): Promise<ProposalPackagesResponse> {
  return call('proposal.packages.list')
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

/**
 * A candidate that was scored but did not make the plan (B2, feature 023 —
 * mirrors backend `content_output.py`'s `ScoredTailItem`). Carries the same
 * contribution chain as an `OrderedItem` so a reviewer can ask why it lost.
 * Ineligible candidates are NOT here — they stay in `excluded_items`.
 */
export type ScoredTailItem = {
  item_id: string
  rank: number
  item_fit: number
  feature_contributions: ItemFeatureContribution[]
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
  // B2 (feature 023) — the scored-but-unpicked tail, capped. Optional (with
  // backend defaults of `[]`/`null`/`false`) so pre-B2 fixtures/log literals
  // built without them still type-check.
  scored_tail?: ScoredTailItem[]
  cut_margin?: number | null
  tail_truncated?: boolean
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
// `World` object built here round-trips through the real backend contract
// unchanged. See `specs/014-proposal-p3-editable-world/`
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

/**
 * One driver-registered favourite ("oshi") artist plus the driver's own
 * 熱狂度 (enthusiasm) for that specific artist (feature 025 slice S4).
 *
 * Replaces the old single `oshi_id`/`oshi_type` pair on `DriverProfile`: a
 * driver may register MULTIPLE oshi artists, each independently intense.
 * Mirrors the backend `OshiArtist` Pydantic model
 * (`app/api/aica_api/models/proposal/world.py`) verbatim — `enthusiasm` must
 * stay on the UI's own 0.0-1.0-step-0.1 grid, since the backend rejects
 * anything off-grid.
 */
export type OshiArtist = { artist_id: string; oshi_type: OshiTypeValue; enthusiasm: number }

export type DriverProfile = {
  // Oshi information
  oshi_registered: boolean
  oshi_mode: OshiModeValue
  // Replaces the old single oshi_id/oshi_type pair (feature 025 slice S4 —
  // hard migration, no compat shim): a driver may register several oshi
  // artists, each with its own 熱狂度 (see OshiArtist.enthusiasm).
  oshi_artists: OshiArtist[]
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

export type ProfileSummary = { profile_id: string; label: BilingualLabel; builtin: boolean }

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

// ── GET /api/proposal/datasets/{id}/catalog -> proposal.catalog.get ─────────

export async function getCatalog(
  datasetId: string,
  offset = 0,
  limit?: number,
): Promise<{ provenance: DatasetProvenance; total: number; songs: CatalogSongSummary[] }> {
  return call('proposal.catalog.get', { datasetId, offset, limit })
}

/** A catalog song (subset the content panel needs — track id → display name).
 * The track id/name/artists live under `spotify_track` (mirrors the Song
 * schema; `artists` is optional/nullable exactly as the backend
 * `SpotifyTrack.artists: list[ArtistRef] | None`). */
export type CatalogSong = {
  spotify_track: { id: string; name: string; artists?: { id: string; name: string }[] | null }
}

/** Read-only full song catalog for a dataset (used to resolve item_id → name).
 * Same op as `getCatalog` — no `offset`/`limit` sent, matching the reference's
 * own unpaged `apiFetch` call (server/engine defaults to the whole catalog). */
export async function getDatasetCatalog(datasetId: string): Promise<{ total: number; songs: CatalogSong[] }> {
  return call('proposal.catalog.get', { datasetId })
}

// ── POST /api/proposal/runs/{run_id}/explain (feature 019 — LLM rationale) ──

/** Which decision the explanation is for. Mirrors the evidence `step` union.
 * `'trigger'` (feature 025, slice S7) is the odd one out: it has no
 * `ProposalRunLog` evidence entry to key off — see `explainTrigger` below. */
export type ExplainStep = 'service' | 'content' | 'trigger'
export type ExplainProvider = 'backend' | 'browser'

/** Provider accepted by `explainTrigger` ONLY (feature 025, slice S11) — adds
 * `'template'` alongside the shared `ExplainProvider`. Trigger is the one
 * review step with no rationale baked into its own evidence, so when the
 * reviewer's explanation provider is 'off' there is nothing to fall back to
 * on that tab; `'template'` reaches the backend's deterministic sentence
 * directly, without asking for an LLM generation. The service/content explain
 * endpoints (`explain`/`explainInline`) do NOT accept it — they already have
 * a baked rationale to show when 'off', so `useExplanation` never fetches for
 * them in that case at all. */
export type ExplainTriggerProvider = ExplainProvider | 'template'

/** One chat message in the grounded prompt (mirrors backend `ExplainMessage`). */
export type ExplainMessage = { role: 'system' | 'user'; content: string }

/** The server-built, provider-agnostic prompt (mirrors `ExplanationPrompt`). */
export type ExplanationPrompt = { messages: ExplainMessage[]; grounding: Record<string, unknown> }

/** Response of the explain endpoint (mirrors backend `ExplainResponse`).
 * For `provider: 'browser'`, `rationale` is empty and the client runs `prompt`
 * through Gemini Nano; for `provider: 'backend'`, `rationale` is the generated
 * (or template-fallback) positional `[ja, en]` pair. */
export type ExplainResponse = {
  step: ExplainStep
  target_id: string
  // 'template' (feature 025, slice S11) only ever appears here for `step:
  // 'trigger'` responses — see `ExplainTriggerProvider`.
  requested_provider: ExplainProvider | 'template'
  rationale: string[]
  provider_used: 'backend' | 'browser' | 'template'
  model: string
  fell_back: boolean
  error: string | null
  prompt: ExplanationPrompt
}

/**
 * Run-id-addressed explain (feature 026, htmlapp Combined export, slice C5
 * Task 2b — see this file's own module doc, "The `explain()` gap, closed").
 * Routes to Task 2b's `proposal.runs.explain` op — the offline mirror of
 * `POST /api/proposal/runs/{run_id}/explain` (`routers/proposal.py#
 * explain_run`) — and returns the SAME `ExplainResponse` shape as
 * `explainInline`/`explainTrigger`.
 *
 * UNLIKE `explainInline`, the backing op PERSISTS the generated explanation
 * onto the run's own append-only log (mirrors `explain_run`'s
 * `persist_run_id=run_id`, vs. `merged_explain_endpoint`'s
 * `persist_run_id=None`) — a real behavioral difference, not a copy/paste
 * of the inline sibling; see `../engine/proposal/orchestrator/explain.ts#
 * explainFromRunLog`'s own doc for why both call sites exist. */
export async function explain(
  runId: string,
  args: { step: ExplainStep; targetId: string; provider: ExplainProvider },
): Promise<ExplainResponse> {
  return call('proposal.runs.explain', {
    runId,
    body: { step: args.step, target_id: args.targetId, provider: args.provider },
  })
}

/** Inline explain for an EPHEMERAL proposal (feature 020 — the Combined
 * Simulator's quickview / after-nap projections are built with `cache={}` and
 * never persisted, so the run-id endpoint would 404 even in the docker app).
 * Routes to C4 Task 8's `merged.explain` op — the offline mirror of
 * `POST /api/merged-runs/explain` — and returns the SAME `ExplainResponse`
 * shape as `explain`. */
export async function explainInline(
  proposal: ProposalRunLog,
  args: { step: ExplainStep; targetId: string; provider: ExplainProvider },
): Promise<ExplainResponse> {
  return call('merged.explain', {
    proposal: proposal as unknown as Record<string, unknown>,
    step: args.step,
    target_id: args.targetId,
    provider: args.provider,
  })
}

/** Explain for the TRIGGER rank-1 decision (feature 025, slice S7). Trigger
 * evidence lives on `MergedInstantResult.fires` (`MergedFirePoint`), never in
 * a `ProposalRunLog` — there is no run-id endpoint to address the way
 * `explain()` does, so the caller (already holding the fire it wants
 * explained) posts it back inline. Routes to C4 Task 8's `merged.explainTrigger`
 * op — the offline mirror of `POST /api/merged-runs/explain-trigger`.
 *
 * `fire` is intentionally untyped (`Record<string, unknown>`), not the
 * trigger-side `FirePoint`/`MergedFirePoint` — this module's own docstring
 * forbids importing anything from `api/types.ts`. `category` omitted/`null`
 * lets the backend default to the fire's own fired category. */
export async function explainTrigger(
  fire: Record<string, unknown>,
  args: { category?: string | null; provider: ExplainTriggerProvider },
): Promise<ExplainResponse> {
  return call('merged.explainTrigger', {
    fire,
    category: args.category ?? null,
    provider: args.provider,
  })
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
  | 'journey'

/** Top-level grouping shown in the preset picker — the three content-scoring
 * categories plus the baseline control (mirrors backend `PresetCategory`). */
export type PresetCategory = 'situation' | 'preference' | 'history' | 'baseline'

/** Timeline linkage — presets sharing a journey `id` form an ordered,
 * same-driver sequence of driving stages (e.g. drive → rest → resume).
 * Mirrors backend `PresetJourney`. */
export type PresetJourney = { id: string; step: number; of: number; label: BilingualLabel }

/** Lightweight projection returned by `GET /api/proposal/presets` (avoids
 * shipping full worlds in the list) — enough to render the picker + the
 * on-selection brief blurb without a second fetch. Carries `category`/
 * `journey` so the picker can group and order presets. */
export type PresetSummary = {
  preset_id: string
  label: BilingualLabel
  brief: BilingualLabel
  category: PresetCategory
  family: PresetFamily
  journey: PresetJourney | null
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
  category: PresetCategory
  family: PresetFamily
  journey: PresetJourney | null
  contrast_with: string | null
  world: World
  algorithm_config_overrides: AlgorithmConfigOverrides
  expectation: ExpectationContract
}

export async function getPresets(): Promise<{ presets: PresetSummary[] }> {
  return call('proposal.presets.list')
}

export async function getPreset(presetId: string): Promise<Preset> {
  return call('proposal.presets.get', { presetId })
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
