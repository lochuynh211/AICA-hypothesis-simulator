/**
 * T035 (P3c) — ContentProposalPanel renders the REAL transparent content
 * selector's CompletePlan (ordered items + per-item reasoning) exactly as it
 * does for the mock, and gracefully handles the honest non-complete_plan
 * outcomes (`no_proposal`, `insufficient_eligible_items`, etc.) a real
 * package can return over the frozen catalog. Also verifies the "MOCK DATA"
 * marker is scoped to the SERVICE panel only — STEP 2 content is now real.
 */
import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { ProposalStoreProvider, useProposalStore } from '../src/state/proposalStore'
import ContentProposalPanel from '../src/components/proposal/panels/ContentProposalPanel'
import ServiceProposalPanel from '../src/components/proposal/panels/ServiceProposalPanel'
import type { ProposalRunLog } from '../src/api/proposalClient'

vi.mock('../src/api/proposalClient', async () => {
  const actual = await vi.importActual<typeof import('../src/api/proposalClient')>('../src/api/proposalClient')
  return { ...actual, getPackages: vi.fn(), createRun: vi.fn(), selectService: vi.fn() }
})

import { getPackages } from '../src/api/proposalClient'

const REAL_CONTENT_PACKAGE_ID = 'aica_transparent_content_selector_v1'

const REAL_CONTENT_PACKAGE = {
  id: REAL_CONTENT_PACKAGE_ID,
  version: '1.0.0',
  label: { ja: '透明音楽コンテンツ選定 v1.0', en: 'Transparent Music Content Selector v1.0' },
  family: 'content_selector' as const,
  approach: 'transparent' as const,
  contract_version: '1.0.0',
  supported_services: ['music_playlist', 'humming_karaoke', 'full_karaoke'],
  parameters: { plan_item_count: 5 },
  hyperparameters: [],
}

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

function packagesResponse() {
  return {
    slots: [
      { family: 'service_selector', approach: 'transparent', package_id: 'mock_service_selector_v1' },
      { family: 'content_selector', approach: 'transparent', package_id: REAL_CONTENT_PACKAGE_ID },
    ],
    packages: [REAL_CONTENT_PACKAGE, SERVICE_PACKAGE],
    errors: [],
  }
}

function baseRunLog(): Omit<ProposalRunLog, 'evidence' | 'status'> {
  return {
    run_id: 'prun_real',
    created_at: '2026-07-16T00:00:00Z',
    opportunity: {
      opportunity_id: 'op_1',
      trigger_purpose: 'rest_recommended',
      lifecycle_stage: 'before_rest_until_stop',
      allowed_service_ids: ['music_playlist'],
      simulation_time: '2026-07-16T00:00:00Z',
      run_seed: 'seed-1',
    },
    matrix_version: 'v1',
    world_snapshot: {},
    service_package_id: 'mock_service_selector_v1',
    content_package_id: REAL_CONTENT_PACKAGE_ID,
    parameters: {},
    hyperparameters: {},
    journey_state: {
      lifecycle_stage: 'before_rest_until_stop',
      motion_state: 'driving',
      active_service_id: 'music_playlist',
      active_plan_id: null,
    },
    events: [],
  }
}

function runLogWithRealCompletePlan(): ProposalRunLog {
  return {
    ...baseRunLog(),
    status: 'content_selected',
    evidence: [
      {
        step: 'content',
        package_id: REAL_CONTENT_PACKAGE_ID,
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
              item_id: 'synthetic-track-0186',
              item_fit: 0.63,
              trait_values: { arousal: 0.55, valence: 0.5 },
              feature_contributions: [
                {
                  feature_id: 'oshi_id',
                  e_i: 1.0,
                  a_i: 1.0,
                  alpha: null,
                  beta: null,
                  exact_match: true,
                  response_provenance: 'cdc_su_explicit',
                  r_i: 1.0,
                  base_weight: 0.063,
                  purpose_multiplier: 0.9,
                  mask: 1,
                  effective_weight: 0.0717,
                  contribution: 0.0717,
                  formula_version: '1.0.0',
                },
              ],
              rationale: ['推し一致が推薦に寄与（+0.072） / oshi match supports this pick (+0.072)'],
            },
            {
              position: 2,
              item_id: 'synthetic-track-0266',
              item_fit: 0.58,
              trait_values: null,
              feature_contributions: [],
              rationale: ['second track'],
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
          expected_duration_sec: 900,
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
  }
}

function runLogWithNoProposal(): ProposalRunLog {
  return {
    ...baseRunLog(),
    status: 'content_selected',
    evidence: [
      {
        step: 'content',
        package_id: REAL_CONTENT_PACKAGE_ID,
        contract_version: '1.0.0',
        schema_version: '1.0.0',
        matrix_version: 'v1',
        input_snapshot: {},
        output: {
          decision_type: 'no_proposal',
          selected_service_id: 'music_playlist',
          requested_item_count: 5,
          returned_item_count: 0,
          ordered_items: [],
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
          expected_duration_sec: 0,
          lighting_configuration: null,
          approval_policy: 'explicit_opt_in',
          completion_rule: 'plan_exhausted',
          next_transition_policy: 'await_user',
          excluded_items: [{ item_id: 'synthetic-track-0001', reason_codes: ['recent_skip'] }],
          unused_available_features: [],
          missing_features: [],
          algorithm_provenance: { error_reason: 'all_candidates_excluded' },
        },
        error: null,
        used_feature_ids: [],
        unused_available_features: [],
        missing_features: [],
      },
    ],
  }
}

describe('ContentProposalPanel — real transparent content selector (P3c)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(getPackages).mockResolvedValue(packagesResponse() as never)
  })

  it('renders the real CompletePlan (ordered items + per-item reasoning) the same way as the mock', async () => {
    function Setup() {
      const { dispatch } = useProposalStore()
      React.useEffect(() => {
        dispatch({ type: 'RUN_CREATED', runLog: runLogWithRealCompletePlan() })
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

    expect(await screen.findByText('synthetic-track-0186')).toBeInTheDocument()
    expect(screen.getByText('synthetic-track-0266')).toBeInTheDocument()
    expect(screen.getAllByTestId('reason-breakdown').length).toBe(2)
    expect(screen.getByText(/oshi match/i)).toBeInTheDocument()

    // Content package id shown in the setup readout is the REAL package.
    expect(screen.getByText(REAL_CONTENT_PACKAGE_ID)).toBeInTheDocument()
  })

  it('renders an explicit no_proposal message (never a blank panel, never a fabricated plan) when the real selector excludes every candidate', async () => {
    function Setup() {
      const { dispatch } = useProposalStore()
      React.useEffect(() => {
        dispatch({ type: 'RUN_CREATED', runLog: runLogWithNoProposal() })
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

    const message = await screen.findByTestId('content-no-plan')
    expect(message).toHaveTextContent(/no_proposal|no content proposal/i)
    expect(screen.queryByTestId('plan-metadata')).not.toBeInTheDocument()
  })

  it('the "MOCK DATA" marker is scoped to the service panel only — content is real', async () => {
    render(
      <ProposalStoreProvider>
        <ServiceProposalPanel />
        <ContentProposalPanel />
      </ProposalStoreProvider>,
    )
    await waitFor(() => expect(getPackages).toHaveBeenCalled())

    expect(screen.getByTestId('service-mock-badge')).toBeInTheDocument()
    const contentPanel = screen.getByTestId('content-panel')
    expect(contentPanel.querySelector('[data-testid="service-mock-badge"]')).toBeNull()
    expect(contentPanel.textContent).not.toMatch(/MOCK DATA/i)
  })
})
