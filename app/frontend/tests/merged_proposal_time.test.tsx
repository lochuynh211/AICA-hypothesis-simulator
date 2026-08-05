/**
 * merged_proposal_time.test.tsx — the timing line under the 提案分類 strip
 * (Combined screen), redesigned. Verifies: sub-line 1 (route duration + a
 * view-events button); sub-line 2 (the single active trigger) follows the
 * default fire, an explicit click, and the live tick; the quickview-only popup;
 * and the zero-fire control case (route line only, no status strip).
 */
import { render, screen, act, fireEvent } from '@testing-library/react'
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

function tickAt(tickIndex: number): MergedTickResponse {
  return {
    trigger: {
      decision: null, error: null, paused: false, completed: false,
      tick_index: tickIndex, route_fraction: 0.3, distance_km: null, speed_kph: 60,
      motion_state: 'MOVING', recovery_phase: null, is_traffic_jam: false, segment_type: 'highway',
    } as never,
    proposal: null,
    correlation: null,
  }
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

const CREATE_ARGS = {
  trigger_plan_id: 'plan_1', world: {} as never,
  service_package_id: 'mock_service_selector_v1',
  content_package_id: 'mock_content_selector_v1', run_seed: '7',
}

describe('Combined-screen timing line', () => {
  beforeEach(() => vi.resetAllMocks())

  it('shows route duration, a view-events button, and the default fire on sub-line 2 (quickview)', async () => {
    vi.mocked(mergedQuickview).mockResolvedValue(firesFixture())
    const ref = renderCenter('en')
    await act(async () => { await ref.current!.quickview(QUICKVIEW_ARGS) })

    expect((await screen.findByTestId('merged-route-duration')).textContent).toContain('5h')
    expect(screen.getByTestId('merged-view-events-button')).toBeInTheDocument()
    // Default = fire#0 (monotony @40m); arrive-in = 300 − 40 = 260 = 4h 20m.
    const active = screen.getByTestId('merged-active-event')
    expect(active.textContent).toContain('40m')
    expect(active.textContent).toContain('4h 20m')
  })

  it('sub-line 2 follows an explicit trigger click and clears on re-click', async () => {
    vi.mocked(mergedQuickview).mockResolvedValue(firesFixture())
    const ref = renderCenter('en')
    await act(async () => { await ref.current!.quickview(QUICKVIEW_ARGS) })
    // Click fire#1 (safety @240m = 4h); arrive-in = 300 − 240 = 60 = 1h.
    await act(async () => { ref.current!.inspectFire(1) })
    const active = screen.getByTestId('merged-active-event')
    expect(active.textContent).toContain('4h')
    expect(active.textContent).toContain('1h')
    // Re-click (toggle off) → back to the default fire#0 (@40m).
    await act(async () => { ref.current!.inspectFire(null) })
    expect(screen.getByTestId('merged-active-event').textContent).toContain('40m')
  })

  it('during a live run shows nothing on sub-line 2 before the first trigger is passed', async () => {
    vi.mocked(mergedQuickview).mockResolvedValue(firesFixture())
    vi.mocked(createMergedRun).mockResolvedValue({ merged_run_id: 'mrun_t', trigger_run_id: 'run_t' })
    vi.mocked(tickMergedRun).mockResolvedValue(tickAt(5)) // before fire#0 (tick 20)
    const ref = renderCenter('en')
    await act(async () => { await ref.current!.quickview(QUICKVIEW_ARGS) })
    await act(async () => { await ref.current!.create(CREATE_ARGS) })
    await act(async () => { await ref.current!.step() })

    expect(screen.getByTestId('merged-route-duration')).toBeInTheDocument()
    expect(screen.queryByTestId('merged-active-event')).toBeNull()
  })

  it('during a live run sub-line 2 shows the latest passed trigger', async () => {
    vi.mocked(mergedQuickview).mockResolvedValue(firesFixture())
    vi.mocked(createMergedRun).mockResolvedValue({ merged_run_id: 'mrun_t', trigger_run_id: 'run_t' })
    vi.mocked(tickMergedRun).mockResolvedValue(tickAt(30)) // past fire#0 (tick 20), before fire#1 (tick 80)
    const ref = renderCenter('en')
    await act(async () => { await ref.current!.quickview(QUICKVIEW_ARGS) })
    await act(async () => { await ref.current!.create(CREATE_ARGS) })
    await act(async () => { await ref.current!.step() })

    // latest passed trigger = fire#0 (@40m)
    expect(screen.getByTestId('merged-active-event').textContent).toContain('40m')
  })

  it('opens a quickview-only popup listing every event with 提案分類 vocabulary (JA)', async () => {
    vi.mocked(mergedQuickview).mockResolvedValue(firesFixture())
    const ref = renderCenter('ja')
    await act(async () => { await ref.current!.quickview(QUICKVIEW_ARGS) })
    fireEvent.click(screen.getByTestId('merged-view-events-button'))

    const modal = await screen.findByTestId('events-list-modal')
    expect(screen.getByTestId('events-list-row-0').textContent).toContain('漫然運転予防のためサービス提案')
    expect(screen.getByTestId('events-list-row-1').textContent).toContain('危険運転防止のため休憩推奨')
    expect(modal.textContent).not.toContain('✓') // no reached-marker in the popup
  })

  it('control (zero-fire) case: route line only — no button, no sub-line 2, no status strip', async () => {
    vi.mocked(mergedQuickview).mockResolvedValue(controlFixture())
    const ref = renderCenter('en')
    await act(async () => { await ref.current!.quickview(QUICKVIEW_ARGS) })

    expect(screen.getByTestId('merged-route-duration').textContent).toContain('5h')
    expect(screen.queryByTestId('merged-view-events-button')).toBeNull()
    expect(screen.queryByTestId('merged-active-event')).toBeNull()
    expect(screen.queryByTestId('merged-status-strip')).toBeNull()
  })
})
