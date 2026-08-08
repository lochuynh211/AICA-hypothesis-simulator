import { describe, it } from 'vitest'
import { loadFixture, expectParity } from '../src/engine/__fixtures__/parity'
import { advanceDriverState, applyStageRecoveryTick, type DriverSignalParams } from '../src/engine/behavior/driver_signals'
import { advanceRecovery, startRecovery } from '../src/engine/recovery'

// Feature 009: driver_model → driver_signals (attention retired; recovery is
// keyed by activity content). vehicle_model is deleted entirely.
//
// Recovery-semantics refactor: the one-shot `apply_rest_recovery` is retired.
// The fixture's `recovery` cases now replay through `apply_stage_recovery_tick`
// with `stage_ticks=1, tick_seconds=180.0` (see capture_all.py's
// `_capture_driver_signals`) — a single-tick stage collapses the per-tick
// curve back to the whole activity's amount in one call, matching this
// fixture's original one-call-per-case shape byte-for-byte.
describe('driver_signals parity', () => {
  const { input, output } = loadFixture('driver_signals')
  const params = input.params as DriverSignalParams

  input.advance.forEach((c: any, i: number) => {
    it(`advance_driver_state[${i}]`, () => {
      const upd = advanceDriverState(params, c.state, c.tick_seconds, {
        isNight: c.isNight,
        isMonotonous: c.isMonotonous,
        isTrafficJam: c.isTrafficJam,
        isMountainRoad: c.isMountainRoad,
        continuousDrivingMin: c.continuousDrivingMin,
      })
      expectParity({ previous: upd.previous, delta: upd.delta, next: upd.next }, output.advance[i], `advance[${i}]`)
    })
  })

  input.recovery.forEach((c: any, i: number) => {
    it(`apply_stage_recovery_tick[${i}] (${c.activity})`, () => {
      const [state] = applyStageRecoveryTick(params, c.state, c.activity, 1, 180.0, 0.0, 0.0)
      expectParity(state, output.recovery[i], `recovery[${i}]`)
    })
  })
})

describe('recovery parity', () => {
  for (const c of loadFixture('recovery') as any) {
    it(c.name ?? 'case', () => {
      const state = c.input.start ? startRecovery(c.input.option, c.input.restSpot) : c.input.state
      expectParity(advanceRecovery(state, c.input.option, { atRestSpot: c.input.atRestSpot }), c.output)
    })
  }
})
