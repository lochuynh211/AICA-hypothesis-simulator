import { describe, it, expect, beforeEach } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { loadFixture, expectParity } from '../src/engine/__fixtures__/parity'
import { effectiveSchema, validate } from '../src/engine/services/feedback'
import { seedDefaults } from '../src/storage/db'
import { createDraft, clearDraftRegistry } from '../src/engine/run_plan'
import {
  createRun as engineCreateRun,
  tick as engineTick,
  action as engineAction,
  clearRegistry,
} from '../src/engine/run_manager'
import { packagesStore } from '../src/storage/packages_store'
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

// ── Critical fix (S5.1 review): event_ref resolution from a human anchor ──
//
// The shipped submitFeedback validated body.target UNCHANGED — it never
// ported runs.py's `_resolve_event_ref` (called as step 2 of post_feedback,
// BEFORE validation). The already-wired UI (DecisionTracePanel.tsx submits
// `{ scope: 'decision', tick_index }` with no event_ref) therefore always
// hit "event_ref is required for scope='decision'..." and submitFeedback
// ALWAYS threw. Every prior test in this file only used scope='run' (no
// event_ref to resolve), so this path had zero coverage.
//
// These tests drive a REAL run — reusing the reconstructed declarative_rule
// package (`rest_rule_based_v0_1`) + `run_log_e2e` fixture input from
// tests/run_manager.test.ts, the only combination in this repo whose ticks
// actually reach a fired REST_PROPOSAL and an accept_rest action — so the
// resulting run log has tick/proposal/action events to resolve against.
describe('submitFeedback: event_ref resolution from tick_index/action anchor (S5.1 review fix)', () => {
  /**
   * Drive a run to its one accept_rest decision point exactly like
   * run_manager.test.ts's "run manager e2e" case, using the engine layer
   * directly (not the client.ts/createRunPlan seam) because the
   * reconstructed `rest_rule_based_v0_1` package is not one of the two
   * bundled packages seedDefaults() seeds into the package registry.
   *
   * The package IS separately registered into packagesStore below so that
   * submitFeedback's own `packageRegistry.get(log.snapshot.package.id)`
   * schema lookup (unrelated to this fix, but on the same call path)
   * resolves instead of throwing "Package ... not found".
   *
   * Returns the run id and the tick_index of the fired REST_PROPOSAL —
   * `action()` records the ActionEvent at that same tick_index (the tick
   * that fired the proposal, i.e. `runState.current_tick - 1` — see
   * src/engine/run_manager.ts), so one tick_index anchors all three scopes
   * (decision / proposal / action) exercised below.
   */
  async function driveE2ERun(): Promise<{ runId: string; proposalTickIndex: number }> {
    const fx = loadFixture('run_log_e2e')
    const { package: pkg, scenario, presets, parameters, hyperparameters, runMode, recoveryOptionId, restSpot } =
      fx.input

    await packagesStore.put({
      id: pkg.id,
      manifest: pkg,
      origin: 'builtin',
      strategy: pkg.algorithm.type,
    })

    const suffix = `${Date.now()}-${Math.random()}`
    const planId = `plan-feedback-e2e-${suffix}`
    const { draft } = createDraft({ planId, package: pkg, scenario, presets, parameters, hyperparameters, runMode })
    expect(draft.validation_errors).toEqual([])

    const runId = `run-feedback-e2e-${suffix}`
    await engineCreateRun(planId, runId)

    let proposalTickIndex: number | null = null
    let acceptedOnce = false
    let outcome
    let guard = 0
    do {
      guard += 1
      if (guard > 1000) throw new Error('run did not complete within 1000 ticks — REST_PROPOSAL likely never fired')
      outcome = await engineTick(runId)
      if (outcome.completed) break
      if (outcome.paused) {
        if (!acceptedOnce) {
          expect(outcome.decision?.result_type).toBe('REST_PROPOSAL')
          proposalTickIndex = outcome.evaluatedTickIndex
          await engineAction(runId, 'accept_rest', { recoveryOptionId, restSpot })
          acceptedOnce = true
        } else {
          await engineAction(runId, 'decline')
        }
      }
    } while (!outcome.completed)

    expect(acceptedOnce, 'the fixture flow must exercise exactly one accept_rest action').toBe(true)
    expect(proposalTickIndex).not.toBeNull()

    return { runId, proposalTickIndex: proposalTickIndex as number }
  }

  it('scope="decision" with only tick_index (no event_ref) resolves + validates + appends — reproduces the shipped bug', async () => {
    const { runId, proposalTickIndex } = await driveE2ERun()

    // This is EXACTLY the shape DecisionTracePanel.tsx:300 submits:
    // `{ scope: 'decision', tick_index: entry.tick_index }`, no event_ref.
    const body: FeedbackSubmitBody = { target: { scope: 'decision', tick_index: proposalTickIndex } }

    const event = await submitFeedback(runId, body)

    expect(event.kind).toBe('feedback')
    expect(event.target.scope).toBe('decision')
    expect(event.target.event_ref).not.toBeNull()
    expect(event.target.event_ref).not.toBeUndefined()

    const log = await getRunLog(runId)
    const resolvedIdx = event.target.event_ref as number
    const resolvedEvent = log.events[resolvedIdx] as any
    expect(resolvedEvent.kind).toBe('tick')
    expect(resolvedEvent.tick_index).toBe(proposalTickIndex)

    // Append-only proof: the FeedbackEvent (with the RESOLVED target) is the
    // last event, and its target.event_ref survives the round trip through
    // storage unchanged.
    const lastEvent = log.events[log.events.length - 1] as any
    expect(lastEvent.kind).toBe('feedback')
    expect(lastEvent.target.event_ref).toBe(resolvedIdx)
    expect(lastEvent.target.scope).toBe('decision')
  })

  it('scope="proposal" with only tick_index resolves to the fired-proposal tick', async () => {
    const { runId, proposalTickIndex } = await driveE2ERun()

    const body: FeedbackSubmitBody = { target: { scope: 'proposal', tick_index: proposalTickIndex } }
    const event = await submitFeedback(runId, body)

    expect(event.target.scope).toBe('proposal')
    const log = await getRunLog(runId)
    const resolvedIdx = event.target.event_ref as number
    const resolvedEvent = log.events[resolvedIdx] as any
    expect(resolvedEvent.kind).toBe('tick')
    expect(resolvedEvent.tick_index).toBe(proposalTickIndex)
    expect(resolvedEvent.trace.decision_result.fire_control.fired).toBe(true)
    expect(resolvedEvent.trace.decision_result.proposal).not.toBeNull()
  })

  it('scope="action" with tick_index + action resolves to the ActionEvent', async () => {
    const { runId, proposalTickIndex } = await driveE2ERun()

    const body: FeedbackSubmitBody = {
      target: { scope: 'action', tick_index: proposalTickIndex, action: 'accept_rest' },
    }
    const event = await submitFeedback(runId, body)

    expect(event.target.scope).toBe('action')
    const log = await getRunLog(runId)
    const resolvedIdx = event.target.event_ref as number
    const resolvedEvent = log.events[resolvedIdx] as any
    expect(resolvedEvent.kind).toBe('action')
    expect(resolvedEvent.tick_index).toBe(proposalTickIndex)
    expect(resolvedEvent.action).toBe('accept_rest')
  })

  it('scope="decision" with a nonexistent tick_index throws "No decision event found..."', async () => {
    const { runId } = await driveE2ERun()

    const body: FeedbackSubmitBody = { target: { scope: 'decision', tick_index: 999999 } }
    await expect(submitFeedback(runId, body)).rejects.toBeInstanceOf(FeedbackValidationError)

    try {
      await submitFeedback(runId, body)
      expect.fail('expected submitFeedback to reject')
    } catch (err) {
      expect(err).toBeInstanceOf(FeedbackValidationError)
      const ve = (err as FeedbackValidationError).validationErrors
      expect(ve.some((e) => e.message === 'No decision event found for tick_index=999999 in the run log.')).toBe(
        true,
      )
    }
  })
})
