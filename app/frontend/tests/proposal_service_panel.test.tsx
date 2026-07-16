import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { ProposalStoreProvider, useProposalStore } from '../src/state/proposalStore'
import ServiceProposalPanel from '../src/components/proposal/panels/ServiceProposalPanel'

vi.mock('../src/api/proposalClient', async () => {
  const actual = await vi.importActual<typeof import('../src/api/proposalClient')>('../src/api/proposalClient')
  return {
    ...actual,
    getPackages: vi.fn(),
    getMatrix: vi.fn(),
    createRun: vi.fn(),
    selectService: vi.fn(),
  }
})

import { getPackages, createRun, selectService } from '../src/api/proposalClient'

const SERVICE_PACKAGE = {
  id: 'mock_service_selector_v1',
  version: '1.0.0',
  label: { ja: 'モック・サービス選定 v1.0', en: 'Mock Service Selector v1.0' },
  family: 'service_selector' as const,
  approach: 'transparent' as const,
  contract_version: '1.0.0',
  supported_services: [],
  parameters: { top_k: 3, tie_breaker: 'candidate_id_ascending' },
  hyperparameters: [
    {
      key: 'category_weights',
      kind: 'table' as const,
      label: { ja: 'カテゴリ重み', en: 'Category Weights' },
      default: { Situation: 0.8, Preference: 0.12, History: 0.08 },
    },
  ],
}

const CONTENT_PACKAGE = {
  id: 'mock_content_selector_v1',
  version: '1.0.0',
  label: { ja: 'モック・コンテンツ選定 v1.0', en: 'Mock Content Selector v1.0' },
  family: 'content_selector' as const,
  approach: 'transparent' as const,
  contract_version: '1.0.0',
  supported_services: ['music_playlist', 'humming_karaoke', 'full_karaoke'],
  parameters: {},
  hyperparameters: [],
}

function packagesResponse() {
  return {
    slots: [
      { family: 'service_selector', approach: 'transparent', package_id: 'mock_service_selector_v1' },
      { family: 'service_selector', approach: 'constrained_llm', package_id: null },
      { family: 'content_selector', approach: 'transparent', package_id: 'mock_content_selector_v1' },
      { family: 'content_selector', approach: 'constrained_llm', package_id: null },
    ],
    packages: [SERVICE_PACKAGE, CONTENT_PACKAGE],
    errors: [],
  }
}

function runLogWithCandidates() {
  return {
    run_id: 'prun_20260716-000000_abcdef',
    created_at: '2026-07-16T00:00:00Z',
    opportunity: {
      opportunity_id: 'op_1',
      trigger_purpose: 'rest_recommended',
      lifecycle_stage: 'after_rest_before_restart',
      allowed_service_ids: ['live_viewing', 'stretch_video', 'full_karaoke'],
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
              candidate_id: 'live_viewing',
              score: 0.77,
              rationale: ['一位の理由', 'Top rank rationale'],
              supporting_feature_ids: ['drowsiness_level'],
              opposing_feature_ids: [],
              uncertainty: null,
              feature_contributions: [
                {
                  feature_id: 'drowsiness_level',
                  feature_value: 72,
                  response_coefficient: 1.0,
                  weight: 0.25,
                  contribution: 0.18,
                },
              ],
            },
            {
              rank: 2,
              candidate_id: 'stretch_video',
              score: 0.45,
              rationale: ['二位の理由', 'Second rank rationale'],
              supporting_feature_ids: [],
              opposing_feature_ids: [],
              uncertainty: 'moderate',
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
    ],
    status: 'service_selected',
  }
}

