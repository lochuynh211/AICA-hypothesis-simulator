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
} from './types'
import { packageRegistry } from '../engine/services/package_registry'
import { scenarioRegistry } from '../engine/services/scenario_registry'
import { seedDefaults } from '../storage/db'
import pkg from '../../package.json'

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

// ── Routes / run-plans (M4 setup flow) (stub — later slice) ────────────────

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
  void args
  throw new Error('not implemented: createRunPlan')
}

export async function regenerateRunPlan(
  planId: string,
  args: {
    parameters?: Record<string, SetupValue>
    hyperparameters?: Record<string, SetupValue>
    presets?: Record<string, unknown>
  },
): Promise<RunPlanResponse> {
  void planId
  void args
  throw new Error('not implemented: regenerateRunPlan')
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
