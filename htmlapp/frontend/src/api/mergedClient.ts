/**
 * mergedClient — htmlapp re-implementation of `app/frontend/src/api/mergedClient.ts`
 * (448 LOC, "the reference") over the worker RPC seam (feature 026, htmlapp
 * Combined export, slice C5 Task 1).
 *
 * Every one of the reference's twelve exported functions becomes a THIN call
 * through `call()` (mirrors `api/client.ts`'s own `call<T>` helper) to one of
 * C4 Task 9's fourteen registered `merged.*` ops (`src/engine/worker/router.ts`).
 * ZERO business logic here — see the per-function comments below for the
 * handful of places this file fills in a Pydantic field DEFAULT the
 * reference's own looser request type never asks a caller to supply (e.g.
 * `jam_speed_kph`, `proposal_mode`) before forwarding to the wire body the
 * engine (`src/engine/merged/*`) actually validates; that is request-shaping
 * (the same job `api/client.ts#createRunPlan` already does for its own op),
 * never a decision.
 *
 * Exported names/signatures are byte-identical to the reference's — every
 * synced Combined component (`components/merged/*`, `components/review/*`,
 * `state/mergedCoordinator.tsx`, `lib/review/*`, `replay/mergedReplaySource.ts`)
 * imports this module by those exact names and compiles against them
 * unmodified once C5 Task 3 syncs those files in.
 *
 * ── Where `World`/`ProposalRunLog` come from — UPDATED by C5 Task 2 ────────
 * Originally (Task 1, before `./proposalClient` existed) both types were
 * imported from the engine layer that actually PRODUCES the values flowing
 * over this RPC boundary: `../engine/proposal/run_manager`. Task 2 built
 * `./proposalClient.ts` and re-verified that choice by checking assignability
 * in BOTH directions between `run_manager`'s loose types and
 * `proposalClient`'s rich ones (see that task's own report for the actual
 * `tsc` output):
 *
 *   - `World`: `run_manager.World` is `Record<string, unknown>` — a
 *     concrete object is always assignable TO it, but never FROM it. Only
 *     ever used here in REQUEST positions (`body.world` passed straight
 *     through unread, never destructured — grep confirms), so this
 *     direction was never a problem either way.
 *   - `ProposalRunLog`: genuinely NOT assignable in EITHER direction —
 *     `run_manager`'s version uses bare `string` for
 *     `opportunity.trigger_purpose`/`lifecycle_stage` (not
 *     `proposalClient`'s literal unions) AND carries `setup_snapshot`/
 *     `explanations` as required fields `proposalClient`'s version doesn't
 *     have at all; `proposalClient`'s version marks several `run_manager`-
 *     required fields (`world`, `opportunity_history`,
 *     `setup_snapshot_history`, `mode`, `content_parameters`,
 *     `content_hyperparameters`) optional instead of required. A `tsc`
 *     round-trip proves both `const a: ClientLog = rm` and
 *     `const b: RunManagerLog = cl` fail.
 *
 * Since this file's own `ProposalRunLog`-typed return values (`tickMergedRun`
 * .proposal, `afterRestProposal`, `mergedProposalAction`, `getMergedRun`
 * .proposal_logs, ...) flow directly into Combined components that import
 * `ProposalRunLog` from `proposalClient` (confirmed by measurement — every
 * real caller does, see Task 2's report), keeping the OLD (`run_manager`)
 * source would make those props reject this file's return values at
 * COMPILE time once Task 3 syncs those components in (Direction A above).
 * Sourcing both types from `./proposalClient` instead makes every such prop
 * the exact same nominal type alias as this file's own return type — not
 * merely structurally compatible, IDENTICAL — so the assignability question
 * disappears rather than flipping to the other failing direction. `World`
 * stays safe to source from here too (Direction B, rich-to-loose, already
 * held for the OLD source and continues to hold — `proposalClient.World`
 * is a concrete object, always assignable to a REQUEST parameter). Neither
 * type is re-exported — the reference itself never re-exports `World`, and
 * nothing outside this file imports `ProposalRunLog` from `mergedClient`
 * (every real caller imports it from `proposalClient` directly — confirmed
 * by measurement, see this task's report).
 *
 * `MergedRunHandle`/`CorrelationEntry`/`MergedRunSummary` ARE re-exported
 * (the reference does), and are imported directly from their own engine
 * source-of-truth (`engine/merged/types.ts`, `engine/merged/run_setup.ts`)
 * rather than hand-duplicated — `MergedRunSummary` is already field-for-field
 * identical to the reference's; `MergedRunHandle` there is a strict superset
 * (extra fields the reference's older type predates), which is safe: every
 * reference-declared field is still present and required.
 */
