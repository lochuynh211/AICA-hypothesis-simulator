import { describe, it, expect, beforeEach } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { seedDefaults } from '../src/storage/db'
import { packagesStore } from '../src/storage/packages_store'
import { scenariosStore } from '../src/storage/scenarios_store'
import { runsStore } from '../src/storage/runs_store'
import { settingsStore } from '../src/storage/settings_store'

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

  it('settings round-trip', async () => {
    await settingsStore.set('lang', 'ja')
    expect(await settingsStore.get('lang')).toBe('ja')
  })
})
