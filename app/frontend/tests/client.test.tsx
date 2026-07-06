import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  listPackages,
  getPackage,
  listScenarios,
  getScenario,
  createRun,
  tickRun,
  actRun,
  listRuns,
  getRun,
  getRunLog,
} from '../src/api/client'
import type {
  PackageSummary,
  ScenarioSummary,
  RegistryError,
  PackageManifest,
  ScenarioDef,
  RunState,
  DecisionResult,
  AlgorithmError,
  RunLog,
  RunSummary,
} from '../src/api/types'

// ── helpers ──────────────────────────────────────────────────────────────────

function mockOk(body: unknown) {
  return {
    ok: true,
    json: async () => body,
  }
}

function mockNotOk(status = 404) {
  return { ok: false, status }
}

// ── fixtures ─────────────────────────────────────────────────────────────────

const pkgSummary: PackageSummary = {
  id: 'rest_rule_based_v0_1',
  version: '0.1.0',
  label: { ja: 'テスト', en: 'Test' },
  algorithm_type: 'declarative_rule',
  compatible_scenario_types: ['uc01_fatigue'],
}

const scenarioSummary: ScenarioSummary = {
  id: 'uc01_fatigue_friend_drive_v0_1',
  version: '0.1.0',
  type: 'uc01_fatigue',
  persona_label: 'Friend Drive',
  review_focus: 'Base trigger timing',
}

const registryError: RegistryError = {
  source: 'bad_pkg.json',
  message: 'unknown algorithm type',
}

const pkgManifest: PackageManifest = {
  id: 'rest_rule_based_v0_1',
  version: '0.1.0',
  label: { ja: 'テスト', en: 'Test' },
  compatible_scenario_types: ['uc01_fatigue'],
  algorithm: { type: 'declarative_rule', entrypoint: 'rules' },
  parameters: [],
  features: [],
  hyperparameters: [],
  trigger_categories: [{ id: 'rest_required', priority: 1 }],
  rules: [],
  fire_control: { threshold_source: 'score', actionability_guard: {} },
  proposals: [],
  feedback_schema: [],
  evidence_metrics: [],
}

const scenarioDef: ScenarioDef = {
  id: 'uc01_fatigue_friend_drive_v0_1',
  version: '0.1.0',
  type: 'uc01_fatigue',
  persona: {},
  route_intent: {
    rest_facility: { label: 'SA' },
    segments: [],
  },
  initial_state: { drowsiness_level: 'none', fatigue_level: 'low' },
  event_presets: {
    drowsiness_schedule: [],
    signal_duration_at_trigger: 'sustained',
  },
  run_seed_default: 42,
  total_duration_seconds: 3600,
  tick_seconds: 60,
  allowed_actions: ['accept_rest', 'postpone'],
  review_focus: 'Base trigger timing',
}

const runStateFixture: RunState = {
  run_id: 'run-abc',
  status: 'created',
  current_tick: 0,
  pending_proposal: null,
  package_runtime_state: {},
  snapshot: {
    package: { id: 'rest_rule_based_v0_1', version: '0.1.0', hash: 'abc' },
    scenario: { id: 'uc01_fatigue_friend_drive_v0_1', version: '0.1.0', hash: 'def' },
  },
  event_plan: {},
  route_facts: {},
}

const fireControl = { fired: false, suppressed: false, override: false, reason: null }

const decisionFixture: DecisionResult = {
  result_type: 'NO_TRIGGER',
  trigger_candidate: false,
  selected_category: null,
  score: null,
  features: {},
  scores: {},
  states: {},
  criteria: {},
  candidates: [],
  fire_control: fireControl,
  proposal: null,
  reason_inputs: [],
  explanation: 'No trigger',
  next_package_runtime_state: {},
}

const algErrorFixture: AlgorithmError = {
  tick_index: 1,
  error_type: 'invalid_return',
  message: 'Algorithm returned invalid shape',
}

const runSummaryFixture: RunSummary = {
  run_id: 'run-abc',
  created_at: '2026-06-27T00:00:00Z',
  package_id: 'rest_rule_based_v0_1',
  scenario_id: 'uc01_fatigue_friend_drive_v0_1',
  status: 'created',
}

