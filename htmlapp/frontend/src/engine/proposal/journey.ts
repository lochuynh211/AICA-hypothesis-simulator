/**
 * Journey engine — port of `services/proposal_journey.py` (`apply_action`
 * plus its twelve action handlers, C2 Task 5).
 *
 * `applyAction` is the SOLE entry point: given the run's current log and a
 * requested action, it returns a `JourneyTransition` describing what should
 * happen next — new events, the new journey state, and the new run status —
 * WITHOUT ever touching the clock, a random source, or storage. `now` is
 * minted by the CALLER and threaded in as a parameter; persisting the
 * transition's result (appending events, updating state via
 * `./run_manager.ts`) is the CALLER'S job, exactly as in Python (the router
 * owns persistence, this module never imports `proposal_run_manager`).
 *
 * PURE: no clock, no randomness, no storage. The input `runLog` is never
 * mutated — every handler returns a freshly-built `JourneyState`/
 * `JourneyTransition`; unmodified fields are carried over by reference
 * (mirrors pydantic's `model_copy(update={...})`, which is a SHALLOW copy —
 * see the module-level "asymmetric shallow-copy" note below).
 *
 * ISOLATION (mirrors the Python module's own isolation note): this module
 * defines its own `JourneyState`/`JourneyAction`/`JourneyTransition`/
 * `TransitionRejection` types (the P4 journey-state shape is NOT the same as
 * `./run_manager.ts`'s intentionally-opaque `JourneyState` pass-through —
 * `run_manager.ts` never inspects journey_state internals, this module is
 * the ONE place that does) but REUSES the true owner of every other type it
 * touches: `ServiceId`/`MotionState`/`ServiceCapabilities`/
 * `resolveEligibility`/`deriveRegisteredEntities` from `./eligibility.ts`,
 * `AlgorithmEvidence` from `./selector.ts`, and `ProposalOpportunity`/
 * `DiscreteEvent`/`ProposalRunStatus` from `./run_manager.ts`.
 *
 * ASYMMETRIC SHALLOW-COPY (the class of detail C2 Task 4's report flagged):
 * every handler below that changes `journeyState` builds the new object via
 * `{ ...js, <only the fields Python's own `update={...}` names> }` — NEVER
 * a deep clone. This exactly mirrors pydantic `BaseModel.model_copy(update=
 * ...)`'s default `deep=False`: fields NOT named in `update` are shared BY
 * REFERENCE with the original (`previous_content`, a nested object, is
 * never itself cloned — only ever replaced wholesale). Where Python builds a
 * NEW list before passing it as an update value (`rejected_ids =
 * list(js.rejected_service_ids)` in `_reject_service`), this port also
 * builds a new array (`[...js.rejected_service_ids]` or `.map`/`.filter`)
 * rather than mutating the original in place — never `.push()` on an
 * existing array reachable from `runLog`.
 *
 * DEAD CODE, PORTED FOR PARITY ANYWAY: `notYetImplemented` mirrors Python's
 * `_not_yet_implemented` — a shared stub Python's own dispatch table
 * initializes EVERY `JourneyActionType` to before overwriting all twelve
 * with their real handlers. Since `JourneyActionType` has exactly twelve
 * members and all twelve are reassigned, `_not_yet_implemented` is
 * UNREACHABLE via `apply_action`'s normal dispatch in Python today — same
 * here. It is kept only because the brief's contract enumerates it
 * alongside the twelve real handlers, and because the dispatch-table
 * architecture (default-to-stub, then overwrite) is itself part of the
 * ported behavior.
 */
import type {
  ServiceId,
  MotionState,
  ServiceCapabilities,
} from './eligibility'
import { resolveEligibility, deriveRegisteredEntities } from './eligibility'
import type { AlgorithmEvidence } from './selector'
import type { ProposalOpportunity, DiscreteEvent, ProposalRunStatus } from './run_manager'

// ---------------------------------------------------------------------------
// Domain types — mirrors models/proposal/{journey,journey_action}.py
// ---------------------------------------------------------------------------

export type LifecycleStage =
  | 'before_rest_until_stop'
  | 'during_rest_stopped'
  | 'after_rest_before_restart'
  | 'active_driving_content'

export type PlaybackState = 'idle' | 'active' | 'backgrounded' | 'paused' | 'completed' | 'stopped'

