import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { ProposalStoreProvider, useProposalStore } from '../src/state/proposalStore'
import JourneyActionBar from '../src/components/proposal/JourneyActionBar'
import type { ProposalRunLog } from '../src/api/proposalClient'

vi.mock('../src/api/proposalClient', async () => {
  const actual = await vi.importActual<typeof import('../src/api/proposalClient')>('../src/api/proposalClient')
  return {
    ...actual,
    journeyAction: vi.fn(),
  }
})

import { journeyAction } from '../src/api/proposalClient'

function baseRunLog(overrides: Partial<ProposalRunLog['journey_state']> = {}): ProposalRunLog {
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
      ...overrides,
    },
    events: [],
    evidence: [],
    status: 'content_selected',
  } as unknown as ProposalRunLog
}

function Setup({ runLog }: { runLog: ProposalRunLog }) {
  const { dispatch } = useProposalStore()
  React.useEffect(() => {
    dispatch({ type: 'RUN_CREATED', runLog })
  }, [dispatch, runLog])
  return null
}

describe('JourneyActionBar', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('renders no-op with all buttons disabled when there is no run yet', () => {
    render(
      <ProposalStoreProvider>
        <JourneyActionBar />
      </ProposalStoreProvider>,
    )
    expect(screen.getByTestId('journey-action-accept')).toBeDisabled()
    expect(screen.getByTestId('journey-action-stop')).toBeDisabled()
  })

  it('renders a button for every action type in the brief', () => {
    render(
      <ProposalStoreProvider>
        <Setup runLog={baseRunLog()} />
        <JourneyActionBar />
      </ProposalStoreProvider>,
    )
    for (const actionType of [
      'accept',
      'reject',
      'choose_another',
      'request_more',
      'complete',
      'continue',
      'stop',
      'motion_change',
    ]) {
      expect(screen.getByTestId(`journey-action-${actionType}`)).toBeInTheDocument()
    }
  })

  it('clicking accept calls journeyAction(runId, "accept", ...) and refreshes the store on success', async () => {
    const updated = baseRunLog({ playback_state: 'active' })
    vi.mocked(journeyAction).mockResolvedValue(updated)

    render(
      <ProposalStoreProvider>
        <Setup runLog={baseRunLog()} />
        <JourneyActionBar />
      </ProposalStoreProvider>,
    )

    fireEvent.click(screen.getByTestId('journey-action-accept'))

    await waitFor(() =>
      expect(journeyAction).toHaveBeenCalledWith('prun_20260716-000000_abcdef', 'accept', {}),
    )
  })

  it('clicking motion_change sends the toggled motion_state as payload', async () => {
    vi.mocked(journeyAction).mockResolvedValue(baseRunLog({ motion_state: 'driving' }))

    render(
      <ProposalStoreProvider>
        <Setup runLog={baseRunLog({ motion_state: 'stopped' })} />
        <JourneyActionBar />
      </ProposalStoreProvider>,
    )

    fireEvent.click(screen.getByTestId('journey-action-motion_change'))

    await waitFor(() =>
      expect(journeyAction).toHaveBeenCalledWith('prun_20260716-000000_abcdef', 'motion_change', {
        motion_state: 'driving',
      }),
    )
  })

  it('a rejected action (422) surfaces the error message inline instead of a silent no-op', async () => {
    vi.mocked(journeyAction).mockRejectedValue(new Error('Proposal API error: 422 — invalid precondition'))

    render(
      <ProposalStoreProvider>
        <Setup runLog={baseRunLog()} />
        <JourneyActionBar />
      </ProposalStoreProvider>,
    )

    fireEvent.click(screen.getByTestId('journey-action-accept'))

    expect(await screen.findByTestId('journey-action-error')).toHaveTextContent(/422/)
  })

  it('disables complete/continue while playback is idle', () => {
    render(
      <ProposalStoreProvider>
        <Setup runLog={baseRunLog({ playback_state: 'idle' })} />
        <JourneyActionBar />
      </ProposalStoreProvider>,
    )
    expect(screen.getByTestId('journey-action-complete')).toBeDisabled()
    expect(screen.getByTestId('journey-action-continue')).toBeDisabled()
  })

  it('enables complete once playback is active', () => {
    render(
      <ProposalStoreProvider>
        <Setup runLog={baseRunLog({ playback_state: 'active' })} />
        <JourneyActionBar />
      </ProposalStoreProvider>,
    )
    expect(screen.getByTestId('journey-action-complete')).toBeEnabled()
  })
})
