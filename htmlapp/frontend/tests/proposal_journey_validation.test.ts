import { describe, expect, it } from 'vitest'
import {
  applyAction,
  notYetImplemented,
  type ProposalRunLog,
  type JourneyState,
  type JourneyAction,
} from '../src/engine/proposal/journey'
import { preview } from '../src/engine/proposal/journey_preview'
import { loadFixture } from '../src/engine/__fixtures__/parity'

/**
 * TS-logic tests (direct assertions, not parity) for `journey.ts` /
 * `journey_preview.ts` (C2 Task 5) — properties that aren't provable by
 * comparing a single call's output to one captured Python value: purity
 * (no mutation of the input run log), the shallow-copy discipline that
 * mirrors pydantic `model_copy(update=...)`'s `deep=False` default,
 * dispatch-table completeness (every `JourneyActionType` reaches a REAL
 * handler, never the dead `notYetImplemented` stub), and defensive-input
 * edge cases the captured fixture doesn't exercise on its own.
 *
 * Per-handler branch-coverage table and hazard verdicts are in the task
 * report.
 */

function baseRunLog(overrides: Partial<ProposalRunLog> = {}, jsOverrides: Partial<JourneyState> = {}): ProposalRunLog {
  const journeyState: JourneyState = {
    lifecycle_stage: 'active_driving_content',
    motion_state: 'driving',
    active_service_id: null,
    active_plan_id: null,
    playback_state: 'idle',
    current_plan_ref: null,
    previous_content: null,
    rejected_service_ids: [],
    ...jsOverrides,
  }
  return {
    status: 'created',
    journey_state: journeyState,
    opportunity: {
      opportunity_id: 'op-validation-1',
      trigger_purpose: 'route_music',
      lifecycle_stage: 'active_driving_content',
      allowed_service_ids: ['music_playlist'],
      simulation_time: '2026-07-20T09:00:00Z',
      run_seed: 'seed-1',
    },
    evidence: [],
    world_snapshot: { feature_snapshot: {}, feature_provenance: {} },
    ...overrides,
  }
}

describe('applyAction — purity (no mutation of the input run log)', () => {
  it('never mutates runLog.journey_state, even on a success path that changes it', () => {
    const runLog = baseRunLog(
      { status: 'service_selected' },
      { active_service_id: 'music_playlist', rejected_service_ids: [] },
    )
    const jsSnapshotBefore = JSON.stringify(runLog.journey_state)
    const action: JourneyAction = { action_type: 'reject', payload: {} }

    const transition = applyAction(runLog, action, '2026-01-01T00:00:00Z')

    expect(JSON.stringify(runLog.journey_state)).toBe(jsSnapshotBefore)
    // and the transition really did produce a DIFFERENT object
    expect(transition.new_journey_state).not.toBe(runLog.journey_state)
    expect(transition.new_journey_state.active_service_id).toBeNull()
  })

  it('never mutates action.payload', () => {
    const runLog = baseRunLog({ status: 'service_selected' })
    const payload = { selected_service_id: 'music_playlist' }
    const action: JourneyAction = { action_type: 'reject', payload }
    applyAction(runLog, action, '2026-01-01T00:00:00Z')
    expect(payload).toEqual({ selected_service_id: 'music_playlist' })
  })

  it('never mutates runLog.evidence (reject reads it via eligiblePool but never appends/removes)', () => {
    const evidence = [
      {
        step: 'service' as const, package_id: 'mock', contract_version: '1', schema_version: '1', matrix_version: 'v1',
        input_snapshot: { eligible_candidates: [{ candidate_id: 'music_playlist' }] },
        output: { ranked_candidates: [{ candidate_id: 'music_playlist', rank: 1 }] },
        error: null, used_feature_ids: [], unused_available_features: [], missing_features: [],
      },
    ]
    const runLog = baseRunLog(
      { status: 'service_selected', evidence },
      { active_service_id: 'music_playlist' },
    )
    const lengthBefore = runLog.evidence.length
    applyAction(runLog, { action_type: 'reject', payload: {} }, '2026-01-01T00:00:00Z')
    expect(runLog.evidence.length).toBe(lengthBefore)
    expect(runLog.evidence).toBe(evidence) // same array reference, untouched
  })
})

