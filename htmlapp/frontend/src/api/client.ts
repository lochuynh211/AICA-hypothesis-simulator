/**
 * API client seam — the ONE boundary the copied React presentation layer
 * calls through. Signatures are byte-identical to `app/frontend/src/api/client.ts`
 * (the frozen source of record): same exported function names, parameter
 * lists, and return types. Nothing in `src/components` or `src/state` may
 * import anything else from this module's surface.
 *
 * In the docker app, every one of these functions is a `fetch()` call to the
 * FastAPI backend. In the htmlapp offline build there is no backend: each
 * function is backed by an equivalent local computation (IndexedDB registries,
 * the local tick engine, evidence builder, etc.), wired in incrementally
 * across S2.x/S3.x/... slices.
 *
 * S2.6 implements the first 5 (health + package/scenario read paths). Every
 * other exported function is a stub — `throw new Error('not implemented: <name>')`
 * — purely so the copied components type-check against this module. Later
 * slices replace each stub body with a real implementation; NO signature
 * changes when that happens.
 *
 * Note: the frozen source imports the *runtime* classes `MapsError` and
 * `FeedbackValidationError` from './types' (used only inside the real
 * `routesAnalyze`/`submitFeedback` bodies, both still stubs here). They are
 * intentionally omitted from this file's imports until the slices that
 * implement those two functions reintroduce them — an unused value import
 * would fail this project's `noUnusedLocals` tsc gate. All *type* imports
 * referenced by the 21 signatures below are copied verbatim.
 */
import type {
  PackageSummary,
  PackageManifest,
  ScenarioSummary,
  ScenarioDef,
  RegistryError,
  RouteFacts,
  DisplayRoute,
  RouteEnvelope,
  RoutePresetSummary,
  RunPlanResponse,
  RunState,
  RunSummary,
  SetupValue,
  TickResponse,
  RunLog,
  FeedbackSchema,
  FeedbackSubmitBody,
  FeedbackEvent,
  EvidenceReport,
  ProfileOverrides,
  RestSpot,
  ValidationError,
} from './types'
import { packageRegistry } from '../engine/services/package_registry'
import { scenarioRegistry } from '../engine/services/scenario_registry'
import { seedDefaults } from '../storage/db'
import pkg from '../../package.json'
import {
  createDraft,
  regenerateDraft,
  getDraftEntry,
  type PackageManifestM2,
} from '../engine/run_plan'
import type { ScenarioDefM2 } from '../engine/event_plan'

export type HealthStatus = {
  status: string
  service: string
  version: string
}

// ── Lazy first-launch seeding ────────────────────────────────────────────
//
// Registry reads must happen AFTER seedDefaults() has populated IndexedDB.
// ready() is idempotent (memoized promise) so every seam function can just
// `await ready()` without re-seeding on every call.

let _seeded: Promise<void> | null = null
function ready(): Promise<void> {
  return (_seeded ??= seedDefaults())
}

// ── Health ─────────────────────────────────────────────────────────────────

export async function getHealth(): Promise<HealthStatus> {
  return { status: 'ok', service: 'aica-htmlapp', version: pkg.version }
}

// ── Packages ───────────────────────────────────────────────────────────────

export async function listPackages(): Promise<{ packages: PackageSummary[]; errors: RegistryError[] }> {
  await ready()
  return packageRegistry.listSummaries()
}

export async function getPackage(id: string): Promise<PackageManifest> {
  await ready()
  return packageRegistry.get(id)
}

// ── Scenarios ──────────────────────────────────────────────────────────────

export async function listScenarios(): Promise<{ scenarios: ScenarioSummary[]; errors: RegistryError[] }> {
  await ready()
  return scenarioRegistry.listSummaries()
}

export async function getScenario(id: string): Promise<ScenarioDef> {
  await ready()
  return scenarioRegistry.get(id)
}

// ── Route presets (stub — later slice) ─────────────────────────────────────

export async function listRoutePresets(): Promise<{ presets: RoutePresetSummary[] }> {
  throw new Error('not implemented: listRoutePresets')
}

export async function loadRoutePreset(presetId: string): Promise<RouteEnvelope> {
  void presetId
  throw new Error('not implemented: loadRoutePreset')
}

