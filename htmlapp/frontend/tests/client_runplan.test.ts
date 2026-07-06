import { describe, it, expect, beforeEach } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { seedDefaults } from '../src/storage/db'
import { createRunPlan, regenerateRunPlan, RunPlanError } from '../src/api/client'
import { clearDraftRegistry } from '../src/engine/run_plan'

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory()
  await seedDefaults()
  clearDraftRegistry()
})

const PKG = 'nri_fatigue_score_v1'
const SCN = 'uc01_fatigue_recovery_v0_1'

describe('createRunPlan seam', () => {
  it('returns a plan id and preview for a valid setup', async () => {
    const plan = await createRunPlan({
      packageId: PKG,
      scenarioId: SCN,
    })
    expect(typeof (plan as any).plan_id).toBe('string')
    expect(plan.validation_errors).toEqual([])
    expect(plan.draft_plan).toBeTruthy()
    expect(plan.effective_setup).toBeTruthy()
  })

  it('rejects an unknown package_id', async () => {
    await expect(createRunPlan({ packageId: 'nope', scenarioId: SCN })).rejects.toBeInstanceOf(Error)
  })

  it('rejects an unknown scenario_id', async () => {
    await expect(createRunPlan({ packageId: PKG, scenarioId: 'nope' })).rejects.toBeInstanceOf(Error)
  })

  it('requires route_id and route_facts when route_source is "maps"', async () => {
    await expect(
      createRunPlan({ packageId: PKG, scenarioId: SCN, routeSource: 'maps' }),
    ).rejects.toMatchObject({ message: expect.stringContaining('route_id is required') })

    await expect(
      createRunPlan({ packageId: PKG, scenarioId: SCN, routeSource: 'maps', routeId: 'route-0' }),
    ).rejects.toMatchObject({ message: expect.stringContaining('route_facts is required') })
  })

  it('rejects an invalid initial_state key', async () => {
    try {
      await createRunPlan({
        packageId: PKG,
        scenarioId: SCN,
        initialState: { bogus_key: 50 } as any,
      })
      expect.fail('expected rejection')
    } catch (err) {
      expect(err).toBeInstanceOf(RunPlanError)
      const ve = (err as RunPlanError).validationErrors
      expect(ve.some((e) => e.field === 'initial_state.bogus_key')).toBe(true)
    }
  })

  it('rejects an out-of-range initial_state value', async () => {
    try {
      await createRunPlan({
        packageId: PKG,
        scenarioId: SCN,
        initialState: { drowsiness_level: 150 },
      })
      expect.fail('expected rejection')
    } catch (err) {
      expect(err).toBeInstanceOf(RunPlanError)
      const ve = (err as RunPlanError).validationErrors
      expect(ve.some((e) => e.field === 'initial_state.drowsiness_level')).toBe(true)
    }
  })

  it('accepts a valid initial_state override', async () => {
    const plan = await createRunPlan({
      packageId: PKG,
      scenarioId: SCN,
      initialState: { drowsiness_level: 42 },
    })
    expect(plan.validation_errors).toEqual([])
  })

  it('rejects an invalid context_overrides key/type', async () => {
    try {
      await createRunPlan({
        packageId: PKG,
        scenarioId: SCN,
        contextOverrides: { child_passenger: 'yes' } as any,
      })
      expect.fail('expected rejection')
    } catch (err) {
      expect(err).toBeInstanceOf(RunPlanError)
      const ve = (err as RunPlanError).validationErrors
      expect(ve.some((e) => e.field === 'context_overrides.child_passenger')).toBe(true)
    }
  })

  it('rejects an unknown parameter key', async () => {
    try {
      await createRunPlan({
        packageId: PKG,
        scenarioId: SCN,
        parameters: { totally_bogus_param: true },
      })
      expect.fail('expected rejection')
    } catch (err) {
      expect(err).toBeInstanceOf(RunPlanError)
      const ve = (err as RunPlanError).validationErrors
      expect(ve.some((e) => e.field === 'totally_bogus_param')).toBe(true)
    }
  })
})

describe('regenerateRunPlan seam', () => {
  it('rejects an unknown plan_id', async () => {
    await expect(regenerateRunPlan('plan_does_not_exist', {})).rejects.toBeInstanceOf(RunPlanError)
  })

  it('regenerates an existing draft with the same plan_id', async () => {
    const plan = await createRunPlan({ packageId: PKG, scenarioId: SCN })
    const regenerated = await regenerateRunPlan(plan.plan_id, {})
    expect(regenerated.plan_id).toBe(plan.plan_id)
    expect(regenerated.validation_errors).toEqual([])
  })

  it('re-derives local route_facts fresh on each regenerate (no shared aliasing)', async () => {
    const plan = await createRunPlan({ packageId: PKG, scenarioId: SCN })
    const r1 = await regenerateRunPlan(plan.plan_id, {})
    const r2 = await regenerateRunPlan(plan.plan_id, {})
    // Both regenerations must succeed and produce equal (but not necessarily
    // identical-object) route-derived draft plans, proving route facts are
    // being recomputed rather than erroring out on a stale reference.
    expect(r1.validation_errors).toEqual([])
    expect(r2.validation_errors).toEqual([])
    expect(r1.draft_plan).toEqual(r2.draft_plan)
  })
})

