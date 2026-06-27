import type {
  PackageSummary,
  PackageManifest,
  ScenarioSummary,
  ScenarioDef,
  RegistryError,
  RunState,
  RunSummary,
  TickResponse,
  RunLog,
} from './types'

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

// ── Runs ───────────────────────────────────────────────────────────────────

export async function createRun(packageId: string, scenarioId: string): Promise<RunState> {
  return apiFetch('/api/runs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ package_id: packageId, scenario_id: scenarioId }),
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
