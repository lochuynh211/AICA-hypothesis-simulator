/**
 * Merged-run (Combined Simulator) worker-RPC handlers — feature 026,
 * htmlapp Combined export, slice C4 Task 9. This is the INTEGRATION task:
 * Tasks 5-8 already ported every `routers/merged_runs.py` endpoint BODY as a
 * plain function (`../../merged/run_setup.ts`, `../../merged/quickview.ts`,
 * `../../merged/tick.ts`, `../../merged/actions.ts`, `../../merged/explain.ts`,
 * `../../merged/review_feedback.ts`) — nothing imported any of it, so Vite
 * tree-shook the whole merged engine out of every prior task's bundle. This
 * file is the FIRST thing that imports it.
 *
 * Every export below is a THIN adapter: it owns HTTP-framing-equivalent
 * concerns only — unpacking `{ mergedRunId, body }`-shaped RPC params into
 * the positional arguments the ported function expects, and (for
 * `mergedQuickview` only) the ROUTER-level glue Python's own
 * `quickview_merged_run_endpoint` performs before calling
 * `project_merged_quickview` (conditionally building a painted route via
 * `buildQuickviewRouteFacts`, and converting the ported preview-loop's plain
 * `Error` into a `ProposalHttpError(400, ...)`, mirroring Python's own
 * `except PreviewValidationError: raise HTTPException(400, ...)` — see this
 * function's own doc comment for why that specific wrap is the one piece of
 * "framing" logic living in this file rather than a ported module).
 * No other function below contains a single conditional beyond unpacking
 * `params` — every real decision (400/404/422, error shape, business logic)
 * was already made by the Task 5-8 module it calls.
 *
 * ── Params shape convention ──────────────────────────────────────────────
 * A path-parameterized op takes `{ mergedRunId, ... }` (mirrors this port's
 * existing precedent, e.g. `../handlers/runs.ts#runsTick`'s `{ runId }`); an
 * op with both a path param and a POST body nests the body under its own
 * `body` key (mirrors `../handlers/feedback.ts#feedbackSubmit`'s
 * `{ runId, body }`) rather than flattening the body's fields alongside
 * `mergedRunId`, so a body type can be reused verbatim (`AcceptRestBody`,
 * `MergedProposalActionBody`, `ReviewFeedbackBody`) with no separate
 * "flattened params" type to keep in sync. An op with NO path param takes
 * the wire body type directly as `params` (mirrors
 * `../handlers/run_plans.ts`'s own top-level body-shaped params).
 *
 * ── The fourteen ops, matching merged_runs.py's fourteen routes ──────────
 *   merged.plan              -> POST /api/merged-runs/plan
 *   merged.quickview         -> POST /api/merged-runs/quickview
 *   merged.afterRestProposal -> POST /api/merged-runs/after-rest-proposal
 *   merged.explain           -> POST /api/merged-runs/explain
 *   merged.explainTrigger    -> POST /api/merged-runs/explain-trigger
 *   merged.create            -> POST /api/merged-runs
 *   merged.get               -> GET  /api/merged-runs/{id}
 *   merged.list              -> GET  /api/merged-runs
 *   merged.acceptRest        -> POST /api/merged-runs/{id}/accept-rest
 *   merged.decline            -> POST /api/merged-runs/{id}/decline
 *   merged.rejectProposal     -> POST /api/merged-runs/{id}/reject-proposal
 *   merged.tick               -> POST /api/merged-runs/{id}/tick
 *   merged.proposalAction     -> POST /api/merged-runs/{id}/proposal-action
 *   merged.reviewFeedback.post -> POST /api/merged-runs/{id}/review-feedback
 *   merged.reviewFeedback.get  -> GET  /api/merged-runs/{id}/review-feedback
 */
import type { RouteFacts, FeedbackEvent } from '../../../api/types'
import {
  createMergedPlan,
  buildQuickviewRouteFacts,
  createMergedRun,
  getMergedRun,
  listMergedRuns,
  type CreateMergedPlanBody,
  type CreateMergedRunBody,
  type GetMergedRunResult,
  type MergedRunSummary,
} from '../../merged/run_setup'
import { project } from '../../merged/quickview'
import { tickMergedRun } from '../../merged/tick'
import { acceptRest, declineRest, proposalAction, rejectProposal, type RejectProposalResult } from '../../merged/actions'
import {
  mergedExplainEndpoint,
  explainTriggerEndpoint,
  type MergedExplainBody,
  type ExplainTriggerBody,
  type TriggerExplainResponse,
} from '../../merged/explain'
import {
  postReviewFeedbackEndpoint,
  getReviewFeedbackEndpoint,
  type ReviewFeedbackBody,
  type ReviewFeedbackListResponse,
} from '../../merged/review_feedback'
import type {
  MergedQuickviewBody,
  MergedInstantResult,
  AcceptRestBody,
  MergedProposalActionBody,
  MergedTickResponse,
} from '../../merged/types'
import type { World } from '../../merged/adapter'
import { ProposalHttpError, createProposalRun, type CreateProposalRunBody } from '../../proposal/orchestrator/create_run'
import { applyQuickCheckContent } from '../../proposal/orchestrator/select_service'
import type { ExplainResponse } from '../../proposal/orchestrator/explain'
import type { ProposalRunLog, ProposalRunCache } from '../../proposal/run_manager'
import type { RunStateM2 } from '../../run_manager'

