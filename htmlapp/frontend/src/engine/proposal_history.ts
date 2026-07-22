/**
 * Shared proposal-history derivation — used by both the real-run path
 * (run_manager.ts) and the preview path (worker/handlers/runs.ts).
 *
 * Extracted from `deriveHistory` / `derivePreviewHistory` which were byte-for-
 * byte duplicates. The only difference between the two originals was the input
 * type; the common shape `{kind, tick_index, action?, trace?}` covers both.
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
}

/**
 * Derive proposal_history and user_action_history from the event log.
 * Ported from Python's `_derive_history` — walks `events` once.
 *
 * @param events        Ordered event log (tick + action events).
 * @param tickSeconds   Duration of one tick in seconds.
 * @param currentSimSec Current simulation clock in seconds.
 */
export function deriveProposalHistory(
  events: HistoryEvent[],
  tickSeconds: number,
  currentSimSec: number,
): [ProposalHistory, { tick_index: number; action: string }[]] {
  const firedProposalTicks: number[] = []
  const firedProposalCategories: string[] = []
  const actionByOrder: [number, string][] = []
  const userActionHistory: { tick_index: number; action: string }[] = []

  for (const event of events) {
    if (event.kind === 'tick') {
      const dr = event.trace.decision_result
      if (dr.fire_control.fired && dr.proposal !== null) {
        firedProposalTicks.push(event.tick_index!)
        firedProposalCategories.push(dr.selected_category ?? '')
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
  const lastTimeSec = lastTick * tickSeconds

  let lastProposalResult: string | null = null
  for (const [actionTick, act] of actionByOrder) {
    if (actionTick >= lastTick) {
      lastProposalResult = act
      break
    }
  }

  const windowStartSec = currentSimSec - 1800.0
  const proposalsInWindow = firedProposalTicks.filter((t) => t * tickSeconds >= windowStartSec).length

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
