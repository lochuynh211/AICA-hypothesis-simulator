# Review-screen Live Timeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the low-value `StateCards` on the Review screen with a rich, real-time progressive-reveal timeline that looks like the Setup screen's Instant Result timeline, built from one shared component.

**Architecture:** Extract the SVG-drawing internals of `InstantResultStrip`'s timeline into a presentational `ScoreTimeline` fed a normalized `TimelineData` + a `revealFraction`. The Setup strip renders it whole-run/static; the Review screen builds `TimelineData` live from `state.trace` (and from the replay log during replay) and reveals it progressively as the run ticks. No backend changes; all data already flows into `state.trace`.

**Tech Stack:** React + TypeScript + Vite, Vitest + @testing-library/react. Inline SVG only — no charting library, no new dependencies.

## Global Constraints

- **Frontend only:** touch `app/frontend/` exclusively. Do NOT modify `htmlapp/` (deferred for feature 009) or `app/api/`.
- **No new dependencies.** Inline SVG, existing hooks (`useSmoothFraction`, `useRouteProgress`) only.
- **Display-only:** timeline components MUST NEVER dispatch to or write the run store (FR-016). Only local React state / rAF.
- **Preserve test contracts verbatim:** the review timeline must keep emitting `route-timeline`, `car-marker` (with `aria-label` `Route position: N%` where N is the EXACT evaluated fraction, not the smoothed one), `fire-marker`, and `progress-rest-spot-marker`. The setup strip must keep emitting `instant-result-svg`, `instant-result-timeline`, `instant-result-curve`, `instant-result-monotony-curve`, `instant-result-threshold`, `instant-result-monotony-threshold`, `instant-result-fire-marker`, `instant-result-fire-line`, `instant-result-monotony-fire-line`, `instant-result-segment-<n>`, `instant-result-spike-marker`, `instant-result-spike`, `instant-result-rest-spot-marker`, `instant-result-rest-dot`, `instant-result-rest-option-marker`, `instant-result-recovery-window`, `instant-result-completion-marker`. This is achieved via a per-consumer `testIds` prop on `ScoreTimeline` — no test-string edits.
- **Commit after each task** (the user commits; agentic workers running this plan may commit per the steps).
- Run the frontend test suite from `app/frontend/`: `npm test -- <file>` (Vitest).

## Live per-tick data recipe (mirrors `app/api/aica_api/services/preview.py`)

Given a frontend `TraceEntry` (`= DecisionResult & { tick_index, route_fraction?, proposal_paused?, segment_type? }`):
- rest-propose score: `Number(entry.scores?.rest_required_score ?? entry.score ?? 0)`
- monotony score (hybrid only): `entry.scores?.monotony_prevention_score` (omit point when null/undefined)
- rest threshold: `entry.criteria?.threshold_fire ?? entry.criteria?.threshold_suggest ?? null`
- monotony threshold: `entry.criteria?.monotony_suggest_threshold ?? null`
- fire (rising-edge episode): consecutive `entry.proposal_paused === true` ticks are ONE episode; mark the first. `kind` = `(entry.selected_category ?? '').startsWith('rest') ? 'rest' : 'monotony'`.
- x position of every point/marker: `entry.route_fraction ?? routeProgress.fractionAtTick(entry.tick_index)` (0–1).
- rest dots: `state.restHistory.map(r => r.spot.route_fraction)`.
- **anomaly spikes: NONE live** — the spike marker needs `tick_state.anomaly_events`, which is backend-only and absent from `TraceEntry`. Live `spikes = []`. (The Setup strip keeps spikes via `InstantResult.spikes`.)

## File Structure

- Create `app/frontend/src/components/playback/timelineData.ts` — `TimelineData` type + `instantResultToTimeline()` (pure) + `y-domain` helper. One responsibility: normalize inputs → a chart-ready, resolution-independent (x in 0–1) data shape.
- Create `app/frontend/src/components/playback/ScoreTimeline.tsx` — presentational SVG renderer. One responsibility: draw a `TimelineData` with progressive reveal.
- Create `app/frontend/src/components/playback/useLiveTimelineData.ts` — hook: `state.trace` (or replay log) → `TimelineData`. One responsibility: live/replay adapter.
- Modify `app/frontend/src/components/playback/RouteTimeline.tsx` — render `ScoreTimeline` from `useLiveTimelineData`, preserve testid contract.
- Modify `app/frontend/src/components/setup/InstantResultStrip.tsx` — render `ScoreTimeline` from `instantResultToTimeline`, dedup the inline SVG.
- Modify `app/frontend/src/components/layout/CenterPlaybackPanel.tsx` — remove `<StateCards />`.
- Delete `app/frontend/src/components/playback/StateCards.tsx`.
- Modify `app/frontend/tests/review_panels.test.tsx` — remove the `StateCards` describe block + import.
- Create tests: `timeline_data.test.ts`, `score_timeline.test.tsx`, `live_timeline_data.test.tsx`.

---

## Task 1: `TimelineData` + `instantResultToTimeline`

**Files:**
- Create: `app/frontend/src/components/playback/timelineData.ts`
- Test: `app/frontend/tests/timeline_data.test.ts`

**Interfaces:**
- Consumes: `InstantResult`, `ScoreSeriesPoint`, `SpikePoint`, `PreviewSegment`, `PreviewRestOption`, `FirePoint` from `../../api/types`.
- Produces:
  - `type TimelinePoint = { x: number; y: number }` (x in 0–1)
  - `type TimelineFire = { x: number; kind: 'rest' | 'monotony' }`
  - `type TimelineSegment = { fromX: number; toX: number; type: string | null }`
  - `type TimelineData = { segments: TimelineSegment[]; restScore: TimelinePoint[]; monotonyScore: TimelinePoint[]; restThreshold: number | null; monotonyThreshold: number | null; spikes: number[]; fires: TimelineFire[]; restDots: number[]; recoveryWindows: { fromX: number; toX: number }[]; completionX: number | null }`
  - `function instantResultToTimeline(result: InstantResult): TimelineData`
  - `function timelineYDomain(d: TimelineData): { yMin: number; yMax: number }`

