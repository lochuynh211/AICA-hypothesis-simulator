import { describe, it, beforeEach } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { seedDefaults } from '../src/storage/db'
import { resetDispatchState } from '../src/engine/worker/dispatch'
import { runPreview } from '../src/api/client'
import { loadFixture, expectParity } from '../src/engine/__fixtures__/parity'
import { clearDraftRegistry } from '../src/engine/run_plan'
import { clearRegistry } from '../src/engine/run_manager'

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory()
  resetDispatchState()
  await seedDefaults()
  clearDraftRegistry()
  clearRegistry()
})

describe('runPreview parity (InstantResult)', () => {
  it('reproduces Python evaluate_preview byte-for-byte', async () => {
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