// ── Routes / run-plans (M4 setup flow) ──────────────────────────────────────
//
// createRunPlan/regenerateRunPlan replicate app/api/aica_api/routers/run_plans.py's
// create_run_plan_endpoint / regenerate_run_plan_endpoint EXACTLY (body-shaping,
// validation order, error semantics), swapping the FastAPI route lookups for the
// local IndexedDB-backed registries and the FastAPI HTTPException(400/404) raises
// for a thrown Error. Field names in the constructed body/response are preserved
// byte-for-byte from the Python router.
//
// Error convention: app/frontend's `apiFetch` throws a plain `Error` on any
// non-2xx response (`err instanceof Error ? err.message : ...` is the only thing
// any consumer — see components/setup/PlanPreview.tsx — ever inspects). We
// preserve that shape (every failure here is a plain `Error`, always
// `instanceof Error`) while additionally exposing the router's `{detail,
// validation_errors}` body as typed fields on `RunPlanError` (mirroring the
// `FeedbackValidationError` pattern already established in `./types`), so
// tests / future UI can inspect the structured detail without parsing message
// strings.

/** Thrown by createRunPlan/regenerateRunPlan on any router-equivalent 400/404. */
export class RunPlanError extends Error {
  readonly validationErrors: ValidationError[]
  constructor(detail: string, validationErrors: ValidationError[] = []) {
    super(detail)
    this.name = 'RunPlanError'
    this.validationErrors = validationErrors
  }
}

/** Loose stand-in for Python's `!r` repr formatting used in router error messages. */
function pyReprValue(value: unknown): string {
  if (typeof value === 'string') return `'${value}'`
  return String(value)
}

