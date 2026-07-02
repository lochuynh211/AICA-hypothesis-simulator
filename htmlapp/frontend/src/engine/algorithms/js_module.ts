/**
 * js_module runner — one sandboxed Web Worker per UNTRUSTED user-uploaded
 * algorithm package.
 *
 * Ported concept: `app/api/aica_api/algorithms/python_module.py` loads a
 * *trusted, local* Python package in-process. The offline app has no such
 * trust boundary for user-uploaded JS, so this is a browser-native rewrite,
 * not a port: the package runs inside a Web Worker (see `./js_module.worker.ts`
 * for the sandboxing rationale and message protocol), and every call is
 * therefore async — the one deliberate exception to the otherwise-synchronous
 * `declarative_rule` / `weighted_score` / `builtin_js_module` adapter path
 * (see `./adapter.ts`).
 *
 * `createJsModuleRunner(source)`:
 *   - Spawns exactly one worker for the package's source text.
 *   - `evaluate(input)` posts an `evaluate` request and resolves/rejects on
 *     the worker's response (or a timeout — a hung/looping user `evaluate()`
 *     must not block the caller forever).
 *   - `smokeTest()` runs a single canned probe evaluation and reports
 *     whether the package loads and evaluates without error. This is
 *     intentionally a LOOSE check (did it run without throwing?), not a
 *     full §11 DecisionResult validation — it gates package upload (S9.2),
 *     where the fuller shape validation happens separately. Strict
 *     normalization into a DecisionResult is `adapter.ts`'s job for actual
 *     run evaluation.
 *   - `terminate()` tears the worker down and rejects any in-flight calls.
 */

// Vite's `?worker&inline` import form (rather than the
// `new Worker(new URL('./js_module.worker.ts', import.meta.url), { type: 'module' })`
// pattern) is REQUIRED for `vite-plugin-singlefile` to bundle the worker's
// code as a base64 data: URL directly inside the single shipped HTML file.
// The plain `new URL(...)` form only gets inlined while the worker was
// unreachable from any production entry point; S9.2 makes `client.ts` (a
// real production module) import `createJsModuleRunner`, which makes this
// module — and therefore the worker chunk — reachable from the production
// build for the first time. Without `?worker&inline`, Vite emits the worker
// as a SIBLING chunk (e.g. `dist/js_module.worker-XXXX.js`), which breaks the
// single-file / `file://`-openable distributable requirement (verified via
// `npm run build` + `ls dist/` — see S9.2 report).
import JsWorker from './js_module.worker.ts?worker&inline'

export type EvaluateInput = {
  context: Record<string, unknown>
  parameters: Record<string, unknown>
  hyperparameters: Record<string, unknown>
  history: unknown[]
  package_runtime_state: Record<string, unknown>
}

/**
 * The package's raw, untrusted return value. Structurally unknown until
 * `adapter.ts` validates and normalizes it into a `DecisionResult` — see
 * `evaluateJsModule` there.
 */
export type EvaluateOutput = Record<string, unknown>

export type JsModuleRunner = {
  evaluate(input: EvaluateInput): Promise<EvaluateOutput>
  smokeTest(): Promise<boolean>
  terminate(): void
}

