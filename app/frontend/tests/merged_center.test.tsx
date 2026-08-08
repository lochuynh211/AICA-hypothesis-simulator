/**
 * MergedCenterPanel (020 Task 9) — the Combined Simulator's center column:
 * Play/Pause/Step bar + a trigger-trace-fed `ScoreTimeline` + a
 * `position:relative` dock that docks `ServiceResultOverlay`/
 * `ContentResultOverlay` (Task 10) straight off `state.proposalLog`, mirroring
 * `CenterPlaybackPanel`'s dock (lines 87-114).
 *
 * Rendered inside a REAL `MergedCoordinatorProvider` (the same pattern
 * `merged_coordinator.test.tsx`/`merged_setup.test.tsx` use): only the
 * network boundary (`api/mergedClient.ts`) is mocked, so `state.proposalLog`/
 * `state.triggerTrace` are populated via the coordinator's real
 * create()/step()/selectService() — never a stand-in spy.
 */
import { render, screen, fireEvent, act, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MergedCoordinatorProvider, useMergedCoordinator } from '../src/state/mergedCoordinator'
import { LanguageProvider } from '../src/state/language'
import { RunStoreProvider } from '../src/state/runStore'
import { ProposalStoreProvider } from '../src/state/proposalStore'
import { ReviewStoreProvider, useReviewStore } from '../src/state/reviewStore'
import type { MergedTickResponse } from '../src/api/mergedClient'
import type { DecisionResult } from '../src/api/types'
import type { ProposalRunLog, AlgorithmEvidence } from '../src/api/proposalClient'
import MergedCenterPanel from '../src/components/merged/MergedCenterPanel'

vi.mock('../src/api/mergedClient', () => ({
  createMergedRun: vi.fn(),
  tickMergedRun: vi.fn(),
  mergedProposalAction: vi.fn(),
  declineRest: vi.fn(),
  // fixbug-0806: the guided overlay's content/service-step Reject now posts
  // here (proposal-side reject), not to declineRest (a trigger-side rest
  // decline) — see reject_proposal_endpoint's docstring for why the two
  // differ. declineRest is EXERCISED ONLY by the rest chooser's own Reject
  // (unchanged) — kept mocked above for that.
  rejectProposal: vi.fn(),
}))

import { createMergedRun, tickMergedRun, mergedProposalAction, declineRest, rejectProposal } from '../src/api/mergedClient'

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

