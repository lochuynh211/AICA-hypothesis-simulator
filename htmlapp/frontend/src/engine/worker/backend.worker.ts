/// <reference lib="webworker" />
import type { RpcRequest, RpcResponse } from '../../api/rpc'
import { dispatch } from './dispatch'

self.onmessage = async (ev: MessageEvent) => {
  const { id, req } = ev.data as { id: number; req: RpcRequest }
  let response: RpcResponse
  try {
    response = await dispatch(req)
  } catch (e) {
    response = { ok: false, error: { type: 'DispatchError', message: String(e) } }
  }
  ;(self as unknown as Worker).postMessage({ id, response })
}
