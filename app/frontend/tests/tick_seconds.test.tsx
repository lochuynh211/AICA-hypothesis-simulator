/**
 * Tick Seconds — setup-time tick duration control.
 *
 * Tests (written FIRST — must fail before implementation):
 * (a) Renders prefilled from scenario's tick_seconds; editing updates the store.
 * (b) Changed tick_seconds → createRunPlan called with presets: { tick_seconds: N }.
 * (c) No change (left at scenario default) → tick_seconds NOT in presets (back-compat).
 * (d) Reset-to-default restores the scenario value and clears the override.
 * (e) Changing selected scenario re-prefills to new scenario's tick_seconds and clears override.
 * (f) Invalid input (<= 0) is not sent as override (input guarded, bad value not forwarded).
 */

import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { RunStoreProvider, useRunStore } from '../src/state/runStore'
import type { RunStoreAction } from '../src/state/runStore'
import LanguageToggle from '../src/components/layout/LanguageToggle'

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
import TickSecondsEditor from '../src/components/setup/TickSecondsEditor'
import PlanPreview from '../src/components/setup/PlanPreview'

// ── Fixtures ────────────────────────────────────────────────────────────────

const scenarioA = {
  id: 'uc01_fatigue_friend_drive_v0_1',
  version: '0.2.0',
  type: 'uc01_fatigue',
  persona: { name: 'Haruto', description: '' },
  route_intent: {
    rest_facility: { label: { ja: '道の駅', en: 'Roadside Station' } },
    segments: [],
  },
  initial_state: {},
  event_presets: { signal_duration_at_trigger: 'sustained' },
  total_duration_seconds: 7200,
  tick_seconds: 60,
  allowed_actions: ['accept', 'decline'],
  review_focus: 'Base trigger timing',
  driver_profile: null,
  vehicle_profile: null,
  speed_profile: null,
}

const scenarioB = {
  ...scenarioA,
  id: 'uc01_overtime_v0_1',
  tick_seconds: 30,
}