function serviceEvidence(): AlgorithmEvidence {
  return {
    step: 'service',
    package_id: 'mock_service_selector_v1',
    contract_version: '1.0.0',
    schema_version: '1.0.0',
    matrix_version: 'v1',
    input_snapshot: {
      eligible_candidates: [{ candidate_id: 'music_playlist' }],
      excluded_candidates: [],
    },
    output: {
      decision_type: 'ranked_candidates',
      ranked_candidates: [
        {
          rank: 1,
          candidate_id: 'music_playlist',
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

function serviceEvidenceWithError(): AlgorithmEvidence {
  return {
    step: 'service',
    package_id: 'mock_service_selector_v1',
    contract_version: '1.0.0',
    schema_version: '1.0.0',
    matrix_version: 'v1',
    input_snapshot: {
      eligible_candidates: [{ candidate_id: 'music_playlist' }],
      excluded_candidates: [],
    },
    output: null,
    error: { category: 'algorithm_error', message: 'boom: division by zero' },
    used_feature_ids: [],
    unused_available_features: [],
    missing_features: [],
  }
}

function contentEvidence(): AlgorithmEvidence {
  return {
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
          item_id: 'track-1',
          item_fit: 0.81,
          trait_values: null,
          feature_contributions: [],
          rationale: ['一曲目', 'first track'],
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
    proposal: baseProposalLog({ evidence: [serviceEvidence()] }),
    correlation: {
      trigger_tick_index: tickIndex,
      proposal_run_id: 'prun_20260718-000000_abcdef',
      proposal_event_ids: ['OPPORTUNITY_CREATED@45'],
    },
  }
}

function firedTickWithServiceError(tickIndex: number): MergedTickResponse {
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
    proposal: baseProposalLog({ evidence: [serviceEvidenceWithError()] }),
    correlation: {
      trigger_tick_index: tickIndex,
      proposal_run_id: 'prun_20260718-000000_abcdef',
      proposal_event_ids: ['OPPORTUNITY_CREATED@45'],
    },
  }
}

/** Captures the real coordinator context (rendered inside the same Provider
 * as `MergedCenterPanel`) so the test can drive create()/step()/
 * selectService() directly — mirrors `playback.test.tsx`'s
 * `DispatchCapture`/`renderInStore` pattern, adapted to the coordinator's
 * async action functions (it has no raw `dispatch`). */
/** Captured review-store state, so tests can assert what a click sent to the
 *  RIGHT column without mounting the whole shell. */
const reviewRef: { current: ReturnType<typeof useReviewStore>['state'] | null } = { current: null }

function renderCenterPanel() {
  const coordinatorRef: { current: ReturnType<typeof useMergedCoordinator> | null } = { current: null }

  function Capture() {
    coordinatorRef.current = useMergedCoordinator()
    reviewRef.current = useReviewStore().state
    return null
  }

  // MergedCenterPanel now renders MergedProposalPanel itself, as a SIBLING of
  // its animated playback subtree (task-17-brief) — no separate mount needed.
  // The center's <MapSurface/> needs a RunStoreProvider, and the checkpoint
  // rail/decision band it also renders need a ReviewStoreProvider.
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

describe('MergedCenterPanel', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  // With no fire and no live proposal there is no proposal to describe, so the
  // panel must contribute NOTHING to the centre column — not a placeholder,
  // and above all not the status strip's "Proposal category", which reads off
  // the SETUP world and so names a category no proposal ever carried.
  it('renders no proposal panel at all until there is a proposal', () => {
    renderCenterPanel()
    expect(screen.queryByTestId('merged-proposal-panel')).toBeNull()
    expect(screen.queryByTestId('merged-status-strip')).toBeNull()
    expect(screen.queryByTestId('merged-proposal-empty')).toBeNull()
  })

  // Structural guarantee: a playback tick must not re-render the proposal
  // cards, or an expanded contribution chain collapses mid-run. Asserted here
  // rather than in `merged_review_layout.test.tsx` because the panel renders
  // nothing until a proposal exists, and this file can drive a real fired tick.
  it('keeps the animated subtree a SIBLING of the proposal subtree', async () => {
    vi.mocked(createMergedRun).mockResolvedValue({ merged_run_id: 'mrun_sib', trigger_run_id: 'run_sib' })
    vi.mocked(tickMergedRun).mockResolvedValueOnce(firedTickWithProposal(45))

    const coordinatorRef = renderCenterPanel()
    await act(async () => {
      await coordinatorRef.current!.create({
        trigger_plan_id: 'plan_1',
        world: {} as never,
        service_package_id: 'mock_service_selector_v1',
        content_package_id: 'mock_content_selector_v1',
        run_seed: '7',
      })
    })
    await act(async () => {
      await coordinatorRef.current!.step()
    })

    const playback = screen.getByTestId('merged-playback-subtree')
    const proposals = screen.getByTestId('merged-proposal-panel')
    expect(playback.contains(proposals)).toBe(false)
    expect(proposals.contains(playback)).toBe(false)
  })

  it('docks the service result overlay once proposalLog has service evidence and no service is chosen', async () => {
    vi.mocked(createMergedRun).mockResolvedValue({ merged_run_id: 'mrun_1', trigger_run_id: 'run_1' })
    vi.mocked(tickMergedRun).mockResolvedValueOnce(firedTickWithProposal(45))

    const coordinatorRef = renderCenterPanel()

    await act(async () => {
      await coordinatorRef.current!.create({
        trigger_plan_id: 'plan_1',
        world: {} as never,
        service_package_id: 'mock_service_selector_v1',
        content_package_id: 'mock_content_selector_v1',
        run_seed: '7',
      })
    })
    await act(async () => {
      await coordinatorRef.current!.step()
    })

    expect(screen.getByTestId('service-result-overlay')).toBeInTheDocument()
    expect(screen.queryByTestId('content-result-overlay')).not.toBeInTheDocument()
    expect(screen.getByTestId('candidate-card-music_playlist')).toBeInTheDocument()
  })

  it('shows service AND content side-by-side once a service is chosen (owner review — no either/or swap)', async () => {
    vi.mocked(createMergedRun).mockResolvedValue({ merged_run_id: 'mrun_2', trigger_run_id: 'run_2' })
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
        evidence: [serviceEvidence(), contentEvidence()],
      }),
    )

    const coordinatorRef = renderCenterPanel()

    await act(async () => {
      await coordinatorRef.current!.create({
        trigger_plan_id: 'plan_1',
        world: {} as never,
        service_package_id: 'mock_service_selector_v1',
        content_package_id: 'mock_content_selector_v1',
        run_seed: '7',
      })
    })
    await act(async () => {
      await coordinatorRef.current!.step()
    })
    expect(screen.getByTestId('service-result-overlay')).toBeInTheDocument()

    await act(async () => {
      await coordinatorRef.current!.selectService('music_playlist')
    })

    expect(mergedProposalAction).toHaveBeenCalledWith('mrun_2', {
      kind: 'select_service',
      selected_service_id: 'music_playlist',
    })
    // Side-by-side (owner review): the service panel STAYS (left) while the
    // content plan appears (right) — no longer an either/or recency swap.
    expect(screen.getByTestId('service-result-overlay')).toBeInTheDocument()
    expect(screen.getByTestId('content-result-overlay')).toBeInTheDocument()
    expect(screen.getByTestId('plan-item-track-1')).toBeInTheDocument()

    // The 40/60 ratio, and — the part that actually regressed — that the two
    // halves are the grid's OWN children. A two-column grid holding a single
    // child renders one empty column and squeezes the ratio into the other,
    // which is exactly what an outer wrapper grid used to do here.
    const split = screen.getByTestId('proposal-split')
    expect(split.style.gridTemplateColumns).toBe('minmax(0, 40fr) minmax(0, 60fr)')
    const columns = Array.from(split.children)
    expect(columns).toHaveLength(2)
    expect(columns[0]).toContainElement(screen.getByTestId('service-result-overlay'))
    expect(columns[1]).toContainElement(screen.getByTestId('content-result-overlay'))

    // No ancestor may re-impose a multi-column grid around the panel: that is
    // the wrapper whose removal this guards.
    for (let el = split.parentElement; el; el = el.parentElement) {
      const tracks = el.style.gridTemplateColumns
      if (tracks && tracks.trim() !== '' && tracks !== 'none') {
        expect(el.children.length).toBeGreaterThan(1)
      }
      expect(el.className).not.toContain('merged-proposal-split')
    }
  })

  it('clicking Choose on the docked overlay calls coordinator.selectService', async () => {
    vi.mocked(createMergedRun).mockResolvedValue({ merged_run_id: 'mrun_3', trigger_run_id: 'run_3' })
    vi.mocked(tickMergedRun).mockResolvedValueOnce(firedTickWithProposal(45))
    vi.mocked(mergedProposalAction).mockResolvedValue(baseProposalLog({ status: 'service_selected' }))

    const coordinatorRef = renderCenterPanel()

    await act(async () => {
      await coordinatorRef.current!.create({
        trigger_plan_id: 'plan_1',
        world: {} as never,
        service_package_id: 'mock_service_selector_v1',
        content_package_id: 'mock_content_selector_v1',
        run_seed: '7',
      })
    })
    await act(async () => {
      await coordinatorRef.current!.step()
    })

    await act(async () => {
      fireEvent.click(screen.getByTestId('choose-candidate-music_playlist'))
    })

    expect(mergedProposalAction).toHaveBeenCalledWith('mrun_3', {
      kind: 'select_service',
      selected_service_id: 'music_playlist',
    })
  })

  it('surfaces a service algorithm_error as an alert instead of silently swallowing it', async () => {
    vi.mocked(createMergedRun).mockResolvedValue({ merged_run_id: 'mrun_5', trigger_run_id: 'run_5' })
    vi.mocked(tickMergedRun).mockResolvedValueOnce(firedTickWithServiceError(45))

    const coordinatorRef = renderCenterPanel()

    await act(async () => {
      await coordinatorRef.current!.create({
        trigger_plan_id: 'plan_1',
        world: {} as never,
        service_package_id: 'mock_service_selector_v1',
        content_package_id: 'mock_content_selector_v1',
        run_seed: '7',
      })
    })
    await act(async () => {
      await coordinatorRef.current!.step()
    })

    expect(screen.getByRole('alert')).toHaveTextContent('boom: division by zero')
  })

  it('disables the Choose button while selectService is in flight (choosingId wired through, Finding 2)', async () => {
    vi.mocked(createMergedRun).mockResolvedValue({ merged_run_id: 'mrun_6', trigger_run_id: 'run_6' })
    vi.mocked(tickMergedRun).mockResolvedValueOnce(firedTickWithProposal(45))

    let resolveAction: (log: ProposalRunLog) => void = () => {}
    const pending = new Promise<ProposalRunLog>((resolve) => {
      resolveAction = resolve
    })
    vi.mocked(mergedProposalAction).mockReturnValue(pending)

    const coordinatorRef = renderCenterPanel()

    await act(async () => {
      await coordinatorRef.current!.create({
        trigger_plan_id: 'plan_1',
        world: {} as never,
        service_package_id: 'mock_service_selector_v1',
        content_package_id: 'mock_content_selector_v1',
        run_seed: '7',
      })
    })
    await act(async () => {
      await coordinatorRef.current!.step()
    })

    const chooseButton = screen.getByTestId('choose-candidate-music_playlist') as HTMLButtonElement
    expect(chooseButton).not.toBeDisabled()

    act(() => {
      fireEvent.click(chooseButton)
    })

    // Passing `choosingId={null}` unconditionally (the pre-fix bug) would
    // leave this button always enabled/idle no matter what — asserting it
    // goes busy+disabled here proves `state.choosingId` from the coordinator
    // is actually threaded through to `<ServiceResultOverlay>`.
    expect(chooseButton).toBeDisabled()
    expect(chooseButton).toHaveTextContent('…')

    // A second click while disabled must not fire a second request (jsdom
    // does not dispatch click handlers for disabled buttons).
    fireEvent.click(chooseButton)
    expect(mergedProposalAction).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveAction(baseProposalLog({ status: 'service_selected' }))
    })
  })

  it('the 1×/2×/4× speed selector drives coordinator.setSpeed', async () => {
    const coordinatorRef = renderCenterPanel()
    const select = screen.getByTestId('merged-speed-select') as HTMLSelectElement
    // 4x is the default (owner review) — 1x is too slow to watch a whole journey.
    expect(select.value).toBe('4')

    // Change to a DIFFERENT value, or this proves nothing about the wiring.
    await act(async () => {
      fireEvent.change(select, { target: { value: '1' } })
    })

    expect(coordinatorRef.current!.state.speed).toBe(1)
    expect((screen.getByTestId('merged-speed-select') as HTMLSelectElement).value).toBe('1')
  })

  it('the Reset button clears the run (proposalLog + overlays gone, mergedRunId null)', async () => {
    vi.mocked(createMergedRun).mockResolvedValue({ merged_run_id: 'mrun_reset', trigger_run_id: 'run_reset' })
    vi.mocked(tickMergedRun).mockResolvedValueOnce(firedTickWithProposal(45))

    const coordinatorRef = renderCenterPanel()

    await act(async () => {
      await coordinatorRef.current!.create({
        trigger_plan_id: 'plan_1',
        world: {} as never,
        service_package_id: 'mock_service_selector_v1',
        content_package_id: 'mock_content_selector_v1',
        run_seed: '7',
      })
    })
    await act(async () => {
      await coordinatorRef.current!.step()
    })
    expect(screen.getByTestId('service-result-overlay')).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByTestId('merged-reset-button'))
    })

    expect(coordinatorRef.current!.state.mergedRunId).toBeNull()
    expect(coordinatorRef.current!.state.proposalLog).toBeNull()
    expect(screen.queryByTestId('service-result-overlay')).not.toBeInTheDocument()
  })

  it('the Play button drives coordinator.play() (ticks until the trigger pauses)', async () => {
    vi.mocked(createMergedRun).mockResolvedValue({ merged_run_id: 'mrun_4', trigger_run_id: 'run_4' })
    vi.mocked(tickMergedRun).mockResolvedValueOnce(firedTickWithProposal(45))

    const coordinatorRef = renderCenterPanel()

    await act(async () => {
      await coordinatorRef.current!.create({
        trigger_plan_id: 'plan_1',
        world: {} as never,
        service_package_id: 'mock_service_selector_v1',
        content_package_id: 'mock_content_selector_v1',
        run_seed: '7',
      })
    })

    await act(async () => {
      fireEvent.click(screen.getByTestId('merged-play-button'))
      // Let the coordinator's internal tick loop settle (it stops itself once
      // the mocked tick reports paused: true).
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(tickMergedRun).toHaveBeenCalledWith('mrun_4')
    expect(screen.getByTestId('service-result-overlay')).toBeInTheDocument()
  })
})

