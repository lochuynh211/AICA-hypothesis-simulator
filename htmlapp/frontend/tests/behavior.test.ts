import { describe, it, expect } from 'vitest'
import { loadFixture, expectParity } from '../src/engine/__fixtures__/parity'
import { advanceDriverState, applyRestRecovery } from '../src/engine/behavior/driver_model'
import { advanceVehicleState } from '../src/engine/behavior/vehicle_model'
import { advanceRecovery, startRecovery } from '../src/engine/recovery'

describe('driver_model parity', () => {
  for (const c of loadFixture('driver_model') as any) {
    it(c.name ?? 'case', () => expectParity(
      advanceDriverState(...(c.input.args as unknown as Parameters<typeof advanceDriverState>)),
      c.output,
    ))
  }
})
describe('vehicle_model parity', () => {
  for (const c of loadFixture('vehicle_model') as any) {
    it(c.name ?? 'case', () => expectParity(
      advanceVehicleState(...(c.input.args as unknown as Parameters<typeof advanceVehicleState>)),
      c.output,
    ))
  }
})
describe('recovery parity', () => {
  for (const c of loadFixture('recovery') as any) {
    it(c.name ?? 'case', () => {
      const state = c.input.start ? startRecovery(c.input.option, c.input.restSpot) : c.input.state
      expectParity(advanceRecovery(state, c.input.option, { atRestSpot: c.input.atRestSpot }), c.output)
    })
  }
})

// ── applyRestRecovery direct coverage ───────────────────────────────────────
// NOT dispatched by the loadFixture('driver_model') harness above (that loop
// always calls advanceDriverState, per Step 2 of task-S3.2-brief.md verbatim).
// Values below were computed by calling the actual Python
// aica_api.services.behavior.driver_model.apply_rest_recovery(...) with the
// exact _PROFILE fixture from app/api/tests/test_driver_model.py (see
// test_short_rest_reduces_drowsiness/fatigue, test_long_rest_reduces_*, and
// test_rest_recovery_clamped_at_zero) via a throwaway capture script — not
// hand-invented. See task-S3.2-report.md for the full generation method.
describe('applyRestRecovery parity (direct, not fixture-driven)', () => {
  const PROFILE = {
    id: 'test_driver',
    drowsiness_model: {
      base_growth_per_min: 0.5,
      night_add_per_min: 0.4,
      monotony_add_per_min: 0.3,
      traffic_jam_add_per_min: 0.2,
    },
    fatigue_model: {
      base_growth_per_min: 0.1,
      continuous_driving_add_per_min_after_60_min: 0.04,
      mountain_road_add_per_min: 0.05,
      traffic_jam_add_per_min: 0.03,
    },
    attention_model: {
      base_recovery_per_min: 0.01,
      monotony_drop_per_min: 0.05,
      drowsiness_drop_factor: 0.2,
      active_content_recovery_per_min: 0.04,
    },
    recovery_model: {
      short_rest_drowsiness_recovery: 20.0,
      short_rest_fatigue_recovery: 15.0,
      long_rest_drowsiness_recovery: 35.0,
      long_rest_fatigue_recovery: 30.0,
    },
  }

  it('short rest reduces drowsiness/fatigue, boosts attention', () => {
    const recovered = applyRestRecovery(PROFILE, { drowsiness: 50.0, fatigue: 40.0, attention: 40.0 }, 'short')
    expectParity(recovered, { drowsiness: 30.0, fatigue: 25.0, attention: 50.0 })
  })

  it('long rest reduces drowsiness/fatigue, boosts attention', () => {
    const recovered = applyRestRecovery(PROFILE, { drowsiness: 50.0, fatigue: 50.0, attention: 40.0 }, 'long')
    expectParity(recovered, { drowsiness: 15.0, fatigue: 20.0, attention: 57.5 })
  })

  it('clamps drowsiness/fatigue at zero', () => {
    const recovered = applyRestRecovery(PROFILE, { drowsiness: 5.0, fatigue: 5.0, attention: 50.0 }, 'long')
    expectParity(recovered, { drowsiness: 0.0, fatigue: 0.0, attention: 67.5 })
    expect(recovered.drowsiness).toBeGreaterThanOrEqual(0)
    expect(recovered.fatigue).toBeGreaterThanOrEqual(0)
  })
})
