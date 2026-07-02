/**
 * js_module runner + adapter dispatch (S9.1).
 *
 * jsdom/vitest's default test environment has no real Worker, no module
 * Worker, and no browser Blob-URL-backed dynamic import(). To test the
 * RUNNER's protocol logic (post/resolve/reject, load handshake, timeout,
 * terminate) honestly — without vacuously mocking the runner itself — this
 * file stubs the global `Worker` constructor with a small in-process
 * FakeWorker that speaks the exact same message protocol as the real
 * `js_module.worker.ts` (see that file's protocol doc comment):
 *
 *   in  { type: 'load', source }              -> { type: 'loaded' } | { type: 'load-error', error }
 *   in  { type: 'evaluate', requestId, input } -> { type: 'result', requestId, output }
 *                                                | { type: 'error', requestId, error }
 *
 * FakeWorker loads the user source via a `data:` URL dynamic import (Node
 * supports this; browsers additionally support the real worker's blob: URL
 * approach, which is validated by the Playwright e2e in S9.4 — not here).
 * Everything downstream of "worker responded with a message" — i.e. all of
 * `src/engine/algorithms/js_module.ts` — is the REAL, unmodified production
 * code under test.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createJsModuleRunner } from '../src/engine/algorithms/js_module'
import { evaluateJsModule } from '../src/engine/algorithms/adapter'
import { AlgorithmAdapterError } from '../src/engine/algorithms/errors'

// ---------------------------------------------------------------------------
// Fixture sources
// ---------------------------------------------------------------------------

const GOOD = `export const manifest = { id: 'u1', algorithm: { type: 'js_module' } };
export function evaluate(input){ return { fired: false, trigger_category: null, scores: {}, states: {} }; }`

const THROWING = `export const manifest = { id: 'u2', algorithm: { type: 'js_module' } };
export function evaluate(input){ throw new Error('boom'); }`

const NO_EVALUATE_EXPORT = `export const manifest = { id: 'u3', algorithm: { type: 'js_module' } };
export const notEvaluate = () => ({});`

const SYNTAX_ERROR = `export function evaluate(input){ return {`

const SLOW = `export function evaluate(input){ return { ok: true }; }`

const FULL_DECISION_RESULT_SOURCE = `export const manifest = { id: 'u_full', algorithm: { type: 'js_module' } };
export function evaluate(input){
  return {
    result_type: 'NO_TRIGGER',
    trigger_candidate: false,
    selected_category: null,
    score: 0,
    features: {},
    scores: {},
    states: {},
    criteria: {},
    candidates: [],
    fire_control: { fired: false, suppressed: false, override: false, reason: null },
    proposal: null,
    reason_inputs: [],
    explanation: 'no trigger',
    next_package_runtime_state: { seen: (input.package_runtime_state.seen || 0) + 1 },
  };
}`

const CRASHING_ADAPTER_SOURCE = `export function evaluate(input){ throw new Error('adapter crash'); }`

// ---------------------------------------------------------------------------
// FakeWorker — test-only Worker transport polyfill (production code untouched)
// ---------------------------------------------------------------------------

type FakeOutMessage = { type: string; [k: string]: unknown }

class FakeWorker {
  onmessage: ((ev: { data: FakeOutMessage }) => void) | null = null
  onerror: ((ev: { message: string }) => void) | null = null
  /** Explicit opt-in knob for the timeout test: delay every response. */
  static nextDelayMs = 0

  private listeners = new Map<string, Set<(ev: { data: FakeOutMessage }) => void>>()
  private evaluateFn: ((input: unknown) => unknown) | null = null
  /** Mirrors real Worker.terminate(): discards in-flight work, ignores further messages. */
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
    const delay = FakeWorker.nextDelayMs
    if (msg.type === 'load') {
      void this.handleLoad(msg as { type: 'load'; source: string }, delay)
      return
    }
    if (msg.type === 'evaluate') {
      void this.handleEvaluate(msg as { type: 'evaluate'; requestId: number; input: unknown }, delay)
    }
  }

  private async handleLoad(msg: { type: 'load'; source: string }, delay: number): Promise<void> {
    if (delay) await new Promise((r) => setTimeout(r, delay))
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

  private async handleEvaluate(
    msg: { type: 'evaluate'; requestId: number; input: unknown },
    delay: number,
  ): Promise<void> {
    if (delay) await new Promise((r) => setTimeout(r, delay))
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

function installFakeWorker(): void {
  FakeWorker.nextDelayMs = 0
  vi.stubGlobal('Worker', FakeWorker)
}

afterEach(() => {
  FakeWorker.nextDelayMs = 0
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------
// Runner tests
// ---------------------------------------------------------------------------

describe('js_module runner', () => {
  it('runs a well-formed user package', async () => {
    installFakeWorker()
    const r = createJsModuleRunner(GOOD)
    expect(await r.smokeTest()).toBe(true)
    r.terminate()
  })

  it('resolves evaluate() with the package output for a well-formed package', async () => {
    installFakeWorker()
    const r = createJsModuleRunner(GOOD)
    const out = await r.evaluate({ context: {}, parameters: {}, hyperparameters: {}, history: [], package_runtime_state: {} })
    expect(out).toEqual({ fired: false, trigger_category: null, scores: {}, states: {} })
    r.terminate()
  })

  it('rejects evaluate() and fails smokeTest() when evaluate() throws', async () => {
    installFakeWorker()
    const r = createJsModuleRunner(THROWING)
    await expect(
      r.evaluate({ context: {}, parameters: {}, hyperparameters: {}, history: [], package_runtime_state: {} }),
    ).rejects.toThrow(/boom/)
    r.terminate()

    const r2 = createJsModuleRunner(THROWING)
    expect(await r2.smokeTest()).toBe(false)
    r2.terminate()
  })

  it('fails smokeTest() when the package has no evaluate export', async () => {
    installFakeWorker()
    const r = createJsModuleRunner(NO_EVALUATE_EXPORT)
    expect(await r.smokeTest()).toBe(false)
    r.terminate()
  })

  it('fails smokeTest() when the source fails to import (syntax error)', async () => {
    installFakeWorker()
    const r = createJsModuleRunner(SYNTAX_ERROR)
    expect(await r.smokeTest()).toBe(false)
    r.terminate()
  })

  it('rejects evaluate() with a timeout when the worker takes too long to respond', async () => {
    installFakeWorker()
    FakeWorker.nextDelayMs = 50
    const r = createJsModuleRunner(SLOW, { timeoutMs: 5 })
    await expect(
      r.evaluate({ context: {}, parameters: {}, hyperparameters: {}, history: [], package_runtime_state: {} }),
    ).rejects.toThrow(/timeout/)
    r.terminate()
  })

  it('terminate() rejects any in-flight evaluate() call', async () => {
    installFakeWorker()
    FakeWorker.nextDelayMs = 1000
    const r = createJsModuleRunner(SLOW, { timeoutMs: 10_000 })
    const pending = r.evaluate({ context: {}, parameters: {}, hyperparameters: {}, history: [], package_runtime_state: {} })
    r.terminate()
    await expect(pending).rejects.toThrow(/terminated/)
  })
})

// ---------------------------------------------------------------------------
// Adapter dispatch tests
// ---------------------------------------------------------------------------

describe('adapter.evaluateJsModule', () => {
  it('normalizes a valid DecisionResult and threads next_package_runtime_state through', async () => {
    installFakeWorker()
    const runner = createJsModuleRunner(FULL_DECISION_RESULT_SOURCE)
    const result = await evaluateJsModule({
      runner,
      context: {},
      parameters: {},
      hyperparameters: {},
      history: [],
      packageRuntimeState: { seen: 4 },
    })
    expect(result.result_type).toBe('NO_TRIGGER')
    expect(result.trigger_candidate).toBe(false)
    expect(result.next_package_runtime_state).toEqual({ seen: 5 })
    runner.terminate()
  })

  it('raises AlgorithmAdapterError(invalid_result_shape) for a malformed return value', async () => {
    installFakeWorker()
    const runner = createJsModuleRunner(GOOD) // GOOD's output is not a DecisionResult shape
    await expect(
      evaluateJsModule({
        runner,
        context: {},
        parameters: {},
        hyperparameters: {},
        history: [],
        packageRuntimeState: {},
      }),
    ).rejects.toThrow(AlgorithmAdapterError)
    runner.terminate()
  })

  it('raises AlgorithmAdapterError(algorithm_exception) when the worker call throws/rejects', async () => {
    installFakeWorker()
    const runner = createJsModuleRunner(CRASHING_ADAPTER_SOURCE)
    let caught: unknown
    try {
      await evaluateJsModule({
        runner,
        context: {},
        parameters: {},
        hyperparameters: {},
        history: [],
        packageRuntimeState: {},
      })
    } catch (exc) {
      caught = exc
    }
    expect(caught).toBeInstanceOf(AlgorithmAdapterError)
    expect((caught as InstanceType<typeof AlgorithmAdapterError>).detail).toEqual({ error_type: 'algorithm_exception' })
    runner.terminate()
  })
})