const runLogFixture: RunLog = {
  run_id: 'run-abc',
  created_at: '2026-06-27T00:00:00Z',
  simulator_version: '0.1.0',
  snapshot: runStateFixture.snapshot,
  route_facts: {},
  event_plan: {},
  run_mode: 'standard',
  evidence_status: 'standard',
  events: [],
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('listPackages', () => {
  beforeEach(() => vi.resetAllMocks())

  it('calls GET /api/packages and returns typed body', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      mockOk({ packages: [pkgSummary], errors: [registryError] }),
    )
    const result = await listPackages()
    expect(global.fetch).toHaveBeenCalledWith('/api/packages', expect.objectContaining({ method: 'GET' }))
    expect(result.packages[0].id).toBe('rest_rule_based_v0_1')
    expect(result.errors[0].source).toBe('bad_pkg.json')
  })

  it('throws on non-ok response', async () => {
    global.fetch = vi.fn().mockResolvedValue(mockNotOk(500))
    await expect(listPackages()).rejects.toThrow('500')
  })
})

describe('getPackage', () => {
  beforeEach(() => vi.resetAllMocks())

  it('calls GET /api/packages/{id} and returns manifest', async () => {
    global.fetch = vi.fn().mockResolvedValue(mockOk(pkgManifest))
    const result = await getPackage('rest_rule_based_v0_1')
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/packages/rest_rule_based_v0_1',
      expect.objectContaining({ method: 'GET' }),
    )
    expect(result.algorithm.type).toBe('declarative_rule')
  })

  it('throws on 404', async () => {
    global.fetch = vi.fn().mockResolvedValue(mockNotOk(404))
    await expect(getPackage('missing')).rejects.toThrow('404')
  })
})

describe('listScenarios', () => {
  beforeEach(() => vi.resetAllMocks())

  it('calls GET /api/scenarios and returns typed body', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      mockOk({ scenarios: [scenarioSummary], errors: [] }),
    )
    const result = await listScenarios()
    expect(global.fetch).toHaveBeenCalledWith('/api/scenarios', expect.objectContaining({ method: 'GET' }))
    expect(result.scenarios[0].persona_label).toBe('Friend Drive')
    expect(result.errors).toHaveLength(0)
  })

  it('throws on non-ok response', async () => {
    global.fetch = vi.fn().mockResolvedValue(mockNotOk(500))
    await expect(listScenarios()).rejects.toThrow('500')
  })
})

describe('getScenario', () => {
  beforeEach(() => vi.resetAllMocks())

  it('calls GET /api/scenarios/{id} and returns full def', async () => {
    global.fetch = vi.fn().mockResolvedValue(mockOk(scenarioDef))
    const result = await getScenario('uc01_fatigue_friend_drive_v0_1')
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/scenarios/uc01_fatigue_friend_drive_v0_1',
      expect.objectContaining({ method: 'GET' }),
    )
    expect(result.allowed_actions).toContain('accept_rest')
  })

  it('throws on 404', async () => {
    global.fetch = vi.fn().mockResolvedValue(mockNotOk(404))
    await expect(getScenario('missing')).rejects.toThrow('404')
  })
})

describe('createRun', () => {
  beforeEach(() => vi.resetAllMocks())

  it('calls POST /api/runs with {plan_id} and returns RunState', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 201, json: async () => runStateFixture })
    const result = await createRun('plan_123')
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/runs',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ plan_id: 'plan_123' }),
      }),
    )
    expect(result.run_id).toBe('run-abc')
    expect(result.status).toBe('created')
  })

  it('throws on 400', async () => {
    global.fetch = vi.fn().mockResolvedValue(mockNotOk(400))
    await expect(createRun('bad_plan')).rejects.toThrow('400')
  })
})

// ── Feature 009 (UX-FE1): runPreview threads profiles/context_overrides ──────

