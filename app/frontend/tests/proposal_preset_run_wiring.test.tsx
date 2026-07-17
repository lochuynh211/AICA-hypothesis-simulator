/**
 * proposal_preset_run_wiring (feature 018, US1) — a selected preset's
 * `selectedPresetId`/`presetOverrides` must actually reach the backend:
 * `origin_preset_id` + `algorithm_config_overrides` on `createRun` (STEP 1),
 * and `algorithm_config_overrides` on `selectService` (STEP 2) — not just be
 * stashed in the store inertly. Mirrors the backend contract added to
 * `routers/proposal.py` (`CreateProposalRunBody`/`SelectServiceBody`).
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { ProposalStoreProvider, useProposalStore } from '../src/state/proposalStore'
import ServiceProposalPanel from '../src/components/proposal/panels/ServiceProposalPanel'
import type { AlgorithmConfigOverrides, ProposalRunLog, World } from '../src/api/proposalClient'

vi.mock('../src/api/proposalClient', async () => {
  const actual = await vi.importActual<typeof import('../src/api/proposalClient')>('../src/api/proposalClient')
  return { ...actual, getPackages: vi.fn(), createRun: vi.fn(), selectService: vi.fn() }
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
  parameters: { top_k: 3 },
  hyperparameters: [],
}

const CONTENT_PACKAGE = {
  id: 'mock_content_selector_v1',
  version: '1.0.0',
  label: { ja: 'モック・コンテンツ選定 v1.0', en: 'Mock Content Selector v1.0' },
  family: 'content_selector' as const,
  approach: 'transparent' as const,
  contract_version: '1.0.0',
  supported_services: ['full_karaoke'],
  parameters: {},
  hyperparameters: [],
}

function packagesResponse() {
  return {
    slots: [
      { family: 'service_selector', approach: 'transparent', package_id: 'mock_service_selector_v1' },
      { family: 'content_selector', approach: 'transparent', package_id: 'mock_content_selector_v1' },
    ],
    packages: [SERVICE_PACKAGE, CONTENT_PACKAGE],
    errors: [],
  }
}

function fullWorld(): World {
  return {
    control_inputs: {
      trigger_purpose: 'rest_recommended',
      lifecycle_stage: 'after_rest_before_restart',
      motion_state: 'stopped',
      matrix_version: 'v1',
      dataset_id: 'soundcharts-grounded-spotify-compatible-demonstration-seed-1042',
    },
    situation: {
      drowsiness_level: 62,
      fatigue_level: 48,
      traffic_state: 'normal',
      road_type: 'highway',
      night_state: 'night',
      monotony_level: 70,
      route_tags: [],
      destination_tags: [],
      child_present: false,
      multiple_passengers: false,
      motion_state: 'stopped',
      estimated_min_until_rest_spot: null,
      rest_spot_type: 'unknown',
      active_service: null,
      recent_service_rejections: [],
    },
    driver_profile: {
      oshi_registered: false,
      oshi_mode: 'off',
      oshi_id: null,
      oshi_type: null,
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
      dataset_id: 'soundcharts-grounded-spotify-compatible-demonstration-seed-1042',
      dataset_version: {
        schema_version: '1.0.0',
        spotify_track_reference_version: '1.0.0',
        spotify_audio_features_reference_version: '1.0.0',
      },
      dataset_hash: 'sha256:83d8079c7a81bc6afbd01cdba65fe2330de66b900a113723814fa938fce516cd',
    },
  }
}

function serviceSelectedRunLog(): ProposalRunLog {
  return {
    run_id: 'prun_preset_wiring',
    created_at: '2026-07-16T00:00:00Z',
    opportunity: {
      opportunity_id: 'op_1',
      trigger_purpose: 'rest_recommended',
      lifecycle_stage: 'after_rest_before_restart',
      allowed_service_ids: ['full_karaoke'],
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
      active_service_id: null,
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
              score: 0.5,
              rationale: ['理由', 'rationale'],
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
    ],
    status: 'service_selected',
  }
}

describe('preset run-dispatch wiring', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(getPackages).mockResolvedValue(packagesResponse() as never)
  })

  it('threads origin_preset_id + algorithm_config_overrides into createRun after a LOAD_PRESET', async () => {
    const overrides: AlgorithmConfigOverrides = { content: { directional_hypothesis: 'keep_alert' }, service: null }
    vi.mocked(createRun).mockResolvedValue(serviceSelectedRunLog() as never)

    function Setup() {
      const { dispatch } = useProposalStore()
      React.useEffect(() => {
        dispatch({ type: 'LOAD_PRESET', presetId: 'preset-x', world: fullWorld(), overrides })
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

    const [body] = vi.mocked(createRun).mock.calls[0]
    expect(body.origin_preset_id).toBe('preset-x')
    expect(body.algorithm_config_overrides).toEqual(overrides)
  })

  it('threads algorithm_config_overrides into selectService (STEP 2) after a LOAD_PRESET', async () => {
    const overrides: AlgorithmConfigOverrides = { content: { directional_hypothesis: 'keep_alert' }, service: null }
    vi.mocked(createRun).mockResolvedValue(serviceSelectedRunLog() as never)
    vi.mocked(selectService).mockResolvedValue({ ...serviceSelectedRunLog(), status: 'content_selected' } as never)

    function Setup() {
      const { dispatch } = useProposalStore()
      React.useEffect(() => {
        dispatch({ type: 'LOAD_PRESET', presetId: 'preset-x', world: fullWorld(), overrides })
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

    fireEvent.click(await screen.findByTestId('choose-candidate-full_karaoke'))
    await waitFor(() => expect(selectService).toHaveBeenCalled())

    const [, , selectOverrides] = vi.mocked(selectService).mock.calls[0]
    expect(selectOverrides?.algorithm_config_overrides).toEqual(overrides)
  })

  it('sends no algorithm_config_overrides key at all when no preset is selected (byte-compatible default)', async () => {
    vi.mocked(createRun).mockResolvedValue(serviceSelectedRunLog() as never)
    render(
      <ProposalStoreProvider>
        <ServiceProposalPanel />
      </ProposalStoreProvider>,
    )
    await screen.findByText('mock_service_selector_v1')
    fireEvent.click(screen.getByTestId('service-run-button'))
    await waitFor(() => expect(createRun).toHaveBeenCalled())

    const [body] = vi.mocked(createRun).mock.calls[0]
    expect(body.origin_preset_id).toBeNull()
    expect(body.algorithm_config_overrides).toBeUndefined()
  })
})