const routeEnvelopeFixture = {
  route_source: 'local' as const,
  alternatives: [
    {
      route_id: 'local',
      summary: 'Local route',
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

const planResponse = {
  plan_id: 'plan-test-001',
  draft_plan: {},
  effective_setup: { run_mode: 'standard' },
  validation_errors: [],
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
    <RunStoreProvider>
      <DispatchCapture />
      {ui}
    </RunStoreProvider>,
  )

  if (setupFn && dispatchRef.current) {
    act(() => setupFn(dispatchRef.current!))
  }

  return { ...result, dispatchRef }
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('TickSecondsEditor', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(client.listPackages).mockResolvedValue({ packages: [], errors: [] })
    vi.mocked(client.listScenarios).mockResolvedValue({ scenarios: [], errors: [] })
  })

  it('(a) renders prefilled from scenario tick_seconds; editing updates the store (override set)', async () => {
    vi.mocked(client.getScenario).mockResolvedValue(scenarioA)

    renderInStore(<TickSecondsEditor />, (dispatch) => {
      dispatch({ type: 'SELECT_SCENARIO', id: 'uc01_fatigue_friend_drive_v0_1' })
    })

    // Input should appear and be prefilled with scenario's tick_seconds = 60
    await waitFor(() => {
      expect(screen.getByTestId('tick-seconds-input')).toBeInTheDocument()
    })
    expect(screen.getByTestId('tick-seconds-input')).toHaveValue(60)

    // Edit to 30
    fireEvent.change(screen.getByTestId('tick-seconds-input'), { target: { value: '30' } })
    expect(screen.getByTestId('tick-seconds-input')).toHaveValue(30)
  })

  it('(b) changed tick_seconds sends presets: { tick_seconds: N } in createRunPlan', async () => {
    vi.mocked(client.getScenario).mockResolvedValue(scenarioA)
    vi.mocked(client.routesAnalyze).mockResolvedValue(routeEnvelopeFixture)
    vi.mocked(client.createRunPlan).mockResolvedValue(planResponse)

    renderInStore(
      <>
        <TickSecondsEditor />
        <PlanPreview />
      </>,
      (dispatch) => {
        dispatch({ type: 'SELECT_PACKAGE', id: 'rest_rule_based_v0_1' })
        dispatch({ type: 'SELECT_SCENARIO', id: 'uc01_fatigue_friend_drive_v0_1' })
      },
    )

    await waitFor(() => {
      expect(screen.getByTestId('tick-seconds-input')).toBeInTheDocument()
    })

    // Change from 60 to 120
    fireEvent.change(screen.getByTestId('tick-seconds-input'), { target: { value: '120' } })

    // Click Preview Plan
    fireEvent.click(screen.getByRole('button', { name: /preview plan/i }))

    await waitFor(() => {
      expect(vi.mocked(client.createRunPlan)).toHaveBeenCalledWith(
        expect.objectContaining({
          presets: expect.objectContaining({ tick_seconds: 120 }),
        }),
      )
    })
  })

  it('(c) no change → tick_seconds NOT in presets (back-compat)', async () => {
    vi.mocked(client.getScenario).mockResolvedValue(scenarioA)
    vi.mocked(client.routesAnalyze).mockResolvedValue(routeEnvelopeFixture)
    vi.mocked(client.createRunPlan).mockResolvedValue(planResponse)

    renderInStore(
      <>
        <TickSecondsEditor />
        <PlanPreview />
      </>,
      (dispatch) => {
        dispatch({ type: 'SELECT_PACKAGE', id: 'rest_rule_based_v0_1' })
        dispatch({ type: 'SELECT_SCENARIO', id: 'uc01_fatigue_friend_drive_v0_1' })
      },
    )

    await waitFor(() => {
      expect(screen.getByTestId('tick-seconds-input')).toBeInTheDocument()
    })

    // No changes — click Preview directly
    fireEvent.click(screen.getByRole('button', { name: /preview plan/i }))

    await waitFor(() => {
      expect(vi.mocked(client.createRunPlan)).toHaveBeenCalled()
    })

    const callArg = vi.mocked(client.createRunPlan).mock.calls[0][0]
    // presets must be empty / not contain tick_seconds
    const presetsArg = callArg.presets as Record<string, unknown> | undefined
    expect(presetsArg).not.toHaveProperty('tick_seconds')
  })

  it('(d) reset-to-default restores the scenario value and clears the override', async () => {
    vi.mocked(client.getScenario).mockResolvedValue(scenarioA)
    vi.mocked(client.routesAnalyze).mockResolvedValue(routeEnvelopeFixture)
    vi.mocked(client.createRunPlan).mockResolvedValue(planResponse)

    renderInStore(
      <>
        <TickSecondsEditor />
        <PlanPreview />
      </>,
      (dispatch) => {
        dispatch({ type: 'SELECT_PACKAGE', id: 'rest_rule_based_v0_1' })
        dispatch({ type: 'SELECT_SCENARIO', id: 'uc01_fatigue_friend_drive_v0_1' })
      },
    )

    await waitFor(() => {
      expect(screen.getByTestId('tick-seconds-input')).toHaveValue(60)
    })

    // Edit to 120
    fireEvent.change(screen.getByTestId('tick-seconds-input'), { target: { value: '120' } })
    expect(screen.getByTestId('tick-seconds-input')).toHaveValue(120)

    // Reset to default
    fireEvent.click(screen.getByTestId('tick-seconds-reset'))
    expect(screen.getByTestId('tick-seconds-input')).toHaveValue(60)

    // Preview → no tick_seconds in presets
    fireEvent.click(screen.getByRole('button', { name: /preview plan/i }))

    await waitFor(() => {
      expect(vi.mocked(client.createRunPlan)).toHaveBeenCalled()
    })

    const callArg = vi.mocked(client.createRunPlan).mock.calls[0][0]
    const presetsArg = callArg.presets as Record<string, unknown> | undefined
    expect(presetsArg).not.toHaveProperty('tick_seconds')
  })

  it('(e) changing scenario re-prefills to new tick_seconds and clears prior override', async () => {
    vi.mocked(client.getScenario)
      .mockResolvedValueOnce(scenarioA)  // tick_seconds: 60
      .mockResolvedValueOnce(scenarioB)  // tick_seconds: 30

    const { dispatchRef } = renderInStore(<TickSecondsEditor />, (dispatch) => {
      dispatch({ type: 'SELECT_SCENARIO', id: 'uc01_fatigue_friend_drive_v0_1' })
    })

    // Scenario A loaded — prefilled with 60
    await waitFor(() => {
      expect(screen.getByTestId('tick-seconds-input')).toHaveValue(60)
    })

    // Edit to 120 (override set)
    fireEvent.change(screen.getByTestId('tick-seconds-input'), { target: { value: '120' } })
    expect(screen.getByTestId('tick-seconds-input')).toHaveValue(120)

    // Switch to scenario B
    act(() => {
      dispatchRef.current!({ type: 'SELECT_SCENARIO', id: 'uc01_overtime_v0_1' })
    })

    // Should re-prefill with scenario B's tick_seconds = 30 and clear prior override
    await waitFor(() => {
      expect(screen.getByTestId('tick-seconds-input')).toHaveValue(30)
    })
  })

  it('(f) value <= 0 is not sent as override (invalid, guarded at input)', async () => {
    vi.mocked(client.getScenario).mockResolvedValue(scenarioA)
    vi.mocked(client.routesAnalyze).mockResolvedValue(routeEnvelopeFixture)
    vi.mocked(client.createRunPlan).mockResolvedValue(planResponse)

    renderInStore(
      <>
        <TickSecondsEditor />
        <PlanPreview />
      </>,
      (dispatch) => {
        dispatch({ type: 'SELECT_PACKAGE', id: 'rest_rule_based_v0_1' })
        dispatch({ type: 'SELECT_SCENARIO', id: 'uc01_fatigue_friend_drive_v0_1' })
      },
    )

    await waitFor(() => {
      expect(screen.getByTestId('tick-seconds-input')).toBeInTheDocument()
    })

    // Try to set invalid value (0)
    fireEvent.change(screen.getByTestId('tick-seconds-input'), { target: { value: '0' } })

    // Preview Plan
    fireEvent.click(screen.getByRole('button', { name: /preview plan/i }))

    await waitFor(() => {
      expect(vi.mocked(client.createRunPlan)).toHaveBeenCalled()
    })

    // tick_seconds must not be in presets (invalid value ignored)
    const callArg = vi.mocked(client.createRunPlan).mock.calls[0][0]
    const presetsArg = callArg.presets as Record<string, unknown> | undefined
    expect(presetsArg).not.toHaveProperty('tick_seconds')
  })

  it('(g) typed back to scenario default → tick_seconds ABSENT from presets (back-compat)', async () => {
    vi.mocked(client.getScenario).mockResolvedValue(scenarioA) // tick_seconds: 60
    vi.mocked(client.routesAnalyze).mockResolvedValue(routeEnvelopeFixture)
    vi.mocked(client.createRunPlan).mockResolvedValue(planResponse)

    renderInStore(
      <>
        <TickSecondsEditor />
        <PlanPreview />
      </>,
      (dispatch) => {
        dispatch({ type: 'SELECT_PACKAGE', id: 'rest_rule_based_v0_1' })
        dispatch({ type: 'SELECT_SCENARIO', id: 'uc01_fatigue_friend_drive_v0_1' })
      },
    )

    await waitFor(() => {
      expect(screen.getByTestId('tick-seconds-input')).toHaveValue(60)
    })

    // Change to a non-default value first
    fireEvent.change(screen.getByTestId('tick-seconds-input'), { target: { value: '120' } })
    expect(screen.getByTestId('tick-seconds-input')).toHaveValue(120)

    // Type back to the scenario default (60)
    fireEvent.change(screen.getByTestId('tick-seconds-input'), { target: { value: '60' } })
    expect(screen.getByTestId('tick-seconds-input')).toHaveValue(60)

    // Preview Plan — should behave identically to the "no change" case
    fireEvent.click(screen.getByRole('button', { name: /preview plan/i }))

    await waitFor(() => {
      expect(vi.mocked(client.createRunPlan)).toHaveBeenCalled()
    })

    // tick_seconds must be ABSENT from presets (typed-back-to-default = no override)
    const callArg = vi.mocked(client.createRunPlan).mock.calls[0][0]
    const presetsArg = callArg.presets as Record<string, unknown> | undefined
    expect(presetsArg).not.toHaveProperty('tick_seconds')
  })
})

