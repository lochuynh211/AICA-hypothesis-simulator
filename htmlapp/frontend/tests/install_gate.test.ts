import { describe, it, expect } from 'vitest'
import { createInstallGate } from '../src/engine/worker/install_gate'
import type { RpcError } from '../src/api/rpc'

/** Flush the microtask queue so any already-scheduled .then callbacks run. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

const ERR: RpcError = { type: 'DataRegistryError', message: 'boom' }

describe('createInstallGate', () => {
  it('an op awaiting wait() does not proceed before succeed() is called', async () => {
    const gate = createInstallGate()
    const events: string[] = []

    const waiterDone = gate.wait().then(() => { events.push('waiter') })

    // Give the waiter every chance to (incorrectly) run early.
    await flush()
    events.push('before-succeed')
    gate.succeed()

    await waiterDone
    expect(events).toEqual(['before-succeed', 'waiter'])
  })

  it('wait() resolves after fail() too, and error() then returns the recorded error', async () => {
    const gate = createInstallGate()
    const events: string[] = []

    const waiterDone = gate.wait().then(() => { events.push('waiter') })

    await flush()
    events.push('before-fail')
    gate.fail(ERR)

    await waiterDone
    expect(events).toEqual(['before-fail', 'waiter'])
    expect(gate.error()).toEqual(ERR)
  })

  it('error() is null after succeed()', async () => {
    const gate = createInstallGate()
    gate.succeed()
    await gate.wait()
    expect(gate.error()).toBeNull()
  })

  it('a waiter registered after success settles resolves immediately', async () => {
    const gate = createInstallGate()
    gate.succeed()

    const result = await Promise.race([
      gate.wait().then(() => 'resolved'),
      new Promise<'hang'>((resolve) => setTimeout(() => resolve('hang'), 500)),
    ])
    expect(result).toBe('resolved')
    expect(gate.error()).toBeNull()
  })

  it('a waiter registered after failure settles resolves immediately, with the error available', async () => {
    const gate = createInstallGate()
    gate.fail(ERR)

    const result = await Promise.race([
      gate.wait().then(() => 'resolved'),
      new Promise<'hang'>((resolve) => setTimeout(() => resolve('hang'), 500)),
    ])
    expect(result).toBe('resolved')
    expect(gate.error()).toEqual(ERR)
  })
})
