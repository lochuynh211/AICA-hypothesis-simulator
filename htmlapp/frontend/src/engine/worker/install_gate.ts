/**
 * install_gate — the worker's data.install ordering/failure gate, factored
 * out of `backend.worker.ts` so the race-closing behaviour can be unit-tested
 * directly (this module imports nothing worker-specific: no `self`, no
 * `postMessage`, no `MessageEvent`).
 *
 * Two responsibilities, both load-bearing:
 *   1. Ordering — every op except data.install must wait for install to
 *      settle before running, because dispatch() is async and a later
 *      message can otherwise interleave past an await and run against an
 *      empty registry.
 *   2. Failure — a *failed* install (a structured RpcError, not a thrown
 *      exception — see handlers/data.ts) must not hang later ops forever.
 *      `wait()` resolves on failure too; callers check `error()` afterwards
 *      and fail fast with the install's own error instead of dispatching
 *      against a registry that was never installed.
 */
import type { RpcError } from '../../api/rpc'

export type InstallGate = {
  /** Resolves once install has settled, successfully or not. */
  wait(): Promise<void>
  /** Record a successful install and release waiters. */
  succeed(): void
  /** Record a failed install and release waiters with the reason. */
  fail(error: RpcError): void
  /** The install error, if the install failed. Null before settling and after a success. */
  error(): RpcError | null
}

export function createInstallGate(): InstallGate {
  let settled = false
  let installError: RpcError | null = null
  let release: () => void
  const settledPromise = new Promise<void>((resolve) => { release = resolve })

  return {
    wait() {
      return settledPromise
    },
    succeed() {
      if (settled) return
      settled = true
      installError = null
      release()
    },
    fail(error: RpcError) {
      if (settled) return
      settled = true
      installError = error
      release()
    },
    error() {
      return installError
    },
  }
}
