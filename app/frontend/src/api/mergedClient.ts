/**
 * mergedClient — API client for the Combined Simulator's merged-run endpoints
 * (feature 020, Task 7). Mirrors `client.ts`'s `apiFetch` exactly (bare
 * `fetch` to an already-absolute `/api/...` path, throw a plain `Error` on a
 * non-ok response) rather than `proposalClient.ts`'s body-detail-parsing
 * variant — the merged-runs router (`routers/merged_runs.py`) is a thin seam
 * over the existing trigger/proposal handlers, not the Proposal Simulator's
 * own API surface.
 *
 * Deliberately depends only on `./types` (trigger side) and `./proposalClient`
 * (proposal side, for `World`/`ProposalRunLog`) — never on `state/runStore` or
 * `state/proposalStore` (feature-020 isolation constraint; see CLAUDE.md).
 */
import type { DecisionResult, AlgorithmError, RestSpot, RunState, FirePoint, InstantResult } from './types'
import type { World, ProposalRunLog } from './proposalClient'

// ── Internal helper (mirrors api/client.ts's apiFetch) ──────────────────────

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, init)
  if (!response.ok) {
    throw new Error(`API error: ${response.status}`)
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

/** Ephemeral, non-persisting projection of the WHOLE merged chain (mirrors
 * `models/merged_run.py`'s `MergedInstantResult`) — same shape as the
 * trigger-only `InstantResult` except `fires` carries a `MergedFirePoint`
 * (with the projected proposal) per entry instead of a bare `FirePoint`. The
 * singular back-compat `fire` field (first entry, unaugmented) stays a plain
 * `FirePoint` on purpose, mirroring the backend model. */
export type MergedInstantResult = Omit<InstantResult, 'fires'> & {
  fires: MergedFirePoint[]
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
  world: World
  service_package_id: string
  content_package_id: string
  run_seed_proposal: string
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
