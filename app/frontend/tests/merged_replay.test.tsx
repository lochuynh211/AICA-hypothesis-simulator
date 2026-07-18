/**
 * merged_replay.test.tsx (feature 020, Slice-2c Task 6) — correlation replay:
 *   - `MergedRunsScreen` lists persisted merged runs (`listMergedRuns`).
 *   - Selecting a row mounts `MergedReplayViewer`, which fetches
 *     `getMergedRun(id)` (pure disk read) and renders the reused
 *     `ReplayControls` (trigger-side scrubber).
 *   - Scrubbing to a tick with a correlated proposal event shows BOTH the
 *     trigger trace row and the proposal event — read-only: no live
 *     tick/action controls anywhere, and `createMergedRun`/`tickMergedRun`/
 *     `mergedProposalAction`/`mergedQuickview` are never invoked.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { RunLog, DecisionResult } from '../src/api/types'
import type { ProposalRunLog } from '../src/api/proposalClient'
import type { GetMergedRunResponse, MergedRunSummary } from '../src/api/mergedClient'

vi.mock('../src/api/mergedClient', () => ({
  createMergedRun: vi.fn(),
  tickMergedRun: vi.fn(),
  mergedProposalAction: vi.fn(),
  acceptRest: vi.fn(),
  buildMergedPlan: vi.fn(),
  mergedQuickview: vi.fn(),
  getMergedRun: vi.fn(),
  listMergedRuns: vi.fn(),
}))

import {
  createMergedRun,
  tickMergedRun,
  mergedProposalAction,
  mergedQuickview,
  getMergedRun,
  listMergedRuns,
} from '../src/api/mergedClient'

// New files under test (don't exist yet at RED time) ────────────────────────
import { createMergedReplaySource } from '../src/replay/mergedReplaySource'
import MergedReplayViewer from '../src/components/merged/MergedReplayViewer'
import MergedRunsScreen from '../src/components/merged/MergedRunsScreen'

// ── Fixtures ─────────────────────────────────────────────────────────────

const noFireControl = { fired: false, suppressed: false, override: false, reason: null }

const decisionTick0: DecisionResult = {
  result_type: 'NO_TRIGGER',
  trigger_candidate: false,
  selected_category: null,
  score: null,
  features: {},
  scores: {},
  states: {},
  criteria: {},
  candidates: [],
  fire_control: noFireControl,
  proposal: null,
  reason_inputs: [],
  explanation: 'No trigger at tick 0',
  next_package_runtime_state: {},
}

const decisionTick1: DecisionResult = {
  result_type: 'REST_PROPOSAL',
  trigger_candidate: true,
  selected_category: 'rest_required',
  score: 0.9,
  features: {},
  scores: {},
  states: {},
  criteria: {},
  candidates: [],
  fire_control: { fired: true, suppressed: false, override: false, reason: null },
  proposal: { id: 'rest_guidance', message: { ja: '休憩してください', en: 'Please rest' }, options: ['accept_rest'] },
  reason_inputs: [],
  explanation: 'Drowsiness exceeded threshold',
  next_package_runtime_state: {},
}

const triggerLog: RunLog = {
  run_id: 'trigger-run-001',
  created_at: '2026-07-18T00:00:00Z',
  simulator_version: '0.1.0',
  snapshot: {
    package: { id: 'pkg1', version: '0.1.0', hash: 'abc' },
    scenario: { id: 'scen1', version: '0.1.0', hash: 'def' },
  },
  route_facts: {},
  event_plan: {
    ticks: [
      { tick_index: 0, route_fraction: 0.0 },
      { tick_index: 1, route_fraction: 0.2 },
    ],
  },
  run_mode: 'standard',
  evidence_status: 'standard',
  events: [
    {
      kind: 'tick' as const,
      tick_index: 0,
      tick_state: {},
      trace: { tick_index: 0, decision_result: decisionTick0 },
    },
    {
      kind: 'tick' as const,
      tick_index: 1,
      tick_state: {},
      trace: { tick_index: 1, decision_result: decisionTick1 },
    },
  ],
}

const proposalLog: ProposalRunLog = {
  run_id: 'prop-run-001',
  created_at: '2026-07-18T00:00:01Z',
  opportunity: {
    opportunity_id: 'opp-1',
    trigger_purpose: 'rest_recommended',
    lifecycle_stage: 'before_rest_until_stop',
    allowed_service_ids: [],
    simulation_time: 0,
    run_seed: 'seed-1',
  },
  matrix_version: 'v1',
  world_snapshot: {},
  service_package_id: 'svc-pkg',
  content_package_id: null,
  parameters: {},
  hyperparameters: {},
  journey_state: {
    lifecycle_stage: 'before_rest_until_stop',
    motion_state: 'driving',
    active_service_id: null,
    active_plan_id: null,
  },
  events: [{ event_type: 'OPPORTUNITY_OPENED', at: 1, payload: { trigger_purpose: 'rest_recommended' } }],
  evidence: [],
  status: 'created',
}

const mergedRunDetail: GetMergedRunResponse = {
  handle: {
    merged_run_id: 'merged-001',
    trigger_run_id: 'trigger-run-001',
    world_template: {},
    service_package_id: 'svc-pkg',
    content_package_id: 'content-pkg',
    proposal_mode: 'interactive',
    run_seed: 'seed-1',
    proposal_run_ids: ['prop-run-001'],
    current_proposal_run_id: 'prop-run-001',
    correlation_log: [{ trigger_tick_index: 1, proposal_run_id: 'prop-run-001', proposal_event_ids: [] }],
    rest_stage_synced: null,
    nap_minutes: null,
  },
  trigger_log: triggerLog,
  proposal_logs: [proposalLog],
}

const runSummaries: MergedRunSummary[] = [
  { merged_run_id: 'merged-001', trigger_run_id: 'trigger-run-001', proposal_run_ids_count: 1 },
]

beforeEach(() => {
  vi.resetAllMocks()
})

// ── createMergedReplaySource — pure projector unit tests ────────────────────

describe('createMergedReplaySource (pure projector)', () => {
  it('reuses the trigger-side range (minIndex/maxIndex/tickCount)', () => {
    const source = createMergedReplaySource({
      trigger_log: triggerLog,
      proposal_logs: [proposalLog],
      correlation: mergedRunDetail.handle.correlation_log,
    })
    expect(source.minIndex).toBe(0)
    expect(source.maxIndex).toBe(1)
    expect(source.tickCount).toBe(2)
  })

  it('getAt(0) returns the trigger tick and no proposal events', () => {
    const source = createMergedReplaySource({
      trigger_log: triggerLog,
      proposal_logs: [proposalLog],
      correlation: mergedRunDetail.handle.correlation_log,
    })
    const at0 = source.getAt(0)
    expect(at0.trigger?.decision.result_type).toBe('NO_TRIGGER')
    expect(at0.proposalEvents).toEqual([])
  })

  it('getAt(1) returns the trigger tick AND the correlated proposal event', () => {
    const source = createMergedReplaySource({
      trigger_log: triggerLog,
      proposal_logs: [proposalLog],
      correlation: mergedRunDetail.handle.correlation_log,
    })
    const at1 = source.getAt(1)
    expect(at1.trigger?.decision.result_type).toBe('REST_PROPOSAL')
    expect(at1.proposalEvents).toHaveLength(1)
    expect(at1.proposalEvents[0].event_type).toBe('OPPORTUNITY_OPENED')
  })

  it('a proposal run with no matching correlation entry buckets under tick 0', () => {
    const source = createMergedReplaySource({
      trigger_log: triggerLog,
      proposal_logs: [proposalLog],
      correlation: [],
    })
    expect(source.getAt(0).proposalEvents).toHaveLength(1)
  })

  it('handles a null trigger_log gracefully (empty trigger side)', () => {
    const source = createMergedReplaySource({ trigger_log: null, proposal_logs: [], correlation: [] })
    expect(source.tickCount).toBe(0)
    expect(source.minIndex).toBe(0)
    expect(source.getAt(0).trigger).toBeNull()
    expect(source.getAt(0).proposalEvents).toEqual([])
  })
})

// ── MergedReplayViewer — fetch + reused ReplayControls + read-only trace ────

describe('MergedReplayViewer', () => {
  beforeEach(() => {
    vi.mocked(getMergedRun).mockResolvedValue(mergedRunDetail)
  })

  it('fetches getMergedRun(id) and renders the reused ReplayControls', async () => {
    render(<MergedReplayViewer mergedRunId="merged-001" />)
    await waitFor(() => expect(getMergedRun).toHaveBeenCalledWith('merged-001'))
    expect(await screen.findByTestId('replay-controls')).toBeInTheDocument()
    expect(await screen.findByTestId('replay-scrubber')).toBeInTheDocument()
  })

  it('shows the tick-0 trigger trace (NO_TRIGGER) and no proposal events initially', async () => {
    render(<MergedReplayViewer mergedRunId="merged-001" />)
    await waitFor(() => expect(screen.getByTestId('replay-scrubber')).toBeInTheDocument())
    expect(screen.getByTestId('merged-replay-trigger-0')).toHaveTextContent('NO_TRIGGER')
    expect(screen.getByTestId('merged-replay-no-proposal-events')).toBeInTheDocument()
  })

  it('scrubbing to tick-1 shows BOTH the trigger trace row and the correlated proposal event', async () => {
    render(<MergedReplayViewer mergedRunId="merged-001" />)
    await waitFor(() => expect(screen.getByTestId('replay-scrubber')).toBeInTheDocument())

    fireEvent.change(screen.getByTestId('replay-scrubber'), { target: { value: '1' } })

    await waitFor(() => {
      expect(screen.getByTestId('merged-replay-trigger-1')).toHaveTextContent('REST_PROPOSAL')
    })
    expect(screen.getByTestId('merged-replay-proposal-0-OPPORTUNITY_OPENED')).toBeInTheDocument()
  })

  it('is read-only: no live tick/action controls, and no live endpoint is ever called', async () => {
    render(<MergedReplayViewer mergedRunId="merged-001" />)
    await waitFor(() => expect(screen.getByTestId('replay-scrubber')).toBeInTheDocument())

    fireEvent.change(screen.getByTestId('replay-scrubber'), { target: { value: '1' } })
    fireEvent.change(screen.getByTestId('replay-scrubber'), { target: { value: '0' } })

    expect(screen.queryByTestId('merged-tick-button')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /choose/i })).not.toBeInTheDocument()
    expect(createMergedRun).not.toHaveBeenCalled()
    expect(tickMergedRun).not.toHaveBeenCalled()
    expect(mergedProposalAction).not.toHaveBeenCalled()
    expect(mergedQuickview).not.toHaveBeenCalled()
  })
})

// ── MergedRunsScreen — list -> select -> mount viewer ───────────────────────

describe('MergedRunsScreen', () => {
  beforeEach(() => {
    vi.mocked(listMergedRuns).mockResolvedValue(runSummaries)
    vi.mocked(getMergedRun).mockResolvedValue(mergedRunDetail)
  })

  it('lists persisted merged runs from listMergedRuns()', async () => {
    render(<MergedRunsScreen />)
    expect(await screen.findByTestId('merged-run-row-merged-001')).toBeInTheDocument()
  })

  it('selecting a run mounts MergedReplayViewer, which fetches getMergedRun + renders ReplayControls', async () => {
    render(<MergedRunsScreen />)
    fireEvent.click(await screen.findByTestId('merged-run-row-merged-001'))

    await waitFor(() => expect(getMergedRun).toHaveBeenCalledWith('merged-001'))
    expect(await screen.findByTestId('replay-controls')).toBeInTheDocument()
  })

  it('scrubbing the mounted viewer to a correlated tick shows both trigger + proposal rows', async () => {
    render(<MergedRunsScreen />)
    fireEvent.click(await screen.findByTestId('merged-run-row-merged-001'))
    await waitFor(() => expect(screen.getByTestId('replay-scrubber')).toBeInTheDocument())

    fireEvent.change(screen.getByTestId('replay-scrubber'), { target: { value: '1' } })

    await waitFor(() => {
      expect(screen.getByTestId('merged-replay-trigger-1')).toHaveTextContent('REST_PROPOSAL')
    })
    expect(screen.getByTestId('merged-replay-proposal-0-OPPORTUNITY_OPENED')).toBeInTheDocument()
  })

  it('shows an empty state when there are no persisted merged runs', async () => {
    vi.mocked(listMergedRuns).mockResolvedValue([])
    render(<MergedRunsScreen />)
    expect(await screen.findByTestId('merged-runs-empty')).toBeInTheDocument()
  })
})
