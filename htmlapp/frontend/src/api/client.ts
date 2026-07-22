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
 * the local tick engine, evidence builder, etc.), wired through the RPC
 * router/dispatch layer introduced by Task S1.
 *
 * S1: each of the 23 exported functions is a thin dispatcher over dispatch()
 * → router → handler, keeping the 23 external signatures byte-identical.
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
  RunConfig,
  InstantResult,
} from './types'
import { transport } from './transport'
import { unwrap, type RpcRequest, type RpcResponse } from './rpc'

export type HealthStatus = {
  status: string
  service: string
  version: string
}

// Re-export error classes so callers can `instanceof` them.
export { MapsError, FeedbackValidationError } from './types'
export { RunPlanError } from './errors'

async function call<T>(op: RpcRequest['op'], params?: unknown): Promise<T> {
  return unwrap<T>(await transport.call({ op, params }) as RpcResponse<T>)
}

// ── Health ─────────────────────────────────────────────────────────────────

export async function getHealth(): Promise<HealthStatus> {
  return call('health.get')
}

// ── Packages ───────────────────────────────────────────────────────────────

export async function listPackages(): Promise<{ packages: PackageSummary[]; errors: RegistryError[] }> {
  return call('packages.list')
}

export async function getPackage(id: string): Promise<PackageManifest> {
  return call('packages.get', { id })
}

export async function addUserPackage(source: string): Promise<PackageSummary> {
  return call('packages.addUser', { source })
}

// ── Scenarios ──────────────────────────────────────────────────────────────

export async function listScenarios(): Promise<{ scenarios: ScenarioSummary[]; errors: RegistryError[] }> {
  return call('scenarios.list')
}

export async function getScenario(id: string): Promise<ScenarioDef> {
  return call('scenarios.get', { id })
}

// ── Route presets ─────────────────────────────────────────────────────────

export async function listRoutePresets(): Promise<{ presets: RoutePresetSummary[] }> {
  return call('routes.presets.list')
}

export async function loadRoutePreset(presetId: string): Promise<RouteEnvelope> {
  return call('routes.presets.load', { presetId })
}

// ── Routes ─────────────────────────────────────────────────────────────────

export async function routesAnalyze(args: {
  scenarioId?: string
  mapsKey?: string
  start?: string
  end?: string
}): Promise<RouteEnvelope> {
  return call('routes.analyze', args)
}

// ── Run plans ──────────────────────────────────────────────────────────────

export async function createRunPlan(args: {
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
  return call('runPlans.create', args)
}

export async function regenerateRunPlan(
  planId: string,
  args: {
    parameters?: Record<string, SetupValue>
    hyperparameters?: Record<string, SetupValue>
    presets?: Record<string, unknown>
  },
): Promise<RunPlanResponse> {
  return call('runPlans.regenerate', { planId, patch: args })
}

// ── Preview ─────────────────────────────────────────────────────────────────

export async function runPreview(config: RunConfig, restOptionId?: string | null): Promise<InstantResult> {
  return call('runs.preview', { config, restOptionId })
}

// ── Runs ───────────────────────────────────────────────────────────────────

export async function createRun(planId: string): Promise<RunState> {
  return call('runs.create', { planId })
}

export async function tickRun(runId: string): Promise<TickResponse> {
  return call('runs.tick', { runId })
}

export async function actRun(
  runId: string,
  action: string,
  opts: { recovery_option_id?: string; rest_spot?: RestSpot } = {},
): Promise<RunState> {
  return call('runs.act', { runId, action, opts })
}

export async function getRestSpots(
  runId: string,
  mapsKey?: string,
  drowsinessCeiling?: number,
  minDistanceKm?: number,
): Promise<{ rest_spots: RestSpot[]; notice?: string | null }> {
  return call('runs.restSpots', { runId, mapsKey, drowsinessCeiling, minDistanceKm })
}

export async function listRuns(): Promise<{ runs: RunSummary[] }> {
  return call('runs.list')
}

export async function getRun(runId: string): Promise<RunState> {
  return call('runs.state', { runId })
}

export async function getRunLog(runId: string): Promise<RunLog> {
  return call('runs.log', { runId })
}

// ── Feedback ──────────────────────────────────────────────────────────────

export async function getFeedbackSchema(runId: string): Promise<FeedbackSchema> {
  return call('feedback.schema', { runId })
}

// ── Evidence ─────────────────────────────────────────────────────────────

export async function getEvidence(runId: string, uiLanguage?: string): Promise<EvidenceReport> {
  return call('evidence.get', { runId, uiLanguage })
}

export async function getEvidenceMarkdown(runId: string, uiLanguage?: string): Promise<string> {
  return call('evidence.md', { runId, uiLanguage })
}

export async function submitFeedback(runId: string, body: FeedbackSubmitBody): Promise<FeedbackEvent> {
  return call('feedback.submit', { runId, body })
}
