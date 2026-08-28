import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { timelineYDomain, type TimelineData, type TimelineFire } from './timelineData'
import { formatDuration } from '../../lib/formatDuration'
import { t, type UiLanguage, type BilingualLabel } from '../../i18n/t'
import {
  REST_SPOT_COLOR, TRIGGER_MONOTONY_COLOR, TRIGGER_REST_COLOR,
} from '../../lib/review/triggerColors'

// Road-band colors are COPIED VERBATIM from MapSurface's ROAD_COLORS so a road
// reads identically on the timeline and on the Google map: highway cyan,
// normal_road blue, mountain orange, sightseeing green. `urban` (a scenario
// route_intent type that never appears on a Maps route) is green like the map's
// ordinary roads; `national`/`residential`/`rest` are timeline-only extras.
const SEGMENT_COLORS: Record<string, string> = {
  highway: '#06b6d4', normal_road: '#2563eb', mountain_road: '#f59e0b',
  sightseeing_road: '#22c55e', urban: '#22c55e', national: '#38bdf8',
  residential: '#e5e7eb', rest: '#c4b5fd',
}
// start / end are route endpoints, not road classes — they get no distinct band
// or legend entry (the neutral track shows through instead of a grey block).
const HIDDEN_SEGMENT_TYPES = new Set(['start', 'end'])
// Human-readable, bilingual road-band labels (for the optional legend). Shared:
// InstantResultStrip imports segLabel() so preview + review read identically.
export const SEGMENT_LABELS: Record<string, BilingualLabel> = {
  urban: { en: 'urban', ja: '市街地' },
  highway: { en: 'highway', ja: '高速道路' },
  national: { en: 'national road', ja: '国道' },
  normal_road: { en: 'normal road', ja: '一般道' },
  residential: { en: 'residential', ja: '住宅街' },
  mountain_road: { en: 'mountain road', ja: '山道' },
  sightseeing_road: { en: 'scenic road', ja: '観光道路' },
  rest: { en: 'rest stop', ja: '休憩施設' },
}

/** Fallback for a segment_type this table doesn't recognize — never the raw
 *  identifier itself (rule 2). */
const UNNAMED_SEGMENT: BilingualLabel = { ja: '未分類の区間', en: 'Unclassified segment' }

/** Localized road-band label; falls back to a generic "unclassified segment"
 *  label (never the raw segment_type) when unknown. */
export function segLabel(type: string, lang: UiLanguage): string {
  const label = SEGMENT_LABELS[type]
  return t(label ?? UNNAMED_SEGMENT, lang)
}
const DEFAULT_SEGMENT_COLOR = '#f3f4f6'
const REST_COLOR = '#2563eb'
const MONOTONY_COLOR = '#0d9488'
/** Rest-trigger marker + the firing-threshold rule (both the "rest" red). */
const TRIGGER_COLOR = TRIGGER_REST_COLOR
const SPIKE_COLOR = '#db2777'
const TRACK_COLOR = '#e2e8f0'
// Journey marker (feature 020): purple = after-nap service (the green
// "driving after rest" dot was dropped — owner decision).
const AFTER_NAP_COLOR = '#9333ea'
// Traffic-jam sub-bar color (feature 020) — matches the setup painter's jam red.
const JAM_COLOR = '#dc2626'
// "Available rest spot" markers (Combined screen): transparent light-red squares
// UNDER the road bar marking every rest facility on the route. Deliberately a
// faint wash — they are context (where a rest was POSSIBLE), not a decision, so
// they must never compete with the solid CHOSEN rest square drawn IN the bar.
const AVAILABLE_REST_FILL = 'rgba(239, 68, 68, 0.22)'
const AVAILABLE_REST_STROKE = 'rgba(220, 38, 38, 0.55)'
const AVAILABLE_REST_LABEL = '#dc2626'

/** Rounded `@N km` from-start distance label, dropping a trailing `.0`
 *  (`@0.7km`, `@1km`). */
