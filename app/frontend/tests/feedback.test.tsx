/**
 * T008 TDD — FeedbackForm (RED → GREEN)
 *
 * Tests:
 *   1. Form renders each field type from a mocked schema
 *      (choice field, text field, choice+note field, fixture extra).
 *   2. Submitting with a filled field calls submitFeedback with the right target.
 *   3. A 400 FeedbackValidationError is surfaced as structured field errors.
 *
 * I-1 regression tests:
 *   - RightReviewPanel renders FeedbackForm when run is completed (run scope).
 *   - CockpitView renders FeedbackForm when paused with an active proposal (proposal scope).
 *   - DecisionTracePanel renders a "Give feedback" affordance per trace entry (decision scope).
 */

import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { RunStoreProvider, useRunStore } from '../src/state/runStore'
import type { RunStoreAction } from '../src/state/runStore'
import type { RunState, FeedbackSchema, DecisionResult } from '../src/api/types'
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

// ── Import components under test ──────────────────────────────────────────────
import FeedbackForm from '../src/components/feedback/FeedbackForm'
import RightReviewPanel from '../src/components/layout/RightReviewPanel'
import CockpitView from '../src/components/playback/CockpitView'
import DecisionTracePanel from '../src/components/trace/DecisionTracePanel'

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
      label: { ja: '総評', en: 'Overall Comments' },
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
    // Seed JA: these tests assert Japanese schema labels (the UI default is now English).
    <RunStoreProvider initialLanguage="ja">
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
    await screen.findByText(/提案タイミング/)

    // choice+note field — JA label (default lang is 'ja')
    expect(screen.getByText(/承諾理由/)).toBeInTheDocument()

    // text field — textarea — JA label
    expect(screen.getByText(/総評/)).toBeInTheDocument()

    // scale field — JA label
    expect(screen.getByText(/満足度/)).toBeInTheDocument()

    // Always-present free-text comment field (exact label "Comment")
    expect(screen.getByLabelText('コメント', { exact: true })).toBeInTheDocument()
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
    await screen.findByText(/提案タイミング/)

    // Submit the form without filling any field (all optional)
    const submitButton = screen.getByRole('button', { name: /フィードバックを送信/ })
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
    await screen.findByText(/提案タイミング/)

    fireEvent.click(screen.getByRole('button', { name: /フィードバックを送信/ }))

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
    await screen.findByText(/提案タイミング/)

    fireEvent.click(screen.getByRole('button', { name: /フィードバックを送信/ }))

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

// ── I-1 regression: FeedbackForm reachable in all three attach points ─────────

/** Minimal DecisionResult fixture (no proposal fired). */
const minimalDecision: DecisionResult = {
  result_type: 'NO_TRIGGER',
  trigger_candidate: false,
  selected_category: null,
  score: 0,
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
}

/** Minimal DecisionResult with a fired proposal. */
const proposalDecision: DecisionResult = {
  result_type: 'REST_PROPOSAL',
  trigger_candidate: true,
  selected_category: 'rest_required',
  score: 3.5,
  features: {},
  scores: {},
  states: {},
  criteria: {},
  candidates: [],
  fire_control: { fired: true, suppressed: false, override: false, reason: null },
  proposal: { id: 'rest_required', message: { ja: '休憩を取ってください', en: 'Please take a rest' }, options: ['accept_rest', 'postpone'] },
  reason_inputs: ['drowsiness_level=moderate'],
  explanation: 'Drowsiness detected.',
  next_package_runtime_state: {},
}

const pausedRunState: RunState = {
  run_id: 'run-feedback-test-001',
  status: 'paused',
  current_tick: 5,
  pending_proposal: 'rest_required',
  package_runtime_state: {},
  snapshot: {
    package: { id: 'rest_rule_based_v0_1', version: '0.1.0', hash: 'abc' },
    scenario: { id: 'uc01_test', version: '0.1.0', hash: 'def' },
  },
  event_plan: {},
  route_facts: {},
  allowed_actions: ['accept_rest', 'postpone'],
}

describe('RightReviewPanel — I-1 regression (FeedbackForm shown when run is completed)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(client.getFeedbackSchema).mockResolvedValue(mockSchema)
    vi.mocked(client.getRunLog).mockResolvedValue({
      run_id: 'run-feedback-test-001',
      created_at: '',
      simulator_version: '0.1.0',
      snapshot: { package: { id: 'p', version: '0.1.0', hash: 'x' }, scenario: { id: 's', version: '0.1.0', hash: 'y' } },
      route_facts: {},
      event_plan: {},
      run_mode: 'standard',
      evidence_status: 'standard',
      events: [],
    })
  })

  it('renders the run-feedback section containing FeedbackForm after the run completes', async () => {
    renderWithStore(
      <RightReviewPanel />,
      (dispatch) => {
        dispatch({ type: 'RUN_CREATED', runState: activeRunState })
        dispatch({
          type: 'TICK_APPENDED',
          runState: { ...activeRunState, status: 'completed', current_tick: 1 },
          decision: minimalDecision,
          tickIndex: 0,
          paused: false,
          completed: true,
        })
      },
    )

    // When completed, the run-feedback section should be present.
    // FeedbackForm shows "Loading…" until schema resolves; after that the
    // submit button is the stable target.
    const section = await screen.findByTestId('run-feedback-section')
    expect(section).toBeInTheDocument()
  })
})

describe('Proposal affordances — I-1 regression (overlay in cockpit, feedback in right panel)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(client.getFeedbackSchema).mockResolvedValue(mockSchema)
    vi.mocked(client.actRun).mockResolvedValue(pausedRunState)
  })

  const seedProposal = (dispatch: React.Dispatch<RunStoreAction>) => {
    dispatch({ type: 'RUN_CREATED', runState: pausedRunState })
    dispatch({
      type: 'TICK_APPENDED',
      runState: pausedRunState,
      decision: proposalDecision,
      tickIndex: 5,
      paused: true,
      completed: false,
    })
  }

  it('CockpitView shows the proposal overlay (option buttons) on a paused proposal', async () => {
    renderWithStore(<CockpitView />, seedProposal)
    expect(await screen.findByTestId('proposal-overlay')).toBeInTheDocument()
    // Feedback no longer lives in the middle cockpit.
    expect(screen.queryByTestId('proposal-feedback-section')).not.toBeInTheDocument()
  })

  it('RightReviewPanel shows the proposal-feedback section on a paused proposal', async () => {
    renderWithStore(<RightReviewPanel />, seedProposal)
    expect(await screen.findByTestId('proposal-feedback-section')).toBeInTheDocument()
  })
})

describe('DecisionTracePanel — I-1 regression (per-tick feedback affordance)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(client.getFeedbackSchema).mockResolvedValue(mockSchema)
  })

  it('renders a "Give feedback" button for each trace entry', async () => {
    renderWithStore(
      <DecisionTracePanel />,
      (dispatch) => {
        dispatch({ type: 'RUN_CREATED', runState: activeRunState })
        dispatch({
          type: 'TICK_APPENDED',
          runState: activeRunState,
          decision: minimalDecision,
          tickIndex: 0,
          paused: false,
          completed: false,
        })
      },
    )

    // The per-tick "Give feedback" button must be visible for tick 0.
    const btn = await screen.findByTestId('feedback-toggle-tick-0')
    expect(btn).toBeInTheDocument()
    expect(btn).toHaveAccessibleName(/ティック0にフィードバックする/)
  })
})