describe('ServiceProposalPanel', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(getPackages).mockResolvedValue(packagesResponse() as never)
  })

  it('loads packages and renders the package + mode picker', async () => {
    render(
      <ProposalStoreProvider>
        <ServiceProposalPanel />
      </ProposalStoreProvider>,
    )
    await waitFor(() => expect(getPackages).toHaveBeenCalled())
    expect(await screen.findByText('mock_service_selector_v1')).toBeInTheDocument()
  })

  it('renders editable parameters from the manifest', async () => {
    render(
      <ProposalStoreProvider>
        <ServiceProposalPanel />
      </ProposalStoreProvider>,
    )
    expect(await screen.findByLabelText('top_k')).toBeInTheDocument()
  })

  it('renders the collapsible Hyperparameters (advanced) disclosure with a HyperparamMatrix per hyperparameter', async () => {
    render(
      <ProposalStoreProvider>
        <ServiceProposalPanel />
      </ProposalStoreProvider>,
    )
    await screen.findByText('mock_service_selector_v1')
    const disclosure = screen.getByTestId('hyperparameters-disclosure') as HTMLDetailsElement
    expect(disclosure.tagName.toLowerCase()).toBe('details')
    expect(screen.getByText('カテゴリ重み')).toBeInTheDocument()
  })

  it('renders the service_fit formulation callout', async () => {
    render(
      <ProposalStoreProvider>
        <ServiceProposalPanel />
      </ProposalStoreProvider>,
    )
    await screen.findByText('mock_service_selector_v1')
    expect(screen.getByTestId('service-formulation')).toHaveTextContent('service_fit')
  })

  it('Run calls createRun and renders up to 3 ranked candidates with a reason breakdown', async () => {
    vi.mocked(createRun).mockResolvedValue(runLogWithCandidates() as never)
    render(
      <ProposalStoreProvider>
        <ServiceProposalPanel />
      </ProposalStoreProvider>,
    )
    await screen.findByText('mock_service_selector_v1')
    fireEvent.click(screen.getByTestId('service-run-button'))

    await waitFor(() => expect(createRun).toHaveBeenCalled())
    expect(await screen.findByText('live_viewing')).toBeInTheDocument()
    expect(screen.getByText('stretch_video')).toBeInTheDocument()
    expect(screen.getAllByTestId('reason-breakdown').length).toBe(2)
  })

  it('choosing a candidate calls selectService with its candidate_id', async () => {
    vi.mocked(createRun).mockResolvedValue(runLogWithCandidates() as never)
    const afterSelect = { ...runLogWithCandidates(), status: 'content_selected' }
    vi.mocked(selectService).mockResolvedValue(afterSelect as never)

    render(
      <ProposalStoreProvider>
        <ServiceProposalPanel />
      </ProposalStoreProvider>,
    )
    await screen.findByText('mock_service_selector_v1')
    fireEvent.click(screen.getByTestId('service-run-button'))
    await screen.findByText('stretch_video')

    fireEvent.click(screen.getByTestId('choose-candidate-stretch_video'))

    await waitFor(() =>
      expect(selectService).toHaveBeenCalledWith('prun_20260716-000000_abcdef', 'stretch_video', {
        parameters: {},
        hyperparameters: {},
      }),
    )
  })

  it('exposes the current triggerPurpose/lifecycleStage from the store in the createRun body', async () => {
    vi.mocked(createRun).mockResolvedValue(runLogWithCandidates() as never)

    function Setup() {
      const { dispatch } = useProposalStore()
      React.useEffect(() => {
        dispatch({ type: 'SET_TRIGGER_PURPOSE', purpose: 'route_music' })
      }, [dispatch])
      return null
    }

    render(
      <ProposalStoreProvider>
        <Setup />
        <ServiceProposalPanel />
      </ProposalStoreProvider>,
    )
    await screen.findByText('mock_service_selector_v1')
    fireEvent.click(screen.getByTestId('service-run-button'))

    await waitFor(() => expect(createRun).toHaveBeenCalled())
    const body = vi.mocked(createRun).mock.calls[0][0]
    expect(body.trigger_purpose).toBe('route_music')
    expect(body.service_package_id).toBe('mock_service_selector_v1')
    expect(body.content_package_id).toBe('mock_content_selector_v1')
  })
})