// ── Guided step-by-step overlay (owner review) ──────────────────────────────
describe('MergedCenterPanel — guided proposal steps', () => {
  it('shows the SERVICE step over the map once the rest is decided', async () => {
    vi.mocked(createMergedRun).mockResolvedValue({ merged_run_id: 'mrun_g1', trigger_run_id: 'run_g1' })
    // A monotony fire: no rest step, so the sequence opens on the service.
    vi.mocked(tickMergedRun).mockResolvedValueOnce({
      ...firedTickWithProposal(45),
      proposal: baseProposalLog({
        opportunity: { opportunity_id: 'opp-g1', trigger_purpose: 'inattentive_driving_prevention_recovery' } as never,
        journey_state: {
          lifecycle_stage: 'active_driving_content',
          motion_state: 'driving',
          active_service_id: null,
          active_plan_id: null,
        },
        evidence: [serviceEvidence()],
      }),
    })

    const coordinatorRef = renderCenterPanel()
    await act(async () => {
      await coordinatorRef.current!.create({
        trigger_plan_id: 'plan_1',
        world: {} as never,
        service_package_id: 'mock_service_selector_v1',
        content_package_id: 'mock_content_selector_v1',
        run_seed: '7',
      })
    })
    await act(async () => { await coordinatorRef.current!.step() })

    const guided = screen.getByTestId('guided-overlay')
    expect(guided).toBeInTheDocument()
    // Title = which proposal fired, then what is being asked for.
    expect(guided.textContent).toContain('Inattentive-driving proposal')
    expect(guided.textContent).toContain('Service proposal')
  })

  it('waits for the reviewer to CHOOSE a service, then shows the songs', async () => {
    vi.mocked(createMergedRun).mockResolvedValue({ merged_run_id: 'mrun_g2', trigger_run_id: 'run_g2' })
    vi.mocked(tickMergedRun).mockResolvedValueOnce({
      ...firedTickWithProposal(45),
      proposal: baseProposalLog({
        opportunity: { opportunity_id: 'opp-g2', trigger_purpose: 'inattentive_driving_prevention_recovery' } as never,
        journey_state: {
          lifecycle_stage: 'active_driving_content',
          motion_state: 'driving',
          active_service_id: 'music_playlist',
          active_plan_id: 'plan_1',
        },
        evidence: [serviceEvidence(), contentEvidence()],
      }),
    })
    // Choosing the service returns the log with the plan attached.
    vi.mocked(mergedProposalAction).mockResolvedValue(
      baseProposalLog({
        opportunity: { opportunity_id: 'opp-g2', trigger_purpose: 'inattentive_driving_prevention_recovery' } as never,
        journey_state: {
          lifecycle_stage: 'active_driving_content',
          motion_state: 'driving',
          active_service_id: 'music_playlist',
          active_plan_id: 'plan_1',
        },
        evidence: [serviceEvidence(), contentEvidence()],
      }),
    )

    const coordinatorRef = renderCenterPanel()
    await act(async () => {
      await coordinatorRef.current!.create({
        trigger_plan_id: 'plan_1',
        world: {} as never,
        service_package_id: 'mock_service_selector_v1',
        content_package_id: 'mock_content_selector_v1',
        run_seed: '7',
      })
    })
    await act(async () => { await coordinatorRef.current!.step() })

    // Still on the service step even though the journey pre-selected rank-1 —
    // the animation must not decide this for the reviewer.
    expect(screen.getByTestId('guided-overlay').textContent).toContain('Service proposal')
    expect(screen.getByTestId('guided-choose-music_playlist')).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByTestId('guided-choose-music_playlist'))
    })

    const guided = screen.getByTestId('guided-overlay')
    expect(guided.textContent).toContain('Inattentive-driving proposal')
    expect(guided.textContent).toContain('Content proposal')
    // A plain list of song names — no cards, no scores.
    expect(within(guided).getByTestId('guided-song-track-1')).toBeInTheDocument()
  })

  it('offers the services as a plain list of names, not cards', async () => {
    vi.mocked(createMergedRun).mockResolvedValue({ merged_run_id: 'mrun_g3', trigger_run_id: 'run_g3' })
    vi.mocked(tickMergedRun).mockResolvedValueOnce({
      ...firedTickWithProposal(45),
      proposal: baseProposalLog({
        opportunity: { opportunity_id: 'opp-g3', trigger_purpose: 'inattentive_driving_prevention_recovery' } as never,
        journey_state: {
          lifecycle_stage: 'active_driving_content',
          motion_state: 'driving',
          active_service_id: null,
          active_plan_id: null,
        },
        evidence: [serviceEvidence()],
      }),
    })

    const coordinatorRef = renderCenterPanel()
    await act(async () => {
      await coordinatorRef.current!.create({
        trigger_plan_id: 'plan_1',
        world: {} as never,
        service_package_id: 'mock_service_selector_v1',
        content_package_id: 'mock_content_selector_v1',
        run_seed: '7',
      })
    })
    await act(async () => { await coordinatorRef.current!.step() })

    const list = screen.getByTestId('guided-service-list')
    // Names, not ids, and none of the full card's machinery. The name is the
    // specification's own (CDC-SU_specplan Slides 39/41/70).
    expect(list.textContent).toContain('Playlist playback')
    expect(list.textContent).not.toContain('music_playlist')
    expect(within(list).queryByTestId('service-explainability')).toBeNull()
    expect(within(list).queryByTestId('reason-summary')).toBeNull()
  })

  it('shows no guided overlay before a run exists', () => {
    renderCenterPanel()
    expect(screen.queryByTestId('guided-overlay')).toBeNull()
  })
})