export type PreviousContent = { service_id: ServiceId | null; plan_ref: string | null }

/** Mirrors `models/proposal/journey.py::JourneyState` — the P4-extended
 * shape this module actually reads/writes field-by-field (unlike
 * `./run_manager.ts`'s intentionally opaque pass-through `JourneyState`). */
export type JourneyState = {
  lifecycle_stage: LifecycleStage
  motion_state: MotionState
  active_service_id: ServiceId | null
  active_plan_id: string | null
  playback_state: PlaybackState
  current_plan_ref: string | null
  previous_content: PreviousContent | null
  rejected_service_ids: ServiceId[]
}

/** The minimal `ProposalRunLog` slice `apply_action` actually reads in
 * Python (verified against the full 925-line source: only `.status`,
 * `.journey_state`, `.evidence`, `.opportunity.trigger_purpose`,
 * `.opportunity.allowed_service_ids`, and `.world_snapshot` are ever
 * touched — `parameters`/`hyperparameters`/`run_id`/etc. never are). A real
 * persisted `run_manager.ts#ProposalRunLog` structurally satisfies this
 * (it has strictly more fields; only `journey_state`'s stricter typing here
 * needs an explicit narrow/cast at the call site). */
export type ProposalRunLog = {
  status: ProposalRunStatus
  journey_state: JourneyState
  opportunity: ProposalOpportunity
  evidence: AlgorithmEvidence[]
  world_snapshot: Record<string, unknown> | null
}

/** Every action the P4 journey engine accepts (mirrors
 * `enums.py::JourneyActionType`; `continue` is a reserved word in some
 * contexts but not in TS/JS, so — unlike Python's `continue_` — no rename is
 * needed here). */
export type JourneyActionType =
  | 'accept'
  | 'reject'
  | 'postpone'
  | 'choose_another'
  | 'request_more'
  | 'complete'
  | 'continue'
  | 'stop'
  | 'motion_change'
  | 'rest_spot_arrived'
  | 'rest_started'
  | 'rest_completed'

/** `action_type` is typed as `string`, not the closed `JourneyActionType`
 * union — mirrors Python's own defense-in-depth: a `JourneyAction` built
 * through normal pydantic validation can never hold a value outside the
 * closed enum, but `apply_action` still guards against a
 * fabricated/bypassed one (Python: `JourneyAction.model_construct(...)`).
 * Typing this field as `string` lets the SAME defensive path be exercised
 * (and tested) here without an `as any` escape hatch at every call site. */
export type JourneyAction = { action_type: string; payload: Record<string, unknown> }

export type TransitionRejection = { code: string; message: string }

export type JourneyTransition = {
  events: DiscreteEvent[]
  new_journey_state: JourneyState
  new_status: ProposalRunStatus
  rejected: TransitionRejection | null
}

type Handler = (
  runLog: ProposalRunLog,
  action: JourneyAction,
  now: string,
  capabilities: ServiceCapabilities | null,
) => JourneyTransition

// ---------------------------------------------------------------------------
// Shared helpers — mirrors _reject / _not_yet_implemented / _committed_plan /
// _service_evidence / _eligible_pool
// ---------------------------------------------------------------------------

/** Build a no-op rejection transition: state/status carried over unchanged
 * from `runLog`, no events appended (the rejection itself IS the signal). */
function reject(runLog: ProposalRunLog, code: string, message: string): JourneyTransition {
  return {
    events: [],
    new_journey_state: runLog.journey_state,
    new_status: runLog.status,
    rejected: { code, message },
  }
}

/** Shared stub for every `JourneyActionType` not yet implemented — see the
 * module doc comment's "DEAD CODE, PORTED FOR PARITY ANYWAY" note: every
 * real `JourneyActionType` is reassigned to a real handler below, so this is
 * unreachable via `applyAction`'s normal dispatch, exactly as in Python. */
export function notYetImplemented(runLog: ProposalRunLog): JourneyTransition {
  return reject(
    runLog,
    'invalid_precondition',
    'This action is not yet supported. / この操作には対応していません。',
  )
}

/** Return the last committed (non-error) CONTENT-step evidence output — the
 * `CompletePlan`-shaped dict — or `null` if the run has no such evidence
 * yet. Never fabricated: reads exactly what STEP 2 (`select_service`)
 * committed via `dispatchSelector` (`./selector.ts`). */
