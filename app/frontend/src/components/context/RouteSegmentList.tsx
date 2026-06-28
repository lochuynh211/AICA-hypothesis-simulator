import { useEffect, useState } from 'react'
import { useRunStore } from '../../state/runStore'
import { getScenario } from '../../api/client'
import type { RouteSegment } from '../../api/types'
import { t } from '../../i18n/t'

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
    return <p style={{ padding: '8px', fontSize: '0.85em', color: '#888' }}>No route loaded</p>
  }

  return (
    <ul style={{ listStyle: 'none', padding: '0', margin: '0' }}>
      {segments.map((seg) => (
        <li
          key={seg.id}
          style={{
            padding: '6px 8px',
            background: seg.id === activeSegment?.id ? '#dbeafe' : 'transparent',
            borderLeft: seg.id === activeSegment?.id ? '3px solid #2563eb' : '3px solid transparent',
            fontSize: '0.85em',
          }}
        >
          {t(seg.name, uiLanguage)}
          <span style={{ color: '#888', marginLeft: '4px' }}>({seg.type})</span>
          {seg.is_rest_facility && <span style={{ marginLeft: '4px', color: '#059669' }}>⊙ rest</span>}
        </li>
      ))}
    </ul>
  )
}
