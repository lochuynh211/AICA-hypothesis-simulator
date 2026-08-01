/// <reference lib="webworker" />
import type { RpcRequest, RpcResponse } from '../../api/rpc'
import { dispatch } from './dispatch'

// Every op except data.install needs the data registry, and dispatch is async —
// without this gate a second message could interleave past an await and run
// against an empty registry. Resolved by the data.install message.
let markReady: () => void
const ready = new Promise<void>((resolve) => { markReady = resolve })

self.onmessage = async (ev: MessageEvent) => {
  const { id, req } = ev.data as { id: number; req: RpcRequest }
  let response: RpcResponse
  try {
    if (req.op !== 'data.install') await ready
    response = await dispatch(req)
    if (req.op === 'data.install' && response.ok) markReady()
  } catch (e) {
    response = { ok: false, error: { type: 'DispatchError', message: String(e) } }
  }
  ;(self as unknown as Worker).postMessage({ id, response })
}
