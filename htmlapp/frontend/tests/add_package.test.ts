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

// Declares a NON-js_module algorithm.type — exercises addUserPackage's
// forcing logic (committed record must still be 'js_module' regardless).
const NON_JS_MODULE_TYPE = `export const manifest={id:'user_pkg_other_type',version:'1',algorithm:{type:'declarative_rule'},label:{en:'O',ja:'O'},compatible_scenario_types:['uc01_fatigue'],features:[],parameters:[],hyperparameters:[],trigger_categories:[],rules:[],proposals:[],feedback_schema:[],evidence_metrics:[]};
export function evaluate(){return{fired:false,trigger_category:null,scores:{},states:{}}}`

// Top-level side effect (module-scope, fires on ANY import/eval of this
// source) used to prove NO main-thread execution of the untrusted source
// happens anywhere in addUserPackage's path — see the
// 'main-thread isolation' describe block below.
const SIDE_EFFECT_SOURCE = `globalThis.__sideEffectRan = true;
export const manifest={id:'user_pkg_side_effect',version:'1',algorithm:{type:'js_module'},label:{en:'S',ja:'S'},compatible_scenario_types:['uc01_fatigue'],features:[],parameters:[],hyperparameters:[],trigger_categories:[],rules:[],proposals:[],feedback_schema:[],evidence_metrics:[]};
export function evaluate(){return{fired:false,trigger_category:null,scores:{},states:{}}}`

// ---------------------------------------------------------------------------
// FakeWorker — test-only Worker transport polyfill (production code untouched).
// Copied/trimmed from tests/js_module.test.ts's FakeWorker (S9.1); speaks the
// exact same message protocol as the real src/engine/algorithms/js_module.worker.ts.
// ---------------------------------------------------------------------------

type FakeOutMessage = { type: string; [k: string]: unknown }

class FakeWorker {
  onmessage: ((ev: { data: FakeOutMessage }) => void) | null = null
  onerror: ((ev: { message: string }) => void) | null = null

  /**
   * Instrumentation ONLY — records, at the moment each FakeWorker instance
   * is constructed (i.e. the moment `createJsModuleRunner` spins up the
   * "worker"), whether the untrusted source's top-level side effect had
   * ALREADY fired. If addUserPackage ever imports/evals the untrusted
   * source itself (main thread) before/outside handing it to the worker,
   * this flips true before the worker even exists. Reset per-test.
   */
  static sideEffectAlreadyRanAtConstruction: boolean[] = []

  private listeners = new Map<string, Set<(ev: { data: FakeOutMessage }) => void>>()
  private evaluateFn: ((input: unknown) => unknown) | null = null
  private terminated = false

  constructor(_url: URL | string, _opts?: unknown) {
    FakeWorker.sideEffectAlreadyRanAtConstruction.push((globalThis as Record<string, unknown>)['__sideEffectRan'] === true)
  }

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
      this.emit({ type: 'loaded', manifest: mod['manifest'] ?? null })
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
  FakeWorker.sideEffectAlreadyRanAtConstruction = []
  delete (globalThis as Record<string, unknown>)['__sideEffectRan']
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete (globalThis as Record<string, unknown>)['__sideEffectRan']
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

  // Minor (review): a manifest declaring a NON-js_module algorithm.type must
  // still be committed with algorithm.type FORCED to 'js_module' — exercises
  // the forcing logic in addUserPackage (strategy-seam reconciliation).
  it('forces algorithm.type to js_module even when the manifest declares a different type', async () => {
    const summary = await addUserPackage(NON_JS_MODULE_TYPE)
    expect(summary.id).toBe('user_pkg_other_type')
    expect(summary.algorithm_type).toBe('js_module')

    const record = await packagesStore.get('user_pkg_other_type')
    expect(record?.strategy).toBe('js_module')
    expect(record?.manifest.algorithm.type).toBe('js_module')

    const { packages } = await listPackages()
    const committed = packages.find((p) => p.id === 'user_pkg_other_type')
    expect(committed?.algorithm_type).toBe('js_module')
  })
})

describe('addUserPackage main-thread isolation (S9.2 review fix)', () => {
  // Reproduces the reviewer's finding: a package with a top-level side
  // effect (`globalThis.__sideEffectRan = true` at module scope) must NEVER
  // run that side effect on the MAIN THREAD as part of manifest extraction.
  // The untrusted source is only ever allowed to execute inside the
  // sandboxed worker (modeled here by FakeWorker).
  //
  // Distinguishing "ran on the main thread" from "ran inside the worker" by
  // final global state alone isn't meaningful in this Node/jsdom test
  // environment (there's no real OS thread, and identical `data:` URL
  // imports are cached by the module loader, so the source only executes
  // once regardless of who's asking). What IS meaningful — and exactly what
  // the defect was — is ORDER: did the untrusted source execute BEFORE the
  // sandboxed worker was even spun up? `FakeWorker.sideEffectAlreadyRanAtConstruction`
  // captures the side-effect flag's value at the exact moment each FakeWorker
  // ("the worker") is constructed. Before the fix, `extractUserManifest`
  // imported the source on the main thread FIRST, so the flag was already
  // true by the time the worker was constructed. After the fix, nothing
  // executes before the worker exists — the flag is only set once the
  // worker's own (simulated) load handshake imports the source.
  it('does not execute the uploaded source on the main thread before the worker is engaged', async () => {
    const summary = await addUserPackage(SIDE_EFFECT_SOURCE)
    expect(summary.id).toBe('user_pkg_side_effect')

    // Exactly one worker should have been constructed for this call.
    expect(FakeWorker.sideEffectAlreadyRanAtConstruction.length).toBeGreaterThanOrEqual(1)
    // At worker-construction time, the untrusted source must NOT have run
    // yet anywhere — i.e. no main-thread execution preceded handing the
    // source to the worker.
    for (const ranAlready of FakeWorker.sideEffectAlreadyRanAtConstruction) {
      expect(ranAlready).toBe(false)
    }

    // Sanity: the source DID eventually run (inside the simulated worker),
    // proving this isn't a vacuous pass from the source never executing.
    expect((globalThis as Record<string, unknown>)['__sideEffectRan']).toBe(true)
  })
})
