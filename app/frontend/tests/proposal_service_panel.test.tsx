import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
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
import type { RankedCandidate, ServiceSelectorOutput } from '../src/api/proposalClient'

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

// P5 Unit C (T018) — the REAL transparent service-selector package
// (`aica_transparent_service_selector_v1`), the slot's default occupant per
// ProposalPackageRegistry.list_slots() (Unit A, alphabetical first-wins:
// "aica_..." sorts before "mock_..." in the package-dir scan order that
// ALSO orders GET /api/proposal/packages' `packages` list).
const TRANSPARENT_SERVICE_PACKAGE = {
  id: 'aica_transparent_service_selector_v1',
  version: '1.0.0',
  label: { ja: '透明サービス選定 v1.0', en: 'Transparent Service Selector v1.0' },
  family: 'service_selector' as const,
  approach: 'transparent' as const,
  contract_version: '1.0.0',
  supported_services: [],
  parameters: {},
  hyperparameters: [],
}

function packagesResponseWithTransparentDefault() {
  return {
    slots: [
      { family: 'service_selector', approach: 'transparent', package_id: 'aica_transparent_service_selector_v1' },
      { family: 'service_selector', approach: 'constrained_llm', package_id: null },
      { family: 'content_selector', approach: 'transparent', package_id: 'mock_content_selector_v1' },
      { family: 'content_selector', approach: 'constrained_llm', package_id: null },
    ],
    // Order mirrors the registry's alphabetical package-dir scan: the
    // transparent package sorts before the mock, exactly like the real
    // backend returns them (verified against a live GET /api/proposal/packages
    // during Unit C).
    packages: [TRANSPARENT_SERVICE_PACKAGE, SERVICE_PACKAGE, CONTENT_PACKAGE],
    errors: [],
  }
}

