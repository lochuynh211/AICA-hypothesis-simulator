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
  ContextOverrides,
  RestSpot,
  RunConfig,
  InstantResult,
} from './types'
import { MapsError, FeedbackValidationError } from './types'
import type { BilingualLabel } from '../i18n/t'

export type HealthStatus = {
  status: string
  service: string
  version: string
}

// ── Internal helper ────────────────────────────────────────────────────────

/**
 * A generic HTTP-status failure. Carries a bilingual `.bilingual` pair so a
 * caller that knows the active UI language can resolve a JA/EN-appropriate
 * message via `t()` instead of showing raw English — `.message` stays a
 * plain English string only for logging / callers that predate this and
 * only ever read `.message`.
 */
function apiError(status: number): Error & { bilingual: BilingualLabel } {
  return Object.assign(new Error(`API error: ${status}`), {
    bilingual: { ja: `API エラー（${status}）`, en: `API error (${status})` },
  })
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, init)
  if (!response.ok) {
    throw apiError(response.status)
  }
  return response.json() as Promise<T>
}

// ── Health ─────────────────────────────────────────────────────────────────

export async function getHealth(): Promise<HealthStatus> {
  const response = await fetch('/api/health')
  if (!response.ok) {
    throw new Error(`Health check failed: ${response.status}`)
  }
  const data = await response.json()
  if (
    typeof data?.status !== 'string' ||
    typeof data?.service !== 'string' ||
    typeof data?.version !== 'string'
  ) {
    throw new Error('Unexpected health response shape')
  }
  return data as HealthStatus
}

// ── Packages ───────────────────────────────────────────────────────────────

export async function listPackages(): Promise<{ packages: PackageSummary[]; errors: RegistryError[] }> {
  return apiFetch('/api/packages', { method: 'GET' })
}

export async function getPackage(id: string): Promise<PackageManifest> {
  return apiFetch(`/api/packages/${id}`, { method: 'GET' })
}

// ── Scenarios ──────────────────────────────────────────────────────────────

export async function listScenarios(): Promise<{ scenarios: ScenarioSummary[]; errors: RegistryError[] }> {
  return apiFetch('/api/scenarios', { method: 'GET' })
}

export async function getScenario(id: string): Promise<ScenarioDef> {
  return apiFetch(`/api/scenarios/${id}`, { method: 'GET' })
}

// ── Route presets ─────────────────────────────────────────────────────────────

export async function listRoutePresets(): Promise<{ presets: RoutePresetSummary[] }> {
  return apiFetch('/api/routes/presets', { method: 'GET' })
}

export async function loadRoutePreset(presetId: string): Promise<RouteEnvelope> {
  return apiFetch(`/api/routes/presets/${presetId}/load`, { method: 'POST' })
}

// ── Routes / run-plans (M4 setup flow) ────────────────────────────────────────
//
// routesAnalyze now returns the envelope {route_source, alternatives:[...]}.
// Maps path: pass mapsKey + start + end.  Local path: omit them.
// HTTP 502 from the maps path is surfaced as a MapsError (structured body).
// The API key is never stored, logged, or echoed in any error.

