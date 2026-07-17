/**
 * RecomputePanel (P7 T030/T033/T035, US1/US5) — a display-only control that
 * edits post-rest drowsiness/fatigue and, on "Recompute", calls
 * `recompute(runId, overrides)` and dispatches `RECOMPUTED` with the
 * returned log. A 422 (playback-active / invalid override) surfaces inline
 * (`role="alert"`), never a silent no-op (Constitution I).
 *
 * Mirrors `journey_action_bar.test.tsx`'s fixture/mocking conventions.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { ProposalStoreProvider, useProposalStore } from '../src/state/proposalStore'
import RecomputePanel from '../src/components/proposal/RecomputePanel'
import type { ProposalRunLog } from '../src/api/proposalClient'

vi.mock('../src/api/proposalClient', async () => {
  const actual = await vi.importActual<typeof import('../src/api/proposalClient')>('../src/api/proposalClient')
  return {
    ...actual,
    recompute: vi.fn(),
  }
})

import { recompute } from '../src/api/proposalClient'

function baseRunLog(overrides: Partial<ProposalRunLog> = {}): ProposalRunLog {
  return {
    run_id: 'prun_20260716-000000_abcdef',
    created_at: '2026-07-16T00:00:00Z',
    opportunity: {
      opportunity_id: 'op_1',
      trigger_purpose: 'rest_recommended',
      lifecycle_stage: 'after_rest_before_restart',
      allowed_service_ids: ['live_viewing'],
      simulation_time: '2026-07-16T00:00:00Z',
      run_seed: 'seed-1',
    },
    matrix_version: 'v1',
    world_snapshot: {},
    service_package_id: 'mock_service_selector_v1',
    content_package_id: 'mock_content_selector_v1',
    parameters: {},
    hyperparameters: {},
    journey_state: {
      lifecycle_stage: 'after_rest_before_restart',
      motion_state: 'stopped',
      active_service_id: 'live_viewing',
      active_plan_id: null,
      playback_state: 'idle',
    },
    events: [],
    evidence: [],
    status: 'content_selected',
    mode: 'interactive',
    ...overrides,
  } as unknown as ProposalRunLog
}

function Setup({ runLog }: { runLog: ProposalRunLog }) {
  const { dispatch } = useProposalStore()
  React.useEffect(() => {
    dispatch({ type: 'RUN_CREATED', runLog })
  }, [dispatch, runLog])
  return null
}

describe('RecomputePanel', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('renders nothing (no crash) when there is no run yet', () => {
    render(
      <ProposalStoreProvider>
        <RecomputePanel />
      </ProposalStoreProvider>,
    )
    expect(screen.queryByTestId('recompute-panel')).not.toBeInTheDocument()
  })

  it('renders drowsiness/fatigue editors and a recompute button once a run exists', () => {
    render(
      <ProposalStoreProvider>
        <Setup runLog={baseRunLog()} />
        <RecomputePanel />
      </ProposalStoreProvider>,
    )
    expect(screen.getByTestId('recompute-panel')).toBeInTheDocument()
    expect(screen.getByTestId('recompute-field-drowsiness_level')).toBeInTheDocument()
    expect(screen.getByTestId('recompute-field-fatigue_level')).toBeInTheDocument()
    expect(screen.getByTestId('recompute-button')).toBeInTheDocument()
  })

  it('clicking Recompute calls recompute(runId, overrides) with the entered field values', async () => {
    const updated = baseRunLog({
      opportunity: {
        opportunity_id: 'op_2',
        trigger_purpose: 'rest_recommended',
        lifecycle_stage: 'after_rest_before_restart',
        allowed_service_ids: ['live_viewing'],
        simulation_time: '2026-07-16T00:05:00Z',
        run_seed: 'seed-1',
      },
    })
    vi.mocked(recompute).mockResolvedValue(updated)

    render(
      <ProposalStoreProvider>
        <Setup runLog={baseRunLog()} />
        <RecomputePanel />
      </ProposalStoreProvider>,
    )

    fireEvent.change(screen.getByTestId('recompute-field-drowsiness_level'), { target: { value: '20' } })
    fireEvent.change(screen.getByTestId('recompute-field-fatigue_level'), { target: { value: '30' } })
    fireEvent.click(screen.getByTestId('recompute-button'))

    await waitFor(() =>
      expect(recompute).toHaveBeenCalledWith('prun_20260716-000000_abcdef', [
        { path: 'situation.drowsiness_level', value: 20 },
        { path: 'situation.fatigue_level', value: 30 },
      ]),
    )
  })

  it('recompute with no field edits sends an empty overrides list (pure stage recompute)', async () => {
    vi.mocked(recompute).mockResolvedValue(baseRunLog())

    render(
      <ProposalStoreProvider>
        <Setup runLog={baseRunLog()} />
        <RecomputePanel />
      </ProposalStoreProvider>,
    )

    fireEvent.click(screen.getByTestId('recompute-button'))

    await waitFor(() => expect(recompute).toHaveBeenCalledWith('prun_20260716-000000_abcdef', []))
  })

  it('a successful recompute dispatches RECOMPUTED and the new head opportunity is reflected', async () => {
    const updated = baseRunLog({
      opportunity: {
        opportunity_id: 'op_2',
        trigger_purpose: 'rest_recommended',
        lifecycle_stage: 'after_rest_before_restart',
        allowed_service_ids: ['live_viewing'],
        simulation_time: '2026-07-16T00:05:00Z',
        run_seed: 'seed-1',
      },
    })
    vi.mocked(recompute).mockResolvedValue(updated)

    function Probe() {
      const { state } = useProposalStore()
      return <span data-testid="probe-opportunity-id">{state.runLog?.opportunity.opportunity_id}</span>
    }

    render(
      <ProposalStoreProvider>
        <Setup runLog={baseRunLog()} />
        <RecomputePanel />
        <Probe />
      </ProposalStoreProvider>,
    )

    fireEvent.click(screen.getByTestId('recompute-button'))

    await waitFor(() => expect(screen.getByTestId('probe-opportunity-id')).toHaveTextContent('op_2'))
  })

  it('a 422 (invalid override / playback active) surfaces inline via role="alert", never a silent no-op', async () => {
    vi.mocked(recompute).mockRejectedValue(
      new Error(
        'Proposal API error: 422 — {"code":"recompute_requires_idle_playback","message":"complete or stop first"}',
      ),
    )

    render(
      <ProposalStoreProvider>
        <Setup runLog={baseRunLog()} />
        <RecomputePanel />
      </ProposalStoreProvider>,
    )

    fireEvent.click(screen.getByTestId('recompute-button'))

    const alert = await screen.findByTestId('recompute-error')
    expect(alert).toHaveTextContent(/422/)
    expect(alert.getAttribute('role')).toBe('alert')
  })

  it('renders EN labels by default', () => {
    render(
      <ProposalStoreProvider>
        <Setup runLog={baseRunLog()} />
        <RecomputePanel />
      </ProposalStoreProvider>,
    )
    expect(screen.getByText('Drowsiness level')).toBeInTheDocument()
    expect(screen.getByText('Fatigue level')).toBeInTheDocument()
    expect(screen.getByText('Recompute')).toBeInTheDocument()
  })

  it('renders JA labels when uiLanguage is ja', () => {
    render(
      <ProposalStoreProvider initialLanguage="ja">
        <Setup runLog={baseRunLog()} />
        <RecomputePanel />
      </ProposalStoreProvider>,
    )
    expect(screen.getByText('眠気レベル')).toBeInTheDocument()
    expect(screen.getByText('疲労レベル')).toBeInTheDocument()
    expect(screen.getByText('再計算')).toBeInTheDocument()
  })
})
