/**
 * T009 TDD — RunLogViewer evidence timeline (RED → GREEN)
 *
 * Tests:
 *  1. Clicking "Load" calls getRunLog and renders events in recorded order.
 *  2. Tick event header is visible; clicking it expands the decision trace.
 *  3. Action event header is visible; clicking it expands to show resulting_status.
 *  4. Algorithm-error event header shows error marker and error_type.
 *  5. Feedback event has data-testid="timeline-feedback" with "HUMAN REVIEW" marker;
 *     expanding shows target, labels, and comment.
 *  6. A feedback label with a note-field value ({choice, note}) renders both.
 *  7. An empty events array renders without crashing.
 *
 * Keeps the original T027 coverage:
 *  - Clicking Load calls getRunLog(runId) and log content appears in the document.
 */

import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { RunStoreProvider, useRunStore } from '../src/state/runStore'
import type { RunStoreAction } from '../src/state/runStore'
import type { RunState, RunLog } from '../src/api/types'

// ── Mock the client module ────────────────────────────────────────────────────

vi.mock('../src/api/client', () => ({
  tickRun: vi.fn(),
  actRun: vi.fn(),
  listPackages: vi.fn(),
  listScenarios: vi.fn(),
  createRun: vi.fn(),
  getPackage: vi.fn(),
  getScenario: vi.fn(),
  listRuns: vi.fn(),
  getRun: vi.fn(),
  getRunLog: vi.fn(),
  getHealth: vi.fn(),
}))

import * as client from '../src/api/client'
import RunLogViewer from '../src/components/runs/RunLogViewer'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const activeRunState: RunState = {
  run_id: 'run-timeline-test-001',
  status: 'completed',
  current_tick: 4,
  pending_proposal: null,
  package_runtime_state: {},
  snapshot: {
    package: { id: 'pkg1', version: '0.1.0', hash: 'abc' },
    scenario: { id: 'sc1', version: '0.1.0', hash: 'def' },
  },
  event_plan: {},
  route_facts: {},
}

/** Mixed-kind log for the main timeline test. */
const mixedRunLog: RunLog = {
  run_id: 'run-timeline-test-001',
  created_at: '2026-06-27T00:00:00Z',
  simulator_version: '0.1.0',
  snapshot: {
    package: { id: 'pkg1', version: '0.1.0', hash: 'abc' },
    scenario: { id: 'sc1', version: '0.1.0', hash: 'def' },
  },
  route_facts: {},
  event_plan: {},
  run_mode: 'standard',
  evidence_status: 'standard',
  events: [
    {
      kind: 'tick',
      tick_index: 1,
      tick_state: {},
      trace: {
        tick_index: 1,
        decision_result: {
          result_type: 'NO_TRIGGER',
          trigger_candidate: false,
          selected_category: null,
          score: 0.2,
          features: {},
          scores: {},
          states: {},
          criteria: {},
          candidates: [],
          fire_control: { fired: false, suppressed: false, override: false, reason: null },
          proposal: null,
          reason_inputs: [],
          explanation: 'No trigger this tick.',
          next_package_runtime_state: {},
        },
      },
    },
    {
      kind: 'action',
      tick_index: 2,
      action: 'accept_rest',
      resulting_status: 'completed',
    },
    {
      kind: 'algorithm_error',
      tick_index: 3,
      error_type: 'ValueError',
      message: 'Invalid return from evaluate()',
    },
    {
      kind: 'feedback',
      target: { scope: 'decision', tick_index: 1, event_ref: 0 },
      labels: {
        proposal_timing: 'appropriate',
        acceptance_reason: { choice: 'rest_needed', note: 'felt really tired' },
      },
      comment: 'Overall good trigger.',
    },
  ],
}

/** Log with empty events array — must not crash. */
const emptyEventsLog: RunLog = {
  run_id: 'run-timeline-test-002',
  created_at: '2026-06-27T00:00:00Z',
  simulator_version: '0.1.0',
  snapshot: {
    package: { id: 'pkg1', version: '0.1.0', hash: 'abc' },
    scenario: { id: 'sc1', version: '0.1.0', hash: 'def' },
  },
  route_facts: {},
  event_plan: {},
  run_mode: 'standard',
  evidence_status: 'standard',
  events: [],
}