export async function routesAnalyze(args: {
  // Optional (feature 009 route-first): a Maps search can run before a scenario
  // is chosen. Omitted → the backend derives the route from Maps alone.
  scenarioId?: string
  mapsKey?: string
  start?: string
  end?: string
}): Promise<RouteEnvelope> {
  const body: Record<string, string> = {}
  if (args.scenarioId) body.scenario_id = args.scenarioId
  if (args.mapsKey) body.maps_key = args.mapsKey
  if (args.start) body.start = args.start
  if (args.end) body.end = args.end

  const response = await fetch('/api/routes/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  // 502 carries a structured Maps error (key is never in this body)
  if (response.status === 502) {
    const errJson = await response.json()
    throw new MapsError(errJson.detail)
  }

  if (!response.ok) {
    throw apiError(response.status)
  }

  return response.json() as Promise<RouteEnvelope>
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
  // Fixed-tier scenario context overrides (child_passenger/familiar_route/weather_risk)
  contextOverrides?: ContextOverrides
  // Fix (whole-branch review, feature 009): explicit run_seed so "Open full
  // run" persists under the SAME seed the preview/setup screen showed
  // (omit to fall back to scenario.run_seed_default, unchanged behavior).
  runSeed?: number
}): Promise<RunPlanResponse> {
  const body: Record<string, unknown> = {
    package_id: args.packageId,
    scenario_id: args.scenarioId,
    parameters: args.parameters ?? {},
    hyperparameters: args.hyperparameters ?? {},
    presets: args.presets ?? {},
    run_mode: args.runMode ?? 'standard',
  }
  if (args.runSeed !== undefined) body.run_seed = args.runSeed
  // Only include route selection fields when explicitly provided
  if (args.routeId !== undefined) body.route_id = args.routeId
  if (args.routeSource !== undefined) body.route_source = args.routeSource
  if (args.routeFacts !== undefined) body.route_facts = args.routeFacts
  if (args.displayRoute !== undefined) body.display_route = args.displayRoute
  // T009: include profiles only when non-empty (back-compat: omit for unchanged defaults)
  if (args.profiles != null && Object.keys(args.profiles).length > 0) {
    body.profiles = args.profiles
  }
  // include initial_state only when at least one dimension is set
  if (args.initialState != null && Object.keys(args.initialState).length > 0) {
    body.initial_state = args.initialState
  }
  // include context_overrides only when provided
  if (args.contextOverrides != null && Object.keys(args.contextOverrides).length > 0) {
    body.context_overrides = args.contextOverrides
  }

  return apiFetch('/api/run-plans', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function regenerateRunPlan(
  planId: string,
  args: {
    parameters?: Record<string, SetupValue>
    hyperparameters?: Record<string, SetupValue>
    presets?: Record<string, unknown>
  },
): Promise<RunPlanResponse> {
  return apiFetch(`/api/run-plans/${planId}/regenerate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      parameters: args.parameters ?? {},
      hyperparameters: args.hyperparameters ?? {},
      presets: args.presets ?? {},
    }),
  })
}

// ── Runs ───────────────────────────────────────────────────────────────────

/**
 * Ephemeral, non-persisting instant-result preview (feature 009, US1).
 *
 * Runs the full tick loop for the given RunConfig through the SAME tick
 * engine + algorithm adapter as a persisted run, but writes NOTHING to
 * runs/ — safe to call on every setup-screen edit. `restOptionId` optionally
 * pins which recovery option the preview auto-accepts on the first proposal
 * (defaults to the scenario's first recovery option when omitted).
 */
export async function runPreview(
  config: RunConfig,
  restOptionId?: string | null,
): Promise<InstantResult> {
  const body: Record<string, unknown> = {
    package_id: config.package_id,
    scenario_id: config.scenario_id,
    hyperparameter_overrides: config.hyperparameter_overrides,
    run_seed: config.run_seed,
  }
  if (restOptionId !== undefined) body.rest_option_id = restOptionId
  // Feature 009 (FE1): thread sparse profile/context overrides through to the
  // preview — same shape as CreateRunPlanBody so a preview computed with the
  // same overrides as a subsequent "Open full run" matches it exactly. Omit
  // when empty (back-compat — every existing caller still works unchanged).
  if (config.profiles != null && Object.keys(config.profiles).length > 0) {
    body.profiles = config.profiles
  }
  if (config.context_overrides != null && Object.keys(config.context_overrides).length > 0) {
    body.context_overrides = config.context_overrides
  }
  // UX fix: thread the selected Maps/preset route so the preview runs against it
  // (distance/duration/segments/rest spots) instead of the scenario default.
  // Only when route_source=="maps" with route_facts present (local path unchanged).
  if (config.route_source === 'maps' && config.route_facts != null) {
    body.route_source = 'maps'
    if (config.route_id != null) body.route_id = config.route_id
    body.route_facts = config.route_facts
    if (config.display_route != null) body.display_route = config.display_route
  }
  return apiFetch('/api/runs/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function createRun(planId: string): Promise<RunState> {
  return apiFetch('/api/runs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ plan_id: planId }),
  })
}

export async function tickRun(runId: string): Promise<TickResponse> {
  return apiFetch(`/api/runs/${runId}/tick`, { method: 'POST' })
}

export async function actRun(
  runId: string,
  action: string,
  opts: { recovery_option_id?: string; rest_spot?: RestSpot } = {},
): Promise<RunState> {
  return apiFetch(`/api/runs/${runId}/actions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...opts }),
  })
}

