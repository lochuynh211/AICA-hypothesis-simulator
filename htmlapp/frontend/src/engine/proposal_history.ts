/**
 * Shared proposal-history derivation — used by both the real-run path
 * (run_manager.ts) and the preview path (worker/handlers/runs.ts).
 *
 * Extracted from `deriveHistory` / `derivePreviewHistory` which were byte-for-
 * byte duplicates. The only difference between the two originals was the input
 * type; the common shape `{kind, tick_index, action?, trace?}` covers both.
 *
 * Bugfix (2026-08-04, mirroring Python's `_derive_history`, commit "fix bug"
 * 5becf9f 2026-07-29): a proposal's sim-time is now the fired tick's OWN
 * `tick_state.elapsed_seconds` (falling back to `tick_index * tickSeconds`
 * only when an event carries no `tick_state`) — NOT recomputed as
 * `tick_index * tickSeconds` unconditionally. That recomputation is exactly
 * right for M1, but for M2 the tick engine stamps a tick's real elapsed time
 * as `(tick_index + 1) * tick_seconds` (`tick_engine.ts`'s `advanceTick`,
 * mirroring `tick_engine.py`), so recomputing from `tick_index` alone
 * back-dates every M2 proposal by exactly one tick: the algorithm's cooldown
 * (`sim_time - lastProposalTimeSec < cooldown_sec`) then expires one tick
 * early, and the `proposalCountLast30Min` window is shifted by the same
 * amount. See `app/api/aica_api/services/run_manager.py::_derive_history`'s
 * own docstring for the original (Python-side) diagnosis; this port never
 * received that fix when it was extracted into this shared module.
 */

// ---------------------------------------------------------------------------
// Fire-control: post-response trigger de-duplication (fixbug-0804)
// ---------------------------------------------------------------------------
//
// Mirrors Python's `_derive_response_suppression`
// (`app/api/aica_api/services/run_manager.py`) — see
// `docs/fixbug-0804-trigger-dedup-plan.md` §5 for the full state-machine
// table. Not a manifest hyperparameter — harness fire-control policy.
const DECLINE_COOLDOWN_SEC = 1800.0

export type ProposalHistory = {
  lastProposalTimeSec: number | null
  lastProposalCategory: string | null
  lastProposalResult: string | null
  proposalCountLast30Min: number
  acceptanceRateRecent: number
}

type HistoryEvent = {
  kind: string
  tick_index?: number
  action?: string
  trace?: any
  tick_state?: { elapsed_seconds?: number }
}

/**
 * Derive proposal_history and user_action_history from the event log.
 * Ported from Python's `_derive_history` — walks `events` once.
 *
 * @param events        Ordered event log (tick + action events).
 * @param tickSeconds   Duration of one tick in seconds (fallback sim-time only).
 * @param currentSimSec Current simulation clock in seconds.
 */
export function deriveProposalHistory(
  events: HistoryEvent[],
  tickSeconds: number,
  currentSimSec: number,
): [ProposalHistory, { tick_index: number; action: string }[]] {
  const firedProposalTicks: number[] = []
  const firedProposalCategories: string[] = []
  // Real sim-time of each fired proposal, index-aligned with the two lists above.
  const firedProposalSecs: number[] = []
  const actionByOrder: [number, string][] = []
  const userActionHistory: { tick_index: number; action: string }[] = []

  for (const event of events) {
    if (event.kind === 'tick') {
      const dr = event.trace.decision_result
      if (dr.fire_control.fired && dr.proposal !== null) {
        firedProposalTicks.push(event.tick_index!)
        firedProposalCategories.push(dr.selected_category ?? '')
        const elapsed = event.tick_state?.elapsed_seconds
        firedProposalSecs.push(elapsed !== undefined && elapsed !== null ? Number(elapsed) : event.tick_index! * tickSeconds)
      }
    } else if (event.kind === 'action') {
      actionByOrder.push([event.tick_index!, event.action!])
      userActionHistory.push({ tick_index: event.tick_index!, action: event.action! })
    }
  }

  if (firedProposalTicks.length === 0) {
    return [
      {
        lastProposalTimeSec: null,
        lastProposalCategory: null,
        lastProposalResult: null,
        proposalCountLast30Min: 0,
        acceptanceRateRecent: 0.0,
      },
      userActionHistory,
    ]
  }

  const lastTick = firedProposalTicks[firedProposalTicks.length - 1]
  const lastCategory = firedProposalCategories[firedProposalCategories.length - 1]
  const lastTimeSec = firedProposalSecs[firedProposalSecs.length - 1]

  let lastProposalResult: string | null = null
  for (const [actionTick, act] of actionByOrder) {
    if (actionTick >= lastTick) {
      lastProposalResult = act
      break
    }
  }

  const windowStartSec = currentSimSec - 1800.0
  const proposalsInWindow = firedProposalSecs.filter((sec) => sec >= windowStartSec).length

  let actedCount = 0
  let acceptedCount = 0
  let searchStart = 0
  for (const proposalTick of firedProposalTicks) {
    for (let i = searchStart; i < actionByOrder.length; i++) {
      if (actionByOrder[i][0] >= proposalTick) {
        actedCount += 1
        if (actionByOrder[i][1] === 'accept_rest') acceptedCount += 1
        searchStart = i + 1
        break
      }
    }
  }
  const acceptanceRate = actedCount > 0 ? acceptedCount / actedCount : 0.0

  return [
    {
      lastProposalTimeSec: lastTimeSec,
      lastProposalCategory: lastCategory,
      lastProposalResult,
      proposalCountLast30Min: proposalsInWindow,
      acceptanceRateRecent: acceptanceRate,
    },
    userActionHistory,
  ]
}

