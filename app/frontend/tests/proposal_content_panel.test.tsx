import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { ProposalStoreProvider, useProposalStore } from '../src/state/proposalStore'
import ContentProposalPanel from '../src/components/proposal/panels/ContentProposalPanel'
import type { ProposalRunLog } from '../src/api/proposalClient'

vi.mock('../src/api/proposalClient', async () => {
  const actual = await vi.importActual<typeof import('../src/api/proposalClient')>('../src/api/proposalClient')
  return { ...actual, getPackages: vi.fn() }
})

import { getPackages } from '../src/api/proposalClient'

const CONTENT_PACKAGE = {
  id: 'mock_content_selector_v1',
  version: '1.0.0',
  label: { ja: 'モック・コンテンツ選定 v1.0', en: 'Mock Content Selector v1.0' },
  family: 'content_selector' as const,
  approach: 'transparent' as const,
  contract_version: '1.0.0',
  supported_services: ['music_playlist', 'humming_karaoke', 'full_karaoke'],
  parameters: { plan_item_count: 5 },
  hyperparameters: [
    {
      key: 'content_category_weights',
      kind: 'table' as const,
      label: { ja: 'コンテンツカテゴリ重み', en: 'Content Category Weights' },
      default: { Situation: 0.55, Preference: 0.3, History: 0.15 },
    },
  ],
}

function packagesResponse() {
  return {
    slots: [],
    packages: [CONTENT_PACKAGE],
    errors: [],
  }
}