// ---------------------------------------------------------------------------
// merged.plan — POST /api/merged-runs/plan (merged_runs.py:216-360)
// ---------------------------------------------------------------------------

export async function mergedPlan(params: CreateMergedPlanBody): Promise<{ plan_id: string }> {
  return createMergedPlan(params)
}

// ---------------------------------------------------------------------------
// merged.quickview — POST /api/merged-runs/quickview (merged_runs.py:444-487)
// ---------------------------------------------------------------------------

/**
 * Mirrors `quickview_merged_run_endpoint`'s own router-level glue: build a
 * painted `route_facts` ONLY when a preset/mountain/jam field was actually
 * supplied (the common, unpainted case stays as simple as
 * `../../merged/quickview.ts#project`'s own default `{ routeSource: 'local'
 * }`), then project. The ported preview loop
 * (`../../services/preview_ticks.ts#iterPreviewTicks`, called transitively
 * through `project`) throws a plain `Error` for what Python's
 * `PreviewValidationError` represents (unknown/incompatible package or
 * scenario, an old-shape scenario, invalid hyperparameter overrides — see
 * that function's own doc comment, "@throws Error mirroring
 * PreviewValidationError") — this is the ONE piece of HTTP-framing glue this
 * file adds beyond straight pass-through: converting that generic `Error`
 * into a `ProposalHttpError(400, ...)`, mirroring Python's own
 * `except PreviewValidationError as exc: raise HTTPException(400, str(exc))`.
 * `buildQuickviewRouteFacts` itself already throws correctly-shaped
 * `ProposalHttpError`s (400 unknown/incompatible package or scenario, 404
 * unknown route preset) and is NOT re-wrapped here — only the later
 * `project(...)` call's untyped `Error` needs this translation.
 */
export async function mergedQuickview(params: MergedQuickviewBody): Promise<MergedInstantResult> {
  let routeFacts: RouteFacts | null = null
  let routeSource: 'maps' | 'local' = 'local'
  let presets: Record<string, unknown> | null = null

  if (params.route_preset_id !== null || params.mountain_range_km !== null || params.jam_range_km !== null) {
    const built = await buildQuickviewRouteFacts(params)
    routeFacts = built.routeFacts
    routeSource = built.routeSource
    presets = built.presets
  }

  try {
    return await project(params, { routeFacts, routeSource, presets })
  } catch (exc) {
    if (exc instanceof ProposalHttpError) throw exc
    throw new ProposalHttpError(400, exc instanceof Error ? exc.message : String(exc))
  }
}

// ---------------------------------------------------------------------------
// merged.afterRestProposal — POST /api/merged-runs/after-rest-proposal
// (merged_runs.py:490-536)
// ---------------------------------------------------------------------------

/** Mirrors `AfterRestProposalBody` (merged_runs.py:490-508). Python wraps the
 * `CreateProposalRunBody(...)` construction in `try/except ValidationError`
 * — DEAD from this call site specifically (every field passed is already a
 * validated `World`/literal/plain scalar; see `../../merged/quickview.ts`'s
 * own module doc, "The `CreateProposalRunBody(...)` `ValidationError` catch",
 * for the identical reasoning already established for `_project_fire`/
 * `_project_after_rest`'s structurally identical construction calls) — so
 * this handler builds the object literal directly, with no try/catch around
 * that step (nothing to catch), matching that file's own established
 * precedent for this exact situation. */
export type MergedAfterRestProposalBody = {
  world: World
  service_package_id: string
  content_package_id: string
  run_seed_proposal: string
  selected_service_id: string | null
  service_parameters: Record<string, unknown>
  service_hyperparameters: Record<string, unknown>
}

export async function mergedAfterRestProposal(params: MergedAfterRestProposalBody): Promise<ProposalRunLog> {
  const proposalBody: CreateProposalRunBody = {
    world: params.world as unknown as CreateProposalRunBody['world'],
    trigger_purpose: 'rest_recommended',
    lifecycle_stage: 'after_rest_before_restart',
    motion_state: params.world.control_inputs.motion_state as CreateProposalRunBody['motion_state'],
    service_package_id: params.service_package_id,
    content_package_id: params.content_package_id,
    mode: 'quick_check',
    run_seed: params.run_seed_proposal,
    simulation_time: 0,
    quick_check_service_id: params.selected_service_id,
    parameters: params.service_parameters,
    hyperparameters: params.service_hyperparameters,
  }
  // Fresh, per-call, in-memory cache — mirrors Python's `cache={}` dict
  // LITERAL at this exact call site (never `proposalRunsStore`), the SAME
  // feature-020 Slice-2c seam `../../merged/quickview.ts#runQuickCheckProposal`
  // already uses for its own two (structurally identical) call sites.
  return createProposalRun(proposalBody, { cache: new Map() as ProposalRunCache, applyQuickCheckContent })
}