describe('runPreview', () => {
  beforeEach(() => vi.resetAllMocks())

  const previewResult = {
    fired: false,
    fire: null,
    peak_score: 0.1,
    threshold: 0.6,
    score_series: [],
    segments: [],
    rest_spot: null,
    rest_option: null,
    completed_min: null,
    seed: 42,
    overrides: [],
    error: null,
  }

  it('POSTs /api/runs/preview with only the base fields when profiles/context_overrides are omitted', async () => {
    global.fetch = vi.fn().mockResolvedValue(mockOk(previewResult))
    const { runPreview } = await import('../src/api/client')
    await runPreview({
      package_id: 'pkg',
      scenario_id: 'scen',
      hyperparameter_overrides: { w: 1 },
      run_seed: 42,
    })
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/runs/preview',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          package_id: 'pkg',
          scenario_id: 'scen',
          hyperparameter_overrides: { w: 1 },
          run_seed: 42,
        }),
      }),
    )
  })

  it('includes profiles and context_overrides in the body when provided', async () => {
    global.fetch = vi.fn().mockResolvedValue(mockOk(previewResult))
    const { runPreview } = await import('../src/api/client')
    await runPreview({
      package_id: 'pkg',
      scenario_id: 'scen',
      hyperparameter_overrides: {},
      run_seed: 42,
      profiles: { driver: { drowsiness_model: { base_growth_per_min: 1.1 } } },
      context_overrides: { weather_risk: 65, child_passenger: true },
    })
    const sentBody = JSON.parse(
      (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string,
    )
    expect(sentBody.profiles).toEqual({ driver: { drowsiness_model: { base_growth_per_min: 1.1 } } })
    expect(sentBody.context_overrides).toEqual({ weather_risk: 65, child_passenger: true })
  })

  it('omits empty profiles/context_overrides objects (back-compat)', async () => {
    global.fetch = vi.fn().mockResolvedValue(mockOk(previewResult))
    const { runPreview } = await import('../src/api/client')
    await runPreview({
      package_id: 'pkg',
      scenario_id: 'scen',
      hyperparameter_overrides: {},
      run_seed: 42,
      profiles: {},
      context_overrides: {},
    })
    const sentBody = JSON.parse(
      (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string,
    )
    expect(sentBody.profiles).toBeUndefined()
    expect(sentBody.context_overrides).toBeUndefined()
  })
})

// ── M4 envelope fixture ───────────────────────────────────────────────────────

const localEnvelope = {
  route_source: 'local' as const,
  alternatives: [
    {
      route_id: 'local',
      summary: 'test-scenario',
      route_facts: {
        total_route_distance_km: 120,
        estimated_route_duration_min: 120,
        route_segments: [],
        rest_spot_positions: [],
        route_progress_checkpoints: [],
      },
      display: null,
      notices: [],
    },
  ],
}

