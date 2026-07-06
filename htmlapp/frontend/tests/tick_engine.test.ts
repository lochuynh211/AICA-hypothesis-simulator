import { describe, it } from 'vitest'
import { loadFixture, expectParity } from '../src/engine/__fixtures__/parity'
import { buildEventPlan } from '../src/engine/event_plan'
import { analyzeRoute } from '../src/engine/services/route_analysis'
import { advanceTick } from '../src/engine/tick_engine'
import { createDraft, clearDraftRegistry } from '../src/engine/run_plan'

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