function committedPlan(runLog: ProposalRunLog): Record<string, unknown> | null {
  for (let i = runLog.evidence.length - 1; i >= 0; i--) {
    const evidence = runLog.evidence[i]
    if (evidence.step === 'content' && evidence.error === null) return evidence.output
  }
  return null
}

/** Return the last committed (non-error) SERVICE-step evidence — its
 * `.output` is the `ServiceSelectorOutput`-shaped dict (`ranked_candidates`)
 * and its `.input_snapshot` carries the frozen eligible set
 * (`eligible_candidates`) — or `null` if the run has no such evidence yet. */
function serviceEvidence(runLog: ProposalRunLog): AlgorithmEvidence | null {
  for (let i = runLog.evidence.length - 1; i >= 0; i--) {
    const evidence = runLog.evidence[i]
    if (evidence.step === 'service' && evidence.error === null) return evidence
  }
  return null
}

/** The ordered pool of eligible service-candidate ids that the advisory
 * actions (reject/choose_another/request_more) draw from: the SERVICE
 * evidence's `input_snapshot.eligible_candidates` ids, ordered by the
 * service output's `ranked_candidates` rank first, then any remaining
 * eligible ids in their original eligible-set order.
 *
 * No re-scoring: reads the EXISTING service evidence only — never
 * dispatches a selector. Returns `[]` if there is no committed SERVICE
 * evidence. Candidate ids are read as raw strings from the evidence dict
 * (never validated against `ServiceId` here) — mirrors Python's own
 * `_eligible_pool`, which reads `candidate["candidate_id"]` straight out of
 * the dict without an `isinstance`/enum check; callers of the pool
 * (`_choose_another`) defensively validate downstream instead. */
function eligiblePool(runLog: ProposalRunLog): string[] {
  const evidence = serviceEvidence(runLog)
  if (evidence === null) return []
  const eligibleCandidates = (evidence.input_snapshot?.eligible_candidates as Array<{ candidate_id: string }>) ?? []
  const eligibleIds = eligibleCandidates.map((c) => c.candidate_id)
  const ranked = (evidence.output?.ranked_candidates as Array<{ candidate_id: string; rank: number }>) ?? []
  const rankedIds = [...ranked]
    .sort((a, b) => a.rank - b.rank)
    .map((c) => c.candidate_id)
    .filter((cid) => eligibleIds.includes(cid))
  const remainingIds = eligibleIds.filter((cid) => !rankedIds.includes(cid))
  return [...rankedIds, ...remainingIds]
}

// ---------------------------------------------------------------------------
// reject / choose_another / request_more / postpone — advisory service
// actions that must never dead-end the run. `rejected_service_ids` drives
// non-re-offer; when the pool is fully exhausted an explicit
// NO_ELIGIBLE_CANDIDATE event is emitted — a success end-state, never a
// crash/error. choose_another/request_more reuse the EXISTING eligiblePool
// ranking/order — neither ever dispatches a selector.
// ---------------------------------------------------------------------------

/** Reject the currently-offered service. The offered service is
 * `journeyState.active_service_id` unless the caller names a different one
 * via `payload.selected_service_id`. Recorded into `rejected_service_ids`
 * (never re-offered) and `active_service_id` is cleared. If the eligible
 * pool still has an id not yet rejected, the run stays open at
 * `service_selected`. If NONE remain, an explicit `NO_ELIGIBLE_CANDIDATE`
 * event is ALSO emitted alongside `SERVICE_REJECTED` — a success end-state,
 * not an error/crash.
 *
 * Payload hardening: an unrecognized `selected_service_id` (not a known
 * `ServiceId`) is a structured `invalid_payload` rejection, never a raw
 * throw. */
