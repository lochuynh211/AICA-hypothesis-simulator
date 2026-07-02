/**
 * Pure recovery-phase state machine (Approach A).
 *
 * Ported from `app/api/aica_api/services/recovery.py` (behavior-of-record).
 * Drives a RecoveryState through an option's ordered stages. No I/O, no engine
 * coupling — the tick engine calls advanceRecovery once per tick and applies
 * the motion/recovery effects from the returned phase.
 *
 * Only the exported function identifiers (currentStage, startRecovery,
 * advanceRecovery) are camelCased. All object keys and phase/stage string
 * values cross the parity boundary and are preserved byte-for-byte from the
 * Python (snake_case). The Python's keyword-only `at_rest_spot` becomes the
 * options-object field `{ atRestSpot }`.
 */

import type { RecoveryOption, RecoveryStage, RecoveryStateT, RestSpot } from '../api/types'

export function currentStage(state: RecoveryStateT, option: RecoveryOption): RecoveryStage | null {
  const stages = option.stages ?? []
  if (state.stage_index < 0 || state.stage_index >= stages.length) {
    return null
  }
  return stages[state.stage_index]
}

export function startRecovery(option: RecoveryOption, restSpot: RestSpot): RecoveryStateT {
  const stages = option.stages ?? []
  const first = stages.length > 0 ? stages[0] : null
  return {
    active: true,
    option_id: option.id,
    rest_spot: restSpot,
    phase: first ? first.phase : 'resuming',
    stage_index: 0,
    stage_ticks_remaining: first ? (first.ticks ?? 0) : 0,
  }
}

function enterStage(state: RecoveryStateT, option: RecoveryOption, index: number): RecoveryStateT {
  const stages = option.stages ?? []
  if (index >= stages.length) {
    return { ...state, phase: 'resuming', stage_index: index, stage_ticks_remaining: 0 }
  }
  const stage = stages[index]
  return {
    ...state,
    phase: stage.phase,
    stage_index: index,
    stage_ticks_remaining: stage.ticks ?? 0,
  }
}

export function advanceRecovery(
  state: RecoveryStateT,
  option: RecoveryOption,
  { atRestSpot }: { atRestSpot: boolean },
): RecoveryStateT {
  if (state.phase === 'resuming') {
    return { ...state, active: false, phase: null }
  }

  const stage = currentStage(state, option)
  if (stage === null) {
    return { ...state, phase: 'resuming', stage_ticks_remaining: 0 }
  }

  // MOVING wakefulness: hold until the car reaches the rest spot.
  if (stage.motion === 'MOVING') {
    if (!atRestSpot) {
      return state // keep driving toward the spot
    }
    return enterStage(state, option, state.stage_index + 1)
  }

  // STOPPED stage: count down its dwell ticks, then move on.
  const remaining = state.stage_ticks_remaining - 1
  if (remaining > 0) {
    return { ...state, stage_ticks_remaining: remaining }
  }
  return enterStage(state, option, state.stage_index + 1)
}
