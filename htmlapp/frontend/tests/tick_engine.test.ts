import { describe, it, expect } from 'vitest'
import { loadFixture, expectParity } from '../src/engine/__fixtures__/parity'
import { buildEventPlan } from '../src/engine/event_plan'
import { analyzeRoute } from '../src/engine/services/route_analysis'
import { advanceTick } from '../src/engine/tick_engine'
import { createDraft, clearDraftRegistry } from '../src/engine/run_plan'
import type { RecoveryStateT, RestSpot } from '../src/api/types'

describe('event plan parity (M2 build_event_plan)', () => {
  it('builds identically to docker', () => {
    const { input, output } = loadFixture('event_plan')
    const rf = analyzeRoute(input.scenario)
    expectParity(buildEventPlan(rf, input.scenario, {}), output, 'event_plan')
  })
})

describe('full tick sequence determinism (feature 009 tiered signals)', () => {
  it('reproduces the docker tick states end to end', () => {
    const { input, output } = loadFixture('tick_sequence')
    const { scenario, run_seed, route_facts, event_plan } = input
    let prior: any = null
    output.states.forEach((expected: any, i: number) => {
      const state = advanceTick({
        priorState: prior,
        tickIndex: i,
        eventPlan: event_plan,
        routeFacts: route_facts,
        scenario,
        runSeed: run_seed,
      })
      expectParity(state, expected, `tick[${i}]`)
      prior = state
    })
  })
})

describe('recovery: MOVING approach tick clamps at the rest spot (fixbug-0806)', () => {
  it('does not overshoot the spot on the arrival tick', () => {
    // Mirrors the Python regression test_moving_approach_tick_does_not_overshoot_
    // rest_spot: the arrival tick of the MOVING wakefulness stage used to advance
    // distance normally and overshoot the spot (e.g. frac 0.5083); the next
    // (STOPPED) tick then snapped position back to 0.5. That non-monotonic
    // forward-then-back blip drew as a hook on the distance-axis quickview curve.
    const { input } = loadFixture('event_plan') // genuine UC-01 scenario w/ nap_karaoke
    const scenario = input.scenario
    const routeFacts = analyzeRoute(scenario)
    const eventPlan = buildEventPlan(routeFacts, scenario, {})
    const totalKm = routeFacts.total_route_distance_km || 120.0

    const spot: RestSpot = { id: 'p1', label: { ja: 'SA', en: 'SA' }, route_fraction: 0.5 }
    // Active on the MOVING wakefulness stage (stage_index 0).
    const recovery: RecoveryStateT = {
      active: true,
      option_id: 'nap_karaoke',
      rest_spot: spot,
      phase: 'wakefulness',
      stage_index: 0,
      stage_ticks_remaining: 0,
      moving_recovery_accrued_drowsiness: 0.0,
      moving_recovery_accrued_fatigue: 0.0,
    }

    // Prior position sits JUST short of the spot so any forward motion this tick
    // crosses it — the exact condition that used to overshoot.
    let prior = advanceTick({ priorState: null, tickIndex: 0, eventPlan, routeFacts, scenario })
    prior = { ...prior, distance_km: 0.499 * totalKm }
    const out = advanceTick({ priorState: prior, tickIndex: 1, eventPlan, routeFacts, scenario, recovery })

    expect(out.route_fraction).toBeLessThanOrEqual(0.5 + 1e-9)
    expect(Math.abs(out.route_fraction - 0.5)).toBeLessThan(1e-6)
  })

  it('holds position at the rest spot on the resuming tick', () => {
    // Mirrors the Python regression test_resuming_tick_holds_position_at_rest_
    // spot: the one-tick "resuming" phase (all stages done, recovery about to go
    // inactive) used to fall through both the STOPPED-hold and MOVING-clamp
    // branches — currentStage() returns null once stage_index is past the last
    // stage — so distance advanced a full tick past the spot (0.5 -> 0.5083).
    // The merged auto-drive PAUSES on exactly this tick to surface the after-rest
    // proposal, so the animation parked the car one tick BEYOND the gold marker.
    const { input } = loadFixture('event_plan') // genuine UC-01 scenario w/ nap_karaoke
    const scenario = input.scenario
    const routeFacts = analyzeRoute(scenario)
    const eventPlan = buildEventPlan(routeFacts, scenario, {})
    const totalKm = routeFacts.total_route_distance_km || 120.0

    const spot: RestSpot = { id: 'p1', label: { ja: 'SA', en: 'SA' }, route_fraction: 0.5 }
    // nap_karaoke has 3 stages [MOVING wakefulness, STOPPED nap, STOPPED content];
    // the resuming tick sits one past the last (stage_index 3, phase 'resuming').
    const recovery: RecoveryStateT = {
      active: true,
      option_id: 'nap_karaoke',
      rest_spot: spot,
      phase: 'resuming',
      stage_index: 3,
      stage_ticks_remaining: 0,
      moving_recovery_accrued_drowsiness: 0.0,
      moving_recovery_accrued_fatigue: 0.0,
    }

    let prior = advanceTick({ priorState: null, tickIndex: 0, eventPlan, routeFacts, scenario })
    prior = { ...prior, distance_km: 0.5 * totalKm }
    const out = advanceTick({ priorState: prior, tickIndex: 1, eventPlan, routeFacts, scenario, recovery })

    // Held exactly at the spot — not advanced past it.
    expect(Math.abs(out.route_fraction - 0.5)).toBeLessThan(1e-6)
    expect(Math.abs((out.distance_km ?? 0.0) - 0.5 * totalKm)).toBeLessThan(1e-6)
    // Recovery collapses to inactive so run_manager clears run_state.recovery.
    expect(out._recovery_next?.active).toBe(false)
  })
})

describe('run_plan parity (createDraft)', () => {
  it('creates a draft matching the docker create_draft output', () => {
    clearDraftRegistry()
    const { input, output } = loadFixture('run_plan')
    const result = createDraft({
      planId: input.plan_id,
      package: input.package,
      scenario: input.scenario,
      presets: {},
      parameters: {},
      hyperparameters: {},
    })
    expectParity(result, output, 'run_plan')
  })
})