export type JsModuleRunnerOptions = {
  /** Per-call timeout in ms. Defaults to 5000. */
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 5000

/** Minimal, representative probe input for smokeTest(). */
const SMOKE_INPUT: EvaluateInput = {
  context: {},
  parameters: {},
  hyperparameters: {},
  history: [],
  package_runtime_state: {},
}

type WorkerErrorInfo = { errorType?: string; message?: string }

type PendingEntry = {
  resolve(output: EvaluateOutput): void
  reject(err: Error): void
  timer: ReturnType<typeof setTimeout>
}

function errorFromInfo(fallbackType: string, error: WorkerErrorInfo | undefined): Error {
  const errorType = error?.errorType ?? fallbackType
  const message = error?.message ?? 'unknown worker error'
  return new Error(`${errorType}: ${message}`)
}

/**
 * Create a runner backed by exactly one Web Worker running `source`.
 *
 * The worker is spawned via the `JsWorker` class imported through Vite's
 * `?worker&inline` query (see the import at the top of this file) — the
 * form `vite-plugin-singlefile` inlines as a base64 `data:` URL directly
 * inside the single shipped HTML file, verified by `npm run build` + `ls
 * dist/` producing exactly one `index.html` (S9.2).
 */
export function createJsModuleRunner(source: string, options?: JsModuleRunnerOptions): JsModuleRunner {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const worker = new JsWorker()

  let nextRequestId = 1
  const pending = new Map<number, PendingEntry>()
  let loadPromise: Promise<void> | null = null
  let rejectLoadPromise: ((err: Error) => void) | null = null

  function settleAllWith(err: Error): void {
    for (const [id, entry] of pending) {
      clearTimeout(entry.timer)
      entry.reject(err)
      pending.delete(id)
    }
    // A caller may be `await`ing ensureLoaded() itself (i.e. terminate() was
    // called before the worker ever answered the initial 'load' message) —
    // reject that too, or evaluate()/smokeTest() would hang forever.
    rejectLoadPromise?.(err)
    rejectLoadPromise = null
  }

  worker.onmessage = (ev: MessageEvent) => {
    const msg = ev.data as { type?: string; requestId?: number; output?: unknown; error?: WorkerErrorInfo } | undefined
    if (!msg || (msg.type !== 'result' && msg.type !== 'error')) return
    const entry = typeof msg.requestId === 'number' ? pending.get(msg.requestId) : undefined
    if (!entry) return
    pending.delete(msg.requestId as number)
    clearTimeout(entry.timer)
    if (msg.type === 'result') {
      entry.resolve((msg.output ?? {}) as EvaluateOutput)
    } else {
      entry.reject(errorFromInfo('algorithm_exception', msg.error))
    }
  }

  // A genuine worker crash (e.g. an uncaught error escaping the worker's own
  // scope) is not tied to a specific request — reject everything in flight
  // rather than hanging callers forever.
  worker.onerror = (ev: ErrorEvent) => {
    settleAllWith(new Error(`worker_crashed: ${ev.message || 'unknown worker error'}`))
  }

  function ensureLoaded(): Promise<void> {
    if (!loadPromise) {
      loadPromise = new Promise<void>((resolve, reject) => {
        rejectLoadPromise = (err: Error) => {
          worker.removeEventListener('message', onMessage)
          reject(err)
        }
        const onMessage = (ev: MessageEvent) => {
          const msg = ev.data as { type?: string; error?: WorkerErrorInfo } | undefined
          if (msg?.type === 'loaded') {
            worker.removeEventListener('message', onMessage)
            rejectLoadPromise = null
            resolve()
          } else if (msg?.type === 'load-error') {
            worker.removeEventListener('message', onMessage)
            rejectLoadPromise = null
            reject(errorFromInfo('load_error', msg.error))
          }
        }
        worker.addEventListener('message', onMessage)
        worker.postMessage({ type: 'load', source })
      })
    }
    return loadPromise
  }

  async function evaluate(input: EvaluateInput): Promise<EvaluateOutput> {
    await ensureLoaded()
    const requestId = nextRequestId++
    return new Promise<EvaluateOutput>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId)
        reject(new Error(`timeout: js_module evaluate() exceeded ${timeoutMs}ms`))
      }, timeoutMs)
      pending.set(requestId, { resolve, reject, timer })
      worker.postMessage({ type: 'evaluate', requestId, input })
    })
  }

  async function smokeTest(): Promise<boolean> {
    try {
      await evaluate(SMOKE_INPUT)
      return true
    } catch {
      return false
    }
  }

  function terminate(): void {
    settleAllWith(new Error('terminated'))
    worker.terminate()
  }

  return { evaluate, smokeTest, terminate }
}
