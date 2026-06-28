/**
 * T002 / T003 — Three-view app shell tests (M6 S2)
 *
 * Tests:
 * - SetupScreen renders all setup editors including MapKeyAndRouteInput (M4 regression)
 * - LeftContextPanel (Review left panel) does NOT render setup editors after refactor
 * - RunsScreen renders its placeholder
 * - AppShell shows SetupScreen by default; switches to Review / Runs via SET_VIEW_MODE
 * - RUN_CREATED auto-switches to Review; "← New run / Setup" (RESET) returns to Setup
 * - M5 regression: run-feedback-section present on Review screen when run is completed
 * - M4 regression: MapKeyAndRouteInput on Setup screen only, not on Review screen
 */

import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { RunStoreProvider, useRunStore } from '../src/state/runStore'
import type { RunStoreAction } from '../src/state/runStore'
import type { RunState, DecisionResult } from '../src/api/types'

// ── Mock the client module ─────────────────────────────────────────────────────

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
  getEvidence: vi.fn(),
  getHealth: vi.fn(),
  getFeedbackSchema: vi.fn(),
  submitFeedback: vi.fn(),
}))

import * as client from '../src/api/client'

// These imports are RED until the screen components exist:
import SetupScreen from '../src/components/screens/SetupScreen'
import RunsScreen from '../src/components/screens/RunsScreen'
import AppShell from '../src/components/layout/AppShell'
import LeftContextPanel from '../src/components/layout/LeftContextPanel'

// ── Fixtures ───────────────────────────────────────────────────────────────────

const fireControl = { fired: false, suppressed: false, override: false, reason: null }

const noTriggerDecision: DecisionResult = {
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

const createdRun: RunState = {
  run_id: 'run-views-001',
  status: 'created',
  current_tick: 0,
  pending_proposal: null,
  package_runtime_state: {},
  snapshot: {
    package: { id: 'pkg1', version: '0.1.0', hash: 'abc' },
    scenario: { id: 'scen1', version: '0.1.0', hash: 'def' },
  },
  event_plan: {},
  route_facts: {},
}

// ── Store helper ───────────────────────────────────────────────────────────────

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

  return { ...result, getDispatch: () => dispatchRef.current! }
}

// ── SetupScreen ───────────────────────────────────────────────────────────────

describe('SetupScreen — renders setup editors (T003)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(client.listPackages).mockResolvedValue({ packages: [], errors: [] })
    vi.mocked(client.listScenarios).mockResolvedValue({ scenarios: [], errors: [] })
  })

  it('renders with data-testid="setup-screen"', () => {
    render(
      <RunStoreProvider>
        <SetupScreen />
      </RunStoreProvider>,
    )
    expect(screen.getByTestId('setup-screen')).toBeInTheDocument()
  })

  it('renders MapKeyAndRouteInput (M4 regression — maps input lives on Setup)', async () => {
    render(
      <RunStoreProvider>
        <SetupScreen />
      </RunStoreProvider>,
    )
    expect(await screen.findByTestId('map-key-route-input')).toBeInTheDocument()
  })

  it('renders PlanPreview', async () => {
    render(
      <RunStoreProvider>
        <SetupScreen />
      </RunStoreProvider>,
    )
    expect(await screen.findByTestId('plan-preview')).toBeInTheDocument()
  })

  it('renders PackageSelector (Algorithm Package label)', async () => {
    render(
      <RunStoreProvider>
        <SetupScreen />
      </RunStoreProvider>,
    )
    expect(await screen.findByLabelText(/algorithm package/i)).toBeInTheDocument()
  })

  it('renders ScenarioSelector', async () => {
    render(
      <RunStoreProvider>
        <SetupScreen />
      </RunStoreProvider>,
    )
    expect(await screen.findByLabelText(/^scenario$/i)).toBeInTheDocument()
  })
})

// ── LeftContextPanel — de-cluttered ──────────────────────────────────────────

describe('LeftContextPanel — setup editors removed (T003)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('does NOT render MapKeyAndRouteInput (relocated to SetupScreen)', () => {
    render(
      <RunStoreProvider>
        <LeftContextPanel />
      </RunStoreProvider>,
    )
    expect(screen.queryByTestId('map-key-route-input')).not.toBeInTheDocument()
  })

  it('does NOT render PlanPreview (relocated to SetupScreen)', () => {
    render(
      <RunStoreProvider>
        <LeftContextPanel />
      </RunStoreProvider>,
    )
    expect(screen.queryByTestId('plan-preview')).not.toBeInTheDocument()
  })
})

// ── RunsScreen ────────────────────────────────────────────────────────────────

describe('RunsScreen — placeholder (T003)', () => {
  it('renders with data-testid="runs-screen"', () => {
    render(
      <RunStoreProvider>
        <RunsScreen />
      </RunStoreProvider>,
    )
    expect(screen.getByTestId('runs-screen')).toBeInTheDocument()
  })
})

// ── AppShell — view switching ─────────────────────────────────────────────────

