/**
 * merged_live_chart.test.tsx — the LIVE driver-signal chart stacked under the
 * Combined screen's projection strip.
 *
 * The projection (`mergedInstantResultToTimeline`) draws what the run WOULD do
 * under auto-accept. This chart draws the SAME quantities from the ticks that
 * actually ran, so the driver-state band shows how the driver responded to the
 * proposals the reviewer answered. Covered here:
 *   - `mergedLiveTimeline` (pure): curves + driver signals on the route-fraction
 *     axis, fires at the rising edge of a paused proposal, accepted rest dots,
 *     thresholds from the latest tick, borrowed road/jam background.
 *   - `MergedCenterPanel`: nothing before a run; the chart appears once the
 *     animation starts, its drowsiness curve carries the ticks' values, and it
 *     reveals only as far as the car has driven.
 */
import { render, screen, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mergedLiveTimeline } from '../src/components/playback/mergedLiveTimeline'
import { MergedCoordinatorProvider, useMergedCoordinator } from '../src/state/mergedCoordinator'
import { LanguageProvider } from '../src/state/language'
import { RunStoreProvider } from '../src/state/runStore'
import { ProposalStoreProvider } from '../src/state/proposalStore'
import { ReviewStoreProvider } from '../src/state/reviewStore'
import MergedCenterPanel from '../src/components/merged/MergedCenterPanel'
import type { DecisionResult, TraceEntry } from '../src/api/types'
import type { MergedTickResponse } from '../src/api/mergedClient'

vi.mock('../src/api/mergedClient', () => ({
  createMergedRun: vi.fn(),
  tickMergedRun: vi.fn(),
  mergedProposalAction: vi.fn(),
  mergedQuickview: vi.fn(),
  afterRestProposal: vi.fn(),
  declineRest: vi.fn(),
}))

import { createMergedRun, tickMergedRun, mergedQuickview } from '../src/api/mergedClient'
import type { MergedInstantResult } from '../src/api/mergedClient'

// ── fixtures ────────────────────────────────────────────────────────────────

const fireControl = { fired: false, suppressed: false, override: false, reason: null }

