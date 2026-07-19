/**
 * merged_quickview_ui.test.tsx (feature 020, Slice-2c Task 5) — the merged
 * quickview projection strip + click-to-inspect flow:
 *   - `coordinator.quickview(...)` populates `state.quickviewResult` (an
 *     ephemeral `MergedInstantResult` — 2 fires, each carrying a distinct
 *     ephemeral `proposal`).
 *   - `MergedCenterPanel` renders a clickable `ScoreTimeline` projection
 *     strip fed by `mergedInstantResultToTimeline`.
 *   - Clicking a fire marker calls `coordinator.inspectFire(index)`, which
 *     docks that fire's `proposal` in the SAME `ServiceResultOverlay` the
 *     live tick loop uses, READ-ONLY (Choose is wired to a no-op, never
 *     `coordinator.selectService`/`mergedProposalAction`).
 *
 * Rendered inside a REAL `MergedCoordinatorProvider` (mirrors
 * `merged_center.test.tsx`'s `renderCenterPanel` pattern): only the network
 * boundary (`api/mergedClient.ts`) is mocked.
 */
import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MergedCoordinatorProvider, useMergedCoordinator } from '../src/state/mergedCoordinator'
import { RunStoreProvider } from '../src/state/runStore'
import { ProposalStoreProvider } from '../src/state/proposalStore'
import type { MergedInstantResult, MergedFirePoint, MergedRestOption, MergedTickResponse } from '../src/api/mergedClient'
import type { ProposalRunLog, AlgorithmEvidence } from '../src/api/proposalClient'
import MergedCenterPanel from '../src/components/merged/MergedCenterPanel'
import MergedProposalPanel from '../src/components/merged/MergedProposalPanel'

vi.mock('../src/api/mergedClient', () => ({
  createMergedRun: vi.fn(),
  tickMergedRun: vi.fn(),
  mergedProposalAction: vi.fn(),
  mergedQuickview: vi.fn(),
  afterRestProposal: vi.fn(),
}))

import { createMergedRun, tickMergedRun, mergedQuickview, mergedProposalAction, afterRestProposal } from '../src/api/mergedClient'

// ── fixtures ─────────────────────────────────────────────────────────────