import type {
  DecisionResult,
  AlgorithmError,
  RestSpot,
  RunState,
  FirePoint,
  InstantResult,
  PreviewRestOption,
  RunLog,
} from './types'
import type { World, ProposalRunLog } from './proposalClient'
import { transport } from './transport'
import { unwrap, type RpcRequest, type RpcResponse } from './rpc'

export type { CorrelationEntry, MergedRunHandle } from '../engine/merged/types'
import type { CorrelationEntry, MergedRunHandle } from '../engine/merged/types'
export type { MergedRunSummary } from '../engine/merged/run_setup'
import type { MergedRunSummary } from '../engine/merged/run_setup'

// ── Internal helper (mirrors api/client.ts's call<T>) ───────────────────────
// No custom apiError/.bilingual wrapper: unlike the reference's own apiFetch
// (every non-ok response collapses to a uniform `Error & {bilingual}` with no
// further detail), the real error thrown here is whatever `unwrap()` rebuilds
// from the RpcError the op actually raised — almost always a real
// `ProposalHttpError` with `.status`/`.detail` intact (see `../api/rpc.ts`'s
// `serializeError`/`unwrap`). Verified this does not change caller-visible
// behavior: `state/mergedCoordinator.tsx#resolveErrorMessage` only checks
// `'bilingual' in err`, falling back to a fixed per-action label when absent
// (true both for the reference's own bare `Error` and for a `ProposalHttpError`
// here — neither carries `.bilingual`); every other catch site in the synced
// Combined surface narrows via `e instanceof Error ? e.message : ...`, and
// `ProposalHttpError extends Error`, so `.message` resolves either way. See
// this task's own report for the full grep across the synced-in-later
// Combined surface backing this claim.
async function call<T>(op: RpcRequest['op'], params?: unknown): Promise<T> {
  return unwrap<T>(await transport.call({ op, params }) as RpcResponse<T>)
}

// ── Shapes (byte-identical to the reference's own — see file header) ───────

/** Request body for `createMergedRun` (mirrors the reference's `CreateMergedRunReq`
 * -> wire `CreateMergedRunBody`, `engine/merged/run_setup.ts`). */
export type CreateMergedRunReq = {
  trigger_plan_id: string
  world: World
  service_package_id: string
  content_package_id: string
  /** Frozen per-run proposal mode; defaults to 'interactive' (mirrors the
   * Pydantic field default, `models/merged_run.py`'s `CreateMergedRunBody.
   * proposal_mode: str = "interactive"` — the wire body requires it, so this
   * function fills the default itself when omitted). */
  proposal_mode?: string
  run_seed: string
  /** Optional service/content package param+hyperparam overrides (owner review). */
  service_parameters?: Record<string, unknown>
  service_hyperparameters?: Record<string, unknown>
  content_parameters?: Record<string, unknown>
  content_hyperparameters?: Record<string, unknown>
}

/** Request body for `mergedProposalAction` (mirrors the reference's
 * `MergedProposalActionReq` -> wire `MergedProposalActionBody`, which (unlike
 * this discriminated union) always carries all four fields, the inapplicable
 * ones `null`/`{}` — this function does that normalization). */
export type MergedProposalActionReq =
  | { kind: 'select_service'; selected_service_id: string }
  | { kind: 'journey_action'; action_type: string; payload?: Record<string, unknown> }