describe('AppShell — view switching via header nav (T003)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(client.listPackages).mockResolvedValue({ packages: [], errors: [] })
    vi.mocked(client.listScenarios).mockResolvedValue({ scenarios: [], errors: [] })
    vi.mocked(client.getFeedbackSchema).mockResolvedValue({ fields: [] })
  })

  it('header nav has Setup, Review, and Runs buttons', async () => {
    render(
      <RunStoreProvider>
        <AppShell />
      </RunStoreProvider>,
    )
    expect(await screen.findByRole('button', { name: /^setup$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^review$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^runs$/i })).toBeInTheDocument()
  })

  it('shows SetupScreen by default (viewMode starts as "setup")', async () => {
    render(
      <RunStoreProvider>
        <AppShell />
      </RunStoreProvider>,
    )
    expect(await screen.findByTestId('setup-screen')).toBeInTheDocument()
    expect(screen.queryByTestId('review-screen')).not.toBeInTheDocument()
    expect(screen.queryByTestId('runs-screen')).not.toBeInTheDocument()
  })

  it('clicking Review nav shows Review screen', async () => {
    render(
      <RunStoreProvider>
        <AppShell />
      </RunStoreProvider>,
    )
    const reviewBtn = await screen.findByRole('button', { name: /^review$/i })
    fireEvent.click(reviewBtn)

    await waitFor(() => {
      expect(screen.getByTestId('review-screen')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('setup-screen')).not.toBeInTheDocument()
    expect(screen.queryByTestId('runs-screen')).not.toBeInTheDocument()
  })

  it('clicking Runs nav shows Runs screen', async () => {
    render(
      <RunStoreProvider>
        <AppShell />
      </RunStoreProvider>,
    )
    const runsBtn = await screen.findByRole('button', { name: /^runs$/i })
    fireEvent.click(runsBtn)

    await waitFor(() => {
      expect(screen.getByTestId('runs-screen')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('setup-screen')).not.toBeInTheDocument()
  })

  it('RUN_CREATED auto-switches to Review screen', async () => {
    const { getDispatch } = renderInStore(<AppShell />)

    expect(await screen.findByTestId('setup-screen')).toBeInTheDocument()

    act(() => getDispatch()({ type: 'RUN_CREATED', runState: createdRun }))

    await waitFor(() => {
      expect(screen.getByTestId('review-screen')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('setup-screen')).not.toBeInTheDocument()
  })

  it('"← New run / Setup" button returns to Setup and clears run state', async () => {
    const { getDispatch } = renderInStore(<AppShell />)

    // Go to Review via RUN_CREATED (auto-transition)
    act(() => getDispatch()({ type: 'RUN_CREATED', runState: createdRun }))

    await waitFor(() => {
      expect(screen.getByTestId('review-screen')).toBeInTheDocument()
    })

    // Click the "← New run / Setup" affordance (not the "Setup" nav button)
    fireEvent.click(screen.getByRole('button', { name: /new run/i }))

    // Should navigate back to Setup
    await waitFor(() => {
      expect(screen.getByTestId('setup-screen')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('review-screen')).not.toBeInTheDocument()
  })
})

// ── M4 regression: MapKeyAndRouteInput on Setup only ─────────────────────────

describe('AppShell — M4 regression: maps input lives on Setup, not Review', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(client.listPackages).mockResolvedValue({ packages: [], errors: [] })
    vi.mocked(client.listScenarios).mockResolvedValue({ scenarios: [], errors: [] })
    vi.mocked(client.getFeedbackSchema).mockResolvedValue({ fields: [] })
  })

  it('MapKeyAndRouteInput is present on Setup screen', async () => {
    render(
      <RunStoreProvider>
        <AppShell />
      </RunStoreProvider>,
    )
    // Default: setup screen
    expect(await screen.findByTestId('map-key-route-input')).toBeInTheDocument()
  })

  it('MapKeyAndRouteInput is NOT present on Review screen', async () => {
    const { getDispatch } = renderInStore(<AppShell />)

    act(() => getDispatch()({ type: 'SET_VIEW_MODE', mode: 'review' }))

    await waitFor(() => {
      expect(screen.getByTestId('review-screen')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('map-key-route-input')).not.toBeInTheDocument()
  })
})

// ── M5 regression: feedback attach points on Review screen ───────────────────

describe('AppShell — M5 regression: feedback attach points on Review screen', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(client.listPackages).mockResolvedValue({ packages: [], errors: [] })
    vi.mocked(client.listScenarios).mockResolvedValue({ scenarios: [], errors: [] })
    vi.mocked(client.getFeedbackSchema).mockResolvedValue({ fields: [] })
  })

  it('run-feedback-section present on Review screen when run is completed', async () => {
    const { getDispatch } = renderInStore(<AppShell />)

    act(() => {
      getDispatch()({ type: 'RUN_CREATED', runState: createdRun })
      getDispatch()({
        type: 'TICK_APPENDED',
        runState: { ...createdRun, status: 'completed', current_tick: 60 },
        decision: noTriggerDecision,
        tickIndex: 60,
        paused: false,
        completed: true,
      })
    })

    await waitFor(() => {
      expect(screen.getByTestId('run-feedback-section')).toBeInTheDocument()
    })
  })
})
