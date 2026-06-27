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
  driver_profile: {},
  vehicle_profile: {},
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

  it('calls POST /api/runs with body and returns RunState', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 201, json: async () => runStateFixture })
    const result = await createRun('rest_rule_based_v0_1', 'uc01_fatigue_friend_drive_v0_1')
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/runs',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ package_id: 'rest_rule_based_v0_1', scenario_id: 'uc01_fatigue_friend_drive_v0_1' }),
      }),
    )
    expect(result.run_id).toBe('run-abc')
    expect(result.status).toBe('created')
  })

  it('throws on 400', async () => {
    global.fetch = vi.fn().mockResolvedValue(mockNotOk(400))
    await expect(createRun('bad', 'bad')).rejects.toThrow('400')
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