/**
 * The `trigger` field of a `MergedTickResponse` (mirrors the reference's own
 * `MergedTriggerTick` field-for-field; the wire type, `engine/merged/types.ts`'s
 * `MergedTickResponse.trigger`, is deliberately loose (`Record<string,
 * unknown>`) — this richer shape is what `engine/merged/tick.ts`'s own
 * `triggerDict` construction actually populates, verified field name by
 * field name against that file).
 */
export type MergedTriggerTick = {
  decision: DecisionResult | null
  error: AlgorithmError | null
  paused: boolean
  completed: boolean
  tick_index: number | null
  /** Elapsed-time clock (fixbug-0806): `elapsed_seconds / 60` at this tick,
   *  the same basis the projection's fire `time_min` uses — so a live fire's
   *  `@ N min` label and the projection's read on one shared clock. */
  time_min?: number | null
  route_fraction?: number | null
  distance_km?: number | null
  speed_kph?: number | null
  motion_state?: string | null
  recovery_phase?: string | null
  is_traffic_jam?: boolean | null
  segment_type?: string | null
  /** Per-tick DRIVER-STATE signals (0-100), the live counterpart of the
   * projection's `signal_series` — what the driver actually did given the
   * reviewer's answers, plotted by the live chart under the projection.
   * Optional: hand-built fixtures predating these fields still typecheck. */
  drowsiness?: number | null
  fatigue?: number | null
  monotony_level?: number | null
  /** Set only when a fire's auto-created proposal run failed synchronously —
   * the tick itself still succeeds so the trigger side is never disguised as
   * failed. */
  proposal_error?: string
}

/** Response for `tickMergedRun` (mirrors the reference's `MergedTickResponse`). */
export type MergedTickResponse = {
  trigger: MergedTriggerTick
  /** Present only when this tick's trigger fire created/updated a proposal run. */
  proposal: ProposalRunLog | null
  correlation: CorrelationEntry | null
}

/** Request body for `acceptRest` (mirrors the reference's `AcceptRestReq` ->
 * wire `AcceptRestBody`, `engine/merged/types.ts`). `nap_minutes`, when
 * supplied, overrides the chosen recovery option's nap-stage duration
 * server-side. */
export type AcceptRestReq = {
  recovery_option_id: string
  rest_spot: RestSpot
  nap_minutes: number | null
}

/** Request body for `buildMergedPlan` (mirrors the reference's `BuildMergedPlanReq`
 * -> wire `CreateMergedPlanBody`, `engine/merged/run_setup.ts`). Builds a
 * "painted" trigger run-plan draft; the returned `plan_id` feeds into
 * `createMergedRun`'s `trigger_plan_id` unchanged. `mountain_range_km`/
 * `jam_range_km` are `[start_km, end_km]` pairs over the route's 0..total-km
 * axis; omit (or pass `null`) either to skip that paint. */
export type BuildMergedPlanReq = {
  package_id: string
  scenario_id: string
  route_preset_id: string | null
  run_seed: number
  mountain_range_km: [number, number] | null
  jam_range_km: [number, number] | null
  /** Defaults to 15.0 (mirrors `models/merged_run.py`'s Pydantic field
   * default, `jam_speed_kph: float = 15.0` — the wire body requires it). */
  jam_speed_kph?: number
  presets?: Record<string, unknown>
  parameters?: Record<string, unknown>
  hyperparameters?: Record<string, unknown>
  profiles?: Record<string, unknown>
  initial_state?: Record<string, unknown>
  context_overrides?: Record<string, unknown>
}

// ── Quickview projection ────────────────────────────────────────────────────

/** One trigger fire (rising edge), projected through a default, non-persisting
 * quick-check proposal (mirrors the reference's `MergedFirePoint`). */
export type MergedFirePoint = FirePoint & {
  proposal: ProposalRunLog | null
  proposal_error: string | null
}

/** A projected auto-accepted rest, extended with the AFTER-REST proposal
 * (mirrors the reference's `MergedRestOption`). */
export type MergedRestOption = PreviewRestOption & {
  after_rest_proposal: ProposalRunLog | null
  after_rest_proposal_error: string | null
}