// ── PART 3: profile-override validation ─────────────────────────────────────

describe('createRunPlan profile-override validation', () => {
  it('applies a VALID driver profile override to effective_setup', async () => {
    const plan = await createRunPlan({
      packageId: PKG,
      scenarioId: SCN,
      profiles: { driver: { drowsiness_model: { base_growth_per_min: 1.5 } } },
    })
    expect(plan.validation_errors).toEqual([])
    const driverProfile = plan.effective_setup.driver_profile as any
    expect(driverProfile.drowsiness_model.base_growth_per_min).toBe(1.5)
    // Untouched sibling fields survive the deep-merge.
    expect(driverProfile.drowsiness_model.night_add_per_min).toBeTypeOf('number')
  })

  it('rejects a NEGATIVE growth-rate override (nonneg constraint)', async () => {
    try {
      await createRunPlan({
        packageId: PKG,
        scenarioId: SCN,
        profiles: { driver: { drowsiness_model: { base_growth_per_min: -1 } } },
      })
      expect.fail('expected rejection')
    } catch (err) {
      expect(err).toBeInstanceOf(RunPlanError)
      const ve = (err as RunPlanError).validationErrors
      expect(ve.some((e) => e.field === 'profiles.driver.drowsiness_model.base_growth_per_min')).toBe(true)
    }
  })

  it('rejects a vehicle profile override (retired in feature 009)', async () => {
    try {
      await createRunPlan({
        packageId: PKG,
        scenarioId: SCN,
        profiles: { vehicle: { lane_departure: { drowsiness_threshold: 150 } } } as unknown as { driver?: Record<string, unknown> },
      })
      expect.fail('expected rejection')
    } catch (err) {
      expect(err).toBeInstanceOf(RunPlanError)
      const ve = (err as RunPlanError).validationErrors
      expect(ve.some((e) => e.field === 'profiles.vehicle')).toBe(true)
    }
  })

  it('rejects an out-of-range anomaly-signal-param override (feature 009)', async () => {
    try {
      await createRunPlan({
        packageId: PKG,
        scenarioId: SCN,
        profiles: { anomaly: { lambda_base: -1 } },
      })
      expect.fail('expected rejection')
    } catch (err) {
      expect(err).toBeInstanceOf(RunPlanError)
      const ve = (err as RunPlanError).validationErrors
      expect(ve.some((e) => e.field === 'profiles.anomaly.lambda_base')).toBe(true)
    }
  })

  it('rejects an unknown (extra) key inside a profile override', async () => {
    try {
      await createRunPlan({
        packageId: PKG,
        scenarioId: SCN,
        profiles: { speed: { totally_bogus_speed_field: 10 } },
      })
      expect.fail('expected rejection')
    } catch (err) {
      expect(err).toBeInstanceOf(RunPlanError)
      const ve = (err as RunPlanError).validationErrors
      expect(ve.some((e) => e.field === 'profiles.speed.totally_bogus_speed_field')).toBe(true)
    }
  })

  it('applies a VALID speed profile override', async () => {
    const plan = await createRunPlan({
      packageId: PKG,
      scenarioId: SCN,
      profiles: { speed: { highway_kph: 90 } },
    })
    expect(plan.validation_errors).toEqual([])
    expect((plan.effective_setup.speed_profile as any).highway_kph).toBe(90)
  })

  it('leaves the scenario UNMODIFIED when the override is invalid (draft not registered)', async () => {
    await expect(
      createRunPlan({
        packageId: PKG,
        scenarioId: SCN,
        profiles: { driver: { drowsiness_model: { base_growth_per_min: -1 } } },
      }),
    ).rejects.toBeInstanceOf(RunPlanError)

    // A subsequent valid plan for the same package/scenario must still see
    // the scenario's ORIGINAL (unmodified) driver_profile default, proving
    // the invalid override was never applied/registered.
    const plan = await createRunPlan({ packageId: PKG, scenarioId: SCN })
    expect(plan.validation_errors).toEqual([])
    const driverProfile = plan.effective_setup.driver_profile as any
    expect(driverProfile.drowsiness_model.base_growth_per_min).not.toBe(-1)
  })
})