const baseDecision: DecisionResult = {
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

function traceEntry(over: Partial<TraceEntry> & { tick_index: number }): TraceEntry {
  return { ...baseDecision, route_fraction: 0, ...over }
}

/** A quiet driving tick: a rest score below threshold, rising driver signals. */
function drivingTick(tick: number, frac: number, rest: number, drowsy: number): TraceEntry {
  return traceEntry({
    tick_index: tick,
    route_fraction: frac,
    scores: { rest_required_score: rest, monotony_prevention_score: rest / 2 },
    criteria: { rest_required_threshold: 0.7, monotony_suggest_threshold: 0.6 },
    drowsiness: drowsy,
    fatigue: drowsy / 2,
    monotony_level: 40,
  })
}

// ── mergedLiveTimeline (pure) ───────────────────────────────────────────────

describe('mergedLiveTimeline', () => {
  it('plots score + driver-signal curves on the route-fraction axis', () => {
    const data = mergedLiveTimeline({
      trace: [drivingTick(0, 0, 0.1, 20), drivingTick(1, 0.5, 0.4, 55)],
      restSpots: [],
      completed: false,
    })

    expect(data.restScore).toEqual([{ x: 0, y: 0.1 }, { x: 0.5, y: 0.4 }])
    expect(data.monotonyScore).toEqual([{ x: 0, y: 0.05 }, { x: 0.5, y: 0.2 }])
    expect(data.driverSignals.drowsiness).toEqual([{ x: 0, y: 20 }, { x: 0.5, y: 55 }])
    expect(data.driverSignals.fatigue).toEqual([{ x: 0, y: 10 }, { x: 0.5, y: 27.5 }])
    expect(data.driverSignals.monotony).toEqual([{ x: 0, y: 40 }, { x: 0.5, y: 40 }])
  })

  it('draws a DROP in drowsiness when the driver actually recovered (what the projection cannot show)', () => {
    // The reviewer accepted a rest at x=0.5: the car is stopped (route fraction
    // flat) while drowsiness falls. This is the whole point of the live chart.
    const data = mergedLiveTimeline({
      trace: [
        drivingTick(0, 0.2, 0.3, 60),
        drivingTick(1, 0.5, 0.8, 85),
        drivingTick(2, 0.5, 0.4, 40),
        drivingTick(3, 0.5, 0.2, 15),
      ],
      restSpots: [],
      completed: false,
    })

    const ys = data.driverSignals.drowsiness.map((p) => p.y)
    expect(ys).toEqual([60, 85, 40, 15])
    expect(Math.max(...ys)).toBeGreaterThan(ys[ys.length - 1])
  })

  it('marks a fire at the RISING edge of a paused proposal only', () => {
    const paused = (tick: number, frac: number, category: string): TraceEntry =>
      traceEntry({
        tick_index: tick,
        route_fraction: frac,
        selected_category: category,
        proposal_paused: true,
        scores: { rest_required_score: 0.9 },
      })

    const data = mergedLiveTimeline({
      trace: [
        drivingTick(0, 0.1, 0.2, 30),
        paused(1, 0.3, 'rest_required'),
        // Still paused on the next tick — the SAME fire, not a second one.
        paused(2, 0.3, 'rest_required'),
        drivingTick(3, 0.4, 0.3, 35),
        paused(4, 0.8, 'monotony_prevention'),
      ],
      restSpots: [],
      completed: false,
    })

    expect(data.fires).toEqual([
      { x: 0.3, kind: 'rest' },
      { x: 0.8, kind: 'monotony' },
    ])
  })

  it('marks the rest spots the reviewer accepted, and the finish line only once completed', () => {
    const spot = {
      id: 'sa_1',
      label: { ja: 'SA', en: 'SA' },
      route_fraction: 0.62,
    }

    const running = mergedLiveTimeline({ trace: [], restSpots: [spot], completed: false })
    expect(running.restDots).toEqual([0.62])
    expect(running.completionX).toBeNull()

    const done = mergedLiveTimeline({ trace: [], restSpots: [spot], completed: true })
    expect(done.completionX).toBe(1)
  })

  it('takes thresholds from the LATEST tick and the road background from the projection', () => {
    const segments = [{ fromX: 0, toX: 0.5, type: 'highway' }, { fromX: 0.5, toX: 1, type: 'mountain_road' }]
    const trafficJams = [{ fromX: 0.2, toX: 0.3 }]

    const data = mergedLiveTimeline({
      trace: [
        traceEntry({ tick_index: 0, criteria: { rest_required_threshold: 0.5 } }),
        traceEntry({ tick_index: 1, criteria: { rest_required_threshold: 0.7, monotony_suggest_threshold: 0.6 } }),
      ],
      restSpots: [],
      completed: false,
      segments,
      trafficJams,
    })

    expect(data.restThreshold).toBe(0.7)
    expect(data.monotonyThreshold).toBe(0.6)
    expect(data.segments).toEqual(segments)
    expect(data.trafficJams).toEqual(trafficJams)
  })

  it('is empty-safe before the first tick', () => {
    const data = mergedLiveTimeline({ trace: [], restSpots: [], completed: false })
    expect(data.restScore).toEqual([])
    expect(data.driverSignals.drowsiness).toEqual([])
    expect(data.fires).toEqual([])
    expect(data.restThreshold).toBeNull()
  })
})

// ── MergedCenterPanel wiring ────────────────────────────────────────────────

function liveTickResponse(tickIndex: number, frac: number, drowsy: number): MergedTickResponse {
  return {
    trigger: {
      decision: {
        ...baseDecision,
        scores: { rest_required_score: 0.3 + frac },
        criteria: { rest_required_threshold: 0.7 },
      },
      error: null,
      paused: false,
      completed: false,
      tick_index: tickIndex,
      route_fraction: frac,
      distance_km: null,
      speed_kph: 80,
      motion_state: 'MOVING',
      recovery_phase: null,
      is_traffic_jam: false,
      segment_type: 'highway',
      drowsiness: drowsy,
      fatigue: drowsy / 2,
      monotony_level: 35,
    },
    proposal: null,
    correlation: null,
  }
}

/** Same tick, with an explicit rest score — for the shared-axis test. */
function scoredTickResponse(tickIndex: number, frac: number, score: number): MergedTickResponse {
  const base = liveTickResponse(tickIndex, frac, 30)
  return {
    ...base,
    trigger: {
      ...base.trigger,
      decision: { ...baseDecision, scores: { rest_required_score: score }, criteria: { rest_required_threshold: 0.7 } },
    },
  }
}

/** A projection whose score peaks at 0.8 — BELOW the live run above. */
function quickviewFixture(): MergedInstantResult {
  return {
    fired: false,
    fire: null,
    fires: [],
    peak_score: 0.8,
    threshold: 0.7,
    score_series: [{ t: 0, score: 0.1 }, { t: 10, score: 0.8 }],
    progress: [{ t: 0, min: 0, frac: 0 }, { t: 10, min: 30, frac: 1 }],
    monotony_series: [],
    monotony_threshold: null,
    // The backend always projects driver signals, so the projection carries the
    // same lower band the live chart does — the two charts' score bands only
    // line up when both are laid out the same way.
    signal_series: [
      { t: 0, drowsiness: 20, fatigue: 10, monotony: 30 },
      { t: 10, drowsiness: 70, fatigue: 40, monotony: 50 },
    ],
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
  } as unknown as MergedInstantResult
}

function renderCenterPanel() {
  const coordinatorRef: { current: ReturnType<typeof useMergedCoordinator> | null } = { current: null }

  function Capture() {
    coordinatorRef.current = useMergedCoordinator()
    return null
  }

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

describe('MergedCenterPanel live signal chart', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('is absent before the animation starts', () => {
    renderCenterPanel()
    expect(screen.queryByTestId('live-timeline')).toBeNull()
  })

  it('appears once the run starts and plots the ticks the driver actually drove', async () => {
    vi.mocked(createMergedRun).mockResolvedValue({ merged_run_id: 'mrun_live', trigger_run_id: 'run_live' })
    vi.mocked(tickMergedRun)
      .mockResolvedValueOnce(liveTickResponse(0, 0.1, 30))
      .mockResolvedValueOnce(liveTickResponse(1, 0.4, 65))

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

    expect(screen.getByTestId('live-timeline')).toBeInTheDocument()

    await act(async () => { await coordinatorRef.current!.step() })
    await act(async () => { await coordinatorRef.current!.step() })

    // The drowsiness curve carries BOTH ticks' values — the live chart is drawn
    // from the run, not from the projection.
    const drowsiness = screen.getByTestId('live-drowsiness')
    const points = drowsiness.getAttribute('points') ?? ''
    expect(points.split(' ')).toHaveLength(2)

    // …and a HIGHER drowsiness sits LOWER on screen (y grows downward), so the
    // curve reads as rising.
    const [y0, y1] = points.split(' ').map((p) => Number(p.split(',')[1]))
    expect(y1).toBeLessThan(y0)
  })

  it('draws both charts on ONE score axis, widened so a live score outside the projection is still visible', async () => {
    // The projection tops out at 0.8; the real run climbs to 1.3 (the driver
    // declined everything). A live curve drawn outside the shared band would be
    // clipped away by the SVG viewport — exactly where the run diverges most.
    vi.mocked(mergedQuickview).mockResolvedValue(quickviewFixture())
    vi.mocked(createMergedRun).mockResolvedValue({ merged_run_id: 'mrun_axis', trigger_run_id: 'run_axis' })
    vi.mocked(tickMergedRun).mockResolvedValueOnce(scoredTickResponse(0, 0.5, 1.3))

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
      await coordinatorRef.current!.create({
        trigger_plan_id: 'plan_1',
        world: {} as never,
        service_package_id: 'mock_service_selector_v1',
        content_package_id: 'mock_content_selector_v1',
        run_seed: '7',
      })
    })
    await act(async () => { await coordinatorRef.current!.step() })

    // Same threshold value, same y in both charts = one shared axis.
    const yOf = (el: Element | null) => Number((el?.getAttribute('y1') ?? '').trim())
    const projectionThreshold = screen.getByTestId('quickview-threshold').querySelector('line')
    const liveThreshold = screen.getByTestId('live-threshold').querySelector('line')
    expect(yOf(liveThreshold)).toBeCloseTo(yOf(projectionThreshold), 5)

    // …and the live point (1.3, above the projection's peak) is INSIDE the
    // chart, not clipped off its top edge.
    const liveCurve = screen.getByTestId('live-curve')
    const y = Number((liveCurve.getAttribute('points') ?? '').split(',')[1])
    expect(y).toBeGreaterThan(0)
  })

  it('reveals only as far as the car has driven — the playhead advances with it', async () => {
    vi.mocked(createMergedRun).mockResolvedValue({ merged_run_id: 'mrun_reveal', trigger_run_id: 'run_reveal' })
    vi.mocked(tickMergedRun)
      .mockResolvedValueOnce(liveTickResponse(0, 0.25, 30))
      .mockResolvedValueOnce(liveTickResponse(1, 0.6, 45))

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

    // Before any tick the car is at the start of the route.
    expect(parseFloat(screen.getByTestId('live-playhead').style.left)).toBe(0)

    await act(async () => { await coordinatorRef.current!.step() })
    const atQuarter = parseFloat(screen.getByTestId('live-playhead').style.left)
    expect(atQuarter).toBeGreaterThan(0)

    await act(async () => { await coordinatorRef.current!.step() })
    const atSixty = parseFloat(screen.getByTestId('live-playhead').style.left)
    // 0.25 → 0.6 of the route: the playhead moved right, proportionally.
    expect(atSixty).toBeGreaterThan(atQuarter)
    expect(atSixty / atQuarter).toBeCloseTo(0.6 / 0.25, 5)
  })
})