describe('routesAnalyze / createRunPlan / regenerateRunPlan', () => {
  beforeEach(() => vi.resetAllMocks())

  // M4 migration: routesAnalyze now accepts an object arg and returns RouteEnvelope
  it('routesAnalyze POSTs /api/routes/analyze with {scenario_id} (local path)', async () => {
    global.fetch = vi.fn().mockResolvedValue(mockOk(localEnvelope))
    const { routesAnalyze } = await import('../src/api/client')
    const result = await routesAnalyze({ scenarioId: 'uc01_fatigue_friend_drive_v0_1' })
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/routes/analyze',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ scenario_id: 'uc01_fatigue_friend_drive_v0_1' }),
      }),
    )
    expect(result.route_source).toBe('local')
    expect(result.alternatives[0].route_id).toBe('local')
  })

  it('routesAnalyze POSTs maps_key/start/end when provided', async () => {
    const mapsEnv = {
      route_source: 'maps' as const,
      alternatives: [
        {
          route_id: 'route-0',
          summary: 'Via A',
          route_facts: {
            total_route_distance_km: 200,
            estimated_route_duration_min: 150,
            route_segments: [],
            rest_spot_positions: [],
            route_progress_checkpoints: [],
          },
          display: { encoded_polyline: 'abc', viewport: null },
          notices: [],
        },
      ],
    }
    global.fetch = vi.fn().mockResolvedValue(mockOk(mapsEnv))
    const { routesAnalyze } = await import('../src/api/client')
    const result = await routesAnalyze({
      scenarioId: 'uc01_fatigue_friend_drive_v0_1',
      mapsKey: 'my-key',
      start: 'Tokyo',
      end: 'Osaka',
    })
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/routes/analyze',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          scenario_id: 'uc01_fatigue_friend_drive_v0_1',
          maps_key: 'my-key',
          start: 'Tokyo',
          end: 'Osaka',
        }),
      }),
    )
    expect(result.route_source).toBe('maps')
  })

  it('routesAnalyze throws MapsError on 502', async () => {
    const errBody = { error_type: 'DIRECTIONS_ERROR', message: 'API failed', suggestion: 'Try local' }
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => ({ detail: errBody }),
    })
    const { routesAnalyze } = await import('../src/api/client')
    const { MapsError } = await import('../src/api/types')
    await expect(
      routesAnalyze({ scenarioId: 's', mapsKey: 'k', start: 'A', end: 'B' }),
    ).rejects.toBeInstanceOf(MapsError)
  })

  it('routesAnalyze throws on other non-ok responses', async () => {
    global.fetch = vi.fn().mockResolvedValue(mockNotOk(500))
    const { routesAnalyze } = await import('../src/api/client')
    await expect(routesAnalyze({ scenarioId: 's' })).rejects.toThrow('500')
  })

  it('createRunPlan POSTs /api/run-plans with the full body (local path, no route fields)', async () => {
    const resp = { plan_id: 'plan_abc', draft_plan: {}, effective_setup: {}, validation_errors: [] }
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 201, json: async () => resp })
    const { createRunPlan } = await import('../src/api/client')
    const result = await createRunPlan({
      packageId: 'rest_rule_based_v0_1',
      scenarioId: 'uc01_fatigue_friend_drive_v0_1',
      hyperparameters: { w_drowsiness: 0.4 },
    })
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/run-plans',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          package_id: 'rest_rule_based_v0_1',
          scenario_id: 'uc01_fatigue_friend_drive_v0_1',
          parameters: {},
          hyperparameters: { w_drowsiness: 0.4 },
          presets: {},
          run_mode: 'standard',
        }),
      }),
    )
    expect(result.plan_id).toBe('plan_abc')
  })

  it('createRunPlan includes route selection fields when provided', async () => {
    const resp = { plan_id: 'plan_xyz', draft_plan: {}, effective_setup: {}, validation_errors: [] }
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 201, json: async () => resp })
    const { createRunPlan } = await import('../src/api/client')
    await createRunPlan({
      packageId: 'pkg',
      scenarioId: 'scen',
      routeId: 'route-0',
      routeSource: 'maps',
      routeFacts: { total_route_distance_km: 200, estimated_route_duration_min: 150, route_segments: [], rest_spot_positions: [], route_progress_checkpoints: [] },
      displayRoute: { encoded_polyline: 'abc123', viewport: null },
    })
    const sentBody = JSON.parse(
      (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string,
    )
    expect(sentBody.route_id).toBe('route-0')
    expect(sentBody.route_source).toBe('maps')
    expect(sentBody.display_route.encoded_polyline).toBe('abc123')
  })

  it('createRunPlan throws on 400', async () => {
    global.fetch = vi.fn().mockResolvedValue(mockNotOk(400))
    const { createRunPlan } = await import('../src/api/client')
    await expect(
      createRunPlan({ packageId: 'p', scenarioId: 's' }),
    ).rejects.toThrow('400')
  })

  // UX-FE1: contextOverrides now also accepts weather_risk alongside the
  // existing child_passenger/familiar_route booleans.
  it('createRunPlan includes weather_risk in context_overrides when provided', async () => {
    const resp = { plan_id: 'plan_w', draft_plan: {}, effective_setup: {}, validation_errors: [] }
    global.fetch = vi.fn().mockResolvedValue(mockOk(resp))
    const { createRunPlan } = await import('../src/api/client')
    await createRunPlan({
      packageId: 'pkg',
      scenarioId: 'scen',
      contextOverrides: { weather_risk: 65, child_passenger: true },
    })
    const sentBody = JSON.parse(
      (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string,
    )
    expect(sentBody.context_overrides).toEqual({ weather_risk: 65, child_passenger: true })
  })

  it('regenerateRunPlan POSTs /api/run-plans/{id}/regenerate', async () => {
    const resp = { plan_id: 'plan_abc', draft_plan: {}, effective_setup: {}, validation_errors: [] }
    global.fetch = vi.fn().mockResolvedValue(mockOk(resp))
    const { regenerateRunPlan } = await import('../src/api/client')
    await regenerateRunPlan('plan_abc', { hyperparameters: { w_drowsiness: 0.5 } })
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/run-plans/plan_abc/regenerate',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          parameters: {},
          hyperparameters: { w_drowsiness: 0.5 },
          presets: {},
        }),
      }),
    )
  })
})