// ── i18n: TickSecondsEditor renders the label via t() ──────────────────────────

describe('TickSecondsEditor — bilingual label audit (t() routing)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(client.listPackages).mockResolvedValue({ packages: [], errors: [] })
    vi.mocked(client.listScenarios).mockResolvedValue({ scenarios: [], errors: [] })
  })

  it('renders JA label by default (uiLanguage=ja)', async () => {
    vi.mocked(client.getScenario).mockResolvedValue(scenarioA)

    renderInStore(
      <>
        <LanguageToggle />
        <TickSecondsEditor />
      </>,
      (dispatch) => {
        dispatch({ type: 'SELECT_SCENARIO', id: 'uc01_fatigue_friend_drive_v0_1' })
      },
    )

    await waitFor(() => {
      expect(screen.getByTestId('tick-seconds-input')).toBeInTheDocument()
    })

    expect(screen.getByText('ティック秒数')).toBeInTheDocument()
    expect(screen.queryByText('Tick seconds')).not.toBeInTheDocument()
  })

  it('renders EN label after toggling to EN', async () => {
    vi.mocked(client.getScenario).mockResolvedValue(scenarioA)

    renderInStore(
      <>
        <LanguageToggle />
        <TickSecondsEditor />
      </>,
      (dispatch) => {
        dispatch({ type: 'SELECT_SCENARIO', id: 'uc01_fatigue_friend_drive_v0_1' })
      },
    )

    await waitFor(() => {
      expect(screen.getByTestId('tick-seconds-input')).toBeInTheDocument()
    })

    // Toggle to EN
    fireEvent.click(screen.getByTestId('lang-toggle-en'))

    await waitFor(() => {
      expect(screen.getByText('Tick seconds')).toBeInTheDocument()
    })
    expect(screen.queryByText('ティック秒数')).not.toBeInTheDocument()
  })
})
