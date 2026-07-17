/**
 * proposal_fit_band (feature 018, US4) — both ServiceProposalPanel and
 * ContentProposalPanel render a labeled 0-100 "fit" band next to (never
 * instead of) each candidate/item's raw score, equal to `(raw+1)*50`
 * (`fitBand()`, see `src/lib/fitBand.ts`). The raw score itself is
 * unchanged — this only asserts an ADDITIONAL, clearly-labeled column/badge.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { ProposalStoreProvider, useProposalStore } from '../src/state/proposalStore'
import ServiceProposalPanel from '../src/components/proposal/panels/ServiceProposalPanel'
import ContentProposalPanel from '../src/components/proposal/panels/ContentProposalPanel'
import { fitBand } from '../src/lib/fitBand'
import type { ProposalRunLog } from '../src/api/proposalClient'

vi.mock('../src/api/proposalClient', async () => {
  const actual = await vi.importActual<typeof import('../src/api/proposalClient')>('../src/api/proposalClient')
  return {
    ...actual,
    getPackages: vi.fn(),
    createRun: vi.fn(),
    selectService: vi.fn(),
    getDatasetCatalog: vi.fn(),
  }
})

import { getPackages, createRun, getDatasetCatalog } from '../src/api/proposalClient'

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
  supported_services: ['music_playlist'],
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

function serviceRunLog(score: number): ProposalRunLog {
  return {
    run_id: 'prun_fit_band',
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
              candidate_id: 'live_viewing',
              score,
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

function contentRunLog(itemFit: number): ProposalRunLog {
  return {
    run_id: 'prun_fit_band_content',
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
          requested_item_count: 1,
          returned_item_count: 1,
          ordered_items: [
            {
              position: 1,
              item_id: 'synthetic-track-0001',
              item_fit: itemFit,
              trait_values: null,
              feature_contributions: [],
              rationale: ['理由', 'rationale'],
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
          expected_duration_sec: 600,
          lighting_configuration: null,
          approval_policy: 'explicit_opt_in',
          completion_rule: 'plan_exhausted',
          next_transition_policy: 'await_user',
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
}

describe('fit band — ServiceProposalPanel', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(getPackages).mockResolvedValue(packagesResponse() as never)
  })

  it('renders a fit-band badge next to the raw score, equal to (raw+1)*50', async () => {
    vi.mocked(createRun).mockResolvedValue(serviceRunLog(0.77) as never)
    render(
      <ProposalStoreProvider>
        <ServiceProposalPanel />
      </ProposalStoreProvider>,
    )
    await screen.findByText('mock_service_selector_v1')
    fireEvent.click(screen.getByTestId('service-run-button'))
    await waitFor(() => expect(createRun).toHaveBeenCalled())

    const badge = await screen.findByTestId('fit-band-live_viewing')
    // Raw score is still rendered alongside (never replaced).
    expect(screen.getByText('+0.770')).toBeInTheDocument()
    expect(badge.textContent).toContain(String(Math.round(fitBand(0.77))))
    expect(Math.round(fitBand(0.77))).toBe(89)
  })
})

describe('fit band — ContentProposalPanel', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(getPackages).mockResolvedValue(packagesResponse() as never)
    vi.mocked(getDatasetCatalog).mockResolvedValue({ total: 0, songs: [] } as never)
  })

  it('renders a fit-band badge next to the raw item_fit, equal to (raw+1)*50', async () => {
    function Setup() {
      const { dispatch } = useProposalStore()
      React.useEffect(() => {
        dispatch({ type: 'RUN_CREATED', runLog: contentRunLog(0.81) })
      }, [dispatch])
      return null
    }
    render(
      <ProposalStoreProvider>
        <Setup />
        <ContentProposalPanel />
      </ProposalStoreProvider>,
    )

    const badge = await screen.findByTestId('fit-band-synthetic-track-0001')
    expect(badge.textContent).toContain(String(Math.round(fitBand(0.81))))
    expect(Math.round(fitBand(0.81))).toBe(91)
  })
})
