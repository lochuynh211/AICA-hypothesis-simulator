import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { handleWorkerMessage } from '../src/engine/worker/backend.worker'
import { createInstallGate } from '../src/engine/worker/install_gate'
import { resetRegistryForTests } from '../src/data/registry'

const REAL = JSON.parse(readFileSync(resolve(__dirname, '..', 'data', 'aica-data.json'), 'utf8'))

beforeEach(() => resetRegistryForTests())

const HANG_TIMEOUT = 1000

describe('backend.worker message handling — install-gate wiring', () => {
  it('a failed data.install makes a subsequent op fail fast with the install error, never hang', async () => {
    const gate = createInstallGate()

    // A genuinely invalid payload — real installRegistry() validation failure,
    // not a mock — so this exercises the actual data.install handler path.
    const installResponse = await handleWorkerMessage(
      { op: 'data.install', params: { payload: { schema_version: 99 } } },
      gate,
    )
    if (installResponse.ok) throw new Error('test setup expected install to fail')
    expect(installResponse.error.type).toBe('DataRegistryError')

    // A registry-dependent op posted after the failed install must resolve —
    // not hang — and carry the INSTALL's own error, not a fresh "registry not
    // installed" error from having actually run against the empty registry.
    const result = await Promise.race([
      handleWorkerMessage({ op: 'packages.list', params: {} }, gate),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('HANG')), HANG_TIMEOUT)),
    ])

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toEqual(installResponse.error)
  })

  it('a successful data.install lets a subsequent op through to dispatch', async () => {
    const gate = createInstallGate()

    const installResponse = await handleWorkerMessage(
      { op: 'data.install', params: { payload: REAL } },
      gate,
    )
    expect(installResponse.ok).toBe(true)

    const result = await Promise.race([
      handleWorkerMessage({ op: 'health.get', params: {} }, gate),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('HANG')), HANG_TIMEOUT)),
    ])
    expect(result.ok).toBe(true)
  })
})