- [ ] **Step 1: Write the failing test**

```ts
// app/frontend/tests/timeline_data.test.ts
import { describe, it, expect } from 'vitest'
import { instantResultToTimeline, timelineYDomain } from '../src/components/playback/timelineData'
import type { InstantResult } from '../src/api/types'

const base: InstantResult = {
  fired: true,
  fire: { category: 'rest_required', strength: 'clear', tick: 2, time_min: 20 },
  fires: [{ category: 'rest_required', strength: 'clear', tick: 2, time_min: 20 }],
  peak_score: 0.8,
  threshold: 0.6,
  score_series: [
    { t: 0, score: 0.1 },
    { t: 1, score: 0.4 },
    { t: 2, score: 0.8 },
  ],
  monotony_series: [
    { t: 0, score: 0.2 },
    { t: 2, score: 0.5 },
  ],
  monotony_threshold: 0.7,
  spikes: [{ t: 1, time_min: 10 }],
  segments: [
    { type: 'highway', from_min: 0, to_min: 20 },
    { type: 'mountain_road', from_min: 20, to_min: 40 },
  ],
  rest_spot: null,
  rest_option: { id: 'rest_a', auto_chosen: true, recovery_from_min: 30, to_min: 35 },
  rest_options: [{ id: 'rest_a', auto_chosen: true, recovery_from_min: 30, to_min: 35 }],
  completed_min: 40,
  seed: 1,
  overrides: [],
  error: null,
}

describe('instantResultToTimeline', () => {
  it('normalizes score series x to 0–1 by tick max', () => {
    const d = instantResultToTimeline(base)
    expect(d.restScore.map((p) => p.x)).toEqual([0, 0.5, 1])
    expect(d.restScore.map((p) => p.y)).toEqual([0.1, 0.4, 0.8])
  })

  it('emits a second monotony curve when present', () => {
    const d = instantResultToTimeline(base)
    expect(d.monotonyScore).toHaveLength(2)
    expect(d.monotonyThreshold).toBe(0.7)
  })

  it('normalizes segment/fire/rest/spike/completion x to 0–1 by minute or tick max', () => {
    const d = instantResultToTimeline(base)
    expect(d.segments).toEqual([
      { fromX: 0, toX: 0.5, type: 'highway' },
      { fromX: 0.5, toX: 1, type: 'mountain_road' },
    ])
    expect(d.fires).toEqual([{ x: 0.5, kind: 'rest' }]) // 20/40 min
    expect(d.spikes).toEqual([0.5]) // tick 1 / 2
    expect(d.restDots).toEqual([0.75]) // 30/40 min
    expect(d.completionX).toBe(1)
    expect(d.recoveryWindows).toEqual([{ fromX: 0.75, toX: 0.875 }])
  })

  it('leaves monotony empty and threshold null for a single-curve (NRI) result', () => {
    const nri: InstantResult = { ...base, monotony_series: [], monotony_threshold: null }
    const d = instantResultToTimeline(nri)
    expect(d.monotonyScore).toEqual([])
    expect(d.monotonyThreshold).toBeNull()
  })

  it('y-domain fits both curves and both thresholds with padding', () => {
    const d = instantResultToTimeline(base)
    const { yMin, yMax } = timelineYDomain(d)
    expect(yMin).toBeLessThanOrEqual(0.1)
    expect(yMax).toBeGreaterThanOrEqual(0.8)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app/frontend && npm test -- timeline_data.test.ts`
Expected: FAIL — cannot resolve `../src/components/playback/timelineData`.

- [ ] **Step 3: Write minimal implementation**

```ts
// app/frontend/src/components/playback/timelineData.ts
import type { InstantResult } from '../../api/types'

export type TimelinePoint = { x: number; y: number }
export type TimelineFire = { x: number; kind: 'rest' | 'monotony' }
export type TimelineSegment = { fromX: number; toX: number; type: string | null }

export type TimelineData = {
  segments: TimelineSegment[]
  restScore: TimelinePoint[]
  monotonyScore: TimelinePoint[]
  restThreshold: number | null
  monotonyThreshold: number | null
  spikes: number[]
  fires: TimelineFire[]
  restDots: number[]
  recoveryWindows: { fromX: number; toX: number }[]
  completionX: number | null
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

/** Map a whole-run headless InstantResult to a resolution-independent TimelineData. */
export function instantResultToTimeline(result: InstantResult): TimelineData {
  const { score_series, segments, threshold, completed_min } = result
  const monotony_series = result.monotony_series ?? []
  const spikePts = result.spikes ?? []
  const restOptions =
    result.rest_options && result.rest_options.length > 0
      ? result.rest_options
      : result.rest_option != null
        ? [result.rest_option]
        : []
  const fires = result.fired
    ? result.fires && result.fires.length > 0
      ? result.fires
      : result.fire != null
        ? [result.fire]
        : []
    : []

  const lastTick = Math.max(
    score_series.length > 0 ? score_series[score_series.length - 1].t : 1,
    monotony_series.length > 0 ? monotony_series[monotony_series.length - 1].t : 1,
  )
  const tickMax = Math.max(1, lastTick)
  const minMax = Math.max(
    1,
    completed_min ?? (segments.length > 0 ? segments[segments.length - 1].to_min : tickMax),
  )
  const xTick = (t: number) => clamp01(Math.min(t, tickMax) / tickMax)
  const xMin = (m: number) => clamp01(Math.min(m, minMax) / minMax)

  const restStops = restOptions
    .map((o) => o.recovery_from_min)
    .filter((m): m is number => m != null)

  return {
    segments: segments.map((s) => ({ fromX: xMin(s.from_min), toX: xMin(s.to_min), type: s.type })),
    restScore: score_series.map((p) => ({ x: xTick(p.t), y: p.score })),
    monotonyScore: monotony_series.map((p) => ({ x: xTick(p.t), y: p.score })),
    restThreshold: threshold,
    monotonyThreshold: result.monotony_threshold ?? null,
    spikes: spikePts.map((s) => xTick(s.t)),
    fires: fires.map((f) => ({
      x: xMin(f.time_min),
      kind: (f.category ?? '').startsWith('rest') ? 'rest' : 'monotony',
    })),
    restDots: restStops.map(xMin),
    recoveryWindows: restOptions
      .filter((o) => o.recovery_from_min != null && o.to_min != null)
      .map((o) => ({ fromX: xMin(o.recovery_from_min as number), toX: xMin(o.to_min as number) })),
    completionX: completed_min != null ? xMin(completed_min) : null,
  }
}

/** y-axis domain fitting BOTH curves and BOTH thresholds (never hardcode 0–1). */
export function timelineYDomain(d: TimelineData): { yMin: number; yMax: number } {
  const vals: number[] = []
  for (const p of d.restScore) vals.push(p.y)
  for (const p of d.monotonyScore) vals.push(p.y)
  if (d.restThreshold != null) vals.push(d.restThreshold)
  if (d.monotonyThreshold != null) vals.push(d.monotonyThreshold)
  const rawMin = vals.length > 0 ? Math.min(...vals) : 0
  const rawMax = vals.length > 0 ? Math.max(...vals) : 1
  const pad = (rawMax - rawMin) * 0.1 || 0.1
  return { yMin: rawMin - pad, yMax: rawMax + pad }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app/frontend && npm test -- timeline_data.test.ts`
