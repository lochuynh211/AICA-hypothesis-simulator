import { describe, it, expect, beforeEach, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { seedDefaults } from '../src/storage/db'
import { resetDispatchState } from '../src/engine/worker/dispatch'
import { loadFixture } from '../src/engine/__fixtures__/parity'
import { createDraft, clearDraftRegistry } from '../src/engine/run_plan'
import { createRun, tick, action, clearRegistry } from '../src/engine/run_manager'
import { getRunLog } from '../src/api/client'
import { createReplaySource } from '../src/replay/replaySource'
import * as adapter from '../src/engine/algorithms/adapter'
import { ensureRegistry } from '../src/data/registry'

// tests/setup.ts installs globalThis.__AICA_DATA__ from the generated payload.
ensureRegistry()

// ── Why this package/flow (S6.1 brief trap) ───────────────────────────────
//
// The brief's literal Step-1 test drives package `nri_fatigue_score_v1`
// (algorithm.type=python_module — UNSUPPORTED by src/engine/algorithms/
// adapter.ts until S9) with `do { ... } while (!o.completed)`. Every tick on
// that package raises an algorithm_error and the run PAUSES forever (never
// `completed`), so that loop would spin infinitely.
//
// Instead we reuse the same reconstructed declarative_rule package
// (`rest_rule_based_v0_1` + scenario `uc01_fatigue_recovery_v0_1`) that
// tests/run_manager.test.ts and tests/maps_client.test.ts already drive to a
// genuine `completed` run via the accept_rest action — see run_manager.test.ts's
// header comment for provenance. This gives a real, non-trivial persisted log
// (tick + action events, a REST_PROPOSAL decision, an accepted recovery) to
// replay, with a bounded tick-count safety guard so a regression can never
// hang the suite.
beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory()
  resetDispatchState()
  await seedDefaults()
  clearDraftRegistry()
  clearRegistry()
  vi.restoreAllMocks()
})

describe('replay', () => {
  it('reads the persisted log without re-running the algorithm', async () => {
    const fx = loadFixture('run_log_e2e')
    const { package: pkg, scenario, presets, parameters, hyperparameters, runMode, recoveryOptionId, restSpot } = fx.input

    const planId = 'plan-replay-test'
    const { draft } = createDraft({ planId, package: pkg, scenario, presets, parameters, hyperparameters, runMode })
    expect(draft.validation_errors).toEqual([])

    const runId = 'run-replay-test'
    await createRun(planId, runId)

    // ── Drive the run to completion (mirrors run_manager.test.ts) ───────────
    let acceptedOnce = false
    let outcome
    let guard = 0
    do {
      guard += 1
      if (guard > 1000) throw new Error('run did not complete within 1000 ticks — REST_PROPOSAL likely never fired')
      outcome = await tick(runId)
      if (outcome.completed) break
      if (outcome.paused) {
        if (!acceptedOnce) {
          expect(outcome.decision?.result_type).toBe('REST_PROPOSAL')
          await action(runId, 'accept_rest', { recoveryOptionId, restSpot })
          acceptedOnce = true
        } else {
          await action(runId, 'decline')
        }
      }
    } while (!outcome.completed)

    expect(acceptedOnce, 'the fixture flow must exercise exactly one accept_rest action').toBe(true)

    // ── Assertion 1: the driven run produced a genuine, non-empty persisted
    // log reaching the expected event kinds — not a vacuous empty replay.
    const drivenLog = await getRunLog(runId)
    expect(drivenLog.events.length).toBeGreaterThan(0)
    const kinds = new Set(drivenLog.events.map((e) => (e as { kind: string }).kind))
    expect(kinds.has('tick')).toBe(true)
    expect(kinds.has('action')).toBe(true)
    expect(kinds.has('algorithm_error')).toBe(false) // this fixture's flow is a clean positive path

    // ── Assertion 2 (the core invariant): reading the persisted log AND
    // projecting it through the replay path (replaySource — the same pure
    // projector the replay viewer consumes) must NEVER call back into the
    // algorithm adapter. Replay renders from the append-only log; it never
    // recomputes a decision.
    const spy = vi.spyOn(adapter, 'evaluate')

    const log = await getRunLog(runId)
    const source = createReplaySource(log)
    expect(source.tickCount).toBeGreaterThan(0)

    const projected1: unknown[] = []
    for (let i = source.minIndex; i <= source.maxIndex; i += 1) {
      const t = source.getAt(i)
      if (t !== null) projected1.push(t)
    }
    expect(projected1.length).toBe(source.tickCount)

    expect(spy).not.toHaveBeenCalled() // replay = read-only, no recompute

    // ── Assertion 3 (nice-to-have): projecting the same log twice is
    // deterministic — replay never depends on hidden mutable state.
    const source2 = createReplaySource(log)
    const projected2: unknown[] = []
    for (let i = source2.minIndex; i <= source2.maxIndex; i += 1) {
      const t = source2.getAt(i)
      if (t !== null) projected2.push(t)
    }
    expect(projected2).toEqual(projected1)
    expect(spy).not.toHaveBeenCalled() // still true after the second projection pass
  })
})
