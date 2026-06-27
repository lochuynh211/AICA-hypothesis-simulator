/**
 * T027 TDD — RunLogViewer (RED → GREEN)
 *
 * Test: clicking the "Load" button calls getRunLog(runId) and the returned
 * log JSON content appears in the document.
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

// ── RED: component does not exist yet ────────────────────────────────────────
import RunLogViewer from '../src/components/runs/RunLogViewer'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const activeRunState: RunState = {
  run_id: 'run-viewer-test-001',
  status: 'playing',
  current_tick: 3,
  pending_proposal: null,
  package_runtime_state: {},
  snapshot: {
    package: { id: 'pkg1', version: '0.1.0', hash: 'abc' },
    scenario: { id: 'sc1', version: '0.1.0', hash: 'def' },
  },
  event_plan: {},
  route_facts: {},
}

const fakeRunLog: RunLog = {
  run_id: 'run-viewer-test-001',
  created_at: '2026-06-27T00:00:00Z',
  simulator_version: '0.1.0',
  snapshot: {
    package: { id: 'pkg1', version: '0.1.0', hash: 'abc' },
    scenario: { id: 'sc1', version: '0.1.0', hash: 'def' },
  },
  route_facts: {},
  event_plan: {},
  run_mode: 'normal',
  evidence_status: 'ok',
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
          score: 0.5,
          features: {},
          scores: {},
          states: {},
          criteria: {},
          candidates: [],
          fire_control: { fired: false, suppressed: false, override: false, reason: null },
          proposal: null,
          reason_inputs: [],
          explanation: 'No trigger',
          next_package_runtime_state: {},
        },
      },
    },
  ],
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

describe('RunLogViewer', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('clicking Load calls getRunLog with the current run_id and shows the log content', async () => {
    vi.mocked(client.getRunLog).mockResolvedValue(fakeRunLog)

    renderWithStore(<RunLogViewer />, (dispatch) => {
      dispatch({ type: 'RUN_CREATED', runState: activeRunState })
    })

    const loadButton = screen.getByRole('button', { name: /load/i })
    fireEvent.click(loadButton)

    await waitFor(() => {
      expect(client.getRunLog).toHaveBeenCalledTimes(1)
      expect(client.getRunLog).toHaveBeenCalledWith('run-viewer-test-001')
    })

    // The log JSON content must appear in the document
    const logContent = await screen.findByTestId('runlog-content')
    expect(logContent).toBeInTheDocument()
    // run_id is in the output
    expect(logContent.textContent).toContain('run-viewer-test-001')
  })
})