function rejectService(runLog: ProposalRunLog, action: JourneyAction, now: string): JourneyTransition {
  if (runLog.status !== 'service_selected') {
    return reject(
      runLog,
      'invalid_precondition',
      'This action is only available while a service is being offered. / この操作はサービス提示中のみ行えます。',
    )
  }
  const js = runLog.journey_state
  const payloadServiceId = action.payload.selected_service_id as string | undefined | null
  let offered: ServiceId | null
  if (payloadServiceId !== undefined && payloadServiceId !== null) {
    if (!KNOWN_SERVICE_IDS.has(payloadServiceId)) {
      return reject(
        runLog,
        'invalid_payload',
        "The specified service isn't recognized. / 指定されたサービスが認識できません。",
      )
    }
    offered = payloadServiceId as ServiceId
  } else {
    offered = js.active_service_id
  }
  if (offered === null) {
    return reject(
      runLog,
      'invalid_precondition',
      'No offered service to reject / 拒否する提示中のサービスがありません',
    )
  }

  const rejectedIds: ServiceId[] = [...js.rejected_service_ids]
  if (!rejectedIds.includes(offered)) rejectedIds.push(offered)

  const events: DiscreteEvent[] = [
    { event_type: 'SERVICE_REJECTED', at: now, payload: { rejected_service_id: offered } },
  ]

  const pool = eligiblePool(runLog)
  const remaining = pool.filter((cid) => !rejectedIds.includes(cid as ServiceId))
  if (remaining.length === 0) {
    events.push({
      event_type: 'NO_ELIGIBLE_CANDIDATE',
      at: now,
      payload: { rejected_service_ids: rejectedIds },
    })
  }

  const newJourneyState: JourneyState = { ...js, active_service_id: null, rejected_service_ids: rejectedIds }
  return { events, new_journey_state: newJourneyState, new_status: 'service_selected', rejected: null }
}

/** Advance to the next eligible, non-rejected candidate — reuses the
 * EXISTING eligiblePool order (no re-scoring, no new evidence). When no
 * further candidate remains, a structured `no_eligible_candidate` rejection
 * is returned — distinct from `reject`'s success-shaped
 * `NO_ELIGIBLE_CANDIDATE` event: there is nothing left to switch TO, so no
 * state change is applied. */
function chooseAnother(runLog: ProposalRunLog, action: JourneyAction, now: string): JourneyTransition {
  void action
  if (runLog.status !== 'service_selected') {
    return reject(
      runLog,
      'invalid_precondition',
      'This action is only available while a service is being offered. / この操作はサービス提示中のみ行えます。',
    )
  }
  const js = runLog.journey_state
  const pool = eligiblePool(runLog)
  const nextId = pool.find((cid) => !js.rejected_service_ids.includes(cid as ServiceId) && cid !== js.active_service_id)
  if (nextId === undefined) {
    return reject(
      runLog,
      'no_eligible_candidate',
      'No further eligible candidate to switch to / 切り替え可能な適格候補がこれ以上ありません',
    )
  }

  // `nextId` is drawn from `eligiblePool` (the frozen eligible set / committed
  // service-selector ranking), not a user-supplied payload value -- but
  // wrapped defensively anyway so a corrupt persisted log can never surface
  // as a raw crash.
  if (!KNOWN_SERVICE_IDS.has(nextId)) {
    return reject(
      runLog,
      'invalid_payload',
      'The eligible list contains an unrecognized service. / 適格候補リストに認識できないサービスが含まれています。',
    )
  }
  const nextServiceId = nextId as ServiceId

  let rank: number | null = null
  const evidence = serviceEvidence(runLog)
  if (evidence !== null && evidence.output) {
    const ranked = (evidence.output.ranked_candidates as Array<{ candidate_id: string; rank: number }>) ?? []
    for (const candidate of ranked) {
      if (candidate.candidate_id === nextId) {
        rank = candidate.rank
        break
      }
    }
  }

  const selectedPayload: Record<string, unknown> = { selected_service_id: nextId }
  if (rank !== null) selectedPayload.rank = rank

  const events: DiscreteEvent[] = [
    { event_type: 'CHOOSE_ANOTHER', at: now, payload: { selected_service_id: nextId } },
    { event_type: 'SERVICE_SELECTED', at: now, payload: selectedPayload },
  ]
  const newJourneyState: JourneyState = { ...js, active_service_id: nextServiceId }
  return { events, new_journey_state: newJourneyState, new_status: 'service_selected', rejected: null }
}

/** Surface the remaining eligible candidates WITHOUT producing any new
 * score — reuses eligiblePool (no selector dispatch, no new evidence).
 * State is unchanged otherwise. */
