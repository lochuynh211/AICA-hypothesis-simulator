import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ProposalStoreProvider } from '../src/state/proposalStore'
import ProposalRunsScreen from '../src/components/proposal/ProposalRunsScreen'

const RUN_SUMMARY = {
  run_id: 'prun_20260716-100000_abcdef',
  status: 'content_selected',
  opportunity_id: 'op_20260716-100000_abcdef',
  created_at: '2026-07-16T10:00:00Z',
  service_package_id: 'mock_service_selector_v1',
  content_package_id: 'mock_content_selector_v1',
}

const RUN_LOG = {
  run_id: RUN_SUMMARY.run_id,
  created_at: RUN_SUMMARY.created_at,
  opportunity: {
    opportunity_id: RUN_SUMMARY.opportunity_id,
    trigger_purpose: 'rest_recommended',
    lifecycle_stage: 'after_rest_before_restart',
    allowed_service_ids: ['full_karaoke', 'call_response_stopped'],
    simulation_time: '2026-07-16T10:00:00Z',
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
    active_service_id: 'full_karaoke',
    active_plan_id: null,
  },
  events: [],
  evidence: [
    {
      step: 'service',
      package_id: 'mock_service_selector_v1',
      contract_version: '1.0.0',
      schema_version: '1.0.0',
      matrix_version: 'v1',
      input_snapshot: {},
      output: {
        decision_type: 'ranked_candidates',
        ranked_candidates: [
          {
            rank: 1,
            candidate_id: 'full_karaoke',
            score: 0.8,
            rationale: ['日本語の理由', 'English rationale'],
            supporting_feature_ids: [],
            opposing_feature_ids: [],
            uncertainty: null,
            feature_contributions: [],
          },
        ],
        excluded_candidates: [],
        unused_available_features: [],
        missing_features: [],
        next_package_runtime_state: {},
        algorithm_provenance: {},
      },
      error: null,
      used_feature_ids: [],
      unused_available_features: [],
      missing_features: [],
    },
    {
      step: 'content',
      package_id: 'mock_content_selector_v1',
      contract_version: '1.0.0',
      schema_version: '1.0.0',
      matrix_version: 'v1',
      input_snapshot: {},
      output: {
        decision_type: 'complete_plan',
        selected_service_id: 'full_karaoke',
        requested_item_count: 1,
        returned_item_count: 1,
        ordered_items: [
          {
            position: 1,
            item_id: 'synthetic-track-001',
            item_fit: 0.7,
            trait_values: null,
            feature_contributions: [],
            rationale: ['曲の理由', 'track rationale'],
          },
        ],
        mode: {
          service_id: 'full_karaoke',
          mode_kind: 'full_karaoke',
          chorus_only: null,
          guide_vocal: null,
          driving_lyrics: null,
          fixed_segment_sec: null,
          stopped_only: null,
          simulated_queue: null,
        },
        expected_duration_sec: 180,
        lighting_configuration: null,
        approval_policy: 'auto',
        completion_rule: 'natural_end',
        next_transition_policy: 'idle',
        excluded_items: [],
        unused_available_features: [],
        missing_features: [],
        algorithm_provenance: {},
      },
      error: null,
      used_feature_ids: [],
      unused_available_features: [],
      missing_features: [],
    },
  ],
  status: 'content_selected',
}

function mockFetchSequence(responses: Array<{ ok: boolean; status?: number; json?: () => Promise<unknown> }>) {
  let call = 0
  global.fetch = vi.fn().mockImplementation(() => {
    const resp = responses[Math.min(call, responses.length - 1)]
    call += 1
    return Promise.resolve(resp)
  })
}

describe('ProposalRunsScreen', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('lists persisted runs from GET /api/proposal/runs', async () => {
    mockFetchSequence([{ ok: true, json: async () => [RUN_SUMMARY] }])

    render(
      <ProposalStoreProvider>
        <ProposalRunsScreen />
      </ProposalStoreProvider>,
    )

    await waitFor(() => expect(screen.getByTestId(`run-row-${RUN_SUMMARY.run_id}`)).toBeInTheDocument())
    expect(global.fetch).toHaveBeenCalledWith('/api/proposal/runs', { method: 'GET' })
    expect(screen.getByText(RUN_SUMMARY.run_id)).toBeInTheDocument()
  })

  it('shows an empty-state message when there are no persisted runs', async () => {
    mockFetchSequence([{ ok: true, json: async () => [] }])

    render(
      <ProposalStoreProvider>
        <ProposalRunsScreen />
      </ProposalStoreProvider>,
    )

    await waitFor(() => expect(screen.getByTestId('runs-empty')).toBeInTheDocument())
  })

  it('Reopen loads the full run log and renders the recorded evidence read-only', async () => {
    mockFetchSequence([
      { ok: true, json: async () => [RUN_SUMMARY] },
      { ok: true, json: async () => RUN_LOG },
    ])

    render(
      <ProposalStoreProvider>
        <ProposalRunsScreen />
      </ProposalStoreProvider>,
    )

    await waitFor(() => expect(screen.getByTestId(`run-row-${RUN_SUMMARY.run_id}`)).toBeInTheDocument())
    fireEvent.click(screen.getByTestId(`reopen-run-${RUN_SUMMARY.run_id}`))

    await waitFor(() => expect(screen.getByTestId('run-detail')).toBeInTheDocument())
    expect(global.fetch).toHaveBeenCalledWith(`/api/proposal/runs/${RUN_SUMMARY.run_id}`, { method: 'GET' })

    // Recorded service result + content plan rendered from the stored log.
    expect(screen.getByTestId('detail-candidate-full_karaoke')).toBeInTheDocument()
    expect(screen.getByTestId('detail-plan-item-synthetic-track-001')).toBeInTheDocument()
    expect(screen.getByTestId('detail-opportunity').textContent).toContain(RUN_SUMMARY.opportunity_id)
  })

  it('Delete removes the run from the backend and from the list', async () => {
    mockFetchSequence([
      { ok: true, json: async () => [RUN_SUMMARY] },
      { ok: true, json: async () => ({}) }, // DELETE response (204, body ignored)
    ])

    render(
      <ProposalStoreProvider>
        <ProposalRunsScreen />
      </ProposalStoreProvider>,
    )

    await waitFor(() => expect(screen.getByTestId(`run-row-${RUN_SUMMARY.run_id}`)).toBeInTheDocument())
    fireEvent.click(screen.getByTestId(`delete-run-${RUN_SUMMARY.run_id}`))

    await waitFor(() => expect(screen.queryByTestId(`run-row-${RUN_SUMMARY.run_id}`)).not.toBeInTheDocument())
    expect(global.fetch).toHaveBeenCalledWith(`/api/proposal/runs/${RUN_SUMMARY.run_id}`, { method: 'DELETE' })
    expect(screen.getByTestId('runs-empty')).toBeInTheDocument()
  })
})
