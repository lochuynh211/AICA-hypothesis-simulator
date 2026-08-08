// Regression guard for the fixbug-0804 quickview mirror gap.
//
// Mirrors app/api/tests/test_preview_endpoint.py
// ::test_preview_dedups_repeated_monotony_fires_for_nri — a FIXTURE-INDEPENDENT
// assertion of the CURRENT expected behavior, so it stays valid even when the
// golden parity fixtures drift stale relative to the Python source.
//
// Root cause it pins (verified against current Python ground truth):
// the quickview auto-drive in preview_ticks.ts must record `acknowledge` for a
// monotony proposal — NOT `decline`. Python's preview does the same, so its
// dedup gate (deriveResponseSuppression) suppresses an IMMEDIATE duplicate on
// the very next tick. If htmlapp recorded `decline` instead, the gate would
// under-suppress even the immediate case (a decline only cools down for the
// same window anyway, but "acknowledge" is the semantically correct action a
// driver who took up the content actually performed — the live merged run
// records the same acknowledge, and the projection must model the same
// driver).
//
// Recovery-semantics refactor (task 7, 2026-08-08): acknowledge used to
// suppress monotony_prevention INDEFINITELY, released only once some
// REST_PROPOSAL fired. That indefinite latch is gone (CDC-SU slide 34 permits
// only an interval and a per-unit-time count, not an indefinite latch tied to
// an unrelated category) — acknowledge now uses the same bounded
// `SAME_CATEGORY_RELEASE_SEC` cooldown as decline. On this scenario the
// projection now legitimately re-fires monotony_prevention a SECOND time once
// the cooldown elapses — that is the intended behavior, not the duplicate
// this test originally guarded against. So (mirroring the Python rewrite)
// this asserts the gap between successive monotony fires is never SHORTER
// than the cooldown window, instead of forbidding a second fire outright.
import { describe, it, beforeEach, expect } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { seedDefaults } from '../src/storage/db'
import { resetDispatchState } from '../src/engine/worker/dispatch'
import { runPreview } from '../src/api/client'
import { clearDraftRegistry } from '../src/engine/run_plan'
import { clearRegistry } from '../src/engine/run_manager'
import { ensureRegistry } from '../src/data/registry'
import { DECLINE_COOLDOWN_SEC } from '../src/engine/proposal_history'

ensureRegistry()

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory()
  resetDispatchState()
  await seedDefaults()
  clearDraftRegistry()
  clearRegistry()
})

describe('preview quickview monotony dedup (fixbug-0804 mirror gap)', () => {
  it('nri on uc02: successive monotony_prevention fires are never closer than the cooldown window', async () => {
    const res = await runPreview({
      package_id: 'nri_fatigue_score_v1',
      scenario_id: 'uc02_monotony_v0_1',
      hyperparameter_overrides: {},
      run_seed: 1042,
    })
    const monotonyFires = res.fires.filter((f) => f.category === 'monotony_prevention')
    // Non-vacuous guard (matches the Python test's own setup assertion): the
    // scenario must actually produce a monotony fire for the dedup to be tested.
    expect(monotonyFires.length).toBeGreaterThanOrEqual(1)
    for (let i = 1; i < monotonyFires.length; i++) {
      const gapSec = (monotonyFires[i].time_min - monotonyFires[i - 1].time_min) * 60.0
      expect(
        gapSec,
        `successive monotony_prevention fires in the quickview projection must be separated by at least the `
          + `acknowledge cooldown window (${DECLINE_COOLDOWN_SEC}s) — got fires ${JSON.stringify(res.fires.map((f) => [f.tick, f.category]))}`,
      ).toBeGreaterThanOrEqual(DECLINE_COOLDOWN_SEC)
    }
  })
})
