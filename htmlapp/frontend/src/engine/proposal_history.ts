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
