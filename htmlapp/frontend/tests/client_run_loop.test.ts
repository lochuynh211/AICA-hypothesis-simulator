import { describe, it, expect, beforeEach } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { seedDefaults } from '../src/storage/db'
import { createRunPlan, createRun, tickRun, actRun, getRunLog, listRuns } from '../src/api/client'
import { clearDraftRegistry } from '../src/engine/run_plan'
import { clearRegistry } from '../src/engine/run_manager'

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory()
  await seedDefaults()
  clearDraftRegistry()
  clearRegistry()
})

describe('client run loop seam', () => {
  it('setup → run → tick loop → completion (S9.3 milestone: bundled nri now runs offline end to end)', async () => {
    // MILESTONE PROOF: nri_fatigue_score_v1's BUNDLED manifest declares
    // algorithm.type="python_module". Before S9.3, src/engine/algorithms/
    // adapter.ts had no dispatch path for python_module packages, so the
    // very first tickRun() call here hit "unsupported_algorithm_type" and
    // the run paused immediately with an algorithm_error (this test used to
    // assert exactly that failure, as an "honesty assertion" documenting the
    // gap — see git history). S9.3 ports algorithm.py to
    // src/data/packages/builtin/nri_fatigue_score_v1.ts (a trusted,
    // synchronous TS port) and wires adapter.ts's builtin_js_module dispatch
    // seam to it via the data/packages BUILTIN_EVALUATORS registry. This
    // test now drives the SAME bundled package + bundled scenario through
    // the full client API surface (createRunPlan -> createRun -> tickRun
    // loop -> actRun on pause) entirely offline (fake-indexeddb, no server)
    // and asserts the run COMPLETES with real decisions — never another
    // algorithm_error — proving the offline distributable can actually run
    // its one algorithmic package end to end.
    const plan = await createRunPlan({ packageId: 'nri_fatigue_score_v1', scenarioId: 'uc01_fatigue_recovery_v0_1' })
    const run = await createRun((plan as any).plan_id)
    expect(run.run_id).toBeTruthy()
    expect(run.status).toBe('created')

    const resultTypesSeen = new Set<string>()
    let acceptedOnce = false
    let resp = await tickRun(run.run_id)
    let guard = 1

    for (;;) {
      expect('error' in resp, `unexpected algorithm_error at tick ${guard}: ${JSON.stringify((resp as any).error)}`).toBe(false)
      if (!('error' in resp)) {
        if (resp.decision) resultTypesSeen.add(resp.decision.result_type)
        if (resp.completed) break
        if (resp.paused) {
          if (!acceptedOnce) {
            expect(resp.decision?.result_type).toBe('REST_PROPOSAL')
            await actRun(run.run_id, 'accept_rest', {
              recovery_option_id: 'nap_karaoke',
              rest_spot: { id: 'p1', label: { ja: 'SA', en: 'SA' }, route_fraction: 0.5 },
            })
            acceptedOnce = true
          } else {
            await actRun(run.run_id, 'decline')
          }
        }
      }
      guard += 1
      if (guard > 400) throw new Error('run did not complete within 400 ticks — nri_fatigue_score_v1 likely regressed')
      resp = await tickRun(run.run_id)
    }

    expect(acceptedOnce, 'the run must exercise at least one accept_rest action (REST_PROPOSAL fired)').toBe(true)
    // Real decisions, not a faked/empty trace: multiple distinct result
    // types observed (NO_PROPOSAL, SUPPRESSED, REST_PROPOSAL), across a
    // genuine multi-tick run.
    expect(resultTypesSeen.has('REST_PROPOSAL')).toBe(true)
    expect(resultTypesSeen.size).toBeGreaterThan(1)

    const log = await getRunLog(run.run_id)
    expect((log as any).events.length).toBeGreaterThan(0)
    expect((log as any).events.some((e: any) => e.kind === 'algorithm_error')).toBe(false)
    expect((log as any).events.some((e: any) => e.kind === 'tick' && e.trace?.decision_result?.result_type)).toBe(true)

    expect((await listRuns()).runs.length).toBe(1)
    const summary = (await listRuns()).runs[0]
    expect(summary.run_id).toBe(run.run_id)
    expect(summary.status).toBe('completed')
  })
})
