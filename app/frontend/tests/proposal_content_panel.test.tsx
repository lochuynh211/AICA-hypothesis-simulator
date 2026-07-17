import { render, screen, waitFor, fireEvent } from '@testing-library/react'
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

import { getPackages, createRun, selectService } from '../src/api/proposalClient'

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

function packagesResponse() {
  return {
    slots: [
      { family: 'service_selector', approach: 'transparent', package_id: 'mock_service_selector_v1' },
      { family: 'content_selector', approach: 'transparent', package_id: 'mock_content_selector_v1' },
    ],
    packages: [CONTENT_PACKAGE, SERVICE_PACKAGE],
    errors: [],
  }
}

/** A service-selected run whose sole ranked candidate is `candidateId` — in
 * the after-rest allowed set. Defaults to `live_viewing`, which is NOT in
 * the mock content selector's `supported_services` (music-only); mirrors the
 * real backend fixture used by `app/api/tests/proposal/test_ep_select_service.py`.
 * Task 5 (Choose scope-gate) tests that need a Choose click to actually fire
 * (rather than be blocked client-side by the new gate) pass a content-backed
 * id instead (e.g. `full_karaoke`). */
function runLogServiceSelectedWithUnsupportedCandidate(candidateId = 'live_viewing'): ProposalRunLog {
  return {
    run_id: 'prun_unsupported_test',
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
      active_service_id: candidateId,
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
              candidate_id: candidateId,
              score: 0.77,
              rationale: ['一位の理由', 'Top rank rationale'],
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
    expect(screen.getByText('Content Category Weights')).toBeInTheDocument()
  })

  // ---------------------------------------------------------------------
  // FR-002a: editing content params/hyperparameters must actually update
  // the store (previously: <input defaultValue> + no onChange, and
  // HyperparamMatrix wired to a no-op onChange — edits were silently
  // discarded). Symmetric with ServiceProposalPanel's SET_SERVICE_PARAMETER
  // / SET_SERVICE_HYPERPARAMETER wiring.
  // ---------------------------------------------------------------------

  it('excludes the manifest "note" string from the editable parameter grid', async () => {
    const packagesWithNote = {
      ...packagesResponse(),
      packages: [{ ...CONTENT_PACKAGE, parameters: { plan_item_count: 5, note: 'ignored by evaluate()' } }, SERVICE_PACKAGE],
    }
    vi.mocked(getPackages).mockResolvedValue(packagesWithNote as never)

    render(
      <ProposalStoreProvider>
        <ContentProposalPanel />
      </ProposalStoreProvider>,
    )
    await screen.findByLabelText('plan_item_count')
    expect(screen.queryByLabelText('note')).not.toBeInTheDocument()
  })

  it('editing a content parameter dispatches SET_CONTENT_PARAMETER and updates the store override', async () => {
    function StoreSnapshot() {
      const { state } = useProposalStore()
      return <div data-testid="param-override-snapshot">{JSON.stringify(state.contentParameterOverrides)}</div>
    }
    render(
      <ProposalStoreProvider>
        <ContentProposalPanel />
        <StoreSnapshot />
      </ProposalStoreProvider>,
    )
    const input = await screen.findByLabelText('plan_item_count')
    fireEvent.change(input, { target: { value: '7' } })

    await waitFor(() =>
      expect(screen.getByTestId('param-override-snapshot')).toHaveTextContent('{"plan_item_count":7}'),
    )
  })

  it('editing a content hyperparameter dispatches SET_CONTENT_HYPERPARAMETER and updates the store override', async () => {
    function StoreSnapshot() {
      const { state } = useProposalStore()
      return <div data-testid="hp-override-snapshot">{JSON.stringify(state.contentHyperparameterOverrides)}</div>
    }
    render(
      <ProposalStoreProvider>
        <ContentProposalPanel />
        <StoreSnapshot />
      </ProposalStoreProvider>,
    )
    const situationInput = await screen.findByDisplayValue('0.55')
    fireEvent.change(situationInput, { target: { value: '0.7' } })

    await waitFor(() =>
      expect(screen.getByTestId('hp-override-snapshot')).toHaveTextContent(
        '{"content_category_weights":{"Situation":0.7,"Preference":0.3,"History":0.15}}',
      ),
    )
  })

  it('editing a content parameter is captured and sent as an override when Choose is clicked', async () => {
    // Task 5 (Choose scope-gate): this test is about parameter-override
    // capture, not unsupported-service handling — use a content-backed
    // candidate (`full_karaoke`) so the Choose button is actually enabled
    // and the click fires (the unsupported-service scenario is covered
    // separately below, without going through a disabled button).
    vi.mocked(createRun).mockResolvedValue(runLogServiceSelectedWithUnsupportedCandidate('full_karaoke') as never)
    vi.mocked(selectService).mockResolvedValue({ ...runLogWithPlan(), status: 'content_selected' } as never)

    render(
      <ProposalStoreProvider>
        <ServiceProposalPanel />
        <ContentProposalPanel />
      </ProposalStoreProvider>,
    )
    await waitFor(() => expect(getPackages).toHaveBeenCalled())
    fireEvent.click(screen.getByTestId('service-run-button'))
    await screen.findByText('full_karaoke')

    const input = await screen.findByLabelText('plan_item_count')
    fireEvent.change(input, { target: { value: '7' } })

    fireEvent.click(screen.getByTestId('choose-candidate-full_karaoke'))

    await waitFor(() => expect(selectService).toHaveBeenCalled())
    expect(selectService).toHaveBeenCalledWith('prun_unsupported_test', 'full_karaoke', {
      parameters: { plan_item_count: 7 },
      hyperparameters: { content_category_weights: { Situation: 0.55, Preference: 0.3, History: 0.15 } },
    })
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

  // ---------------------------------------------------------------------
  // Unsupported-service handling (edge case: "Content plan requested for an
  // unsupported service -> explicit unsupported outcome rather than an
  // empty plan"). The mock content selector is MUSIC-ONLY
  // (music_playlist/humming_karaoke/full_karaoke) -- choosing a non-music
  // candidate (e.g. post-rest live_viewing) makes the real
  // POST /select-service endpoint reject with 422 unsupported_service
  // BEFORE dispatch_selector ever runs (see routers/proposal.py's
  // supported_services pre-check) -- so `runLog`/`contentEvidence` never
  // change. ContentProposalPanel must still show an explicit message, not a
  // blank/broken panel.
  // ---------------------------------------------------------------------

  it('shows an explicit unsupported-service message (not a blank/broken plan) when the store records an unsupported_service select-service error', async () => {
    function Setup() {
      const { dispatch } = useProposalStore()
      React.useEffect(() => {
        dispatch({ type: 'RUN_CREATED', runLog: runLogServiceSelectedWithUnsupportedCandidate() })
        dispatch({
          type: 'SET_ERROR',
          message:
            "Proposal API error: 422 — Content package 'mock_content_selector_v1' does not support service 'live_viewing' (unsupported_service)",
        })
      }, [dispatch])
      return null
    }
    render(
      <ProposalStoreProvider initialLanguage="en">
        <Setup />
        <ContentProposalPanel />
      </ProposalStoreProvider>,
    )

    const message = await screen.findByTestId('content-select-error')
    expect(message).toHaveTextContent(/unsupported/i)
    // Never a broken/empty plan section rendered alongside it.
    expect(screen.queryByTestId('plan-metadata')).not.toBeInTheDocument()
  })

  it('does not show the unsupported-service message once a real content plan is present (error cleared by CONTENT_SELECTED)', async () => {
    function Setup() {
      const { dispatch } = useProposalStore()
      React.useEffect(() => {
        dispatch({ type: 'RUN_CREATED', runLog: runLogServiceSelectedWithUnsupportedCandidate() })
        dispatch({ type: 'SET_ERROR', message: 'unsupported_service: live_viewing' })
        dispatch({ type: 'CONTENT_SELECTED', runLog: runLogWithPlan() })
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
    expect(screen.queryByTestId('content-select-error')).not.toBeInTheDocument()
  })

  // Task 5 (Choose scope-gate): previously this scenario reached the backend
  // and relied on its 422 unsupported_service rejection being surfaced
  // gracefully (still covered above via direct SET_ERROR dispatch). Now the
  // Choose button itself is disabled for a non-content-backed candidate, so
  // selectService is never even called — the "never blank" guarantee is
  // enforced client-side, before any request goes out, and
  // ContentProposalPanel simply stays in its waiting state.
  it('end-to-end: an unsupported service in ServiceProposalPanel has Choose disabled, so selectService is never called and ContentProposalPanel stays in its waiting state', async () => {
    vi.mocked(createRun).mockResolvedValue(runLogServiceSelectedWithUnsupportedCandidate() as never)

    render(
      <ProposalStoreProvider initialLanguage="en">
        <ServiceProposalPanel />
        <ContentProposalPanel />
      </ProposalStoreProvider>,
    )
    await waitFor(() => expect(getPackages).toHaveBeenCalled())
    fireEvent.click(screen.getByTestId('service-run-button'))
    await screen.findByText('live_viewing')

    const chooseBtn = screen.getByTestId('choose-candidate-live_viewing')
    expect(chooseBtn).toBeDisabled()
    expect(screen.getByTestId('out-of-scope-live_viewing')).toBeInTheDocument()

    fireEvent.click(chooseBtn)

    expect(selectService).not.toHaveBeenCalled()
    expect(screen.queryByTestId('content-select-error')).not.toBeInTheDocument()
    expect(screen.queryByTestId('plan-metadata')).not.toBeInTheDocument()
  })
})