/** Ephemeral, non-persisting projection of the WHOLE merged chain (mirrors
 * the reference's `MergedInstantResult`). `fire` (singular) stays a plain
 * `FirePoint` on purpose — only `fires[]` entries carry the projected
 * proposal (see `engine/merged/types.ts`'s own doc comment, "invariant 1"). */
export type MergedInstantResult = Omit<InstantResult, 'fires' | 'rest_options'> & {
  fires: MergedFirePoint[]
  rest_options?: MergedRestOption[]
}

/** Request body for `mergedQuickview` (mirrors the reference's
 * `MergedQuickviewReq` -> wire `MergedQuickviewBody`, `engine/merged/types.ts`).
 *
 * The wire body ALSO carries `context_overrides`/`initial_state`/`profiles`/
 * `tick_seconds` — "setup pins" so the quickview projects from the SAME pinned
 * values a live run starts from. The Combined setup panel attaches these to
 * the request object (`components/merged/MergedSetupPanel.tsx`); the reference
 * `app/frontend` forwards the whole body verbatim (`JSON.stringify(body)`), so
 * they reach the backend even though the reference's request type never
 * declared them. This port rebuilds the wire body field-by-field, so it MUST
 * declare and forward these four — otherwise the pins are silently dropped and
 * the projection seeds from the scenario's own defaults while the live run
 * seeds from the pins, so the two disagree on screen (fixbug-0804). */
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
  service_parameters?: Record<string, unknown>
  service_hyperparameters?: Record<string, unknown>
  content_parameters?: Record<string, unknown>
  content_hyperparameters?: Record<string, unknown>
  /** Setup pins — forwarded to the quickview projection so it seeds from the
   * SAME values the live run starts from. Omitted keys default to null
   * server-side (identical to an unpinned setup). */
  initial_state?: Record<string, unknown> | null
  context_overrides?: Record<string, unknown> | null
  profiles?: Record<string, unknown> | null
  tick_seconds?: number | null
}

// ── Endpoints ────────────────────────────────────────────────────────────

export async function createMergedRun(
  body: CreateMergedRunReq,
): Promise<{ merged_run_id: string; trigger_run_id: string }> {
  return call('merged.create', {
    trigger_plan_id: body.trigger_plan_id,
    world: body.world,
    service_package_id: body.service_package_id,
    content_package_id: body.content_package_id,
    proposal_mode: body.proposal_mode ?? 'interactive',
    run_seed: body.run_seed,
    service_parameters: body.service_parameters ?? {},
    service_hyperparameters: body.service_hyperparameters ?? {},
    content_parameters: body.content_parameters ?? {},
    content_hyperparameters: body.content_hyperparameters ?? {},
  })
}

export async function tickMergedRun(mergedRunId: string): Promise<MergedTickResponse> {
  return call('merged.tick', { mergedRunId })
}

export async function mergedProposalAction(
  mergedRunId: string,
  body: MergedProposalActionReq,
): Promise<ProposalRunLog> {
  return call('merged.proposalAction', {
    mergedRunId,
    body: body.kind === 'select_service'
      ? { kind: 'select_service', selected_service_id: body.selected_service_id, action_type: null, payload: {} }
      : { kind: 'journey_action', selected_service_id: null, action_type: body.action_type, payload: body.payload ?? {} },
  })
}

/** Starts the trigger-side recovery sequence for a merged run's REST fire.
 * Returns the full trigger `RunState` — the SAME shape `getRun` returns.
 * After this resolves, the existing tick loop (Play) auto-drives the rest
 * journey server-side; no further per-stage action is needed. */
export async function acceptRest(mergedRunId: string, body: AcceptRestReq): Promise<RunState> {
  return call('merged.acceptRest', { mergedRunId, body })
}

/** Declines a merged run's pending REST proposal and keeps ticking — no
 * recovery is started. Re-arms the fire guard so a later re-fire spawns a
 * fresh proposal. Returns the trigger `RunState`. */
export async function declineRest(mergedRunId: string): Promise<RunState> {
  return call('merged.decline', { mergedRunId })
}

