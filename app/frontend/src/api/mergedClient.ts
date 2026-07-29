/**
 * mergedClient — API client for the Combined Simulator's merged-run endpoints
 * (feature 020, Task 7). Mirrors `client.ts`'s `apiFetch` exactly (bare
 * `fetch` to an already-absolute `/api/...` path, throw an `Error` carrying a
 * bilingual `.bilingual` pair on a non-ok response) rather than
 * `proposalClient.ts`'s body-detail-parsing variant — the merged-runs router
 * (`routers/merged_runs.py`) is a thin seam over the existing trigger/proposal
 * handlers, not the Proposal Simulator's own API surface.
 *
 * Deliberately depends only on `./types` (trigger side) and `./proposalClient`
 * (proposal side, for `World`/`ProposalRunLog`) — never on `state/runStore` or
 * `state/proposalStore` (feature-020 isolation constraint; see CLAUDE.md).
 */
import type { DecisionResult, AlgorithmError, RestSpot, RunState, FirePoint, InstantResult, PreviewRestOption, RunLog } from './types'
import type { World, ProposalRunLog } from './proposalClient'
import type { BilingualLabel } from '../i18n/t'

// ── Internal helper (mirrors api/client.ts's apiFetch) ──────────────────────

/**
 * A generic HTTP-status failure. Carries a bilingual `.bilingual` pair
 * (mirrors `api/client.ts`'s `apiError`) so a caller with the active UI
 * language can resolve a JA/EN-appropriate message via `t()` instead of
 * showing the raw English `.message` verbatim.
 */
function apiError(status: number): Error & { bilingual: BilingualLabel } {
  return Object.assign(new Error(`API error: ${status}`), {
    bilingual: { ja: `API エラー（${status}）`, en: `API error (${status})` },
  })
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, init)
  if (!response.ok) {
    throw apiError(response.status)
  }
  return response.json() as Promise<T>
}

// ── Shapes ───────────────────────────────────────────────────────────────

/** Request body for `POST /api/merged-runs` (mirrors `CreateMergedRunBody`). */
export type CreateMergedRunReq = {
  trigger_plan_id: string
  world: World
  service_package_id: string
  content_package_id: string
  /** Frozen per-run proposal mode; defaults server-side to 'interactive'. */
  proposal_mode?: string
  run_seed: string
  /** Optional service/content package param+hyperparam overrides (owner review). */
  service_parameters?: Record<string, unknown>
  service_hyperparameters?: Record<string, unknown>
  content_parameters?: Record<string, unknown>
  content_hyperparameters?: Record<string, unknown>
}

/** Request body for `POST /api/merged-runs/{id}/proposal-action`
 * (mirrors `MergedProposalActionBody`). */
export type MergedProposalActionReq =
  | { kind: 'select_service'; selected_service_id: string }
  | { kind: 'journey_action'; action_type: string; payload?: Record<string, unknown> }

/**
 * The `trigger` field of a `MergedTickResponse` — mirrors the dict built by
 * `routers/merged_runs.py`'s `_serialize_trigger_tick` (itself mirroring the
 * field extraction `routers/runs.py`'s tick endpoint / `TickResponseSuccess`
 * use), unified into one shape rather than a discriminated union since the
 * merged tick endpoint never raises a blocking 500 on an algorithm error —
 * it always returns `decision`/`error` side by side.
 */
export type MergedTriggerTick = {
  decision: DecisionResult | null
  error: AlgorithmError | null
  paused: boolean
  completed: boolean
  tick_index: number | null
  route_fraction?: number | null
  distance_km?: number | null
  speed_kph?: number | null
  motion_state?: string | null
  recovery_phase?: string | null
  is_traffic_jam?: boolean | null
  segment_type?: string | null
  /** Set only when a fire's auto-created proposal run failed synchronously
   * (slice-1 `create_proposal_run` HTTPException path) — the tick itself
   * still succeeds so the trigger side is never disguised as failed. */
  proposal_error?: string
}

