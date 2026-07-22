import type { RpcRequest, RpcResponse } from './rpc'
import { dispatch } from '../engine/worker/dispatch'

export interface Transport {
  call(req: RpcRequest): Promise<RpcResponse>
}

/** Runs the router on the calling thread. The file:// fallback and the Node/test transport. */
export class InProcessTransport implements Transport {
  call(req: RpcRequest): Promise<RpcResponse> {
    return dispatch(req)
  }
}

/** Posts requests to the backend worker and correlates responses by id. */
export class WorkerTransport implements Transport {
  private worker: Worker
  private seq = 0
  private pending = new Map<number, (r: RpcResponse) => void>()
  private dead = false

  constructor(worker: Worker) {
    this.worker = worker
    this.worker.onmessage = (ev: MessageEvent) => {
      const { id, response } = ev.data as { id: number; response: RpcResponse }
      const resolve = this.pending.get(id)
      if (resolve) { this.pending.delete(id); resolve(response) }
    }
    this.worker.onerror = (ev: ErrorEvent) => {
      // A worker-level crash rejects all in-flight calls as a structured error.
      this.dead = true
      const msg = 'backend worker crashed' + (ev?.message ? ': ' + ev.message : '')
      for (const [, resolve] of this.pending) {
        resolve({ ok: false, error: { type: 'WorkerError', message: msg } })
      }
      this.pending.clear()
    }
  }

  call(req: RpcRequest): Promise<RpcResponse> {
    if (this.dead) {
      return Promise.resolve({ ok: false, error: { type: 'WorkerError', message: 'backend worker is dead' } })
    }
    const id = ++this.seq
    return new Promise<RpcResponse>((resolve) => {
      this.pending.set(id, resolve)
      this.worker.postMessage({ id, req })
    })
  }
}

/**
 * Try the worker; fall back to in-process (file://, CSP, or unsupported).
 *
 * Guard: also fall back when Vitest sets import.meta.env.MODE === 'test'.
 * jsdom provides a Worker constructor but modules never actually run inside it,
 * so WorkerTransport would hang waiting for a postMessage that never arrives.
 * Checking MODE==='test' catches this before any Worker is constructed.
 */
export function createTransport(): Transport {
  try {
    // In Vitest jsdom, Worker exists but module workers never execute — fall back immediately.
    if (typeof Worker === 'undefined') throw new Error('no Worker')
    if (import.meta.env?.MODE === 'test') throw new Error('test environment — using in-process')
    const worker = new Worker(new URL('../engine/worker/backend.worker.ts', import.meta.url), { type: 'module' })
    return new WorkerTransport(worker)
  } catch (e) {
    console.info('[htmlapp] backend worker unavailable; running engine in-process.', e)
    return new InProcessTransport()
  }
}

export const transport: Transport = createTransport()
