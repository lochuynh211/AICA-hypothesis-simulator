import { describe, it, expect, beforeEach } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { loadFixture, expectParity } from '../src/engine/__fixtures__/parity'
import { effectiveSchema, validate } from '../src/engine/services/feedback'
import { seedDefaults } from '../src/storage/db'
import { clearDraftRegistry } from '../src/engine/run_plan'
import { clearRegistry } from '../src/engine/run_manager'
import { createRunPlan, createRun, getFeedbackSchema, submitFeedback, getRunLog } from '../src/api/client'
import { FeedbackValidationError, type FeedbackSubmitBody } from '../src/api/types'

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory()
  clearDraftRegistry()
  clearRegistry()
  await seedDefaults()
})

describe('feedback parity', () => {
  const fx = loadFixture('feedback')

  it('derives the effective schema', () => {
    expectParity(effectiveSchema(fx.input.manifest), fx.output.schema)
  })

  it('validates categorical bodies', () => {
    const res = validate(fx.output.schema as any, fx.input.body)
    expect(res.ok).toBe(fx.output.valid)
  })

  it('flags an invalid body with the expected field errors', () => {
    const res = validate(fx.output.schema as any, fx.input.invalid_body)
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expectParity(res.errors, fx.output.invalid_errors)
    }
  })
})

describe('feedback seam wiring (client.ts)', () => {
  // nri_fatigue_score_v1 has feedback_schema: [] (V1 baseline only) — used
  // in client_runplan.test.ts too. Compatible with uc01_fatigue_recovery_v0_1.
  const PKG = 'nri_fatigue_score_v1'
  const SCN = 'uc01_fatigue_recovery_v0_1'

  async function makeRun(): Promise<string> {
    const plan = await createRunPlan({ packageId: PKG, scenarioId: SCN })
    const runState = await createRun(plan.plan_id)
    return runState.run_id
  }

  it('getFeedbackSchema derives the V1 baseline schema for a run with no extras', async () => {
    const runId = await makeRun()
    const schema = await getFeedbackSchema(runId)
    expect(schema.fields.length).toBe(9)
    expect(schema.fields.map((f) => f.key)).toEqual([
      'proposal_timing',
      'safety_impression',
      'intrusiveness',
      'understandability',
      'rest_spot_suitability',
      'proposal_content_suitability',
      'acceptance_reason',
      'rejection_reason',
      'overall_judgment',
    ])
  })

  it('submitFeedback: invalid body throws FeedbackValidationError with validationErrors', async () => {
    const runId = await makeRun()
    const body: FeedbackSubmitBody = {
      target: { scope: 'run' },
      labels: { proposal_timing: 'not_a_real_option' },
    }
    await expect(submitFeedback(runId, body)).rejects.toBeInstanceOf(FeedbackValidationError)
    try {
      await submitFeedback(runId, body)
      expect.fail('expected submitFeedback to reject')
    } catch (err) {
      expect(err).toBeInstanceOf(FeedbackValidationError)
      const ve = (err as FeedbackValidationError).validationErrors
      expect(ve.length).toBeGreaterThan(0)
      expect(ve.some((e) => e.field.includes('proposal_timing'))).toBe(true)
    }
  })

  it('submitFeedback: valid body appends a FeedbackEvent to the run log (append-only)', async () => {
    const runId = await makeRun()
    const body: FeedbackSubmitBody = {
      target: { scope: 'run' },
      labels: { proposal_timing: 'appropriate', overall_judgment: 'good_trigger' },
      comment: 'Felt natural',
    }

    const event = await submitFeedback(runId, body)
    expect(event.kind).toBe('feedback')
    expect(event.labels).toEqual(body.labels)
    expect(event.comment).toBe('Felt natural')

    // Append-only proof: the event lands in the run's persisted event log,
    // as the LAST event, without disturbing anything prior.
    const logBefore = await getRunLog(runId)
    const nBefore = logBefore.events.length
    expect(logBefore.events[nBefore - 1].kind).toBe('feedback')
    expect((logBefore.events[nBefore - 1] as any).labels).toEqual(body.labels)

    // A second submission appends again — never overwrites the first.
    const body2: FeedbackSubmitBody = { target: { scope: 'run' }, labels: {}, comment: 'second note' }
    await submitFeedback(runId, body2)
    const logAfter = await getRunLog(runId)
    expect(logAfter.events.length).toBe(nBefore + 1)
    expect(logAfter.events[nBefore - 1]).toEqual(logBefore.events[nBefore - 1])
    expect((logAfter.events[nBefore] as any).comment).toBe('second note')
  })
})
