/**
 * addUserPackage — js_module upload UX with smoke-on-upload gating (S9.2).
 *
 * jsdom/vitest has no real Worker (see tests/js_module.test.ts's doc comment
 * for the full rationale). This file replicates that same test-only
 * FakeWorker polyfill so `addUserPackage`'s smoke-test step — which spins a
 * REAL `createJsModuleRunner(source)` from S9.1 — is genuinely exercised,
 * not vacuously mocked. Everything downstream of "the worker responded with
 * a message" is the real, unmodified `src/api/client.ts` production code.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { seedDefaults } from '../src/storage/db'
import { addUserPackage, listPackages } from '../src/api/client'
import { packagesStore } from '../src/storage/packages_store'

const GOOD = `export const manifest={id:'user_pkg',version:'1',algorithm:{type:'js_module'},label:{en:'U',ja:'U'},compatible_scenario_types:['uc01_fatigue'],features:[],parameters:[],hyperparameters:[],trigger_categories:[],rules:[],proposals:[],feedback_schema:[],evidence_metrics:[]};
export function evaluate(){return{fired:false,trigger_category:null,scores:{},states:{}}}`
const BAD = `export const manifest={id:'bad'}; export function evaluate(){throw new Error('boom')}`

// ---------------------------------------------------------------------------
// FakeWorker — test-only Worker transport polyfill (production code untouched).
// Copied/trimmed from tests/js_module.test.ts's FakeWorker (S9.1); speaks the
// exact same message protocol as the real src/engine/algorithms/js_module.worker.ts.
// ---------------------------------------------------------------------------

type FakeOutMessage = { type: string; [k: string]: unknown }

class FakeWorker {
  onmessage: ((ev: { data: FakeOutMessage }) => void) | null = null
  onerror: ((ev: { message: string }) => void) | null = null

  private listeners = new Map<string, Set<(ev: { data: FakeOutMessage }) => void>>()
  private evaluateFn: ((input: unknown) => unknown) | null = null
  private terminated = false

  constructor(_url: URL | string, _opts?: unknown) {}

  addEventListener(type: string, listener: (ev: { data: FakeOutMessage }) => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type)!.add(listener)
  }

  removeEventListener(type: string, listener: (ev: { data: FakeOutMessage }) => void): void {
    this.listeners.get(type)?.delete(listener)
  }

  private emit(data: FakeOutMessage): void {
    if (this.terminated) return
    this.onmessage?.({ data })
    for (const listener of this.listeners.get('message') ?? []) listener({ data })
  }

  postMessage(msg: FakeOutMessage): void {
    if (this.terminated) return
    if (msg.type === 'load') {
      void this.handleLoad(msg as { type: 'load'; source: string })
      return
    }
    if (msg.type === 'evaluate') {
      void this.handleEvaluate(msg as { type: 'evaluate'; requestId: number; input: unknown })
    }
  }

  private async handleLoad(msg: { type: 'load'; source: string }): Promise<void> {
    try {
      const encoded = encodeURIComponent(msg.source)
      const mod = (await import(
        /* @vite-ignore */ `data:text/javascript;charset=utf-8,${encoded}`
      )) as Record<string, unknown>
      const fn = mod['evaluate']
      if (typeof fn !== 'function') {
        throw new Error("package does not export a callable 'evaluate' function")
      }
      this.evaluateFn = fn as (input: unknown) => unknown
      this.emit({ type: 'loaded' })
    } catch (exc) {
      this.emit({
        type: 'load-error',
        error: { errorType: 'load_error', message: exc instanceof Error ? exc.message : String(exc) },
      })
    }
  }

  private async handleEvaluate(msg: { type: 'evaluate'; requestId: number; input: unknown }): Promise<void> {
    if (!this.evaluateFn) {
      this.emit({
        type: 'error',
        requestId: msg.requestId,
        error: { errorType: 'not_loaded', message: 'package not loaded' },
      })
      return
    }
    try {
      const output = await this.evaluateFn(msg.input)
      this.emit({ type: 'result', requestId: msg.requestId, output })
    } catch (exc) {
      this.emit({
        type: 'error',
        requestId: msg.requestId,
        error: { errorType: 'algorithm_exception', message: exc instanceof Error ? exc.message : String(exc) },
      })
    }
  }

  terminate(): void {
    this.terminated = true
  }
}

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory()
  await seedDefaults()
  vi.stubGlobal('Worker', FakeWorker)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('addUserPackage', () => {
  it('commits a valid package', async () => {
    const summary = await addUserPackage(GOOD)
    expect(summary.id).toBe('user_pkg')
    const { packages } = await listPackages()
    const committed = packages.find((p) => p.id === 'user_pkg')
    expect(committed).toBeTruthy()
    expect(committed?.algorithm_type).toBe('js_module')

    // The committed IndexedDB record itself must carry origin:'user' +
    // strategy:'js_module' (never 'builtin') — the strategy-seam
    // reconciliation this task implements.
    const record = await packagesStore.get('user_pkg')
    expect(record?.origin).toBe('user')
    expect(record?.strategy).toBe('js_module')
    expect(record?.source).toBe(GOOD)
  })

  it('rejects a failing package and saves nothing', async () => {
    const before = (await listPackages()).packages.length
    await expect(addUserPackage(BAD)).rejects.toBeTruthy()
    expect((await listPackages()).packages.length).toBe(before)
  })
})