// ── Helper ────────────────────────────────────────────────────────────────────

function renderWithStore(
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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('RunLogViewer — evidence timeline', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  // ── T027 backward compat: Load button calls getRunLog ─────────────────────
  it('clicking Load calls getRunLog with the current run_id', async () => {
    vi.mocked(client.getRunLog).mockResolvedValue(mixedRunLog)

    renderWithStore(<RunLogViewer />, (dispatch) => {
      dispatch({ type: 'RUN_CREATED', runState: activeRunState })
    })

    fireEvent.click(screen.getByRole('button', { name: /load/i }))

    await waitFor(() => {
      expect(client.getRunLog).toHaveBeenCalledTimes(1)
      expect(client.getRunLog).toHaveBeenCalledWith('run-timeline-test-001')
    })

    // Timeline must be present after load
    const content = await screen.findByTestId('runlog-content')
    expect(content).toBeInTheDocument()
  })

  // ── Test 1: all event kinds render in order ───────────────────────────────
  it('renders all event kinds in recorded order', async () => {
    vi.mocked(client.getRunLog).mockResolvedValue(mixedRunLog)

    renderWithStore(<RunLogViewer />, (dispatch) => {
      dispatch({ type: 'RUN_CREATED', runState: activeRunState })
    })

    fireEvent.click(screen.getByRole('button', { name: /load/i }))

    // Wait for the timeline to appear
    await screen.findByTestId('runlog-content')

    // All four event kind headers must be visible
    expect(screen.getByTestId('timeline-tick-1')).toBeInTheDocument()
    expect(screen.getByTestId('timeline-action-2')).toBeInTheDocument()
    expect(screen.getByTestId('timeline-algorithm-error-3')).toBeInTheDocument()
    expect(screen.getByTestId('timeline-feedback')).toBeInTheDocument()

    // Check DOM order: tick, then action, then error, then feedback
    const content = screen.getByTestId('runlog-content')
    const tick = screen.getByTestId('timeline-tick-1')
    const action = screen.getByTestId('timeline-action-2')
    const error = screen.getByTestId('timeline-algorithm-error-3')
    const feedback = screen.getByTestId('timeline-feedback')

    // compareDocumentPosition: node B after node A → FOLLOWING (4)
    expect(content.compareDocumentPosition(tick) & Node.DOCUMENT_POSITION_CONTAINED_BY).toBeTruthy()
    expect(tick.compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(action.compareDocumentPosition(error) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(error.compareDocumentPosition(feedback) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  // ── Test 2: tick event expands to show trace ──────────────────────────────
  it('tick event expands to show decision trace on click', async () => {
    vi.mocked(client.getRunLog).mockResolvedValue(mixedRunLog)

    renderWithStore(<RunLogViewer />, (dispatch) => {
      dispatch({ type: 'RUN_CREATED', runState: activeRunState })
    })

    fireEvent.click(screen.getByRole('button', { name: /load/i }))
    await screen.findByTestId('runlog-content')

    // Tick header should show tick#1 and result_type in compact form
    const tickRow = screen.getByTestId('timeline-tick-1')
    expect(tickRow.textContent).toMatch(/tick.*1/i)

    // Detail section is not yet visible
    expect(screen.queryByTestId('timeline-tick-detail-1')).not.toBeInTheDocument()

    // Click to expand
    const expandBtn = screen.getByTestId('timeline-expand-tick-1')
    fireEvent.click(expandBtn)

    // Detail section now visible with result_type
    const detail = await screen.findByTestId('timeline-tick-detail-1')
    expect(detail).toBeInTheDocument()
    expect(detail.textContent).toContain('NO_TRIGGER')
  })

  // ── Test 3: action event expands to show resulting_status ─────────────────
  it('action event expands to show resulting_status', async () => {
    vi.mocked(client.getRunLog).mockResolvedValue(mixedRunLog)

    renderWithStore(<RunLogViewer />, (dispatch) => {
      dispatch({ type: 'RUN_CREATED', runState: activeRunState })
    })

    fireEvent.click(screen.getByRole('button', { name: /load/i }))
    await screen.findByTestId('runlog-content')

    // Expand action event
    fireEvent.click(screen.getByTestId('timeline-expand-action-2'))

    const detail = await screen.findByTestId('timeline-action-detail-2')
    expect(detail.textContent).toContain('completed')
    expect(detail.textContent).toContain('accept_rest')
  })

  // ── Test 4: algorithm error event shows error_type ────────────────────────
  it('algorithm-error event header shows error marker and error_type', async () => {
    vi.mocked(client.getRunLog).mockResolvedValue(mixedRunLog)

    renderWithStore(<RunLogViewer />, (dispatch) => {
      dispatch({ type: 'RUN_CREATED', runState: activeRunState })
    })

    fireEvent.click(screen.getByRole('button', { name: /load/i }))
    await screen.findByTestId('runlog-content')

    const errRow = screen.getByTestId('timeline-algorithm-error-3')
    expect(errRow.textContent).toContain('ValueError')

    // Expand to see message
    fireEvent.click(screen.getByTestId('timeline-expand-algorithm-error-3'))
    const detail = await screen.findByTestId('timeline-algorithm-error-detail-3')
    expect(detail.textContent).toContain('Invalid return from evaluate()')
  })

  // ── Test 5: feedback event — HUMAN REVIEW marker, target, labels, comment ─
  it('feedback event renders visually distinct with HUMAN REVIEW marker, target, labels, and comment', async () => {
    vi.mocked(client.getRunLog).mockResolvedValue(mixedRunLog)

    renderWithStore(<RunLogViewer />, (dispatch) => {
      dispatch({ type: 'RUN_CREATED', runState: activeRunState })
    })

    fireEvent.click(screen.getByRole('button', { name: /load/i }))
    await screen.findByTestId('runlog-content')

    // Feedback element must have the sentinel testid
    const fbRow = screen.getByTestId('timeline-feedback')
    expect(fbRow).toBeInTheDocument()

    // Must show "HUMAN REVIEW" text somewhere in the feedback row
    expect(fbRow.textContent).toMatch(/human review/i)

    // Target scope visible in header
    expect(fbRow.textContent).toContain('decision')

    // Expand to see details
    fireEvent.click(screen.getByTestId('timeline-expand-feedback-0'))

    const detail = await screen.findByTestId('timeline-feedback-detail-0')
    expect(detail).toBeInTheDocument()

    // Labels must appear
    expect(detail.textContent).toContain('proposal_timing')
    expect(detail.textContent).toContain('appropriate')

    // Comment must appear
    expect(detail.textContent).toContain('Overall good trigger.')
  })

  // ── Test 6: note-field value renders both choice and note ─────────────────
  it('feedback label with note-field value renders both choice and note', async () => {
    vi.mocked(client.getRunLog).mockResolvedValue(mixedRunLog)

    renderWithStore(<RunLogViewer />, (dispatch) => {
      dispatch({ type: 'RUN_CREATED', runState: activeRunState })
    })

    fireEvent.click(screen.getByRole('button', { name: /load/i }))
    await screen.findByTestId('runlog-content')

    // Expand feedback
    fireEvent.click(screen.getByTestId('timeline-expand-feedback-0'))
    const detail = await screen.findByTestId('timeline-feedback-detail-0')

    // acceptance_reason has {choice: 'rest_needed', note: 'felt really tired'}
    expect(detail.textContent).toContain('rest_needed')
    expect(detail.textContent).toContain('felt really tired')
  })

  // ── Test 7: empty events array renders without crashing ───────────────────
  it('empty events array renders without crashing', async () => {
    vi.mocked(client.getRunLog).mockResolvedValue(emptyEventsLog)

    renderWithStore(<RunLogViewer />, (dispatch) => {
      dispatch({
        type: 'RUN_CREATED',
        runState: { ...activeRunState, run_id: 'run-timeline-test-002' },
      })
    })

    fireEvent.click(screen.getByRole('button', { name: /load/i }))

    const content = await screen.findByTestId('runlog-content')
    expect(content).toBeInTheDocument()

    // No crash and no event rows
    expect(screen.queryByTestId(/timeline-tick/)).not.toBeInTheDocument()
    expect(screen.queryByTestId('timeline-feedback')).not.toBeInTheDocument()
  })
})