/**
 * Derive per-category post-response suppression from the event log.
 * Ported from Python's `_derive_response_suppression` — walks `events` once,
 * pairing each fired proposal (a tick event whose
 * `decision_result.fire_control.fired` is true and whose `.proposal` is not
 * null) with the action recorded at the EXACT SAME `tick_index` (both
 * `run_manager.ts::action()` and the preview auto-answer stamp an action's
 * `tick_index` as the tick that fired the proposal it answers — exact match,
 * not "first action at/after", is required so a suppressed/unanswered
 * proposal is never mis-paired with a later proposal's real answer).
 *
 * Rules (independent per category; latest action of a category wins):
 *   - Monotony ACCEPTED (`acknowledge`)  -> suppress monotony_prevention with
 *     no timer, released the instant ANY rest_required proposal fires after.
 *   - Monotony DECLINED (`decline`)      -> suppress monotony_prevention
 *     while `currentSimSec - declineTimeSec < DECLINE_COOLDOWN_SEC`.
 *   - Rest DECLINED (`decline`) or Rest POSTPONED (`postpone`) -> suppress
 *     rest_required under the same cooldown window.
 *   - Rest ACCEPTED (`accept_rest`)      -> not this helper's job; the
 *     existing `recovery_active` gate already covers it.
 *
 * @param events        Ordered event log (tick + action events).
 * @param currentSimSec Current simulation clock in seconds.
 * @param tickSeconds   Duration of one tick in seconds (fallback sim-time only).
 */
export function deriveResponseSuppression(
  events: HistoryEvent[],
  currentSimSec: number,
  tickSeconds: number,
): { rest_required: boolean; monotony_prevention: boolean } {
  const fired: [number, string, number][] = []
  const actionsByTick = new Map<number, string>()

  for (const event of events) {
    if (event.kind === 'tick') {
      const dr = event.trace.decision_result
      if (dr.fire_control.fired && dr.proposal !== null) {
        const elapsed = event.tick_state?.elapsed_seconds
        const sec = elapsed !== undefined && elapsed !== null ? Number(elapsed) : event.tick_index! * tickSeconds
        fired.push([event.tick_index!, dr.selected_category ?? '', sec])
      }
    } else if (event.kind === 'action') {
      actionsByTick.set(event.tick_index!, event.action!)
    }
  }

  const pairs: [string, number, string | undefined][] = fired.map(
    ([tickIndex, category, sec]) => [category, sec, actionsByTick.get(tickIndex)],
  )

  let monotonySuppressed = false
  let monotonyIndefinite = false // true while suppressed via acknowledge (no timer)
  let monotonyReleaseSec: number | null = null

  let restSuppressed = false
  let restReleaseSec: number | null = null

  for (const [category, sec, matchedAction] of pairs) {
    if (category === 'rest_required') {
      // Any rest proposal firing releases an indefinite (acknowledge-based)
      // monotony suppression, regardless of how the rest proposal is answered.
      if (monotonyIndefinite) {
        monotonyIndefinite = false
        monotonySuppressed = false
        monotonyReleaseSec = null
      }
      if (matchedAction === 'decline' || matchedAction === 'postpone') {
        restSuppressed = true
        restReleaseSec = sec + DECLINE_COOLDOWN_SEC
      } else if (matchedAction !== undefined) {
        // e.g. accept_rest — not this helper's concern; latest action wins.
        restSuppressed = false
        restReleaseSec = null
      }
    } else if (category === 'monotony_prevention') {
      if (matchedAction === 'acknowledge') {
        monotonyIndefinite = true
        monotonySuppressed = true
        monotonyReleaseSec = null
      } else if (matchedAction === 'decline') {
        monotonyIndefinite = false
        monotonySuppressed = true
        monotonyReleaseSec = sec + DECLINE_COOLDOWN_SEC
      } else if (matchedAction !== undefined) {
        monotonyIndefinite = false
        monotonySuppressed = false
        monotonyReleaseSec = null
      }
    }
  }

  let resultRest = false
  if (restSuppressed) {
    resultRest = restReleaseSec !== null ? currentSimSec < restReleaseSec : true
  }

  let resultMonotony = false
  if (monotonySuppressed) {
    resultMonotony = monotonyIndefinite
      ? true
      : (monotonyReleaseSec !== null ? currentSimSec < monotonyReleaseSec : false)
  }

  return { rest_required: resultRest, monotony_prevention: resultMonotony }
}