describe('applyAction — asymmetric shallow copy (mirrors pydantic model_copy(update=...), deep=False)', () => {
  it('reject: fields NOT named in the update (previous_content) are shared BY REFERENCE, not cloned', () => {
    const previousContent = { service_id: 'live_viewing' as const, plan_ref: 'live_viewing-plan' }
    const runLog = baseRunLog(
      { status: 'service_selected' },
      { active_service_id: 'music_playlist', previous_content: previousContent },
    )
    const transition = applyAction(runLog, { action_type: 'reject', payload: {} }, '2026-01-01T00:00:00Z')
    // previous_content wasn't part of _reject_service's update={...} -- must
    // be the EXACT SAME object reference as the input, not even a shallow
    // clone of it.
    expect(transition.new_journey_state.previous_content).toBe(previousContent)
  })

  it('reject: rejected_service_ids is a NEW array (not the same reference, and not mutated in place)', () => {
    const originalRejected: Array<'music_playlist'> = []
    const runLog = baseRunLog(
      { status: 'service_selected' },
      { active_service_id: 'music_playlist', rejected_service_ids: originalRejected },
    )
    const transition = applyAction(runLog, { action_type: 'reject', payload: {} }, '2026-01-01T00:00:00Z')
    expect(transition.new_journey_state.rejected_service_ids).not.toBe(originalRejected)
    expect(originalRejected).toEqual([]) // the original array is untouched
    expect(transition.new_journey_state.rejected_service_ids).toEqual(['music_playlist'])
  })

  it('reject dedup: re-rejecting an already-rejected service does not grow the array', () => {
    const runLog = baseRunLog(
      { status: 'service_selected' },
      { active_service_id: 'music_playlist', rejected_service_ids: ['music_playlist'] },
    )
    const transition = applyAction(runLog, { action_type: 'reject', payload: {} }, '2026-01-01T00:00:00Z')
    expect(transition.new_journey_state.rejected_service_ids).toEqual(['music_playlist'])
    expect(transition.new_journey_state.rejected_service_ids.length).toBe(1)
  })

  it('accept: journey_state fields untouched by the update (active_plan_id) are shared by reference-equal value', () => {
    const runLog = baseRunLog(
      {
        status: 'content_selected',
        evidence: [
          {
            step: 'content', package_id: 'mock', contract_version: '1', schema_version: '1', matrix_version: 'v1',
            input_snapshot: {}, output: { selected_service_id: 'music_playlist', next_transition_policy: 'auto_advance' },
            error: null, used_feature_ids: [], unused_available_features: [], missing_features: [],
          },
        ],
      },
      { active_service_id: 'music_playlist', active_plan_id: 'plan-abc' },
    )
    const transition = applyAction(runLog, { action_type: 'accept', payload: {} }, '2026-01-01T00:00:00Z')
    expect(transition.new_journey_state.active_plan_id).toBe('plan-abc')
  })
})

describe('applyAction — dispatch table completeness (every JourneyActionType reaches a REAL handler)', () => {
  const twelve = [
    'accept', 'reject', 'postpone', 'choose_another', 'request_more', 'complete',
    'continue', 'stop', 'motion_change', 'rest_spot_arrived', 'rest_started', 'rest_completed',
  ]
  const stubMessage = 'This action is not yet supported. / この操作には対応していません。'

  it.each(twelve)('%s never falls through to the notYetImplemented stub message', (actionType) => {
    const runLog = baseRunLog()
    const transition = applyAction(runLog, { action_type: actionType, payload: {} }, '2026-01-01T00:00:00Z')
    // Every action type is guaranteed to produce SOME transition (success or
    // a handler-specific rejection); none of them should ever produce the
    // stub's message, since all twelve are wired to real handlers.
    expect(transition.rejected?.message).not.toBe(stubMessage)
  })

  it('an unrecognized action_type DOES fall through to the generic "not recognized" rejection (not the stub)', () => {
    const runLog = baseRunLog()
    const transition = applyAction(runLog, { action_type: 'garbage_xyz', payload: {} }, '2026-01-01T00:00:00Z')
    expect(transition.rejected?.code).toBe('invalid_precondition')
    expect(transition.rejected?.message).toBe("This action type isn't recognized. / この操作の種類が認識できません。")
    expect(transition.rejected?.message).not.toBe(stubMessage)
  })

  it('notYetImplemented itself (dead code, unreachable via applyAction — closed enum has all 12 mapped) still produces the documented stub shape when called directly', () => {
    const runLog = baseRunLog()
    const transition = notYetImplemented(runLog)
    expect(transition.rejected).toEqual({ code: 'invalid_precondition', message: stubMessage })
    expect(transition.events).toEqual([])
    expect(transition.new_journey_state).toBe(runLog.journey_state)
    expect(transition.new_status).toBe(runLog.status)
  })

  it('applyAction capabilities parameter defaults to null when omitted (mirrors Python default=None)', () => {
    const runLog = baseRunLog({ status: 'service_selected' })
    const transition = applyAction(runLog, { action_type: 'motion_change', payload: { motion_state: 'driving' } }, '2026-01-01T00:00:00Z')
    expect(transition.rejected?.code).toBe('capabilities_unavailable')
  })
})

