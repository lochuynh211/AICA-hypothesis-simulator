/**
 * MergedLogPanel (020 Task 11) — the Combined Simulator's right-panel
 * chronological log: trigger trace entries + proposal events interleaved by
 * correlation tick index, color-coded by subsystem.
 *
 * Rendered inside a REAL `MergedCoordinatorProvider` (the same pattern
 * `merged_coordinator.test.tsx`/`merged_center.test.tsx` use): only the
 * network boundary (`api/mergedClient.ts`) is mocked, so `state.triggerTrace`/
 * `state.proposalLog`/`state.correlation` are populated via the coordinator's
 * real create()/step() — never a stand-in spy shaped like the panel's props.
 */
import { render, screen, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MergedCoordinatorProvider, useMergedCoordinator } from '../src/state/mergedCoordinator'
import type { MergedTickResponse } from '../src/api/mergedClient'
import type { DecisionResult } from '../src/api/types'
import type { ProposalRunLog } from '../src/api/proposalClient'
import MergedLogPanel from '../src/components/merged/MergedLogPanel'

vi.mock('../src/api/mergedClient', () => ({
  createMergedRun: vi.fn(),
  tickMergedRun: vi.fn(),
  mergedProposalAction: vi.fn(),
}))

import { createMergedRun, tickMergedRun } from '../src/api/mergedClient'

// ── fixtures ─────────────────────────────────────────────────────────────

const fireControl = { fired: false, suppressed: false, override: false, reason: null }

const noTriggerDecision: DecisionResult = {
  result_type: 'NO_TRIGGER',
  trigger_candidate: false,
  selected_category: null,
  score: null,
  features: {},
  scores: {},
  states: {},
  criteria: {},
  candidates: [],
  fire_control: fireControl,
  proposal: null,
  reason_inputs: [],
  explanation: 'No trigger',
  next_package_runtime_state: {},
}

const restProposalDecision: DecisionResult = {
  ...noTriggerDecision,
  result_type: 'REST_PROPOSAL',
  trigger_candidate: true,
  selected_category: 'rest_required',
  score: 3.2,
  fire_control: { fired: true, suppressed: false, override: false, reason: null },
  proposal: { id: 'rest_guidance', message: { ja: '休憩', en: 'Rest' }, options: ['accept_rest', 'postpone'] },
  explanation: 'Rest recommended',
}

function baseProposalLog(overrides: Partial<ProposalRunLog> = {}): ProposalRunLog {
  return {
    run_id: 'prun_20260718-000000_abcdef',
    created_at: '2026-07-18T00:00:00Z',
    opportunity: {
      opportunity_id: 'op_1',
      trigger_purpose: 'rest_recommended',
      lifecycle_stage: 'before_rest_until_stop',
      allowed_service_ids: ['music_playlist'],
      simulation_time: 1,
      run_seed: '7',
    },
    matrix_version: 'v1',
    world_snapshot: {},
    service_package_id: 'mock_service_selector_v1',
    content_package_id: 'mock_content_selector_v1',
    parameters: {},
    hyperparameters: {},
    journey_state: {
      lifecycle_stage: 'before_rest_until_stop',
      motion_state: 'stopped',
      active_service_id: null,
      active_plan_id: null,
    },
    events: [],
    evidence: [],
    status: 'created',
    ...overrides,
  } as unknown as ProposalRunLog
}

function noProposalTick(tickIndex: number): MergedTickResponse {
  return {
    trigger: {
      decision: noTriggerDecision,
      error: null,
      paused: false,
      completed: false,
      tick_index: tickIndex,
      route_fraction: tickIndex / 100,
      distance_km: null,
      speed_kph: 80,
      motion_state: 'MOVING',
      recovery_phase: null,
      is_traffic_jam: false,
      segment_type: 'highway',
    },
    proposal: null,
    correlation: null,
  }
}

