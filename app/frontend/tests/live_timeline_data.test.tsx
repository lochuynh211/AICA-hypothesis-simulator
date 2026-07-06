import { render, act } from '@testing-library/react'
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

  it('uses NRI normalized rest_required_threshold (0-1), not raw threshold_fire, so the curve is not flattened', async () => {
    // NRI reports the fire threshold on the raw s_total scale (threshold_fire=80)
    // AND normalized to the rest_required_score scale (rest_required_threshold≈0.53).
    // The timeline plots the 0-1 curve, so it must pick the normalized threshold —
    // otherwise the y-domain stretches to ~80 and the 0-1 curve collapses flat.
    const nri = decision(0.14, 0, false)
    nri.scores = { rest_required_score: 0.14 } // no monotony curve (single-curve algo)
    nri.criteria = { threshold_fire: 80, rest_required_threshold: 0.533 }
    render(<RunStoreProvider><Dispatcher /><Probe /></RunStoreProvider>)
    await act(async () => {
      dispatch!({ type: 'RUN_CREATED', runState })
      dispatch!({ type: 'TICK_APPENDED', runState, decision: nri, tickIndex: 0, paused: false, completed: false, routeFraction: 0.1 })
    })
    expect(captured!.data.restThreshold).toBe(0.533)
    expect(captured!.data.restThreshold).toBeLessThanOrEqual(1) // same scale as the curve
  })

  it('sources road bands from the SELECTED alternative route_facts.route_segments (same as the map), by distance fraction', async () => {
    render(<RunStoreProvider><Dispatcher /><Probe /></RunStoreProvider>)
    const envelope = {
      route_source: 'maps' as const,
      alternatives: [
        {
          route_id: 'alt-1',
          summary: 'A',
          display: null,
          notices: [],
          route_facts: {
            total_route_distance_km: 100,
            estimated_route_duration_min: 90,
            rest_spot_positions: [],
            route_progress_checkpoints: [],
            route_segments: [
              { segment_type: 'highway' as const, start_km: 0, length_km: 60 },
              { segment_type: 'normal_road' as const, start_km: 60, length_km: 40 },
            ],
          },
        },
      ],
    }
    await act(async () => {
      dispatch!({ type: 'SET_ALTERNATIVES', envelope })
      dispatch!({ type: 'SELECT_ROUTE', routeId: 'alt-1' })
    })
    // Bands follow the Google route: highway 0–0.6, normal_road 0.6–1.0.
    expect(captured!.data.segments).toEqual([
      { fromX: 0, toX: 0.6, type: 'highway' },
      { fromX: 0.6, toX: 1, type: 'normal_road' },
    ])
  })
})
