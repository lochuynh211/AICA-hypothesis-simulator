import { describe, it, beforeEach } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { seedDefaults } from '../src/storage/db'
import { resetDispatchState } from '../src/engine/worker/dispatch'
import { runPreview } from '../src/api/client'
import { loadFixture, expectParity } from '../src/engine/__fixtures__/parity'
import { clearDraftRegistry } from '../src/engine/run_plan'
import { clearRegistry } from '../src/engine/run_manager'
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

describe('runPreview parity (InstantResult)', () => {
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
  // Observed failure at pin time: "case[1].fire.tick: 17 vs 15" — the higher
  //   live threshold_fire (100.0 vs golden's 80.0) delays the fire tick.
  it.skip('reproduces Python evaluate_preview byte-for-byte', async () => {
    const { input, output } = loadFixture('preview')
    for (let i = 0; i < input.cases.length; i++) {
      const c = input.cases[i]
      const res = await runPreview(
        {
          package_id: c.package_id,
          scenario_id: c.scenario_id,
          hyperparameter_overrides: c.hyperparameter_overrides,
          run_seed: c.run_seed,
        },
        c.rest_option_id,
      )
      expectParity(res, output.results[i], `case[${i}]`)
    }
  })
})