/** Rejects the merged run's CURRENT proposal-side service/content offer (the
 * guided overlay's "Reject" at the pre-rest service step, or at the content
 * step). Distinct from `declineRest`: this is a PROPOSAL-side rejection
 * (recorded as `SERVICE_REJECTED` on the proposal run), not a trigger-side
 * rest decline — the driver may accept the rest and still reject the service,
 * or accept the service and still reject its content (fixbug-0806).
 * `declined` reports whether the engine ALSO best-effort-declined the
 * trigger's pending proposal (only when one was still actually pending — that
 * is what decides whether the fire guard was re-armed; see
 * `engine/merged/actions.ts#rejectProposal`). */
export async function rejectProposal(
  mergedRunId: string,
): Promise<{ proposal: ProposalRunLog; declined: boolean }> {
  return call('merged.rejectProposal', { mergedRunId })
}

/** Builds a "painted" trigger run-plan (mountain-road segment and/or a
 * positioned traffic jam) and returns its `plan_id`. Call this INSTEAD of
 * `createRunPlan` whenever the reviewer has painted a mountain/jam range
 * onto the route — the returned `plan_id` feeds into `createMergedRun`'s
 * `trigger_plan_id` exactly like a plain run-plan's does. */
export async function buildMergedPlan(body: BuildMergedPlanReq): Promise<{ plan_id: string }> {
  return call('merged.plan', {
    package_id: body.package_id,
    scenario_id: body.scenario_id,
    route_preset_id: body.route_preset_id,
    run_seed: body.run_seed,
    mountain_range_km: body.mountain_range_km,
    jam_range_km: body.jam_range_km,
    jam_speed_kph: body.jam_speed_kph ?? 15.0,
    presets: body.presets ?? {},
    parameters: body.parameters ?? {},
    hyperparameters: body.hyperparameters ?? {},
    profiles: body.profiles ?? null,
    initial_state: body.initial_state ?? null,
    context_overrides: body.context_overrides ?? null,
  })
}

/** Ephemeral, non-persisting projection of the WHOLE merged chain: one
 * headless trigger preview pass plus a default quick-check proposal
 * attached to every actionable fire. Nothing is written to any store — safe
 * to call before (or without ever) creating a real merged run via
 * `createMergedRun`. */
export async function mergedQuickview(body: MergedQuickviewReq): Promise<MergedInstantResult> {
  return call('merged.quickview', {
    package_id: body.package_id,
    scenario_id: body.scenario_id,
    route_preset_id: body.route_preset_id ?? null,
    run_seed: body.run_seed,
    mountain_range_km: body.mountain_range_km ?? null,
    jam_range_km: body.jam_range_km ?? null,
    jam_speed_kph: body.jam_speed_kph ?? 15.0,
    hyperparameter_overrides: body.hyperparameter_overrides ?? {},
    rest_option_id: body.rest_option_id ?? null,
    // Setup pins — FORWARDED (not hardcoded null) so the projection seeds from
    // the same drowsiness/fatigue/context/profile/cadence a live run starts
    // from. The reference forwards the whole body verbatim; this port must
    // forward each field explicitly. Omitted -> null == an unpinned setup
    // (fixbug-0804: hardcoding null here dropped the reviewer's initial_state
    // pins, so quickview diverged from the animation run).
    context_overrides: body.context_overrides ?? null,
    initial_state: body.initial_state ?? null,
    profiles: body.profiles ?? null,
    tick_seconds: body.tick_seconds ?? null,
    world: body.world,
    service_package_id: body.service_package_id,
    content_package_id: body.content_package_id,
    run_seed_proposal: body.run_seed_proposal,
    service_parameters: body.service_parameters ?? {},
    service_hyperparameters: body.service_hyperparameters ?? {},
    content_parameters: body.content_parameters ?? {},
    content_hyperparameters: body.content_hyperparameters ?? {},
  })
}

