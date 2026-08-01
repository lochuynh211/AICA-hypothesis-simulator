import { describe, it, beforeEach, expect } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { seedDefaults } from '../src/storage/db'
import { loadTranscript, normalizeForParity } from '../src/engine/__fixtures__/transcript'
import { expectParity } from '../src/engine/__fixtures__/parity'
import { InProcessTransport } from '../src/api/transport'
import { resetDispatchState } from '../src/engine/worker/dispatch'
import { clearDraftRegistry } from '../src/engine/run_plan'
import { clearRegistry } from '../src/engine/run_manager'
import type { RpcOp } from '../src/api/rpc'
import { ensureRegistry } from '../src/data/registry'

// tests/setup.ts installs globalThis.__AICA_DATA__ from the generated payload.
ensureRegistry()

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory()
  resetDispatchState(); await seedDefaults(); clearDraftRegistry(); clearRegistry()
})

describe('contract parity: JS router vs Python transcript', () => {
  it('replays trigger_nri_session and matches Python responses (ids normalized)', async () => {
    const tx = loadTranscript('trigger_nri_session')
    const transport = new InProcessTransport()
    let planId: string | null = null
    let runId: string | null = null

    for (const step of tx.steps) {
      // Rewrite recorded ids to the ones this JS session generated.
      const params: Record<string, unknown> = { ...step.params }
      if (params.plan_id != null && planId) params.plan_id = planId
      if (params.run_id != null && runId) params.run_id = runId
      const mapped = mapParams(step.op as RpcOp, params)

      const r = await transport.call({ op: step.op as RpcOp, params: mapped })
      expect(r.ok, `op ${step.op} errored: ${JSON.stringify(!r.ok && r.error)}`).toBe(true)
      if (!r.ok) continue

      if (step.op === 'runPlans.create') planId = (r.result as any).plan_id
      if (step.op === 'runs.create') runId = (r.result as any).run_id

      expectParity(normalizeForParity(r.result), normalizeForParity(step.response))
    }
  })
})

// Transcript params use the Python HTTP body key names; map them to the RPC param shape.
function mapParams(op: RpcOp, p: Record<string, unknown>): Record<string, unknown> {
  switch (op) {
    case 'runPlans.create': return { packageId: p.package_id, scenarioId: p.scenario_id }
    case 'runs.create': return { planId: p.plan_id }
    case 'runs.tick': return { runId: p.run_id }
    case 'runs.act': return { runId: p.run_id, action: p.action, opts: { recovery_option_id: p.recovery_option_id, rest_spot: p.rest_spot } }
    case 'runs.log': return { runId: p.run_id }
    case 'evidence.get': return { runId: p.run_id, uiLanguage: p.ui_language }
    default: return p
  }
}
