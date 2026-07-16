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
import type { World, WorldClone } from '../src/api/proposalClient'

const DATASET_ID = 'soundcharts-grounded-spotify-compatible-demonstration-seed-1042'

function baseWorld(): World {
  return {
    control_inputs: {
      trigger_purpose: 'rest_recommended',
      lifecycle_stage: 'before_rest_until_stop',
      motion_state: 'driving',
      matrix_version: 'v1',
      dataset_id: DATASET_ID,
    },
    situation: {
      drowsiness_level: 80,
      fatigue_level: 70,
      traffic_state: 'congested',
      road_type: 'highway',
      night_state: 'night',
      monotony_level: 90,
      route_tags: ['highway'],
      destination_tags: ['coast'],
      child_present: false,
      multiple_passengers: false,
      motion_state: 'driving',
      estimated_min_until_rest_spot: 8,
      rest_spot_type: 'sa_pa',
      active_service: null,
      recent_service_rejections: [],
    },
    driver_profile: {
      oshi_registered: true,
      oshi_mode: 'on',
      oshi_id: 'synthetic-artist-0001',
      oshi_type: 'artist',
      oshi_tags: [],
      age_band: '30s',
      gender: 'unspecified',
      hobby_interest_tags: [],
      service_usage_level: {},
      service_recency_state: {},
      scene_service_usage_level: {},
      catalog_item_usage_level: {},
      catalog_item_recency_state: {},
      content_tag_usage_level: {},
      content_tag_recency_state: {},
      scene_content_tag_usage_level: {},
      played_items: [],
      skipped_items: [],
      changed_from_items: [],
      cancelled_content_plans: [],
      completed_items: [],
      manually_selected_items: [],
      repeated_items: [],
      service_proposal_acceptance_rate: {},
      service_recovery_rate: {},
      content_proposal_acceptance_rate: {},
      content_recovery_rate: {},
      service_proposal_acceptance_confidence: {},
      service_recovery_confidence: {},
      content_proposal_acceptance_confidence: {},
      content_recovery_confidence: {},
      scheduled_event_type: null,
      scheduled_event_timing: null,
      scheduled_event_tags: [],
      genre_affinity_v1_enabled: false,
      usage_by_genre: null,
      scene_genre_usage: null,
    },
    catalog_ref: {
      dataset_id: DATASET_ID,
      dataset_version: {
        schema_version: '1.0.0',
        spotify_track_reference_version: '1.0.0',
        spotify_audio_features_reference_version: '1.0.0',
      },
      dataset_hash: 'sha256:83d8079c7a81bc6afbd01cdba65fe2330de66b900a113723814fa938fce516cd',
    },
  }
}

function cloneFixture(): WorldClone {
  return {
    clone_id: 'wclone_20260716-100000_abcdef',
    base_seed_id: 'seed-night-highway-oshi',
    overrides: [{ path: 'situation.drowsiness_level', value: 5 }],
    world: baseWorld(),
    diff: [{ path: 'situation.drowsiness_level', before: 80, after: 5 }],
  }
}

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

  it('sends origin_clone_id on createRun when the loaded world came from a contrast clone (FIX 1 regression)', async () => {
    vi.mocked(createRun).mockResolvedValue(runLogWithCandidates() as never)

    function Setup() {
      const { dispatch } = useProposalStore()
      React.useEffect(() => {
        dispatch({ type: 'CLONE_CREATED', clone: cloneFixture() })
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
    expect(body.origin_clone_id).toBe('wclone_20260716-100000_abcdef')
    expect(body.origin_seed_id).toBe('seed-night-highway-oshi')
  })
})
