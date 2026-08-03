import { MapsError, FeedbackValidationError } from './types'
import { RunPlanError, ExplanationProviderUnsupportedError } from './errors'
import { ProposalHttpError, type ProposalHttpDetail } from '../engine/proposal/orchestrator/create_run'

export type RpcOp =
  | 'health.get'
  | 'packages.list' | 'packages.get'
  // htmlapp-only: no Python counterpart, exempt from contract parity.
  | 'packages.addUser'
  | 'data.install'
  | 'scenarios.list' | 'scenarios.get'
  | 'routes.analyze' | 'routes.presets.list' | 'routes.presets.load'
  | 'runPlans.create' | 'runPlans.regenerate'
  | 'runs.create' | 'runs.tick' | 'runs.act' | 'runs.restSpots'
  | 'runs.log' | 'runs.list' | 'runs.state' | 'runs.preview'
  | 'evidence.get' | 'evidence.md'
  | 'feedback.submit' | 'feedback.schema'
  | 'proposal.presets.list' | 'proposal.presets.get'
  | 'proposal.packages.list'
  | 'proposal.catalog.get'
  | 'proposal.runs.explain'
  // Merged (Combined Simulator) — feature 026, htmlapp Combined export,
  // slice C4 Task 9. Mirrors routers/merged_runs.py's fourteen routes.
  | 'merged.plan' | 'merged.quickview' | 'merged.afterRestProposal'
  | 'merged.explain' | 'merged.explainTrigger'
  | 'merged.create' | 'merged.get' | 'merged.list'
  | 'merged.acceptRest' | 'merged.decline' | 'merged.tick' | 'merged.proposalAction'
  | 'merged.reviewFeedback.post' | 'merged.reviewFeedback.get'

export type RpcRequest = { op: RpcOp; params?: unknown }

export type RpcError = {
  type: string
  message: string
  body?: unknown
  validationErrors?: { field: string; message: string }[]
  // ExplanationProviderUnsupportedError-only — see serializeError/unwrap
  // below. A dedicated field (not reused `body`) because it is a single
  // fixed literal, not a structured payload the way MapsError's `body` is.
  provider?: string
  // ProposalHttpError-only (feature 026, htmlapp Combined export, slice C4
  // Task 9) — see serializeError/unwrap below. `status` is the HTTP status
  // Python's own `HTTPException(status, detail)` would carry; `detail` is
  // the exact `ProposalHttpDetail` payload (a bare string, or one of the
  // structured shapes `../engine/proposal/orchestrator/create_run.ts`
  // documents — every member is plain JSON-shaped data, so it survives
  // structured-clone across the worker boundary unchanged). A dedicated
  // pair of fields, not reused `body`/`validationErrors`: `detail` is not
  // always an array (unlike `validationErrors`), and `status` has no
  // existing analog on any other member this union already carries.
  status?: number
  detail?: ProposalHttpDetail
}

export type RpcResponse<T = unknown> = { ok: true; result: T } | { ok: false; error: RpcError }

/** Convert a thrown error into a structured-cloneable RpcError. */
export function serializeError(e: unknown): RpcError {
  if (e instanceof MapsError) {
    return { type: 'MapsError', message: e.message, body: e.body }
  }
  if (e instanceof FeedbackValidationError) {
    return { type: 'FeedbackValidationError', message: e.message, validationErrors: e.validationErrors }
  }
  if (e instanceof RunPlanError) {
    return { type: 'RunPlanError', message: e.message, validationErrors: e.validationErrors }
  }
  if (e instanceof ExplanationProviderUnsupportedError) {
    // Dedicated branch — see this file's own doc note at the top of the
    // brief this task was given: the generic `instanceof Error` fallback
    // below preserves only `{type, message}`, which would silently drop
    // `.provider` over the RPC boundary (structured-clone loses any class
    // instance's non-enumerable/prototype behavior; only OWN plain-data
    // fields survive `{...}`-style serialization here anyway, but the
    // fallback branch doesn't even attempt to copy them).
    return { type: 'ExplanationProviderUnsupportedError', message: e.message, provider: e.provider }
  }
  if (e instanceof ProposalHttpError) {
    // Dedicated branch — see this file's own doc note on `RpcError.status`/
    // `.detail` above: the generic `instanceof Error` fallback below
    // preserves only `{type, message}`, which would silently drop BOTH
    // `.status` (the intended HTTP status code) and the structured half of
    // `.detail` (every `ProposalHttpDetail` member except the bare-string
    // one — e.g. `PlanValidationDetail`'s `validation_errors` array, or
    // `ServiceNotEligibleDetail`'s `reason_codes`) over the RPC boundary.
    // The Combined screen renders these — a caller inspecting only
    // `.message` would see the derived summary sentence but lose the
    // machine-readable `code`/`validation_errors`/`reason_codes` fields a
    // real UI branch needs.
    return { type: 'ProposalHttpError', message: e.message, status: e.status, detail: e.detail }
  }
  if (e instanceof Error) {
    return { type: e.name || 'Error', message: e.message }
  }
  return { type: 'Error', message: String(e) }
}

/** Rebuild and throw the original error class on the client side, else return the result. */
export function unwrap<T>(r: RpcResponse<T>): T {
  if (r.ok) return r.result
  const { error } = r
  if (error.type === 'MapsError') {
    throw new MapsError(error.body as { error_type: string; message: string; suggestion: string })
  }
  if (error.type === 'FeedbackValidationError') {
    throw new FeedbackValidationError({ validation_errors: error.validationErrors ?? [] })
  }
  if (error.type === 'RunPlanError') {
    throw new RunPlanError(error.message, error.validationErrors ?? [])
  }
  if (error.type === 'ExplanationProviderUnsupportedError') {
    // The class carries no constructor params (`provider` is a fixed
    // literal) — reconstructing fresh reproduces `.provider === 'backend'`
    // and the same message without needing `error.provider` here, but
    // `serializeError` still puts it on the wire (see that branch's own
    // comment) so a caller inspecting the RAW RpcError (before unwrap) also
    // sees it, and so a round-trip test can assert the field survives
    // serialization rather than merely that unwrap happens to know it.
    throw new ExplanationProviderUnsupportedError()
  }
  if (error.type === 'ProposalHttpError') {
    // `status`/`detail` are always both set by `serializeError`'s own
    // `ProposalHttpError` branch above — the `?? 500`/`?? error.message`
    // fallbacks below only guard a HAND-BUILT `RpcError` (e.g. a test
    // constructing the wire shape directly without going through
    // `serializeError`), never a real round-tripped one.
    throw new ProposalHttpError(error.status ?? 500, (error.detail ?? error.message) as ProposalHttpDetail)
  }
  const rebuilt = new Error(error.message)
  rebuilt.name = error.type
  throw rebuilt
}
