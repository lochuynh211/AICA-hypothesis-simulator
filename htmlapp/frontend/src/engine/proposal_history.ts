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
// Fire-control: post-response trigger de-duplication (fixbug-0804) +
// recovery-semantics refactor (owner review, 2026-08-08)
// ---------------------------------------------------------------------------
//
// Mirrors Python's `_derive_response_suppression`
// (`app/api/aica_api/services/run_manager.py`) — see
// `docs/fixbug-0804-trigger-dedup-plan.md` §5 for the full state-machine
// table. Not a manifest hyperparameter — harness fire-control policy.
export const DECLINE_COOLDOWN_SEC = 1800.0

// 45-minute SAME-CATEGORY cooldown after ANY answered proposal — including an
// ACCEPTED one (owner review, 2026-08-08). The 30-minute window above only fires
// on a rejection (decline/postpone/acknowledge); accepting left the category free
// to re-propose almost immediately, so a driver who took the content or the rest
// could be asked for the same thing again a few ticks later. Whichever window is
// longer wins, so this never shortens an existing suppression.
export const SAME_CATEGORY_COOLDOWN_SEC = 2700.0

// CDC-SU slide 34's second control: 単位時間あたり提案回数. NOT a general rate
// limiter — read this comment before touching either constant.
//
// DECLINE_COOLDOWN_SEC above already bounds every NORMALLY-spaced fire: any
// category answered with a cooldown-setting action (decline/postpone/
// acknowledge) cannot show again for 1800s. The ONE path that sets no
// cooldown is rest_required answered with accept_rest — deliberately, since
// suppressing a second REST_PROPOSAL while resting is the `recoveryActive`
// gate's job in tick(), not this function's. That path is otherwise
// UNBOUNDED at harness level: nothing stops accept_rest fires from repeating
// arbitrarily fast.
//
// This constant pair exists SOLELY as a backstop for that one path — see
// Python's own extensive comment at this site
// (`app/api/aica_api/services/run_manager.py`) for the full sizing proof
// (never tighter than the Hybrid package's own 1800s/3 in-algorithm cap).
export const MAX_PROPOSALS_PER_WINDOW = 3

