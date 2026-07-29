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
import { LanguageProvider } from '../src/state/language'
import { RunStoreProvider } from '../src/state/runStore'
import { ProposalStoreProvider } from '../src/state/proposalStore'
import { ReviewStoreProvider } from '../src/state/reviewStore'
import type { MergedInstantResult, MergedFirePoint, MergedRestOption, MergedTickResponse } from '../src/api/mergedClient'
import type { ProposalRunLog, AlgorithmEvidence } from '../src/api/proposalClient'
import MergedCenterPanel from '../src/components/merged/MergedCenterPanel'

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

  // Quickview click-to-inspect lives in the center; MergedCenterPanel renders
  // MergedProposalPanel itself now (task-17-brief, as a sibling of the
  // animated playback subtree), so there's no separate mount. Both still
  // share the coordinator; the center's <MapSurface/> needs a
  // RunStoreProvider, and the checkpoint rail/decision band it also renders
  // need a ReviewStoreProvider.
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

describe('merged quickview projection strip + click-to-inspect (feature 020, Slice-2c Task 5)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
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

    // Projection strip renders with 2 clickable fire hit-rects. The dock is NOT
    // empty: with no live run and nothing explicitly inspected, the panel now
    // defaults to the FIRST projected fire so a result is visible immediately
    // (owner review).
    expect(screen.getByTestId('quickview-strip')).toBeInTheDocument()
    expect(screen.getByTestId('quickview-fire-hit-0')).toBeInTheDocument()
    expect(screen.getByTestId('quickview-fire-hit-1')).toBeInTheDocument()
    expect(screen.getByTestId('service-result-overlay')).toBeInTheDocument()

    // Click fire #2 (index 1, zero-based) → inspectFire(1).
    await act(async () => {
      fireEvent.click(screen.getByTestId('quickview-fire-hit-1'))
    })

    expect(coordinatorRef.current!.state.inspectedFireIndex).toBe(1)
    // The "Inspecting a quickview fire" badge was removed (owner review); the
    // dock switching to fire #2's evidence below is what proves the click
    // landed, and it is the thing a reviewer actually looks at.
    expect(screen.queryByTestId('inspected-fire-readonly-badge')).toBeNull()

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

    // Closing clears the EXPLICIT inspection. The dedicated Close button went
    // with the badge (owner review) — clicking the SELECTED fire again is the
    // toggle, on both the strip and the map. The dock does not go empty: it
    // falls back to the default first-fire projection, so a result stays on
    // screen.
    await act(async () => {
      fireEvent.click(screen.getByTestId('quickview-fire-hit-1'))
    })
    expect(coordinatorRef.current!.state.inspectedFireIndex).toBeNull()
    expect(screen.getByTestId('service-result-overlay')).toBeInTheDocument()
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

  it('renders the after-nap dots but does NOT make them clickable', async () => {
    // After-rest status is no longer reviewable (owner review). The dots stay —
    // where the driver stops is journey context worth seeing — but ScoreTimeline
    // only renders hit-rects when an onRestOptionClick handler is supplied, and
    // the centre panel deliberately no longer supplies one.
    //
    // The coordinator's after-rest projection itself is untouched; only this UI
    // affordance is gone. Removing the handler is what makes them inert, so a
    // reappearing hit-rect here means the handler was wired back by accident.
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

    expect(screen.getByTestId('quickview-strip')).toBeInTheDocument()
    // Fire hit-rects DO render for this same fixture — so hit areas are working
    // in general, and the absence below is specifically about the rest dots
    // rather than about nothing having rendered at all.
    expect(screen.getByTestId('quickview-fire-hit-0')).toBeInTheDocument()
    expect(screen.queryByTestId('quickview-rest-hit-0')).not.toBeInTheDocument()
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
