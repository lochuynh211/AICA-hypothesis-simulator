/**
 * S7: Visual scrubbable replay (M6 T010, T011)
 * TDD — tests written before implementation (RED first).
 *
 * T010 — replaySource (pure projector):
 *   - getAt(N) returns recorded state at tick N (tick_state, decision, route_fraction)
 *   - getAt(missing index) returns null safely
 *   - range: minIndex, maxIndex, tickCount correct
 *   - route_fraction from event_plan.ticks[N].route_fraction
 *
 * T011 — ReplayViewer + source abstraction + scrubber:
 *   - ReplayViewer renders data-testid="replay-controls" and panels from recorded RunLog
 *   - Initial tick shows tick-0 recorded result_type
 *   - Moving scrubber to tick-2 shows tick-2 recorded result_type
 *   - tickRun NOT called during replay
 *   - createRun NOT called during replay
 *   - CockpitView with replayTick prop renders replay-cockpit-view (not nav-view)
 *   - CockpitView without replayTick prop uses live store (unchanged)
 *   - RouteTimeline with replayTick renders car at recorded route_fraction
 *   - DecisionTracePanel with replayTick renders data-testid="replay-decision-trace"
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { RunStoreProvider } from '../src/state/runStore'
import type { RunLog, DecisionResult } from '../src/api/types'

// ── Mock the client module ─────────────────────────────────────────────────────

vi.mock('../src/api/client', () => ({
  listPackages: vi.fn(),
  listScenarios: vi.fn(),
  createRun: vi.fn(),
  createRunPlan: vi.fn(),
  regenerateRunPlan: vi.fn(),
  routesAnalyze: vi.fn(),
  actRun: vi.fn(),
  tickRun: vi.fn(),
  getPackage: vi.fn(),
  getScenario: vi.fn(),
  listRuns: vi.fn(),
  getRun: vi.fn(),
  getRunLog: vi.fn(),
  getEvidence: vi.fn(),
  getHealth: vi.fn(),
  getFeedbackSchema: vi.fn(),
  submitFeedback: vi.fn(),
}))

import * as client from '../src/api/client'

// ── New files (don't exist yet — causes RED) ───────────────────────────────────
import { createReplaySource, type ReplayTick } from '../src/replay/replaySource'
import ReplayViewer from '../src/components/replay/ReplayViewer'

// ── Existing components (gaining new replayTick prop) ─────────────────────────
import CockpitView from '../src/components/playback/CockpitView'
import RouteTimeline from '../src/components/playback/RouteTimeline'
import DecisionTracePanel from '../src/components/trace/DecisionTracePanel'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const noFireControl = { fired: false, suppressed: false, override: false, reason: null }

const sampleDecision0: DecisionResult = {
  result_type: 'NO_TRIGGER',
  trigger_candidate: false,
  selected_category: null,
  score: null,
  features: { drowsiness_level: 'none' },
  scores: {},
  states: {},
  criteria: {},
  candidates: [],
  fire_control: noFireControl,
  proposal: null,
  reason_inputs: [],
  explanation: 'No trigger at tick 0',
  next_package_runtime_state: {},
}

const sampleDecision2: DecisionResult = {
  result_type: 'REST_PROPOSAL',
  trigger_candidate: true,
  selected_category: 'rest_required',
  score: 0.85,
  features: { drowsiness_level: 'moderate' },
  scores: {},
  states: {},
  criteria: {},
  candidates: [],
  fire_control: { fired: true, suppressed: false, override: false, reason: null },
  proposal: {
    id: 'rest_guidance',
    message: { ja: '休憩してください', en: 'Please rest' },
    options: ['accept_rest', 'postpone'],
  },
  reason_inputs: ['drowsiness: moderate'],
  explanation: { ja: '眠気が閾値を超えました', en: 'Drowsiness exceeded threshold' },
  next_package_runtime_state: {},
}

const sampleRunLog: RunLog = {
  run_id: 'replay-test-001',
  created_at: '2026-01-01T00:00:00Z',
  simulator_version: '0.1.0',
  snapshot: {
    package: { id: 'pkg1', version: '0.1.0', hash: 'abc' },
    scenario: { id: 'scen1', version: '0.1.0', hash: 'def' },
  },
  route_facts: {},
  event_plan: {
    ticks: [
      { tick_index: 0, route_fraction: 0.0 },
      { tick_index: 1, route_fraction: 0.1 }, // no tick event for index 1
      { tick_index: 2, route_fraction: 0.3 },
    ],
  },
  run_mode: 'standard',
  evidence_status: 'standard',
  events: [
    {
      kind: 'tick' as const,
      tick_index: 0,
      tick_state: { drowsiness_band: 'none' },
      trace: { tick_index: 0, decision_result: sampleDecision0 },
    },
    {
      kind: 'tick' as const,
      tick_index: 2,
      tick_state: { drowsiness_band: 'moderate' },
      trace: { tick_index: 2, decision_result: sampleDecision2 },
    },
  ],
}

// ── T010 — replaySource pure unit tests ────────────────────────────────────────

describe('T010 — replaySource (pure projector)', () => {
  it('getAt(0) returns the recorded state for tick 0', () => {
    const src = createReplaySource(sampleRunLog)
    const tick = src.getAt(0)
    expect(tick).not.toBeNull()
    expect(tick!.tick_index).toBe(0)
    expect(tick!.decision.result_type).toBe('NO_TRIGGER')
    expect(tick!.tick_state).toEqual({ drowsiness_band: 'none' })
    expect(tick!.route_fraction).toBe(0.0)
  })

  it('getAt(2) returns the recorded state for tick 2', () => {
    const src = createReplaySource(sampleRunLog)
    const tick = src.getAt(2)
    expect(tick).not.toBeNull()
    expect(tick!.tick_index).toBe(2)
    expect(tick!.decision.result_type).toBe('REST_PROPOSAL')
    expect(tick!.route_fraction).toBe(0.3)
  })

  it('getAt(1) returns null for tick 1 (no event at index 1 — non-contiguous)', () => {
    const src = createReplaySource(sampleRunLog)
    expect(src.getAt(1)).toBeNull()
  })

  it('getAt(-1) returns null (below range)', () => {
    const src = createReplaySource(sampleRunLog)
    expect(src.getAt(-1)).toBeNull()
  })

  it('getAt(999) returns null (above range)', () => {
    const src = createReplaySource(sampleRunLog)
    expect(src.getAt(999)).toBeNull()
  })

  it('range properties: minIndex=0, maxIndex=2, tickCount=2', () => {
    const src = createReplaySource(sampleRunLog)
    expect(src.minIndex).toBe(0)
    expect(src.maxIndex).toBe(2)
    expect(src.tickCount).toBe(2)
  })

  it('route_fraction comes from event_plan.ticks[N].route_fraction', () => {
    const src = createReplaySource(sampleRunLog)
    expect(src.getAt(0)!.route_fraction).toBe(0.0)
    expect(src.getAt(2)!.route_fraction).toBe(0.3)
  })

  it('empty log returns tickCount=0 and getAt(0)=null', () => {
    const emptyLog: RunLog = { ...sampleRunLog, events: [] }
    const src = createReplaySource(emptyLog)
    expect(src.tickCount).toBe(0)
    expect(src.getAt(0)).toBeNull()
  })
})

// ── T011 — ReplayViewer integration ───────────────────────────────────────────

describe('T011 — ReplayViewer (source abstraction + scrubber)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(client.getRunLog).mockResolvedValue(sampleRunLog)
    vi.mocked(client.tickRun).mockResolvedValue(undefined as never)
    vi.mocked(client.createRun).mockResolvedValue(undefined as never)
  })

  it('renders data-testid="replay-viewer"', async () => {
    render(
      <RunStoreProvider>
        <ReplayViewer runId="replay-test-001" />
      </RunStoreProvider>,
    )
    expect(await screen.findByTestId('replay-viewer')).toBeInTheDocument()
  })

  it('renders data-testid="replay-controls" after log loads', async () => {
    render(
      <RunStoreProvider>
        <ReplayViewer runId="replay-test-001" />
      </RunStoreProvider>,
    )
    await waitFor(() => {
      expect(screen.getByTestId('replay-controls')).toBeInTheDocument()
    })
  })

  it('shows tick-0 result_type initially (NO_TRIGGER)', async () => {
    render(
      <RunStoreProvider>
        <ReplayViewer runId="replay-test-001" />
      </RunStoreProvider>,
    )
    await waitFor(() => {
      expect(screen.getByTestId('replay-result-type')).toHaveTextContent('NO_TRIGGER')
    })
  })

  it('moving the scrubber to tick-2 shows REST_PROPOSAL result_type', async () => {
    render(
      <RunStoreProvider>
        <ReplayViewer runId="replay-test-001" />
      </RunStoreProvider>,
    )
    await waitFor(() => {
      expect(screen.getByTestId('replay-scrubber')).toBeInTheDocument()
    })
    fireEvent.change(screen.getByTestId('replay-scrubber'), { target: { value: '2' } })
    await waitFor(() => {
      expect(screen.getByTestId('replay-result-type')).toHaveTextContent('REST_PROPOSAL')
    })
  })

  it('tickRun is NOT called during replay — pure projection, no engine call', async () => {
    render(
      <RunStoreProvider>
        <ReplayViewer runId="replay-test-001" />
      </RunStoreProvider>,
    )
    await waitFor(() => {
      expect(screen.getByTestId('replay-controls')).toBeInTheDocument()
    })
    // Scrub through ticks
    fireEvent.change(screen.getByTestId('replay-scrubber'), { target: { value: '2' } })
    fireEvent.change(screen.getByTestId('replay-scrubber'), { target: { value: '0' } })
    expect(client.tickRun).not.toHaveBeenCalled()
  })

  it('createRun is NOT called during replay', async () => {
    render(
      <RunStoreProvider>
        <ReplayViewer runId="replay-test-001" />
      </RunStoreProvider>,
    )
    await waitFor(() => {
      expect(screen.getByTestId('replay-controls')).toBeInTheDocument()
    })
    expect(client.createRun).not.toHaveBeenCalled()
  })

  it('getRunLog is called with the given runId (reuses existing endpoint, no new endpoint)', async () => {
    render(
      <RunStoreProvider>
        <ReplayViewer runId="replay-test-001" />
      </RunStoreProvider>,
    )
    await waitFor(() => {
      expect(client.getRunLog).toHaveBeenCalledWith('replay-test-001')
    })
  })

  it('car-marker position reflects recorded route_fraction at tick-0 (0%)', async () => {
    render(
      <RunStoreProvider>
        <ReplayViewer runId="replay-test-001" />
      </RunStoreProvider>,
    )
    await waitFor(() => {
      expect(screen.getByTestId('car-marker')).toBeInTheDocument()
    })
    expect(screen.getByTestId('car-marker')).toHaveAttribute('aria-label', 'Route position: 0%')
  })

  it('car-marker position changes to 30% after scrubbing to tick-2', async () => {
    render(
      <RunStoreProvider>
        <ReplayViewer runId="replay-test-001" />
      </RunStoreProvider>,
    )
    await waitFor(() => {
      expect(screen.getByTestId('replay-scrubber')).toBeInTheDocument()
    })
    fireEvent.change(screen.getByTestId('replay-scrubber'), { target: { value: '2' } })
    await waitFor(() => {
      expect(screen.getByTestId('car-marker')).toHaveAttribute('aria-label', 'Route position: 30%')
    })
  })

  it('replay-decision-trace shows the decision at the current tick', async () => {
    render(
      <RunStoreProvider>
        <ReplayViewer runId="replay-test-001" />
      </RunStoreProvider>,
    )
    await waitFor(() => {
      expect(screen.getByTestId('replay-decision-trace')).toBeInTheDocument()
    })
  })

  it('scrubbing to a gap tick (tick 1) shows replay-no-tick placeholder and hides panels', async () => {
    render(
      <RunStoreProvider>
        <ReplayViewer runId="replay-test-001" />
      </RunStoreProvider>,
    )
    await waitFor(() => {
      expect(screen.getByTestId('replay-scrubber')).toBeInTheDocument()
    })
    // tick 1 has no event in sampleRunLog (gap between 0 and 2)
    fireEvent.change(screen.getByTestId('replay-scrubber'), { target: { value: '1' } })
    await waitFor(() => {
      expect(screen.getByTestId('replay-no-tick')).toBeInTheDocument()
    })
    // live-default panels must NOT mount for a gap tick
    expect(screen.queryByTestId('car-marker')).not.toBeInTheDocument()
    expect(screen.queryByTestId('nav-view')).not.toBeInTheDocument()
  })

  it('scrubbing from a gap tick (1) to tick 2 recovers recorded tick-2 data', async () => {
    render(
      <RunStoreProvider>
        <ReplayViewer runId="replay-test-001" />
      </RunStoreProvider>,
    )
    await waitFor(() => {
      expect(screen.getByTestId('replay-scrubber')).toBeInTheDocument()
    })
    // go to gap
    fireEvent.change(screen.getByTestId('replay-scrubber'), { target: { value: '1' } })
    await waitFor(() => {
      expect(screen.getByTestId('replay-no-tick')).toBeInTheDocument()
    })
    // move to tick 2 — recorded data should reappear
    fireEvent.change(screen.getByTestId('replay-scrubber'), { target: { value: '2' } })
    await waitFor(() => {
      expect(screen.queryByTestId('replay-no-tick')).not.toBeInTheDocument()
      expect(screen.getByTestId('car-marker')).toHaveAttribute('aria-label', 'Route position: 30%')
    })
  })
})

// ── Source abstraction — panels accept replayTick prop ─────────────────────────

describe('source abstraction — panels accept replayTick prop', () => {
  const replayTickAt0: ReplayTick = {
    tick_index: 0,
    tick_state: { drowsiness_band: 'none' },
    raw_state: {},
    decision: sampleDecision0,
    route_fraction: 0.0,
  }

  it('CockpitView with replayTick renders replay-cockpit-view (not nav-view)', () => {
    render(
      <RunStoreProvider>
        <CockpitView replayTick={replayTickAt0} />
      </RunStoreProvider>,
    )
    expect(screen.getByTestId('replay-cockpit-view')).toBeInTheDocument()
    expect(screen.queryByTestId('nav-view')).not.toBeInTheDocument()
  })

  it('CockpitView with replayTick shows the recorded result_type', () => {
    render(
      <RunStoreProvider>
        <CockpitView replayTick={replayTickAt0} />
      </RunStoreProvider>,
    )
    expect(screen.getByTestId('replay-result-type')).toHaveTextContent('NO_TRIGGER')
  })

  it('CockpitView WITHOUT replayTick renders nav-view (live mode unchanged)', () => {
    render(
      <RunStoreProvider>
        <CockpitView />
      </RunStoreProvider>,
    )
    expect(screen.getByTestId('nav-view')).toBeInTheDocument()
    expect(screen.queryByTestId('replay-cockpit-view')).not.toBeInTheDocument()
  })

  it('RouteTimeline with replayTick renders car-marker at recorded route_fraction (0%)', () => {
    render(
      <RunStoreProvider>
        <RouteTimeline replayTick={replayTickAt0} />
      </RunStoreProvider>,
    )
    expect(screen.getByTestId('car-marker')).toHaveAttribute('aria-label', 'Route position: 0%')
  })

  it('RouteTimeline WITHOUT replayTick renders normally from store (live mode unchanged)', () => {
    render(
      <RunStoreProvider>
        <RouteTimeline />
      </RunStoreProvider>,
    )
    expect(screen.getByTestId('car-marker')).toBeInTheDocument()
  })

  it('DecisionTracePanel with replayTick renders replay-decision-trace (not live trace)', () => {
    render(
      <RunStoreProvider>
        <DecisionTracePanel replayTick={replayTickAt0} />
      </RunStoreProvider>,
    )
    expect(screen.getByTestId('replay-decision-trace')).toBeInTheDocument()
  })
})
