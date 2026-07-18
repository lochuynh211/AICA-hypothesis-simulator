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
import type { MergedInstantResult, MergedFirePoint, MergedTickResponse } from '../src/api/mergedClient'
import type { ProposalRunLog, AlgorithmEvidence } from '../src/api/proposalClient'
import MergedCenterPanel from '../src/components/merged/MergedCenterPanel'

vi.mock('../src/api/mergedClient', () => ({
  createMergedRun: vi.fn(),
  tickMergedRun: vi.fn(),
  mergedProposalAction: vi.fn(),
  mergedQuickview: vi.fn(),
}))

import { createMergedRun, tickMergedRun, mergedQuickview, mergedProposalAction } from '../src/api/mergedClient'

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

/** Captures the real coordinator context, mirroring
 * `merged_center.test.tsx`'s `renderCenterPanel`. */
function renderCenterPanel() {
  const coordinatorRef: { current: ReturnType<typeof useMergedCoordinator> | null } = { current: null }

  function Capture() {
    coordinatorRef.current = useMergedCoordinator()
    return null
  }

  render(
    <MergedCoordinatorProvider>
      <Capture />
      <MergedCenterPanel />
    </MergedCoordinatorProvider>,
  )

  return coordinatorRef
}

describe('merged quickview projection strip + click-to-inspect (feature 020, Slice-2c Task 5)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('renders clickable fire markers from quickviewResult; clicking fire #2 inspects it and docks its service overlay read-only', async () => {
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
    // never call the live selectService action.
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

  it('does not render the projection strip while the live tick loop is running', async () => {
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

    expect(coordinatorRef.current!.state.running).toBe(true)
    expect(screen.queryByTestId('quickview-strip')).not.toBeInTheDocument()

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