/** Request for `afterRestProposal` (mirrors the reference's
 * `AfterRestProposalReq` -> wire `MergedAfterRestProposalBody`,
 * `engine/worker/handlers/merged.ts`). Re-projects the read-only after-nap
 * inspect panel's proposal from the SAME recovered-driver `world`, forcing
 * content dispatch for `selected_service_id` (the reviewer-chosen service). */
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
 * reviewer-chosen after-rest service. Stateless / non-persisting — nothing
 * is written to any proposal-run store. */
export async function afterRestProposal(body: AfterRestProposalReq): Promise<ProposalRunLog> {
  return call('merged.afterRestProposal', {
    world: body.world,
    service_package_id: body.service_package_id,
    content_package_id: body.content_package_id,
    run_seed_proposal: body.run_seed_proposal,
    selected_service_id: body.selected_service_id ?? null,
    service_parameters: body.service_parameters ?? {},
    service_hyperparameters: body.service_hyperparameters ?? {},
  })
}

// ── Correlation replay ──────────────────────────────────────────────────────

/** Response for `getMergedRun` (mirrors the reference's `GetMergedRunResponse`)
 * — a pure read reassembly for read-only replay: the persisted handle, the
 * raw trigger `RunLog` exactly as stored (`null` only if genuinely
 * unresolvable), and every paired `ProposalRunLog` in
 * `handle.proposal_run_ids` order. Nothing here is recomputed — no engine,
 * no selector runs. */
export type GetMergedRunResponse = {
  handle: MergedRunHandle
  trigger_log: RunLog | null
  proposal_logs: ProposalRunLog[]
}

/** Reassembles one persisted merged run for read-only replay. Pure read —
 * never recomputes a decision and never mutates the run. Feeds
 * `replay/mergedReplaySource.ts`'s `createMergedReplaySource`. */
export async function getMergedRun(mergedRunId: string): Promise<GetMergedRunResponse> {
  return call('merged.get', { mergedRunId })
}

/** Lists every persisted merged run's summary. Unwraps the wire's
 * `{merged_runs: [...]}` envelope so callers receive the array directly. */
export async function listMergedRuns(): Promise<MergedRunSummary[]> {
  const { merged_runs } = await call<{ merged_runs: MergedRunSummary[] }>('merged.list')
  return merged_runs
}

// ── Review feedback ──────────────────────────────────────────────────────────

/** Request body for `postReviewFeedback` (mirrors the reference's
 * `ReviewFeedbackBody`). `review_input` labels are `{judgment: ...}`;
 * `review_decision` labels are `{assessment: ...}` plus the free-form
 * `comment`. `feature_id` only applies to `review_input`. */
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

/** One recorded review judgement, as returned by `getReviewFeedback` (mirrors
 * the reference's `ReviewFeedbackEvent` — only the fields this client
 * actually reads are typed; the real `FeedbackEvent` may carry more). */
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

/** Response for `getReviewFeedback`: every recorded review_input/review_decision
 * judgement for this merged run, plus the trigger/service/content package
 * versions in play. */
export type ReviewFeedbackExport = {
  events: ReviewFeedbackEvent[]
  package_versions: {
    trigger: ReviewFeedbackPackageVersion
    service: ReviewFeedbackPackageVersion
    content: ReviewFeedbackPackageVersion
  }
}

/** Appends one reviewer judgement to the merged run's paired trigger run log.
 * Append-only — two judgements on the same feature append twice, never
 * replace. Throws on failure (404 for an unknown merged run) exactly like
 * every other call in this file — callers must NOT swallow that error, since
 * a judgement the reviewer believes was recorded but wasn't is worse than
 * one never offered. */
export async function postReviewFeedback(mergedRunId: string, body: ReviewFeedbackBody): Promise<void> {
  await call('merged.reviewFeedback.post', { mergedRunId, body })
}

/** Reads back every recorded review judgement for a merged run plus the
 * package versions in play. Pure read — nothing is recomputed. Feeds the
 * export button on `DecisionAssessment`. */
export async function getReviewFeedback(mergedRunId: string): Promise<ReviewFeedbackExport> {
  return call('merged.reviewFeedback.get', { mergedRunId })
}
