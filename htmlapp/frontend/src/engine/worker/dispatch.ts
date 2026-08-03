import type { RpcRequest, RpcResponse } from '../../api/rpc'
import { serializeError } from '../../api/rpc'
import { seedDefaults } from '../../storage/db'
import { router } from './router'

let _seeded: Promise<void> | null = null
function ready(): Promise<void> {
  return (_seeded ??= seedDefaults())
}

/** Test-only: drop the seed latch so a fresh IDBFactory re-seeds. */
export function resetDispatchState(): void {
  _seeded = null
}

export async function dispatch(req: RpcRequest): Promise<RpcResponse> {
  try {
    // data.install seeds the data registry itself; seedDefaults() (called by
    // ready()) reads builtinPackages()/builtinScenarios() FROM that registry,
    // so gating data.install on ready() would throw on the very first install
    // (registry not installed yet) instead of installing it.
    if (req.op !== 'data.install') await ready()
    const handler = router[req.op]
    if (!handler) return { ok: false, error: { type: 'UnknownOp', message: `unknown op: ${req.op}` } }
    const result = await handler(req.params)
    return { ok: true, result }
  } catch (e) {
    return { ok: false, error: serializeError(e) }
  }
}
