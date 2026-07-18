/**
 * MergedReplayViewer — read-only correlation replay for one persisted merged
 * run (feature 020, Slice-2c, Task 6).
 *
 * Fetches `getMergedRun(mergedRunId)` (pure disk read — `GET
 * /api/merged-runs/{id}`, never recomputes anything), memoizes a
 * `MergedReplaySource` over the returned `trigger_log`/`proposal_logs`/
 * `correlation_log`, and renders:
 *   - `ReplayControls`, reused VERBATIM from the trigger-only Replay screen,
 *     scrubbing the SAME trigger tick range this run recorded.
 *   - A read-only merged trace: the trigger decision at the current tick
 *     plus any proposal events correlated to it — no live tick/action
 *     controls anywhere in this subtree (mirrors `RunsScreen`'s read-only
 *     discipline: explicit id prop, no Play/Choose/accept-rest affordances).
 *
 * `ReplayControls` hard-depends on `useRunStore()` for `uiLanguage` (unlike
 * `ScoreTimeline`, it is not prop-driven). Merged mode has no
 * `RunStoreProvider` ancestor (feature-020 isolation — `mergedClient.ts`'s
 * module doc / `mergedCoordinator.tsx` never import `runStore`), so this
 * component wraps just its own `ReplayControls` usage in a FRESH, throwaway
 * `RunStoreProvider` instance — never the live trigger run's store, and
 * nothing here ever dispatches into it — purely to satisfy that one hook.
 */
import { useEffect, useMemo, useState } from 'react'
import { RunStoreProvider } from '../../state/runStore'
import ReplayControls from '../replay/ReplayControls'
import type { ReplaySource } from '../../replay/replaySource'
import { getMergedRun } from '../../api/mergedClient'
import { createMergedReplaySource } from '../../replay/mergedReplaySource'
import type { RunLog } from '../../api/types'
import type { ProposalRunLog } from '../../api/proposalClient'
import type { MergedRunHandle } from '../../api/mergedClient'

type Props = { mergedRunId: string }

type Loaded = {
  handle: MergedRunHandle
  trigger_log: RunLog | null
  proposal_logs: ProposalRunLog[]
}

export default function MergedReplayViewer({ mergedRunId }: Props) {
  const [data, setData] = useState<Loaded | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [currentTick, setCurrentTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setData(null)
    getMergedRun(mergedRunId)
      .then((result) => {
        if (cancelled) return
        setData(result)
        const firstTickEvent = result.trigger_log?.events.find((e) => e.kind === 'tick')
        if (firstTickEvent && firstTickEvent.kind === 'tick') {
          setCurrentTick(firstTickEvent.tick_index)
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [mergedRunId])

  // Memoize: data only changes once after fetch — avoid rebuilding the
  // O(n) map+sort on every scrub (mirrors ReplayViewer.tsx's source memo).
  const source = useMemo(
    () =>
      data
        ? createMergedReplaySource({
            trigger_log: data.trigger_log,
            proposal_logs: data.proposal_logs,
            correlation: data.handle.correlation_log,
          })
        : null,
    [data],
  )

  if (loading) {
    return (
      <div data-testid="merged-replay-viewer" style={{ padding: '8px', color: '#aaa', fontSize: '0.85em' }}>
        Loading replay…
      </div>
    )
  }

  if (error) {
    return (
      <div
        data-testid="merged-replay-viewer"
        role="alert"
        style={{ padding: '8px', color: '#f66', fontSize: '0.85em' }}
      >
        Error: {error}
      </div>
    )
  }

  if (!data || !source) return null

  const tick = source.getAt(currentTick)

  // ReplayControls only reads minIndex/maxIndex/tickCount off `source` (it
  // never calls `.getAt` itself — see replay/ReplayControls.tsx) but its
  // `source` prop is typed as the trigger-only `ReplaySource`
  // (`getAt(tick) -> ReplayTick | null`), not our `MergedReplaySource`
  // (`getAt(tick) -> {trigger, proposalEvents}`). Adapt rather than widen
  // ReplayControls' prop type — it is reused VERBATIM, unmodified.
  const replayControlsSource: ReplaySource = {
    tickCount: source.tickCount,
    minIndex: source.minIndex,
    maxIndex: source.maxIndex,
    getAt: (tickIndex: number) => source.getAt(tickIndex).trigger,
  }

  return (
    <div
      data-testid="merged-replay-viewer"
      style={{ border: '1px solid #2a2a2a', borderRadius: '4px', overflow: 'hidden', background: '#111' }}
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
        MERGED REPLAY — {mergedRunId}{' '}
        <span style={{ fontWeight: 400, color: '#666' }}>(read-only)</span>
      </div>

      <div style={{ padding: '8px' }}>
        {/* Fresh, isolated instance — see module doc. */}
        <RunStoreProvider>
          <ReplayControls source={replayControlsSource} currentTick={currentTick} onSeek={setCurrentTick} />
        </RunStoreProvider>

        {tick.trigger === null ? (
          <div
            data-testid="merged-replay-no-tick"
            style={{ padding: '12px', color: '#aaa', fontSize: '0.85em', textAlign: 'center' }}
          >
            No recorded trigger data for this tick
          </div>
        ) : (
          <div
            data-testid={`merged-replay-trigger-${tick.trigger.tick_index}`}
            style={{
              borderBottom: '1px solid #2a2a2a',
              padding: '6px 4px',
              fontSize: '0.85em',
              fontFamily: 'monospace',
            }}
          >
            <span style={{ color: '#6af', fontWeight: 700 }}>tick#{tick.trigger.tick_index}</span>{' '}
            <span style={{ color: '#ffe066', fontWeight: 700 }}>{tick.trigger.decision.result_type}</span>
            {tick.trigger.decision.selected_category && (
              <span style={{ color: '#8f8', marginLeft: '10px' }}>
                cat={tick.trigger.decision.selected_category}
              </span>
            )}
          </div>
        )}

        {tick.proposalEvents.length === 0 ? (
          <div
            data-testid="merged-replay-no-proposal-events"
            style={{ padding: '8px', color: '#666', fontSize: '0.85em' }}
          >
            No proposal events at this tick.
          </div>
        ) : (
          tick.proposalEvents.map((event, i) => (
            <div
              key={`${i}-${event.event_type}`}
              data-testid={`merged-replay-proposal-${i}-${event.event_type}`}
              style={{
                borderBottom: '1px solid #2a2a2a',
                padding: '6px 4px',
                fontSize: '0.85em',
                fontFamily: 'monospace',
                color: '#c084fc',
              }}
            >
              {event.event_type}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
