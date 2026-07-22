import { describe, it, expect, beforeEach } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { seedDefaults } from '../src/storage/db'
import { resetDispatchState } from '../src/engine/worker/dispatch'
import { loadFixture, expectParity } from '../src/engine/__fixtures__/parity'
import { createRunPlan, createRun, getRunLog } from '../src/api/client'
import * as client from '../src/api/client'
import { createDraft, clearDraftRegistry } from '../src/engine/run_plan'
import { createRun as engineCreateRun, tick, action, getActiveRunLog, clearRegistry } from '../src/engine/run_manager'
import * as runManager from '../src/engine/run_manager'

// ─────────────────────────────────────────────────────────────────────────
// V1 PLACEHOLDER NOTICE (read before extending this file)
//
// `run_mode: "expert_override"` is a V1 PLACEHOLDER on BOTH sides of the
// parity boundary. Confirmed by grep across `app/api/aica_api/` (controller
// grep, task S8.2 brief): the ONLY occurrences of the string
// "expert_override" in the Python backend are documentation placeholders —
//   - services/run_plan.py:422 — a docstring: `run_mode: "standard" (or
//     "expert_override" in future)`.
//   - services/evidence.py:9,24,135 — "expert_override_events: V1 — not
//     used; omit section entirely" (an unrelated, never-populated evidence
//     section that merely shares the name).
// There is NO `run_mode` value validation anywhere in Python (`run_mode` is
// a free `str = "standard"` field — models/run.py:308, models/log.py:111,
// routers/run_plans.py:71), NO post-start setup-mutation API on either
// side, and NO allowed-mutable-field set anywhere in the codebase. A repo
// grep for `run_mode ==` / `run_mode is` across `app/` turns up nothing
// except a test assertion (`app/api/tests/test_models.py:905`) — i.e. no
// branch in the Python source ever inspects the VALUE of run_mode. So
// `expert_override` today has ZERO behavioral difference from `standard`:
// it is accepted as an opaque string, threaded into `effective_setup` and
// the persisted `RunState`/`RunLog`, and otherwise ignored.
//
// This test file therefore does NOT assert bounded-mutability / allowed-
// field semantics (there is nothing to mirror — inventing that behavior
// here would be un-mirrored scope creep the htmlapp port must not carry).
// Instead it documents and locks in the REAL, faithful contract:
//   1. `run_mode: 'expert_override'` is ACCEPTED by createRunPlan and
//      threaded verbatim into `effective_setup.run_mode`.
//   2. It round-trips through `createRun` into both the live `RunState`
//      and the persisted `RunLog` header, unmodified.
//   3. It has NO effect on tick outcomes — an identical run driven with
//      `run_mode: 'standard'` vs `'expert_override'` (same package,
//      scenario, parameters, hyperparameters, actions) produces a
//      byte-identical event log, because nothing in the engine branches on
//      the run_mode value (matching Python exactly).
//   4. There is no post-start setup-mutation entry point on the public API
//      surface (`src/api/client.ts`) or the engine surface
//      (`src/engine/run_manager.ts`) — setup-time immutability holds
//      trivially because no such mutator exists, exactly as in Python.
// ─────────────────────────────────────────────────────────────────────────

const PKG = 'nri_fatigue_score_v1'
const SCN = 'uc01_fatigue_recovery_v0_1'

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory()
  resetDispatchState()
  await seedDefaults()
  clearDraftRegistry()
  clearRegistry()
})

