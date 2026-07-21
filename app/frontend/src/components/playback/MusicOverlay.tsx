/**
 * MusicOverlay — a compact "now playing" card layered on the cockpit map.
 *
 * Mirrors the functional skeleton's rest-stop music information: when the drive
 * is at a rest facility (active segment is_rest_facility), AICA's recovery
 * content is playing, so we surface a small now-playing card in the map's top
 * corner. Returns null when not at a rest stop, so it only appears during
 * recovery.
 *
 * Display-only and intentionally lightweight (no audio, no animation engine) —
 * a marker that recovery content is active, not a media player.
 */
import { useEffect, useState } from 'react'
import { useRunStore } from '../../state/runStore'
import { getScenario } from '../../api/client'
import type { RouteSegment } from '../../api/types'
import { t } from '../../i18n/t'

const LABELS = {
  nowPlayingRecovery: { ja: '再生中・回復', en: 'Now playing · recovery' },
  restStop: { ja: '休憩施設', en: 'Rest stop' },
}

export default function MusicOverlay() {
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
  const activeSegment =
    [...segments].sort((a, b) => b.at - a.at).find((s) => s.at <= routeFraction) ?? null

  if (!runState || !activeSegment?.is_rest_facility) return null

  const restName = t(activeSegment.name, uiLanguage)

  return (
    <div
      data-testid="music-overlay"
      style={{
        position: 'absolute',
        top: '8px',
        right: '8px',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '6px 10px',
        background: 'rgba(8,12,20,0.92)',
        border: '1px solid #5bc0be',
        borderRadius: '8px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
        zIndex: 20,
        maxWidth: '60%',
      }}
    >
      <span aria-hidden style={{ fontSize: '1.1em' }}>🎵</span>
      <div style={{ overflow: 'hidden' }}>
        <div style={{ fontSize: '0.62rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#5bc0be', fontWeight: 700 }}>
          {t(LABELS.nowPlayingRecovery, uiLanguage)}
        </div>
        <div
          style={{
            fontSize: '0.8rem',
            color: '#e7eef2',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {restName || t(LABELS.restStop, uiLanguage)}
        </div>
      </div>
    </div>
  )
}