describe('rest_completed payload hardening — edge cases beyond the captured fixture', () => {
  function restCompletedRunLog(): ProposalRunLog {
    return baseRunLog({ status: 'created', opportunity: {
      opportunity_id: 'op-rc', trigger_purpose: 'rest_recommended', lifecycle_stage: 'during_rest_stopped',
      allowed_service_ids: ['live_viewing'], simulation_time: '2026-07-20T09:00:00Z', run_seed: 'seed-1',
    } }, { lifecycle_stage: 'during_rest_stopped', motion_state: 'stopped' })
  }

  it('drowsiness_level as a boolean is ALSO rejected (symmetry with the captured fatigue_level-boolean case)', () => {
    const runLog = restCompletedRunLog()
    const transition = applyAction(
      runLog,
      { action_type: 'rest_completed', payload: { post_rest: { drowsiness_level: true, fatigue_level: 15 } } },
      '2026-01-01T00:00:00Z',
    )
    expect(transition.rejected?.code).toBe('invalid_payload')
  })

  it('a non-integer float level is rejected (Number.isInteger, not just typeof number)', () => {
    const runLog = restCompletedRunLog()
    const transition = applyAction(
      runLog,
      { action_type: 'rest_completed', payload: { post_rest: { drowsiness_level: 50.5, fatigue_level: 20 } } },
      '2026-01-01T00:00:00Z',
    )
    expect(transition.rejected?.code).toBe('invalid_payload')
  })

  it('a negative level is rejected', () => {
    const runLog = restCompletedRunLog()
    const transition = applyAction(
      runLog,
      { action_type: 'rest_completed', payload: { post_rest: { drowsiness_level: -1, fatigue_level: 20 } } },
      '2026-01-01T00:00:00Z',
    )
    expect(transition.rejected?.code).toBe('invalid_payload')
  })

  it('a string-typed level is rejected (no implicit coercion)', () => {
    const runLog = restCompletedRunLog()
    const transition = applyAction(
      runLog,
      { action_type: 'rest_completed', payload: { post_rest: { drowsiness_level: '50', fatigue_level: 20 } } },
      '2026-01-01T00:00:00Z',
    )
    expect(transition.rejected?.code).toBe('invalid_payload')
  })

  it('post_rest as an array (not a plain object) is rejected', () => {
    const runLog = restCompletedRunLog()
    const transition = applyAction(
      runLog,
      { action_type: 'rest_completed', payload: { post_rest: [20, 15] } },
      '2026-01-01T00:00:00Z',
    )
    expect(transition.rejected?.code).toBe('invalid_payload')
  })

  it('boundary values 0 and 100 are BOTH valid (inclusive range)', () => {
    const runLog = restCompletedRunLog()
    const transition = applyAction(
      runLog,
      { action_type: 'rest_completed', payload: { post_rest: { drowsiness_level: 0, fatigue_level: 100 } } },
      '2026-01-01T00:00:00Z',
    )
    expect(transition.rejected).toBeNull()
  })
})

describe('regression-protected but not eyeball-provable: byte-identical outputs from distinct guard entries', () => {
  it('stop from "active" and stop from "completed" (both with no previous_content) produce byte-identical transitions', () => {
    const { input, output } = loadFixture('proposal_journey')
    const activeCase = input.cases.findIndex((c: any) => c.name === 'stop_from_active_no_previous_content')
    const completedCase = input.cases.findIndex((c: any) => c.name === 'stop_from_completed_no_previous_content')
    expect(activeCase).toBeGreaterThanOrEqual(0)
    expect(completedCase).toBeGreaterThanOrEqual(0)
    // Confirms what the task report documents explicitly: these two guard
    // branches (playback_state active vs. completed) are independently
    // reached (different input run_log.journey_state.playback_state) but
    // produce an IDENTICAL JourneyTransition, since neither field is echoed
    // in the output.
    expect(output.results[activeCase].transition).toEqual(output.results[completedCase].transition)
  })

  it('preview: rest-stage-not-found fallback is byte-identical to before_rest_until_stop (the next(..., 0) default lands on the same index a real match would)', () => {
    const { input, output } = loadFixture('proposal_journey_preview')
    const fallbackCase = input.cases.findIndex((c: any) => c.name === 'rest_chain_stage_not_found_falls_back_to_full_chain')
    const beforeRestCase = input.cases.findIndex((c: any) => c.name === 'rest_chain_from_before_rest')
    expect(fallbackCase).toBeGreaterThanOrEqual(0)
    expect(beforeRestCase).toBeGreaterThanOrEqual(0)
    expect(output.results[fallbackCase].preview).toEqual(output.results[beforeRestCase].preview)
  })
})

describe('preview — purity (no mutation, no persistence surface at all)', () => {
  it('never mutates runLog', () => {
    const runLog = baseRunLog({ opportunity: {
      opportunity_id: 'op-preview', trigger_purpose: 'rest_recommended', lifecycle_stage: 'before_rest_until_stop',
      allowed_service_ids: ['live_viewing'], simulation_time: '2026-07-20T09:00:00Z', run_seed: 'seed-1',
    } }, { lifecycle_stage: 'before_rest_until_stop' })
    const before = JSON.stringify(runLog)
    preview(runLog)
    expect(JSON.stringify(runLog)).toBe(before)
  })
})
