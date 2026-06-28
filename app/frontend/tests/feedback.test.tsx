/**
 * T008 TDD — FeedbackForm (RED → GREEN)
 *
 * Tests:
 *   1. Form renders each field type from a mocked schema
 *      (choice field, text field, choice+note field, fixture extra).
 *   2. Submitting with a filled field calls submitFeedback with the right target.
 *   3. A 400 FeedbackValidationError is surfaced as structured field errors.
 */

import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { RunStoreProvider, useRunStore } from '../src/state/runStore'
import type { RunStoreAction } from '../src/state/runStore'
import type { RunState, FeedbackSchema } from '../src/api/types'
import { FeedbackValidationError } from '../src/api/types'

// ── Mock the client module ─────────────────────────────────────────────────────

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
}))

import * as client from '../src/api/client'

// ── Import component under test (RED: this doesn't exist yet) ─────────────────
import FeedbackForm from '../src/components/feedback/FeedbackForm'

// ── Fixtures ───────────────────────────────────────────────────────────────────

const activeRunState: RunState = {
  run_id: 'run-feedback-test-001',
  status: 'playing',
  current_tick: 3,
  pending_proposal: null,
  package_runtime_state: {},
  snapshot: {
    package: { id: 'rest_rule_based_v0_1', version: '0.1.0', hash: 'abc' },
    scenario: { id: 'uc01_test', version: '0.1.0', hash: 'def' },
  },
  event_plan: {},
  route_facts: {},
}

/**
 * Mock schema with all three field types plus a "fixture extra" field.
 * This covers:
 *   - choice field (no note): proposal_timing
 *   - choice field + note: acceptance_reason
 *   - text field: overall_comments (extra)
 *   - scale field: satisfaction_score (extra)
 */
const mockSchema: FeedbackSchema = {
  fields: [
    {
      key: 'proposal_timing',
      label: { ja: '提案タイミング', en: 'Proposal Timing' },
      type: 'choice',
      options: ['too_early', 'appropriate', 'too_late'],
      note: false,
    },
    {
      key: 'acceptance_reason',
      label: { ja: '承諾理由', en: 'Acceptance Reason' },
      type: 'choice',
      options: ['rest_needed', 'convenient_timing', 'other'],
      note: true,
    },
    {
      key: 'overall_comments',
      label: { ja: 'コメント', en: 'Overall Comments' },
      type: 'text',
    },
    {
      key: 'satisfaction_score',
      label: { ja: '満足度', en: 'Satisfaction Score' },
      type: 'scale',
      min: 1,
      max: 5,
    },
  ],
}

// ── Helper: render with RunStore ───────────────────────────────────────────────

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

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('FeedbackForm', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('renders choice, text, and scale fields from the mocked schema', async () => {
    vi.mocked(client.getFeedbackSchema).mockResolvedValue(mockSchema)
    vi.mocked(client.submitFeedback).mockResolvedValue({
      kind: 'feedback',
      target: { scope: 'run' },
      labels: {},
      comment: null,
    })

    renderWithStore(
      <FeedbackForm target={{ scope: 'run' }} />,
      (dispatch) => {
        dispatch({ type: 'RUN_CREATED', runState: activeRunState })
      },
    )

    // Schema is fetched on mount — wait for fields to appear
    await waitFor(() => {
      expect(client.getFeedbackSchema).toHaveBeenCalledWith('run-feedback-test-001')
    })

    // choice field — rendered as a select or radio group
    await screen.findByText(/proposal timing/i)

    // choice+note field
    expect(screen.getByText(/acceptance reason/i)).toBeInTheDocument()

    // text field — textarea
    expect(screen.getByText(/overall comments/i)).toBeInTheDocument()

    // scale field
    expect(screen.getByText(/satisfaction score/i)).toBeInTheDocument()

    // Always-present free-text comment field (exact label "Comment")
    expect(screen.getByLabelText('Comment', { exact: true })).toBeInTheDocument()
  })

  it('submits feedback with the correct target on form submit', async () => {
    vi.mocked(client.getFeedbackSchema).mockResolvedValue(mockSchema)
    vi.mocked(client.submitFeedback).mockResolvedValue({
      kind: 'feedback',
      target: { scope: 'run' },
      labels: {},
      comment: null,
    })

    const target = { scope: 'run' as const }

    renderWithStore(
      <FeedbackForm target={target} />,
      (dispatch) => {
        dispatch({ type: 'RUN_CREATED', runState: activeRunState })
      },
    )

    // Wait for schema to load
    await waitFor(() => expect(client.getFeedbackSchema).toHaveBeenCalled())
    await screen.findByText(/proposal timing/i)

    // Submit the form without filling any field (all optional)
    const submitButton = screen.getByRole('button', { name: /submit/i })
    fireEvent.click(submitButton)

    await waitFor(() => {
      expect(client.submitFeedback).toHaveBeenCalledTimes(1)
      const [calledRunId, calledBody] = vi.mocked(client.submitFeedback).mock.calls[0]
      expect(calledRunId).toBe('run-feedback-test-001')
      expect(calledBody.target).toEqual(expect.objectContaining({ scope: 'run' }))
    })
  })

  it('shows success message after successful submit', async () => {
    vi.mocked(client.getFeedbackSchema).mockResolvedValue(mockSchema)
    vi.mocked(client.submitFeedback).mockResolvedValue({
      kind: 'feedback',
      target: { scope: 'run' },
      labels: {},
      comment: null,
    })

    renderWithStore(
      <FeedbackForm target={{ scope: 'run' }} />,
      (dispatch) => {
        dispatch({ type: 'RUN_CREATED', runState: activeRunState })
      },
    )

    await waitFor(() => expect(client.getFeedbackSchema).toHaveBeenCalled())
    await screen.findByText(/proposal timing/i)

    fireEvent.click(screen.getByRole('button', { name: /submit/i }))

    await screen.findByTestId('feedback-success')
  })

  it('shows structured validation errors from a 400 response', async () => {
    vi.mocked(client.getFeedbackSchema).mockResolvedValue(mockSchema)
    vi.mocked(client.submitFeedback).mockRejectedValue(
      new FeedbackValidationError({
        validation_errors: [
          { field: 'labels.proposal_timing', message: "Value 'bad' is not valid." },
        ],
      }),
    )

    renderWithStore(
      <FeedbackForm target={{ scope: 'run' }} />,
      (dispatch) => {
        dispatch({ type: 'RUN_CREATED', runState: activeRunState })
      },
    )

    await waitFor(() => expect(client.getFeedbackSchema).toHaveBeenCalled())
    await screen.findByText(/proposal timing/i)

    fireEvent.click(screen.getByRole('button', { name: /submit/i }))

    // Validation errors must appear in the document
    await waitFor(() => {
      const errorEl = screen.getByTestId('feedback-validation-errors')
      expect(errorEl).toBeInTheDocument()
      expect(errorEl.textContent).toContain("Value 'bad' is not valid.")
    })
  })

  it('does not fetch schema when no runId is available', async () => {
    vi.mocked(client.getFeedbackSchema).mockResolvedValue(mockSchema)

    // No RUN_CREATED dispatched → runState is null → no runId
    renderWithStore(<FeedbackForm target={{ scope: 'run' }} />)

    // Give a tick for any potential async calls
    await new Promise((r) => setTimeout(r, 50))

    expect(client.getFeedbackSchema).not.toHaveBeenCalled()
  })
})
