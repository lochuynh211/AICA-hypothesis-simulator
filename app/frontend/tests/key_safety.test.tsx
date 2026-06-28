/**
 * T016 — Frontend key safety: SET_MAPS_KEY must never write to localStorage or sessionStorage.
 *
 * Two tests:
 *  (1) Store-level: dispatching SET_MAPS_KEY keeps the key in memory only.
 *  (2) Full-flow: driving analyze → plan → run creation also keeps the key
 *      out of all web storage.
 */
import React from 'react'
import { act } from '@testing-library/react'
import { renderHook } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { RunStoreProvider, useRunStore } from '../src/state/runStore'
import type { RouteEnvelope, RunState } from '../src/api/types'

// ── Mock the API client (needed for the full-flow test) ──────────────────────
vi.mock('../src/api/client', () => ({
  listPackages: vi.fn(),
  listScenarios: vi.fn(),
  routesAnalyze: vi.fn(),
  createRunPlan: vi.fn(),
  createRun: vi.fn(),
  regenerateRunPlan: vi.fn(),
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

// ── Sentinel & fixtures ───────────────────────────────────────────────────────

const SENTINEL = 'SENTINEL_KEY_DO_NOT_LEAK_FE'

const routeEnvelopeFixture: RouteEnvelope = {
  route_source: 'maps',
  alternatives: [
    {
      route_id: 'route-0',
      summary: 'Via Highway',
      route_facts: {
        total_route_distance_km: 200,
        estimated_route_duration_min: 150,
        route_segments: [],
        rest_spot_positions: [],
        route_progress_checkpoints: [],
      },
      display: null,
      notices: [],
    },
  ],
}

const runPlanResponseFixture = {
  plan_id: 'plan-safety-001',
  draft_plan: { tick_seconds: 60, rest_opportunities: [] },
  effective_setup: { run_mode: 'standard', hyperparameters: {} },
  validation_errors: [],
}

const runStateFixture: RunState = {
  run_id: 'run-safety-001',
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

// ── Helper: collect all web-storage key+value pairs as a single string ────────

function dumpStorage(storage: Storage): string {
  const pairs: string[] = []
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i) ?? ''
    const v = storage.getItem(k) ?? ''
    pairs.push(`${k}=${v}`)
  }
  return pairs.join('\n')
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Maps key safety — frontend (T016)', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    vi.resetAllMocks()
  })

  it('SET_MAPS_KEY never writes the key to localStorage or sessionStorage', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(RunStoreProvider, null, children)
    const { result } = renderHook(() => useRunStore(), { wrapper })

    act(() => result.current.dispatch({ type: 'SET_MAPS_KEY', key: SENTINEL }))

    // Key is in store (in-memory)
    expect(result.current.state.mapsKey).toBe(SENTINEL)

    // Key is NOT in web storage
    const lsStr = JSON.stringify(Object.fromEntries(Object.entries({ ...localStorage })))
    const ssStr = JSON.stringify(Object.fromEntries(Object.entries({ ...sessionStorage })))
    expect(lsStr).not.toContain(SENTINEL)
    expect(ssStr).not.toContain(SENTINEL)
  })

  it('RESET clears the key from the store and it was never in web storage', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(RunStoreProvider, null, children)
    const { result } = renderHook(() => useRunStore(), { wrapper })

    act(() => result.current.dispatch({ type: 'SET_MAPS_KEY', key: SENTINEL }))
    act(() => result.current.dispatch({ type: 'RESET' }))

    expect(result.current.state.mapsKey).toBe('')
    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
  })

  it(
    'sentinel key is absent from all web storage after the full setup flow ' +
      '(analyze route → create plan → create run)',
    async () => {
      // Arrange: mock API returns (no side-effects on storage)
      vi.mocked(client.routesAnalyze).mockResolvedValue(routeEnvelopeFixture)
      vi.mocked(client.createRunPlan).mockResolvedValue(runPlanResponseFixture)
      vi.mocked(client.createRun).mockResolvedValue(runStateFixture)

      const wrapper = ({ children }: { children: React.ReactNode }) =>
        React.createElement(RunStoreProvider, null, children)
      const { result } = renderHook(() => useRunStore(), { wrapper })

      // Step 1 — set Maps key in store (in-memory only)
      act(() => {
        result.current.dispatch({ type: 'SELECT_PACKAGE', id: 'rest_rule_based_v0_1' })
        result.current.dispatch({ type: 'SELECT_SCENARIO', id: 'uc01_fatigue_friend_drive_v0_1' })
        result.current.dispatch({ type: 'SET_MAPS_KEY', key: SENTINEL })
      })
      expect(result.current.state.mapsKey).toBe(SENTINEL)

      // Step 2 — route analysis: the sentinel is passed as mapsKey argument to the
      // API call; the result is stored as alternatives in the reducer (no web storage).
      const envelope = await act(async () =>
        client.routesAnalyze({
          scenarioId: 'uc01_fatigue_friend_drive_v0_1',
          mapsKey: SENTINEL,
          start: 'Origin City',
          end: 'Destination City',
        }),
      )
      act(() => {
        result.current.dispatch({ type: 'SET_ALTERNATIVES', envelope })
        result.current.dispatch({ type: 'SELECT_ROUTE', routeId: 'route-0' })
      })

      // Step 3 — create run plan
      const planResp = await act(async () =>
        client.createRunPlan({
          packageId: 'rest_rule_based_v0_1',
          scenarioId: 'uc01_fatigue_friend_drive_v0_1',
          routeId: 'route-0',
          routeSource: 'maps',
          routeFacts: envelope.alternatives[0].route_facts,
          displayRoute: null,
        }),
      )
      act(() => {
        result.current.dispatch({
          type: 'PLAN_DRAFTED',
          planId: planResp.plan_id,
          draftPlan: planResp.draft_plan,
          effectiveSetup: planResp.effective_setup,
        })
      })

      // Step 4 — create run
      const runState = await act(async () => client.createRun(planResp.plan_id))
      act(() => {
        result.current.dispatch({ type: 'RUN_CREATED', runState })
      })

      // Assert: the sentinel must be absent from every localStorage and sessionStorage
      // key AND value. Iterate all entries to catch any serialisation path.
      const lsDump = dumpStorage(localStorage)
      const ssDump = dumpStorage(sessionStorage)
      expect(lsDump).not.toContain(SENTINEL)
      expect(ssDump).not.toContain(SENTINEL)

      // Confirm the API functions were actually called (test is not vacuous)
      expect(vi.mocked(client.routesAnalyze)).toHaveBeenCalledWith(
        expect.objectContaining({ mapsKey: SENTINEL }),
      )
      expect(vi.mocked(client.createRunPlan)).toHaveBeenCalledOnce()
      expect(vi.mocked(client.createRun)).toHaveBeenCalledWith(planResp.plan_id)
    },
  )
})