// plan_id generation (S3.4): the Python router uses
// `plan_<YYYYMMDD-HHMMSS>_<6-hex>` (os.urandom + wall clock — the ONE place
// timestamps/randomness are allowed in the Python service). This engine must
// stay deterministic, so plan_id here is a monotonic in-memory counter
// instead; only uniqueness (never the exact format) is a contract any caller
// depends on.
let _planIdCounter = 0
function makePlanId(): string {
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

export async function routesAnalyze(args: {
  scenarioId: string
  mapsKey?: string
  start?: string
  end?: string
}): Promise<RouteEnvelope> {
  void args
  throw new Error('not implemented: routesAnalyze')
}

export async function createRunPlan(args: {
  packageId: string
  scenarioId: string
  parameters?: Record<string, SetupValue>
  hyperparameters?: Record<string, SetupValue>
  presets?: Record<string, unknown>
  runMode?: string
  // M4: route selection (optional — omitted for the local path)
  routeId?: string
  routeSource?: string
  routeFacts?: RouteFacts | null
  displayRoute?: DisplayRoute | null
  // T009: sparse profile overrides (omit entirely when nothing changed)
  profiles?: ProfileOverrides | null
  // Numeric starting driver-state override (omit to use scenario default)
  initialState?: { drowsiness_level?: number; fatigue_level?: number }
  // Boolean scenario context overrides
  contextOverrides?: { child_passenger?: boolean; familiar_route?: boolean }
}): Promise<RunPlanResponse> {
  await ready()

  // ── Package + scenario lookup (mirror pkg_reg.get / sc_reg.get 400s) ──────
  let pkgManifest: PackageManifest
  try {
    pkgManifest = await packageRegistry.get(args.packageId)
  } catch {
    throw new RunPlanError(`Package ${pyReprValue(args.packageId)} not found or invalid`)
  }

  let scenario: ScenarioDef
  try {
    scenario = await scenarioRegistry.get(args.scenarioId)
  } catch {
    throw new RunPlanError(`Scenario ${pyReprValue(args.scenarioId)} not found or invalid`)
  }

  if (!packageRegistry.isCompatible(pkgManifest, scenario)) {
    throw new RunPlanError(
      `Package ${pyReprValue(args.packageId)} is not compatible with scenario ${pyReprValue(args.scenarioId)} (type=${pyReprValue(scenario.type)})`,
    )
  }

  // ── M4 route selection validation ──────────────────────────────────────────
  const routeSource = args.routeSource ?? 'local'
  if (routeSource === 'maps') {
    if (args.routeId == null) {
      throw new RunPlanError(
        "route_id is required when route_source is 'maps'. Pass the route_id from the chosen /api/routes/analyze alternative.",
      )
    }
    if (args.routeFacts == null) {
      throw new RunPlanError(
        "route_facts is required when route_source is 'maps'. A run cannot be created without route facts. " +
          'Pass the route_facts from the chosen /api/routes/analyze alternative.',
      )
    }
  }

  // Local path discards any client-supplied route_facts / display_route —
  // local analysis is used exclusively (createDraft derives it fresh).
  const routeFacts = routeSource === 'maps' ? (args.routeFacts ?? null) : null
  const displayRoute = routeSource === 'maps' ? (args.displayRoute ?? null) : null

  const profilesDict: Record<string, unknown> | null = args.profiles ?? null

  // Validate initial_state override keys and ranges.
  if (args.initialState != null) {
    const initErrors = validateInitialStateBody(args.initialState)
    if (initErrors.length > 0) {
      throw new RunPlanError('One or more initial_state values are invalid.', initErrors)
    }
  }

  // Validate context_overrides keys and types.
  if (args.contextOverrides != null) {
    const ctxErrors = validateContextOverridesBody(args.contextOverrides)
    if (ctxErrors.length > 0) {
      throw new RunPlanError('One or more context_overrides values are invalid.', ctxErrors)
    }
  }

  const planId = makePlanId()
  const { draft } = createDraft({
    planId,
    package: pkgManifest as unknown as PackageManifestM2,
    scenario: scenario as unknown as ScenarioDefM2,
    presets: args.presets ?? {},
    parameters: args.parameters ?? {},
    hyperparameters: args.hyperparameters ?? {},
    runMode: args.runMode ?? 'standard',
    routeFacts,
    routeSource: routeSource as 'maps' | 'local',
    displayRoute,
    profiles: profilesDict,
    initialState: args.initialState ?? null,
    contextOverrides: args.contextOverrides ?? null,
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

export async function regenerateRunPlan(
  planId: string,
  args: {
    parameters?: Record<string, SetupValue>
    hyperparameters?: Record<string, SetupValue>
    presets?: Record<string, unknown>
  },
): Promise<RunPlanResponse> {
  if (getDraftEntry(planId) === null) {
    throw new RunPlanError(`Run plan ${pyReprValue(planId)} not found`)
  }

  let draft: ReturnType<typeof regenerateDraft>
  try {
    draft = regenerateDraft(planId, {
      presets: args.presets ?? {},
      parameters: args.parameters ?? {},
      hyperparameters: args.hyperparameters ?? {},
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

// ── Runs (stub — later slice) ───────────────────────────────────────────────

export async function createRun(planId: string): Promise<RunState> {
  void planId
  throw new Error('not implemented: createRun')
}

export async function tickRun(runId: string): Promise<TickResponse> {
  void runId
  throw new Error('not implemented: tickRun')
}

export async function actRun(
  runId: string,
  action: string,
  opts: { recovery_option_id?: string; rest_spot?: RestSpot } = {},
): Promise<RunState> {
  void runId
  void action
  void opts
  throw new Error('not implemented: actRun')
}

export async function getRestSpots(
  runId: string,
  mapsKey?: string,
  drowsinessCeiling?: number,
  minDistanceKm?: number,
): Promise<{ rest_spots: RestSpot[]; notice?: string | null }> {
  void runId
  void mapsKey
  void drowsinessCeiling
  void minDistanceKm
  throw new Error('not implemented: getRestSpots')
}

export async function listRuns(): Promise<{ runs: RunSummary[] }> {
  throw new Error('not implemented: listRuns')
}

export async function getRun(runId: string): Promise<RunState> {
  void runId
  throw new Error('not implemented: getRun')
}

export async function getRunLog(runId: string): Promise<RunLog> {
  void runId
  throw new Error('not implemented: getRunLog')
}

// ── M5 Feedback (stub — later slice) ────────────────────────────────────────

export async function getFeedbackSchema(runId: string): Promise<FeedbackSchema> {
  void runId
  throw new Error('not implemented: getFeedbackSchema')
}

export async function getEvidence(runId: string, uiLanguage?: string): Promise<EvidenceReport> {
  void runId
  void uiLanguage
  throw new Error('not implemented: getEvidence')
}

export async function getEvidenceMarkdown(runId: string, uiLanguage?: string): Promise<string> {
  void runId
  void uiLanguage
  throw new Error('not implemented: getEvidenceMarkdown')
}

export async function submitFeedback(
  runId: string,
  body: FeedbackSubmitBody,
): Promise<FeedbackEvent> {
  void runId
  void body
  throw new Error('not implemented: submitFeedback')
}
