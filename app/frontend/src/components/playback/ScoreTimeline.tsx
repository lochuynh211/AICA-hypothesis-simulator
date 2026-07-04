import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
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
  thresholdLabel?: string
  monotonyThresholdLabel?: string
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
  thresholdLabel, monotonyThresholdLabel,
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
          {testIds.restOptionGroup != null && data.restDots.length > 0 && (
            <g data-testid={testIds.restOptionGroup}>
              {data.restDots.map((x, i) => (
                <line key={i} x1={x * W} x2={x * W} y1={SEG_TOP} y2={SEG_BOTTOM}
                  stroke="#7c3aed" strokeWidth={1.5} />
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