// ── fixbug-0806 regression guard: choosing a service that ends the
//    conversation immediately (no content step follows — e.g. its content
//    dispatch produced no plan) must auto-accept, or the content episode
//    never starts server-side (Bug 1 again) and, for a monotony fire, the
//    trigger never learns the driver's accept (B2's acknowledge-on-accept
//    regression). `handleChooseSpot`'s own automatic rank-1 selectService
//    call is a SEPARATE code path and is not exercised here. ─────────────
describe('MergedCenterPanel — auto-accept when choosing a service ends the conversation', () => {
  // This file has no global mock-reset between tests (most describe blocks
  // below get away with it because each test's own explicit
  // mockResolvedValue/mockResolvedValueOnce calls fully satisfy that test's
  // own call count). These two tests share an overlapping call SHAPE
  // (select_service, optionally followed by accept) closely enough that,
  // without a reset, the second test's assertion on `mergedProposalAction`'s
  // call COUNT/args would observe the FIRST test's leftover call history —
  // an isolation bug in the test, not in the code under test.
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('choosing a service with no content plan calls acceptContent (journey_action: accept) without waiting for a content step', async () => {
    vi.mocked(createMergedRun).mockResolvedValue({ merged_run_id: 'mrun_auto1', trigger_run_id: 'run_auto1' })
    vi.mocked(tickMergedRun).mockResolvedValueOnce({
      ...firedTickWithProposal(45),
      proposal: baseProposalLog({
        opportunity: { opportunity_id: 'opp-auto1', trigger_purpose: 'inattentive_driving_prevention_recovery' } as never,
        journey_state: {
          lifecycle_stage: 'active_driving_content',
          motion_state: 'driving',
          active_service_id: null,
          active_plan_id: null,
        },
        evidence: [serviceEvidence()],
      }),
    })
    // select_service resolves to a log with the service chosen but NO
    // content evidence (e.g. the content dispatch produced no plan) — the
    // SAME `deriveProposalOverlay(...).contentPlan == null` shape
    // `guidedState` uses to decide the conversation is 'done'.
    vi.mocked(mergedProposalAction).mockResolvedValue(
      baseProposalLog({
        status: 'service_selected',
        journey_state: {
          lifecycle_stage: 'active_driving_content',
          motion_state: 'driving',
          active_service_id: 'music_playlist',
          active_plan_id: null,
        },
        evidence: [serviceEvidence()],
      }),
    )

    const coordinatorRef = renderCenterPanel()
    await act(async () => {
      await coordinatorRef.current!.create({
        trigger_plan_id: 'plan_1',
        world: {} as never,
        service_package_id: 'mock_service_selector_v1',
        content_package_id: 'mock_content_selector_v1',
        run_seed: '7',
      })
    })
    await act(async () => { await coordinatorRef.current!.step() })

    await act(async () => {
      fireEvent.click(screen.getByTestId('guided-choose-music_playlist'))
      await Promise.resolve(); await Promise.resolve()
    })

    // First call: select_service. Second call: the auto-accept.
    expect(mergedProposalAction).toHaveBeenNthCalledWith(1, 'mrun_auto1', {
      kind: 'select_service',
      selected_service_id: 'music_playlist',
    })
    expect(mergedProposalAction).toHaveBeenNthCalledWith(2, 'mrun_auto1', {
      kind: 'journey_action',
      action_type: 'accept',
    })
    expect(mergedProposalAction).toHaveBeenCalledTimes(2)
  })

  it('choosing a service that DOES lead to a content step does NOT auto-accept', async () => {
    vi.mocked(createMergedRun).mockResolvedValue({ merged_run_id: 'mrun_auto2', trigger_run_id: 'run_auto2' })
    vi.mocked(tickMergedRun).mockResolvedValueOnce({
      ...firedTickWithProposal(45),
      proposal: baseProposalLog({
        opportunity: { opportunity_id: 'opp-auto2', trigger_purpose: 'inattentive_driving_prevention_recovery' } as never,
        journey_state: {
          lifecycle_stage: 'active_driving_content',
          motion_state: 'driving',
          active_service_id: null,
          active_plan_id: null,
        },
        evidence: [serviceEvidence()],
      }),
    })
    vi.mocked(mergedProposalAction).mockResolvedValue(
      baseProposalLog({
        // MUST match the fire tick's opportunity_id ('opp-auto2') — MergedCenterPanel
        // tracks the reviewer's choice per-opportunity (`serviceChosenOpportunityId`)
        // and compares it against the CURRENT `proposalLog.opportunity.opportunity_id`
        // on every render; falling back to `baseProposalLog`'s default ('op_1') here
        // would mismatch and strand `guidedState` back on the 'service' step.
        opportunity: { opportunity_id: 'opp-auto2', trigger_purpose: 'inattentive_driving_prevention_recovery' } as never,
        status: 'content_selected',
        journey_state: {
          lifecycle_stage: 'active_driving_content',
          motion_state: 'driving',
          active_service_id: 'music_playlist',
          active_plan_id: 'plan_1',
        },
        evidence: [serviceEvidence(), contentEvidence()],
      }),
    )

    const coordinatorRef = renderCenterPanel()
    await act(async () => {
      await coordinatorRef.current!.create({
        trigger_plan_id: 'plan_1',
        world: {} as never,
        service_package_id: 'mock_service_selector_v1',
        content_package_id: 'mock_content_selector_v1',
        run_seed: '7',
      })
    })
    await act(async () => { await coordinatorRef.current!.step() })

    await act(async () => {
      fireEvent.click(screen.getByTestId('guided-choose-music_playlist'))
      await Promise.resolve(); await Promise.resolve()
    })

    // Only the select_service call — the content step (OK/Reject) is what
    // will eventually call acceptContent, not the choose itself.
    expect(mergedProposalAction).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('guided-song-list')).toBeInTheDocument()
  })
})