function firedTickWithEvents(tickIndex: number): MergedTickResponse {
  return {
    trigger: {
      decision: restProposalDecision,
      error: null,
      paused: true,
      completed: false,
      tick_index: tickIndex,
      route_fraction: tickIndex / 100,
      distance_km: null,
      speed_kph: 0,
      motion_state: 'STOPPED',
      recovery_phase: null,
      is_traffic_jam: false,
      segment_type: 'highway',
    },
    proposal: baseProposalLog({
      status: 'service_selected',
      events: [
        {
          event_type: 'OPPORTUNITY_OPENED',
          at: '2026-07-18T00:00:01Z',
          payload: {
            opportunity_id: 'op_1',
            trigger_purpose: 'rest_recommended',
            lifecycle_stage: 'before_rest_until_stop',
          },
        },
        {
          event_type: 'SERVICE_SELECTED',
          at: '2026-07-18T00:00:02Z',
          payload: { selected_service_id: 'music_playlist', rank: 1 },
        },
      ],
    }),
    correlation: {
      trigger_tick_index: tickIndex,
      proposal_run_id: 'prun_20260718-000000_abcdef',
      proposal_event_ids: ['OPPORTUNITY_OPENED@2026-07-18T00:00:01Z', 'SERVICE_SELECTED@2026-07-18T00:00:02Z'],
    },
  }
}

/** A trigger-only tick carrying a `recovery_phase` (no proposal payload) — the
 * driver is mid-recovery; the trigger keeps ticking through the recovery
 * engine's phases while the paired proposal run (if any) is untouched. */
function recoveryPhaseTick(tickIndex: number, phase: string): MergedTickResponse {
  return {
    trigger: {
      decision: restProposalDecision,
      error: null,
      paused: true,
      completed: false,
      tick_index: tickIndex,
      route_fraction: tickIndex / 100,
      distance_km: null,
      speed_kph: 0,
      motion_state: 'STOPPED',
      recovery_phase: phase,
      is_traffic_jam: false,
      segment_type: 'highway',
    },
    proposal: null,
    correlation: null,
  }
}

/** A tick whose paired proposal run has advanced through the whole
 * rest-journey (arrive → nap → recover → after-rest recompute) — Task 3's
 * server-side orchestrator folds all of this into the proposal log the
 * frontend receives, so a single tick carrying all four events is a faithful
 * fixture for this panel's rendering concern. */
function restJourneyTick(tickIndex: number): MergedTickResponse {
  return {
    trigger: {
      decision: restProposalDecision,
      error: null,
      paused: true,
      completed: false,
      tick_index: tickIndex,
      route_fraction: tickIndex / 100,
      distance_km: null,
      speed_kph: 0,
      motion_state: 'STOPPED',
      recovery_phase: 'resuming',
      is_traffic_jam: false,
      segment_type: 'highway',
    },
    proposal: baseProposalLog({
      status: 'content_completed',
      journey_state: {
        lifecycle_stage: 'after_rest_before_restart',
        motion_state: 'stopped',
        active_service_id: null,
        active_plan_id: null,
      },
      events: [
        { event_type: 'REST_SPOT_ARRIVED', at: '2026-07-18T00:01:00Z', payload: {} },
        { event_type: 'REST_STARTED', at: '2026-07-18T00:02:00Z', payload: {} },
        {
          event_type: 'REST_COMPLETED',
          at: '2026-07-18T00:20:00Z',
          payload: { drowsiness_level: 10, fatigue_level: 15 },
        },
        {
          event_type: 'RECOMPUTED',
          at: '2026-07-18T00:20:01Z',
          payload: { from_opportunity_id: 'op_1', to_opportunity_id: 'op_2' },
        },
      ],
    }),
    correlation: {
      trigger_tick_index: tickIndex,
      proposal_run_id: 'prun_20260718-000000_abcdef',
      proposal_event_ids: [
        'REST_SPOT_ARRIVED@2026-07-18T00:01:00Z',
        'REST_STARTED@2026-07-18T00:02:00Z',
        'REST_COMPLETED@2026-07-18T00:20:00Z',
        'RECOMPUTED@2026-07-18T00:20:01Z',
      ],
    },
  }
}

/** A single-tick fixture whose `OPPORTUNITY_OPENED` event carries the
 * monotony/inattentive-driving trigger purpose (Task 3 of Slice 3) — used to
 * verify the merged log prints a friendly bilingual label rather than the
 * raw `trigger_purpose` enum value. */
