/**
 * RouteStatus — left-panel route stats readout.
 * Shows distance from start, distance to destination, current speed, and ETA.
 */
import { useRunStore } from '../../state/runStore'
import { useRouteProgress } from '../playback/useRouteProgress'
import { t } from '../../i18n/t'
import type { RouteFacts, TraceEntry } from '../../api/types'

const labelStyle: React.CSSProperties = {
  fontSize: '0.62rem',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: '#2563eb',
  fontWeight: 700,
}
const valueStyle: React.CSSProperties = {
  fontSize: '1.1rem',
  fontWeight: 700,
  color: '#1e3a8a',
  fontVariantNumeric: 'tabular-nums',
  marginBottom: '8px',
}

function Row({ label, value, last }: { label: string; value: string | null; last?: boolean }) {
  return (
    <>
      <div style={labelStyle}>{label}</div>
      <div style={{ ...valueStyle, marginBottom: last ? 0 : '8px' }}>{value ?? '—'}</div>
    </>
  )
}

export default function RouteStatus() {
  const { state } = useRunStore()
  const { currentFraction, hasRun } = useRouteProgress()
  const { uiLanguage, trace } = state

  const rf = state.runState?.route_facts as RouteFacts | undefined
  const totalKm = rf?.total_route_distance_km ?? null
  const totalDurationMin = rf?.estimated_route_duration_min ?? null

  const lastEntry = trace.length > 0 ? (trace[trace.length - 1] as TraceEntry) : null

  const distFromStart = hasRun && totalKm != null
    ? `${(totalKm * currentFraction).toFixed(1)} km`
    : null

  const distToDest = hasRun && totalKm != null
    ? `${(totalKm * (1 - currentFraction)).toFixed(1)} km`
    : null

  const speed = hasRun && lastEntry?.speed_kph != null
    ? `${Math.round(lastEntry.speed_kph)} km/h`
    : null

  const remainingMin = hasRun && totalDurationMin != null
    ? Math.max(0, Math.round(totalDurationMin * (1 - currentFraction)))
    : null
  const eta = remainingMin != null
    ? (uiLanguage === 'ja' ? `約 ${remainingMin} 分` : `~${remainingMin} min`)
    : null

  const L = {
    distFromStart:  t({ ja: '出発からの距離',   en: 'Distance from start' },      uiLanguage),
    distToDest:     t({ ja: '目的地までの距離',  en: 'Distance to destination' },  uiLanguage),
    speed:          t({ ja: '現在速度',           en: 'Current speed' },            uiLanguage),
    eta:            t({ ja: '到着予定',           en: 'Est. arrival' },             uiLanguage),
  }

  return (
    <div data-testid="route-status" style={{ padding: '10px 12px', background: '#eff6ff', borderRadius: '6px' }}>
      <Row label={L.distFromStart} value={distFromStart} />
      <Row label={L.distToDest}    value={distToDest} />
      <Row label={L.speed}         value={speed} />
      <Row label={L.eta}           value={eta} last />
    </div>
  )
}
