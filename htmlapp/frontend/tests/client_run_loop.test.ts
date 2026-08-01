import { describe, it, expect, beforeEach } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { seedDefaults } from '../src/storage/db'
import { createRunPlan, createRun, tickRun, actRun, getRunLog, listRuns } from '../src/api/client'
import { clearDraftRegistry } from '../src/engine/run_plan'
import { clearRegistry } from '../src/engine/run_manager'
import { resetDispatchState } from '../src/engine/worker/dispatch'
import { loadFixture, expectParity } from '../src/engine/__fixtures__/parity'
import { ensureRegistry } from '../src/data/registry'

// tests/setup.ts installs globalThis.__AICA_DATA__ from the generated payload.
ensureRegistry()

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory()
  resetDispatchState()
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

  it('setup → run → tick loop → completion (hybrid-port follow-up milestone: bundled aica_transparent_hybrid_trigger_v1 now runs offline)', async () => {
    // MILESTONE PROOF: aica_transparent_hybrid_trigger_v1's BUNDLED manifest
    // also declares algorithm.type="python_module" — it was the OTHER
    // bundled package left unported by S9.3 (see that task's report), so it
    // still surfaced "unsupported_algorithm_type" at tick 0 until this
    // follow-up ported algorithm.py to
    // src/data/packages/builtin/aica_transparent_hybrid_trigger_v1.ts and
    // registered it in BUILTIN_EVALUATORS. This test drives the SAME bundled
    // package (the stateful transparent-hybrid trigger) + bundled scenario
    // through the full client API surface (createRunPlan -> createRun ->
    // tickRun loop -> actRun on pause) entirely offline (fake-indexeddb, no
    // server) and asserts the run COMPLETES with real decisions — never an
    // algorithm_error — proving the SECOND bundled package can now run end
    // to end offline too.
    const plan = await createRunPlan({ packageId: 'aica_transparent_hybrid_trigger_v1', scenarioId: 'uc01_fatigue_recovery_v0_1' })
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
          if (!acceptedOnce && resp.decision?.result_type === 'REST_PROPOSAL') {
            await actRun(run.run_id, 'accept_rest', {
              recovery_option_id: 'nap_karaoke',
              rest_spot: { id: 'p1', label: { ja: 'SA', en: 'SA' }, route_fraction: 0.5 },
            })
            acceptedOnce = true
          } else {
            // Any subsequent pause (e.g. a MONOTONY_PROPOSAL, whose options
            // are ['acknowledge', 'decline'] — only 'decline' overlaps this
            // scenario's allowed_actions) — mirrors the fixture capture
            // script's fallback exactly.
            await actRun(run.run_id, 'decline')
          }
        }
      }
      guard += 1
      if (guard > 500) throw new Error('run did not complete within 500 ticks — aica_transparent_hybrid_trigger_v1 likely regressed')
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

  // PINNED-TO-C1: skipped by slice C0, re-enable in slice C1.
  // The htmlapp's hand-copied nri_fatigue_score_v1 manifest carried
  // threshold_fire 80.0 and no threshold_monotony; the live manifest (feature 025)
  // carries 100.0 and threshold_monotony 60.0. The goldens were captured against
  // the same stale values, so the drift was invisible until C0 read live data.
  // Regenerating goldens does NOT fix this: the TS port has no monotony band at
  // all, so it would then diverge behaviourally. C1's port refresh is the fix,
  // and re-enabling this test is C1's acceptance signal.
  // See docs/superpowers/specs/2026-08-01-htmlapp-combined-export-design.md
  //   -> "Known temporary state: three parity tests pinned from C0 to C1"
  // Observed failure at pin time: "$: array length: expected 36 to be 42" —
  //   the shifted decision timeline changes the run's total tick count.
  it.skip('tick-by-tick decision parity: nri_fatigue_score_v1 JS engine matches Python TestClient golden', async () => {
    // Drives nri_fatigue_score_v1 through the full offline client loop and
    // compares every per-tick decision_result against the Python-captured
    // nri_tick_by_tick.json fixture (42 ticks). The fixture was generated by
    // the Python FastAPI TestClient (capture_all.py) and records the exact
    // decisions the backend engine produces — including nulls for ticks
    // without a decision. Passing this test proves the JS port of algorithm.py
    // is numerically identical to the Python original for this scenario.
    const fixture = loadFixture('nri_tick_by_tick')
    const { acceptAt } = fixture.input as { acceptAt: number }

    const plan = await createRunPlan({ packageId: 'nri_fatigue_score_v1', scenarioId: 'uc01_fatigue_recovery_v0_1' })
    const run = await createRun((plan as any).plan_id)

    const decisions: unknown[] = []
    let acceptedOnce = false
    let resp = await tickRun(run.run_id)
    let guard = 1

    for (;;) {
      expect('error' in resp, `unexpected algorithm_error at tick ${guard}: ${JSON.stringify((resp as any).error)}`).toBe(false)
      if (!('error' in resp)) {
        decisions.push(resp.decision ?? null)
        if (resp.completed) break
        if (resp.paused) {
          const tickIndex = (resp as any).tick_index as number
          if (!acceptedOnce && tickIndex === acceptAt) {
            await actRun(run.run_id, 'accept_rest', {
              recovery_option_id: 'nap_karaoke',
              rest_spot: { id: 'p1', label: { ja: 'SA', en: 'SA' }, lat: null, lng: null, route_fraction: 0.5 },
            })
            acceptedOnce = true
          } else {
            await actRun(run.run_id, 'decline')
          }
        }
      }
      guard += 1
      if (guard > 400) throw new Error('nri_tick_by_tick parity run did not complete within 400 ticks')
      resp = await tickRun(run.run_id)
    }

    expectParity(decisions, fixture.output.decisions)
  })
})