Expected: PASS (all 5 tests).

- [ ] **Step 5: Commit**

```bash
git add app/frontend/src/components/playback/timelineData.ts app/frontend/tests/timeline_data.test.ts
git commit -m "feat(009): TimelineData normalizer + instantResultToTimeline for shared timeline"
```

---

## Task 2: `ScoreTimeline` presentational component

**Files:**
- Create: `app/frontend/src/components/playback/ScoreTimeline.tsx`
- Test: `app/frontend/tests/score_timeline.test.tsx`

**Interfaces:**
- Consumes: `TimelineData`, `timelineYDomain` from `./timelineData`.
- Produces:
  - `type ScoreTimelineTestIds = { root?: string; svg?: string; curve?: string; monotonyCurve?: string; threshold?: string; monotonyThreshold?: string; fireGroup?: string; fire?: string; monotonyFire?: string; spikeGroup?: string; spike?: string; restSpotGroup?: string; restDot?: string; restOptionGroup?: string; recoveryWindow?: string; completion?: string; playhead?: string; segment?: (i: number) => string }`
  - `type ScoreTimelineProps = { data: TimelineData; revealFraction?: number; ghostAhead?: boolean; animated?: boolean; showPlayhead?: boolean; playheadAriaLabel?: string; height?: number; testIds?: ScoreTimelineTestIds }`
  - `export default function ScoreTimeline(props: ScoreTimelineProps): JSX.Element`
- Notes: `revealFraction` defaults to `1`. Decisions (curves, spikes, fires, rest dots, recovery windows, completion) are clipped to `x ≤ revealFraction` via an SVG `<clipPath>`. Road bands always span full width; when `ghostAhead` and `revealFraction < 1`, the portion right of the reveal is drawn at reduced opacity. The `<g data-testid={testIds.fireGroup}>` wrapper is emitted only when `fireGroup` is set.

- [ ] **Step 1: Write the failing test**

```tsx
// app/frontend/tests/score_timeline.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import React from 'react'
import ScoreTimeline from '../src/components/playback/ScoreTimeline'
import type { TimelineData } from '../src/components/playback/timelineData'

const data: TimelineData = {
  segments: [
    { fromX: 0, toX: 0.5, type: 'highway' },
    { fromX: 0.5, toX: 1, type: 'mountain_road' },
  ],
  restScore: [
    { x: 0, y: 0.1 },
    { x: 0.5, y: 0.5 },
    { x: 1, y: 0.9 },
  ],
  monotonyScore: [],
  restThreshold: 0.6,
  monotonyThreshold: null,
  spikes: [0.5],
  fires: [{ x: 0.5, kind: 'rest' }],
  restDots: [0.75],
  recoveryWindows: [],
  completionX: 1,
}

const TID = {
  root: 'route-timeline',
  playhead: 'car-marker',
  fire: 'fire-marker',
  restDot: 'progress-rest-spot-marker',
  curve: 'ttl-curve',
  segment: (i: number) => `ttl-seg-${i}`,
}

describe('ScoreTimeline', () => {
  it('renders the container + curve + segments', () => {
    render(<ScoreTimeline data={data} testIds={TID} />)
    expect(screen.getByTestId('route-timeline')).toBeInTheDocument()
    expect(screen.getByTestId('ttl-curve')).toBeInTheDocument()
    expect(screen.getByTestId('ttl-seg-0')).toBeInTheDocument()
    expect(screen.getByTestId('ttl-seg-1')).toBeInTheDocument()
  })

  it('shows a playhead with the exact aria-label only when showPlayhead', () => {
    const { rerender } = render(<ScoreTimeline data={data} testIds={TID} />)
    expect(screen.queryByTestId('car-marker')).not.toBeInTheDocument()
    rerender(
      <ScoreTimeline data={data} testIds={TID} showPlayhead revealFraction={0.3} playheadAriaLabel="Route position: 30%" />,
    )
    expect(screen.getByTestId('car-marker')).toHaveAttribute('aria-label', 'Route position: 30%')
  })

  it('applies a reveal clip whose width tracks revealFraction', () => {
    const { container } = render(<ScoreTimeline data={data} testIds={TID} revealFraction={0.5} />)
    const clipRect = container.querySelector('clipPath rect') as SVGRectElement | null
    expect(clipRect).not.toBeNull()
    // width attr is revealFraction * viewBox width (fallback width 760 → 380)
    expect(Number(clipRect!.getAttribute('width'))).toBeCloseTo(380, 0)
  })

  it('renders fire lines and rest dots from the data', () => {
    render(<ScoreTimeline data={data} testIds={TID} />)
    expect(screen.getByTestId('fire-marker')).toBeInTheDocument()
    expect(screen.getByTestId('progress-rest-spot-marker')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app/frontend && npm test -- score_timeline.test.tsx`