// ── Bug 1: a monotony fire has no rest step, so its ONLY pause must still
//    offer a decline (drop the proposal, keep driving) ─────────────────────
describe('MergedCenterPanel — monotony decline', () => {
  /** A monotony fire (`inattentive_driving_prevention_recovery`) paused on
   *  the service step — same shape as the 'shows the SERVICE step' fixture
   *  above (mrun_g1), reused here under its own run ids. */
  function monotonyFireTick(tickIndex: number): MergedTickResponse {
    return {
      ...firedTickWithProposal(tickIndex),
      proposal: baseProposalLog({
        opportunity: { opportunity_id: 'opp-mono', trigger_purpose: 'inattentive_driving_prevention_recovery' } as never,
        journey_state: {
          lifecycle_stage: 'active_driving_content',
          motion_state: 'driving',
          active_service_id: null,
          active_plan_id: null,
        },
        evidence: [serviceEvidence()],
      }),
    }
  }

  /** A quiet subsequent tick (no new fire) — lets `play()`'s resumed loop
   *  halt immediately after `rejectProposal()` so the test doesn't hang. */
  function quietTick(tickIndex: number): MergedTickResponse {
    return {
      trigger: {
        decision: null,
        error: null,
        paused: true,
        completed: false,
        tick_index: null,
        route_fraction: tickIndex / 100,
        distance_km: null,
        speed_kph: 10,
        motion_state: 'DRIVING',
        recovery_phase: null,
        is_traffic_jam: false,
        segment_type: 'highway',
      },
      proposal: null,
      correlation: null,
    }
  }

  it('offers a decline control on the guided overlay for a monotony fire', async () => {
    vi.mocked(createMergedRun).mockResolvedValue({ merged_run_id: 'mrun_mono1', trigger_run_id: 'run_mono1' })
    vi.mocked(tickMergedRun).mockResolvedValueOnce(monotonyFireTick(45))

    const coordinatorRef = renderCenterPanel()
    await act(async () => {
      await coordinatorRef.current!.create({
        trigger_plan_id: 'plan_1',
        world: {} as never,
        service_package_id: 'mock_service_selector_v1',
        content_package_id: 'mock_content_selector_v1',
        run_seed: '7',
      })
    })
    await act(async () => { await coordinatorRef.current!.step() })

    expect(screen.getByTestId('guided-overlay')).toBeInTheDocument()
    expect(screen.getByTestId('guided-decline-button')).toBeInTheDocument()
  })

  // fixbug-0806 (Bugs 2/3): the service-step decline is now a PROPOSAL-side
  // reject (`coordinator.rejectProposal`), NOT `declineRest` — a monotony
  // fire never had a rest to decline in the first place, and post-fix a
  // fire's earlier `select_service` no longer acknowledges the trigger (that
  // moved to `accept`), so the trigger run is STILL paused on the pending
  // proposal here — `declined: true` (mirrors backend test 2 in
  // test_merged_reject_flow.py).
  it('clicking the guided decline button calls rejectProposal and clears the overlay', async () => {
    vi.mocked(createMergedRun).mockResolvedValue({ merged_run_id: 'mrun_mono2', trigger_run_id: 'run_mono2' })
    vi.mocked(tickMergedRun).mockResolvedValueOnce(monotonyFireTick(45)).mockResolvedValue(quietTick(46))
    vi.mocked(rejectProposal).mockResolvedValue({ proposal: baseProposalLog(), declined: true })

    const coordinatorRef = renderCenterPanel()
    await act(async () => {
      await coordinatorRef.current!.create({
        trigger_plan_id: 'plan_1',
        world: {} as never,
        service_package_id: 'mock_service_selector_v1',
        content_package_id: 'mock_content_selector_v1',
        run_seed: '7',
      })
    })
    await act(async () => { await coordinatorRef.current!.step() })
    expect(screen.getByTestId('guided-decline-button')).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByTestId('guided-decline-button'))
      // Let rejectProposal's resumed play() settle (mirrors the rest-reject
      // test's pattern in merged_rest_journey.test.tsx).
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(rejectProposal).toHaveBeenCalledWith('mrun_mono2')
    expect(declineRest).not.toHaveBeenCalled()
    // declined:true → REST_DECLINED clears proposalLog, which pulls the
    // whole guided overlay (there is no longer an opportunity to guide the
    // reviewer through).
    expect(screen.queryByTestId('guided-overlay')).toBeNull()
  })

  it('does NOT show the monotony decline control on a rest_recommended fire (its own reject lives in rest-accept-panel)', async () => {
    vi.mocked(createMergedRun).mockResolvedValue({ merged_run_id: 'mrun_mono3', trigger_run_id: 'run_mono3' })
    // The shared fixture (firedTickWithProposal) is already a rest_recommended
    // / before_rest_until_stop fire — its guided overlay opens on 'rest', which
    // is a DIFFERENT block (rest-accept-panel) than guided-overlay above; this
    // asserts guided-decline-button never leaks into that flow.
    vi.mocked(tickMergedRun).mockResolvedValueOnce(firedTickWithProposal(45))

    const coordinatorRef = renderCenterPanel()
    await act(async () => {
      await coordinatorRef.current!.create({
        trigger_plan_id: 'plan_1',
        world: {} as never,
        service_package_id: 'mock_service_selector_v1',
        content_package_id: 'mock_content_selector_v1',
        run_seed: '7',
      })
    })
    await act(async () => { await coordinatorRef.current!.step() })

    expect(screen.queryByTestId('guided-decline-button')).toBeNull()
  })
})

// ── The overlay must get out of the way at the rest spot ────────────────────
describe('MergedCenterPanel — arrival at the rest spot', () => {
  /** A fired tick, then a tick where the car has stopped and the nap begins. */
  function napTick(tickIndex: number): MergedTickResponse {
    const base = firedTickWithProposal(tickIndex)
    return {
      ...base,
      trigger: { ...base.trigger, recovery_phase: 'nap', motion_state: 'STOPPED' },
      // IDENTICAL to the prior tick's proposal except that recovery has begun —
      // so `recovery_phase` is the ONLY thing that can close the overlay. A nap
      // tick that also switched the opportunity/lifecycle would route to a
      // different overlay and pass without the rule under test.
      proposal: baseProposalLog({
        opportunity: { opportunity_id: 'opp-nap', trigger_purpose: 'inattentive_driving_prevention_recovery' } as never,
        journey_state: {
          lifecycle_stage: 'active_driving_content',
          motion_state: 'stopped',
          active_service_id: 'music_playlist',
          active_plan_id: 'plan_1',
        },
        evidence: [serviceEvidence(), contentEvidence()],
      }),
    }
  }

  it('closes the song list and shows the nap animation on arrival', async () => {
    vi.mocked(createMergedRun).mockResolvedValue({ merged_run_id: 'mrun_n1', trigger_run_id: 'run_n1' })
    vi.mocked(tickMergedRun).mockResolvedValueOnce({
      ...firedTickWithProposal(45),
      proposal: baseProposalLog({
        opportunity: { opportunity_id: 'opp-nap', trigger_purpose: 'inattentive_driving_prevention_recovery' } as never,
        journey_state: {
          lifecycle_stage: 'active_driving_content',
          motion_state: 'driving',
          active_service_id: 'music_playlist',
          active_plan_id: 'plan_1',
        },
        evidence: [serviceEvidence(), contentEvidence()],
      }),
    }).mockResolvedValueOnce(napTick(46))
    vi.mocked(mergedProposalAction).mockResolvedValue(
      baseProposalLog({
        opportunity: { opportunity_id: 'opp-nap', trigger_purpose: 'inattentive_driving_prevention_recovery' } as never,
        journey_state: {
          lifecycle_stage: 'active_driving_content',
          motion_state: 'driving',
          active_service_id: 'music_playlist',
          active_plan_id: 'plan_1',
        },
        evidence: [serviceEvidence(), contentEvidence()],
      }),
    )

    const coordinatorRef = renderCenterPanel()
    await act(async () => {
      await coordinatorRef.current!.create({
        trigger_plan_id: 'plan_1',
        world: {} as never,
        service_package_id: 'mock_service_selector_v1',
        content_package_id: 'mock_content_selector_v1',
        run_seed: '7',
      })
    })
    await act(async () => { await coordinatorRef.current!.step() })
    await act(async () => {
      fireEvent.click(screen.getByTestId('guided-choose-music_playlist'))
    })
    expect(screen.getByTestId('guided-song-list')).toBeInTheDocument()

    // Continue → the car reaches the spot and the nap starts.
    await act(async () => { await coordinatorRef.current!.step() })

    // The reported bug: the song list stayed up over the nap.
    expect(screen.queryByTestId('guided-overlay')).toBeNull()
    expect(screen.getByTestId('recovery-sleep')).toBeInTheDocument()
  })
})

