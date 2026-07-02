import { describe, it } from 'vitest'
import { loadFixture, expectParity } from '../src/engine/__fixtures__/parity'
import { freezeEventPlan } from '../src/engine/event_plan'
import { advanceTick } from '../src/engine/tick_engine'
import { createDraft, clearDraftRegistry } from '../src/engine/run_plan'

describe('event plan parity', () => {
  it('freezes identically to docker', () => {
    const fx = loadFixture('event_plan')
    expectParity(freezeEventPlan(fx.input.scenario, fx.input.seed), fx.output)
  })
})

describe('full tick sequence determinism', () => {
  it('reproduces the docker tick states end to end', () => {
    const fx = loadFixture('tick_sequence')
    const { scenario, eventPlan, routeFacts } = fx.input
    let prior: any = null
    fx.output.forEach((expected: any, i: number) => {
      const state = advanceTick({ priorState: prior, tickIndex: i, eventPlan, routeFacts, scenario })
      expectParity(state, expected)
      prior = state
    })
  })
})

// run_plan.ts is NOT covered by the brief's Step 2 harness (event_plan +
// tick_sequence only) — added per task-S3.3 instructions so createDraft
// ships with parity coverage, not untested.
describe('run_plan parity (createDraft)', () => {
  it('creates a draft matching the docker create_draft output', () => {
    clearDraftRegistry()
    const fx = loadFixture('run_plan')
    const { planId, package: pkg, scenario, presets, parameters, hyperparameters, routeFacts } = fx.input
    const result = createDraft({
      planId,
      package: pkg,
      scenario,
      presets,
      parameters,
      hyperparameters,
      routeFacts,
    })
    expectParity(result, fx.output)
  })
})