function runLogWithCandidates(inputSnapshot: Record<string, unknown> = {}) {
  // Explicitly typed (rather than left as an inferred object literal) so
  // that the P5 §14 optional fields (dominance/situation_fit/
  // strongest_support/...) are recognized on later mutation in tests below
  // -- see whole-branch review finding: an untyped literal here made those
  // mutations fail `tsc --noEmit` even though they're valid at runtime.
  const ranked_candidates: RankedCandidate[] = [
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
  ]
  const output: ServiceSelectorOutput = {
    decision_type: 'ranked_candidates',
    ranked_candidates,
    excluded_candidates: [],
    unused_available_features: [],
    missing_features: [],
    next_package_runtime_state: {},
    algorithm_provenance: {},
  }
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
        input_snapshot: inputSnapshot,
        output,
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
    expect(screen.getByText('Category Weights')).toBeInTheDocument()
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

  // P4 (US5, FR-022): eligible/excluded lists from the STEP-1 input_snapshot.
  it('renders the eligible list and the excluded list with reason codes, and no score on exclusions', async () => {
    vi.mocked(createRun).mockResolvedValue(
      runLogWithCandidates({
        eligible_candidates: [{ candidate_id: 'live_viewing' }, { candidate_id: 'stretch_video' }],
        excluded_candidates: [
          { candidate_id: 'full_karaoke', platform_reason: 'full_karaoke_requires_stopped' },
          { candidate_id: 'oshi_reexperience', platform_reason: 'missing_required_entity' },
        ],
      }) as never,
    )
    render(
      <ProposalStoreProvider>
        <ServiceProposalPanel />
      </ProposalStoreProvider>,
    )
    await screen.findByText('mock_service_selector_v1')
    fireEvent.click(screen.getByTestId('service-run-button'))
    await waitFor(() => expect(createRun).toHaveBeenCalled())

    const eligibleList = await screen.findByTestId('eligible-list')
    expect(eligibleList).toHaveTextContent('live_viewing')
    expect(eligibleList).toHaveTextContent('stretch_video')

    const excludedList = screen.getByTestId('excluded-list')
    expect(excludedList).toHaveTextContent('full_karaoke')
    expect(excludedList).toHaveTextContent('full_karaoke_requires_stopped')
    expect(excludedList).toHaveTextContent('oshi_reexperience')
    expect(excludedList).toHaveTextContent('missing_required_entity')
    // No score anywhere in the excluded rows (contract invariant).
    expect(excludedList.textContent).not.toMatch(/score|\+\d|0\.\d/)
  })

  it('renders a "none excluded" message when excluded_candidates is empty', async () => {
    vi.mocked(createRun).mockResolvedValue(
      runLogWithCandidates({
        eligible_candidates: [{ candidate_id: 'live_viewing' }, { candidate_id: 'stretch_video' }],
        excluded_candidates: [],
      }) as never,
    )
    render(
      <ProposalStoreProvider>
        <ServiceProposalPanel />
      </ProposalStoreProvider>,
    )
    await screen.findByText('mock_service_selector_v1')
    fireEvent.click(screen.getByTestId('service-run-button'))
    await waitFor(() => expect(createRun).toHaveBeenCalled())

    await screen.findByTestId('eligible-list')
    expect(screen.queryByTestId('excluded-list')).not.toBeInTheDocument()
  })

  // P5 Unit A (T008, contracts/service_output_extension.md): the optional
  // §14 explainability fields are additive — a "real-shaped" output (every
  // new field populated) must type-check and render without crashing, using
  // the SAME lean fallback rendering the mock-shaped output above already
  // exercises (Panel ③'s enriched explainability rendering is a later P5
  // unit, T024 — this only proves the new fields are safe to receive).
  it('renders a real-shaped candidate (all P5 §14 optional fields populated) without crashing', async () => {
    const realShapedRunLog = runLogWithCandidates()
    const [firstCandidate] = realShapedRunLog.evidence[0].output.ranked_candidates
    firstCandidate.feature_contributions = [
      {
        feature_id: 'drowsiness_level',
        feature_value: 80,
        response_coefficient: 1.0,
        weight: 0.254551,
        contribution: 0.203641,
        source_reference: 'Slide 67 driver row',
        raw_value: 80,
        normalization_function: '(x/100)^gamma',
        normalized_evidence: 0.8,
        response_provenance: 'cdc_su_explicit',
        normalized_feature_response: 0.8,
        hierarchy_path: 'Situation/Driver state/drowsiness',
        base_weight: 0.22,
        purpose_multiplier: 1.5,
        effective_weight: 0.254551,
        status: 'used',
      },
    ]
    firstCandidate.situation_fit = 0.6
    firstCandidate.preference_fit = 0.1
    firstCandidate.history_fit = 0.072349
    firstCandidate.strongest_support = { feature_id: 'drowsiness_level', contribution: 0.203641 }
    firstCandidate.strongest_oppose = null
    firstCandidate.dominance = {
      status: 'default_dominance_preserved',
      w_d: 0.85,
      w_l: 0.15,
      required_gap: 0.35,
      material_safety_gap: 1.0,
      safety_share: 0.85,
      safety_share_warning: false,
    }
    realShapedRunLog.evidence[0].output.dominance = firstCandidate.dominance
    realShapedRunLog.evidence[0].output.effective_weights = { drowsiness_level: 0.254551 }
    realShapedRunLog.evidence[0].output.resolved_config_versions = {
      parameter_set_version: '1.0.0',
      formula_version: '1.0.0',
    }

    vi.mocked(createRun).mockResolvedValue(realShapedRunLog as never)
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

  // P5 Unit D (T025) — the ENRICHED explainability rendering (ServiceExplainability,
  // wired into Panel ③ at T024): a fully §14-populated candidate (all 17
  // feature_contributions rows + subtotals + dominance) must render all of
  // it, visible in the DOM (the per-feature table lives inside a <details>,
  // which testing-library queries reach whether open or collapsed).
  const FEATURE_IDS = [
    'drowsiness_level', 'fatigue_level', 'traffic_state', 'road_type', 'night_state',
    'monotony_level', 'route_tags', 'destination_tags', 'child_present', 'multiple_passengers',
    'oshi_registered', 'oshi_mode', 'service_recency_state', 'service_usage_level',
    'scene_service_usage_level', 'service_proposal_acceptance_rate', 'service_recovery_rate',
  ]

  function fullFeatureContributions() {
    return FEATURE_IDS.map((feature_id, idx) => ({
      feature_id,
      feature_value: idx % 3 === 0 ? 'highway' : 50 + idx,
      response_coefficient: idx % 4 === 0 ? -1.0 : 1.0,
      weight: 0.02 + idx * 0.01,
      contribution: idx % 4 === 0 ? -0.05 : 0.05 + idx * 0.001,
      source_reference: idx % 2 === 0 ? 'Slide 67 driver row' : null,
      raw_value: idx % 3 === 0 ? 'highway' : 50 + idx,
      normalization_function: '(x/100)^gamma',
      normalized_evidence: 0.5,
      response_provenance: idx < 12 ? 'cdc_su_explicit' : 'cdc_su_direct_candidate_feature',
      normalized_feature_response: idx % 4 === 0 ? -0.5 : 0.5,
      hierarchy_path: `Situation/Driver state/${feature_id}`,
      base_weight: 0.02 + idx * 0.01,
      purpose_multiplier: 1.2,
      effective_weight: 0.02 + idx * 0.01,
      status: 'used',
    }))
  }

  it('renders a real-shaped candidate with all 17 feature rows, subtotals, and the dominance readout visible (T025)', async () => {
    const realShapedRunLog = runLogWithCandidates()
    const [firstCandidate] = realShapedRunLog.evidence[0].output.ranked_candidates
    firstCandidate.feature_contributions = fullFeatureContributions()
    firstCandidate.situation_fit = 0.5
    firstCandidate.preference_fit = 0.15
    firstCandidate.history_fit = 0.072349
    firstCandidate.strongest_support = { feature_id: 'drowsiness_level', contribution: 0.2 }
    firstCandidate.strongest_oppose = { feature_id: 'oshi_mode', contribution: -0.05 }
    firstCandidate.dominance = {
      status: 'default_dominance_preserved',
      w_d: 0.823048,
      w_l: 0.176952,
      required_gap: 0.429991,
      material_safety_gap: 1.0,
      safety_share: 0.823048,
      safety_share_warning: false,
    }
    realShapedRunLog.evidence[0].output.dominance = firstCandidate.dominance
    realShapedRunLog.evidence[0].output.effective_weights = { drowsiness_level: 0.254551 }
    realShapedRunLog.evidence[0].output.resolved_config_versions = { contract_version: '1.0.0' }

    vi.mocked(createRun).mockResolvedValue(realShapedRunLog as never)
    render(
      <ProposalStoreProvider>
        <ServiceProposalPanel />
      </ProposalStoreProvider>,
    )
    await screen.findByText('mock_service_selector_v1')
    fireEvent.click(screen.getByTestId('service-run-button'))
    await waitFor(() => expect(createRun).toHaveBeenCalled())

    const explain = await screen.findByTestId('service-explainability')
    expect(explain).toBeInTheDocument()

    // Subtotals + strongest support/oppose visible.
    expect(screen.getByTestId('service-subtotals')).toBeInTheDocument()
    // situation subtotal (situation_fit = 0.5) renders with 3 decimals ("0.500"), not "0.5".
    expect(screen.getByTestId('service-subtotals').textContent).toContain('0.500')
    expect(screen.getByTestId('strongest-support')).toHaveTextContent('drowsiness_level')
    expect(screen.getByTestId('strongest-oppose')).toHaveTextContent('oshi_mode')

    // Dominance readout visible: status + safety_share %.
    const dominance = screen.getByTestId('service-dominance')
    expect(dominance).toBeInTheDocument()
    expect(screen.getByTestId('dominance-status')).toBeInTheDocument()
    expect(screen.getByTestId('safety-share')).toHaveTextContent('82.3%')

    // All 17 feature rows present once expanded past the top-5 collapse.
    fireEvent.click(within(explain).getByTestId('trace-show-more'))
    for (const featureId of FEATURE_IDS) {
      expect(screen.getByTestId(`explain-row-${featureId}`)).toBeInTheDocument()
    }
  })

  it('feature trace: top-5 by |contribution|, expandable, no provenance/status columns', async () => {
    const realShapedRunLog = runLogWithCandidates()
    const [firstCandidate] = realShapedRunLog.evidence[0].output.ranked_candidates
    firstCandidate.feature_contributions = fullFeatureContributions()
    firstCandidate.situation_fit = 0.5
    firstCandidate.preference_fit = 0.15
    firstCandidate.history_fit = 0.072349
    firstCandidate.strongest_support = { feature_id: 'drowsiness_level', contribution: 0.2 }
    firstCandidate.strongest_oppose = { feature_id: 'oshi_mode', contribution: -0.05 }
    firstCandidate.dominance = {
      status: 'default_dominance_preserved',
      w_d: 0.823048,
      w_l: 0.176952,
      required_gap: 0.429991,
      material_safety_gap: 1.0,
      safety_share: 0.823048,
      safety_share_warning: false,
    }
    realShapedRunLog.evidence[0].output.dominance = firstCandidate.dominance
    realShapedRunLog.evidence[0].output.effective_weights = { drowsiness_level: 0.254551 }
    realShapedRunLog.evidence[0].output.resolved_config_versions = { contract_version: '1.0.0' }

    vi.mocked(createRun).mockResolvedValue(realShapedRunLog as never)
    render(
      <ProposalStoreProvider>
        <ServiceProposalPanel />
      </ProposalStoreProvider>,
    )
    await screen.findByText('mock_service_selector_v1')
    fireEvent.click(screen.getByTestId('service-run-button'))
    await waitFor(() => expect(createRun).toHaveBeenCalled())

    const table = await screen.findByTestId('service-explainability-table')
    // Provenance/Status headers are gone
    expect(within(table).queryByText('Provenance')).toBeNull()
    expect(within(table).queryByText('Status')).toBeNull()
    // Only 5 data rows visible before expanding
    const openTrace = within(table).getByTestId('trace-show-more')
    const bodyBefore = within(table).getAllByTestId(/^explain-row-/)
    expect(bodyBefore.length).toBe(5)
    fireEvent.click(openTrace)
    expect(within(table).getAllByTestId(/^explain-row-/).length).toBe(17)
  })

  it('renders the lean fallback for a mock-shaped candidate — no explainability section, no crash', async () => {
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
    // The mock output carries none of the P5 §14 optional fields — the
    // enrichment renders nothing at all (no empty section headers).
    expect(screen.queryByTestId('service-explainability')).not.toBeInTheDocument()
    expect(screen.queryByTestId('service-subtotals')).not.toBeInTheDocument()
    expect(screen.queryByTestId('service-dominance')).not.toBeInTheDocument()
  })

  // T025a (FR-023) frontend guard: no dominance/score label anywhere in the
  // rendered Panel ③ output uses forbidden probability/certification
  // phrasing, for either the lean (mock) OR enriched (real) render path.
  it('never renders forbidden probability/certification phrasing (FR-023 guard)', async () => {
    const realShapedRunLog = runLogWithCandidates()
    const [firstCandidate] = realShapedRunLog.evidence[0].output.ranked_candidates
    firstCandidate.feature_contributions = fullFeatureContributions()
    firstCandidate.situation_fit = 0.5
    firstCandidate.preference_fit = 0.15
    firstCandidate.history_fit = 0.072349
    firstCandidate.strongest_support = { feature_id: 'drowsiness_level', contribution: 0.2 }
    firstCandidate.strongest_oppose = null
    firstCandidate.dominance = {
      status: 'dominance_not_guaranteed',
      w_d: 0.5,
      w_l: 0.5,
      required_gap: 2.0,
      material_safety_gap: 1.0,
      safety_share: 0.5,
      safety_share_warning: true,
    }
    realShapedRunLog.evidence[0].output.dominance = firstCandidate.dominance

    vi.mocked(createRun).mockResolvedValue(realShapedRunLog as never)
    render(
      <ProposalStoreProvider>
        <ServiceProposalPanel />
      </ProposalStoreProvider>,
    )
    await screen.findByText('mock_service_selector_v1')
    fireEvent.click(screen.getByTestId('service-run-button'))
    await waitFor(() => expect(createRun).toHaveBeenCalled())
    await screen.findByTestId('service-dominance')

    const bodyText = document.body.textContent ?? ''
    expect(bodyText.toLowerCase()).not.toMatch(/probability|certified|certification/)
    expect(bodyText).not.toMatch(/確率|安全保証/)
  })

  it('renders the JourneyActionBar and EventTimeline once a run exists', async () => {
    vi.mocked(createRun).mockResolvedValue(runLogWithCandidates() as never)
    render(
      <ProposalStoreProvider>
        <ServiceProposalPanel />
      </ProposalStoreProvider>,
    )
    await screen.findByText('mock_service_selector_v1')
    expect(screen.queryByTestId('journey-action-bar')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('service-run-button'))
    await waitFor(() => expect(createRun).toHaveBeenCalled())

    expect(await screen.findByTestId('journey-action-bar')).toBeInTheDocument()
    expect(screen.getByTestId('event-timeline')).toBeInTheDocument()
  })
})

// P5 Unit C (T018, FR-001): the transparent service-selector package MUST be
// the screen's default service-slot selection, with the mock retained as a
// selectable regression fixture. The panel derives its default purely from
// GET /api/proposal/packages' `packages` list order (`services[0].id`) —
// this suite pins that the real backend order (verified live during Unit C:
// GET /api/proposal/packages returns the transparent package first) actually
// produces the transparent default in the UI, and that switching back to the
// mock still works.
describe('ServiceProposalPanel — P5 US1 default service package (T018)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(getPackages).mockResolvedValue(packagesResponseWithTransparentDefault() as never)
  })

  it('defaults the service-package selector to the transparent package (the slot default) while the mock remains selectable', async () => {
    render(
      <ProposalStoreProvider>
        <ServiceProposalPanel />
      </ProposalStoreProvider>,
    )

    const select = (await screen.findByLabelText('Service pkg')) as HTMLSelectElement
    await waitFor(() => expect(select.value).toBe('aica_transparent_service_selector_v1'))

    const optionValues = Array.from(select.options).map((o) => o.value)
    expect(optionValues).toEqual(
      expect.arrayContaining(['aica_transparent_service_selector_v1', 'mock_service_selector_v1']),
    )

    // The mock is still selectable (FR-001's "retaining the existing mock
    // as a selectable regression fixture").
    fireEvent.change(select, { target: { value: 'mock_service_selector_v1' } })
    expect(select.value).toBe('mock_service_selector_v1')
  })

  it('sends the default transparent package id in the createRun body when Run is clicked without changing the selector', async () => {
    vi.mocked(createRun).mockResolvedValue(runLogWithCandidates() as never)
    render(
      <ProposalStoreProvider>
        <ServiceProposalPanel />
      </ProposalStoreProvider>,
    )
    await waitFor(() =>
      expect((screen.getByLabelText('Service pkg') as HTMLSelectElement).value).toBe(
        'aica_transparent_service_selector_v1',
      ),
    )

    fireEvent.click(screen.getByTestId('service-run-button'))
    await waitFor(() => expect(createRun).toHaveBeenCalled())

    const body = vi.mocked(createRun).mock.calls[0][0]
    expect(body.service_package_id).toBe('aica_transparent_service_selector_v1')
  })
})

