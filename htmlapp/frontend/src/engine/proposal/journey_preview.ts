/**
 * Journey preview — port of `services/proposal_journey_preview.py`
 * (`preview`, C2 Task 5).
 *
 * `preview(runLog) -> JourneyPreview` is a PURE projection over
 * `runLog.opportunity.trigger_purpose` and `runLog.journey_state.
 * lifecycle_stage` (plus the committed CONTENT-step evidence's
 * `next_transition_policy`, if any, folded into a step's `note`). It:
 *
 *   - invokes NO selector,
 *   - appends NO event/evidence,
 *   - mutates NO run state,
 *   - performs NO storage I/O.
 *
 * The caller must not persist anything either — this module has no
 * side-effecting capability at all (there's nothing to accidentally
 * persist). `binding` is always `false`.
 */
import type { LifecycleStage, ProposalRunLog } from './journey'

export type PreviewStep = { label: string; lifecycle_stage: LifecycleStage; note: string | null }
export type JourneyPreview = { binding: boolean; steps: PreviewStep[] }

// The rolling-horizon rest chain, in order. Each entry is
// `[lifecycleStage, bilingualLabel]` — mirrors the Python module's
// `_REST_CHAIN` verbatim.
const REST_CHAIN: Array<[LifecycleStage, string]> = [
  ['before_rest_until_stop', 'Now — guide to rest spot / いま — 休憩スポットへ案内'],
  ['during_rest_stopped', 'At rest — nap / 休憩中 — 仮眠'],
  ['after_rest_before_restart', 'After rest — stopped full karaoke / 休憩後 — 停車中フルカラオケ'],
]

/** Return the last committed (non-error) CONTENT-step evidence's
 * `next_transition_policy`, or `null` — a pure, read-only lookup over the
 * EXISTING evidence list (never dispatches a selector). */
function committedPlanPolicy(runLog: ProposalRunLog): string | null {
  for (let i = runLog.evidence.length - 1; i >= 0; i--) {
    const evidence = runLog.evidence[i]
    if (evidence.step === 'content' && evidence.error === null && evidence.output) {
      const policy = evidence.output.next_transition_policy
      if (policy !== null && policy !== undefined) return policy as string
    }
  }
  return null
}

/** The before/during/after-rest chain, starting at the run's CURRENT stage
 * and proceeding forward. Falls back to the full chain if `stage` is not
 * itself one of the three rest stages (e.g. a rest_recommended run whose
 * journey_state hasn't been driven into the rest stages yet) — this fallback
 * (`start` defaulting to `0` when no match is found) produces output
 * BYTE-IDENTICAL to `stage === 'before_rest_until_stop'` (both start the
 * slice at index 0), so it is not independently distinguishable and isn't
 * captured as a separate golden case (see the task report). */
function restChainFrom(stage: LifecycleStage): PreviewStep[] {
  const start = REST_CHAIN.findIndex(([s]) => s === stage)
  const startIndex = start === -1 ? 0 : start
  // `REST_CHAIN.slice(startIndex)` can never be empty for startIndex in
  // 0..2 (the only values `findIndex`/the `-1` fallback ever produce) -- the
  // `|| REST_CHAIN.slice(-1)` fallback mirrors Python's `or _REST_CHAIN[-1:]`
  // literally, but, like the Python original, is unreachable dead code (see
  // the task report's dead-code note).
  const remaining = REST_CHAIN.slice(startIndex).length > 0 ? REST_CHAIN.slice(startIndex) : REST_CHAIN.slice(-1)
  return remaining.map(([chainStage, label]) => ({ label, lifecycle_stage: chainStage, note: null }))
}

/** A short current-content -> continue/complete chain for non-rest
 * purposes, folding the committed plan's `next_transition_policy` (if any)
 * into the first step's `note` for extra context — never a fabricated
 * value; `null` when no content plan has been committed yet. */
function activeContentChain(runLog: ProposalRunLog, stage: LifecycleStage): PreviewStep[] {
  const policy = committedPlanPolicy(runLog)
  return [
    {
      label: 'Now — current content continues / いま — 現在のコンテンツを継続',
      lifecycle_stage: stage,
      note: policy ? `next_transition_policy: ${policy}` : null,
    },
    { label: 'Next — continue or complete / 次へ — 継続または完了', lifecycle_stage: stage, note: null },
  ]
}

/** Pure, read-only rolling-horizon preview projection — see module doc
 * comment for the full purity/no-persistence contract. */
export function preview(runLog: ProposalRunLog): JourneyPreview {
  const stage = runLog.journey_state.lifecycle_stage
  const purpose = runLog.opportunity.trigger_purpose

  const steps =
    purpose === 'rest_recommended' ? restChainFrom(stage) : activeContentChain(runLog, stage)

  return { binding: false, steps }
}
