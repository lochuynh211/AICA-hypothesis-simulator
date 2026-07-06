import { describe, it } from 'vitest'
import { loadFixture, expectParity } from '../src/engine/__fixtures__/parity'
import { advanceDriverState, applyRestRecovery, type DriverSignalParams } from '../src/engine/behavior/driver_signals'
import { advanceRecovery, startRecovery } from '../src/engine/recovery'

// Feature 009: driver_model → driver_signals (attention retired; recovery is
// keyed by activity content). vehicle_model is deleted entirely.
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
    it(`apply_rest_recovery[${i}] (${c.activity})`, () => {
      expectParity(applyRestRecovery(params, c.state, c.activity), output.recovery[i], `recovery[${i}]`)
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