/** Links one trigger tick to the proposal run/events it produced (mirrors
 * `models/merged_run.py`'s `CorrelationEntry`). */
export type CorrelationEntry = {
  trigger_tick_index: number
  proposal_run_id: string
  proposal_event_ids: string[]
}

/** Response for `POST /api/merged-runs/{id}/tick` (mirrors `MergedTickResponse`). */
export type MergedTickResponse = {
  trigger: MergedTriggerTick
  /** Present only when this tick's trigger fire created/updated a proposal run. */
  proposal: ProposalRunLog | null
  correlation: CorrelationEntry | null
}

/** Request body for `POST /api/merged-runs/{id}/accept-rest` (mirrors
 * `AcceptRestBody` — slice-2 core Task 4). `nap_minutes`, when supplied,
 * overrides the chosen recovery option's nap-stage duration server-side. */
export type AcceptRestReq = {
  recovery_option_id: string
  rest_spot: RestSpot
  nap_minutes: number | null
}

/** Request body for `POST /api/merged-runs/plan` (mirrors
 * `CreateMergedPlanBody` — Slice-2b Task 2). Builds a "painted" trigger
 * run-plan draft (an ad-hoc `mountain_road` segment and/or a manually
 * positioned traffic jam spliced onto the resolved route) and registers it
 * in the SAME draft registry `POST /api/run-plans` populates, so the
 * returned `plan_id` feeds into `createMergedRun`'s `trigger_plan_id`
 * unchanged. `mountain_range_km`/`jam_range_km` are `[start_km, end_km]`
 * pairs over the route's 0..total-km axis; omit (or pass `null`) either to
 * skip that paint. */
export type BuildMergedPlanReq = {
  package_id: string
  scenario_id: string
  route_preset_id: string | null
  run_seed: number
  mountain_range_km: [number, number] | null
  jam_range_km: [number, number] | null
  jam_speed_kph?: number
  presets?: Record<string, unknown>
  parameters?: Record<string, unknown>
  hyperparameters?: Record<string, unknown>
  /** Trigger-side situation edits (feature 020 exact-reuse redesign) so a
   * PAINTED run still respects the fixed-conditions / speed / initial-signal
   * edits made in the Combined Situation editor — threaded into the same
   * `create_draft` the run-plans router uses. Omit when unedited. */
  profiles?: Record<string, unknown>
  initial_state?: Record<string, unknown>
  context_overrides?: Record<string, unknown>
}

// ── Quickview projection — feature 020, Slice-2c (Task 5) ──────────────────

/** One trigger fire (rising edge), projected through a default, non-persisting
 * quick-check proposal (mirrors `models/merged_run.py`'s `MergedFirePoint`,
 * itself extending the trigger-side `FirePoint`). `proposal` is a
 * `ProposalRunLog` when `create_proposal_run(..., cache={})` succeeded for
 * this fire, else `null` with `proposal_error` set to the caught detail —
 * never both set. */
export type MergedFirePoint = FirePoint & {
  proposal: ProposalRunLog | null
  proposal_error: string | null
}

/** A projected auto-accepted rest, extended (feature 020 — clickable journey
 * dots) with the AFTER-REST proposal built from the recovered driver state
 * (quick_check → both service+content). Mirrors `models/merged_run.py`'s
 * `MergedRestOption`; `after_rest_proposal` is a `ProposalRunLog` when the
 * projection succeeded, else `null` with `after_rest_proposal_error` set —
 * never both. */
export type MergedRestOption = PreviewRestOption & {
  after_rest_proposal: ProposalRunLog | null
  after_rest_proposal_error: string | null
}