Expected: FAIL — cannot resolve `ScoreTimeline`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// app/frontend/src/components/playback/ScoreTimeline.tsx
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { timelineYDomain, type TimelineData } from './timelineData'

// Colors mirror InstantResultStrip + MapSurface so a road reads the same everywhere.
const SEGMENT_COLORS: Record<string, string> = {
  start: '#e5e7eb', urban: '#dbeafe', highway: '#06b6d4', national: '#38bdf8',
  normal_road: '#22c55e', residential: '#e5e7eb', mountain_road: '#f59e0b',
  sightseeing_road: '#16a34a', rest: '#c4b5fd', end: '#e5e7eb',
}
const DEFAULT_SEGMENT_COLOR = '#f3f4f6'
const REST_COLOR = '#2563eb'
const MONOTONY_COLOR = '#0d9488'
const TRIGGER_COLOR = '#dc2626'
const REST_SPOT_COLOR = '#f59e0b'
const SPIKE_COLOR = '#db2777'
const TRACK_COLOR = '#e2e8f0'

const W_FALLBACK = 760

export type ScoreTimelineTestIds = {
  root?: string; svg?: string; curve?: string; monotonyCurve?: string
  threshold?: string; monotonyThreshold?: string
  fireGroup?: string; fire?: string; monotonyFire?: string
  spikeGroup?: string; spike?: string
  restSpotGroup?: string; restDot?: string; restOptionGroup?: string
  recoveryWindow?: string; completion?: string; playhead?: string
  segment?: (i: number) => string
}

export type ScoreTimelineProps = {
  data: TimelineData
  revealFraction?: number
  ghostAhead?: boolean
  animated?: boolean
  showPlayhead?: boolean
  playheadAriaLabel?: string
  height?: number
  testIds?: ScoreTimelineTestIds
}

function useMeasuredWidth<T extends HTMLElement>(ref: React.RefObject<T>): number {
  const [w, setW] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setW(el.clientWidth)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return w
}

export default function ScoreTimeline({
  data, revealFraction = 1, ghostAhead = false, animated = false,
  showPlayhead = false, playheadAriaLabel, height = 92, testIds = {},
}: ScoreTimelineProps) {
  const ref = useRef<HTMLDivElement>(null)
  const measured = useMeasuredWidth(ref)
  const W = measured > 0 ? measured : W_FALLBACK
  const H = height
  const reveal = Math.max(0, Math.min(1, revealFraction))
  const revealX = reveal * W

  const CURVE_TOP = 6
  const SEG_BOTTOM = H - 4
  const SEG_TOP = SEG_BOTTOM - 14
  const CURVE_BOTTOM = SEG_TOP - 8
  const BAND_MID = (SEG_TOP + SEG_BOTTOM) / 2

  const { yMin, yMax } = useMemo(() => timelineYDomain(data), [data])
  const yPix = (v: number) => CURVE_BOTTOM - ((v - yMin) / (yMax - yMin || 1)) * (CURVE_BOTTOM - CURVE_TOP)
  const pts = (arr: { x: number; y: number }[]) =>
    arr.map((p) => `${(p.x * W).toFixed(1)},${yPix(p.y).toFixed(1)}`).join(' ')

  const clipId = 'ttl-reveal'
  const trans = animated ? 'width 0.12s linear, transform 0.12s linear, left 0.12s linear' : undefined

  return (
    <div ref={ref} data-testid={testIds.root} style={{ position: 'relative', width: '100%' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img"
        aria-label="Route timeline" data-testid={testIds.svg}>
        <defs>
          <clipPath id={clipId}>
            <rect x={0} y={0} width={revealX} height={H} style={{ transition: trans }} />
          </clipPath>
        </defs>

        {/* Neutral full-width track (route length always visible) */}
        <rect x={0} y={SEG_TOP} width={W} height={SEG_BOTTOM - SEG_TOP} fill={TRACK_COLOR} />

        {/* Road bands — full width; ghosted (dim) right of the reveal when ghostAhead */}
        {data.segments.map((seg, i) => {
          const x1 = seg.fromX * W
          const x2 = seg.toX * W
          const color = (seg.type && SEGMENT_COLORS[seg.type]) || DEFAULT_SEGMENT_COLOR
          const ghosted = ghostAhead && seg.fromX >= reveal
          return (
            <rect key={i} data-testid={testIds.segment?.(i)} x={x1} y={SEG_TOP}
              width={Math.max(0, x2 - x1)} height={SEG_BOTTOM - SEG_TOP} fill={color}
              opacity={ghosted ? 0.28 : 1} />
          )
        })}

        {/* Everything below is a "decision" → clipped to the revealed region */}
        <g clipPath={`url(#${clipId})`}>
          {data.restThreshold != null && (
            <line data-testid={testIds.threshold} x1={0} x2={W} y1={yPix(data.restThreshold)}
              y2={yPix(data.restThreshold)} stroke={TRIGGER_COLOR} strokeDasharray="4 3" strokeWidth={1} />
          )}
          {data.monotonyThreshold != null && (
            <line data-testid={testIds.monotonyThreshold} x1={0} x2={W} y1={yPix(data.monotonyThreshold)}
              y2={yPix(data.monotonyThreshold)} stroke={MONOTONY_COLOR} strokeDasharray="4 3" strokeWidth={1} />
          )}
          {data.restScore.length > 0 && (
            <polyline data-testid={testIds.curve} points={pts(data.restScore)} fill="none"
              stroke={REST_COLOR} strokeWidth={2} />
          )}
          {data.monotonyScore.length > 0 && (
            <polyline data-testid={testIds.monotonyCurve} points={pts(data.monotonyScore)} fill="none"
              stroke={MONOTONY_COLOR} strokeWidth={2} />
          )}
          {data.recoveryWindows.map((rw, i) => (
            <rect key={i} data-testid={testIds.recoveryWindow} x={rw.fromX * W} y={SEG_TOP}
              width={Math.max(0, (rw.toX - rw.fromX) * W)} height={SEG_BOTTOM - SEG_TOP}
              fill="#a78bfa" opacity={0.35} />
          ))}
          {data.spikes.length > 0 && (
            <g data-testid={testIds.spikeGroup}>
              {data.spikes.map((x, i) => (
                <polygon key={i} data-testid={testIds.spike}
                  points={`${(x * W - 3).toFixed(1)},${CURVE_TOP} ${(x * W + 3).toFixed(1)},${CURVE_TOP} ${(x * W).toFixed(1)},${CURVE_TOP + 6}`}
                  fill={SPIKE_COLOR} />
              ))}
            </g>
          )}
          {data.fires.length > 0 && (
            <FireGroup testIds={testIds} fires={data.fires} W={W} top={CURVE_TOP} bottom={SEG_BOTTOM} />
          )}
          {data.restDots.length > 0 && (
            <g data-testid={testIds.restSpotGroup}>
              {data.restDots.map((x, i) => (
                <circle key={i} data-testid={testIds.restDot} cx={x * W} cy={BAND_MID} r={6}
                  fill={REST_SPOT_COLOR} stroke="#fff" strokeWidth={2} />
              ))}
            </g>
          )}
          {data.completionX != null && (
            <line data-testid={testIds.completion} x1={data.completionX * W} x2={data.completionX * W}
              y1={SEG_TOP} y2={SEG_BOTTOM} stroke="#9ca3af" strokeWidth={1.5} />
          )}
        </g>
      </svg>

      {showPlayhead && (
        <div data-testid={testIds.playhead} aria-label={playheadAriaLabel}
          style={{
            position: 'absolute', top: `${(SEG_TOP + SEG_BOTTOM) / 2}px`, left: `${revealX}px`,
            transform: 'translate(-50%, -50%) scaleX(-1)', fontSize: '20px', transition: trans,
            filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.4))', zIndex: 5, pointerEvents: 'none',
          }}>
          🚗
        </div>
      )}
    </div>
  )
}