function requestMore(runLog: ProposalRunLog, action: JourneyAction, now: string): JourneyTransition {
  void action
  if (runLog.status !== 'service_selected') {
    return reject(
      runLog,
      'invalid_precondition',
      'This action is only available while a service is being offered. / この操作はサービス提示中のみ行えます。',
    )
  }
  const js = runLog.journey_state
  const pool = eligiblePool(runLog)
  const remaining = pool.filter((cid) => !js.rejected_service_ids.includes(cid as ServiceId))
  const event: DiscreteEvent = { event_type: 'REQUEST_MORE', at: now, payload: { remaining_candidate_ids: remaining } }
  return { events: [event], new_journey_state: js, new_status: runLog.status, rejected: null }
}

/** Postpone the current proposal — the opportunity returns to an open
 * state. Kept minimal: `active_service_id` is left as-is and `status` moves
 * to (or stays at) `service_selected` so a later action remains reachable,
 * even when postponing away from `content_selected`. */
function postpone(runLog: ProposalRunLog, action: JourneyAction, now: string): JourneyTransition {
  void action
  if (runLog.status !== 'service_selected' && runLog.status !== 'content_selected') {
    return reject(
      runLog,
      'invalid_precondition',
      'This action is only available while a service or content proposal is active. / この操作はサービスまたはコンテンツの提案中のみ行えます。',
    )
  }
  const event: DiscreteEvent = { event_type: 'POSTPONED', at: now, payload: {} }
  return { events: [event], new_journey_state: runLog.journey_state, new_status: 'service_selected', rejected: null }
}

// ---------------------------------------------------------------------------
// accept / complete / continue / stop — the mocked accepted-plan lifecycle:
//   content_selected -> [accept] content_started -> [complete] content_completed
//   -> [continue] content_completed (event only) | [stop] content_stopped
// ---------------------------------------------------------------------------

/** Accepting a selected content plan starts it (active content) and records
 * a start event. */
function accept(runLog: ProposalRunLog, action: JourneyAction, now: string): JourneyTransition {
  void action
  if (runLog.status !== 'content_selected') {
    return reject(
      runLog,
      'invalid_precondition',
      'This action is only available once a content plan has been selected. / この操作はコンテンツプラン選択後のみ行えます。',
    )
  }
  const plan = committedPlan(runLog)
  if (plan === null) {
    return reject(
      runLog,
      'invalid_precondition',
      'No committed content plan to accept / 承認する確定済みコンテンツプランがありません',
    )
  }

  const js = runLog.journey_state
  // Capture the pre-accept snapshot (whatever was active/plan-referenced
  // before this accept, if anything) so `stop` can restore it later.
  const previousContent: PreviousContent = { service_id: js.active_service_id, plan_ref: js.current_plan_ref }
  // `active_service_id` is already the STEP-2 selected service; accept
  // doesn't change WHICH service is active, only that it now has a
  // committed, playing plan.
  const planRef = `${plan.selected_service_id}-plan`
  const newJourneyState: JourneyState = {
    ...js,
    active_service_id: js.active_service_id,
    current_plan_ref: planRef,
    playback_state: 'active',
    previous_content: previousContent,
  }
  const event: DiscreteEvent = {
    event_type: 'CONTENT_STARTED',
    at: now,
    payload: { selected_service_id: js.active_service_id !== null ? js.active_service_id : null },
  }
  return { events: [event], new_journey_state: newJourneyState, new_status: 'content_started', rejected: null }
}

/** Completing records a completion event and applies the plan's completion
 * policy (the policy string itself is only recorded/consumed by
 * `continue_`; no further behavior is fabricated here). */
function complete(runLog: ProposalRunLog, action: JourneyAction, now: string): JourneyTransition {
  void action
  if (runLog.journey_state.playback_state !== 'active') {
    return reject(
      runLog,
      'invalid_precondition',
      'This action is only available while content is actively playing. / この操作はコンテンツ再生中のみ行えます。',
    )
  }
  const newJourneyState: JourneyState = { ...runLog.journey_state, playback_state: 'completed' }
  const event: DiscreteEvent = { event_type: 'CONTENT_COMPLETED', at: now, payload: {} }
  return { events: [event], new_journey_state: newJourneyState, new_status: 'content_completed', rejected: null }
}

/** Continuing MUST follow the plan's next-transition policy. Records the
 * policy-driven `CONTINUE_REQUESTED` event only — it does NOT itself open a
 * new opportunity — so `playback_state`/`status` are carried over
 * unchanged. */
