/// <reference lib="webworker" />
import type { RpcRequest, RpcResponse } from '../../api/rpc'
import { dispatch } from './dispatch'
import { createInstallGate, type InstallGate } from './install_gate'

const gate = createInstallGate()

/**
 * The worker's message-handling core, factored out of `self.onmessage` so it
 * can be driven directly in tests without a real worker global scope — this
 * function touches no worker globals (`self`, `postMessage`, `MessageEvent`).
 *
 * `installGate` defaults to the module-scope gate for production use; tests
 * pass a fresh `createInstallGate()` instance to exercise the ordering and
 * failure paths in isolation.
 *
 * data.install: dispatch it, then record success/failure on the gate.
 * Everything else: wait for install to settle, then — if it failed — return
 * that failure immediately instead of dispatching against an uninstalled
 * registry; a failed install must fail every later op fast, never hang them.
 */
export async function handleWorkerMessage(
  req: RpcRequest,
  installGate: InstallGate = gate,
): Promise<RpcResponse> {
  if (req.op === 'data.install') {
    const response = await dispatch(req)
    if (response.ok) installGate.succeed()
    else installGate.fail(response.error)
    return response
  }
  await installGate.wait()
  const installError = installGate.error()
  if (installError) return { ok: false, error: installError }
  return dispatch(req)
}

self.onmessage = async (ev: MessageEvent) => {
  const { id, req } = ev.data as { id: number; req: RpcRequest }
  let response: RpcResponse
  try {
    response = await handleWorkerMessage(req)
  } catch (e) {
    response = { ok: false, error: { type: 'DispatchError', message: String(e) } }
  }
  ;(self as unknown as Worker).postMessage({ id, response })
}
