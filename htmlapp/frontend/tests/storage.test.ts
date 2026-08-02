import { describe, it, expect, beforeEach } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { seedDefaults } from '../src/storage/db'
import { packagesStore } from '../src/storage/packages_store'
import { scenariosStore } from '../src/storage/scenarios_store'
import { runsStore } from '../src/storage/runs_store'
import { settingsStore } from '../src/storage/settings_store'
import { ensureRegistry } from '../src/data/registry'

// tests/setup.ts installs globalThis.__AICA_DATA__ from the generated payload.
ensureRegistry()

beforeEach(() => { globalThis.indexedDB = new IDBFactory() })

describe('storage', () => {
  it('seeds builtin packages and scenarios on first launch', async () => {
    await seedDefaults()
    const pkgs = await packagesStore.list()
    const scns = await scenariosStore.list()
    expect(pkgs.length).toBeGreaterThan(0)
    expect(scns.some(s => s.id === 'uc01_fatigue_recovery_v0_1')).toBe(true)
  })

  it('append-only run_events preserve order by seq', async () => {
    await runsStore.putHeader({ id: 'r1', status: 'created' } as any)
    await runsStore.appendEvent('r1', 0, { seq: 0, type: 'run_created' } as any)
    await runsStore.appendEvent('r1', 1, { seq: 1, type: 'tick' } as any)
    const events = await runsStore.getEvents('r1')
    expect(events.map(e => (e as any).seq)).toEqual([0, 1])
  })

  // Regression for the idb `add()` + `tx.done` double-rejection trap fixed in
  // runsStore.appendEvent (mirrors the equivalent proposalRunsStore.appendEvent
  // test in tests/proposal_run_manager.test.ts). A duplicate (runId, seq)
  // `add()` both rejects itself AND aborts the transaction, which
  // independently rejects `tx.done` a second time; without the try/catch +
  // `tx.done.catch(() => {})` in appendEvent, that second rejection is never
  // observed and vitest fails the whole run with an unhandled rejection.
  it('a duplicate-seq append rejects with the original error and produces no unhandled rejection', async () => {
    const unhandled: unknown[] = []
    const onUnhandledRejection = (reason: unknown) => { unhandled.push(reason) }
    process.on('unhandledRejection', onUnhandledRejection)

    try {
      await runsStore.putHeader({ id: 'r-dup', status: 'created' } as any)
      await runsStore.appendEvent('r-dup', 0, { seq: 0, type: 'run_created' } as any)

      await expect(
        runsStore.appendEvent('r-dup', 0, { seq: 0, type: 'tick' } as any),
      ).rejects.toThrow()

      // The original entry survives untouched (no silent overwrite).
      const events = await runsStore.getEvents('r-dup')
      expect(events).toHaveLength(1)
      expect((events[0] as any).type).toBe('run_created')

      // Flush the microtask/macrotask queue so any late second rejection from
      // `tx.done` (the bug this test guards against) has a chance to surface
      // as an unhandledRejection before we assert none did.
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(unhandled).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandledRejection)
    }
  })

  it('settings round-trip', async () => {
    await settingsStore.set('lang', 'ja')
    expect(await settingsStore.get('lang')).toBe('ja')
  })
})