// ---------------------------------------------------------------------------
// merged.explain — POST /api/merged-runs/explain (merged_runs.py:553-600)
// ---------------------------------------------------------------------------

export async function mergedExplain(params: MergedExplainBody): Promise<ExplainResponse> {
  return mergedExplainEndpoint(params)
}

// ---------------------------------------------------------------------------
// merged.explainTrigger — POST /api/merged-runs/explain-trigger
// (merged_runs.py:600-681)
// ---------------------------------------------------------------------------

export async function mergedExplainTrigger(params: ExplainTriggerBody): Promise<TriggerExplainResponse> {
  return explainTriggerEndpoint(params)
}

// ---------------------------------------------------------------------------
// merged.create — POST /api/merged-runs (merged_runs.py:681-709)
// ---------------------------------------------------------------------------

export async function mergedCreate(
  params: CreateMergedRunBody,
): Promise<{ merged_run_id: string; trigger_run_id: string }> {
  return createMergedRun(params)
}

// ---------------------------------------------------------------------------
// merged.get — GET /api/merged-runs/{merged_run_id} (merged_runs.py:712-753)
// ---------------------------------------------------------------------------

export async function mergedGet(params: { mergedRunId: string }): Promise<GetMergedRunResult> {
  return getMergedRun(params.mergedRunId)
}

// ---------------------------------------------------------------------------
// merged.list — GET /api/merged-runs (merged_runs.py:756-781)
// ---------------------------------------------------------------------------

export async function mergedList(): Promise<{ merged_runs: MergedRunSummary[] }> {
  return listMergedRuns()
}

// ---------------------------------------------------------------------------
// merged.acceptRest — POST /api/merged-runs/{merged_run_id}/accept-rest
// (merged_runs.py:824-892)
// ---------------------------------------------------------------------------

export async function mergedAcceptRest(params: { mergedRunId: string; body: AcceptRestBody }): Promise<RunStateM2> {
  return acceptRest(params.mergedRunId, params.body)
}

// ---------------------------------------------------------------------------
// merged.decline — POST /api/merged-runs/{merged_run_id}/decline
// (merged_runs.py:892-934)
// ---------------------------------------------------------------------------

export async function mergedDecline(params: { mergedRunId: string }): Promise<RunStateM2> {
  return declineRest(params.mergedRunId)
}

// ---------------------------------------------------------------------------
// merged.rejectProposal — POST /api/merged-runs/{merged_run_id}/reject-proposal
// (fixbug-0806)
// ---------------------------------------------------------------------------

export async function mergedRejectProposal(
  params: { mergedRunId: string },
): Promise<RejectProposalResult> {
  return rejectProposal(params.mergedRunId)
}

// ---------------------------------------------------------------------------
// merged.tick — POST /api/merged-runs/{merged_run_id}/tick
// (merged_runs.py:934-1203)
// ---------------------------------------------------------------------------

export async function mergedTick(params: { mergedRunId: string }): Promise<MergedTickResponse> {
  return tickMergedRun(params.mergedRunId)
}

// ---------------------------------------------------------------------------
// merged.proposalAction — POST /api/merged-runs/{merged_run_id}/proposal-action
// (merged_runs.py:1206-1327)
// ---------------------------------------------------------------------------

export async function mergedProposalAction(
  params: { mergedRunId: string; body: MergedProposalActionBody },
): Promise<ProposalRunLog> {
  return proposalAction(params.mergedRunId, params.body)
}

// ---------------------------------------------------------------------------
// merged.reviewFeedback.post — POST /api/merged-runs/{merged_run_id}/review-feedback
// (merged_runs.py:1327-1366)
// ---------------------------------------------------------------------------

export async function mergedReviewFeedbackPost(
  params: { mergedRunId: string; body: ReviewFeedbackBody },
): Promise<FeedbackEvent> {
  return postReviewFeedbackEndpoint(params.mergedRunId, params.body)
}

// ---------------------------------------------------------------------------
// merged.reviewFeedback.get — GET /api/merged-runs/{merged_run_id}/review-feedback
// (merged_runs.py:1366-1415)
// ---------------------------------------------------------------------------

export async function mergedReviewFeedbackGet(
  params: { mergedRunId: string },
): Promise<ReviewFeedbackListResponse> {
  return getReviewFeedbackEndpoint(params.mergedRunId)
}
