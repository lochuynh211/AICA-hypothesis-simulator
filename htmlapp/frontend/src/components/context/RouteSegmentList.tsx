import { useEffect, useState } from 'react'
import { useRunStore } from '../../state/runStore'
import { getScenario } from '../../api/client'
import type { RouteSegment } from '../../api/types'
import { t } from '../../i18n/t'

const LABELS = {
  noRouteLoaded: { ja: 'ルート未読み込み', en: 'No route loaded' },
  rest: { ja: '休憩', en: 'rest' },
}

export default function RouteSegmentList() {
  const { state } = useRunStore()
  const { selectedScenarioId, runState, uiLanguage } = state
  const [segments, setSegments] = useState<RouteSegment[]>([])

  useEffect(() => {
    if (!selectedScenarioId) {
      setSegments([])
      return
    }
    getScenario(selectedScenarioId)
      .then((def) => setSegments(def.route_intent.segments))
      .catch(() => setSegments([]))
  }, [selectedScenarioId])

  const ep = runState?.event_plan as { ticks?: Array<{ route_fraction: number }> } | undefined
  const routeFraction = ep?.ticks?.[runState?.current_tick ?? 0]?.route_fraction ?? 0

  // Active segment: last segment whose `at` is <= routeFraction
  const sorted = [...segments].sort((a, b) => b.at - a.at)
  const activeSegment = sorted.find((s) => s.at <= routeFraction)

  if (segments.length === 0) {
    return <p style={{ padding: '8px', fontSize: '0.85em', color: '#888' }}>{t(LABELS.noRouteLoaded, uiLanguage)}</p>
  }

  return (
    <ul style={{ listStyle: 'none', padding: '0', margin: '0', display: 'flex', flexDirection: 'column', gap: '4px' }}>
      {segments.map((seg) => {
        const active = seg.id === activeSegment?.id
        return (
          <li
            key={seg.id}
            data-testid={`route-segment-${seg.id}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '6px 8px',
              borderRadius: '6px',
              border: '1px solid #e5e7eb',
              borderLeft: active ? '3px solid #2563eb' : '3px solid #e5e7eb',
              background: active ? '#dbeafe' : '#fff',
              fontSize: '0.85em',
              fontWeight: active ? 600 : 400,
            }}
          >
            <span aria-hidden style={{ fontSize: '1em' }}>{segIcon(seg)}</span>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {t(seg.name, uiLanguage)}
            </span>
            {seg.is_rest_facility && (
              <span style={{ color: '#059669', fontSize: '0.82em', fontWeight: 700 }}>⊙ {t(LABELS.rest, uiLanguage)}</span>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/** Emoji glyph for a route segment by type / rest-facility flag. */
function segIcon(seg: RouteSegment): string {
  if (seg.is_rest_facility || seg.type === 'rest') return '☕'
  switch (seg.type) {
    case 'start':
      return '🏁'
    case 'end':
      return '🏁'
    case 'highway':
      return '🛣️'
    case 'national':
      return '🛤️'
    case 'urban':
      return '🏙️'
    case 'residential':
      return '🏘️'
    default:
      return '📍'
  }
}
