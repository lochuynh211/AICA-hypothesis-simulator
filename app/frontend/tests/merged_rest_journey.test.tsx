/**
 * merged_rest_journey (Slice-2 core Task 4) — the Combined Simulator's
 * accept-rest UI: a RecoveryOption <select> + rest-spot <select> +
 * sleep-minutes numeric input + Accept-rest button, shown in
 * `MergedCenterPanel` once the before-rest proposal (`trigger_purpose:
 * 'rest_recommended'`, `journey_state.lifecycle_stage:
 * 'before_rest_until_stop'`) has had its service chosen. Clicking
 * Accept-rest calls `mergedClient.acceptRest` then resumes Play — the
 * EXISTING tick loop auto-drives the journey server-side (Task 3), so once
 * a later tick's `proposal` has advanced to `after_rest_before_restart` the
 * SAME (unmodified) service/content dock logic renders the after-rest
 * decision with no new frontend branching.
 *
 * Rendered inside a REAL `MergedCoordinatorProvider` (mirrors
 * `merged_center.test.tsx`): only the network boundary is mocked —
 * `api/mergedClient.ts` (create/tick/proposal-action/accept-rest) AND
 * `api/client.ts` (getScenario/getRestSpots, the SAME clients
 * `RecoveryPicker` reuses for the trigger-only screen).
 */
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MergedCoordinatorProvider, useMergedCoordinator } from '../src/state/mergedCoordinator'
import { LanguageProvider } from '../src/state/language'
import { RunStoreProvider } from '../src/state/runStore'
import { ProposalStoreProvider } from '../src/state/proposalStore'
import { ReviewStoreProvider } from '../src/state/reviewStore'
import type { MergedTickResponse } from '../src/api/mergedClient'
import type { DecisionResult, ScenarioDef, RestSpot } from '../src/api/types'
import type { ProposalRunLog, AlgorithmEvidence } from '../src/api/proposalClient'
import MergedCenterPanel from '../src/components/merged/MergedCenterPanel'

vi.mock('../src/api/mergedClient', () => ({
  createMergedRun: vi.fn(),
  tickMergedRun: vi.fn(),
  mergedProposalAction: vi.fn(),
  acceptRest: vi.fn(),
  declineRest: vi.fn(),
}))

vi.mock('../src/api/client', () => ({
  getScenario: vi.fn(),
  getRestSpots: vi.fn(),
}))

import { createMergedRun, tickMergedRun, mergedProposalAction, acceptRest, declineRest } from '../src/api/mergedClient'
import { getScenario, getRestSpots } from '../src/api/client'

// ── fixtures ─────────────────────────────────────────────────────────────

const fireControl = { fired: false, suppressed: false, override: false, reason: null }

const noTriggerDecision: DecisionResult = {
  result_type: 'NO_TRIGGER',
  trigger_candidate: false,
  selected_category: null,
  score: null,
  features: {},
  scores: {},
  states: {},
  criteria: {},
  candidates: [],
  fire_control: fireControl,
  proposal: null,
  reason_inputs: [],
  explanation: 'No trigger',
  next_package_runtime_state: {},
}

const restProposalDecision: DecisionResult = {
  ...noTriggerDecision,
  result_type: 'REST_PROPOSAL',
  trigger_candidate: true,
  selected_category: 'rest_required',
  score: 3.2,
  fire_control: { fired: true, suppressed: false, override: false, reason: null },
  proposal: { id: 'rest_guidance', message: { ja: '休憩', en: 'Rest' }, options: ['accept_rest', 'postpone'] },
  explanation: 'Rest recommended',
}

function serviceEvidence(candidateId: string): AlgorithmEvidence {
  return {
    step: 'service',
    package_id: 'mock_service_selector_v1',
    contract_version: '1.0.0',
    schema_version: '1.0.0',
    matrix_version: 'v1',
    input_snapshot: {
      eligible_candidates: [{ candidate_id: candidateId }],
      excluded_candidates: [],
    },
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
    },
    error: null,
    used_feature_ids: [],
    unused_available_features: [],
    missing_features: [],
  }
}

/** Before-rest content evidence — simulates the before-rest
 * choose-service-then-content dispatch that happened earlier in the SAME
 * append-only `evidence` list, prior to the after-rest recompute's fresh
 * `service` entry (slice-2 verification fix fixture). */
