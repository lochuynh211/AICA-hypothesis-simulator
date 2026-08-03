import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { dispatch } from '../src/engine/worker/dispatch'
import { resetRegistryForTests, getPresets, DataRegistryError } from '../src/data/registry'

const REAL = JSON.parse(readFileSync(resolve(__dirname, '..', 'data', 'aica-data.json'), 'utf8'))

beforeEach(() => resetRegistryForTests())

describe('data.install op', () => {
  it('installs the payload into the dispatching scope', async () => {
    expect(() => getPresets()).toThrow(DataRegistryError)
    const res = await dispatch({ op: 'data.install', params: { payload: REAL } })
    expect(res.ok).toBe(true)
    expect(getPresets().length).toBeGreaterThan(0)
  })

  it('returns a structured error for an invalid payload rather than throwing', async () => {
    const res = await dispatch({ op: 'data.install', params: { payload: { schema_version: 99 } } })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error.type).toBe('DataRegistryError')
  })

  it('is idempotent', async () => {
    await dispatch({ op: 'data.install', params: { payload: REAL } })
    const again = await dispatch({ op: 'data.install', params: { payload: REAL } })
    expect(again.ok).toBe(true)
  })
})

describe('WorkerTransport handshake', () => {
  it('sends data.install before any queued call', async () => {
    const posted: any[] = []
    class FakeWorker {
      onmessage: ((ev: MessageEvent) => void) | null = null
      onerror: ((ev: ErrorEvent) => void) | null = null
      postMessage(msg: any) {
        posted.push(msg)
        // Echo an ok response so pending promises settle.
        queueMicrotask(() =>
          this.onmessage?.({ data: { id: msg.id, response: { ok: true, result: {} } } } as MessageEvent),
        )
      }
      terminate() {}
    }
    const { WorkerTransport } = await import('../src/api/transport')
    const w = new FakeWorker()
    const t = new WorkerTransport(w as unknown as Worker, REAL)
    await t.call({ op: 'health.get', params: {} })
    expect(posted[0].req.op).toBe('data.install')
    expect(posted[1].req.op).toBe('health.get')
  })
})
