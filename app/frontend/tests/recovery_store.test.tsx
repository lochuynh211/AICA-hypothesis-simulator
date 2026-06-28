import { describe, it, expect } from 'vitest'
import { reducer, initialState } from '../src/state/runStore'
import type { RunState } from '../src/api/types'

const baseRun: RunState = {
  run_id: 'r1', status: 'paused', current_tick: 3, pending_proposal: 'rest',
  package_runtime_state: {}, snapshot: { package: {id:'p',version:'1',hash:'h'}, scenario:{id:'s',version:'1',hash:'h'} },
  event_plan: {}, route_facts: {},
}

it('ACTION_APPLIED records the applied action for the beat timeline', () => {
  const s = reducer({ ...initialState, runState: baseRun },
    { type: 'ACTION_APPLIED', runState: { ...baseRun, status: 'playing' }, action: 'accept_rest' })
  expect(s.lastAction).toBe('accept_rest')
  expect(s.paused).toBe(false)
})