function contentEvidence(candidateId: string): AlgorithmEvidence {
  return {
    step: 'content',
    package_id: 'mock_content_selector_v1',
    contract_version: '1.0.0',
    schema_version: '1.0.0',
    matrix_version: 'v1',
    input_snapshot: {},
    output: {
      decision_type: 'complete_plan',
      selected_service_id: candidateId,
      requested_item_count: 1,
      returned_item_count: 1,
      ordered_items: [
        {
          position: 1,
          item_id: 'track-1',
          item_fit: 0.81,
          trait_values: null,
          feature_contributions: [],
          rationale: ['一曲目', 'first track'],
        },
      ],
      mode: {
        service_id: candidateId,
        mode_kind: 'playlist',
        chorus_only: null,
        guide_vocal: null,
        driving_lyrics: null,
        fixed_segment_sec: null,
        stopped_only: null,
        simulated_queue: null,
      },
      expected_duration_sec: 300,
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
  }
}

function baseProposalLog(overrides: Partial<ProposalRunLog> = {}): ProposalRunLog {
  return {
    run_id: 'prun_20260718-000000_abcdef',
    created_at: '2026-07-18T00:00:00Z',
    opportunity: {
      opportunity_id: 'op_1',
      trigger_purpose: 'rest_recommended',
      lifecycle_stage: 'before_rest_until_stop',
      allowed_service_ids: ['music_playlist'],
      simulation_time: 45,
      run_seed: '7',
    },
    matrix_version: 'v1',
    world_snapshot: {},
    service_package_id: 'mock_service_selector_v1',
    content_package_id: 'mock_content_selector_v1',
    parameters: {},
    hyperparameters: {},
    journey_state: {
      lifecycle_stage: 'before_rest_until_stop',
      motion_state: 'stopped',
      active_service_id: null,
      active_plan_id: null,
    },
    events: [],
    evidence: [],
    status: 'created',
    ...overrides,
  } as unknown as ProposalRunLog
}

function firedTickWithProposal(tickIndex: number): MergedTickResponse {
  return {
    trigger: {
      decision: restProposalDecision,
      error: null,
      paused: true,
      completed: false,
      tick_index: tickIndex,
      route_fraction: tickIndex / 100,
      distance_km: null,
      speed_kph: 0,
      motion_state: 'STOPPED',
      recovery_phase: null,
      is_traffic_jam: false,
      segment_type: 'highway',
    },
    proposal: baseProposalLog({ evidence: [serviceEvidence('music_playlist')] }),
    correlation: {
      trigger_tick_index: tickIndex,
      proposal_run_id: 'prun_20260718-000000_abcdef',
      proposal_event_ids: ['OPPORTUNITY_CREATED@45'],
    },
  }
}

/** A later tick where the journey has fully auto-driven through the rest
 * (Task 3's orchestrator) to the after-rest recompute. This is the REALISTIC
 * shape `recompute_proposal_run` actually produces (proposal.py
 * ~1687-1721, slice-2 verification finding): it unconditionally sets
 * `journey_state.active_service_id` to the fresh rank-1 candidate AND
 * appends a new step='service' evidence entry, WITHOUT dispatching content
 * — so `active_service_id` is non-null (rank-1, `stretch_video`) even though
 * the reviewer is still facing a fresh service decision (awaiting Choose),
 * not a content decision. The evidence list also carries the EARLIER
 * before-rest `content` entry (music_playlist), so the fix must key off
 * which step's evidence is MOST RECENT (service, here), not off
 * `active_service_id == null`. */
function afterRestTick(tickIndex: number): MergedTickResponse {
  return {
    trigger: {
      decision: noTriggerDecision,
      error: null,
      paused: true,
      completed: false,
      tick_index: tickIndex,
      route_fraction: tickIndex / 100,
      distance_km: null,
      speed_kph: 0,
      motion_state: 'STOPPED',
      recovery_phase: null,
      is_traffic_jam: false,
      segment_type: 'highway',
    },
    proposal: baseProposalLog({
      opportunity: {
        opportunity_id: 'op_2',
        trigger_purpose: 'rest_recommended',
        lifecycle_stage: 'after_rest_before_restart',
        allowed_service_ids: ['stretch_video'],
        simulation_time: 120,
        run_seed: '7',
      },
      journey_state: {
        lifecycle_stage: 'after_rest_before_restart',
        motion_state: 'stopped',
        active_service_id: 'stretch_video',
        active_plan_id: null,
      },
      evidence: [contentEvidence('music_playlist'), serviceEvidence('stretch_video')],
    }),
    correlation: {
      trigger_tick_index: tickIndex,
      proposal_run_id: 'prun_20260718-000000_abcdef',
      proposal_event_ids: ['RECOMPUTED@120'],
    },
  }
}

const scenarioFixture: ScenarioDef = {
  id: 'uc01_fatigue_recovery_v0_1',
  version: '0.1.0',
  type: 'uc01',
  persona: {},
  route_intent: {} as never,
  initial_state: {},
  event_presets: {} as never,
  total_duration_seconds: 3600,
  tick_seconds: 1,
  allowed_actions: ['accept_rest', 'postpone'],
  review_focus: 'fatigue',
  recovery_options: [
    { id: 'nap_karaoke', label: { ja: '仮眠', en: 'Nap + karaoke' }, postpone: false },
    { id: 'postpone', label: { ja: '延期', en: 'Postpone' }, postpone: true },
  ],
}

const restSpotFixture: RestSpot = {
  id: 'spot_1',
  label: { ja: '休憩所1', en: 'Rest Area 1' },
  route_fraction: 0.5,
  distance_km: 5,
  eta_min: 5,
  reachable: true,
}

function renderCenterPanel() {
  const coordinatorRef: { current: ReturnType<typeof useMergedCoordinator> | null } = { current: null }

  function Capture() {
    coordinatorRef.current = useMergedCoordinator()
    return null
  }

  // Owner layout: rest-accept is in the center; MergedCenterPanel renders
  // MergedProposalPanel itself now (task-17-brief, as a sibling of the
  // animated playback subtree) — no separate mount. Both still share the
  // coordinator; the center's <MapSurface/> needs a RunStoreProvider, and the
  // checkpoint rail/decision band it also renders need a ReviewStoreProvider.
  render(
    <LanguageProvider initialLanguage="en">
      <MergedCoordinatorProvider>
      <RunStoreProvider>
        <ProposalStoreProvider>
        <ReviewStoreProvider>
        <Capture />
        <MergedCenterPanel />
        </ReviewStoreProvider>
        </ProposalStoreProvider>
      </RunStoreProvider>
    </MergedCoordinatorProvider>
    </LanguageProvider>,
  )

  return coordinatorRef
}

describe('MergedCenterPanel — rest-accept UI + journey auto-drive', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('shows the on-map rest overlay once a service is chosen, and choosing a rest spot calls acceptRest with the DEFAULT recovery option + spot (no picker)', async () => {
    vi.mocked(createMergedRun).mockResolvedValue({ merged_run_id: 'mrun_1', trigger_run_id: 'run_1' })
    vi.mocked(tickMergedRun)
      .mockResolvedValueOnce(firedTickWithProposal(45))
      // acceptRest() resumes Play — the coordinator's tick loop calls
      // tickMergedRun again; this test doesn't assert on the result, just
      // needs a paused response so the loop halts instead of looping on an
      // undefined resolution.
      .mockResolvedValueOnce(afterRestTick(120))
    vi.mocked(mergedProposalAction).mockResolvedValue(
      baseProposalLog({
        status: 'content_selected',
        journey_state: {
          lifecycle_stage: 'before_rest_until_stop',
          motion_state: 'stopped',
          active_service_id: 'music_playlist',
          active_plan_id: 'plan_1',
        },
        evidence: [serviceEvidence('music_playlist')],
      }),
    )
    vi.mocked(getScenario).mockResolvedValue(scenarioFixture)
    vi.mocked(getRestSpots).mockResolvedValue({ rest_spots: [restSpotFixture] })
    vi.mocked(acceptRest).mockResolvedValue({} as never)

    const coordinatorRef = renderCenterPanel()

    await act(async () => {
      await coordinatorRef.current!.create(
        {
          trigger_plan_id: 'plan_1',
          world: {} as never,
          service_package_id: 'mock_service_selector_v1',
          content_package_id: 'mock_content_selector_v1',
          run_seed: '7',
        },
        'uc01_fatigue_recovery_v0_1',
      )
    })
    await act(async () => {
      await coordinatorRef.current!.step()
    })

    // Before a service is chosen, no on-map rest overlay yet.
    expect(screen.queryByTestId('rest-accept-panel')).not.toBeInTheDocument()

    await act(async () => {
      await coordinatorRef.current!.selectService('music_playlist')
    })

    // The on-map rest overlay appears; rest spots are fetched via the SAME
    // client RecoveryPicker uses, once the affordance becomes eligible.
    await waitFor(() => {
      expect(screen.getByTestId('rest-accept-panel')).toBeInTheDocument()
    })
    expect(getScenario).toHaveBeenCalledWith('uc01_fatigue_recovery_v0_1')
    // Fetched for the correct trigger run (now also threads mapsKey/ceiling/
    // spacing filters, whose exact values depend on the env — assert the runId).
    expect(vi.mocked(getRestSpots).mock.calls[0][0]).toBe('run_1')

    // A rest-spot option button (no recovery-option/nap picker — defaulted).
    await waitFor(() => {
      expect(screen.getByTestId('rest-spot-choice-spot_1')).toHaveTextContent('Rest Area 1')
    })

    await act(async () => {
      fireEvent.click(screen.getByTestId('rest-spot-choice-spot_1'))
    })

    // Accepts with the DEFAULT (first non-postpone) recovery option +
    // scenario-authored nap (nap_minutes: null) — no picker shown.
    expect(acceptRest).toHaveBeenCalledWith('mrun_1', {
      recovery_option_id: 'nap_karaoke',
      rest_spot: restSpotFixture,
      nap_minutes: null,
    })

    // Auto-selects the rank-1 content (service rank-1 was auto-selected at the
    // fire) and STAYS paused — no auto-resume (owner review: stop for inspection
    // until Continue). Only the single step() tick has fired.
    await waitFor(() =>
      expect(mergedProposalAction).toHaveBeenCalledWith('mrun_1', {
        kind: 'select_service',
        selected_service_id: 'music_playlist',
      }),
    )
    expect(tickMergedRun).toHaveBeenCalledTimes(1)
  })

  it('never accepts with a postpone-flagged recovery option (the default option chosen for a spot is the first NON-postpone one; postpone/decline is the Reject button)', async () => {
    vi.mocked(createMergedRun).mockResolvedValue({ merged_run_id: 'mrun_3', trigger_run_id: 'run_3' })
    vi.mocked(tickMergedRun).mockResolvedValueOnce(firedTickWithProposal(45))
    vi.mocked(mergedProposalAction).mockResolvedValue(
      baseProposalLog({
        status: 'content_selected',
        journey_state: {
          lifecycle_stage: 'before_rest_until_stop',
          motion_state: 'stopped',
          active_service_id: 'music_playlist',
          active_plan_id: 'plan_1',
        },
        evidence: [serviceEvidence('music_playlist')],
      }),
    )
    // scenarioFixture.recovery_options includes a `postpone: true` entry
    // (mirrors the real uc01_fatigue_recovery_v0_1.json scenario's
    // `{id:'postpone', postpone:true, stages:[]}`) — accept-rest ALWAYS
    // submits via run_manager.action(..., 'accept_rest', ...), which is only
    // valid for a real rest option; a postpone option must never appear in
    // this select.
    vi.mocked(getScenario).mockResolvedValue(scenarioFixture)
    vi.mocked(getRestSpots).mockResolvedValue({ rest_spots: [restSpotFixture] })
    vi.mocked(acceptRest).mockResolvedValue({} as never)
    vi.mocked(tickMergedRun).mockResolvedValue(afterRestTick(120))

    const coordinatorRef = renderCenterPanel()

    await act(async () => {
      await coordinatorRef.current!.create(
        {
          trigger_plan_id: 'plan_1',
          world: {} as never,
          service_package_id: 'mock_service_selector_v1',
          content_package_id: 'mock_content_selector_v1',
          run_seed: '7',
        },
        'uc01_fatigue_recovery_v0_1',
      )
    })
    await act(async () => {
      await coordinatorRef.current!.step()
    })
    await act(async () => {
      await coordinatorRef.current!.selectService('music_playlist')
    })

    await waitFor(() => {
      expect(screen.getByTestId('rest-spot-choice-spot_1')).toBeInTheDocument()
    })

    await act(async () => {
      fireEvent.click(screen.getByTestId('rest-spot-choice-spot_1'))
    })

    // The postpone-flagged option (scenarioFixture has one) is filtered out, so
    // the default option used for accept is the first NON-postpone one.
    expect(acceptRest).toHaveBeenCalledWith(
      'mrun_3',
      expect.objectContaining({ recovery_option_id: 'nap_karaoke' }),
    )
    expect(acceptRest).not.toHaveBeenCalledWith('mrun_3', expect.objectContaining({ recovery_option_id: 'postpone' }))
  })

  it('the on-map Reject button declines the rest and resumes ticking (no recovery started)', async () => {
    vi.mocked(createMergedRun).mockResolvedValue({ merged_run_id: 'mrun_rej', trigger_run_id: 'run_rej' })
    vi.mocked(tickMergedRun)
      .mockResolvedValueOnce(firedTickWithProposal(45))
      .mockResolvedValueOnce(afterRestTick(120))
    vi.mocked(mergedProposalAction).mockResolvedValue(
      baseProposalLog({
        status: 'content_selected',
        journey_state: {
          lifecycle_stage: 'before_rest_until_stop',
          motion_state: 'stopped',
          active_service_id: 'music_playlist',
          active_plan_id: 'plan_1',
        },
        evidence: [serviceEvidence('music_playlist')],
      }),
    )
    vi.mocked(getScenario).mockResolvedValue(scenarioFixture)
    vi.mocked(getRestSpots).mockResolvedValue({ rest_spots: [restSpotFixture] })
    vi.mocked(declineRest).mockResolvedValue({} as never)

    const coordinatorRef = renderCenterPanel()

    await act(async () => {
      await coordinatorRef.current!.create(
        {
          trigger_plan_id: 'plan_1',
          world: {} as never,
          service_package_id: 'mock_service_selector_v1',
          content_package_id: 'mock_content_selector_v1',
          run_seed: '7',
        },
        'uc01_fatigue_recovery_v0_1',
      )
    })
    await act(async () => {
      await coordinatorRef.current!.step()
    })
    await act(async () => {
      await coordinatorRef.current!.selectService('music_playlist')
    })
    await waitFor(() => {
      expect(screen.getByTestId('rest-reject-button')).toBeInTheDocument()
    })

    await act(async () => {
      fireEvent.click(screen.getByTestId('rest-reject-button'))
    })

    // Reject calls the decline endpoint and resumes the tick loop (no acceptRest).
    expect(declineRest).toHaveBeenCalledWith('mrun_rej')
    expect(acceptRest).not.toHaveBeenCalled()
    await waitFor(() => expect(tickMergedRun).toHaveBeenCalledTimes(2))
    // The overlay is gone (the declined proposal was cleared).
    expect(screen.queryByTestId('rest-accept-panel')).not.toBeInTheDocument()
  })

  it('renders the after-rest service overlay once the journey advances to after_rest_before_restart, with no new dock logic', async () => {
    vi.mocked(createMergedRun).mockResolvedValue({ merged_run_id: 'mrun_2', trigger_run_id: 'run_2' })
    vi.mocked(tickMergedRun)
      .mockResolvedValueOnce(firedTickWithProposal(45))
      .mockResolvedValueOnce(afterRestTick(120))
    vi.mocked(mergedProposalAction).mockResolvedValue(
      baseProposalLog({
        status: 'content_selected',
        journey_state: {
          lifecycle_stage: 'before_rest_until_stop',
          motion_state: 'stopped',
          active_service_id: 'music_playlist',
          active_plan_id: 'plan_1',
        },
        evidence: [serviceEvidence('music_playlist')],
      }),
    )
    vi.mocked(getScenario).mockResolvedValue(scenarioFixture)
    vi.mocked(getRestSpots).mockResolvedValue({ rest_spots: [restSpotFixture] })
    vi.mocked(acceptRest).mockResolvedValue({} as never)

    const coordinatorRef = renderCenterPanel()

    await act(async () => {
      await coordinatorRef.current!.create(
        {
          trigger_plan_id: 'plan_1',
          world: {} as never,
          service_package_id: 'mock_service_selector_v1',
          content_package_id: 'mock_content_selector_v1',
          run_seed: '7',
        },
        'uc01_fatigue_recovery_v0_1',
      )
    })
    await act(async () => {
      await coordinatorRef.current!.step()
    })
    await act(async () => {
      await coordinatorRef.current!.selectService('music_playlist')
    })
    await waitFor(() => {
      expect(screen.getByTestId('rest-spot-choice-spot_1')).toHaveTextContent('Rest Area 1')
    })

    // Choose the rest spot — accepts + auto-selects content, then STAYS paused
    // (owner review). The overlay hides once the decision is made.
    await act(async () => {
      fireEvent.click(screen.getByTestId('rest-spot-choice-spot_1'))
    })
    await waitFor(() => {
      expect(screen.queryByTestId('rest-accept-panel')).not.toBeInTheDocument()
    })
    expect(tickMergedRun).toHaveBeenCalledTimes(1) // paused after accept, not auto-resumed

    // Press Continue (the Play button resumes) — NOW the tick loop auto-drives
    // the rest journey until the mocked after-rest tick reports paused again.
    await act(async () => {
      fireEvent.click(screen.getByTestId('merged-play-button'))
      await Promise.resolve()
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(tickMergedRun).toHaveBeenCalledTimes(2)
    })
    // …and the SAME (unmodified) dock logic renders the fresh after-rest
    // service decision, keyed purely off proposalLog.evidence/journey_state.
    await waitFor(() => {
      expect(screen.getByTestId('service-result-overlay')).toBeInTheDocument()
    })
    expect(screen.getByTestId('candidate-card-stretch_video')).toBeInTheDocument()
  })
})
