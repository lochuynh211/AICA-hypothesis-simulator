import type {
  PackageSummary,
  PackageManifest,
  ScenarioSummary,
  ScenarioDef,
  RegistryError,
  RouteFacts,
  DisplayRoute,
  RouteEnvelope,
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
} from './types'
import { MapsError, FeedbackValidationError } from './types'

export type HealthStatus = {
  status: string
  service: string
  version: string
}

// ── Internal helper ────────────────────────────────────────────────────────

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, init)
  if (!response.ok) {
    throw new Error(`API error: ${response.status}`)
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

// ── Routes / run-plans (M4 setup flow) ────────────────────────────────────────
//
// routesAnalyze now returns the envelope {route_source, alternatives:[...]}.
// Maps path: pass mapsKey + start + end.  Local path: omit them.
// HTTP 502 from the maps path is surfaced as a MapsError (structured body).
// The API key is never stored, logged, or echoed in any error.

export async function routesAnalyze(args: {
  scenarioId: string
  mapsKey?: string
  start?: string
  end?: string
}): Promise<RouteEnvelope> {
  const body: Record<string, string> = { scenario_id: args.scenarioId }
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
    throw new Error(`API error: ${response.status}`)
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
}): Promise<RunPlanResponse> {
  const body: Record<string, unknown> = {
    package_id: args.packageId,
    scenario_id: args.scenarioId,
    parameters: args.parameters ?? {},
    hyperparameters: args.hyperparameters ?? {},
    presets: args.presets ?? {},
    run_mode: args.runMode ?? 'standard',
  }
  // Only include route selection fields when explicitly provided
  if (args.routeId !== undefined) body.route_id = args.routeId
  if (args.routeSource !== undefined) body.route_source = args.routeSource
  if (args.routeFacts !== undefined) body.route_facts = args.routeFacts
  if (args.displayRoute !== undefined) body.display_route = args.displayRoute
  // T009: include profiles only when non-empty (back-compat: omit for unchanged defaults)
  if (args.profiles != null && Object.keys(args.profiles).length > 0) {
    body.profiles = args.profiles
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

export async function actRun(runId: string, action: string): Promise<RunState> {
  return apiFetch(`/api/runs/${runId}/actions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
  })
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
    throw new Error(`API error: ${response.status}`)
  }
  return response.json() as Promise<FeedbackEvent>
}