function continueAction(runLog: ProposalRunLog, action: JourneyAction, now: string): JourneyTransition {
  void action
  if (runLog.journey_state.playback_state !== 'completed') {
    return reject(
      runLog,
      'invalid_precondition',
      'This action is only available once playback has finished. / この操作は再生終了後のみ行えます。',
    )
  }
  const plan = committedPlan(runLog)
  if (plan === null) {
    return reject(
      runLog,
      'invalid_precondition',
      'No committed content plan to continue / 継続する確定済みコンテンツプランがありません',
    )
  }
  const event: DiscreteEvent = {
    event_type: 'CONTINUE_REQUESTED',
    at: now,
    payload: { next_transition_policy: plan.next_transition_policy },
  }
  return { events: [event], new_journey_state: runLog.journey_state, new_status: runLog.status, rejected: null }
}

/** Stopping MUST restore the previously-playing content and record a
 * restoration event.
 *
 * Valid from `active`/`backgrounded` (a plan currently playing/suppressed)
 * AND from `completed` (a plan that finished but was not yet continued) —
 * widened beyond active/backgrounded so the full accept -> complete ->
 * continue -> stop sequence can run end-to-end on one run: `continueAction`
 * intentionally leaves `playback_state` at `completed`, so `stop` must
 * still be reachable from there to restore the pre-accept content. */
function stop(runLog: ProposalRunLog, action: JourneyAction, now: string): JourneyTransition {
  void action
  const ps = runLog.journey_state.playback_state
  if (ps !== 'active' && ps !== 'backgrounded' && ps !== 'completed') {
    return reject(
      runLog,
      'invalid_precondition',
      'This action is only available while content is playing or has just finished. / この操作はコンテンツ再生中または再生終了直後のみ行えます。',
    )
  }
  const js = runLog.journey_state
  const previous = js.previous_content
  const restoredServiceId = previous !== null ? previous.service_id : null
  const restoredPlanRef = previous !== null ? previous.plan_ref : null
  const newJourneyState: JourneyState = {
    ...js,
    active_service_id: restoredServiceId,
    current_plan_ref: restoredPlanRef,
    previous_content: null,
    playback_state: 'stopped',
  }
  const event: DiscreteEvent = {
    event_type: 'RETURN_TO_PREVIOUS_CONTENT',
    at: now,
    payload: { restored_service_id: restoredServiceId !== null ? restoredServiceId : null },
  }
  return { events: [event], new_journey_state: newJourneyState, new_status: 'content_stopped', rejected: null }
}

// ---------------------------------------------------------------------------
// motion_change / rest_spot_arrived / rest_started / rest_completed —
// deterministic motion-driven screen/background/stop behavior plus
// eligibility re-evaluation, and the rest-stage journey transitions.
// ---------------------------------------------------------------------------

const KNOWN_MOTION_STATES = new Set<string>(['driving', 'stopped'])

/** Deterministically apply screen/background/stop behavior to any active
 * plan on a motion change, and re-evaluate eligibility. Valid from any run
 * status/state — the only hard precondition is that the caller actually
 * supplies `capabilities`; a missing one is rejected rather than silently
 * skipping the capability-driven branch.
 *
 * `active_plan_disposition` in the emitted event is one of:
 *   - `"none"`         -- no active/backgrounded plan to affect.
 *   - `"backgrounded"` -- driving + `background_on_motion` service: screen
 *     suppressed, playback continues.
 *   - `"stopped"`      -- driving + hard stopped-only / non-backgroundable
 *     screen-dependent service (`full_karaoke` is special-cased ahead of
 *     the generic `stopped_only` check, mirroring `resolveEligibility`'s
 *     own ordering).
 *   - `"unchanged"`    -- every other case: a driving-capable audio plan
 *     stays `active` while driving (never suppressed), and ANY transition
 *     to `stopped` is "no forced stop" — a previously `backgrounded` plan
 *     simply resumes to `active`, which isn't a distinct disposition
 *     bucket of its own.
 *
 * Payload hardening: a missing/invalid `motion_state` is a structured
 * `invalid_payload` rejection, never a raw throw. */
