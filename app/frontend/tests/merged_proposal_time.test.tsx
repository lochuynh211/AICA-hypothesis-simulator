/**
 * merged_proposal_time.test.tsx — the timing block under the Proposal-category
 * strip (Combined screen). Verifies: overall driving route duration + per-event
 * when/arrive-in render from quickviewResult in pure quickview; the reached
 * marker reflects the live tick once an animation run advances; and a zero-fire
 * control case still shows the neutral route line (no false proposal category).
 */
import { render, screen, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MergedCoordinatorProvider, useMergedCoordinator } from '../src/state/mergedCoordinator'
import { LanguageProvider } from '../src/state/language'
import { RunStoreProvider } from '../src/state/runStore'
import { ProposalStoreProvider } from '../src/state/proposalStore'
import { ReviewStoreProvider } from '../src/state/reviewStore'
import type { MergedInstantResult, MergedTickResponse } from '../src/api/mergedClient'
import MergedCenterPanel from '../src/components/merged/MergedCenterPanel'

vi.mock('../src/api/mergedClient', () => ({
  createMergedRun: vi.fn(),
  tickMergedRun: vi.fn(),
  mergedProposalAction: vi.fn(),
  mergedQuickview: vi.fn(),
  afterRestProposal: vi.fn(),
}))

import { createMergedRun, tickMergedRun, mergedQuickview } from '../src/api/mergedClient'

function baseResult(partial: Partial<MergedInstantResult>): MergedInstantResult {
  return {
    fired: true, fire: null, fires: [], peak_score: 0, threshold: null,
    score_series: [], progress: [], monotony_series: [], monotony_threshold: null,
    spikes: [], segments: [], traffic_jams: [], rest_spot: null, rest_option: null,
    rest_spots: [], rest_options: [], completed_min: null, seed: 42, overrides: [],
    error: null, ...partial,
  } as MergedInstantResult
}

// Two fires (monotony @tick20/40min, safety @tick80/240min), route D = 300.
function firesFixture(): MergedInstantResult {
  return baseResult({
    completed_min: 300,
    fires: [
      { category: 'monotony_prevention', strength: 'high', tick: 20, time_min: 40, proposal: null, proposal_error: null } as never,
      { category: 'rest_required', strength: 'high', tick: 80, time_min: 240, proposal: null, proposal_error: null } as never,
    ],
  })
}

function controlFixture(): MergedInstantResult {
  return baseResult({ completed_min: 300, fires: [], rest_options: [] })
}

function renderCenter(lang: 'ja' | 'en' = 'en') {
  const ref: { current: ReturnType<typeof useMergedCoordinator> | null } = { current: null }
  function Capture() {
    ref.current = useMergedCoordinator()
    return null
  }
  render(
    <LanguageProvider initialLanguage={lang}>
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
  return ref
}

const QUICKVIEW_ARGS = {
  package_id: 'nri_fatigue_score_v1',
  scenario_id: 'uc01_fatigue_recovery_v0_1',
  run_seed: 42,
  world: {} as never,
  service_package_id: 'mock_service_selector_v1',
  content_package_id: 'mock_content_selector_v1',
  run_seed_proposal: '42',
}

describe('Combined-screen timing block', () => {
  beforeEach(() => vi.resetAllMocks())

  it('shows overall route duration and per-event arrive-in in pure quickview', async () => {
    vi.mocked(mergedQuickview).mockResolvedValue(firesFixture())
    const ref = renderCenter('en')
    await act(async () => { await ref.current!.quickview(QUICKVIEW_ARGS) })

    expect((await screen.findByTestId('merged-route-duration')).textContent).toContain('5h')
    const first = screen.getByTestId('merged-timing-event-0')
    expect(first.textContent).toContain('40m')       // when: 40 min
    expect(first.textContent).toContain('4h 20m')     // arrive in: 300 − 40 = 260
    // Pure quickview → nothing is marked reached.
    expect(first.getAttribute('data-reached')).toBe('false')
  })

  it('marks reached events once a live run advances past their tick', async () => {
    vi.mocked(mergedQuickview).mockResolvedValue(firesFixture())
    vi.mocked(createMergedRun).mockResolvedValue({ merged_run_id: 'mrun_t', trigger_run_id: 'run_t' })
    // A fired tick at tick_index 30 — past fire#0 (tick 20), before fire#1 (tick 80).
    const tick: MergedTickResponse = {
      trigger: {
        decision: null, error: null, paused: false, completed: false,
        tick_index: 30, route_fraction: 0.3, distance_km: null, speed_kph: 60,
        motion_state: 'MOVING', recovery_phase: null, is_traffic_jam: false, segment_type: 'highway',
      } as never,
      proposal: null,
      correlation: null,
    }
    vi.mocked(tickMergedRun).mockResolvedValue(tick)

    const ref = renderCenter('en')
    await act(async () => { await ref.current!.quickview(QUICKVIEW_ARGS) })
    await act(async () => {
      await ref.current!.create({
        trigger_plan_id: 'plan_1', world: {} as never,
        service_package_id: 'mock_service_selector_v1',
        content_package_id: 'mock_content_selector_v1', run_seed: '7',
      })
    })
    await act(async () => { await ref.current!.step() })

    expect(screen.getByTestId('merged-timing-event-0').getAttribute('data-reached')).toBe('true')
    expect(screen.getByTestId('merged-timing-event-1').getAttribute('data-reached')).toBe('false')
  })

  it('shows the neutral route line for a zero-fire control case (no status strip)', async () => {
    vi.mocked(mergedQuickview).mockResolvedValue(controlFixture())
    const ref = renderCenter('en')
    await act(async () => { await ref.current!.quickview(QUICKVIEW_ARGS) })

    expect(screen.getByTestId('merged-route-duration').textContent).toContain('5h')
    expect(screen.getByTestId('merged-timing-no-triggers')).toBeInTheDocument()
    // The control case must NOT announce a proposal category.
    expect(screen.queryByTestId('merged-status-strip')).toBeNull()
  })
})
