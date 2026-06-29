/**
 * InitialDriverStateEditor — setup-time initial driver state control.
 *
 * Tests (written to verify implementation):
 * (1) Input dispatches SET_INITIAL_DROWSINESS when user types a value.
 * (2) Input dispatches SET_INITIAL_FATIGUE when user types a value.
 * (3) Clearing the input (empty string) dispatches null for that dimension.
 * (4) Prefill from a band string: severe→80, high→60 shown in inputs (display-only;
 *     store stays null until the user edits).
 */

import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React, { useRef, useEffect } from 'react'
import { RunStoreProvider, useRunStore } from '../src/state/runStore'
import type { RunStoreAction } from '../src/state/runStore'

// ── Mock the full client module ─────────────────────────────────────────────

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
  getEvidence: vi.fn(),
  getFeedbackSchema: vi.fn(),
  submitFeedback: vi.fn(),
}))

import * as client from '../src/api/client'
import InitialDriverStateEditor from '../src/components/setup/InitialDriverStateEditor'

// ── Fixtures ────────────────────────────────────────────────────────────────

/** Scenario with numeric-style prefill (band strings that map to 0). */
const scenarioNumeric = {
  id: 'sc-num',
  version: '0.1.0',
  type: 'uc01_fatigue',
  persona: { name: 'X', description: '' },
  route_intent: { rest_facility: { label: { ja: '', en: '' } }, segments: [] },
  initial_state: { drowsiness_level: 'none', fatigue_level: 'low' },
  event_presets: { signal_duration_at_trigger: 'sustained' },
  total_duration_seconds: 7200,
  tick_seconds: 60,
  allowed_actions: ['accept'],
  review_focus: '',
  driver_profile: null,
  vehicle_profile: null,
  speed_profile: null,
}

/** Scenario with high-severity band strings to test mapping. */
const scenarioBandSevere = {
  ...scenarioNumeric,
  id: 'sc-severe',
  initial_state: { drowsiness_level: 'severe', fatigue_level: 'high' },
}

// ── Render helpers ───────────────────────────────────────────────────────────

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
    <RunStoreProvider initialLanguage="en">
      <DispatchCapture />
      {ui}
    </RunStoreProvider>,
  )

  if (setupFn && dispatchRef.current) {
    act(() => setupFn(dispatchRef.current!))
  }

  return { ...result, dispatchRef }
}

// ── StateCapture helper ───────────────────────────────────────────────────────

/** Reads initialDrowsiness + initialFatigue from the store into refs. */
function makeStateCapture() {
  const drowsinessRef: { current: number | null } = { current: null }
  const fatigueRef: { current: number | null } = { current: null }

  function StateCapture() {
    const { state } = useRunStore()
    const drowsinessVal = state.initialDrowsiness
    const fatigueVal = state.initialFatigue
    useEffect(() => {
      drowsinessRef.current = drowsinessVal
      fatigueRef.current = fatigueVal
    })
    return null
  }

  return { drowsinessRef, fatigueRef, StateCapture }
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('InitialDriverStateEditor', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(client.listPackages).mockResolvedValue({ packages: [], errors: [] })
    vi.mocked(client.listScenarios).mockResolvedValue({ scenarios: [], errors: [] })
  })

  it('(1) typing a drowsiness value dispatches SET_INITIAL_DROWSINESS', async () => {
    vi.mocked(client.getScenario).mockResolvedValue(scenarioNumeric)

    const { drowsinessRef, StateCapture } = makeStateCapture()

    renderInStore(
      <>
        <StateCapture />
        <InitialDriverStateEditor />
      </>,
      (dispatch) => {
        dispatch({ type: 'SELECT_SCENARIO', id: 'sc-num' })
      },
    )

    // Wait for the editor to appear after the scenario loads
    await waitFor(() => {
      expect(screen.getByTestId('initial-drowsiness-input')).toBeInTheDocument()
    })

    // Type a value
    fireEvent.change(screen.getByTestId('initial-drowsiness-input'), {
      target: { value: '80' },
    })

    expect(screen.getByTestId('initial-drowsiness-input')).toHaveValue(80)

    await waitFor(() => {
      expect(drowsinessRef.current).toBe(80)
    })
  })

  it('(2) typing a fatigue value dispatches SET_INITIAL_FATIGUE', async () => {
    vi.mocked(client.getScenario).mockResolvedValue(scenarioNumeric)

    const { fatigueRef, StateCapture } = makeStateCapture()

    renderInStore(
      <>
        <StateCapture />
        <InitialDriverStateEditor />
      </>,
      (dispatch) => {
        dispatch({ type: 'SELECT_SCENARIO', id: 'sc-num' })
      },
    )

    await waitFor(() => {
      expect(screen.getByTestId('initial-fatigue-input')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByTestId('initial-fatigue-input'), {
      target: { value: '30' },
    })

    expect(screen.getByTestId('initial-fatigue-input')).toHaveValue(30)

    await waitFor(() => {
      expect(fatigueRef.current).toBe(30)
    })
  })

  it('(3) clearing a value (empty string) dispatches null', async () => {
    vi.mocked(client.getScenario).mockResolvedValue(scenarioNumeric)

    const { drowsinessRef, StateCapture } = makeStateCapture()

    renderInStore(
      <>
        <StateCapture />
        <InitialDriverStateEditor />
      </>,
      (dispatch) => {
        dispatch({ type: 'SELECT_SCENARIO', id: 'sc-num' })
      },
    )

    await waitFor(() => {
      expect(screen.getByTestId('initial-drowsiness-input')).toBeInTheDocument()
    })

    // First type a value
    fireEvent.change(screen.getByTestId('initial-drowsiness-input'), {
      target: { value: '60' },
    })
    await waitFor(() => {
      expect(drowsinessRef.current).toBe(60)
    })

    // Then clear it
    fireEvent.change(screen.getByTestId('initial-drowsiness-input'), {
      target: { value: '' },
    })

    await waitFor(() => {
      expect(drowsinessRef.current).toBeNull()
    })
    expect(screen.getByTestId('initial-drowsiness-input')).toHaveValue(null)
  })

  it('(4) band string prefill: severe→80 and high→60 shown in inputs (store stays null)', async () => {
    vi.mocked(client.getScenario).mockResolvedValue(scenarioBandSevere)

    const { drowsinessRef, fatigueRef, StateCapture } = makeStateCapture()

    renderInStore(
      <>
        <StateCapture />
        <InitialDriverStateEditor />
      </>,
      (dispatch) => {
        dispatch({ type: 'SELECT_SCENARIO', id: 'sc-severe' })
      },
    )

    // Wait for inputs to appear after scenario load
    await waitFor(() => {
      expect(screen.getByTestId('initial-drowsiness-input')).toBeInTheDocument()
    })

    // Prefill: severe→80, high→60 (display-only)
    expect(screen.getByTestId('initial-drowsiness-input')).toHaveValue(80)
    expect(screen.getByTestId('initial-fatigue-input')).toHaveValue(60)

    // Store stays null (prefill is display-only; no user edit dispatched)
    await waitFor(() => {
      expect(drowsinessRef.current).toBeNull()
      expect(fatigueRef.current).toBeNull()
    })
  })
})
