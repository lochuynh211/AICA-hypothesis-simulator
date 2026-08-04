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
// dedup gate (deriveResponseSuppression) suppresses the repeat and the
// quickview shows exactly ONE monotony_prevention fire. If htmlapp records
// `decline` instead, the gate under-suppresses (a decline only cools down for
// 30 min) and the SAME monotony proposal re-fires — a duplicate quickview fire
// the live animation never shows, because animation records the reviewer's
// real acknowledge. That was the "animation ok, quickview weird" divergence.
import { describe, it, beforeEach, expect } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { seedDefaults } from '../src/storage/db'
import { resetDispatchState } from '../src/engine/worker/dispatch'
import { runPreview } from '../src/api/client'
import { clearDraftRegistry } from '../src/engine/run_plan'
import { clearRegistry } from '../src/engine/run_manager'
import { ensureRegistry } from '../src/data/registry'

ensureRegistry()

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory()
  resetDispatchState()
  await seedDefaults()
  clearDraftRegistry()
  clearRegistry()
})

describe('preview quickview monotony dedup (fixbug-0804 mirror gap)', () => {
  it('nri on uc02 fires monotony_prevention exactly once', async () => {
    const res = await runPreview({
      package_id: 'nri_fatigue_score_v1',
      scenario_id: 'uc02_monotony_v0_1',
      hyperparameter_overrides: {},
      run_seed: 1042,
    })
    const cats = res.fires.map((f) => f.category)
    const monoCount = cats.filter((c) => c === 'monotony_prevention').length
    // Non-vacuous guard (matches the Python test's own setup assertion): the
    // scenario must actually produce a monotony fire for the dedup to be tested.
    expect(monoCount).toBeGreaterThanOrEqual(1)
    // The real assertion: exactly one, like the live run / Python quickview.
    expect(monoCount, `fires=${JSON.stringify(res.fires.map((f) => [f.tick, f.category]))}`).toBe(1)
  })
})
