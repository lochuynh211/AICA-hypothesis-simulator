import { render, screen, act } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import React from 'react'
import { RunStoreProvider, useRunStore } from '../src/state/runStore'
import type { RunStoreAction } from '../src/state/runStore'
import { useLiveTimelineData } from '../src/components/playback/useLiveTimelineData'
import type { DecisionResult, RunState } from '../src/api/types'

vi.mock('../src/api/client', () => ({
  getScenario: vi.fn().mockResolvedValue({ route_intent: { segments: [] }, total_duration_seconds: 600 }),
}))

const runState = { run_id: 'r1', status: 'running', event_plan: { tick_seconds: 60, ticks: [] } } as unknown as RunState

function decision(score: number, monotony: number, fired: boolean): DecisionResult {
  return {
    result_type: fired ? 'REST_PROPOSAL' : 'NO_TRIGGER',
    trigger_candidate: fired, selected_category: fired ? 'rest_required' : null,
    score, features: {}, scores: { rest_required_score: score, monotony_prevention_score: monotony },
    states: {}, criteria: { threshold_fire: 0.6, monotony_suggest_threshold: 0.7 }, candidates: [],
    fire_control: { fired, suppressed: false, override: false, reason: null },
    proposal: fired ? { id: 'p', message: { ja: '', en: '' }, options: ['accept_rest'] } : null,
    reason_inputs: [], explanation: '', next_package_runtime_state: {},
  }
}

let captured: ReturnType<typeof useLiveTimelineData> | null = null
function Probe() {
  captured = useLiveTimelineData(null)
  return null
}
let dispatch: React.Dispatch<RunStoreAction> | null = null
function Dispatcher() {
  dispatch = useRunStore().dispatch
  return null
}

describe('useLiveTimelineData (live)', () => {
  it('accumulates one rest+monotony curve point per tick and reveals to the latest fraction', async () => {
    render(<RunStoreProvider><Dispatcher /><Probe /></RunStoreProvider>)
    await act(async () => {
      dispatch!({ type: 'RUN_CREATED', runState })
      dispatch!({ type: 'TICK_APPENDED', runState, decision: decision(0.2, 0.1, false), tickIndex: 0, paused: false, completed: false, routeFraction: 0.0 })
      dispatch!({ type: 'TICK_APPENDED', runState, decision: decision(0.7, 0.3, true), tickIndex: 1, paused: true, completed: false, routeFraction: 0.5, proposalPaused: true })
    })
    expect(captured!.data.restScore).toEqual([{ x: 0, y: 0.2 }, { x: 0.5, y: 0.7 }])
    expect(captured!.data.monotonyScore).toEqual([{ x: 0, y: 0.1 }, { x: 0.5, y: 0.3 }])
    expect(captured!.data.restThreshold).toBe(0.6)
    expect(captured!.data.monotonyThreshold).toBe(0.7)
    expect(captured!.data.fires).toEqual([{ x: 0.5, kind: 'rest' }])
    expect(captured!.data.spikes).toEqual([]) // never available live
    expect(captured!.exactFraction).toBe(0.5)
  })
})
