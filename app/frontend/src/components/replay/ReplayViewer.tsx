import { useState, useEffect, useMemo } from 'react'
import { getRunLog } from '../../api/client'
import { createReplaySource } from '../../replay/replaySource'
import ReplayControls from './ReplayControls'
import CockpitView from '../playback/CockpitView'
import RouteTimeline from '../playback/RouteTimeline'
import DecisionTracePanel from '../trace/DecisionTracePanel'
import { useRunStore } from '../../state/runStore'
import { t } from '../../i18n/t'
import type { RunLog } from '../../api/types'

type Props = { runId: string }

export default function ReplayViewer({ runId }: Props) {
  const { state } = useRunStore()
  const { uiLanguage } = state
  const [log, setLog] = useState<RunLog | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [currentTick, setCurrentTick] = useState(0)

  // Memoize: log only changes once after fetch — avoid rebuilding the O(n) map+sort on every render/scrub.
  const source = useMemo(() => (log ? createReplaySource(log) : null), [log])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setLog(null)
    const doFetch = async () => {
      try {
        const result = await getRunLog(runId)
        if (cancelled) return
        // Guard: result must be a valid RunLog-shaped object
        if (result && typeof result === 'object' && 'events' in result) {
          const runLog = result as RunLog
          setLog(runLog)
          // Initialise scrubber at the first recorded tick
          const first = runLog.events.find((e) => e.kind === 'tick')
          if (first && first.kind === 'tick') setCurrentTick(first.tick_index)
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    doFetch()
    return () => {
      cancelled = true
    }
  }, [runId])

  if (loading) {
    return (
      <div data-testid="replay-viewer" style={{ padding: '8px', color: '#aaa', fontSize: '0.85em' }}>
        {t({ ja: '再生データを読み込み中…', en: 'Loading replay…' }, uiLanguage)}
      </div>
    )
  }

  if (error) {
    return (
      <div
        data-testid="replay-viewer"
        style={{ padding: '8px', color: '#f66', fontSize: '0.85em' }}
      >
        {t({ ja: 'エラー: ', en: 'Error: ' }, uiLanguage)}
        {error}
      </div>
    )
  }

  if (!log || !source) return null

  const replayTick = source.getAt(currentTick)

  return (
    <div
      data-testid="replay-viewer"
      style={{
        marginTop: '12px',
        border: '1px solid #2a2a2a',
        borderRadius: '4px',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '4px 8px',
          background: '#1a1a1a',
          fontWeight: 700,
          fontSize: '0.8em',
          letterSpacing: '0.05em',
          color: '#aaa',
          borderBottom: '1px solid #2a2a2a',
        }}
      >
        {t({ ja: 'ビジュアル再生', en: 'VISUAL REPLAY' }, uiLanguage)}
      </div>
      <div style={{ padding: '8px' }}>
        <ReplayControls source={source} currentTick={currentTick} onSeek={setCurrentTick} />
        {replayTick === null ? (
          <div
            data-testid="replay-no-tick"
            style={{ padding: '12px', color: '#aaa', fontSize: '0.85em', textAlign: 'center' }}
          >
            {t(
              { ja: 'このティックに記録データがありません', en: 'No recorded data for this tick' },
              uiLanguage,
            )}
          </div>
        ) : (
          <>
            <RouteTimeline replayTick={replayTick} />
            <CockpitView replayTick={replayTick} />
            <DecisionTracePanel replayTick={replayTick} />
          </>
        )}
      </div>
    </div>
  )
}
