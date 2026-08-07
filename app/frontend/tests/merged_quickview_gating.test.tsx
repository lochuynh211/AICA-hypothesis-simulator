/**
 * merged_quickview_gating.test.tsx (fixbug-0806) — the Combined screen's
 * recompute-collision fix:
 *   - coordinator.quickview() sets state.quickviewPending true while in
 *     flight and clears it when it settles;
 *   - two overlapping quickview() calls: only the LATEST response is applied
 *     to state.quickviewResult (an older, slower response is dropped);
 *   - MergedSetupPanel suppresses the auto-quickview while an Edit popup is
 *     open, and fires exactly one on close;
 *   - the BusyOverlay blocks the screen while quickviewPending is true.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor, render, screen } from '@testing-library/react'
import React from 'react'
import { MergedCoordinatorProvider, useMergedCoordinator } from '../src/state/mergedCoordinator'
import type { MergedInstantResult } from '../src/api/mergedClient'
import BusyOverlay from '../src/components/merged/BusyOverlay'
import { LanguageProvider } from '../src/state/language'

vi.mock('../src/api/mergedClient', () => ({
  createMergedRun: vi.fn(),
  tickMergedRun: vi.fn(),
  mergedProposalAction: vi.fn(),
  mergedQuickview: vi.fn(),
  afterRestProposal: vi.fn(),
}))

import { mergedQuickview } from '../src/api/mergedClient'

function resultWithSeed(seed: number): MergedInstantResult {
  return {
    fired: false, fire: null, fires: [], peak_score: 0, threshold: 0,
    score_series: [], monotony_series: [], monotony_threshold: null, spikes: [],
    segments: [], rest_spot: null, rest_option: null, rest_spots: [], rest_options: [],
    completed_min: 0, seed, overrides: [], error: null,
  } as unknown as MergedInstantResult
}

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <MergedCoordinatorProvider>{children}</MergedCoordinatorProvider>
)

const qvBody = {
  package_id: 'p', scenario_id: 's', run_seed: 1, world: {} as never,
  service_package_id: 'svc', content_package_id: 'cnt', run_seed_proposal: '1',
} as never

describe('mergedCoordinator quickview gating (fixbug-0806)', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('sets quickviewPending while in flight and clears it when settled', async () => {
    let resolve: (r: MergedInstantResult) => void = () => {}
    vi.mocked(mergedQuickview).mockReturnValue(
      new Promise<MergedInstantResult>((r) => { resolve = r }),
    )
    const { result } = renderHook(() => useMergedCoordinator(), { wrapper })

    let pending: Promise<void>
    act(() => { pending = result.current.quickview(qvBody) })
    await waitFor(() => expect(result.current.state.quickviewPending).toBe(true))

    await act(async () => { resolve(resultWithSeed(1)); await pending })
    expect(result.current.state.quickviewPending).toBe(false)
    expect(result.current.state.quickviewResult?.seed).toBe(1)
  })

  it('drops a stale (older) response when a newer quickview started', async () => {
    // First call resolves LAST; second call resolves FIRST. The newest call
    // (second) must own the result — the first response is dropped.
    let resolveFirst: (r: MergedInstantResult) => void = () => {}
    let resolveSecond: (r: MergedInstantResult) => void = () => {}
    vi.mocked(mergedQuickview)
      .mockReturnValueOnce(new Promise<MergedInstantResult>((r) => { resolveFirst = r }))
      .mockReturnValueOnce(new Promise<MergedInstantResult>((r) => { resolveSecond = r }))

    const { result } = renderHook(() => useMergedCoordinator(), { wrapper })

    let firstCall: Promise<void>
    let secondCall: Promise<void>
    act(() => { firstCall = result.current.quickview(qvBody) })
    act(() => { secondCall = result.current.quickview(qvBody) })

    // Newer (second) resolves first and wins.
    await act(async () => { resolveSecond(resultWithSeed(2)); await secondCall })
    expect(result.current.state.quickviewResult?.seed).toBe(2)

    // Older (first) resolves late and is DROPPED — result stays seed 2,
    // and pending stays false (the newest call already cleared it).
    await act(async () => { resolveFirst(resultWithSeed(1)); await firstCall })
    expect(result.current.state.quickviewResult?.seed).toBe(2)
    expect(result.current.state.quickviewPending).toBe(false)
  })
})

describe('BusyOverlay (fixbug-0806)', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('renders nothing when no quickview is pending', () => {
    render(
      <LanguageProvider initialLanguage="en">
        <MergedCoordinatorProvider>
          <BusyOverlay />
        </MergedCoordinatorProvider>
      </LanguageProvider>,
    )
    expect(screen.queryByTestId('merged-busy-overlay')).toBeNull()
  })

  it('renders the blocking overlay while a quickview is in flight', async () => {
    let resolve: (r: MergedInstantResult) => void = () => {}
    vi.mocked(mergedQuickview).mockReturnValue(
      new Promise<MergedInstantResult>((r) => { resolve = r }),
    )
    const coordinatorRef: { current: ReturnType<typeof useMergedCoordinator> | null } = { current: null }
    function Capture() { coordinatorRef.current = useMergedCoordinator(); return null }

    render(
      <LanguageProvider initialLanguage="en">
        <MergedCoordinatorProvider>
          <Capture />
          <BusyOverlay />
        </MergedCoordinatorProvider>
      </LanguageProvider>,
    )

    let pending: Promise<void>
    act(() => { pending = coordinatorRef.current!.quickview(qvBody) })
    await waitFor(() => expect(screen.getByTestId('merged-busy-overlay')).toBeInTheDocument())

    await act(async () => { resolve(resultWithSeed(1)); await pending })
    expect(screen.queryByTestId('merged-busy-overlay')).toBeNull()
  })
})