// P5 Unit F (T032, US4, FR-019/FR-020) — the confidence_shrinkage_v1 opt-in
// hyperparameter is NOT special-cased by ServiceProposalPanel: it is just
// another entry in the transparent package's manifest `hyperparameters`
// list, rendered generically by HyperparamMatrix (Panel ③'s
// "Hyperparameters (advanced)" disclosure) exactly like every other
// hyperparameter. This confirms that generic path actually carries the
// toggle's on/off state into the run request and that it is visible once a
// run exists (evidence.hyperparameters, persisted verbatim by createRun's
// mock response below).
const TRANSPARENT_SERVICE_PACKAGE_WITH_CONFIDENCE_SHRINKAGE = {
  ...TRANSPARENT_SERVICE_PACKAGE,
  hyperparameters: [
    {
      key: 'confidence_shrinkage_v1',
      kind: 'enum' as const,
      label: { ja: '信頼度縮小（拡張・既定オフ）', en: 'Confidence Shrinkage (extension, default off)' },
      default: false,
      values: [false, true],
    },
  ],
}

function packagesResponseWithConfidenceShrinkageHyperparameter() {
  return {
    slots: [
      { family: 'service_selector', approach: 'transparent', package_id: 'aica_transparent_service_selector_v1' },
      { family: 'service_selector', approach: 'constrained_llm', package_id: null },
      { family: 'content_selector', approach: 'transparent', package_id: 'mock_content_selector_v1' },
      { family: 'content_selector', approach: 'constrained_llm', package_id: null },
    ],
    packages: [TRANSPARENT_SERVICE_PACKAGE_WITH_CONFIDENCE_SHRINKAGE, SERVICE_PACKAGE, CONTENT_PACKAGE],
    errors: [],
  }
}