/** Ephemeral, non-persisting projection of the WHOLE merged chain (mirrors
 * `models/merged_run.py`'s `MergedInstantResult`) — same shape as the
 * trigger-only `InstantResult` except `fires` carries a `MergedFirePoint`
 * (with the projected proposal) per entry instead of a bare `FirePoint`, and
 * `rest_options` carries a `MergedRestOption` (with the after-rest proposal).
 * The singular back-compat `fire` field (first entry, unaugmented) stays a
 * plain `FirePoint` on purpose, mirroring the backend model. */
export type MergedInstantResult = Omit<InstantResult, 'fires' | 'rest_options'> & {
  fires: MergedFirePoint[]
  rest_options?: MergedRestOption[]
}

/** Request body for `POST /api/merged-runs/quickview` (mirrors
 * `MergedQuickviewBody`). Trigger-side fields mirror
 * `aica_api.routers.runs.PreviewRunBody`; `route_preset_id`/
 * `mountain_range_km`/`jam_range_km`/`jam_speed_kph` mirror
 * `BuildMergedPlanReq` (an ad-hoc "painted" route, applied before the preview
 * tick loop runs). `world`/`service_package_id`/`content_package_id`/
 * `run_seed_proposal` select and seed the proposal side projected per fire. */
export type MergedQuickviewReq = {
  package_id: string
  scenario_id: string
  route_preset_id?: string | null
  run_seed: number
  mountain_range_km?: [number, number] | null
  jam_range_km?: [number, number] | null
  jam_speed_kph?: number
  hyperparameter_overrides?: Record<string, unknown>
  rest_option_id?: string | null
  context_overrides?: Record<string, unknown> | null
  initial_state?: Record<string, unknown> | null
  profiles?: Record<string, unknown> | null
  tick_seconds?: number | null
  world: World
  service_package_id: string
  content_package_id: string
  run_seed_proposal: string
  service_parameters?: Record<string, unknown>
  service_hyperparameters?: Record<string, unknown>
  content_parameters?: Record<string, unknown>
  content_hyperparameters?: Record<string, unknown>
}

// ── Endpoints ────────────────────────────────────────────────────────────

