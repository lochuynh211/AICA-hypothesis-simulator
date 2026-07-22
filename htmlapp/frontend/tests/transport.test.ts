import { describe, it, beforeEach, expect } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { seedDefaults } from '../src/storage/db'
import { InProcessTransport } from '../src/api/transport'
import { dispatch, resetDispatchState } from '../src/engine/worker/dispatch'
import { clearDraftRegistry } from '../src/engine/run_plan'
import { clearRegistry } from '../src/engine/run_manager'

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory()
  resetDispatchState(); await seedDefaults(); clearDraftRegistry(); clearRegistry()
})

describe('InProcessTransport', () => {
  it('produces the same response as calling dispatch directly', async () => {
    const viaTransport = await new InProcessTransport().call({ op: 'packages.list' })
    resetDispatchState(); globalThis.indexedDB = new IDBFactory(); await seedDefaults()
    const viaDispatch = await dispatch({ op: 'packages.list' })
    expect(viaTransport).toEqual(viaDispatch)
    expect(viaTransport.ok).toBe(true)
  })

  it('surfaces a structured error response for an unknown run', async () => {
    const r = await new InProcessTransport().call({ op: 'runs.state', params: { runId: 'nope' } })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(typeof r.error.type).toBe('string')
  })
})