describe('ServiceProposalPanel — P5 US4 confidence_shrinkage_v1 toggle (T032)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(getPackages).mockResolvedValue(packagesResponseWithConfidenceShrinkageHyperparameter() as never)
  })

  it('defaults confidence_shrinkage_v1 to false in the run request when left untouched', async () => {
    vi.mocked(createRun).mockResolvedValue(runLogWithCandidates() as never)
    render(
      <ProposalStoreProvider>
        <ServiceProposalPanel />
      </ProposalStoreProvider>,
    )
    await screen.findByText('aica_transparent_service_selector_v1')

    fireEvent.click(screen.getByTestId('service-run-button'))
    await waitFor(() => expect(createRun).toHaveBeenCalled())

    const body = vi.mocked(createRun).mock.calls[0][0]
    // Non-null: the component always sends `hyperparameters` on run creation
    // (it's optional only in the wire type `CreateProposalRunBody`).
    expect(body.hyperparameters!.confidence_shrinkage_v1).toBe(false)
  })

  it('toggling the Hyperparameters (advanced) control flips confidence_shrinkage_v1 to true in the run request', async () => {
    vi.mocked(createRun).mockResolvedValue(runLogWithCandidates() as never)
    render(
      <ProposalStoreProvider>
        <ServiceProposalPanel />
      </ProposalStoreProvider>,
    )
    await screen.findByText('aica_transparent_service_selector_v1')

    // Open the collapsible disclosure and flip the toggle.
    // ProposalStoreProvider defaults uiLanguage to 'en' -- HyperparamMatrix
    // renders the manifest's English label by default (project convention).
    const select = (await screen.findByLabelText('Confidence Shrinkage (extension, default off)')) as HTMLSelectElement
    expect(select.value).toBe('false')
    fireEvent.change(select, { target: { value: 'true' } })
    expect(select.value).toBe('true')

    fireEvent.click(screen.getByTestId('service-run-button'))
    await waitFor(() => expect(createRun).toHaveBeenCalled())

    const body = vi.mocked(createRun).mock.calls[0][0]
    // A real (not stringified) boolean -- see the HyperparamMatrix fix.
    expect(body.hyperparameters!.confidence_shrinkage_v1).toBe(true)
    expect(body.hyperparameters!.confidence_shrinkage_v1).not.toBe('true')
  })

  it("the toggled state is visible in the run's evidence hyperparameters once a run exists", async () => {
    vi.mocked(createRun).mockImplementation(async (body) => ({
      ...runLogWithCandidates(),
      hyperparameters: body.hyperparameters,
    }) as never)
    render(
      <ProposalStoreProvider>
        <ServiceProposalPanel />
      </ProposalStoreProvider>,
    )
    await screen.findByText('aica_transparent_service_selector_v1')

    // ProposalStoreProvider defaults uiLanguage to 'en' -- HyperparamMatrix
    // renders the manifest's English label by default (project convention).
    const select = (await screen.findByLabelText('Confidence Shrinkage (extension, default off)')) as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'true' } })

    fireEvent.click(screen.getByTestId('service-run-button'))
    await waitFor(() => expect(createRun).toHaveBeenCalled())

    const runLog = await vi.mocked(createRun).mock.results[0].value
    expect(runLog.hyperparameters.confidence_shrinkage_v1).toBe(true)
  })
})
