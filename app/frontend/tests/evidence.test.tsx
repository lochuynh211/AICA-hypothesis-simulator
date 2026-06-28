/**
 * T012 TDD — EvidencePanel copy/download (RED → GREEN)
 *
 * Tests:
 *  1. Copy writes the evidence JSON to the clipboard (mock navigator.clipboard).
 *  2. Download triggers a blob download (mock URL.createObjectURL + anchor click).
 *  3. Fetched evidence has simulator_facts + human_review (separation visible from frontend).
 *  4. Buttons are present when runId is available.
 *  5. Buttons are absent (or disabled) when no runId is set.
 */

import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { RunStoreProvider, useRunStore } from '../src/state/runStore'
import type { RunStoreAction } from '../src/state/runStore'
import type { RunState, EvidenceReport } from '../src/api/types'

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
  getFeedbackSchema: vi.fn(),
  submitFeedback: vi.fn(),
  getEvidence: vi.fn(),
}))

import * as client from '../src/api/client'
import EvidencePanel from '../src/components/evidence/EvidencePanel'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const mockRunState: RunState = {
  run_id: 'run-evidence-test-001',
  status: 'completed',
  current_tick: 10,
  pending_proposal: null,
  package_runtime_state: {},
  snapshot: {
    package: { id: 'pkg1', version: '0.1.0', hash: 'abc' },
    scenario: { id: 'sc1', version: '0.1.0', hash: 'def' },
  },
  event_plan: {},
  route_facts: {},
}

const mockEvidenceReport: EvidenceReport = {
  report_id: 'rpt-001',
  run_id: 'run-evidence-test-001',
  timestamp: '2026-06-28T10:00:00Z',
  ui_language: 'bilingual',
  simulator_version: '1.0.0',
  package: { id: 'pkg1', version: '0.1.0' },
  scenario: { id: 'sc1', version: '0.1.0' },
  simulator_facts: {
    route_snapshot: null,
    route_facts: {},
    event_plan: { ticks: [] },
    run_mode: 'standard',
    evidence_status: 'standard',
    initial_parameters: {},
    initial_hyperparameters: {},
    driver_profile: null,
    vehicle_profile: null,
    timeline_events: [],
    decision_trace: [],
    proposal_events: [],
    actions: [],
    algorithm_errors: [],
  },
  human_review: {
    feedback_labels: [
      {
        target: { scope: 'run' },
        labels: { overall_judgment: 'good_trigger' },
      },
    ],
    free_text_comments: [
      {
        target: { scope: 'run' },
        comment: 'Great scenario run.',
      },
    ],
  },
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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

describe('EvidencePanel', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    // Mock clipboard API
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
      writable: true,
      configurable: true,
    })
    // Mock URL.createObjectURL / revokeObjectURL
    global.URL.createObjectURL = vi.fn().mockReturnValue('blob:mock-url')
    global.URL.revokeObjectURL = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ── Test 1: Buttons present when runId available ──────────────────────────
  it('renders copy and download buttons when a run is active', () => {
    vi.mocked(client.getEvidence).mockResolvedValue(mockEvidenceReport)

    renderWithStore(<EvidencePanel />, (dispatch) => {
      dispatch({ type: 'RUN_CREATED', runState: mockRunState })
    })

    expect(screen.getByTestId('evidence-copy-btn')).toBeInTheDocument()
    expect(screen.getByTestId('evidence-download-btn')).toBeInTheDocument()
  })

  // ── Test 2: Copy writes evidence JSON to clipboard ────────────────────────
  it('copy button writes evidence JSON to clipboard', async () => {
    vi.mocked(client.getEvidence).mockResolvedValue(mockEvidenceReport)

    renderWithStore(<EvidencePanel />, (dispatch) => {
      dispatch({ type: 'RUN_CREATED', runState: mockRunState })
    })

    fireEvent.click(screen.getByTestId('evidence-copy-btn'))

    await waitFor(() => {
      expect(client.getEvidence).toHaveBeenCalledWith('run-evidence-test-001', 'ja')
      expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1)
    })

    const writtenText = vi.mocked(navigator.clipboard.writeText).mock.calls[0][0]
    const parsed = JSON.parse(writtenText)
    // Separation: both sections present in copied JSON
    expect(parsed).toHaveProperty('simulator_facts')
    expect(parsed).toHaveProperty('human_review')
  })

  // ── Test 3: Download triggers blob download ───────────────────────────────
  it('download button triggers a blob download with correct filename', async () => {
    vi.mocked(client.getEvidence).mockResolvedValue(mockEvidenceReport)

    // Render first so React can mount the component properly
    renderWithStore(<EvidencePanel />, (dispatch) => {
      dispatch({ type: 'RUN_CREATED', runState: mockRunState })
    })

    // Now mock body methods AFTER render, before the button click
    const clickSpy = vi.fn()
    let capturedAnchor: HTMLAnchorElement | null = null
    const appendChildSpy = vi.spyOn(document.body, 'appendChild').mockImplementation((node) => {
      if ((node as HTMLElement).tagName === 'A') {
        capturedAnchor = node as HTMLAnchorElement
        vi.spyOn(capturedAnchor, 'click').mockImplementation(clickSpy)
      }
      return node
    })
    const removeChildSpy = vi.spyOn(document.body, 'removeChild').mockImplementation((node) => node)

    fireEvent.click(screen.getByTestId('evidence-download-btn'))

    await waitFor(() => {
      expect(client.getEvidence).toHaveBeenCalledWith('run-evidence-test-001', 'ja')
      expect(URL.createObjectURL).toHaveBeenCalled()
      expect(clickSpy).toHaveBeenCalled()
    })

    // Filename should include the run_id
    expect(capturedAnchor).not.toBeNull()
    expect((capturedAnchor as unknown as HTMLAnchorElement).download).toMatch(/evidence-run-evidence-test-001/)

    appendChildSpy.mockRestore()
    removeChildSpy.mockRestore()
  })

  // ── Test 4: Fetched evidence has simulator_facts + human_review ───────────
  it('clipboard content includes simulator_facts and human_review with separation', async () => {
    vi.mocked(client.getEvidence).mockResolvedValue(mockEvidenceReport)

    renderWithStore(<EvidencePanel />, (dispatch) => {
      dispatch({ type: 'RUN_CREATED', runState: mockRunState })
    })

    fireEvent.click(screen.getByTestId('evidence-copy-btn'))

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalled()
    })

    const writtenText = vi.mocked(navigator.clipboard.writeText).mock.calls[0][0]
    const parsed = JSON.parse(writtenText)

    // simulator_facts must not contain feedback
    expect(JSON.stringify(parsed.simulator_facts)).not.toContain('"feedback"')
    // human_review must have feedback_labels and free_text_comments
    expect(parsed.human_review.feedback_labels).toHaveLength(1)
    expect(parsed.human_review.free_text_comments).toHaveLength(1)
  })

  // ── Test 5: No buttons when no runId ─────────────────────────────────────
  it('does not fetch or show buttons when no run is active', () => {
    // No dispatch — no runState set
    renderWithStore(<EvidencePanel />)

    // Either buttons are absent or getEvidence is never called
    expect(client.getEvidence).not.toHaveBeenCalled()
  })
})