function motionChange(
  runLog: ProposalRunLog,
  action: JourneyAction,
  now: string,
  capabilities: ServiceCapabilities | null,
): JourneyTransition {
  if (capabilities === null) {
    return reject(
      runLog,
      'capabilities_unavailable',
      "This action couldn't be completed due to missing internal data. / 内部データの不足によりこの操作を完了できませんでした。",
    )
  }

  const rawMotionState = action.payload.motion_state
  if (typeof rawMotionState !== 'string' || !KNOWN_MOTION_STATES.has(rawMotionState)) {
    return reject(
      runLog,
      'invalid_payload',
      "The vehicle motion state provided isn't recognized. / 指定された走行状態が認識できません。",
    )
  }
  const newMotion = rawMotionState as MotionState

  const js = runLog.journey_state
  const hasActivePlan = js.active_service_id !== null && (js.playback_state === 'active' || js.playback_state === 'backgrounded')

  let newPlaybackState = js.playback_state
  let disposition = 'none'

  if (hasActivePlan) {
    disposition = 'unchanged'
    if (newMotion === 'driving') {
      const cap = capabilities.get(js.active_service_id as ServiceId)
      if (cap.background_on_motion) {
        newPlaybackState = 'backgrounded'
        disposition = 'backgrounded'
      } else if (
        js.active_service_id === 'full_karaoke' ||
        cap.stopped_only ||
        (cap.screen_dependent && !cap.background_on_motion)
      ) {
        newPlaybackState = 'stopped'
        disposition = 'stopped'
      }
    } else {
      // newMotion === 'stopped'
      if (js.playback_state === 'backgrounded') newPlaybackState = 'active'
    }
  }

  const newJourneyState: JourneyState = { ...js, motion_state: newMotion, playback_state: newPlaybackState }

  const registeredEntities = deriveRegisteredEntities(runLog.world_snapshot)
  const eligibilityResult = resolveEligibility(
    runLog.opportunity.allowed_service_ids as ServiceId[],
    newMotion,
    capabilities,
    { registeredEntities },
  )
  const event: DiscreteEvent = {
    event_type: 'MOTION_CHANGED',
    at: now,
    payload: {
      motion_state: newMotion,
      active_plan_disposition: disposition,
      eligible: eligibilityResult.eligible,
      excluded: eligibilityResult.excluded.map((excl) => ({
        candidate_id: excl.service_id,
        platform_reason: excl.reason_codes.join(','),
      })),
    },
  }
  return { events: [event], new_journey_state: newJourneyState, new_status: runLog.status, rejected: null }
}

/** Arriving at a rest spot sets motion `stopped` and lifecycle stage
 * `during_rest_stopped` -- a journey event only (no ranked candidate is
 * ever fabricated for this transition). */
function restSpotArrived(runLog: ProposalRunLog, action: JourneyAction, now: string): JourneyTransition {
  void action
  if (runLog.opportunity.trigger_purpose !== 'rest_recommended') {
    return reject(
      runLog,
      'invalid_precondition',
      'This action is only available for a rest recommendation. / この操作は休憩推奨の機会でのみ行えます。',
    )
  }
  const newJourneyState: JourneyState = {
    ...runLog.journey_state,
    motion_state: 'stopped',
    lifecycle_stage: 'during_rest_stopped',
  }
  const event: DiscreteEvent = { event_type: 'REST_SPOT_ARRIVED', at: now, payload: {} }
  return { events: [event], new_journey_state: newJourneyState, new_status: runLog.status, rejected: null }
}

/** Rest formally begins -- a journey event only; no state change beyond
 * recording it (the run is already `during_rest_stopped`/`stopped` from
 * `rest_spot_arrived`). */
function restStarted(runLog: ProposalRunLog, action: JourneyAction, now: string): JourneyTransition {
  void action
  if (runLog.journey_state.lifecycle_stage !== 'during_rest_stopped') {
    return reject(
      runLog,
      'invalid_precondition',
      'This action is only available while stopped at the rest location. / この操作は休憩場所での停車中のみ行えます。',
    )
  }
  const event: DiscreteEvent = { event_type: 'REST_STARTED', at: now, payload: {} }
  return { events: [event], new_journey_state: runLog.journey_state, new_status: runLog.status, rejected: null }
}

function isValidLevel(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 100
}

/** Rest completion applies the EXPLICIT supplied post-rest driver-state
 * values, moves lifecycle stage to `after_rest_before_restart`, and opens a
 * fresh opportunity -- at the EVENT level only. No matrix/selector
 * re-dispatch happens here (no ranked candidate is fabricated for the new
 * stage).
 *
 * Payload hardening: a missing `post_rest`, or a `drowsiness_level`/
 * `fatigue_level` that is absent, not a whole number, or outside 0..100, is
 * a structured `invalid_payload` rejection, never a raw crash. */