function inattentiveOpportunityTick(tickIndex: number): MergedTickResponse {
  return {
    trigger: {
      decision: restProposalDecision,
      error: null,
      paused: true,
      completed: false,
      tick_index: tickIndex,
      route_fraction: tickIndex / 100,
      distance_km: null,
      speed_kph: 0,
      motion_state: 'STOPPED',
      recovery_phase: null,
      is_traffic_jam: false,
      segment_type: 'highway',
    },
    proposal: baseProposalLog({
      opportunity: {
        opportunity_id: 'op_2',
        trigger_purpose: 'inattentive_driving_prevention_recovery',
        lifecycle_stage: 'before_rest_until_stop',
        allowed_service_ids: ['music_playlist'],
        simulation_time: 1,
        run_seed: '7',
      },
      status: 'created',
      events: [
        {
          event_type: 'OPPORTUNITY_OPENED',
          at: '2026-07-18T00:00:01Z',
          payload: {
            opportunity_id: 'op_2',
            trigger_purpose: 'inattentive_driving_prevention_recovery',
            lifecycle_stage: 'before_rest_until_stop',
          },
        },
      ],
    }),
    correlation: {
      trigger_tick_index: tickIndex,
      proposal_run_id: 'prun_20260718-000000_abcdef',
      proposal_event_ids: ['OPPORTUNITY_OPENED@2026-07-18T00:00:01Z'],
    },
  }
}

/** Same `Capture` pattern as `merged_center.test.tsx`'s `renderCenterPanel`. */
function renderLogPanel() {
  const coordinatorRef: { current: ReturnType<typeof useMergedCoordinator> | null } = { current: null }

  function Capture() {
    coordinatorRef.current = useMergedCoordinator()
    return null
  }

  const utils = render(
    <MergedCoordinatorProvider>
      <Capture />
      <MergedLogPanel />
    </MergedCoordinatorProvider>,
  )

  return { coordinatorRef, ...utils }
}