function FireGroup({ testIds, fires, W, top, bottom }: {
  testIds: ScoreTimelineTestIds
  fires: { x: number; kind: 'rest' | 'monotony' }[]
  W: number; top: number; bottom: number
}) {
  const lines = fires.map((f, i) => {
    const isRest = f.kind === 'rest'
    return (
      <line key={i} data-testid={isRest ? testIds.fire : (testIds.monotonyFire ?? testIds.fire)}
        x1={f.x * W} x2={f.x * W} y1={top} y2={bottom}
        stroke={isRest ? TRIGGER_COLOR : MONOTONY_COLOR} strokeWidth={isRest ? 2 : 1}
        strokeDasharray={isRest ? undefined : '2 3'} opacity={isRest ? 1 : 0.7} />
    )
  })
  return testIds.fireGroup ? <g data-testid={testIds.fireGroup}>{lines}</g> : <>{lines}</>
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app/frontend && npm test -- score_timeline.test.tsx`
Expected: PASS (all 4 tests).

- [ ] **Step 5: Commit**

```bash
git add app/frontend/src/components/playback/ScoreTimeline.tsx app/frontend/tests/score_timeline.test.tsx
git commit -m "feat(009): ScoreTimeline — shared progressive-reveal SVG timeline"
```

---

## Task 3: Review timeline goes live (`useLiveTimelineData` + `RouteTimeline`)

**Files:**
- Create: `app/frontend/src/components/playback/useLiveTimelineData.ts`
- Test: `app/frontend/tests/live_timeline_data.test.tsx`
- Modify: `app/frontend/src/components/playback/RouteTimeline.tsx` (full rewrite of the render; keep the export signature `RouteTimeline({ replayTick })`)

**Interfaces:**
- Consumes: `useRunStore` (`state.trace`, `state.restHistory`), `useRouteProgress` (`segments`, `currentFraction`, `fractionAtTick`, `proposalFractions`), `TimelineData`/`instantResultToTimeline` types, `ReplayTick` from `../../replay/replaySource`, `ScoreTimeline`.
- Produces:
  - `function useLiveTimelineData(replayTick?: ReplayTick | null): { data: TimelineData; revealFraction: number; exactFraction: number }`
- Notes: display-only (no store writes). Live spikes are always `[]`.

- [ ] **Step 1: Write the failing test**

```tsx
// app/frontend/tests/live_timeline_data.test.tsx
import { render, screen, act } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { RunStoreProvider, useRunStore } from '../src/state/runStore'
import type { RunStoreAction } from '../src/state/runStore'
import { useLiveTimelineData } from '../src/components/playback/useLiveTimelineData'
import type { DecisionResult, RunState } from '../src/api/types'

vi.mock('../src/api/client', () => ({
  getScenario: vi.fn().mockResolvedValue({ route_intent: { segments: [] }, total_duration_seconds: 600 }),
}))

const runState = { run_id: 'r1', status: 'running', event_plan: { tick_seconds: 60, ticks: [] } } as unknown as RunState

function decision(score: number, monotony: number, fired: boolean): DecisionResult {
  return {
    result_type: fired ? 'REST_PROPOSAL' : 'NO_TRIGGER',
    trigger_candidate: fired, selected_category: fired ? 'rest_required' : null,
    score, features: {}, scores: { rest_required_score: score, monotony_prevention_score: monotony },
    states: {}, criteria: { threshold_fire: 0.6, monotony_suggest_threshold: 0.7 }, candidates: [],
    fire_control: { fired, suppressed: false, override: false, reason: null },
    proposal: fired ? { id: 'p', message: { ja: '', en: '' }, options: ['accept_rest'] } : null,
    reason_inputs: [], explanation: '', next_package_runtime_state: {},
  }
}

let captured: ReturnType<typeof useLiveTimelineData> | null = null
function Probe() {
  captured = useLiveTimelineData(null)
  return null
}
let dispatch: React.Dispatch<RunStoreAction> | null = null
function Dispatcher() {
  dispatch = useRunStore().dispatch
  return null
}

describe('useLiveTimelineData (live)', () => {
  it('accumulates one rest+monotony curve point per tick and reveals to the latest fraction', async () => {
    render(<RunStoreProvider><Dispatcher /><Probe /></RunStoreProvider>)
    await act(async () => {
      dispatch!({ type: 'RUN_CREATED', runState })
      dispatch!({ type: 'TICK_APPENDED', runState, decision: decision(0.2, 0.1, false), tickIndex: 0, paused: false, completed: false, routeFraction: 0.0 })
      dispatch!({ type: 'TICK_APPENDED', runState, decision: decision(0.7, 0.3, true), tickIndex: 1, paused: true, completed: false, routeFraction: 0.5, proposalPaused: true })
    })
    expect(captured!.data.restScore).toEqual([{ x: 0, y: 0.2 }, { x: 0.5, y: 0.7 }])
    expect(captured!.data.monotonyScore).toEqual([{ x: 0, y: 0.1 }, { x: 0.5, y: 0.3 }])
    expect(captured!.data.restThreshold).toBe(0.6)
    expect(captured!.data.monotonyThreshold).toBe(0.7)
    expect(captured!.data.fires).toEqual([{ x: 0.5, kind: 'rest' }])
    expect(captured!.data.spikes).toEqual([]) // never available live
    expect(captured!.exactFraction).toBe(0.5)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app/frontend && npm test -- live_timeline_data.test.tsx`
Expected: FAIL — cannot resolve `useLiveTimelineData`.

- [ ] **Step 3: Write minimal implementation**

```ts
// app/frontend/src/components/playback/useLiveTimelineData.ts
import { useRunStore } from '../../state/runStore'
import { useRouteProgress } from './useRouteProgress'
import type { TimelineData, TimelineFire, TimelineSegment } from './timelineData'
import type { ReplayTick } from '../../replay/replaySource'
import type { TraceEntry } from '../../api/types'

const num = (v: unknown): number | null => (typeof v === 'number' ? v : null)

function restY(e: TraceEntry): number {
  return num(e.scores?.['rest_required_score']) ?? num(e.score) ?? 0
}
function fireKind(cat: string | null): 'rest' | 'monotony' {
  return (cat ?? '').startsWith('rest') ? 'rest' : 'monotony'
}

/** Build the review-screen TimelineData live from state.trace (or the replay log). */
export function useLiveTimelineData(replayTick?: ReplayTick | null): {
  data: TimelineData
  revealFraction: number
  exactFraction: number
} {
  const { state } = useRunStore()
  const progress = useRouteProgress()

  // Full route bands are known upfront (geometry, not a decision) → ghosted ahead.
  const sorted = [...progress.segments].sort((a, b) => a.at - b.at)
  const segments: TimelineSegment[] = sorted.map((s, i) => ({
    fromX: s.at,
    toX: i + 1 < sorted.length ? sorted[i + 1].at : 1,
    type: s.type ?? null,
  }))

  // Replay: reveal to the recorded tick; live: reveal to the latest evaluated fraction.
  const exactFraction = replayTick != null ? replayTick.route_fraction : progress.currentFraction

  // Curves + fires accumulate from the trace up to "now".
  const trace = state.trace
  const upTo = replayTick != null ? trace.filter((e) => e.tick_index <= replayTick.tick_index) : trace
  const fracFor = (e: TraceEntry) =>
    typeof e.route_fraction === 'number' ? e.route_fraction : progress.fractionAtTick(e.tick_index)

  const restScore = upTo.map((e) => ({ x: fracFor(e), y: restY(e) }))
  const monotonyScore = upTo
    .filter((e) => num(e.scores?.['monotony_prevention_score']) != null)
    .map((e) => ({ x: fracFor(e), y: num(e.scores?.['monotony_prevention_score']) as number }))

  const last = upTo.length > 0 ? upTo[upTo.length - 1] : null
  const restThreshold =
    num(last?.criteria?.['threshold_fire']) ?? num(last?.criteria?.['threshold_suggest']) ?? null
  const monotonyThreshold = num(last?.criteria?.['monotony_suggest_threshold']) ?? null

  // Fires: rising-edge episodes of an actionable (paused) proposal.
  const fires: TimelineFire[] = []
  let active = false
  for (const e of upTo) {
    const paused = e.proposal_paused === true
    if (paused && !active) fires.push({ x: fracFor(e), kind: fireKind(e.selected_category) })
    active = paused
  }

  const restDots = state.restHistory.map((r) => r.spot.route_fraction)

  const data: TimelineData = {
    segments,
    restScore,
    monotonyScore,
    restThreshold,
    monotonyThreshold,
    spikes: [], // anomaly_events are backend-only → never available live
    fires,
    restDots,
    recoveryWindows: [],
    completionX: state.completed ? 1 : null,
  }
  return { data, revealFraction: exactFraction, exactFraction }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app/frontend && npm test -- live_timeline_data.test.tsx`
Expected: PASS.

- [ ] **Step 5: Rewrite `RouteTimeline` to render `ScoreTimeline`**

Replace the entire body of `app/frontend/src/components/playback/RouteTimeline.tsx` with:

```tsx
import { useLiveTimelineData } from './useLiveTimelineData'
import { useSmoothFraction } from './useSmoothFraction'
import ScoreTimeline from './ScoreTimeline'
import type { ScoreTimelineTestIds } from './ScoreTimeline'
import type { ReplayTick } from '../../replay/replaySource'

/**
 * RouteTimeline — the Review-screen progress timeline (FR-016 display-only).
 *
 * Now a real-time, progressive-reveal version of the Setup screen's Instant
 * Result timeline: road bands ghost ahead (geometry is known), while the score
 * curve(s), fire lines, and rest dots reveal only behind the 🚗 playhead as the
 * run ticks. Built via the shared ScoreTimeline. The car aria-label reports the
 * EXACT evaluated route_fraction (matches the evidence log); only the on-screen
 * position is eased via useSmoothFraction. No store writes.
 */
const REVIEW_TEST_IDS: ScoreTimelineTestIds = {
  root: 'route-timeline',
  playhead: 'car-marker',
  fire: 'fire-marker',
  restDot: 'progress-rest-spot-marker',
  curve: 'progress-fill', // the growing rest-propose curve is the "fill" of the bar
}

export default function RouteTimeline({ replayTick }: { replayTick?: ReplayTick | null } = {}) {
  const { data, exactFraction } = useLiveTimelineData(replayTick)
  const shown = useSmoothFraction(exactFraction)
  const targetPct = Math.round(exactFraction * 100)

  return (
    <div style={{ margin: '12px 0' }}>
      <ScoreTimeline
        data={data}
        revealFraction={shown}
        ghostAhead
        animated
        showPlayhead
        playheadAriaLabel={`Route position: ${targetPct}%`}
        height={112}
        testIds={REVIEW_TEST_IDS}
      />
    </div>
  )
}
```

- [ ] **Step 6: Run the review/replay/playback suites to verify the testid contract holds**

Run: `cd app/frontend && npm test -- playback.test.tsx replay.test.tsx map.test.tsx`
Expected: PASS. If `progress-fill` assertions expected a `<div>` fill and now find a `<polyline>`, that is still a present element with the same testid — assertions using `getByTestId(...).toBeInTheDocument()` pass. Any assertion reading a `style.width` off `progress-fill` must be updated to assert the `car-marker` position/`aria-label` instead (the fraction is the meaningful contract). Fix such assertions inline.

- [ ] **Step 7: Commit**

```bash
git add app/frontend/src/components/playback/useLiveTimelineData.ts \
        app/frontend/src/components/playback/RouteTimeline.tsx \
        app/frontend/tests/live_timeline_data.test.tsx
git commit -m "feat(009): review timeline reveals live per-tick via shared ScoreTimeline"
```

---

## Task 4: Remove `StateCards` from the Review screen

**Files:**
- Modify: `app/frontend/src/components/layout/CenterPlaybackPanel.tsx` (remove import + `<StateCards />`, update doc comment)
- Delete: `app/frontend/src/components/playback/StateCards.tsx`
- Modify: `app/frontend/tests/review_panels.test.tsx` (remove the `StateCards` import + its `describe` block)

**Interfaces:**
- Consumes: nothing new.
- Produces: `CenterPlaybackPanel` no longer renders `state-cards`.

- [ ] **Step 1: Write the failing test** — assert the panel no longer renders `state-cards`.

Add to `app/frontend/tests/review_panels.test.tsx` (near the other panel tests; reuse its existing `renderWithStore` + `seedRun` helpers):

```tsx
import CenterPlaybackPanel from '../src/components/layout/CenterPlaybackPanel'

describe('CenterPlaybackPanel — StateCards removed', () => {
  it('does not render the state-cards block, and renders the route timeline', () => {
    renderWithStore(<CenterPlaybackPanel />, seedRun)
    expect(screen.queryByTestId('state-cards')).not.toBeInTheDocument()
    expect(screen.getByTestId('route-timeline')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app/frontend && npm test -- review_panels.test.tsx`
Expected: FAIL — `state-cards` is still rendered by `CenterPlaybackPanel`.

- [ ] **Step 3: Remove `StateCards` from the panel**

In `app/frontend/src/components/layout/CenterPlaybackPanel.tsx`:
- Delete the import line `import StateCards from '../playback/StateCards'`.
- Delete the `<StateCards />` line (currently right after `<RouteTimeline />`).
- In the top doc comment, delete the line `*   - StateCards                      — in-car status + driving environment`.

- [ ] **Step 4: Delete the component and its old test coverage**

```bash
git rm app/frontend/src/components/playback/StateCards.tsx
```

In `app/frontend/tests/review_panels.test.tsx`:
- Delete `import StateCards from '../src/components/playback/StateCards'`.
- Delete the entire `describe('StateCards', () => { ... })` block (the drowsiness/fatigue band readout tests).
- Update the file's top doc comment to drop the `StateCards` mention.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd app/frontend && npm test -- review_panels.test.tsx`
Expected: PASS (no StateCards references remain; the new removal test passes).

- [ ] **Step 6: Commit**

```bash
git add app/frontend/src/components/layout/CenterPlaybackPanel.tsx app/frontend/tests/review_panels.test.tsx
git commit -m "feat(009): remove StateCards from Review screen; live timeline takes the space"
```

---

## Task 5: Dedup — Setup strip reuses `ScoreTimeline`

**Files:**
- Modify: `app/frontend/src/components/setup/InstantResultStrip.tsx` (replace the inline `InstantResultTimeline` SVG body with `instantResultToTimeline` + `<ScoreTimeline>`; keep the legend, result line, error notice, and all `instant-result-*` testids)

**Interfaces:**
- Consumes: `instantResultToTimeline` (Task 1), `ScoreTimeline` + `ScoreTimelineTestIds` (Task 2).
- Produces: identical rendered output + testids as before.

- [ ] **Step 1: Run the existing strip test to establish the green baseline**

Run: `cd app/frontend && npm test -- instant_result_strip.test.tsx`
Expected: PASS (baseline before refactor).

- [ ] **Step 2: Replace the SVG body inside `InstantResultTimeline`**

In `app/frontend/src/components/setup/InstantResultStrip.tsx`, inside `InstantResultTimeline`, replace the `<svg>…</svg>` block (segments, thresholds, curves, recovery window, spikes, fires, rest dots/options, completion) with a `ScoreTimeline` fed by the normalizer. Keep the surrounding `containerRef` wrapper div (`data-testid="instant-result-timeline"`), the legend, the `error` notice, and the result line unchanged. Add imports:

```tsx
import ScoreTimeline, { type ScoreTimelineTestIds } from '../playback/ScoreTimeline'
import { instantResultToTimeline } from '../playback/timelineData'
```

Define the strip's testid map (preserves every existing assertion):

```tsx
const STRIP_TEST_IDS: ScoreTimelineTestIds = {
  svg: 'instant-result-svg',
  curve: 'instant-result-curve',
  monotonyCurve: 'instant-result-monotony-curve',
  threshold: 'instant-result-threshold',
  monotonyThreshold: 'instant-result-monotony-threshold',
  fireGroup: 'instant-result-fire-marker',
  fire: 'instant-result-fire-line',
  monotonyFire: 'instant-result-monotony-fire-line',
  spikeGroup: 'instant-result-spike-marker',
  spike: 'instant-result-spike',
  restSpotGroup: 'instant-result-rest-spot-marker',
  restDot: 'instant-result-rest-dot',
  recoveryWindow: 'instant-result-recovery-window',
  completion: 'instant-result-completion-marker',
  segment: (i) => `instant-result-segment-${i}`,
}
```

Then render (whole-run → `revealFraction={1}`, no ghost, no playhead, static, compact height 92):

```tsx
const timeline = instantResultToTimeline(result)
// …inside the returned JSX, replacing the old <svg>…</svg>:
<ScoreTimeline data={timeline} revealFraction={1} ghostAhead={false} animated={false}
  showPlayhead={false} height={92} testIds={STRIP_TEST_IDS} />
```

Note on `instant-result-threshold` / `instant-result-monotony-threshold`: the strip's tests assert the threshold `<line>` plus a threshold `<text>` label. `ScoreTimeline` renders the `<line>` with the testid; keep the strip's threshold **label** `<text>` elements (`threshold {n}` / `monotony {n}`) in the strip by leaving them as a small sibling overlay is unnecessary — instead verify the strip tests only assert the element with the testid exists. Run Step 3; if a test asserts label text specifically, add the two `<text>` labels back as an absolutely-positioned caption under the strip. (Check `instant_result_strip.test.tsx` for `threshold` text assertions before deciding.)

- [ ] **Step 3: Run the strip test to verify it stays green**

Run: `cd app/frontend && npm test -- instant_result_strip.test.tsx`
Expected: PASS. If red, the failure names the exact missing testid/text — reconcile by supplying it via `STRIP_TEST_IDS` or restoring the specific label element. Do NOT edit the test to make it pass; fix the component.

- [ ] **Step 4: Delete the now-dead SVG helpers from the strip**

Remove the now-unused constants/helpers in `InstantResultStrip.tsx` that moved into `ScoreTimeline`/`timelineData` (`SEGMENT_COLORS`, `xForTick`, `xForMin`, `yToPixel`, `curvePoints`, `useMeasuredSize`, color constants, `W_FALLBACK`, `H_FIXED`, etc.), keeping only what the legend/result-line still use (`SEGMENT_LABELS`, `segLabel`, `presentSegTypes`, `formatNum`, `buildResultLine`, `LegendLine`, `LegendSwatch`). Confirm no unused-import/lint errors.

- [ ] **Step 5: Run the full frontend suite + typecheck**

Run: `cd app/frontend && npm test`
Run: `cd app/frontend && npx tsc --noEmit`
Expected: all tests PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add app/frontend/src/components/setup/InstantResultStrip.tsx
git commit -m "refactor(009): Setup strip reuses shared ScoreTimeline (dedup SVG)"
```

---

## Self-Review

**Spec coverage:**
- Progressive reveal (Decision 1) → Task 2 (`ScoreTimeline` clip) + Task 3 (`revealFraction={shown}`). ✅
- Ghost road ahead (Decision 2) → Task 2 (`ghostAhead` dims bands right of reveal) + Task 3 (`ghostAhead`). ✅
- StateCards fully removed (Decision 3) → Task 4. ✅
- One shared component (Decision 4) → Tasks 1–2 build it; Task 3 (review) + Task 5 (setup) both consume it. ✅
- No backend / no deps / frontend-only → Global Constraints; every task touches only `app/frontend/`. ✅
- Live spikes omitted (best-effort) → Task 3 `spikes: []`, documented. ✅
- NRI single-curve → Task 1 test (empty monotony) + `ScoreTimeline` guards on `.length > 0`. ✅
- Testid contract preserved → `testIds` prop; Tasks 3 & 5 supply the exact legacy strings; Task 3 Step 6 + Task 5 Step 3 verify. ✅
- Replay path revealed to recorded tick → Task 3 (`replayTick` branch in `useLiveTimelineData`). ✅
- Display-only (no store writes) → hooks only read; `playback.test` "does NOT mutate" test kept. ✅

**Placeholder scan:** No TBD/TODO; every code step shows full code. The only conditional judgement (threshold label text in Task 5 Step 2/3) is bounded by "check the test and add the two `<text>` labels if asserted" with an exact fallback — acceptable, not a placeholder.

**Type consistency:** `TimelineData`/`TimelinePoint`/`TimelineFire`/`TimelineSegment` defined in Task 1 and consumed unchanged in Tasks 2–3. `ScoreTimelineTestIds`/`ScoreTimelineProps` defined in Task 2, consumed in Tasks 3 & 5. `useLiveTimelineData` returns `{ data, revealFraction, exactFraction }` (Task 3), consumed by `RouteTimeline`. `instantResultToTimeline` signature identical across Tasks 1/5. Consistent. ✅

## Out of scope
- `htmlapp/` mirror (deferred for feature 009).
- Backend changes (none).
- Reinstating a drowsiness/fatigue readout (explicitly removed).
- Live anomaly-spike plumbing.
