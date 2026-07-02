import { describe, it, expect, beforeEach } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { loadFixture, expectParity } from '../src/engine/__fixtures__/parity'
import { createDraft, clearDraftRegistry } from '../src/engine/run_plan'
import { createRun, tick, action, getActiveRunLog, getRun, clearRegistry } from '../src/engine/run_manager'
import { runsStore } from '../src/storage/runs_store'

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
  clearDraftRegistry()
  clearRegistry()
})

// This fixture was captured by driving the REAL Python services end to end
// (run_plan.create_draft -> run_manager.create_run/tick/action) — see
// .superpowers/sdd/task-S4.2-report.md for the exact capture script. It uses
// the htmlapp-bundled scenario `uc01_fatigue_recovery_v0_1` (M2, profile-
// driven, has recovery_options) paired with a reconstructed declarative_rule
// package `rest_rule_based_v0_1` (byte-for-byte from git history at
// a612b56~1 — this package used to exist in packages/ and is exactly what
// uc01_fatigue_recovery_v0_1.json's own comments describe firing
// REST_PROPOSAL against). NEITHER of the two packages actually bundled into
// the htmlapp today (nri_fatigue_score_v1, aica_transparent_hybrid_trigger_v1)
// is usable here: both are algorithm.type="python_module", which
// src/engine/algorithms/adapter.ts does not support (only declarative_rule/
// weighted_score are ported) — every tick would immediately raise
// AlgorithmAdapterError("unsupported_algorithm_type"), never reach a
// REST_PROPOSAL, and never exercise the accept_rest action this test needs.
describe('run manager e2e (S4.2 keystone)', () => {
  it('drives a run to completion matching the docker run log — tick/algorithm-error-as-event/action/append-only', async () => {
    const fx = loadFixture('run_log_e2e')
    const { package: pkg, scenario, presets, parameters, hyperparameters, runMode, recoveryOptionId, restSpot } = fx.input

    const planId = 'plan-e2e-test'
    const { draft } = createDraft({ planId, package: pkg, scenario, presets, parameters, hyperparameters, runMode })
    expect(draft.validation_errors).toEqual([])

    const runId = 'run-e2e-test'
    await createRun(planId, runId)

    let acceptedOnce = false
    let outcome
    let guard = 0
    do {
      guard += 1
      if (guard > 1000) throw new Error('run did not complete within 1000 ticks — REST_PROPOSAL likely never fired')
      outcome = await tick(runId)
      if (outcome.completed) break
      // A run is never re-ticked while paused-with-a-pending-proposal without
      // first resolving it (mirrors how the real UI/router use this API).
      if (outcome.paused) {
        expect(outcome.algorithmError, 'must never fake a decision on algorithm error').toBeNull()
        if (!acceptedOnce) {
          expect(outcome.decision?.result_type).toBe('REST_PROPOSAL')
          await action(runId, 'accept_rest', { recoveryOptionId, restSpot })
          acceptedOnce = true

          // ── Regression (S4.2 review, Important defect) ─────────────────
          // recordEvent() inside action() persists the `runs` header row by
          // reading entry.runState.status AT THAT MOMENT. If the header
          // persist happens before runState.status is updated to its final
          // post-action value, the persisted header is left stuck at the
          // stale pre-action 'paused' status — permanently, in the
          // back-compat (no recovery_options) accept_rest -> 'completed'
          // path, since nothing ever re-persists after a run completes.
          // Assert the persisted header already reflects the FINAL
          // post-action status immediately after action() returns — i.e.
          // BEFORE the next tick() gets a chance to mask the bug by
          // unconditionally overwriting the header again.
          const liveRunState = getRun(runId)
          const persistedHeaderAfterAction = await runsStore.getHeader(runId)
          expect(persistedHeaderAfterAction?.status).toBe(liveRunState?.status)
          expect(persistedHeaderAfterAction?.status).not.toBe('paused')
        } else {
          await action(runId, 'decline')
        }
      }
    } while (!outcome.completed)

    expect(acceptedOnce, 'the fixture flow must exercise exactly one accept_rest action').toBe(true)

    const log = await getActiveRunLog(runId)
    expect(log).not.toBeNull()

    // ── CARRY 2: the real event discriminator is `kind` (tick|action|
    // algorithm_error|feedback), never `type` — asserted first as a quick,
    // human-readable diagnostic on failure.
    const actualKinds = (log!.events as any[]).map((e) => e.kind)
    const expectedKinds = (fx.output.events as any[]).map((e) => e.kind)
    expectParity(actualKinds, expectedKinds)

    // ── Full deep parity on every event. tick/action/algorithm_error event
    // payloads (tick_state, trace.decision_result, raw_state, feature_groups,
    // driver_update, vehicle_update, package_runtime_state, action fields)
    // carry no timestamps or content hashes — they are fully deterministic —
    // so this is a genuine, non-vacuous, byte-for-byte contract, not just a
    // shape check. This exercises the append-only, algorithm-error-as-event,
    // and pause/resume-on-action invariants end to end in one assertion.
    expectParity(log!.events, fx.output.events)

    // ── Belt-and-braces: the per-tick result_type sequence + tick_index
    // ordering, and any algorithm_error error_type, explicitly (subsumed by
    // the deep-parity check above, but kept as a targeted diagnostic).
    const actualTickTrace = (log!.events as any[])
      .filter((e) => e.kind === 'tick')
      .map((e) => ({ tick_index: e.tick_index, result_type: e.trace.decision_result.result_type }))
    const expectedTickTrace = (fx.output.events as any[])
      .filter((e) => e.kind === 'tick')
      .map((e) => ({ tick_index: e.tick_index, result_type: e.trace.decision_result.result_type }))
    expectParity(actualTickTrace, expectedTickTrace)

    const actualErrorTypes = (log!.events as any[]).filter((e) => e.kind === 'algorithm_error').map((e) => e.error_type)
    const expectedErrorTypes = (fx.output.events as any[]).filter((e) => e.kind === 'algorithm_error').map((e) => e.error_type)
    expectParity(actualErrorTypes, expectedErrorTypes)
    expect(expectedErrorTypes).toEqual([]) // this fixture's flow never errors — proves the positive path end to end

    // ── RunLog header assembly: the M2 audit-trail fields S4.1's recorder
    // intentionally omits are surfaced here (this task owns assembly).
    expect(log!.run_id).toBe(runId)
    expect(log!.original_values).toEqual({})
    expect(log!.modified_values).toEqual({})
    expect(log!.initial_hyperparameters).toEqual(fx.output.initial_hyperparameters)
    expect(log!.current_hyperparameters).toEqual(fx.output.current_hyperparameters)
    expect(log!.route_source).toBe('local')
    expect(log!.display_route).toBeNull()
    expect(log!.driver_profile).not.toBeNull()
  })
})
