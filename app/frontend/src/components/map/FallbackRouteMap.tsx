/**
 * FallbackRouteMap — the map shown when no Google Maps key is present.
 *
 * This is NOT a decorative placeholder. It draws the SAME route the real map
 * would: the preset's encoded polyline decoded and projected to an SVG path,
 * with the true start and destination names, the real total distance, and every
 * marker at its real route fraction. Without a key the reviewer still needs to
 * see WHERE a trigger fired and where the rest spots are, and a grey box does
 * not answer that.
 *
 * Fractions are fractions of DISTANCE (that is what the tick engine reports),
 * so markers are placed by cumulative path length rather than by vertex index —
 * see `polyline.ts`.
 */
import { useMemo } from 'react'
import { decodePolyline, projectToUnitBox, cumulativeFractions, pointAtFraction } from './polyline'
import { t } from '../../i18n/t'
import type { UiLanguage } from '../../i18n/t'

const LABELS = {
  noKey: { ja: 'Google マップキーなし — ルート概略図', en: 'No Google Maps key — route schematic' },
  noRoute: { ja: 'ルートが選択されていません。', en: 'No route selected.' },
  start: { ja: '出発', en: 'Start' },
  end: { ja: '目的地', en: 'Destination' },
  trigger: { ja: 'トリガー', en: 'trigger' },
  restSpot: { ja: '休憩地点', en: 'rest spot' },
  car: { ja: '現在地', en: 'car' },
}

/** One clickable trigger position on the route. */
export type MapFireMarker = {
  /** Route fraction 0-1. */
  fraction: number
  /** Index into the quickview's `fires`, so a click can inspect the same one. */
  index: number
  category: string | null
  timeMin?: number | null
}

export type MapRestMarker = {
  fraction: number
  label?: string | null
}

// The drawn box. Coordinates are 0-1 from the projector, scaled into this.
const W = 600
const H = 340
const PAD = 26

export default function FallbackRouteMap({
  encodedPolyline,
  startName,
  endName,
  totalKm,
  fires = [],
  restSpots = [],
  carFraction = null,
  inspectedFireIndex = null,
  onFireClick,
  lang,
}: {
  encodedPolyline: string | null | undefined
  startName?: string | null
  endName?: string | null
  totalKm?: number | null
  fires?: MapFireMarker[]
  restSpots?: MapRestMarker[]
  /** Null before playback starts — the car is only drawn once it is running. */
  carFraction?: number | null
  inspectedFireIndex?: number | null
  onFireClick?: (index: number) => void
  lang: UiLanguage
}): JSX.Element {
  const geometry = useMemo(() => {
    const unit = projectToUnitBox(decodePolyline(encodedPolyline))
    if (unit.length === 0) return null
    const pts = unit.map((p) => ({ x: PAD + p.x * (W - 2 * PAD), y: PAD + p.y * (H - 2 * PAD) }))
    return { pts, cum: cumulativeFractions(pts) }
  }, [encodedPolyline])

  if (!geometry) {
    return (
      <div
        data-testid="fallback-route-map-empty"
        style={{
          height: '100%', minHeight: '220px', display: 'flex', alignItems: 'center',
          justifyContent: 'center', background: '#f8fafc', border: '1px dashed #cbd5e1',
          borderRadius: '6px', color: '#94a3b8', fontSize: '0.82em',
        }}
      >
        {t(LABELS.noRoute, lang)}
      </div>
    )
  }

  const { pts, cum } = geometry
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  const at = (f: number) => pointAtFraction(pts, cum, f)
  const carPos = carFraction != null ? at(carFraction) : null
  const startPos = pts[0]
  const endPos = pts[pts.length - 1]

  return (
    <div data-testid="fallback-route-map" style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '8px', marginBottom: '2px' }}>
        <span style={{ fontSize: '0.68em', color: '#94a3b8' }}>{t(LABELS.noKey, lang)}</span>
        {totalKm != null && (
          <span data-testid="fallback-map-distance" style={{ fontSize: '0.7em', color: '#475569', fontFamily: 'ui-monospace, monospace' }}>
            {totalKm.toFixed(0)} km
          </span>
        )}
      </div>

      <svg
        data-testid="fallback-map-svg"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`${startName ?? ''} → ${endName ?? ''}`}
        style={{ width: '100%', height: '100%', minHeight: 0, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px' }}
      >
        {/* Route: a wide pale casing under a thinner line, so markers stay legible on top. */}
        <path d={d} fill="none" stroke="#cbd5e1" strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" />
        <path d={d} fill="none" stroke="#64748b" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />

        {/* Rest spots — drawn before fires so a coincident trigger sits on top. */}
        {restSpots.map((r, i) => {
          const p = at(r.fraction)
          if (!p) return null
          return (
            <circle
              key={`rest-${i}`}
              data-testid={`fallback-map-rest-${i}`}
              cx={p.x} cy={p.y} r={5}
              fill="#f59e0b" stroke="#fff" strokeWidth={2}
            >
              <title>{`${t(LABELS.restSpot, lang)}${r.label ? `: ${r.label}` : ''}`}</title>
            </circle>
          )
        })}

        {fires.map((f) => {
          const p = at(f.fraction)
          if (!p) return null
          const selected = inspectedFireIndex === f.index
          const isRest = (f.category ?? '').startsWith('rest')
          return (
            <g key={`fire-${f.index}`}>
              <circle
                cx={p.x} cy={p.y} r={selected ? 9 : 7}
                fill={isRest ? '#dc2626' : '#7c3aed'}
                stroke="#fff" strokeWidth={selected ? 3 : 2}
              />
              {/* Generous transparent hit area — a 7px dot is hard to hit. */}
              <circle
                data-testid={`fallback-map-fire-${f.index}`}
                cx={p.x} cy={p.y} r={14}
                fill="transparent"
                style={{ cursor: onFireClick ? 'pointer' : 'default' }}
                onClick={() => onFireClick?.(f.index)}
              >
                <title>
                  {`${t(LABELS.trigger, lang)}: ${f.category ?? ''}${f.timeMin != null ? ` · ${Math.round(f.timeMin)} min` : ''}`}
                </title>
              </circle>
            </g>
          )
        })}

        {/* Endpoints last, so they are never hidden under a marker. */}
        <circle cx={startPos.x} cy={startPos.y} r={6} fill="#22c55e" stroke="#fff" strokeWidth={2} />
        <circle cx={endPos.x} cy={endPos.y} r={6} fill="#0f172a" stroke="#fff" strokeWidth={2} />

        {carPos && (
          <circle
            data-testid="fallback-map-car"
            cx={carPos.x} cy={carPos.y} r={6}
            fill="#2563eb" stroke="#fff" strokeWidth={2}
          >
            <title>{t(LABELS.car, lang)}</title>
          </circle>
        )}
      </svg>

      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', marginTop: '3px', fontSize: '0.7em', color: '#475569' }}>
        <span data-testid="fallback-map-start">🟢 {startName ?? t(LABELS.start, lang)}</span>
        <span data-testid="fallback-map-end">⚫ {endName ?? t(LABELS.end, lang)}</span>
      </div>
    </div>
  )
}