function runLogWithPlan(): ProposalRunLog {
  return {
    run_id: 'prun_x',
    created_at: '2026-07-16T00:00:00Z',
    opportunity: {
      opportunity_id: 'op_1',
      trigger_purpose: 'rest_recommended',
      lifecycle_stage: 'after_rest_before_restart',
      allowed_service_ids: ['music_playlist'],
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
      active_service_id: 'music_playlist',
      active_plan_id: null,
    },
    events: [],
    evidence: [
      {
        step: 'content',
        package_id: 'mock_content_selector_v1',
        contract_version: '1.0.0',
        schema_version: '1.0.0',
        matrix_version: 'v1',
        input_snapshot: {},
        output: {
          decision_type: 'complete_plan',
          selected_service_id: 'music_playlist',
          requested_item_count: 5,
          returned_item_count: 2,
          ordered_items: [
            {
              position: 1,
              item_id: 'synthetic-track-0001',
              item_fit: 0.81,
              trait_values: { arousal: 0.72, valence: 0.65 },
              feature_contributions: [
                {
                  feature_id: 'drowsiness_level',
                  e_i: 0.72,
                  a_i: 0.8,
                  alpha: 0.8,
                  beta: 0.2,
                  exact_match: null,
                  response_provenance: 'cdc_su_explicit',
                  r_i: 0.576,
                  base_weight: 0.35,
                  purpose_multiplier: 1.5,
                  mask: 1,
                  effective_weight: 0.525,
                  contribution: 0.3024,
                  formula_version: '1.0.0',
                },
              ],
              rationale: ['「Jessica」を支持', "Supports 'Jessica'"],
            },
            {
              position: 2,
              item_id: 'synthetic-track-0002',
              item_fit: 0.74,
              trait_values: null,
              feature_contributions: [],
              rationale: ['二曲目', 'second track'],
            },
          ],
          mode: {
            service_id: 'music_playlist',
            mode_kind: 'playlist',
            chorus_only: null,
            guide_vocal: null,
            driving_lyrics: null,
            fixed_segment_sec: null,
            stopped_only: null,
            simulated_queue: null,
          },
          expected_duration_sec: 1200,
          lighting_configuration: null,
          approval_policy: 'explicit_opt_in',
          completion_rule: 'plan_exhausted',
          next_transition_policy: 'await_user',
          excluded_items: [{ item_id: 'synthetic-track-0006', reason_codes: ['mock_selection_boundary'] }],
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
}

describe('ContentProposalPanel', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(getPackages).mockResolvedValue(packagesResponse() as never)
  })

  it('shows a waiting placeholder before STEP 1 has produced a content plan', async () => {
    render(
      <ProposalStoreProvider>
        <ContentProposalPanel />
      </ProposalStoreProvider>,
    )
    await waitFor(() => expect(getPackages).toHaveBeenCalled())
    expect(screen.getByTestId('content-waiting')).toBeInTheDocument()
  })

  it('renders the ordered plan items with per-item ReasonBreakdown once a content plan exists', async () => {
    function Setup() {
      const { dispatch } = useProposalStore()
      React.useEffect(() => {
        dispatch({ type: 'RUN_CREATED', runLog: runLogWithPlan() })
      }, [dispatch])
      return null
    }
    render(
      <ProposalStoreProvider>
        <Setup />
        <ContentProposalPanel />
      </ProposalStoreProvider>,
    )
    await waitFor(() => expect(getPackages).toHaveBeenCalled())

    expect(await screen.findByText('synthetic-track-0001')).toBeInTheDocument()
    expect(screen.getByText('synthetic-track-0002')).toBeInTheDocument()
    expect(screen.getAllByTestId('reason-breakdown').length).toBe(2)
  })

  it('renders plan metadata (mode/duration/lighting/policies) and excluded examples, with no aggregate plan score', async () => {
    function Setup() {
      const { dispatch } = useProposalStore()
      React.useEffect(() => {
        dispatch({ type: 'RUN_CREATED', runLog: runLogWithPlan() })
      }, [dispatch])
      return null
    }
    render(
      <ProposalStoreProvider>
        <Setup />
        <ContentProposalPanel />
      </ProposalStoreProvider>,
    )
    await screen.findByText('synthetic-track-0001')
    const meta = screen.getByTestId('plan-metadata')
    expect(meta).toHaveTextContent('playlist')
    expect(meta).toHaveTextContent('plan_exhausted')
    expect(screen.getByTestId('plan-excluded')).toHaveTextContent('synthetic-track-0006')
    expect(screen.queryByTestId('plan-score')).not.toBeInTheDocument()
    expect(screen.queryByText(/plan_score/i)).not.toBeInTheDocument()
  })

  it('renders the item_fit formulation callout', async () => {
    render(
      <ProposalStoreProvider>
        <ContentProposalPanel />
      </ProposalStoreProvider>,
    )
    await waitFor(() => expect(getPackages).toHaveBeenCalled())
    expect(screen.getByTestId('content-formulation')).toHaveTextContent('item_fit')
  })

  it('renders editable parameters and hyperparameter matrices from the content manifest', async () => {
    render(
      <ProposalStoreProvider>
        <ContentProposalPanel />
      </ProposalStoreProvider>,
    )
    expect(await screen.findByLabelText('plan_item_count')).toBeInTheDocument()
    expect(screen.getByText('コンテンツカテゴリ重み')).toBeInTheDocument()
  })

  it('shows the algorithm_error message when the content evidence recorded an error', async () => {
    function Setup() {
      const { dispatch } = useProposalStore()
      React.useEffect(() => {
        const errored: ProposalRunLog = {
          ...runLogWithPlan(),
          status: 'error',
          evidence: [
            {
              step: 'content',
              package_id: 'mock_content_selector_v1',
              contract_version: '1.0.0',
              schema_version: '1.0.0',
              matrix_version: 'v1',
              input_snapshot: {},
              output: null,
              error: { category: 'invalid_return', message: 'boom' },
              used_feature_ids: [],
              unused_available_features: [],
              missing_features: [],
            },
          ],
        }
        dispatch({ type: 'RUN_CREATED', runLog: errored })
      }, [dispatch])
      return null
    }
    render(
      <ProposalStoreProvider>
        <Setup />
        <ContentProposalPanel />
      </ProposalStoreProvider>,
    )
    expect(await screen.findByRole('alert')).toHaveTextContent('boom')
  })
})