// ── Clicking a card drives the RIGHT column's comparison ────────────────────
// A click asks "why this instead of the winner?", so A = the top-ranked option
// and B = the clicked one.
describe('MergedCenterPanel — click-to-compare', () => {
  async function runToProposal(log: ProposalRunLog) {
    vi.mocked(createMergedRun).mockResolvedValue({ merged_run_id: 'mrun_c1', trigger_run_id: 'run_c1' })
    vi.mocked(tickMergedRun).mockResolvedValueOnce({ ...firedTickWithProposal(45), proposal: log })
    vi.mocked(mergedProposalAction).mockResolvedValue(log)

    const coordinatorRef = renderCenterPanel()
    await act(async () => {
      await coordinatorRef.current!.create({
        trigger_plan_id: 'plan_1',
        world: {} as never,
        service_package_id: 'mock_service_selector_v1',
        content_package_id: 'mock_content_selector_v1',
        run_seed: '7',
      })
    })
    await act(async () => { await coordinatorRef.current!.step() })
    return coordinatorRef
  }

  /** The shared fixtures carry ONE candidate and ONE song; a comparison needs
   *  two of each, so these widen them locally rather than changing fixtures
   *  other tests count on. */
  function twoCandidates(): AlgorithmEvidence {
    const ev = serviceEvidence()
    const output = ev.output as { ranked_candidates: unknown[] }
    const first = output.ranked_candidates[0] as Record<string, unknown>
    output.ranked_candidates = [
      first,
      { ...first, rank: 2, candidate_id: 'full_karaoke', score: 0.41 },
    ]
    return ev
  }

  function twoSongs(): AlgorithmEvidence {
    const ev = contentEvidence()
    const output = ev.output as { ordered_items: unknown[] }
    const first = output.ordered_items[0] as Record<string, unknown>
    output.ordered_items = [first, { ...first, position: 2, item_id: 'track-2', item_fit: 0.62 }]
    return ev
  }

  const chosenLog = () =>
    baseProposalLog({
      status: 'content_selected',
      journey_state: {
        lifecycle_stage: 'active_driving_content',
        motion_state: 'driving',
        active_service_id: 'music_playlist',
        active_plan_id: 'plan_1',
      },
      evidence: [twoCandidates(), twoSongs()],
    })

  it('sends the service stage with A = rank 1 and B = the clicked candidate', async () => {
    await runToProposal(chosenLog())
    // The overlay is on the guided step until a service is chosen; choose it so
    // the full cards render below.
    await act(async () => {
      fireEvent.click(screen.getByTestId('guided-choose-music_playlist'))
    })

    const cards = screen.getAllByTestId(/^candidate-card-/)
    expect(cards.length).toBeGreaterThan(1)
    const firstId = cards[0].getAttribute('data-testid')!.replace('candidate-card-', '')
    const secondId = cards[1].getAttribute('data-testid')!.replace('candidate-card-', '')

    await act(async () => { fireEvent.click(cards[1]) })

    expect(reviewRef.current!.stage).toBe('service')
    expect(reviewRef.current!.compareLeftId).toBe(firstId)
    expect(reviewRef.current!.compareRightId).toBe(secondId)
    // The judgements scope to the option under review — the winner.
    expect(reviewRef.current!.targetId).toBe(firstId)
  })

  it('leaves the stage default when the WINNER itself is clicked', async () => {
    await runToProposal(chosenLog())
    await act(async () => {
      fireEvent.click(screen.getByTestId('guided-choose-music_playlist'))
    })

    const cards = screen.getAllByTestId(/^candidate-card-/)
    await act(async () => { fireEvent.click(cards[0]) })

    expect(reviewRef.current!.stage).toBe('service')
    // Comparing the winner with itself says nothing; the stage's own default
    // (rank 1 vs rank 2) stands.
    expect(reviewRef.current!.compareLeftId).toBeNull()
    expect(reviewRef.current!.compareRightId).toBeNull()
  })

  it('sends the content stage with A = position 1 and B = the clicked song', async () => {
    await runToProposal(chosenLog())
    await act(async () => {
      fireEvent.click(screen.getByTestId('guided-choose-music_playlist'))
    })

    const items = screen.getAllByTestId(/^plan-item-/)
    expect(items.length).toBeGreaterThan(1)
    const firstId = items[0].getAttribute('data-testid')!.replace('plan-item-', '')
    const secondId = items[1].getAttribute('data-testid')!.replace('plan-item-', '')

    await act(async () => { fireEvent.click(items[1]) })

    expect(reviewRef.current!.stage).toBe('content')
    expect(reviewRef.current!.compareLeftId).toBe(firstId)
    expect(reviewRef.current!.compareRightId).toBe(secondId)
  })

  it('choosing a service does NOT also re-point the comparison', async () => {
    // The Choose button sits inside the clickable card; without
    // stopPropagation, choosing would silently also change what the right
    // column is comparing.
    await runToProposal(chosenLog())
    await act(async () => {
      fireEvent.click(screen.getByTestId('guided-choose-music_playlist'))
    })
    const cards = screen.getAllByTestId(/^candidate-card-/)
    const secondId = cards[1].getAttribute('data-testid')!.replace('candidate-card-', '')

    await act(async () => {
      fireEvent.click(screen.getByTestId(`choose-candidate-${secondId}`))
    })

    expect(reviewRef.current!.compareRightId).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Continue ends the current fire's conversation; the overlay titles name the
// proposal instead of counting steps.
// ---------------------------------------------------------------------------

describe('MergedCenterPanel — guided overlay dismissal and titles', () => {
  async function driveToSongs(runSuffix: string) {
    vi.mocked(createMergedRun).mockResolvedValue({
      merged_run_id: `mrun_${runSuffix}`, trigger_run_id: `run_${runSuffix}`,
    })
    const log = baseProposalLog({
      opportunity: {
        opportunity_id: `opp-${runSuffix}`,
        trigger_purpose: 'inattentive_driving_prevention_recovery',
      } as never,
      journey_state: {
        lifecycle_stage: 'active_driving_content',
        motion_state: 'driving',
        active_service_id: 'music_playlist',
        active_plan_id: 'plan_1',
      },
      evidence: [serviceEvidence(), contentEvidence()],
    })
    vi.mocked(tickMergedRun).mockResolvedValue({ ...firedTickWithProposal(45), proposal: log })
    vi.mocked(mergedProposalAction).mockResolvedValue(log)

    const coordinatorRef = renderCenterPanel()
    await act(async () => {
      await coordinatorRef.current!.create({
        trigger_plan_id: 'plan_1', world: {} as never,
        service_package_id: 'mock_service_selector_v1',
        content_package_id: 'mock_content_selector_v1', run_seed: '7',
      })
    })
    await act(async () => { await coordinatorRef.current!.step() })
    await act(async () => {
      fireEvent.click(screen.getByTestId('guided-choose-music_playlist'))
    })
    return coordinatorRef
  }

  it('closes the song list when Continue is pressed', async () => {
    await driveToSongs('d1')
    // The songs are up before Continue.
    expect(screen.getByTestId('guided-song-list')).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByTestId('guided-content-ok'))
      // Let acceptContentAndResume's resumed play() settle (mirrors the
      // decline/rest tests' pattern above).
      await Promise.resolve()
      await Promise.resolve()
    })

    // Regression: a monotony fire's conversation has no terminal step of its own,
    // so the song list stayed on screen across Continue and covered the map —
    // including the pause on the NEXT fire, which then looked like nothing had
    // happened. The content OK button (Task 5) now ends this fire's conversation.
    expect(screen.queryByTestId('guided-overlay')).toBeNull()
  })

  it('names the proposal in the overlay title instead of counting steps', async () => {
    await driveToSongs('d2')
    const guided = screen.getByTestId('guided-overlay')

    // The proposal CATEGORY leads the title…
    expect(guided.textContent).toContain('Inattentive-driving proposal')
    // …followed by what this overlay is FOR.
    expect(guided.textContent).toContain('Content proposal')
    // The step counter is gone.
    expect(guided.textContent).not.toMatch(/Step \d+ \/ \d+/)
  })
})

// ---------------------------------------------------------------------------
// Task 4: no Step button; Continue only after a manual pause; hidden during
// a proposal (fire) pause.
// ---------------------------------------------------------------------------
describe('MergedCenterPanel — controls: no Step, Continue only after manual pause', () => {
  it('renders no Step button', () => {
    renderCenterPanel()
    expect(screen.queryByTestId('merged-step-button')).toBeNull()
  })

  it('after a manual pause the Play button reads Continue and is enabled', async () => {
    vi.mocked(createMergedRun).mockResolvedValue({ merged_run_id: 'mrun_p', trigger_run_id: 'run_p' })
    // A quiet tick so play()'s loop halts without a fire on screen.
    vi.mocked(tickMergedRun).mockResolvedValue({
      trigger: { decision: null, error: null, paused: true, completed: false, tick_index: null,
        route_fraction: 0.3, distance_km: null, speed_kph: 20, motion_state: 'DRIVING',
        recovery_phase: null, is_traffic_jam: false, segment_type: 'highway' },
      proposal: null, correlation: null,
    })
    const coordinatorRef = renderCenterPanel()
    await act(async () => {
      await coordinatorRef.current!.create({ trigger_plan_id: 'plan_1', world: {} as never,
        service_package_id: 'mock_service_selector_v1', content_package_id: 'mock_content_selector_v1', run_seed: '7' })
    })
    act(() => { coordinatorRef.current!.pause() })
    const btn = screen.getByTestId('merged-play-button') as HTMLButtonElement
    expect(btn).toHaveTextContent('Continue')
    expect(btn).not.toBeDisabled()
  })

  it('hides the Play/Continue button during a proposal pause (fire on screen)', async () => {
    vi.mocked(createMergedRun).mockResolvedValue({ merged_run_id: 'mrun_pp', trigger_run_id: 'run_pp' })
    // A monotony fire → guided overlay is up (proposal pause), not a manual one.
    vi.mocked(tickMergedRun).mockResolvedValueOnce({
      ...firedTickWithProposal(45),
      proposal: baseProposalLog({
        opportunity: { opportunity_id: 'opp-pp', trigger_purpose: 'inattentive_driving_prevention_recovery' } as never,
        journey_state: { lifecycle_stage: 'active_driving_content', motion_state: 'driving', active_service_id: null, active_plan_id: null },
        evidence: [serviceEvidence()],
      }),
    })
    const coordinatorRef = renderCenterPanel()
    await act(async () => {
      await coordinatorRef.current!.create({ trigger_plan_id: 'plan_1', world: {} as never,
        service_package_id: 'mock_service_selector_v1', content_package_id: 'mock_content_selector_v1', run_seed: '7' })
    })
    await act(async () => { await coordinatorRef.current!.step() })
    expect(screen.getByTestId('guided-overlay')).toBeInTheDocument()
    expect(screen.queryByTestId('merged-play-button')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Task 5: OK/Reject under the content song list (moving conversation only) +
// the now-playing badge on the map.
// ---------------------------------------------------------------------------
describe('MergedCenterPanel — content OK/Reject + now-playing badge (moving)', () => {
  async function driveToMonotonySongs(suffix: string) {
    vi.mocked(createMergedRun).mockResolvedValue({ merged_run_id: `mrun_${suffix}`, trigger_run_id: `run_${suffix}` })
    const logWithPlan = baseProposalLog({
      opportunity: { opportunity_id: `opp-${suffix}`, trigger_purpose: 'inattentive_driving_prevention_recovery' } as never,
      journey_state: { lifecycle_stage: 'active_driving_content', motion_state: 'driving', active_service_id: 'music_playlist', active_plan_id: 'plan_1' },
      evidence: [serviceEvidence(), contentEvidence()],
    })
    // firedTickWithProposal's shared trigger defaults to a STOPPED rest-fire
    // shape; a monotony fire keeps the car DRIVING, so the trigger-level
    // motion_state is overridden to match (and to exercise the now-playing
    // badge's `latestTrigger.motion_state !== 'STOPPED'` gate below). The
    // fire happens ONCE; any resumed tick after that (OK/Reject both call
    // play()) gets a quiet DRIVING tick with no proposal, so the loop halts
    // immediately instead of replaying the same fire forever (mirrors the
    // monotony-decline describe block's own `quietTick` above).
    const base = firedTickWithProposal(45)
    vi.mocked(tickMergedRun)
      .mockResolvedValueOnce({
        ...base,
        trigger: { ...base.trigger, motion_state: 'DRIVING' },
        proposal: logWithPlan,
      })
      .mockResolvedValue({
        trigger: { decision: null, error: null, paused: true, completed: false, tick_index: null,
          route_fraction: 0.46, distance_km: null, speed_kph: 15, motion_state: 'DRIVING',
          recovery_phase: null, is_traffic_jam: false, segment_type: 'highway' },
        proposal: null, correlation: null,
      })
    vi.mocked(mergedProposalAction).mockResolvedValue(logWithPlan)
    vi.mocked(declineRest).mockResolvedValue({} as never)
    // fixbug-0806: no acknowledge fires at select_service anymore (moved to
    // accept — B2), so the trigger run is still paused on the pending
    // proposal when a reject happens straight after choosing the service —
    // the best-effort trigger decline actually runs (declined: true).
    vi.mocked(rejectProposal).mockResolvedValue({ proposal: logWithPlan, declined: true })
    const coordinatorRef = renderCenterPanel()
    await act(async () => {
      await coordinatorRef.current!.create({ trigger_plan_id: 'plan_1', world: {} as never,
        service_package_id: 'mock_service_selector_v1', content_package_id: 'mock_content_selector_v1', run_seed: '7' })
    })
    await act(async () => { await coordinatorRef.current!.step() })
    await act(async () => { fireEvent.click(screen.getByTestId('guided-choose-music_playlist')) })
    return coordinatorRef
  }

  it('shows OK and Reject under the content song list', async () => {
    await driveToMonotonySongs('ok1')
    expect(screen.getByTestId('guided-song-list')).toBeInTheDocument()
    expect(screen.getByTestId('guided-content-ok')).toBeInTheDocument()
    expect(screen.getByTestId('guided-content-reject')).toBeInTheDocument()
  })

  // Fix round 1: the legacy `guided-decline-button` (a monotony fire's
  // service-step decline) must NOT double up with the new content-step
  // guided-content-reject — exactly one reject-style control per step.
  it('shows exactly ONE reject control at the content step (no legacy guided-decline-button duplicate)', async () => {
    await driveToMonotonySongs('mutex1')
    expect(screen.getByTestId('guided-content-reject')).toBeInTheDocument()
    expect(screen.queryByTestId('guided-decline-button')).toBeNull()
  })

  it('OK dismisses the songs, starts the content plan (journey_action: accept), resumes, and shows the now-playing badge', async () => {
    const coordinatorRef = await driveToMonotonySongs('ok2')
    await act(async () => {
      fireEvent.click(screen.getByTestId('guided-content-ok'))
      await Promise.resolve(); await Promise.resolve()
    })
    // fixbug-0806 (Bug 1 root fix): OK must actually START the content plan
    // server-side — this is the call that flips `playback_state` to `active`
    // so `_derive_content_context` stops returning null and the tick engine
    // applies content relief.
    expect(mergedProposalAction).toHaveBeenCalledWith('mrun_ok2', { kind: 'journey_action', action_type: 'accept' })
    expect(screen.queryByTestId('guided-overlay')).toBeNull()
    expect(coordinatorRef.current!.state.nowPlaying).toEqual({ serviceId: 'music_playlist', opportunityId: 'opp-ok2' })
    // Badge shows while the car is moving.
    expect(screen.getByTestId('now-playing-badge')).toBeInTheDocument()
  })

  // fixbug-0806 (Bugs 2/3): a content-step reject is a PROPOSAL-side reject
  // (`rejectProposal`), not `declineRest` — declineRest requires the trigger
  // run to still be paused on a pending REST proposal, which a monotony fire
  // never has in the first place (this is exactly the 422 the bug report
  // described for the rest flow's equivalent step).
  it('Reject on the content step calls rejectProposal (not declineRest) and clears the overlay', async () => {
    await driveToMonotonySongs('rej1')
    await act(async () => {
      fireEvent.click(screen.getByTestId('guided-content-reject'))
      await Promise.resolve(); await Promise.resolve()
    })
    expect(rejectProposal).toHaveBeenCalledWith('mrun_rej1')
    expect(declineRest).not.toHaveBeenCalled()
    expect(screen.queryByTestId('guided-overlay')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Finding 2 (final whole-branch review): the backend legitimately leaves
// `journey_state.active_service_id` null when the service matrix yields zero
// eligible candidates (NO_ELIGIBLE_CANDIDATE / T017a path). `guidedState`
// still returns step 'rest' (isRestFlow && !restDecided depends only on
// trigger_purpose + lifecycle_stage), so `guidedActive` is true — but the
// rest chooser overlay never renders because `showRestAccept` additionally
// requires `liveActiveServiceId != null`. Without the fix, the reviewer is
// paused with NO Continue button and NO rest overlay — stranded (only Reset,
// which discards the run).
// ---------------------------------------------------------------------------
describe('MergedCenterPanel — rest-step stranding when zero services are eligible (Finding 2)', () => {
  it('offers Continue (never strands the reviewer) when the rest fire has zero eligible services', async () => {
    vi.mocked(createMergedRun).mockResolvedValue({ merged_run_id: 'mrun_f2a', trigger_run_id: 'run_f2a' })
    // firedTickWithProposal's default fixture already carries
    // journey_state.active_service_id: null — exactly the zero-eligible-
    // candidate shape (T017a: NO_ELIGIBLE_CANDIDATE).
    vi.mocked(tickMergedRun).mockResolvedValueOnce(firedTickWithProposal(45))

    const coordinatorRef = renderCenterPanel()
    await act(async () => {
      await coordinatorRef.current!.create({
        trigger_plan_id: 'plan_1',
        world: {} as never,
        service_package_id: 'mock_service_selector_v1',
        content_package_id: 'mock_content_selector_v1',
        run_seed: '7',
      })
    })
    await act(async () => {
      await coordinatorRef.current!.step()
    })

    // No rest chooser was ever shown (nothing eligible to choose)...
    expect(screen.queryByTestId('rest-accept-panel')).toBeNull()
    // ...so the defensive Continue fallback must offer the reviewer a way
    // to advance rather than leaving them stuck with only Reset.
    const btn = screen.getByTestId('merged-play-button') as HTMLButtonElement
    expect(btn).toBeInTheDocument()
    expect(btn).not.toBeDisabled()
  })

  // Companion (protects the matrix): a NORMAL rest fire — active_service_id
  // non-null — must still show the rest chooser and must NOT also show
  // Continue (no double control).
  it('shows the rest chooser (and hides Continue) when the rest fire HAS an eligible service', async () => {
    vi.mocked(createMergedRun).mockResolvedValue({ merged_run_id: 'mrun_f2b', trigger_run_id: 'run_f2b' })
    vi.mocked(tickMergedRun).mockResolvedValueOnce({
      ...firedTickWithProposal(45),
      proposal: baseProposalLog({
        evidence: [serviceEvidence()],
        journey_state: {
          lifecycle_stage: 'before_rest_until_stop',
          motion_state: 'stopped',
          active_service_id: 'music_playlist',
          active_plan_id: null,
        },
      }),
    })

    const coordinatorRef = renderCenterPanel()
    await act(async () => {
      await coordinatorRef.current!.create({
        trigger_plan_id: 'plan_1',
        world: {} as never,
        service_package_id: 'mock_service_selector_v1',
        content_package_id: 'mock_content_selector_v1',
        run_seed: '7',
      })
    })
    await act(async () => {
      await coordinatorRef.current!.step()
    })

    expect(screen.getByTestId('rest-accept-panel')).toBeInTheDocument()
    expect(screen.queryByTestId('merged-play-button')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Task 6: the post-rest proposal reopens the service/content conversation;
// resolving it shows "Continue driving" instead of auto-resuming.
// ---------------------------------------------------------------------------
describe('MergedCenterPanel — after-rest conversation + Continue driving', () => {
  function afterRestLog(suffix: string, active: string | null) {
    return baseProposalLog({
      opportunity: { opportunity_id: `opp-post-${suffix}`, trigger_purpose: 'inattentive_driving_prevention_recovery',
        lifecycle_stage: 'after_rest_before_restart' } as never,
      journey_state: { lifecycle_stage: 'after_rest_before_restart', motion_state: 'stopped',
        active_service_id: active, active_plan_id: active ? 'plan_1' : null },
      evidence: active ? [serviceEvidence(), contentEvidence()] : [serviceEvidence()],
    })
  }

  async function driveToAfterRest(suffix: string) {
    vi.mocked(createMergedRun).mockResolvedValue({ merged_run_id: `mrun_${suffix}`, trigger_run_id: `run_${suffix}` })
    // The post-rest proposal arrives on a stopped, paused tick (backend recompute).
    vi.mocked(tickMergedRun).mockResolvedValue({
      trigger: { decision: restProposalDecision, error: null, paused: true, completed: false,
        tick_index: 80, route_fraction: 0.8, distance_km: null, speed_kph: 0, motion_state: 'STOPPED',
        recovery_phase: null, is_traffic_jam: false, segment_type: 'highway' },
      proposal: afterRestLog(suffix, null), correlation: null,
    })
    vi.mocked(mergedProposalAction).mockResolvedValue(afterRestLog(suffix, 'music_playlist'))
    const coordinatorRef = renderCenterPanel()
    await act(async () => {
      await coordinatorRef.current!.create({ trigger_plan_id: 'plan_1', world: {} as never,
        service_package_id: 'mock_service_selector_v1', content_package_id: 'mock_content_selector_v1', run_seed: '7' })
    })
    await act(async () => { await coordinatorRef.current!.step() })
    return coordinatorRef
  }

  it('reopens the service step for the post-rest proposal (car stopped)', async () => {
    await driveToAfterRest('ar1')
    const guided = screen.getByTestId('guided-overlay')
    expect(guided.textContent).toContain('Service proposal')
    expect(screen.getByTestId('guided-choose-music_playlist')).toBeInTheDocument()
  })

  it('after resolving the post-rest content, shows Continue driving; clicking it resumes', async () => {
    const coordinatorRef = await driveToAfterRest('ar2')
    await act(async () => { fireEvent.click(screen.getByTestId('guided-choose-music_playlist')) })
    // On the content step, an after-rest OK resolves the conversation.
    await act(async () => { fireEvent.click(screen.getByTestId('guided-content-ok')) })
    const cont = screen.getByTestId('guided-continue-driving')
    expect(cont).toBeInTheDocument()
    const playSpy = vi.spyOn(coordinatorRef.current!, 'continueDriving')
    await act(async () => {
      fireEvent.click(screen.getByTestId('guided-continue-driving'))
      await Promise.resolve(); await Promise.resolve()
    })
    // Clicking Continue driving actually calls the coordinator's resume path,
    // not just visually hiding the button.
    expect(playSpy).toHaveBeenCalled()
    // The overlay is gone (conversation done) after Continue driving.
    expect(screen.queryByTestId('guided-continue-driving')).toBeNull()
  })
})