function restCompleted(runLog: ProposalRunLog, action: JourneyAction, now: string): JourneyTransition {
  if (runLog.journey_state.lifecycle_stage !== 'during_rest_stopped') {
    return reject(
      runLog,
      'invalid_precondition',
      "This action isn't available until the rest stop has finished. / 休憩が完了する前は、この操作は行えません。",
    )
  }

  const postRest = action.payload.post_rest
  if (postRest === null || typeof postRest !== 'object' || Array.isArray(postRest)) {
    return reject(
      runLog,
      'invalid_payload',
      'The post-rest driver state values are missing or invalid. / 休憩後の運転者状態の値が不足しているか不正です。',
    )
  }

  const postRestObj = postRest as Record<string, unknown>
  const drowsinessLevel = postRestObj.drowsiness_level
  const fatigueLevel = postRestObj.fatigue_level
  if (!isValidLevel(drowsinessLevel) || !isValidLevel(fatigueLevel)) {
    return reject(
      runLog,
      'invalid_payload',
      'The post-rest drowsiness and fatigue values must each be a whole number from 0 to 100. / 休憩後の眠気と疲労度の値は、それぞれ0〜100の整数である必要があります。',
    )
  }

  const newJourneyState: JourneyState = { ...runLog.journey_state, lifecycle_stage: 'after_rest_before_restart' }
  const events: DiscreteEvent[] = [
    {
      event_type: 'REST_COMPLETED',
      at: now,
      payload: { drowsiness_level: drowsinessLevel, fatigue_level: fatigueLevel },
    },
    {
      event_type: 'OPPORTUNITY_OPENED',
      at: now,
      payload: {
        trigger_purpose: runLog.opportunity.trigger_purpose,
        lifecycle_stage: 'after_rest_before_restart',
      },
    },
  ]
  return { events, new_journey_state: newJourneyState, new_status: runLog.status, rejected: null }
}

// ---------------------------------------------------------------------------
// Dispatch table + applyAction
// ---------------------------------------------------------------------------

const KNOWN_SERVICE_IDS = new Set<string>([
  'music_playlist',
  'humming_karaoke',
  'call_response_driving',
  'quiz',
  'ranking_creation',
  'radio_style',
  'conversation_audio',
  'live_viewing',
  'stretch_video',
  'full_karaoke',
  'call_response_stopped',
  'oshi_reexperience',
  'relaxation_multisensory',
  'linked_video_recommendation',
])

/** Dispatch table — every `JourneyActionType` is mapped to a real handler
 * (mirrors Python's own table, minus the "default every key to
 * `_not_yet_implemented` first" step, which is unobservable once all twelve
 * keys are overwritten — see `notYetImplemented`'s doc comment). */
const HANDLERS: Record<JourneyActionType, Handler> = {
  accept,
  reject: rejectService,
  postpone,
  choose_another: chooseAnother,
  request_more: requestMore,
  complete,
  continue: continueAction,
  stop,
  motion_change: motionChange,
  rest_spot_arrived: restSpotArrived,
  rest_started: restStarted,
  rest_completed: restCompleted,
}

/**
 * Apply one journey action to `runLog`'s current state.
 *
 * PURE: no clock, no randomness, no storage I/O. `now` is the
 * caller-minted timestamp string threaded through to handlers;
 * `capabilities` is caller-loaded data threaded through the same way — the
 * engine never loads it itself. Only `motion_change` actually uses
 * `capabilities`; every other handler ignores it, and it defaults to `null`
 * (Python: `None`).
 *
 * An `action.action_type` with no entry in the dispatch table (should not
 * occur for a value produced by normal, well-typed callers — this defends
 * against a fabricated/bypassed value, mirroring Python's own
 * `model_construct`-bypass defense) is rejected the same way an
 * implemented-but-precondition-failing action is.
 */
export function applyAction(
  runLog: ProposalRunLog,
  action: JourneyAction,
  now: string,
  capabilities: ServiceCapabilities | null = null,
): JourneyTransition {
  const handler = HANDLERS[action.action_type as JourneyActionType]
  if (handler === undefined) {
    return reject(runLog, 'invalid_precondition', "This action type isn't recognized. / この操作の種類が認識できません。")
  }
  return handler(runLog, action, now, capabilities)
}
