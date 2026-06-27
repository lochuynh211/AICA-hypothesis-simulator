/**
 * T031 — Frontend: validation-error display (US4)
 *
 * Verifies that:
 * - Registry errors returned by GET /api/packages are surfaced in PackageSelector
 *   ("N package(s) could not be loaded") instead of swallowed.
 * - Registry errors returned by GET /api/scenarios are surfaced in ScenarioSelector
 *   ("N scenario(s) could not be loaded").
 * - A createRun failure (e.g. 400 incompatible pairing) surfaces a visible error
 *   message near the Start Run button and does NOT create a run (no RUN_CREATED).
 * - The store correctly stores packageErrors / scenarioErrors / runError.
 */

import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { renderHook } from '@testing-library/react'
import { RunStoreProvider, useRunStore } from '../src/state/runStore'
import type { RunStoreAction } from '../src/state/runStore'
import type { RegistryError, PackageSummary, ScenarioSummary } from '../src/api/types'

// ── Mock the client module ────────────────────────────────────────────────────

vi.mock('../src/api/client', () => ({
  listPackages: vi.fn(),
  listScenarios: vi.fn(),
  createRun: vi.fn(),
  createRunPlan: vi.fn(),
  regenerateRunPlan: vi.fn(),
  routesAnalyze: vi.fn(),
  actRun: vi.fn(),
  tickRun: vi.fn(),
  getPackage: vi.fn(),
  getScenario: vi.fn(),
  listRuns: vi.fn(),
  getRun: vi.fn(),
  getRunLog: vi.fn(),
  getHealth: vi.fn(),
}))

import * as client from '../src/api/client'

import PackageSelector from '../src/components/setup/PackageSelector'
import ScenarioSelector from '../src/components/setup/ScenarioSelector'
import PlanPreview from '../src/components/setup/PlanPreview'

// ── Fixtures ──────────────────────────────────────────────────────────────────

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

const packageRegistryError: RegistryError = {
  source: 'bad_pkg/package.json',
  message: 'Input should be declarative_rule [type=literal_error]',
}

const scenarioRegistryError: RegistryError = {
  source: 'bad_scenario.json',
  message: 'Field required [type=missing]',
}

// ── Store helper (mirrors playback.test.tsx pattern) ─────────────────────────

function renderInStore(
  ui: React.ReactElement,
  setupFn?: (dispatch: React.Dispatch<RunStoreAction>) => void,
) {
  const dispatchRef: { current: React.Dispatch<RunStoreAction> | null } = { current: null }

  function DispatchCapture() {
    const { dispatch } = useRunStore()
    dispatchRef.current = dispatch
    return null
  }

  const result = render(
    <RunStoreProvider>
      <DispatchCapture />
      {ui}
    </RunStoreProvider>,
  )

  if (setupFn && dispatchRef.current) {
    act(() => setupFn(dispatchRef.current!))
  }

  return result
}

// ── T031a: PackageSelector surfaces registry errors ───────────────────────────

