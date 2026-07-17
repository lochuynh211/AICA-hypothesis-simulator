/**
 * P7 T032/T036 (US5) — EventTimeline renders RECOMPUTED/CONTEXT_EDITED and
 * the multi-opportunity sequence (grouped by decision point, current head
 * marked distinctly); ContentProposalPanel visually separates the currently
 * committed content from a non-binding preview (FR-017/FR-023).
 *
 * Task 6 (proposal-service-panel-refinements) removed the ServiceProposalPanel
 * lifecycle/motion/allowed-service readout this file used to also cover —
 * see the note above the (now-deleted) describe block below.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { ProposalStoreProvider, useProposalStore } from '../src/state/proposalStore'
import EventTimeline from '../src/components/proposal/EventTimeline'
import ContentProposalPanel from '../src/components/proposal/panels/ContentProposalPanel'
import type { ProposalRunLog, DiscreteEvent } from '../src/api/proposalClient'

vi.mock('../src/api/proposalClient', async () => {
  const actual = await vi.importActual<typeof import('../src/api/proposalClient')>('../src/api/proposalClient')
  return {
    ...actual,
    getPackages: vi.fn(),
    journeyPreview: vi.fn(),
  }
})

import { getPackages, journeyPreview } from '../src/api/proposalClient'

const SERVICE_PACKAGE = {
  id: 'mock_service_selector_v1',
  version: '1.0.0',
  label: { ja: 'モック・サービス選定 v1.0', en: 'Mock Service Selector v1.0' },
  family: 'service_selector' as const,
  approach: 'transparent' as const,
  contract_version: '1.0.0',
  supported_services: [],
  parameters: {},
  hyperparameters: [],
}

const CONTENT_PACKAGE = {
  id: 'mock_content_selector_v1',
  version: '1.0.0',
  label: { ja: 'モック・コンテンツ選定 v1.0', en: 'Mock Content Selector v1.0' },
  family: 'content_selector' as const,
  approach: 'transparent' as const,
  contract_version: '1.0.0',
  supported_services: [],
  parameters: {},
  hyperparameters: [],
}

function packagesResponse() {
  return { slots: [], packages: [SERVICE_PACKAGE, CONTENT_PACKAGE], errors: [] }
}

function runLogWithEvents(events: DiscreteEvent[], overrides: Partial<ProposalRunLog> = {}): ProposalRunLog {
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
    events,
    evidence: [],
    status: 'content_selected',
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

const TWO_OPPORTUNITY_EVENTS: DiscreteEvent[] = [
  { event_type: 'OPPORTUNITY_OPENED', at: '2026-07-16T00:00:00Z', payload: { opportunity_id: 'op_1' } },
  { event_type: 'SERVICE_SELECTED', at: '2026-07-16T00:00:05Z', payload: { candidate_id: 'live_viewing' } },
  { event_type: 'CONTENT_SELECTED', at: '2026-07-16T00:00:10Z', payload: { selected_service_id: 'live_viewing' } },
  {
    event_type: 'CONTEXT_EDITED',
    at: '2026-07-16T00:10:00Z',
    payload: { diffs: [{ path: 'situation.drowsiness_level', before: 62, after: 20 }] },
  },
  {
    event_type: 'OPPORTUNITY_OPENED',
    at: '2026-07-16T00:10:01Z',
    payload: { opportunity_id: 'op_2', trigger_purpose: 'rest_recommended', lifecycle_stage: 'after_rest_before_restart' },
  },
  {
    event_type: 'RECOMPUTED',
    at: '2026-07-16T00:10:02Z',
    payload: { from_opportunity_id: 'op_1', to_opportunity_id: 'op_2' },
  },
  { event_type: 'SERVICE_SELECTED', at: '2026-07-16T00:10:03Z', payload: { candidate_id: 'stretch_video' } },
]

describe('EventTimeline — multi-opportunity sequence + RECOMPUTED/CONTEXT_EDITED (P7 US5)', () => {
  it('renders RECOMPUTED and CONTEXT_EDITED rows', () => {
    render(
      <ProposalStoreProvider>
        <Setup runLog={runLogWithEvents(TWO_OPPORTUNITY_EVENTS, { opportunity: { ...runLogWithEvents([]).opportunity, opportunity_id: 'op_2' } })} />
        <EventTimeline />
      </ProposalStoreProvider>,
    )
    expect(screen.getAllByText(/RECOMPUTED/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/CONTEXT_EDITED/).length).toBeGreaterThan(0)
  })

  it('groups events into decision-point sections per opportunity_id, marking the current head', () => {
    const runLog = runLogWithEvents(TWO_OPPORTUNITY_EVENTS, {
      opportunity: { ...runLogWithEvents([]).opportunity, opportunity_id: 'op_2' },
    })
    render(
      <ProposalStoreProvider>
        <Setup runLog={runLog} />
        <EventTimeline />
      </ProposalStoreProvider>,
    )
    // Two distinct decision-point groups — one per opportunity.
    expect(screen.getByTestId('decision-point-op_1')).toBeInTheDocument()
    expect(screen.getByTestId('decision-point-op_2')).toBeInTheDocument()
    // The current head's group is marked distinctly from history.
    expect(screen.getByTestId('decision-point-op_2')).toHaveTextContent(/現在|current/i)
  })

  it('renders bilingual captions for the new P7 event types in EN (default)', () => {
    const runLog = runLogWithEvents(TWO_OPPORTUNITY_EVENTS, {
      opportunity: { ...runLogWithEvents([]).opportunity, opportunity_id: 'op_2' },
    })
    render(
      <ProposalStoreProvider>
        <Setup runLog={runLog} />
        <EventTimeline />
      </ProposalStoreProvider>,
    )
    expect(screen.getByText('Recomputed')).toBeInTheDocument()
    expect(screen.getByText('Context edited')).toBeInTheDocument()
  })

  it('renders bilingual captions for the new P7 event types in JA', () => {
    const runLog = runLogWithEvents(TWO_OPPORTUNITY_EVENTS, {
      opportunity: { ...runLogWithEvents([]).opportunity, opportunity_id: 'op_2' },
    })
    render(
      <ProposalStoreProvider initialLanguage="ja">
        <Setup runLog={runLog} />
        <EventTimeline />
      </ProposalStoreProvider>,
    )
    expect(screen.getByText('再計算されました')).toBeInTheDocument()
    expect(screen.getByText('コンテキストが編集されました')).toBeInTheDocument()
  })
})

// Task 6 (proposal-service-panel-refinements) removed the lifecycle/motion/
// allowed-service readout from ServiceProposalPanel entirely (no migration
// target — the journey_state/opportunity data it rendered is no longer
// surfaced in this panel at all), so the describe block that used to live
// here ("ServiceProposalPanel — lifecycle/motion/allowed-service readout
// (FR-022)") was deleted rather than migrated. The absence of
// `journey-readout` is now covered by
// `proposal_service_panel.test.tsx` ("does not render journey readout...").

describe('ContentProposalPanel — committed action vs non-binding preview (FR-017/FR-023)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(getPackages).mockResolvedValue(packagesResponse())
  })

  it('requesting a preview renders it in a visually separate, clearly non-binding block', async () => {
    vi.mocked(journeyPreview).mockResolvedValue({
      binding: false,
      steps: [{ label: 'next_content', lifecycle_stage: 'active_driving_content', note: null }],
    })

    const runLog = runLogWithEvents([])
    render(
      <ProposalStoreProvider>
        <Setup runLog={runLog} />
        <ContentProposalPanel />
      </ProposalStoreProvider>,
    )
    await waitFor(() => expect(getPackages).toHaveBeenCalled())

    expect(screen.queryByTestId('content-preview-panel')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('content-preview-button'))

    const previewPanel = await screen.findByTestId('content-preview-panel')
    expect(previewPanel).toHaveTextContent(/non-binding|非拘束|プレビュー/i)
    expect(journeyPreview).toHaveBeenCalledWith('prun_20260716-000000_abcdef')
  })

  it('the preview never mutates the run log (display-only, no commit)', async () => {
    vi.mocked(journeyPreview).mockResolvedValue({
      binding: false,
      steps: [{ label: 'next_content', lifecycle_stage: 'active_driving_content', note: null }],
    })

    function Probe() {
      const { state } = useProposalStore()
      return <span data-testid="probe-status">{state.runLog?.status}</span>
    }

    const runLog = runLogWithEvents([])
    render(
      <ProposalStoreProvider>
        <Setup runLog={runLog} />
        <ContentProposalPanel />
        <Probe />
      </ProposalStoreProvider>,
    )
    await waitFor(() => expect(getPackages).toHaveBeenCalled())

    fireEvent.click(screen.getByTestId('content-preview-button'))
    await screen.findByTestId('content-preview-panel')

    expect(screen.getByTestId('probe-status')).toHaveTextContent('content_selected')
  })
})