describe('tickRun', () => {
  beforeEach(() => vi.resetAllMocks())

  it('calls POST /api/runs/{id}/tick and returns TickResponse with decision', async () => {
    const tickBody = { run_state: { ...runStateFixture, status: 'playing' }, decision: decisionFixture, paused: false, completed: false }
    global.fetch = vi.fn().mockResolvedValue(mockOk(tickBody))
    const result = await tickRun('run-abc')
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/runs/run-abc/tick',
      expect.objectContaining({ method: 'POST' }),
    )
    expect('decision' in result).toBe(true)
    if ('decision' in result) {
      expect(result.decision.result_type).toBe('NO_TRIGGER')
      expect(result.paused).toBe(false)
      expect(result.completed).toBe(false)
    }
  })

  it('returns TickResponse with error when algorithm fails', async () => {
    const tickBody = { run_state: runStateFixture, error: algErrorFixture, paused: false }
    global.fetch = vi.fn().mockResolvedValue(mockOk(tickBody))
    const result = await tickRun('run-abc')
    expect('error' in result).toBe(true)
    if ('error' in result) {
      expect(result.error.error_type).toBe('invalid_return')
      expect(result.paused).toBe(false)
    }
  })

  it('throws on 404', async () => {
    global.fetch = vi.fn().mockResolvedValue(mockNotOk(404))
    await expect(tickRun('missing')).rejects.toThrow('404')
  })
})

describe('actRun', () => {
  beforeEach(() => vi.resetAllMocks())

  it('calls POST /api/runs/{id}/actions with action body and returns RunState', async () => {
    const resumedState = { ...runStateFixture, status: 'playing' }
    global.fetch = vi.fn().mockResolvedValue(mockOk(resumedState))
    const result = await actRun('run-abc', 'accept_rest')
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/runs/run-abc/actions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ action: 'accept_rest' }),
      }),
    )
    expect(result.status).toBe('playing')
  })

  it('throws on 409 (no pending proposal)', async () => {
    global.fetch = vi.fn().mockResolvedValue(mockNotOk(409))
    await expect(actRun('run-abc', 'accept_rest')).rejects.toThrow('409')
  })
})

describe('listRuns', () => {
  beforeEach(() => vi.resetAllMocks())

  it('calls GET /api/runs and returns list of RunSummary', async () => {
    global.fetch = vi.fn().mockResolvedValue(mockOk({ runs: [runSummaryFixture] }))
    const result = await listRuns()
    expect(global.fetch).toHaveBeenCalledWith('/api/runs', expect.objectContaining({ method: 'GET' }))
    expect(result.runs[0].run_id).toBe('run-abc')
    expect(result.runs[0].status).toBe('created')
  })

  it('throws on non-ok response', async () => {
    global.fetch = vi.fn().mockResolvedValue(mockNotOk(500))
    await expect(listRuns()).rejects.toThrow('500')
  })
})

describe('getRun', () => {
  beforeEach(() => vi.resetAllMocks())

  it('calls GET /api/runs/{id} and returns RunState', async () => {
    global.fetch = vi.fn().mockResolvedValue(mockOk(runStateFixture))
    const result = await getRun('run-abc')
    expect(global.fetch).toHaveBeenCalledWith('/api/runs/run-abc', expect.objectContaining({ method: 'GET' }))
    expect(result.run_id).toBe('run-abc')
  })

  it('throws on 404', async () => {
    global.fetch = vi.fn().mockResolvedValue(mockNotOk(404))
    await expect(getRun('missing')).rejects.toThrow('404')
  })
})

describe('getRunLog', () => {
  beforeEach(() => vi.resetAllMocks())

  it('calls GET /api/runs/{id}/log and returns RunLog', async () => {
    global.fetch = vi.fn().mockResolvedValue(mockOk(runLogFixture))
    const result = await getRunLog('run-abc')
    expect(global.fetch).toHaveBeenCalledWith('/api/runs/run-abc/log', expect.objectContaining({ method: 'GET' }))
    expect(result.run_id).toBe('run-abc')
    expect(result.run_mode).toBe('standard')
    expect(Array.isArray(result.events)).toBe(true)
  })

  it('throws on 404', async () => {
    global.fetch = vi.fn().mockResolvedValue(mockNotOk(404))
    await expect(getRunLog('missing')).rejects.toThrow('404')
  })
})
