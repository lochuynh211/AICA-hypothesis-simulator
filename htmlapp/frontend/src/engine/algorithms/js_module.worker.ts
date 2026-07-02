/**
 * js_module Web Worker — executes UNTRUSTED user-uploaded JS algorithm
 * packages in the worker's isolated global scope.
 *
 * Design (spec §"js_module package strategy"):
 *   - The worker never touches the DOM, `window`, or IndexedDB directly —
 *     that boundary is what makes this "trust-the-package-source" isolation
 *     meaningful (not a full adversarial sandbox: a worker can still
 *     `fetch()`; see the spec for the exact threat model this covers).
 *   - The user's source text is loaded via a Blob URL + dynamic `import()`,
 *     so it runs as its own ES module inside the worker, never eval'd into
 *     this file's scope.
 *   - The worker NEVER crashes the main thread. Every failure mode (source
 *     fails to import, missing `evaluate` export, `evaluate` throwing, or a
 *     rejected promise) is caught here and reported back as a structured,
 *     key-free `{ type: 'error' | 'load-error', error }` message — never an
 *     uncaught exception that could propagate to `Worker.onerror` on the
 *     main thread (that channel is reserved for genuine worker crashes,
 *     e.g. a syntax error the dynamic import itself can't recover from).
 *
 * Message protocol (see `./js_module.ts` for the runner that speaks it):
 *   in  { type: 'load', source: string }
 *   out { type: 'loaded' } | { type: 'load-error', error: WorkerErrorInfo }
 *
 *   in  { type: 'evaluate', requestId: number, input: unknown }
 *   out { type: 'result', requestId: number, output: unknown }
 *     | { type: 'error', requestId: number, error: WorkerErrorInfo }
 *
 * Inlining: this file is imported by `js_module.ts` via
 * `new Worker(new URL('./js_module.worker.ts', import.meta.url), { type: 'module' })`
 * — the pattern `vite-plugin-singlefile` / Vite's `?worker&inline` machinery
 * bundles into the single shipped HTML file (finalized/verified in S9.3).
 */

export type WorkerErrorInfo = {
  errorType: string
  message: string
}

type LoadMessage = { type: 'load'; source: string }
type EvaluateMessage = { type: 'evaluate'; requestId: number; input: unknown }
type InMessage = LoadMessage | EvaluateMessage

type LoadedMessage = { type: 'loaded' }
type LoadErrorMessage = { type: 'load-error'; error: WorkerErrorInfo }
type ResultMessage = { type: 'result'; requestId: number; output: unknown }
type ErrorMessage = { type: 'error'; requestId: number; error: WorkerErrorInfo }
export type OutMessage = LoadedMessage | LoadErrorMessage | ResultMessage | ErrorMessage

// ---------------------------------------------------------------------------
// Worker-local state — one loaded package per worker instance.
// ---------------------------------------------------------------------------

let userEvaluate: ((input: unknown) => unknown) | null = null

function toErrorInfo(errorType: string, exc: unknown): WorkerErrorInfo {
  return {
    errorType,
    message: exc instanceof Error ? exc.message : String(exc),
  }
}

/**
 * Load the user's source as its own ES module via a Blob URL + dynamic
 * import(). Throws (caller catches) on any failure: syntax error, an
 * exception during module evaluation, or a missing/non-callable `evaluate`
 * export. `manifest` is read but not currently required — packages may omit
 * it; only `evaluate` is load-bearing here.
 */
async function loadSource(source: string): Promise<void> {
  const blob = new Blob([source], { type: 'text/javascript' })
  const url = URL.createObjectURL(blob)
  try {
    // @vite-ignore — the URL is a runtime-constructed blob: URL, never
    // resolvable/analyzable at bundle time.
    const mod = await import(/* @vite-ignore */ url)
    const evaluateFn = (mod as Record<string, unknown>)['evaluate']
    if (typeof evaluateFn !== 'function') {
      throw new Error("package does not export a callable 'evaluate' function")
    }
    userEvaluate = evaluateFn as (input: unknown) => unknown
  } finally {
    URL.revokeObjectURL(url)
  }
}

function post(message: OutMessage): void {
  // `postMessage` is the worker global's own — declared identically enough
  // between the DOM and WebWorker lib surfaces (both accept a single
  // structured-cloneable argument) that no cast is required at the call
  // site beyond what `lib: [..., "WebWorker"]` already provides.
  postMessage(message)
}

async function handleMessage(msg: InMessage): Promise<void> {
  if (msg.type === 'load') {
    try {
      await loadSource(msg.source)
      post({ type: 'loaded' })
    } catch (exc) {
      post({ type: 'load-error', error: toErrorInfo('load_error', exc) })
    }
    return
  }

  // msg.type === 'evaluate'
  if (!userEvaluate) {
    post({
      type: 'error',
      requestId: msg.requestId,
      error: toErrorInfo('not_loaded', new Error('package not loaded; send a "load" message first')),
    })
    return
  }

  try {
    // The user's evaluate() may be sync or return a Promise — await handles
    // both uniformly. A rejected promise is caught exactly like a throw.
    const output = await userEvaluate(msg.input)
    post({ type: 'result', requestId: msg.requestId, output })
  } catch (exc) {
    post({ type: 'error', requestId: msg.requestId, error: toErrorInfo('algorithm_exception', exc) })
  }
}

onmessage = (ev: MessageEvent<InMessage>) => {
  void handleMessage(ev.data)
}
