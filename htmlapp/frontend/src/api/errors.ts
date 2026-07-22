import type { ValidationError } from './types'

/**
 * Thrown by createRunPlan/regenerateRunPlan on any router-equivalent 400/404.
 * htmlapp-only: the docker app's api/types.ts has no RunPlanError, so it must
 * live outside the sync-overwritten types.ts (see sync-from-app.mjs FILES).
 */
export class RunPlanError extends Error {
  readonly validationErrors: ValidationError[]
  constructor(detail: string, validationErrors: ValidationError[] = []) {
    super(detail)
    this.name = 'RunPlanError'
    this.validationErrors = validationErrors
  }
}
