import type {
  PackageManifest,
  ScenarioDef,
  SetupValue,
  RunPlanResponse,
  RouteFacts,
  DisplayRoute,
  ProfileOverrides,
  ValidationError,
} from '../../../api/types'
import { RunPlanError } from '../../../api/types'
import { packageRegistry } from '../../services/package_registry'
import { scenarioRegistry } from '../../services/scenario_registry'
import {
  createDraft,
  regenerateDraft,
  getDraftEntry,
  type PackageManifestM2,
} from '../../run_plan'
import type { ScenarioDefM2 } from '../../event_plan'

/** Loose stand-in for Python's `!r` repr formatting used in router error messages. */
function pyReprValue(value: unknown): string {
  if (typeof value === 'string') return `'${value}'`
  return String(value)
}

// plan_id generation: monotonic in-memory counter for determinism.
let _planIdCounter = 0
export function makePlanId(): string {
  _planIdCounter += 1
  return `plan_${String(_planIdCounter).padStart(6, '0')}`
}

const VALID_INITIAL_STATE_KEYS = ['drowsiness_level', 'fatigue_level']
const VALID_CONTEXT_KEYS = ['child_passenger', 'familiar_route']

/** Mirrors the router's initial_state key/range validation. */
function validateInitialStateBody(initialState: Record<string, unknown>): ValidationError[] {
  const errors: ValidationError[] = []
  for (const [key, value] of Object.entries(initialState)) {
    if (!VALID_INITIAL_STATE_KEYS.includes(key)) {
      errors.push({
        field: `initial_state.${key}`,
        message: `Unknown initial_state key ${pyReprValue(key)}. Valid keys: ['drowsiness_level', 'fatigue_level']`,
      })
    } else if (typeof value !== 'number') {
      errors.push({
        field: `initial_state.${key}`,
        message: `initial_state.${key} must be a number in [0, 100]; got ${pyReprValue(value)}`,
      })
    } else if (!(value >= 0 && value <= 100)) {
      errors.push({
        field: `initial_state.${key}`,
        message: `initial_state.${key} must be in [0, 100]; got ${pyReprValue(value)}`,
      })
    }
  }
  return errors
}

/** Mirrors the router's context_overrides key/type validation. */
function validateContextOverridesBody(contextOverrides: Record<string, unknown>): ValidationError[] {
  const errors: ValidationError[] = []
  for (const [key, value] of Object.entries(contextOverrides)) {
    if (!VALID_CONTEXT_KEYS.includes(key)) {
      errors.push({
        field: `context_overrides.${key}`,
        message: `Unknown context key ${pyReprValue(key)}. Valid keys: ['child_passenger', 'familiar_route']`,
      })
    } else if (typeof value !== 'boolean') {
      errors.push({
        field: `context_overrides.${key}`,
        message: `context_overrides.${key} must be a boolean; got ${pyReprValue(value)}`,
      })
    }
  }
  return errors
}

export async function runPlansCreate(params: {
  packageId: string
  scenarioId: string
  parameters?: Record<string, SetupValue>
  hyperparameters?: Record<string, SetupValue>
  presets?: Record<string, unknown>
  runMode?: string
  routeId?: string
  routeSource?: string
  routeFacts?: RouteFacts | null
  displayRoute?: DisplayRoute | null
  profiles?: ProfileOverrides | null
  initialState?: { drowsiness_level?: number; fatigue_level?: number }
  contextOverrides?: { child_passenger?: boolean; familiar_route?: boolean }
}): Promise<RunPlanResponse> {
  let pkgManifest: PackageManifest
  try {
    pkgManifest = await packageRegistry.get(params.packageId)
  } catch {
    throw new RunPlanError(`Package ${pyReprValue(params.packageId)} not found or invalid`)
  }

  let scenario: ScenarioDef
  try {
    scenario = await scenarioRegistry.get(params.scenarioId)
  } catch {
    throw new RunPlanError(`Scenario ${pyReprValue(params.scenarioId)} not found or invalid`)
  }

  if (!packageRegistry.isCompatible(pkgManifest, scenario)) {
    throw new RunPlanError(
      `Package ${pyReprValue(params.packageId)} is not compatible with scenario ${pyReprValue(params.scenarioId)} (type=${pyReprValue(scenario.type)})`,
    )
  }

  const routeSource = params.routeSource ?? 'local'
  if (routeSource === 'maps') {
    if (params.routeId == null) {
      throw new RunPlanError(
        "route_id is required when route_source is 'maps'. Pass the route_id from the chosen /api/routes/analyze alternative.",
      )
    }
    if (params.routeFacts == null) {
      throw new RunPlanError(
        "route_facts is required when route_source is 'maps'. A run cannot be created without route facts. " +
          'Pass the route_facts from the chosen /api/routes/analyze alternative.',
      )
    }
  }

  const routeFacts = routeSource === 'maps' ? (params.routeFacts ?? null) : null
  const displayRoute = routeSource === 'maps' ? (params.displayRoute ?? null) : null

  const profilesDict: Record<string, unknown> | null = params.profiles ?? null

  if (params.initialState != null) {
    const initErrors = validateInitialStateBody(params.initialState)
    if (initErrors.length > 0) {
      throw new RunPlanError('One or more initial_state values are invalid.', initErrors)
    }
  }

  if (params.contextOverrides != null) {
    const ctxErrors = validateContextOverridesBody(params.contextOverrides)
    if (ctxErrors.length > 0) {
      throw new RunPlanError('One or more context_overrides values are invalid.', ctxErrors)
    }
  }

  const planId = makePlanId()
  const { draft } = createDraft({
    planId,
    package: pkgManifest as unknown as PackageManifestM2,
    scenario: scenario as unknown as ScenarioDefM2,
    presets: params.presets ?? {},
    parameters: params.parameters ?? {},
    hyperparameters: params.hyperparameters ?? {},
    runMode: params.runMode ?? 'standard',
    routeFacts,
    routeSource: routeSource as 'maps' | 'local',
    displayRoute,
    profiles: profilesDict,
    initialState: params.initialState ?? null,
    contextOverrides: params.contextOverrides ?? null,
  })

  if (draft.validation_errors.length > 0) {
    throw new RunPlanError('One or more parameter/hyperparameter values are invalid.', draft.validation_errors)
  }

  return {
    plan_id: draft.plan_id,
    draft_plan: draft.draft_event_plan,
    effective_setup: draft.effective_setup,
    validation_errors: draft.validation_errors,
  }
}

export async function runPlansRegenerate(params: {
  planId: string
  patch: {
    parameters?: Record<string, SetupValue>
    hyperparameters?: Record<string, SetupValue>
    presets?: Record<string, unknown>
  }
}): Promise<RunPlanResponse> {
  if (getDraftEntry(params.planId) === null) {
    throw new RunPlanError(`Run plan ${pyReprValue(params.planId)} not found`)
  }

  let draft: ReturnType<typeof regenerateDraft>
  try {
    draft = regenerateDraft(params.planId, {
      presets: params.patch.presets ?? {},
      parameters: params.patch.parameters ?? {},
      hyperparameters: params.patch.hyperparameters ?? {},
    })
  } catch (exc) {
    throw new RunPlanError(exc instanceof Error ? exc.message : String(exc))
  }

  if (draft.validation_errors.length > 0) {
    throw new RunPlanError('One or more parameter/hyperparameter values are invalid.', draft.validation_errors)
  }

  return {
    plan_id: draft.plan_id,
    draft_plan: draft.draft_event_plan,
    effective_setup: draft.effective_setup,
    validation_errors: draft.validation_errors,
  }
}