describe('PackageSelector — registry error display', () => {
  beforeEach(() => vi.resetAllMocks())

  it('shows N package(s) could not be loaded when errors are returned', async () => {
    vi.mocked(client.listPackages).mockResolvedValue({
      packages: [],
      errors: [packageRegistryError],
    })

    renderInStore(<PackageSelector />)

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(await screen.findByText('1 package(s) could not be loaded')).toBeInTheDocument()
  })

  it('shows count matching the number of errors', async () => {
    vi.mocked(client.listPackages).mockResolvedValue({
      packages: [pkgSummary],
      errors: [packageRegistryError, { source: 'another.json', message: 'bad' }],
    })

    renderInStore(<PackageSelector />)

    expect(await screen.findByText('2 package(s) could not be loaded')).toBeInTheDocument()
  })

  it('does NOT show the error banner when there are no errors', async () => {
    vi.mocked(client.listPackages).mockResolvedValue({
      packages: [pkgSummary],
      errors: [],
    })

    renderInStore(<PackageSelector />)

    // Wait for packages to load
    await screen.findByText('Test (0.1.0)')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('loads valid packages into the selector alongside errors', async () => {
    vi.mocked(client.listPackages).mockResolvedValue({
      packages: [pkgSummary],
      errors: [packageRegistryError],
    })

    renderInStore(<PackageSelector />)

    expect(await screen.findByText('Test (0.1.0)')).toBeInTheDocument()
    expect(await screen.findByText('1 package(s) could not be loaded')).toBeInTheDocument()
  })
})

// ── T031b: ScenarioSelector surfaces registry errors ─────────────────────────

describe('ScenarioSelector — registry error display', () => {
  beforeEach(() => vi.resetAllMocks())

  it('shows N scenario(s) could not be loaded when errors are returned', async () => {
    vi.mocked(client.listScenarios).mockResolvedValue({
      scenarios: [],
      errors: [scenarioRegistryError],
    })

    renderInStore(<ScenarioSelector />)

    expect(await screen.findByText('1 scenario(s) could not be loaded')).toBeInTheDocument()
    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })

  it('does NOT show the error banner when there are no errors', async () => {
    vi.mocked(client.listScenarios).mockResolvedValue({
      scenarios: [scenarioSummary],
      errors: [],
    })

    renderInStore(<ScenarioSelector />)

    await screen.findByText(/Friend Drive/)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

// ── T031c: PlanPreview surfaces createRun failure (plan_id flow) ─────────────

/** Render PlanPreview with a drafted plan already in the store, plus a state probe. */
function renderPreviewWithDraft(
  stateRef: { current: ReturnType<typeof useRunStore>['state'] | null },
) {
  function StateProbe() {
    const { state } = useRunStore()
    stateRef.current = state
    return null
  }
  return renderInStore(
    <>
      <StateProbe />
      <PlanPreview />
    </>,
    (dispatch) => {
      dispatch({ type: 'SELECT_PACKAGE', id: 'rest_rule_based_v0_1' })
      dispatch({ type: 'SELECT_SCENARIO', id: 'uc01_fatigue_friend_drive_v0_1' })
      dispatch({ type: 'PLAN_DRAFTED', planId: 'plan_x', draftPlan: {}, effectiveSetup: { run_mode: 'standard' } })
    },
  )
}

describe('PlanPreview — createRun error display', () => {
  beforeEach(() => vi.resetAllMocks())

  it('shows error message when createRun rejects with 400', async () => {
    vi.mocked(client.createRun).mockRejectedValue(new Error('API error: 400'))

    const stateRef: { current: ReturnType<typeof useRunStore>['state'] | null } = { current: null }
    renderPreviewWithDraft(stateRef)

    fireEvent.click(screen.getByRole('button', { name: /start run/i }))

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(await screen.findByText(/API error: 400/)).toBeInTheDocument()
  })

  it('does not start a run when createRun fails', async () => {
    vi.mocked(client.createRun).mockRejectedValue(new Error('API error: 400'))

    const stateRef: { current: ReturnType<typeof useRunStore>['state'] | null } = { current: null }
    renderPreviewWithDraft(stateRef)

    fireEvent.click(screen.getByRole('button', { name: /start run/i }))

    await screen.findByRole('alert')
    expect(vi.mocked(client.createRun)).toHaveBeenCalledWith('plan_x')
    // No run state was created
    expect(stateRef.current?.runState).toBeNull()
  })

  it('clears error message when a run is subsequently created', async () => {
    vi.mocked(client.createRun).mockRejectedValueOnce(new Error('API error: 400'))

    const stateRef: { current: ReturnType<typeof useRunStore>['state'] | null } = { current: null }
    renderPreviewWithDraft(stateRef)

    fireEvent.click(screen.getByRole('button', { name: /start run/i }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()

    const runState = {
      run_id: 'run-ok',
      status: 'created' as const,
      current_tick: 0,
      pending_proposal: null,
      package_runtime_state: {},
      snapshot: {
        package: { id: 'rest_rule_based_v0_1', version: '0.1.0', hash: 'a' },
        scenario: { id: 'uc01_fatigue_friend_drive_v0_1', version: '0.1.0', hash: 'b' },
      },
      event_plan: {},
      route_facts: {},
    }
    vi.mocked(client.createRun).mockResolvedValueOnce(runState)

    fireEvent.click(screen.getByRole('button', { name: /start run/i }))

    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })
  })
})

// ── T031d: Store state — packageErrors / scenarioErrors / runError ─────────

describe('runStore — packageErrors / scenarioErrors / runError', () => {
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(RunStoreProvider, null, children)

  it('initialises with empty packageErrors and scenarioErrors', () => {
    const { result } = renderHook(() => useRunStore(), { wrapper })
    expect(result.current.state.packageErrors).toEqual([])
    expect(result.current.state.scenarioErrors).toEqual([])
    expect(result.current.state.runError).toBeNull()
  })

  it('LOAD_PACKAGES stores errors in packageErrors', () => {
    const { result } = renderHook(() => useRunStore(), { wrapper })
    act(() =>
      result.current.dispatch({
        type: 'LOAD_PACKAGES',
        packages: [],
        errors: [packageRegistryError],
      })
    )
    expect(result.current.state.packageErrors).toHaveLength(1)
    expect(result.current.state.packageErrors[0].source).toBe('bad_pkg/package.json')
  })

  it('LOAD_SCENARIOS stores errors in scenarioErrors', () => {
    const { result } = renderHook(() => useRunStore(), { wrapper })
    act(() =>
      result.current.dispatch({
        type: 'LOAD_SCENARIOS',
        scenarios: [],
        errors: [scenarioRegistryError],
      })
    )
    expect(result.current.state.scenarioErrors).toHaveLength(1)
    expect(result.current.state.scenarioErrors[0].source).toBe('bad_scenario.json')
  })

  it('LOAD_PACKAGES without errors defaults packageErrors to []', () => {
    const { result } = renderHook(() => useRunStore(), { wrapper })
    act(() =>
      result.current.dispatch({ type: 'LOAD_PACKAGES', packages: [pkgSummary] })
    )
    expect(result.current.state.packageErrors).toEqual([])
  })

  it('SET_RUN_ERROR sets runError', () => {
    const { result } = renderHook(() => useRunStore(), { wrapper })
    act(() =>
      result.current.dispatch({ type: 'SET_RUN_ERROR', message: 'API error: 400' })
    )
    expect(result.current.state.runError).toBe('API error: 400')
  })

  it('RUN_CREATED clears runError', () => {
    const { result } = renderHook(() => useRunStore(), { wrapper })
    act(() => result.current.dispatch({ type: 'SET_RUN_ERROR', message: 'API error: 400' }))
    act(() =>
      result.current.dispatch({
        type: 'RUN_CREATED',
        runState: {
          run_id: 'run-x',
          status: 'created',
          current_tick: 0,
          pending_proposal: null,
          package_runtime_state: {},
          snapshot: {
            package: { id: 'p', version: '1', hash: 'a' },
            scenario: { id: 's', version: '1', hash: 'b' },
          },
          event_plan: {},
          route_facts: {},
        },
      })
    )
    expect(result.current.state.runError).toBeNull()
  })

  it('RESET clears runError', () => {
    const { result } = renderHook(() => useRunStore(), { wrapper })
    act(() => result.current.dispatch({ type: 'SET_RUN_ERROR', message: 'some error' }))
    act(() => result.current.dispatch({ type: 'RESET' }))
    expect(result.current.state.runError).toBeNull()
  })
})

// ── T008/T010 frontend: ALGORITHM_ERROR_APPENDED pause-by-default ────────────

/**
 * These tests verify that a blocking algorithm error (paused=true in the
 * tick envelope) leaves the run store paused and records the error in
 * algorithmErrors — never as a decision trace entry or latestDecision.
 *
 * MIGRATED from M1/M2 continue-on-error: ALGORITHM_ERROR_APPENDED now carries
 * a `paused` field (boolean) and the reducer sets state.paused accordingly.
 */
describe('runStore — ALGORITHM_ERROR_APPENDED pause-by-default', () => {
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(RunStoreProvider, null, children)

  const baseRunState = {
    run_id: 'run-err',
    status: 'playing' as const,
    current_tick: 0,
    pending_proposal: null,
    package_runtime_state: {},
    snapshot: {
      package: { id: 'p', version: '1', hash: 'a' },
      scenario: { id: 's', version: '1', hash: 'b' },
    },
    event_plan: {},
    route_facts: {},
  }

  it('blocking algorithm error sets paused=true in the store', () => {
    const { result } = renderHook(() => useRunStore(), { wrapper })

    act(() => result.current.dispatch({ type: 'RUN_CREATED', runState: baseRunState }))
    act(() =>
      result.current.dispatch({
        type: 'ALGORITHM_ERROR_APPENDED',
        runState: { ...baseRunState, status: 'paused' as const },
        error: { tick_index: 0, error_type: 'algorithm_exception', message: 'crash' },
        paused: true,
      }),
    )

    expect(result.current.state.paused).toBe(true)
    expect(result.current.state.algorithmErrors).toHaveLength(1)
    expect(result.current.state.algorithmErrors[0].error_type).toBe('algorithm_exception')
  })

  it('non_blocking algorithm error does NOT set paused', () => {
    const { result } = renderHook(() => useRunStore(), { wrapper })

    act(() => result.current.dispatch({ type: 'RUN_CREATED', runState: baseRunState }))
    act(() =>
      result.current.dispatch({
        type: 'ALGORITHM_ERROR_APPENDED',
        runState: baseRunState,
        error: { tick_index: 0, error_type: 'algorithm_exception', message: 'crash' },
        paused: false,
      }),
    )

    expect(result.current.state.paused).toBe(false)
    expect(result.current.state.algorithmErrors).toHaveLength(1)
  })

  it('algorithm error is never shown as a decision trace entry', () => {
    const { result } = renderHook(() => useRunStore(), { wrapper })

    act(() => result.current.dispatch({ type: 'RUN_CREATED', runState: baseRunState }))
    act(() =>
      result.current.dispatch({
        type: 'ALGORITHM_ERROR_APPENDED',
        runState: { ...baseRunState, status: 'paused' as const },
        error: { tick_index: 0, error_type: 'missing_evaluate', message: 'no evaluate fn' },
        paused: true,
      }),
    )

    // Error must NOT appear in the decision trace or latestDecision
    expect(result.current.state.trace).toHaveLength(0)
    expect(result.current.state.latestDecision).toBeNull()
    // Error appears only in algorithmErrors
    expect(result.current.state.algorithmErrors).toHaveLength(1)
    expect(result.current.state.algorithmErrors[0].error_type).toBe('missing_evaluate')
  })
})
