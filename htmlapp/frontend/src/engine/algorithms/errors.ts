/**
 * Algorithm adapter error type.
 *
 * Ported from `app/api/aica_api/algorithms/_errors.py` (behavior-of-record).
 * Raised when an algorithm fails to produce a valid DecisionResult. Callers
 * (the tick engine, a later task) should convert this to an `algorithm_error`
 * event, never to a normal DecisionResult (FR-011 in the master spec).
 */
export class AlgorithmAdapterError extends Error {
  readonly detail: unknown

  constructor(message: string, detail?: unknown) {
    super(message)
    this.name = 'AlgorithmAdapterError'
    this.detail = detail
  }
}