describe('expert_override run mode — accepted + threaded (V1 placeholder)', () => {
  it('is accepted by createRunPlan and threaded verbatim into effective_setup.run_mode', async () => {
    const plan = await createRunPlan({
      packageId: PKG,
      scenarioId: SCN,
      runMode: 'expert_override',
    })
    expect((plan as any).plan_id).toBeTruthy()
    expect(plan.validation_errors).toEqual([])
    // NOT coerced/dropped to 'standard' — flows through byte-for-byte.
    expect((plan.effective_setup as Record<string, unknown>)['run_mode']).toBe('expert_override')
  })

  it('defaults to "standard" when runMode is omitted (unchanged baseline behavior)', async () => {
    const plan = await createRunPlan({ packageId: PKG, scenarioId: SCN })
    expect((plan.effective_setup as Record<string, unknown>)['run_mode']).toBe('standard')
  })

  it('round-trips through createRun into the live RunState and the persisted RunLog header', async () => {
    const plan = await createRunPlan({
      packageId: PKG,
      scenarioId: SCN,
      runMode: 'expert_override',
    })
    const run = await createRun((plan as any).plan_id)
    expect((run as any).run_mode).toBe('expert_override')

    const log = await getRunLog(run.run_id)
    expect((log as any).run_mode).toBe('expert_override')
  })

  it('has no post-start setup-mutation entry point on the public API or engine surface', () => {
    // Mirrors Python: no mutator exists on either side, so setup-time
    // immutability holds trivially (there is nothing to bound). This is a
    // structural regression guard — if a future slice ever adds a
    // post-start setup mutator without also adding Python's allowed-field
    // set, this assertion will fail and force the question to be revisited.
    const mutationLike = /^(update|patch|mutate|override)(Setup|Run(?!Plan)|Parameter|Hyperparameter)/i
    const clientExports = Object.keys(client)
    const runManagerExports = Object.keys(runManager)
    expect(clientExports.filter((k) => mutationLike.test(k))).toEqual([])
    expect(runManagerExports.filter((k) => mutationLike.test(k))).toEqual([])
  })

  it('produces a byte-identical event log for standard vs expert_override given identical inputs', async () => {
    // Uses the same reconstructed declarative_rule package/scenario as
    // run_manager.test.ts's S4.2 keystone (rest_rule_based_v0_1 +
    // uc01_fatigue_recovery_v0_1) — the bundled python_module packages
    // (nri_fatigue_score_v1, aica_transparent_hybrid_trigger_v1) are
    // unsupported by the TS tick adapter and would only ever produce a
    // single algorithm_error tick, which is too degenerate to prove
    // "identical DECISION outcomes" below. This package/scenario pair
    // actually reaches REST_PROPOSAL and an accept_rest action, so the
    // comparison exercises real algorithm evaluation, not just plumbing.
    const fx = loadFixture('run_log_e2e')
    const { package: pkg, scenario, presets, parameters, hyperparameters, recoveryOptionId, restSpot } = fx.input

    async function driveToCompletion(runMode: string, planId: string, runId: string) {
      const { draft } = createDraft({ planId, package: pkg, scenario, presets, parameters, hyperparameters, runMode })
      expect(draft.validation_errors).toEqual([])
      await engineCreateRun(planId, runId)

      let acceptedOnce = false
      let outcome
      let guard = 0
      do {
        guard += 1
        if (guard > 1000) throw new Error('run did not complete within 1000 ticks')
        outcome = await tick(runId)
        if (outcome.completed) break
        if (outcome.paused) {
          if (!acceptedOnce) {
            await action(runId, 'accept_rest', { recoveryOptionId, restSpot })
            acceptedOnce = true
          } else {
            await action(runId, 'decline')
          }
        }
      } while (!outcome.completed)

      const log = await getActiveRunLog(runId)
      expect(log).not.toBeNull()
      return log!
    }

    const standardLog = await driveToCompletion('standard', 'plan-standard', 'run-standard')
    clearRegistry()
    const expertLog = await driveToCompletion('expert_override', 'plan-expert', 'run-expert')

    // The run_mode header field is EXPECTED to differ (that's the whole
    // point of threading it through) — everything else, most importantly
    // the full event sequence (every tick's decision trace, every action,
    // any algorithm_error), must be identical: no branch in the engine
    // inspects run_mode's value.
    expect(standardLog.run_mode).toBe('standard')
    expect(expertLog.run_mode).toBe('expert_override')
    expectParity(expertLog.events, standardLog.events)
  })
})
