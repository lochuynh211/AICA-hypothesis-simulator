import { describe, it, expect, beforeEach } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { seedDefaults } from '../src/storage/db'
import { createRunPlan, createRun, tickRun, getRunLog, listRuns } from '../src/api/client'
import { clearDraftRegistry } from '../src/engine/run_plan'
import { clearRegistry } from '../src/engine/run_manager'

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory()
  await seedDefaults()
  clearDraftRegistry()
  clearRegistry()
})

describe('client run loop seam', () => {
  it('setup → run → tick → log', async () => {
    // REALITY CHECK: nri_fatigue_score_v1 is algorithm.type="python_module",
    // which src/engine/algorithms/adapter.ts does not support (only
    // declarative_rule/weighted_score are ported — see run_manager.test.ts's
    // docstring for the same caveat). So tickRun here is EXPECTED to hit the
    // adapter's "unsupported_algorithm_type" failure, which run_manager turns
    // into an `algorithm_error` event + a paused run (never a faked decision —
    // master invariant FR-011). This test intentionally exercises exactly that
    // path (S9 is what adds python_module support to the TS adapter) — the
    // extra assertions below document that this is the path being exercised,
    // not a silent gap.
    const plan = await createRunPlan({ packageId: 'nri_fatigue_score_v1', scenarioId: 'uc01_fatigue_recovery_v0_1' })
    const run = await createRun((plan as any).plan_id)
    expect(run.run_id).toBeTruthy()
    expect(run.status).toBe('created')

    const resp = await tickRun(run.run_id)
    expect(resp).toBeTruthy()
    // Honesty assertion: prove the algorithm_error path is what's exercised.
    expect('error' in resp).toBe(true)
    if ('error' in resp) {
      expect(resp.error.error_type).toBeTruthy()
      expect(resp.paused).toBe(true)
    }

    const log = await getRunLog(run.run_id)
    expect((log as any).events.length).toBeGreaterThan(0)
    expect((log as any).events.some((e: any) => e.kind === 'algorithm_error')).toBe(true)

    expect((await listRuns()).runs.length).toBe(1)
    const summary = (await listRuns()).runs[0]
    expect(summary.run_id).toBe(run.run_id)
    expect(summary.status).toBe('paused')
  })
})