export async function createMergedRun(
  body: CreateMergedRunReq,
): Promise<{ merged_run_id: string; trigger_run_id: string }> {
  return apiFetch('/api/merged-runs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function tickMergedRun(mergedRunId: string): Promise<MergedTickResponse> {
  return apiFetch(`/api/merged-runs/${encodeURIComponent(mergedRunId)}/tick`, {
    method: 'POST',
  })
}

export async function mergedProposalAction(
  mergedRunId: string,
  body: MergedProposalActionReq,
): Promise<ProposalRunLog> {
  return apiFetch(`/api/merged-runs/${encodeURIComponent(mergedRunId)}/proposal-action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** Starts the trigger-side recovery sequence for a merged run's REST fire
 * (mirrors `routers/merged_runs.py`'s `accept_rest_endpoint`). Returns the
 * full trigger `RunState` — the SAME shape `GET /api/runs/{id}` returns.
 * After this resolves, the existing tick loop (Play) auto-drives the rest
 * journey server-side (Task 3); no further per-stage action is needed. */
export async function acceptRest(mergedRunId: string, body: AcceptRestReq): Promise<RunState> {
  return apiFetch(`/api/merged-runs/${encodeURIComponent(mergedRunId)}/accept-rest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** Declines a merged run's pending REST proposal (the on-map rest overlay's
 * "reject" button) and keeps ticking — no recovery is started. Mirrors
 * `routers/merged_runs.py`'s `decline_rest_endpoint`; re-arms the fire guard so
 * a later re-fire spawns a fresh proposal. Returns the trigger `RunState`. */
export async function declineRest(mergedRunId: string): Promise<RunState> {
  return apiFetch(`/api/merged-runs/${encodeURIComponent(mergedRunId)}/decline`, {
    method: 'POST',
  })
}

/** Builds a "painted" trigger run-plan (mountain-road segment and/or a
 * positioned traffic jam) and returns its `plan_id` (mirrors
 * `routers/merged_runs.py`'s `create_merged_plan_endpoint`, Slice-2b Task
 * 2). Call this INSTEAD of `client.ts`'s `createRunPlan` whenever the
 * reviewer has painted a mountain/jam range onto the route (`RouteConditionsPainter`,
 * Slice-2b Task 4) — the returned `plan_id` feeds into `createMergedRun`'s
 * `trigger_plan_id` exactly like a plain run-plan's does. */
export async function buildMergedPlan(body: BuildMergedPlanReq): Promise<{ plan_id: string }> {
  return apiFetch('/api/merged-runs/plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** Ephemeral, non-persisting projection of the WHOLE merged chain (mirrors
 * `routers/merged_runs.py`'s `quickview_merged_run_endpoint`, Slice-2c Task
 * 3): one headless trigger preview pass plus a default quick-check proposal
 * attached to every actionable fire. Nothing is written to `runs/`,
 * `proposal_runs/`, or `merged_runs/` — safe to call before (or without ever)
 * creating a real merged run via `createMergedRun`. */
export async function mergedQuickview(body: MergedQuickviewReq): Promise<MergedInstantResult> {
  return apiFetch('/api/merged-runs/quickview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** Request for `POST /api/merged-runs/after-rest-proposal` (mirrors
 * `AfterRestProposalBody`). Re-projects the read-only after-nap inspect panel's
 * proposal from the SAME recovered-driver `world`, forcing content dispatch for
 * `selected_service_id` (the reviewer-chosen service, e.g. full_karaoke). */
export type AfterRestProposalReq = {
  world: World
  service_package_id: string
  content_package_id: string
  run_seed_proposal: string
  selected_service_id?: string | null
  service_parameters?: Record<string, unknown>
  service_hyperparameters?: Record<string, unknown>
}

/** Interactive Choose for the after-nap inspect panel: dispatch content for a
 * reviewer-chosen after-rest service. Stateless / non-persisting (the backend
 * builds it with `cache={}`) — nothing is written to `proposal_runs/`. */
export async function afterRestProposal(body: AfterRestProposalReq): Promise<ProposalRunLog> {
  return apiFetch('/api/merged-runs/after-rest-proposal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// ── Correlation replay — feature 020, Slice-2c (Task 6) ─────────────────────

/** Persisted merged-run record (mirrors `models/merged_run.py`'s
 * `MergedRunHandle.model_dump()`) — the shape `GET /api/merged-runs/{id}`
 * returns under `handle`. */
export type MergedRunHandle = {
  merged_run_id: string
  trigger_run_id: string
  world_template: Record<string, unknown>
  service_package_id: string
  content_package_id: string
  proposal_mode: string
  run_seed: string
  proposal_run_ids: string[]
  current_proposal_run_id: string | null
  correlation_log: CorrelationEntry[]
  rest_stage_synced: string | null
  nap_minutes: number | null
}

/** Response for `GET /api/merged-runs/{id}` (mirrors
 * `routers/merged_runs.py`'s `get_merged_run_endpoint`) — a pure disk-read
 * reassembly for read-only replay: the persisted handle, the raw trigger
 * `RunLog` JSON exactly as stored (`null` only if that file is missing —
 * should not happen for a real merged run), and every paired
 * `ProposalRunLog` in `handle.proposal_run_ids` order. Nothing here is
 * recomputed — no engine, no selector runs. */
export type GetMergedRunResponse = {
  handle: MergedRunHandle
  trigger_log: RunLog | null
  proposal_logs: ProposalRunLog[]
}

/** Summary row for `GET /api/merged-runs` (mirrors
 * `list_merged_runs_endpoint`'s per-file projection). */
export type MergedRunSummary = {
  merged_run_id: string
  trigger_run_id: string | null
  proposal_run_ids_count: number
}

/** Reassembles one persisted merged run for read-only replay (mirrors
 * `routers/merged_runs.py`'s `get_merged_run_endpoint`, Slice-2c Task 4).
 * Pure disk read — never recomputes a decision and never mutates the run.
 * Feeds `replay/mergedReplaySource.ts`'s `createMergedReplaySource`. */
export async function getMergedRun(mergedRunId: string): Promise<GetMergedRunResponse> {
  return apiFetch(`/api/merged-runs/${encodeURIComponent(mergedRunId)}`, { method: 'GET' })
}

/** Lists every persisted merged run's summary (mirrors
 * `list_merged_runs_endpoint`). Unwraps the backend's `{merged_runs: [...]}`
 * envelope so callers receive the array directly. */
export async function listMergedRuns(): Promise<MergedRunSummary[]> {
  const { merged_runs } = await apiFetch<{ merged_runs: MergedRunSummary[] }>('/api/merged-runs', {
    method: 'GET',
  })
  return merged_runs
}

// ── Review feedback — feature 023, Task 16 ──────────────────────────────────

/** Request body for `POST /api/merged-runs/{id}/review-feedback` (mirrors
 * `routers/merged_runs.py`'s `ReviewFeedbackBody`). `review_input` labels are
 * `{judgment: ...}`; `review_decision` labels are `{assessment: ...}` plus
 * the free-form `comment`. `feature_id` only applies to `review_input`. */
export type ReviewFeedbackBody = {
  scope: 'review_input' | 'review_decision'
  case_id: string
  checkpoint_id: string
  stage: string
  review_target: string
  feature_id?: string | null
  labels: Record<string, unknown>
  comment?: string | null
}

/** One recorded review judgement, as returned by the GET endpoint (mirrors
 * `FeedbackEvent.model_dump()` — only the fields this client actually reads
 * are typed; the backend may carry more). */
export type ReviewFeedbackEvent = {
  kind: string
  target: {
    scope: string
    case_id?: string | null
    checkpoint_id?: string | null
    stage?: string | null
    review_target?: string | null
    feature_id?: string | null
  }
  labels: Record<string, unknown>
  comment?: string | null
}

/** One package's id + version, as recorded at export time. */
export type ReviewFeedbackPackageVersion = { id: string | null; version: string | null }

/** Response for `GET /api/merged-runs/{id}/review-feedback` (mirrors
 * `get_review_feedback_endpoint`): every recorded review_input/review_decision
 * judgement for this merged run, plus the trigger/service/content package
 * versions in play — so an export can attribute each judgement to the exact
 * package versions that produced the decision it judges. */
export type ReviewFeedbackExport = {
  events: ReviewFeedbackEvent[]
  package_versions: {
    trigger: ReviewFeedbackPackageVersion
    service: ReviewFeedbackPackageVersion
    content: ReviewFeedbackPackageVersion
  }
}

/** Appends one reviewer judgement (a per-input `review_input` judgement or a
 * decision-level `review_decision` assessment) to the merged run's paired
 * trigger run log (mirrors `post_review_feedback_endpoint`). Append-only —
 * two judgements on the same feature append twice, never replace. Throws on
 * a non-ok response (404 for an unknown merged run) exactly like every other
 * call in this file — callers must NOT swallow that error, since a
 * judgement the reviewer believes was recorded but wasn't is worse than one
 * never offered. */
export async function postReviewFeedback(mergedRunId: string, body: ReviewFeedbackBody): Promise<void> {
  await apiFetch(`/api/merged-runs/${encodeURIComponent(mergedRunId)}/review-feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** Reads back every recorded review judgement for a merged run plus the
 * package versions in play (mirrors `get_review_feedback_endpoint`). Pure
 * disk read — nothing is recomputed. Feeds the export button on
 * `DecisionAssessment`. */
export async function getReviewFeedback(mergedRunId: string): Promise<ReviewFeedbackExport> {
  return apiFetch(`/api/merged-runs/${encodeURIComponent(mergedRunId)}/review-feedback`, {
    method: 'GET',
  })
}
