import { MapsError, FeedbackValidationError, RunPlanError } from './types'

export type RpcOp =
  | 'health.get'
  | 'packages.list' | 'packages.get' | 'packages.addUser'
  | 'scenarios.list' | 'scenarios.get'
  | 'routes.analyze' | 'routes.presets.list' | 'routes.presets.load'
  | 'runPlans.create' | 'runPlans.regenerate'
  | 'runs.create' | 'runs.tick' | 'runs.act' | 'runs.restSpots'
  | 'runs.log' | 'runs.list' | 'runs.state' | 'runs.preview'
  | 'evidence.get' | 'evidence.md'
  | 'feedback.submit' | 'feedback.schema'

export type RpcRequest = { op: RpcOp; params?: unknown }

export type RpcError = {
  type: string
  message: string
  body?: unknown
  validationErrors?: { field: string; message: string }[]
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
  const rebuilt = new Error(error.message)
  rebuilt.name = error.type
  throw rebuilt
}