export async function getRestSpots(
  runId: string,
  mapsKey?: string,
  drowsinessCeiling?: number,
  minDistanceKm?: number,
): Promise<{ rest_spots: RestSpot[]; notice?: string | null }> {
  const params = new URLSearchParams()
  if (mapsKey) params.set('maps_key', mapsKey)
  if (drowsinessCeiling !== undefined) params.set('drowsiness_ceiling', String(drowsinessCeiling))
  if (minDistanceKm !== undefined) params.set('min_distance_km', String(minDistanceKm))
  const q = params.toString() ? `?${params.toString()}` : ''
  return apiFetch(`/api/runs/${runId}/rest-spots${q}`, { method: 'GET' })
}

export async function listRuns(): Promise<{ runs: RunSummary[] }> {
  return apiFetch('/api/runs', { method: 'GET' })
}

export async function getRun(runId: string): Promise<RunState> {
  return apiFetch(`/api/runs/${runId}`, { method: 'GET' })
}

export async function getRunLog(runId: string): Promise<RunLog> {
  return apiFetch(`/api/runs/${runId}/log`, { method: 'GET' })
}

// ── M5 Feedback ────────────────────────────────────────────────────────────

/** Fetch the effective feedback schema for a run's package. */
export async function getFeedbackSchema(runId: string): Promise<FeedbackSchema> {
  return apiFetch(`/api/runs/${runId}/feedback-schema`, { method: 'GET' })
}

/**
 * Fetch the §14.2 evidence report for a run (derived, not persisted).
 *
 * @param runId      The run to export.
 * @param uiLanguage Optional language tag passed as ?ui_language= query param.
 *                   When omitted the backend defaults to 'bilingual' (back-compat).
 */
export async function getEvidence(runId: string, uiLanguage?: string): Promise<EvidenceReport> {
  const qs = uiLanguage ? `?ui_language=${encodeURIComponent(uiLanguage)}` : ''
  return apiFetch(`/api/runs/${runId}/evidence${qs}`, { method: 'GET' })
}

/**
 * Fetch the §14.2 evidence report for a run as human-readable Markdown (S8).
 *
 * Calls GET /api/runs/{runId}/evidence.md which returns text/markdown.
 * The Markdown has the same facts as the JSON evidence endpoint — derived
 * from build_evidence_report, not a separate computation.
 * Separation preserved: ## Simulator Facts / ## Human Review.
 *
 * @param runId      The run to export (active or past run).
 * @param uiLanguage Optional language tag passed as ?ui_language=.
 *                   When omitted the backend defaults to 'bilingual'.
 */
export async function getEvidenceMarkdown(runId: string, uiLanguage?: string): Promise<string> {
  const qs = uiLanguage ? `?ui_language=${encodeURIComponent(uiLanguage)}` : ''
  const response = await fetch(`/api/runs/${runId}/evidence.md${qs}`, { method: 'GET' })
  if (!response.ok) {
    throw apiError(response.status)
  }
  return response.text()
}

/**
 * Submit reviewer feedback for a run.
 * Throws FeedbackValidationError (with validationErrors list) on 400.
 * Throws Error on other non-2xx responses.
 */
export async function submitFeedback(
  runId: string,
  body: FeedbackSubmitBody,
): Promise<FeedbackEvent> {
  const response = await fetch(`/api/runs/${runId}/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (response.status === 400) {
    const errJson = await response.json()
    throw new FeedbackValidationError(errJson.detail ?? errJson)
  }
  if (!response.ok) {
    throw apiError(response.status)
  }
  return response.json() as Promise<FeedbackEvent>
}
