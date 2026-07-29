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
import { t } from '../../i18n/t'
import { useLanguage } from '../../state/language'
import { CATEGORY_LABELS, type BilingualLabel } from '../../lib/review/reviewVocabulary'

type Props = { mergedRunId: string }

type Loaded = {
  handle: MergedRunHandle
  trigger_log: RunLog | null
  proposal_logs: ProposalRunLog[]
}

const LABELS = {
  loading: { ja: '再生データを読み込み中…', en: 'Loading replay…' },
  errorPrefix: { ja: 'エラー: ', en: 'Error: ' },
  header: { ja: '統合再生', en: 'MERGED REPLAY' },
  readOnly: { ja: '（読み取り専用）', en: '(read-only)' },
  tick: { ja: 'ティック', en: 'tick' },
  noTriggerData: {
    ja: 'このティックに記録された発火判定データはありません',
    en: 'No recorded firing-decision data for this tick',
  },
  category: { ja: '分類', en: 'Category' },
  noProposalEvents: { ja: 'このティックに提案イベントはありません。', en: 'No proposal events at this tick.' },
}

const UNNAMED_CATEGORY: BilingualLabel = { ja: '名称未登録の分類', en: 'Unnamed category' }
const UNNAMED_EVENT: BilingualLabel = { ja: '名称未登録のイベント', en: 'Unnamed event' }

/**
 * `result_type` labels for the known backend constants (`api/types.ts`'s
 * `ResultType`). `REST_PROPOSAL`/`MONOTONY_PROPOSAL` reuse
 * `reviewVocabulary.ts`'s `CATEGORY_LABELS` verbatim so the same decision
 * reads identically here and in the review rail. `ResultType` also carries
 * an open `python_module`-authored tail (see that type's own doc comment) —
 * for a value outside this table the raw string is kept as the only
 * possible display, since it is package-defined text this file cannot
 * translate, not an internal identifier.
 */
const RESULT_TYPE_LABELS: Record<string, BilingualLabel> = {
  NO_TRIGGER: { ja: '発火はありませんでした', en: 'Nothing fired' },
  REST_PROPOSAL: CATEGORY_LABELS.rest_required,
  MONOTONY_PROPOSAL: CATEGORY_LABELS.monotony_prevention,
  SOFT_WARNING: { ja: '軽度の警告', en: 'Soft warning' },
  SEVERE_INTERVENTION: { ja: '重度の介入', en: 'Severe intervention' },
  NO_PRACTICAL_ACTION_FALLBACK: { ja: '実行可能な対応なし', en: 'No practical action available' },
  SUPPRESSED: { ja: '発火制御により抑制', en: 'Suppressed by firing control' },
  NO_PROPOSAL: { ja: '提案なし', en: 'No proposal' },
}

/**
 * `event_type` labels for the closed backend `DiscreteEventType` enum
 * (`models/proposal/enums.py`). `RECOMPUTED`/`CONTEXT_EDITED` match
 * `components/proposal/EventTimeline.tsx`'s own `EVENT_TYPE_CAPTIONS`
 * verbatim so the same event reads identically in both places.
 */
const EVENT_TYPE_LABELS: Record<string, BilingualLabel> = {
  OPPORTUNITY_OPENED: { ja: '提案機会が発生しました', en: 'Opportunity opened' },
  SERVICE_SELECTED: { ja: 'サービスが選択されました', en: 'Service selected' },
  CONTENT_SELECTED: { ja: 'コンテンツが選択されました', en: 'Content selected' },
  TRIGGER_PURPOSE_CHANGED: { ja: '発火の目的が変更されました', en: 'Firing purpose changed' },
  REST_SPOT_ARRIVED: { ja: '休憩場所に到着しました', en: 'Arrived at the rest location' },
  REST_COMPLETED: { ja: '休憩が完了しました', en: 'Rest completed' },
  CONTENT_COMPLETED: { ja: 'コンテンツが完了しました', en: 'Content completed' },
  ALGORITHM_ERROR: { ja: 'アルゴリズムエラー', en: 'Algorithm error' },
  SERVICE_REJECTED: { ja: 'サービスが拒否されました', en: 'Service rejected' },
  CONTENT_STARTED: { ja: 'コンテンツを開始しました', en: 'Content started' },
  MOTION_CHANGED: { ja: '走行状態が変化しました', en: 'Motion state changed' },
  CONTINUE_REQUESTED: { ja: '継続が要求されました', en: 'Continue requested' },
  RETURN_TO_PREVIOUS_CONTENT: { ja: '前のコンテンツに戻りました', en: 'Returned to previous content' },
  REST_STARTED: { ja: '休憩を開始しました', en: 'Rest started' },
  POSTPONED: { ja: '先送りされました', en: 'Postponed' },
  CHOOSE_ANOTHER: { ja: '別の候補を選択しました', en: 'Chose another candidate' },
  REQUEST_MORE: { ja: 'さらに候補を要求しました', en: 'Requested more candidates' },
  NO_ELIGIBLE_CANDIDATE: { ja: '対象となる候補がありませんでした', en: 'No eligible candidate' },
  RECOMPUTED: { ja: '再計算されました', en: 'Recomputed' },
  CONTEXT_EDITED: { ja: 'コンテキストが編集されました', en: 'Context edited' },
}

export default function MergedReplayViewer({ mergedRunId }: Props) {
  const [data, setData] = useState<Loaded | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [currentTick, setCurrentTick] = useState(0)
  const { lang } = useLanguage()

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
        {t(LABELS.loading, lang)}
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
        {t(LABELS.errorPrefix, lang)}{error}
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
        {t(LABELS.header, lang)} — {mergedRunId}{' '}
        <span style={{ fontWeight: 400, color: '#666' }}>{t(LABELS.readOnly, lang)}</span>
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
            {t(LABELS.noTriggerData, lang)}
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
            <span style={{ color: '#6af', fontWeight: 700 }}>
              {t(LABELS.tick, lang)} #{tick.trigger.tick_index}
            </span>{' '}
            <span style={{ color: '#ffe066', fontWeight: 700 }}>
              {t(
                RESULT_TYPE_LABELS[tick.trigger.decision.result_type] ?? {
                  ja: tick.trigger.decision.result_type,
                  en: tick.trigger.decision.result_type,
                },
                lang,
              )}
            </span>
            {tick.trigger.decision.selected_category && (
              <span style={{ color: '#8f8', marginLeft: '10px' }}>
                {t(LABELS.category, lang)}:{' '}
                {t(CATEGORY_LABELS[tick.trigger.decision.selected_category] ?? UNNAMED_CATEGORY, lang)}
              </span>
            )}
          </div>
        )}

        {tick.proposalEvents.length === 0 ? (
          <div
            data-testid="merged-replay-no-proposal-events"
            style={{ padding: '8px', color: '#666', fontSize: '0.85em' }}
          >
            {t(LABELS.noProposalEvents, lang)}
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
              {t(EVENT_TYPE_LABELS[event.event_type] ?? UNNAMED_EVENT, lang)}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