// The effective 提案間隔 for a category once a fire has been ANSWERED: the
// decline cooldown and the same-category window both apply, so the later of
// the two governs. Named once so the constant and every test track together.
export const SAME_CATEGORY_RELEASE_SEC = Math.max(DECLINE_COOLDOWN_SEC, SAME_CATEGORY_COOLDOWN_SEC)
export const PROPOSAL_COUNT_WINDOW_SEC = 3600.0

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
 * Rules (independent per category — a monotony decline never touches
 * `rest_required` and vice versa; the latest action of a category wins):
 *   - Monotony ACCEPTED (`acknowledge`) or
 *     Monotony DECLINED (`decline`)      -> suppress monotony_prevention
 *     while `currentSimSec - responseTimeSec < DECLINE_COOLDOWN_SEC`
 *     (CDC-SU slide 81: re-check the threshold after a set time; slide 34
 *     permits only an interval and a per-unit-time count, never an
 *     indefinite latch).
 *   - Rest DECLINED (`decline`) or
 *     Rest POSTPONED (`postpone`)        -> suppress rest_required under
 *     the same 30-minute cooldown window.
 *   - Rest ACCEPTED (`accept_rest`)      -> NOT this helper's job for the
 *     recovery-in-progress window itself; the existing `recoveryActive`
 *     gate in `tick()` already covers that. This DOES add the 45-minute
 *     same-category window AFTER the recovery ends (below).
 *
 * Also independently per category (CDC-SU slide 34's other control,
 * 単位時間あたり提案回数): a category is suppressed once
 * `MAX_PROPOSALS_PER_WINDOW` of its fires were actually SHOWN to the driver
 * (i.e. not already suppressed by state accumulated from earlier pairs)
 * inside the trailing `PROPOSAL_COUNT_WINDOW_SEC`. This is counted in the
 * SAME single pass as the interval-cooldown state above — only fires that
 * got through count towards the allowance, so a burst of already-suppressed
 * fires can't silently eat it (the "latch" bug this fixes: counting a fire
 * the count cap itself suppressed makes the cap self-feeding — the count
 * never falls back below the limit and the category is silenced for the
 * rest of the run). The cap releases naturally as the window rolls forward.
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
  let monotonyReleaseSec: number | null = null

  let restSuppressed = false
  let restReleaseSec: number | null = null

  const shownTimes: Record<string, number[]> = { rest_required: [], monotony_prevention: [] }

  for (const [category, sec, matchedAction] of pairs) {
    // Was this fire suppressed by the state accumulated from EARLIER pairs?
    // Only fires that got through were shown to the driver, so only those
    // consume the 単位時間あたり提案回数 allowance. BOTH rules must be
    // considered here, not just the interval — see the latch-bug note above.
    let intervalSuppressed: boolean
    if (category === 'monotony_prevention') {
      intervalSuppressed = monotonySuppressed && monotonyReleaseSec !== null && sec < monotonyReleaseSec
    } else {
      intervalSuppressed = restSuppressed && restReleaseSec !== null && sec < restReleaseSec
    }
    const recentAtFire = (shownTimes[category] ?? []).filter((t) => t > sec - PROPOSAL_COUNT_WINDOW_SEC)
    const countSuppressed = recentAtFire.length >= MAX_PROPOSALS_PER_WINDOW
    if (!intervalSuppressed && !countSuppressed && category in shownTimes) {
      shownTimes[category].push(sec)
    }

    if (category === 'rest_required') {
      if (matchedAction === 'decline' || matchedAction === 'postpone') {
        restSuppressed = true
        restReleaseSec = sec + SAME_CATEGORY_RELEASE_SEC
      } else if (matchedAction !== undefined) {
        // ACCEPTED (accept_rest). The recoveryActive gate already suppresses
        // while the driver is actually resting; this adds the 45-minute
        // same-category window AFTER it, so the driver is not asked to rest
        // again straight off the back of a rest.
        restSuppressed = true
        restReleaseSec = sec + SAME_CATEGORY_COOLDOWN_SEC
      }
    } else if (category === 'monotony_prevention') {
      if (matchedAction === 'acknowledge' || matchedAction === 'decline') {
        // CDC-SU slide 81: after the content ends or is refused, 一定時間後に
        // 再度閾値チェック. An acknowledge used to suppress this category with
        // NO timer until a REST_PROPOSAL fired, which slide 34 does not
        // permit — it allows only 提案間隔 and 単位時間あたり提案回数.
        monotonySuppressed = true
        monotonyReleaseSec = sec + SAME_CATEGORY_RELEASE_SEC
      } else if (matchedAction !== undefined) {
        // Any other answer still counts as "this proposal was served" — the
        // same 45-minute same-category window applies.
        monotonySuppressed = true
        monotonyReleaseSec = sec + SAME_CATEGORY_COOLDOWN_SEC
      }
    }
  }

  let resultRest = false
  if (restSuppressed && restReleaseSec !== null) {
    resultRest = currentSimSec < restReleaseSec
  }

  let resultMonotony = false
  if (monotonySuppressed && monotonyReleaseSec !== null) {
    resultMonotony = currentSimSec < monotonyReleaseSec
  }

  const countCapped = (category: string): boolean => {
    const windowStart = currentSimSec - PROPOSAL_COUNT_WINDOW_SEC
    const recent = shownTimes[category].filter((t) => t > windowStart)
    return recent.length >= MAX_PROPOSALS_PER_WINDOW
  }

  resultRest = resultRest || countCapped('rest_required')
  resultMonotony = resultMonotony || countCapped('monotony_prevention')

  return { rest_required: resultRest, monotony_prevention: resultMonotony }
}
