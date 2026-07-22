import { describe, it, expect } from 'vitest'
import { makeRunId } from '../src/engine/worker/handlers/runs'
import { makePlanId } from '../src/engine/worker/handlers/run_plans'

describe('id generation', () => {
  it('run ids are unique across a simulated reload (fresh module counter state)', () => {
    const a = makeRunId()
    const b = makeRunId()
    expect(a).not.toBe(b)
    // Reload safety: ids must not be a pure 1-based counter that resets to run_000001.
    expect(a).not.toMatch(/_0*1$/)
  })
  it('plan ids and run ids do not collide', () => {
    const ids = new Set<string>()
    for (let i = 0; i < 50; i++) { ids.add(makeRunId()); ids.add(makePlanId()) }
    expect(ids.size).toBe(100)
  })
})
