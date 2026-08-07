/**
 * The guided proposal sequence for a LIVE run.
 *
 * A fire is not one event the reviewer looks at — it is a short conversation
 * with the driver, and the overlay walks through it a step at a time:
 *
 *   rest_required     rest recommendation → choose a spot (or decline)
 *                     → service proposal → content (the songs for the drive
 *                     to the spot)
 *   monotony          service proposal → content
 *
 * This module is PURE: it reads the recorded proposal log and says which step
 * the conversation is at. It never advances the journey itself — the coordinator
 * does that when the reviewer chooses something — so the overlay can never show
 * a step the recorded evidence does not support.
 *
 * The service step waits for an EXPLICIT choice (`serviceChosen`), not for
 * `active_service_id` to be set. The journey pre-selects the selector's rank-1
 * at fire time so the quickview can project the whole chain in one pass; during
 * a live run that would skip the service step entirely, deciding for the
 * reviewer the thing they are there to watch being decided.
 *
 * Once the car reaches the rest spot, the conversation closes — but stopping
 * is not the end: a post-rest opportunity (`after_rest_before_restart`) is a
 * fresh conversation and reopens on the service step even though the earlier
 * recovery already closed the pre-rest one. It resolves like any other, then
 * waits (`awaitingContinue`) for an explicit "Continue driving" rather than
 * auto-resuming, since the car is stopped.
 */
import type { ProposalRunLog } from '../../api/proposalClient'

export type GuidedStep = 'rest' | 'service' | 'content' | 'awaitingContinue' | 'done'

/** Services whose proposal continues into a song list. */
const MUSIC_SERVICE_IDS = new Set(['music_playlist', 'humming_karaoke', 'full_karaoke'])

export function isMusicService(serviceId: string | null | undefined): boolean {
  return serviceId != null && MUSIC_SERVICE_IDS.has(serviceId)
}

export type GuidedState = {
  step: GuidedStep
  /** True when this fire opens with a rest recommendation. */
  isRestFlow: boolean
  /** The service the driver is on, once chosen. */
  activeServiceId: string | null
}

export function guidedState({
  proposalLog,
  restDecided,
  serviceChosen,
  hasContentPlan,
  conversationOver = false,
  isAfterRest = false,
  afterRestResolved = false,
  afterRestContinued = false,
}: {
  proposalLog: ProposalRunLog | null
  /** The reviewer already accepted or declined this opportunity's rest. */
  restDecided: boolean
  /** The reviewer has explicitly chosen a service for THIS opportunity. */
  serviceChosen: boolean
  hasContentPlan: boolean
  /**
   * The car has reached the rest spot and recovery has begun (or has already
   * been through it for this opportunity). The proposing is finished — what
   * happens next is the nap, and the overlay must get out of the way so the
   * reviewer can watch it.
   */
  conversationOver?: boolean
  /** The proposal is a post-rest conversation (car stopped at the spot). */
  isAfterRest?: boolean
  /** Reviewer resolved (OK/Reject) the after-rest content — show "Continue driving". */
  afterRestResolved?: boolean
  /** Reviewer pressed "Continue driving" — the after-rest conversation is over. */
  afterRestContinued?: boolean
}): GuidedState {
  const opportunity = proposalLog?.opportunity
  const journey = proposalLog?.journey_state
  const activeServiceId = journey?.active_service_id ?? null

  const isRestFlow =
    opportunity?.trigger_purpose === 'rest_recommended' &&
    journey?.lifecycle_stage === 'before_rest_until_stop'

  if (proposalLog == null || opportunity == null) {
    return { step: 'done', isRestFlow: false, activeServiceId }
  }

  // After-rest conversation (car stopped at the spot): it is a fresh
  // opportunity and must NOT be closed by the pre-rest `conversationOver`
  // gate. Once resolved it does not auto-resume — it waits for an explicit
  // "Continue driving" (the car is stopped).
  if (isAfterRest) {
    if (afterRestContinued) return { step: 'done', isRestFlow: false, activeServiceId }
    if (afterRestResolved) return { step: 'awaitingContinue', isRestFlow: false, activeServiceId }
  } else if (conversationOver) {
    return { step: 'done', isRestFlow: Boolean(isRestFlow), activeServiceId }
  }

  // 1. Rest first: the driver is asked whether to stop before anything is
  //    proposed for the drive there.
  if (isRestFlow && !restDecided) {
    return { step: 'rest', isRestFlow: true, activeServiceId }
  }

  // 2. Then the service — until the REVIEWER picks one. Falling through on a
  //    pre-selected `active_service_id` would skip this step on every fire.
  if (!serviceChosen) {
    return { step: 'service', isRestFlow: Boolean(isRestFlow), activeServiceId }
  }

  // 3. Then the content — but only for a service that HAS content. A non-music
  //    service ends the sequence rather than showing an empty song list.
  if (isMusicService(activeServiceId) && hasContentPlan) {
    return { step: 'content', isRestFlow: Boolean(isRestFlow), activeServiceId }
  }

  return { step: 'done', isRestFlow: Boolean(isRestFlow), activeServiceId }
}