function kmLabel(km: number): string {
  // Compact: no `@` prefix. Above 1 km, drop the fractional part entirely
  // (whole km); at/below 1 km keep one decimal so sub-km spots stay distinct.
  if (km > 1) return `${Math.round(km)}km`
  const r = Math.round(km * 10) / 10
  return `${Number.isInteger(r) ? r : r.toFixed(1)}km`
}
// Driver-state curves drawn UNDER the road bar. Deliberately distinct from the
// score palette above it: those are what the ALGORITHM decided, these are what
// the DRIVER was doing, and a reviewer must never confuse the two.
const DROWSINESS_COLOR = '#7c3aed'
const FATIGUE_COLOR = '#ea580c'
const MONOTONY_LEVEL_COLOR = '#0891b2'

const W_FALLBACK = 760

const LABELS = {
  routeTimeline: { ja: 'ルートタイムライン', en: 'Route timeline' },
}

export type ScoreTimelineTestIds = {
  /** Driver-state band under the road bar (drowsiness / fatigue / monotony).
   *  The three curves default to `timeline-drowsiness` / `timeline-fatigue` /
   *  `timeline-monotony-level`; override them whenever two ScoreTimelines are
   *  on screen at once (the Combined projection + live pair), so a query for
   *  "the drowsiness curve" names ONE of them. */
  signalBand?: string
  drowsinessCurve?: string; fatigueCurve?: string; monotonyLevelCurve?: string
  root?: string; svg?: string; curve?: string; monotonyCurve?: string
  threshold?: string; monotonyThreshold?: string
  fireGroup?: string; fire?: string; monotonyFire?: string
  spikeGroup?: string; spike?: string
  /** Traffic-jam sub-bar group (feature 020). */
  jamGroup?: string
  restSpotGroup?: string; restDot?: string; restOptionGroup?: string
  /** Group of transparent light-red "available rest spot" squares under the road
   *  bar (Combined screen only — populated from `data.availableRestSpots`). */
  availableRestGroup?: string
  recoveryWindow?: string; completion?: string; playhead?: string
  legend?: string
  segment?: (i: number) => string
  /** Testid for the (invisible, wider-than-the-line) per-fire click hit-rect —
   *  only rendered when `onFireClick` is supplied (see `ScoreTimelineProps`). */
  fireHit?: (i: number) => string
  /** Testid for the (invisible, wider) per-rest-option journey-dot hit-circle —
   *  only rendered when `onRestOptionClick` is supplied. */
  restOptionHit?: (i: number) => string
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
  thresholdLabel?: string
  monotonyThresholdLabel?: string
  restDotAriaLabel?: string
  /** Render a color legend (rest/monotony score, road bands, rest spot, threshold)
   *  below the SVG. Off by default so the Setup strip (which owns its own legend)
   *  is unaffected; the Review timeline turns it on. */
  showLegend?: boolean
  /** UI language for the built-in legend labels (default 'en'). */
  lang?: UiLanguage
  /** Render the rest-JOURNEY marker (feature 020): a purple "after-nap service"
   * dot above each red rest-spot square. Off by default so the Trigger screen is
   * unaffected; the Combined quickview turns it on. */
  showJourneyMarkers?: boolean
  /** ADDITIVE, feature-020 Slice-2c (Task 5): when supplied, each fire marker
   *  gains a transparent, wider hit-rect calling this with the fire and its
   *  index on click — e.g. the merged quickview projection strip's
   *  click-to-inspect affordance. `undefined` (the default) renders byte-
   *  identical to before this prop existed: no hit-rect, no click affordance,
   *  every existing ScoreTimeline usage (InstantResultStrip, playback,
   *  MergedCenterPanel's live trace) is unaffected. */
  onFireClick?: (fire: TimelineFire, index: number) => void
  /** Pin the SCORE band's y-axis instead of fitting it to this chart's own
   *  curves. Used to stack the live chart under the projection on ONE scale:
   *  two auto-fitted charts of the same run would draw the same score at two
   *  different heights, and a live curve that has only run a few ticks would
   *  be normalised into looking dramatic. `undefined` (the default) keeps the
   *  original self-fitting behaviour for every existing caller. */
  yDomain?: { yMin: number; yMax: number }
  /** ADDITIVE, feature-020 (clickable journey dot): when supplied (only with
   *  `showJourneyMarkers`), each purple "after-nap" dot for rest-option `i` gains
   *  a transparent, wider hit-circle calling this with `i` on click — the
   *  quickview's after-nap proposal inspect affordance. `undefined` (default)
   *  renders exactly as before: no hit-circle, no click. */
  onRestOptionClick?: (index: number) => void
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
  thresholdLabel, monotonyThresholdLabel, restDotAriaLabel, showLegend = false, lang = 'en',
  showJourneyMarkers = false, yDomain, onFireClick, onRestOptionClick,
}: ScoreTimelineProps) {
  const ref = useRef<HTMLDivElement>(null)
  const measured = useMeasuredWidth(ref)
  const W = measured > 0 ? measured : W_FALLBACK
  const H = height
  const reveal = Math.max(0, Math.min(1, revealFraction))
  const revealX = reveal * W

  // Vertical layout, top to bottom:
  //   [score curves + thresholds] [jam sub-bar] [ROAD BAR] [driver-signal curves]
  // The road bar is the spatial anchor — scores (what the algorithm decided) sit
  // above it, driver state (what the driver was doing) below it. When there is no
  // signal series the lower band collapses to zero and the layout is byte-identical
  // to the original: road bar on the bottom edge.
  const sig = data.driverSignals
  const hasSignals =
    (sig?.drowsiness.length ?? 0) > 0 || (sig?.fatigue.length ?? 0) > 0 || (sig?.monotony.length ?? 0) > 0
  const SIG_BAND_H = hasSignals ? 52 : 0
  const SIG_GAP = hasSignals ? 9 : 0

  const CURVE_TOP = 6
  const SIG_BOTTOM = H - 4
  const SIG_TOP = SIG_BOTTOM - SIG_BAND_H
  const SEG_BOTTOM = SIG_TOP - SIG_GAP
  const SEG_TOP = SEG_BOTTOM - 14
  const CURVE_BOTTOM = SEG_TOP - 8
  const BAND_MID = (SEG_TOP + SEG_BOTTOM) / 2
  // Thin traffic-jam sub-bar, drawn in the gap just above the road-type bar.
  const JAM_BOTTOM = SEG_TOP - 2
  const JAM_TOP = JAM_BOTTOM - 3

  const fitted = useMemo(() => timelineYDomain(data), [data])
  const { yMin, yMax } = yDomain ?? fitted
  const yPix = (v: number) => CURVE_BOTTOM - ((v - yMin) / (yMax - yMin || 1)) * (CURVE_BOTTOM - CURVE_TOP)
  const pts = (arr: { x: number; y: number }[]) =>
    arr.map((p) => `${(p.x * W).toFixed(1)},${yPix(p.y).toFixed(1)}`).join(' ')

  // Driver signals are all 0-100 on a FIXED axis — unlike the score curves above,
  // which auto-scale. A fixed axis is the point here: "drowsiness went flat" must
  // look flat, not get re-normalised into looking dramatic.
  const sigPix = (v: number) => SIG_BOTTOM - (Math.max(0, Math.min(100, v)) / 100) * (SIG_BOTTOM - SIG_TOP)
  const sigPts = (arr: { x: number; y: number }[]) =>
    arr.map((p) => `${(p.x * W).toFixed(1)},${sigPix(p.y).toFixed(1)}`).join(' ')

  const rawId = useId()
  const clipId = `ttl-reveal-${rawId}`
  const blurId = `ttl-blur-${rawId}`
  const trans = animated ? 'width 0.12s linear, transform 0.12s linear, left 0.12s linear' : undefined

  // Road bands. When ghostAhead, the road AHEAD of the playhead is drawn blurred +
  // dimmed (still colored, just soft) and the road ALREADY DRIVEN is drawn crisp on
  // top, clipped to the reveal edge — so it "cleans up" in real time as the car passes.
  const bandRect = (seg: TimelineData['segments'][number], i: number, withTestId: boolean) => {
    if (seg.type && HIDDEN_SEGMENT_TYPES.has(seg.type)) return null
    const x1 = seg.fromX * W
    const x2 = seg.toX * W
    const color = (seg.type && SEGMENT_COLORS[seg.type]) || DEFAULT_SEGMENT_COLOR
    return (
      <rect key={i} data-testid={withTestId ? testIds.segment?.(i) : undefined} x={x1} y={SEG_TOP}
        width={Math.max(0, x2 - x1)} height={SEG_BOTTOM - SEG_TOP} fill={color} />
    )
  }

  const presentSegTypes = useMemo(() => {
    const seen = new Set<string>()
    const order: string[] = []
    for (const s of data.segments) {
      const t = s.type ?? ''
      if (t && !HIDDEN_SEGMENT_TYPES.has(t) && !seen.has(t)) { seen.add(t); order.push(t) }
    }
    return order
  }, [data.segments])

  return (
    <div ref={ref} data-testid={testIds.root} style={{ position: 'relative', width: '100%' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img"
        aria-label={t(LABELS.routeTimeline, lang)} data-testid={testIds.svg}>
        <defs>
          <clipPath id={clipId}>
            <rect x={0} y={0} width={revealX} height={H} style={{ transition: trans }} />
          </clipPath>
          <filter id={blurId} x="-5%" y="-5%" width="110%" height="110%">
            <feGaussianBlur stdDeviation="0.9" />
          </filter>
        </defs>

        {/* Neutral full-width track (route length always visible) */}
        <rect x={0} y={SEG_TOP} width={W} height={SEG_BOTTOM - SEG_TOP} fill={TRACK_COLOR} />

        {/* Road bands */}
        {ghostAhead ? (
          <>
            {/* Ahead: blurred + dimmed base spanning the whole route. */}
            <g filter={`url(#${blurId})`} opacity={0.5}>
              {data.segments.map((seg, i) => bandRect(seg, i, false))}
            </g>
            {/* Driven: crisp full-color, revealed up to the playhead. */}
            <g clipPath={`url(#${clipId})`}>
              {data.segments.map((seg, i) => bandRect(seg, i, true))}
            </g>
          </>
        ) : (
          data.segments.map((seg, i) => bandRect(seg, i, true))
        )}

        {/* Traffic-jam sub-bar (feature 020) — a thin bar just above the road
            bar marking painted jam ranges, drawn FORWARD (full width, not
            reveal-clipped) so the reviewer sees where jams are before the car
            reaches them. Guarded with `?? []` so hand-built TimelineData
            fixtures predating the field still render. */}
        {(data.trafficJams ?? []).length > 0 && (
          <g data-testid={testIds.jamGroup}>
            {(data.trafficJams ?? []).map((j, i) => (
              <rect key={`jam-${i}`} x={j.fromX * W} y={JAM_TOP}
                width={Math.max(0, (j.toX - j.fromX) * W)} height={JAM_BOTTOM - JAM_TOP}
                fill={JAM_COLOR} rx={1} />
            ))}
          </g>
        )}

        {/* Threshold lines — drawn FORWARD (full width, not revealed progressively):
            they are per-run constants, so the reviewer sees the bar the score must
            cross before the car reaches it. */}
        {data.restThreshold != null && (
          <g data-testid={testIds.threshold}>
            <line x1={0} x2={W} y1={yPix(data.restThreshold)} y2={yPix(data.restThreshold)}
              stroke={TRIGGER_COLOR} strokeDasharray="4 3" strokeWidth={1} />
            {thresholdLabel != null && (
              <text x={W - 4} y={yPix(data.restThreshold) - 3} fontSize="8" textAnchor="end" fill={TRIGGER_COLOR}>
                {thresholdLabel}
              </text>
            )}
          </g>
        )}
        {data.monotonyThreshold != null && (
          <g data-testid={testIds.monotonyThreshold}>
            <line x1={0} x2={W} y1={yPix(data.monotonyThreshold)} y2={yPix(data.monotonyThreshold)}
              stroke={MONOTONY_COLOR} strokeDasharray="4 3" strokeWidth={1} />
            {monotonyThresholdLabel != null && (
              <text x={4} y={yPix(data.monotonyThreshold) - 3} fontSize="8" textAnchor="start" fill={MONOTONY_COLOR}>
                {monotonyThresholdLabel}
              </text>
            )}
          </g>
        )}

        {/* Rest markers — drawn FORWARD so a chosen rest spot appears immediately at
            its route position the moment the driver selects it (not only once the car
            reaches it). */}
        {data.restDots.length > 0 && (
          <g data-testid={testIds.restSpotGroup}>
            {data.restDots.map((x, i) => (
              // Square, matching the maps. A rest location shares the rest
              // trigger's red, so shape is the ONLY thing saying "place on the
              // route" rather than "a trigger fired here" — the legend below
              // draws its swatch as a square for the same reason.
              <rect key={i} data-testid={testIds.restDot}
                x={x * W - 5.5} y={BAND_MID - 5.5} width={11} height={11} rx={1.5}
                fill={REST_SPOT_COLOR} stroke="#fff" strokeWidth={2}
                aria-label={restDotAriaLabel} />
            ))}
            {/* `@ N min` arrival label to the RIGHT of each rest square, sitting
                INSIDE the road bar (`BAND_MID`) so no curve crosses it — same
                clock/format as the event-info popups, with a white halo to stay
                legible over the colored road fill. Only when the source carries a
                per-dot time (Combined screen). In the live chart the time is null
                until the car reaches the spot, so the dot shows unlabelled until
                arrival. */}
            {data.restDots.map((x, i) => {
              const rt = data.restDotTimes?.[i]
              if (rt == null) return null
              const a = labelRightOf(x * W, W, 8)
              return (
                <text key={`rest-label-${i}`} x={a.x} y={BAND_MID}
                  fontSize="9" fontWeight={600} textAnchor={a.anchor} dominantBaseline="central"
                  fill={REST_SPOT_COLOR} stroke="#fff" strokeWidth={2.5} paintOrder="stroke"
                  strokeLinejoin="round" style={{ pointerEvents: 'none' }}>
                  @ {formatDuration(rt, lang)}
                </text>
              )
            })}
            {/* Journey marker (feature 020): a PURPLE "after-nap service" dot
                stacked above each red rest-spot square. Clickable when
                `onRestOptionClick` is supplied — inspects rest-option `i`'s
                after-nap proposal. (The green "driving-after-rest" dot was
                dropped — owner decision: under rest_recommended there is no
                matrix-valid active_driving_content proposal to project, and on
                the distance axis it collapses onto this same route position.) */}
            {showJourneyMarkers && data.restDots.map((x, i) => (
              <circle key={`nap-${i}`} cx={x * W} cy={BAND_MID - 13} r={5}
                fill={AFTER_NAP_COLOR} stroke="#fff" strokeWidth={1.5}
                style={onRestOptionClick ? { cursor: 'pointer' } : undefined} />
            ))}
            {onRestOptionClick && data.restDots.map((x, i) => (
              <circle key={`nap-hit-${i}`} data-testid={testIds.restOptionHit?.(i)}
                cx={x * W} cy={BAND_MID - 13} r={11} fill="transparent"
                style={{ cursor: 'pointer' }} onClick={() => onRestOptionClick(i)} />
            ))}
          </g>
        )}
        {testIds.restOptionGroup != null && data.restDots.length > 0 && (
          <g data-testid={testIds.restOptionGroup}>
            {data.restDots.map((x, i) => (
              <line key={i} x1={x * W} x2={x * W} y1={SEG_TOP} y2={SEG_BOTTOM}
                stroke="#7c3aed" strokeWidth={1.5} />
            ))}
          </g>
        )}

        {/* Available rest spots (Combined screen) — EVERY rest facility on the
            route, drawn as transparent light-red squares hanging just UNDER the
            road bar with a rounded `@N km` from-start distance beside each.
            Drawn FORWARD (full width, not reveal-clipped) so a reviewer can see
            where a rest was possible relative to where the forecast fired,
            before the car reaches it. Faint on purpose: context, not a
            decision — the solid CHOSEN square sits IN the bar above these. */}
        {(data.availableRestSpots ?? []).length > 0 && (
          <g data-testid={testIds.availableRestGroup}>
            {(data.availableRestSpots ?? []).map((s, i) => {
              const cx = s.x * W
              const a = labelRightOf(cx, W, 7)
              return (
                <g key={`avail-${i}`}>
                  <rect x={cx - 4} y={SEG_BOTTOM + 1} width={8} height={8} rx={1.5}
                    fill={AVAILABLE_REST_FILL} stroke={AVAILABLE_REST_STROKE} strokeWidth={1} />
                  {/* Label ONLY highway spots — normal-road facilities sit too
                      close together and their `@N km` labels overlapped into an
                      unreadable smear (owner review). The square still marks
                      every spot; only the annotation is thinned. */}
                  {s.onHighway && (
                    <text x={a.x} y={SEG_BOTTOM + 5} fontSize="8" fontWeight={600}
                      textAnchor={a.anchor} dominantBaseline="central" fill={AVAILABLE_REST_LABEL}
                      stroke="#fff" strokeWidth={2} paintOrder="stroke" strokeLinejoin="round"
                      style={{ pointerEvents: 'none' }}>
                      {kmLabel(s.km)}
                    </text>
                  )}
                </g>
              )
            })}
          </g>
        )}

        {/* Everything below is a per-tick "decision" → clipped to the revealed region
            so it draws in left-to-right as the run ticks. */}
        <g clipPath={`url(#${clipId})`}>
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
          {/* ── Driver-state band, UNDER the road bar ─────────────────────
              What the DRIVER was doing, on a fixed 0-100 axis: drowsiness and
              fatigue (the physiological signals a rest recovers) and the
              monotony proxy (what content relief freezes and drains). Reading
              it against the road bar directly above shows WHERE on the route
              each curve moved. */}
          {hasSignals && (
            <g data-testid={testIds.signalBand ?? 'timeline-signal-band'}>
              {/* 0 / 50 / 100 guides — without them a flat curve is unreadable. */}
              {[0, 50, 100].map((v) => (
                <line key={v} x1={0} x2={W} y1={sigPix(v)} y2={sigPix(v)}
                  stroke="#e2e8f0" strokeWidth={v === 0 ? 1 : 0.75}
                  strokeDasharray={v === 50 ? '2 3' : undefined} />
              ))}
              {sig.monotony.length > 0 && (
                <polyline data-testid={testIds.monotonyLevelCurve ?? 'timeline-monotony-level'} points={sigPts(sig.monotony)}
                  fill="none" stroke={MONOTONY_LEVEL_COLOR} strokeWidth={1.5} />
              )}
              {sig.fatigue.length > 0 && (
                <polyline data-testid={testIds.fatigueCurve ?? 'timeline-fatigue'} points={sigPts(sig.fatigue)}
                  fill="none" stroke={FATIGUE_COLOR} strokeWidth={1.5} />
              )}
              {sig.drowsiness.length > 0 && (
                <polyline data-testid={testIds.drowsinessCurve ?? 'timeline-drowsiness'} points={sigPts(sig.drowsiness)}
                  fill="none" stroke={DROWSINESS_COLOR} strokeWidth={1.8} />
              )}
            </g>
          )}
          {data.fires.length > 0 && (
            <FireGroup
              testIds={testIds}
              fires={data.fires}
              W={W}
              top={CURVE_TOP}
              bottom={SIG_BOTTOM}
              bandMid={BAND_MID}
              onFireClick={onFireClick}
              lang={lang}
            />
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

      {showLegend && (
        <div data-testid={testIds.legend}
          style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', fontSize: '0.72em', color: '#6b7280', margin: '2px 0 0' }}>
          <LegendLine color={REST_COLOR} label={t({ en: 'Dangerous-driving-prevention score', ja: '危険運転防止スコア' }, lang)} />
          {data.monotonyScore.length > 0 && <LegendLine color={MONOTONY_COLOR} label={t({ en: 'Inattentive-driving-prevention score', ja: '漫然運転予防スコア' }, lang)} />}
          {/* ONE ENTRY PER THRESHOLD LINE, each in its own line's color. There
              used to be a single red "Firing threshold" entry standing for BOTH
              the red rest rule and the teal monotony rule — and because the two
              thresholds are equal by default the teal line paints over the red
              one, so the only rule a reviewer could SEE was the one the key did
              not describe. No caller passes `thresholdLabel`, so the legend is
              the only place these lines are ever named. */}
          {data.restThreshold != null && (
            <LegendLine color={TRIGGER_COLOR}
              label={t({ en: 'Rest firing threshold', ja: '休憩の発火しきい値' }, lang)} dashed />
          )}
          {data.monotonyThreshold != null && (
            <LegendLine color={MONOTONY_COLOR}
              label={t({ en: 'Monotony firing threshold', ja: '単調性の発火しきい値' }, lang)} dashed />
          )}
          {/* One entry per trigger type actually drawn — a reviewer must be able
              to name the red and the orange rules without decoding them. */}
          {data.fires.some((f) => f.kind === 'rest') && (
            <LegendLine color={TRIGGER_REST_COLOR}
              label={t({ en: 'Rest trigger fired', ja: '休憩トリガー発火' }, lang)} />
          )}
          {data.fires.some((f) => f.kind !== 'rest') && (
            <LegendLine color={TRIGGER_MONOTONY_COLOR}
              label={t({ en: 'Monotony trigger fired', ja: '単調性トリガー発火' }, lang)} dashed />
          )}
          {presentSegTypes.map((type) => (
            <LegendSwatch key={type} color={SEGMENT_COLORS[type] ?? DEFAULT_SEGMENT_COLOR}
              label={segLabel(type, lang)} />
          ))}
          {hasSignals && sig.drowsiness.length > 0 && (
            <LegendLine color={DROWSINESS_COLOR} label={t({ en: 'Drowsiness (0-100)', ja: '眠気 (0-100)' }, lang)} />
          )}
          {hasSignals && sig.fatigue.length > 0 && (
            <LegendLine color={FATIGUE_COLOR} label={t({ en: 'Fatigue (0-100)', ja: '疲労度 (0-100)' }, lang)} />
          )}
          {hasSignals && sig.monotony.length > 0 && (
            <LegendLine color={MONOTONY_LEVEL_COLOR} label={t({ en: 'Monotony level (0-100)', ja: '単調度 (0-100)' }, lang)} />
          )}
          {(data.trafficJams ?? []).length > 0 && <LegendSwatch color={JAM_COLOR} label={t({ en: 'traffic jam', ja: '渋滞' }, lang)} />}
          {data.restDots.length > 0 && <LegendDot square color={REST_SPOT_COLOR} label={t({ en: showJourneyMarkers ? 'rest location' : 'chosen rest location', ja: showJourneyMarkers ? '休憩場所' : '選択した休憩場所' }, lang)} />}
          {(data.availableRestSpots ?? []).length > 0 && <LegendDot square color={AVAILABLE_REST_STROKE} label={t({ en: 'available rest spot', ja: '休憩可能地点' }, lang)} />}
          {showJourneyMarkers && data.restDots.length > 0 && <LegendDot color={AFTER_NAP_COLOR} label={t({ en: 'after-rest service', ja: '休憩後サービス' }, lang)} />}
        </div>
      )}
    </div>
  )
}

// Wider-than-the-line invisible hit-rect half-width (px) — a 2px-wide fire
// line is nearly impossible to click precisely; the hit-rect gives it a
// comfortable click/tap target without changing what's visibly drawn.
const FIRE_HIT_HALF_WIDTH = 8

/** Place a marker's `@ N min` label to the RIGHT of the marker (a small `gap`
 *  past it, so it reads as "this event, then its time"), flipping to the LEFT
 *  only when the text would run off the right edge. `gap` clears the marker's
 *  own glyph: ~3px past a thin fire line, ~8px past the wider rest square. */
function labelRightOf(xPx: number, W: number, gap: number): { x: number; anchor: 'start' | 'end' } {
  // ~34px is a comfortable width for the longest label ("@ 5h 20m"); flip to the
  // left of the marker before the text would be clipped by the SVG's right edge.
  if (xPx > W - 34) return { x: xPx - gap, anchor: 'end' }
  return { x: xPx + gap, anchor: 'start' }
}

function FireGroup({ testIds, fires, W, top, bottom, bandMid, onFireClick, lang }: {
  testIds: ScoreTimelineTestIds
  fires: TimelineFire[]
  W: number; top: number; bottom: number
  /** Vertical center of the road bar — where the `@ N min` label sits, so no
   *  score/signal curve crosses through it. */
  bandMid: number
  onFireClick?: (fire: TimelineFire, index: number) => void
  lang: UiLanguage
}) {
  const nodes = fires.flatMap((f, i) => {
    const isRest = f.kind === 'rest'
    const fireColor = isRest ? TRIGGER_COLOR : TRIGGER_MONOTONY_COLOR
    // A monotony fire is a FIRE, drawn at the same weight and opacity as a rest
    // fire. It used to be a 1px, 0.7-opacity dashed line in MONOTONY_COLOR — the
    // same teal as the monotony SCORE CURVE it is drawn on top of — which is why
    // monotony triggers read as absent from this strip. Color now carries the
    // category (validated against the rest red — see lib/review/triggerColors)
    // and the dash pattern stays as a redundant, non-color channel.
    const line = (
      <line key={`fire-${i}`} data-testid={isRest ? testIds.fire : (testIds.monotonyFire ?? testIds.fire)}
        x1={f.x * W} x2={f.x * W} y1={top} y2={bottom}
        stroke={fireColor} strokeWidth={2}
        strokeDasharray={isRest ? undefined : '4 3'} opacity={1} />
    )
    // `@ N min` time label to the RIGHT of the fire line, sitting INSIDE the road
    // bar (`bandMid`) — the one horizontal zone no score/signal curve crosses, so
    // nothing obstructs it. Same clock and format the event-info popups use
    // (`formatDuration`). A white halo (paint-order stroke) keeps it legible over
    // any colored road fill. Only drawn when the source carries `timeMin` (the
    // Combined screen's builders do; the Trigger-screen builders leave it
    // undefined, so those charts are unaffected).
    const label =
      f.timeMin != null ? (
        (() => {
          const a = labelRightOf(f.x * W, W, 3)
          return (
            <text key={`fire-label-${i}`} x={a.x} y={bandMid} fontSize="9" fontWeight={600}
              textAnchor={a.anchor} dominantBaseline="central" fill={fireColor}
              stroke="#fff" strokeWidth={2.5} paintOrder="stroke" strokeLinejoin="round"
              style={{ pointerEvents: 'none' }}>
              @ {formatDuration(f.timeMin, lang)}
            </text>
          )
        })()
      ) : null
    // Additive only when a caller opts in via onFireClick — when it's
    // undefined (every pre-existing usage) AND no label is drawn, `nodes` is
    // exactly `[line, line, ...]`, byte-identical to the render before this.
    if (!onFireClick) return label ? [line, label] : [line]
    const hit = (
      <rect key={`fire-hit-${i}`} data-testid={testIds.fireHit?.(i)}
        x={f.x * W - FIRE_HIT_HALF_WIDTH} y={top} width={FIRE_HIT_HALF_WIDTH * 2} height={bottom - top}
        fill="transparent" style={{ cursor: 'pointer' }}
        onClick={() => onFireClick(f, i)} />
    )
    return label ? [line, hit, label] : [line, hit]
  })
  return testIds.fireGroup ? <g data-testid={testIds.fireGroup}>{nodes}</g> : <>{nodes}</>
}

/** Legend entry for a score/threshold line (colored line + label). */
function LegendLine({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
      <span style={{
        width: '16px', height: 0, borderTop: `2px ${dashed ? 'dashed' : 'solid'} ${color}`,
        display: 'inline-block',
      }} />
      {label}
    </span>
  )
}

/** Legend entry for a road-type band (colored swatch + label). */
function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
      <span style={{ width: '12px', height: '10px', background: color, display: 'inline-block', borderRadius: '2px' }} />
      {label}
    </span>
  )
}

/** Legend entry for a marker (colored swatch + label).
 *
 * `square` must mirror the marker's own shape — the rest-LOCATION marker is a
 * square on the strip and on both maps, so its key entry is a square too. */
function LegendDot({ color, label, square }: { color: string; label: string; square?: boolean }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
      <span style={{ width: '10px', height: '10px', background: color, display: 'inline-block', borderRadius: square ? '2px' : '50%', border: '1px solid #fff', boxShadow: '0 0 0 1px #d1d5db' }} />
      {label}
    </span>
  )
}
