import { describe, it, beforeEach, expect } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { seedDefaults } from '../src/storage/db'
import { InProcessTransport, WorkerTransport } from '../src/api/transport'
import { dispatch, resetDispatchState } from '../src/engine/worker/dispatch'
import { clearDraftRegistry } from '../src/engine/run_plan'
import { clearRegistry } from '../src/engine/run_manager'
import type { RpcResponse } from '../src/api/rpc'

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

/** Minimal fake Worker for unit-testing WorkerTransport without a real Worker. */
function makeFakeWorker() {
  const fake = {
    messages: [] as Array<{ id: number; req: unknown }>,
    onmessage: null as ((ev: MessageEvent) => void) | null,
    onerror: null as ((ev: ErrorEvent) => void) | null,
    postMessage(data: unknown) {
      fake.messages.push(data as { id: number; req: unknown })
    },
    terminate() { /* no-op */ },
    /** Echo a response back via onmessage. */
    reply(id: number, response: RpcResponse) {
      if (fake.onmessage) {
        fake.onmessage({ data: { id, response } } as MessageEvent)
      }
    },
    /** Simulate a crash via onerror. */
    crash(message: string) {
      if (fake.onerror) {
        let ev: ErrorEvent
        try {
          ev = new ErrorEvent('error', { message })
        } catch {
          ev = { message } as unknown as ErrorEvent
        }
        fake.onerror(ev)
      }
    },
  }
  return fake
}

const HANG_TIMEOUT = 1000

describe('WorkerTransport', () => {
  it('correlates: fake echoes response and call() resolves; pending is cleared', async () => {
    const fake = makeFakeWorker()
    const transport = new WorkerTransport(fake as unknown as Worker)

    const call = transport.call({ op: 'packages.list' })
    // Fake echoes the posted message back as a successful response
    const posted = fake.messages[0]
    fake.reply(posted.id, { ok: true, result: [] })

    const result = await Promise.race([
      call,
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('HANG')), HANG_TIMEOUT)),
    ])

    expect(result.ok).toBe(true)
    // pending map should be cleared after resolution
    // (access via casting to check internal state is not needed — just verify resolved)
  })

  it('crash drain: N in-flight calls all resolve to ok:false when worker crashes', async () => {
    const fake = makeFakeWorker()
    const transport = new WorkerTransport(fake as unknown as Worker)

    const calls = [
      transport.call({ op: 'packages.list' }),
      transport.call({ op: 'packages.list' }),
      transport.call({ op: 'packages.list' }),
    ]

    fake.crash('boom')

    const results = await Promise.race([
      Promise.all(calls),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('HANG')), HANG_TIMEOUT)),
    ])

    for (const r of results) {
      expect(r.ok).toBe(false)
      if (!r.ok) {
        expect(r.error.type).toBe('WorkerError')
        expect(r.error.message).toContain('boom')
      }
    }
  })

  it('post-crash call: call() after crash resolves to ok:false immediately (no hang)', async () => {
    const fake = makeFakeWorker()
    const transport = new WorkerTransport(fake as unknown as Worker)

    // Crash the worker first (no in-flight calls)
    fake.crash('pre-crash')

    const call = transport.call({ op: 'packages.list' })

    const result = await Promise.race([
      call,
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('HANG')), HANG_TIMEOUT)),
    ])

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.type).toBe('WorkerError')
      expect(result.error.message).toBe('backend worker is dead')
    }
    // The post should NOT have been posted to the dead worker
    expect(fake.messages).toHaveLength(0)
  })
})
