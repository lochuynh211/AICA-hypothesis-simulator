import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import React from 'react'
import { ProposalStoreProvider, useProposalStore } from '../src/state/proposalStore'
import EventTimeline from '../src/components/proposal/EventTimeline'
import type { ProposalRunLog, DiscreteEvent } from '../src/api/proposalClient'

function runLogWithEvents(events: DiscreteEvent[]): ProposalRunLog {
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
    },
    events,
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

describe('EventTimeline', () => {
  it('renders an empty-state message when there is no run yet', () => {
    render(
      <ProposalStoreProvider>
        <EventTimeline />
      </ProposalStoreProvider>,
    )
    expect(screen.getByTestId('event-timeline-empty')).toBeInTheDocument()
  })

  it('renders every event in the run log, newest first', () => {
    const events: DiscreteEvent[] = [
      { event_type: 'OPPORTUNITY_OPENED', at: '2026-07-16T00:00:00Z', payload: {} },
      { event_type: 'SERVICE_SELECTED', at: '2026-07-16T00:00:05Z', payload: { candidate_id: 'live_viewing' } },
      { event_type: 'CONTENT_SELECTED', at: '2026-07-16T00:00:10Z', payload: { selected_service_id: 'live_viewing' } },
    ]

    render(
      <ProposalStoreProvider>
        <Setup runLog={runLogWithEvents(events)} />
        <EventTimeline />
      </ProposalStoreProvider>,
    )

    const rows = screen.getAllByText(/OPPORTUNITY_OPENED|SERVICE_SELECTED|CONTENT_SELECTED/)
    expect(rows).toHaveLength(3)
    // Newest-first: CONTENT_SELECTED (last appended) renders before OPPORTUNITY_OPENED.
    expect(screen.getByTestId('event-row-0')).toHaveTextContent('CONTENT_SELECTED')
    expect(screen.getByTestId('event-row-2')).toHaveTextContent('OPPORTUNITY_OPENED')
    expect(screen.getByTestId('event-row-1')).toHaveTextContent('candidate_id=live_viewing')
  })
})
