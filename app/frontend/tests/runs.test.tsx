/**
 * S4: Run management — reset / restart / run list (M6 T006, T007)
 *
 * T006 (Restart):
 *  - Review affordance shows Restart button when planId is frozen.
 *  - Restart button is disabled when planId is null.
 *  - Restart calls createRun with the current frozen planId → RUN_CREATED → stays on Review.
 *
 * T007 (RunList):
 *  - RunsScreen renders <RunList> with rows from listRuns (newest first).
 *  - Selecting a row shows RunLogViewer + EvidencePanel for that run_id (not the active run).
 *  - Past-run evidence view is read-only (no Restart button).
 *  - RunLogViewer accepts explicit runId prop and uses it for getRunLog.
 *  - EvidencePanel accepts explicit runId prop and renders/uses it.
 */

import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { RunStoreProvider, useRunStore } from '../src/state/runStore'
import type { RunStoreAction } from '../src/state/runStore'
import type { RunState, RunSummary } from '../src/api/types'

// ── Mock the client module ─────────────────────────────────────────────────────

vi.mock('../src/api/client', () => ({
  listPackages: vi.fn(),
  listScenarios: vi.fn(),
  createRun: vi.fn(),
  createRunPlan: vi.fn(),
  regenerateRunPlan: vi.fn(),
  routesAnalyze: vi.fn(),
  listRoutePresets: vi.fn(() => Promise.resolve({ presets: [] })),
  loadRoutePreset: vi.fn(),
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
import AppShell from '../src/components/layout/AppShell'
import RunsScreen from '../src/components/screens/RunsScreen'
import RunLogViewer from '../src/components/runs/RunLogViewer'
import EvidencePanel from '../src/components/evidence/EvidencePanel'

// ── Fixtures ───────────────────────────────────────────────────────────────────

const createdRun: RunState = {
  run_id: 'run-001',
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

const restartedRun: RunState = {
  run_id: 'run-002',
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

const mockRuns: RunSummary[] = [
  {
    run_id: 'run-older',
    created_at: '2026-01-01T00:00:00Z',
    package_id: 'pkg1',
    scenario_id: 'scen1',
    status: 'completed',
  },
  {
    run_id: 'run-newer',
    created_at: '2026-06-01T00:00:00Z',
    package_id: 'pkg2',
    scenario_id: 'scen2',
    status: 'completed',
  },
]

const emptyRunLog = {
  run_id: 'run-newer',
  created_at: '2026-06-01T00:00:00Z',
  simulator_version: '0.1.0',
  snapshot: {
    package: { id: 'pkg2', version: '0.1.0', hash: 'abc' },
    scenario: { id: 'scen2', version: '0.1.0', hash: 'def' },
  },
  route_facts: {},
  event_plan: {},
  run_mode: 'standard',
  evidence_status: 'standard',
  events: [],
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

// ── T006 — Restart ─────────────────────────────────────────────────────────────

describe('T006 — Restart (session-scoped, Review affordance)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(client.listPackages).mockResolvedValue({ packages: [], errors: [] })
    vi.mocked(client.listScenarios).mockResolvedValue({ scenarios: [], errors: [] })
    vi.mocked(client.getFeedbackSchema).mockResolvedValue({ fields: [] })
  })

  it('Restart button is visible on Review screen when planId is set', async () => {
    const { getDispatch } = renderInStore(<AppShell />)

    act(() => {
      // First draft a plan (sets planId), then start a run
      getDispatch()({ type: 'PLAN_DRAFTED', planId: 'plan-abc', draftPlan: {}, effectiveSetup: {} })
      getDispatch()({ type: 'RUN_CREATED', runState: createdRun })
    })

    await waitFor(() => {
      expect(screen.getByTestId('review-screen')).toBeInTheDocument()
    })

    expect(screen.getByTestId('restart-run-btn')).toBeInTheDocument()
  })

  it('Restart button is disabled when planId is null (no plan drafted)', async () => {
    const { getDispatch } = renderInStore(<AppShell />)

    // Start a run without ever drafting a plan (planId stays null)
    act(() => {
      getDispatch()({ type: 'RUN_CREATED', runState: createdRun })
    })

    await waitFor(() => {
      expect(screen.getByTestId('review-screen')).toBeInTheDocument()
    })

    expect(screen.getByTestId('restart-run-btn')).toBeDisabled()
  })

  it('clicking Restart calls createRun with the current frozen planId', async () => {
    vi.mocked(client.createRun).mockResolvedValue(restartedRun)

    const { getDispatch } = renderInStore(<AppShell />)

    act(() => {
      getDispatch()({ type: 'PLAN_DRAFTED', planId: 'plan-abc', draftPlan: {}, effectiveSetup: {} })
      getDispatch()({ type: 'RUN_CREATED', runState: createdRun })
    })

    await waitFor(() => {
      expect(screen.getByTestId('review-screen')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('restart-run-btn'))

    await waitFor(() => {
      expect(client.createRun).toHaveBeenCalledTimes(1)
      expect(client.createRun).toHaveBeenCalledWith('plan-abc')
    })
  })

  it('clicking Restart dispatches RUN_CREATED and stays on the Review screen', async () => {
    vi.mocked(client.createRun).mockResolvedValue(restartedRun)

    const { getDispatch } = renderInStore(<AppShell />)

    act(() => {
      getDispatch()({ type: 'PLAN_DRAFTED', planId: 'plan-abc', draftPlan: {}, effectiveSetup: {} })
      getDispatch()({ type: 'RUN_CREATED', runState: createdRun })
    })

    await waitFor(() => {
      expect(screen.getByTestId('review-screen')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('restart-run-btn'))

    // After restart completes, still on Review (RUN_CREATED auto-transitions to review)
    await waitFor(() => {
      expect(screen.getByTestId('review-screen')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('setup-screen')).not.toBeInTheDocument()
  })

  it('failed restart dispatches SET_RUN_ERROR and shows the error in the affordance bar', async () => {
    vi.mocked(client.createRun).mockRejectedValue(new Error('backend down'))

    const { getDispatch } = renderInStore(<AppShell />)

    act(() => {
      getDispatch()({ type: 'PLAN_DRAFTED', planId: 'plan-abc', draftPlan: {}, effectiveSetup: {} })
      getDispatch()({ type: 'RUN_CREATED', runState: createdRun })
    })

    await waitFor(() => {
      expect(screen.getByTestId('review-screen')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('restart-run-btn'))

    // Error must appear inline in the Review affordance bar (not silently swallowed)
    await waitFor(() => {
      expect(screen.getByTestId('restart-error')).toBeInTheDocument()
      expect(screen.getByTestId('restart-error')).toHaveTextContent('backend down')
    })
    // Still on Review — restart failure does not navigate away
    expect(screen.getByTestId('review-screen')).toBeInTheDocument()
  })
})

// ── T007 — RunList + Read-Only Evidence ───────────────────────────────────────

describe('T007 — RunsScreen: RunList and read-only evidence', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(client.listRuns).mockResolvedValue({ runs: mockRuns })
  })

  it('RunsScreen renders a run-list table with rows from listRuns', async () => {
    render(
      <RunStoreProvider>
        <RunsScreen />
      </RunStoreProvider>,
    )

    expect(await screen.findByTestId('run-list')).toBeInTheDocument()
    expect(await screen.findByTestId('run-row-run-newer')).toBeInTheDocument()
    expect(await screen.findByTestId('run-row-run-older')).toBeInTheDocument()
  })

  it('RunList renders newest run first (sorted by created_at descending)', async () => {
    render(
      <RunStoreProvider>
        <RunsScreen />
      </RunStoreProvider>,
    )

    await screen.findByTestId('run-list')

    const newerRow = screen.getByTestId('run-row-run-newer')
    const olderRow = screen.getByTestId('run-row-run-older')
    // run-newer (2026-06-01) should precede run-older (2026-01-01) in DOM order
    expect(
      newerRow.compareDocumentPosition(olderRow) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('selecting a run row shows past-run-evidence with RunLogViewer and EvidencePanel for that run_id', async () => {
    vi.mocked(client.getRunLog).mockResolvedValue(emptyRunLog)

    render(
      <RunStoreProvider>
        <RunsScreen />
      </RunStoreProvider>,
    )

    await screen.findByTestId('run-list')
    fireEvent.click(screen.getByTestId('run-row-run-newer'))

    await waitFor(() => {
      expect(screen.getByTestId('past-run-evidence')).toBeInTheDocument()
    })

    // EvidencePanel should render for the selected run (not active run)
    expect(screen.getByTestId('evidence-panel')).toBeInTheDocument()

    // Clicking Load should call getRunLog with the selected run_id
    // Use /^load/i (not /load/i) to avoid matching "Download evidence-…" button
    fireEvent.click(screen.getByRole('button', { name: /^load/i }))
    await waitFor(() => {
      expect(client.getRunLog).toHaveBeenCalledWith('run-newer')
    })
  })

  it('past-run evidence view has no Restart button (read-only)', async () => {
    render(
      <RunStoreProvider>
        <RunsScreen />
      </RunStoreProvider>,
    )

    await screen.findByTestId('run-list')
    fireEvent.click(screen.getByTestId('run-row-run-newer'))

    await waitFor(() => {
      expect(screen.getByTestId('past-run-evidence')).toBeInTheDocument()
    })

    // restart-run-btn is AppShell/Review-scoped by design — it lives in the Review
    // affordance bar rendered by AppShell, not inside RunsScreen or past-run-evidence.
    // Assert it is absent within the past-run-evidence panel specifically.
    expect(
      within(screen.getByTestId('past-run-evidence')).queryByTestId('restart-run-btn'),
    ).not.toBeInTheDocument()
  })

  it('closing (deselecting) a run hides the past-run-evidence panel', async () => {
    render(
      <RunStoreProvider>
        <RunsScreen />
      </RunStoreProvider>,
    )

    await screen.findByTestId('run-list')
    fireEvent.click(screen.getByTestId('run-row-run-newer'))

    await waitFor(() => {
      expect(screen.getByTestId('past-run-evidence')).toBeInTheDocument()
    })

    // Click again to deselect
    fireEvent.click(screen.getByTestId('run-row-run-newer'))

    await waitFor(() => {
      expect(screen.queryByTestId('past-run-evidence')).not.toBeInTheDocument()
    })
  })
})

// ── T007 — RunLogViewer explicit runId prop ────────────────────────────────────

describe('T007 — RunLogViewer: explicit runId prop', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('uses explicit runId prop for getRunLog when no active run in store', async () => {
    vi.mocked(client.getRunLog).mockResolvedValue({ ...emptyRunLog, run_id: 'explicit-past-run' })

    render(
      <RunStoreProvider>
        <RunLogViewer runId="explicit-past-run" />
      </RunStoreProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: /load/i }))

    await waitFor(() => {
      expect(client.getRunLog).toHaveBeenCalledWith('explicit-past-run')
    })
  })

  it('explicit runId prop overrides the active run id from the store', async () => {
    vi.mocked(client.getRunLog).mockResolvedValue({ ...emptyRunLog, run_id: 'past-run-id' })

    renderInStore(<RunLogViewer runId="past-run-id" />, (dispatch) => {
      dispatch({ type: 'RUN_CREATED', runState: { ...createdRun, run_id: 'active-run-id' } })
    })

    fireEvent.click(screen.getByRole('button', { name: /load/i }))

    await waitFor(() => {
      // Must use the explicit prop, NOT the active run
      expect(client.getRunLog).toHaveBeenCalledWith('past-run-id')
      expect(client.getRunLog).not.toHaveBeenCalledWith('active-run-id')
    })
  })

  it('without explicit prop, falls back to the active run id (backward compat)', async () => {
    vi.mocked(client.getRunLog).mockResolvedValue({ ...emptyRunLog, run_id: 'active-run-id' })

    renderInStore(<RunLogViewer />, (dispatch) => {
      dispatch({ type: 'RUN_CREATED', runState: { ...createdRun, run_id: 'active-run-id' } })
    })

    fireEvent.click(screen.getByRole('button', { name: /load/i }))

    await waitFor(() => {
      expect(client.getRunLog).toHaveBeenCalledWith('active-run-id')
    })
  })
})

// ── T007 — EvidencePanel explicit runId prop ───────────────────────────────────

describe('T007 — EvidencePanel: explicit runId prop', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('renders evidence-panel when given an explicit runId even with no active run in store', () => {
    render(
      <RunStoreProvider>
        <EvidencePanel runId="explicit-past-run" />
      </RunStoreProvider>,
    )

    expect(screen.getByTestId('evidence-panel')).toBeInTheDocument()
  })

  it('explicit runId appears in the download button label', () => {
    render(
      <RunStoreProvider>
        <EvidencePanel runId="explicit-past-run" />
      </RunStoreProvider>,
    )

    expect(screen.getByTestId('evidence-download-btn')).toHaveTextContent('explicit-past-run')
  })

  it('without explicit prop, renders nothing if no active run (backward compat)', () => {
    render(
      <RunStoreProvider>
        <EvidencePanel />
      </RunStoreProvider>,
    )

    expect(screen.queryByTestId('evidence-panel')).not.toBeInTheDocument()
  })

  it('without explicit prop, uses active run id from store (backward compat)', () => {
    renderInStore(<EvidencePanel />, (dispatch) => {
      dispatch({ type: 'RUN_CREATED', runState: { ...createdRun, run_id: 'active-run-id' } })
    })

    const dlBtn = screen.getByTestId('evidence-download-btn')
    expect(dlBtn).toHaveTextContent('active-run-id')
  })

  it('copy passes explicit runId and uiLanguage from store to getEvidence', async () => {
    // Proves that past-run export respects the current uiLanguage setting even when
    // the runId comes from a prop rather than the active run in the store.
    vi.mocked(client.getEvidence).mockResolvedValue({} as never)

    // Mock clipboard so the copy handler does not throw
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      writable: true,
      configurable: true,
    })

    renderInStore(<EvidencePanel runId="past-run-id" />, (dispatch) => {
      dispatch({ type: 'SET_LANGUAGE', lang: 'en' })
    })

    fireEvent.click(screen.getByTestId('evidence-copy-btn'))

    await waitFor(() => {
      expect(client.getEvidence).toHaveBeenCalledWith('past-run-id', 'en')
    })
  })
})