function serviceEvidenceFor(candidateId: string): AlgorithmEvidence {
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
          score: 0.55,
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

function proposalLogFor(candidateId: string, runId: string): ProposalRunLog {
  return {
    run_id: runId,
    created_at: '2026-07-18T00:00:00Z',
    opportunity: {
      opportunity_id: `op_${runId}`,
      trigger_purpose: 'rest_recommended',
      lifecycle_stage: 'before_rest_until_stop',
      allowed_service_ids: [candidateId],
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
    evidence: [serviceEvidenceFor(candidateId)],
    status: 'created',
  } as unknown as ProposalRunLog
}

function quickviewResultFixture(): MergedInstantResult {
  const fireA: MergedFirePoint = {
    category: 'rest_required',
    strength: 'high',
    tick: 10,
    time_min: 5,
    proposal: proposalLogFor('music_playlist', 'prun_fire_a'),
    proposal_error: null,
  }
  const fireB: MergedFirePoint = {
    category: 'rest_required',
    strength: 'high',
    tick: 40,
    time_min: 20,
    proposal: proposalLogFor('karaoke_mode', 'prun_fire_b'),
    proposal_error: null,
  }
  return {
    fired: true,
    fire: { category: 'rest_required', strength: 'high', tick: 10, time_min: 5 },
    fires: [fireA, fireB],
    peak_score: 0.9,
    threshold: 0.7,
    score_series: [
      { t: 0, score: 0.1 },
      { t: 10, score: 0.8 },
      { t: 40, score: 0.85 },
    ],
    monotony_series: [],
    monotony_threshold: null,
    spikes: [],
    segments: [{ type: 'highway', from_min: 0, to_min: 30 }],
    rest_spot: null,
    rest_option: null,
    rest_spots: [],
    rest_options: [],
    completed_min: 30,
    seed: 42,
    overrides: [],
    error: null,
  }
}

/** A recovered rest option carrying an after-rest (resumed-drive) proposal —
 * `recovery_from_min`/`to_min` set so the timeline draws the purple/green
 * journey dots (and, with `onRestOptionClick` supplied, their hit-circles). */
function restOptionFixture(): MergedRestOption {
  return {
    id: 'auto_rest_0',
    auto_chosen: true,
    recovery_from_min: 12,
    to_min: 18,
    after_rest_proposal: proposalLogFor('humming_karaoke', 'prun_after_rest'),
    after_rest_proposal_error: null,
  }
}

function quickviewWithRestOptionFixture(): MergedInstantResult {
  const opt = restOptionFixture()
  return { ...quickviewResultFixture(), rest_option: opt, rest_options: [opt] }
}

/** Captures the real coordinator context, mirroring
 * `merged_center.test.tsx`'s `renderCenterPanel`. */
function renderCenterPanel() {
  const coordinatorRef: { current: ReturnType<typeof useMergedCoordinator> | null } = { current: null }

  function Capture() {
    coordinatorRef.current = useMergedCoordinator()
    return null
  }

  // Quickview click-to-inspect lives in the center; the inspected proposal
  // renders in the RIGHT panel (MergedProposalPanel). Both share the coordinator
  // and the center's <MapSurface/> needs a RunStoreProvider.
  render(
    <MergedCoordinatorProvider>
      <RunStoreProvider>
        <ProposalStoreProvider>
        <Capture />
        <MergedCenterPanel />
        <MergedProposalPanel />
        </ProposalStoreProvider>
      </RunStoreProvider>
    </MergedCoordinatorProvider>,
  )

  return coordinatorRef
}

describe('merged quickview projection strip + click-to-inspect (feature 020, Slice-2c Task 5)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('wires the Explanation-source selector (feature 019) to the shared proposal store', () => {
    renderCenterPanel()
    const select = screen.getByTestId('merged-explanation-provider-select') as HTMLSelectElement
    // Defaults to the deterministic template ('off').
    expect(select.value).toBe('off')
    // Changing it round-trips through the scoped proposal store (controlled value).
    act(() => {
      fireEvent.change(select, { target: { value: 'backend' } })
    })
    expect(select.value).toBe('backend')
  })

  it('renders clickable fire markers from quickviewResult; clicking fire #2 inspects it and docks its service overlay read-only', async () => {
    // A real merged run backs this test (`mergedRunId` set via `create()`)
    // so the READ-ONLY assertion below is load-bearing. Without this,
    // `selectService()` (mergedCoordinator.tsx) no-ops purely because
    // `mergedRunIdRef.current` is null — it returns before ever reaching
    // `mergedProposalAction`, regardless of whether `onChoose` is wired to
    // `noopChoose` or to the live `handleChoose` for the inspected-fire
    // branch. That made the original assertion pass even when the read-only
    // guard in MergedCenterPanel was (experimentally) removed — verified
    // during Slice-2c Task 5 review. Creating a real run first means a
    // regression that wires `handleChoose` unconditionally would actually
    // reach `mergedProposalAction` and fail this assertion.
    vi.mocked(createMergedRun).mockResolvedValue({
      merged_run_id: 'mrun_choose_guard',
      trigger_run_id: 'run_choose_guard',
    })
    vi.mocked(mergedQuickview).mockResolvedValue(quickviewResultFixture())

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
    expect(coordinatorRef.current!.state.mergedRunId).toBe('mrun_choose_guard')

    await act(async () => {
      await coordinatorRef.current!.quickview({
        package_id: 'nri_fatigue_score_v1',
        scenario_id: 'uc01_fatigue_recovery_v0_1',
        run_seed: 42,
        world: {} as never,
        service_package_id: 'mock_service_selector_v1',
        content_package_id: 'mock_content_selector_v1',
        run_seed_proposal: '42',
      })
    })

    expect(mergedQuickview).toHaveBeenCalledTimes(1)
    expect(coordinatorRef.current!.state.quickviewResult?.fires).toHaveLength(2)

    // Projection strip renders with 2 clickable fire hit-rects — nothing
    // inspected yet, so the dock is empty.
    expect(screen.getByTestId('quickview-strip')).toBeInTheDocument()
    expect(screen.getByTestId('quickview-fire-hit-0')).toBeInTheDocument()
    expect(screen.getByTestId('quickview-fire-hit-1')).toBeInTheDocument()
    expect(screen.queryByTestId('service-result-overlay')).not.toBeInTheDocument()

    // Click fire #2 (index 1, zero-based) → inspectFire(1).
    await act(async () => {
      fireEvent.click(screen.getByTestId('quickview-fire-hit-1'))
    })

    expect(coordinatorRef.current!.state.inspectedFireIndex).toBe(1)
    expect(screen.getByTestId('inspected-fire-readonly-badge')).toBeInTheDocument()

    // Dock shows FIRE #2's service overlay (karaoke_mode), not fire #1's.
    expect(screen.getByTestId('service-result-overlay')).toBeInTheDocument()
    expect(screen.getByTestId('candidate-card-karaoke_mode')).toBeInTheDocument()
    expect(screen.queryByTestId('candidate-card-music_playlist')).not.toBeInTheDocument()

    // READ-ONLY: clicking Choose on the inspected (ephemeral) overlay must
    // never call the live selectService action. Load-bearing because a real
    // run backs this test (`mergedRunId` set above) — `selectService()`
    // would actually reach `mergedProposalAction` if `onChoose` weren't
    // wired to `noopChoose` for the inspected-fire branch.
    fireEvent.click(screen.getByTestId('choose-candidate-karaoke_mode'))
    expect(mergedProposalAction).not.toHaveBeenCalled()

    // Closing the inspection reverts the dock to empty (no live proposalLog
    // exists in this test — only the quickview projection was ever run).
    fireEvent.click(screen.getByTestId('quickview-inspect-close'))
    expect(coordinatorRef.current!.state.inspectedFireIndex).toBeNull()
    expect(screen.queryByTestId('service-result-overlay')).not.toBeInTheDocument()
    expect(screen.queryByTestId('inspected-fire-readonly-badge')).not.toBeInTheDocument()
  })

  it('inspecting fire #1 then fire #2 swaps the dock between the two ephemeral proposals', async () => {
    vi.mocked(mergedQuickview).mockResolvedValue(quickviewResultFixture())

    const coordinatorRef = renderCenterPanel()

    await act(async () => {
      await coordinatorRef.current!.quickview({
        package_id: 'nri_fatigue_score_v1',
        scenario_id: 'uc01_fatigue_recovery_v0_1',
        run_seed: 42,
        world: {} as never,
        service_package_id: 'mock_service_selector_v1',
        content_package_id: 'mock_content_selector_v1',
        run_seed_proposal: '42',
      })
    })

    await act(async () => {
      fireEvent.click(screen.getByTestId('quickview-fire-hit-0'))
    })
    expect(screen.getByTestId('candidate-card-music_playlist')).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByTestId('quickview-fire-hit-1'))
    })
    expect(screen.queryByTestId('candidate-card-music_playlist')).not.toBeInTheDocument()
    expect(screen.getByTestId('candidate-card-karaoke_mode')).toBeInTheDocument()
  })

  it('renders the clickable purple after-nap dot; clicking it inspects the rest\'s after_rest_proposal read-only, mutually exclusive with fire inspection', async () => {
    vi.mocked(mergedQuickview).mockResolvedValue(quickviewWithRestOptionFixture())

    const coordinatorRef = renderCenterPanel()

    await act(async () => {
      await coordinatorRef.current!.quickview({
        package_id: 'nri_fatigue_score_v1',
        scenario_id: 'uc01_fatigue_recovery_v0_1',
        run_seed: 42,
        world: {} as never,
        service_package_id: 'mock_service_selector_v1',
        content_package_id: 'mock_content_selector_v1',
        run_seed_proposal: '42',
      })
    })

    expect(coordinatorRef.current!.state.quickviewResult?.rest_options).toHaveLength(1)

    // The purple "after-nap" dot renders a clickable hit-circle; nothing
    // inspected yet.
    expect(screen.getByTestId('quickview-rest-hit-0')).toBeInTheDocument()
    expect(screen.queryByTestId('service-result-overlay')).not.toBeInTheDocument()

    // Inspect a fire FIRST, then click the journey dot — the rest inspection
    // must clear the fire inspection (mutually exclusive).
    await act(async () => {
      fireEvent.click(screen.getByTestId('quickview-fire-hit-0'))
    })
    expect(coordinatorRef.current!.state.inspectedFireIndex).toBe(0)

    await act(async () => {
      fireEvent.click(screen.getByTestId('quickview-rest-hit-0'))
    })

    expect(coordinatorRef.current!.state.inspectedRestOptionIndex).toBe(0)
    expect(coordinatorRef.current!.state.inspectedFireIndex).toBeNull()
    expect(screen.getByTestId('inspected-fire-readonly-badge')).toBeInTheDocument()

    // Dock shows the AFTER-REST proposal's service candidate (humming_karaoke),
    // not either fire's candidate.
    expect(screen.getByTestId('candidate-card-humming_karaoke')).toBeInTheDocument()
    expect(screen.queryByTestId('candidate-card-music_playlist')).not.toBeInTheDocument()
    expect(screen.queryByTestId('candidate-card-karaoke_mode')).not.toBeInTheDocument()

    // The after-nap Choose is interactive (dispatches an after-rest re-projection,
    // NOT the live select-service action) — but this fixture's proposal carries no
    // recovered `world`, so the guard makes it a no-op here: neither the live action
    // nor the re-projection endpoint is called.
    fireEvent.click(screen.getByTestId('choose-candidate-humming_karaoke'))
    expect(mergedProposalAction).not.toHaveBeenCalled()
    expect(afterRestProposal).not.toHaveBeenCalled()

    // Close reverts (the shared Close button clears BOTH inspection kinds).
    fireEvent.click(screen.getByTestId('quickview-inspect-close'))
    expect(coordinatorRef.current!.state.inspectedRestOptionIndex).toBeNull()
    expect(screen.queryByTestId('service-result-overlay')).not.toBeInTheDocument()
  })

  it('after-nap Choose re-projects the chosen service content (interactive) and swaps in its proposal', async () => {
    // An after-nap proposal carrying the recovered `world` (so the interactive
    // Choose's guard passes) + a content-capable service candidate (full_karaoke).
    const afterNap = proposalLogFor('full_karaoke', 'prun_afternap')
    ;(afterNap as unknown as { world: unknown }).world = { control_inputs: { motion_state: 'stopped' } }
    const restOpt = {
      id: 'r',
      auto_chosen: true,
      recovery_from_min: 12,
      to_min: 18,
      after_rest_proposal: afterNap,
      after_rest_proposal_error: null,
    } as unknown as MergedRestOption
    vi.mocked(mergedQuickview).mockResolvedValue({
      ...quickviewResultFixture(),
      rest_option: restOpt,
      rest_options: [restOpt],
    })
    // The re-projection endpoint returns a FRESH proposal (full_karaoke + content).
    const reprojected = proposalLogFor('full_karaoke', 'prun_afternap_content')
    vi.mocked(afterRestProposal).mockResolvedValue(reprojected)

    const coordinatorRef = renderCenterPanel()
    await act(async () => {
      await coordinatorRef.current!.quickview({
        package_id: 'nri_fatigue_score_v1',
        scenario_id: 'uc01_fatigue_recovery_v0_1',
        run_seed: 42,
        world: {} as never,
        service_package_id: 'mock_service_selector_v1',
        content_package_id: 'mock_content_selector_v1',
        run_seed_proposal: '42',
      })
    })

    await act(async () => {
      fireEvent.click(screen.getByTestId('quickview-rest-hit-0'))
    })
    expect(screen.getByTestId('candidate-card-full_karaoke')).toBeInTheDocument()

    // Choose full_karaoke → the interactive after-rest re-projection (NOT the live
    // select-service action).
    await act(async () => {
      fireEvent.click(screen.getByTestId('choose-candidate-full_karaoke'))
    })

    expect(mergedProposalAction).not.toHaveBeenCalled()
    expect(afterRestProposal).toHaveBeenCalledTimes(1)
    const arg = vi.mocked(afterRestProposal).mock.calls[0][0]
    expect(arg.selected_service_id).toBe('full_karaoke')
    expect(arg.world).toEqual({ control_inputs: { motion_state: 'stopped' } })
    // The re-projected proposal swaps in (run_id proves it replaced the default).
    expect(coordinatorRef.current!.state.afterRestOverride?.run_id).toBe('prun_afternap_content')
  })

  it('keeps the projection strip visible while the live tick loop is running (persistent — owner review)', async () => {
    vi.mocked(createMergedRun).mockResolvedValue({ merged_run_id: 'mrun_qv', trigger_run_id: 'run_qv' })
    // A pending (never-resolving, until we say so) tick keeps `state.running`
    // true for the whole assertion window — mirrors merged_center.test.tsx's
    // "disables the Choose button while selectService is in flight" pattern.
    let resolveTick: (response: MergedTickResponse) => void = () => {}
    const pendingTick = new Promise<MergedTickResponse>((resolve) => {
      resolveTick = resolve
    })
    vi.mocked(tickMergedRun).mockReturnValue(pendingTick)
    vi.mocked(mergedQuickview).mockResolvedValue(quickviewResultFixture())

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
      await coordinatorRef.current!.quickview({
        package_id: 'nri_fatigue_score_v1',
        scenario_id: 'uc01_fatigue_recovery_v0_1',
        run_seed: 42,
        world: {} as never,
        service_package_id: 'mock_service_selector_v1',
        content_package_id: 'mock_content_selector_v1',
        run_seed_proposal: '42',
      })
    })
    expect(screen.getByTestId('quickview-strip')).toBeInTheDocument()

    act(() => {
      fireEvent.click(screen.getByTestId('merged-play-button'))
    })

    // The quickview projection is a SEPARATE, persistent component from the
    // live animation (owner review) — playback must NOT hide it.
    expect(coordinatorRef.current!.state.running).toBe(true)
    expect(screen.getByTestId('quickview-strip')).toBeInTheDocument()

    // Clean up the still-in-flight tick so nothing dangles past the test.
    await act(async () => {
      resolveTick({
        trigger: {
          decision: null,
          error: null,
          paused: false,
          completed: true,
          tick_index: null,
          route_fraction: 1,
          distance_km: null,
          speed_kph: 0,
          motion_state: 'STOPPED',
          recovery_phase: null,
          is_traffic_jam: false,
          segment_type: null,
        },
        proposal: null,
        correlation: null,
      })
    })
  })
})