describe('MergedLogPanel', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('interleaves trigger trace rows and purple proposal rows by correlation tick index', async () => {
    vi.mocked(createMergedRun).mockResolvedValue({ merged_run_id: 'mrun_1', trigger_run_id: 'run_1' })
    vi.mocked(tickMergedRun)
      .mockResolvedValueOnce(noProposalTick(0))
      .mockResolvedValueOnce(firedTickWithEvents(1))

    const { coordinatorRef, container } = renderLogPanel()

    await act(async () => {
      await coordinatorRef.current!.create({
        trigger_plan_id: 'plan_1',
        world: {} as never,
        service_package_id: 'mock_service_selector_v1',
        content_package_id: 'mock_content_selector_v1',
        run_seed: '7',
      })
    })
    await act(async () => {
      await coordinatorRef.current!.step()
    })
    await act(async () => {
      await coordinatorRef.current!.step()
    })

    // Trigger rows for both trace ticks.
    expect(screen.getByTestId('merged-log-trigger-0')).toBeInTheDocument()
    expect(screen.getByTestId('merged-log-trigger-1')).toBeInTheDocument()

    // Purple proposal rows for both events, correlated to tick 1.
    const opportunityLabel = screen.getByText('OPPORTUNITY_OPENED')
    const serviceLabel = screen.getByText('SERVICE_SELECTED')
    expect(opportunityLabel).toHaveStyle({ color: '#7c3aed' })
    expect(serviceLabel).toHaveStyle({ color: '#7c3aed' })

    const opportunityRow = opportunityLabel.closest('[data-testid^="merged-log-proposal-"]')
    const serviceRow = serviceLabel.closest('[data-testid^="merged-log-proposal-"]')
    expect(opportunityRow).toHaveTextContent('tick#1')
    expect(serviceRow).toHaveTextContent('tick#1')
    expect(serviceRow).toHaveTextContent('music_playlist')

    // Ordering: the SERVICE_SELECTED row appears after the tick-1 trigger row.
    const rows = Array.from(container.querySelectorAll('[data-testid^="merged-log-"]')).map((el) =>
      el.getAttribute('data-testid'),
    )
    const triggerIdx = rows.indexOf('merged-log-trigger-1')
    const serviceIdx = rows.findIndex((id) => id?.includes('SERVICE_SELECTED'))
    expect(triggerIdx).toBeGreaterThanOrEqual(0)
    expect(serviceIdx).toBeGreaterThan(triggerIdx)
  })

  it('labels the rest-journey proposal events and surfaces recovery phase on trigger rows, in tick order', async () => {
    vi.mocked(createMergedRun).mockResolvedValue({ merged_run_id: 'mrun_1', trigger_run_id: 'run_1' })
    vi.mocked(tickMergedRun)
      .mockResolvedValueOnce(noProposalTick(0))
      .mockResolvedValueOnce(recoveryPhaseTick(1, 'arriving'))
      .mockResolvedValueOnce(recoveryPhaseTick(2, 'nap'))
      .mockResolvedValueOnce(restJourneyTick(3))

    const { coordinatorRef, container } = renderLogPanel()

    await act(async () => {
      await coordinatorRef.current!.create({
        trigger_plan_id: 'plan_1',
        world: {} as never,
        service_package_id: 'mock_service_selector_v1',
        content_package_id: 'mock_content_selector_v1',
        run_seed: '7',
      })
    })
    for (let i = 0; i < 4; i++) {
      await act(async () => {
        await coordinatorRef.current!.step()
      })
    }

    // Recovery phase surfaced on the relevant trigger rows (bilingual label,
    // English resolved here). Tick 0 had no recovery_phase -> no such row.
    expect(screen.getByTestId('merged-log-recovery-phase-1')).toHaveTextContent('Arriving at rest spot')
    expect(screen.getByTestId('merged-log-recovery-phase-2')).toHaveTextContent('Resting (nap)')
    expect(screen.getByTestId('merged-log-recovery-phase-3')).toHaveTextContent('Resuming drive')
    expect(screen.queryByTestId('merged-log-recovery-phase-0')).not.toBeInTheDocument()

    // Rest-journey proposal rows: clear labels, purple proposal accent,
    // correlated to tick 3.
    const arrivedLabel = screen.getByText('Arrived at rest spot')
    const startedLabel = screen.getByText('Rest started')
    const completedLabel = screen.getByText('Rest completed')
    const recomputedLabel = screen.getByText('Recomputed after rest')
    for (const label of [arrivedLabel, startedLabel, completedLabel, recomputedLabel]) {
      expect(label).toHaveStyle({ color: '#7c3aed' })
    }
    expect(arrivedLabel.closest('[data-testid^="merged-log-proposal-"]')).toHaveTextContent('tick#3')
    expect(recomputedLabel.closest('[data-testid^="merged-log-proposal-"]')).toHaveTextContent('tick#3')

    // Tick order: trigger-3 row (carrying the 'resuming' phase), THEN the
    // four rest-journey rows in their original event order.
    const rows = Array.from(container.querySelectorAll('[data-testid^="merged-log-"]')).map((el) =>
      el.getAttribute('data-testid'),
    )
    const trigger3Idx = rows.indexOf('merged-log-trigger-3')
    const arrivedIdx = rows.findIndex((id) => id?.includes('REST_SPOT_ARRIVED'))
    const startedIdx = rows.findIndex((id) => id?.includes('REST_STARTED'))
    const completedIdx = rows.findIndex((id) => id?.includes('REST_COMPLETED'))
    const recomputedIdx = rows.findIndex((id) => id?.includes('RECOMPUTED'))
    expect(trigger3Idx).toBeGreaterThanOrEqual(0)
    expect(arrivedIdx).toBeGreaterThan(trigger3Idx)
    expect(startedIdx).toBeGreaterThan(arrivedIdx)
    expect(completedIdx).toBeGreaterThan(startedIdx)
    expect(recomputedIdx).toBeGreaterThan(completedIdx)

    // Recovery-phase rows themselves stay in ascending tick order (1 < 2 < 3).
    const phase1Idx = rows.indexOf('merged-log-recovery-phase-1')
    const phase2Idx = rows.indexOf('merged-log-recovery-phase-2')
    const phase3Idx = rows.indexOf('merged-log-recovery-phase-3')
    expect(phase1Idx).toBeLessThan(phase2Idx)
    expect(phase2Idx).toBeLessThan(phase3Idx)
  })

  it('shows a friendly bilingual trigger-purpose label for OPPORTUNITY_OPENED, not the raw enum (Slice 3 Task 3)', async () => {
    vi.mocked(createMergedRun).mockResolvedValue({ merged_run_id: 'mrun_1', trigger_run_id: 'run_1' })
    vi.mocked(tickMergedRun).mockResolvedValueOnce(inattentiveOpportunityTick(0))

    const { coordinatorRef } = renderLogPanel()

    await act(async () => {
      await coordinatorRef.current!.create({
        trigger_plan_id: 'plan_1',
        world: {} as never,
        service_package_id: 'mock_service_selector_v1',
        content_package_id: 'mock_content_selector_v1',
        run_seed: '7',
      })
    })
    await act(async () => {
      await coordinatorRef.current!.step()
    })

    // Friendly label present; raw enum string is not rendered anywhere.
    expect(screen.getByText('Inattentive driving prevention & recovery')).toBeInTheDocument()
    expect(screen.queryByText('inattentive_driving_prevention_recovery')).not.toBeInTheDocument()
  })
})
