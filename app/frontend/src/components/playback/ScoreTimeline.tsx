import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { timelineYDomain, type TimelineData } from './timelineData'
import { t, type UiLanguage, type BilingualLabel } from '../../i18n/t'

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

/** Localized road-band label; falls back to the raw segment_type when unknown. */
export function segLabel(type: string, lang: UiLanguage): string {
  const label = SEGMENT_LABELS[type]
  return label ? t(label, lang) : type
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
  legend?: string
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
  thresholdLabel?: string
  monotonyThresholdLabel?: string
  restDotAriaLabel?: string
  /** Render a color legend (rest/monotony score, road bands, rest spot, threshold)
   *  below the SVG. Off by default so the Setup strip (which owns its own legend)
   *  is unaffected; the Review timeline turns it on. */
  showLegend?: boolean
  /** UI language for the built-in legend labels (default 'en'). */
  lang?: UiLanguage
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
        aria-label="Route timeline" data-testid={testIds.svg}>
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
              <circle key={i} data-testid={testIds.restDot} cx={x * W} cy={BAND_MID} r={6}
                fill={REST_SPOT_COLOR} stroke="#fff" strokeWidth={2}
                aria-label={restDotAriaLabel} />
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
          {data.fires.length > 0 && (
            <FireGroup testIds={testIds} fires={data.fires} W={W} top={CURVE_TOP} bottom={SEG_BOTTOM} />
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
          <LegendLine color={REST_COLOR} label={t({ en: 'rest-propose score', ja: '休憩提案スコア' }, lang)} />
          {data.monotonyScore.length > 0 && <LegendLine color={MONOTONY_COLOR} label={t({ en: 'monotony score', ja: '単調性スコア' }, lang)} />}
          {data.restThreshold != null && <LegendLine color={TRIGGER_COLOR} label={t({ en: 'threshold', ja: 'しきい値' }, lang)} dashed />}
          {presentSegTypes.map((type) => (
            <LegendSwatch key={type} color={SEGMENT_COLORS[type] ?? DEFAULT_SEGMENT_COLOR}
              label={segLabel(type, lang)} />
          ))}
          {data.restDots.length > 0 && <LegendDot color={REST_SPOT_COLOR} label={t({ en: 'chosen rest spot', ja: '選択した休憩地点' }, lang)} />}
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

/** Legend entry for the chosen-rest-spot dot (colored dot + label). */
function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
      <span style={{ width: '10px', height: '10px', background: color, display: 'inline-block', borderRadius: '50%', border: '1px solid #fff', boxShadow: '0 0 0 1px #d1d5db' }} />
      {label}
    </span>
  )
}
