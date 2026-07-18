/**
 * mergedCoordinator — isolated Context + useReducer store for the Combined
 * Simulator (020 Task 7).
 *
 * Same Provider/hook pattern as `runStore.ts`/`proposalStore.ts` (Context +
 * useReducer, a Provider + a `use*` hook) but deliberately ISOLATED: this
 * module must not import `runStore` or `proposalStore` (their reducers,
 * actions, or state types) — the merged screen mounts BOTH stores' concerns
 * through this NEW coordinator instead, per the feature-020 isolation
 * constraint (see CLAUDE.md).
 *
 * Unlike `runStore`/`proposalStore` — where the tick loop lives in a
 * component (`PlaybackControls`) that calls the client and dispatches
 * results — the coordinator OWNS the tick loop itself (`play`/`pause`/
 * `step`), because a single merged tick must fold together two payloads
 * (the trigger tick + an optional fire-spawned proposal run) that neither
 * existing store knows how to combine.
 */
import React, { createContext, useContext, useReducer, useRef } from 'react'
import type { TraceEntry } from '../api/types'
import type { ProposalRunLog } from '../api/proposalClient'
import {
  createMergedRun,
  tickMergedRun,
  mergedProposalAction,
  type CreateMergedRunReq,
  type MergedTickResponse,
  type MergedTriggerTick,
  type CorrelationEntry,
} from '../api/mergedClient'

// ── State ──────────────────────────────────────────────────────────────────

export type MergedCoordinatorState = {
  mergedRunId: string | null
  /** Accumulated from each tick's trigger payload — built the same way
   * runStore's TICK_APPENDED builds a TraceEntry, one entry per evaluated
   * tick (a completed no-op tick with `decision: null` is not appended). */
  triggerTrace: TraceEntry[]
  /** The most recent tick's raw trigger payload, verbatim. */
  latestTrigger: MergedTickResponse['trigger'] | null
  /** Set/updated whenever a tick or proposal-action response carries one. */
  proposalLog: ProposalRunLog | null
  /** Every CorrelationEntry seen so far, oldest → newest. */
  correlation: CorrelationEntry[]
  paused: boolean
  completed: boolean
  /** True while `play()`'s loop is actively ticking. */
  running: boolean
  error: string | null
}

export const initialMergedCoordinatorState: MergedCoordinatorState = {
  mergedRunId: null,
  triggerTrace: [],
  latestTrigger: null,
  proposalLog: null,
  correlation: [],
  paused: false,
  completed: false,
  running: false,
  error: null,
}

// ── Actions ────────────────────────────────────────────────────────────────

export type MergedCoordinatorAction =
  | { type: 'CREATED'; mergedRunId: string }
  | { type: 'TICK_APPENDED'; response: MergedTickResponse }
  | { type: 'PROPOSAL_UPDATED'; proposalLog: ProposalRunLog }
  | { type: 'SET_RUNNING'; running: boolean }
  | { type: 'ERROR'; message: string }

/** Builds a TraceEntry from a tick's trigger payload the same way runStore's
 * TICK_APPENDED reducer case does (see state/runStore.ts) — including
 * computing `proposal_paused` from `paused && decision?.proposal != null`
 * rather than reading it off the payload (the merged tick response has no
 * such field, same as the trigger tick endpoint it mirrors). Returns null
 * for a completed no-op tick (`decision`/`tick_index` null), matching
 * PlaybackControls' guard before dispatching TICK_APPENDED. */
function buildTraceEntry(trigger: MergedTriggerTick): TraceEntry | null {
  if (trigger.decision == null || trigger.tick_index == null) return null
  return {
    ...trigger.decision,
    tick_index: trigger.tick_index,
    route_fraction: trigger.route_fraction ?? null,
    motion_state: trigger.motion_state ?? null,
    recovery_phase: trigger.recovery_phase ?? null,
    is_traffic_jam: trigger.is_traffic_jam ?? null,
    segment_type: trigger.segment_type ?? null,
    proposal_paused: trigger.paused && trigger.decision.proposal != null,
  }
}

// ── Reducer ────────────────────────────────────────────────────────────────

export function mergedCoordinatorReducer(
  state: MergedCoordinatorState,
  action: MergedCoordinatorAction,
): MergedCoordinatorState {
  switch (action.type) {
    case 'CREATED':
      // A fresh merged run starts clean — mirrors runStore's RUN_CREATED.
      return { ...initialMergedCoordinatorState, mergedRunId: action.mergedRunId }

    case 'TICK_APPENDED': {
      const { trigger, proposal, correlation } = action.response
      const entry = buildTraceEntry(trigger)
      return {
        ...state,
        latestTrigger: trigger,
        triggerTrace: entry ? [...state.triggerTrace, entry] : state.triggerTrace,
        proposalLog: proposal ?? state.proposalLog,
        correlation: correlation ? [...state.correlation, correlation] : state.correlation,
        paused: trigger.paused,
        completed: trigger.completed,
        // Surface a per-tick algorithm_error without disguising it as a
        // normal decision (CLAUDE.md) — otherwise leave any prior error alone.
        error: trigger.error ? trigger.error.message : state.error,
      }
    }

    case 'PROPOSAL_UPDATED':
      return { ...state, proposalLog: action.proposalLog }

    case 'SET_RUNNING':
      return { ...state, running: action.running }

    case 'ERROR':
      return { ...state, error: action.message, running: false }

    default:
      return state
  }
}

// ── Context ────────────────────────────────────────────────────────────────

type MergedCoordinatorContextValue = {
  state: MergedCoordinatorState
  create(req: CreateMergedRunReq): Promise<void>
  play(): void
  pause(): void
  step(): Promise<void>
  selectService(serviceId: string): Promise<void>
}

const MergedCoordinatorContext = createContext<MergedCoordinatorContextValue | null>(null)

// ── Provider ───────────────────────────────────────────────────────────────

export function MergedCoordinatorProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(mergedCoordinatorReducer, initialMergedCoordinatorState)

  // Refs (not state) so play()'s loop and step() always see the CURRENT
  // merged_run_id / run flag synchronously, without waiting on a re-render.
  const mergedRunIdRef = useRef<string | null>(null)
  const runningRef = useRef(false)

  const create = async (req: CreateMergedRunReq): Promise<void> => {
    try {
      const resp = await createMergedRun(req)
      mergedRunIdRef.current = resp.merged_run_id
      dispatch({ type: 'CREATED', mergedRunId: resp.merged_run_id })
    } catch (err) {
      dispatch({
        type: 'ERROR',
        message: err instanceof Error ? err.message : 'Failed to create merged run',
      })
    }
  }

  const step = async (): Promise<void> => {
    const mergedRunId = mergedRunIdRef.current
    if (!mergedRunId) return
    try {
      const response = await tickMergedRun(mergedRunId)
      dispatch({ type: 'TICK_APPENDED', response })
      // A proposal-pause or completion halts the tick loop — same guard
      // PlaybackControls uses (`!paused && !completed`) to gate its interval.
      if (response.trigger.paused || response.trigger.completed) {
        runningRef.current = false
        dispatch({ type: 'SET_RUNNING', running: false })
      }
    } catch (err) {
      runningRef.current = false
      dispatch({ type: 'ERROR', message: err instanceof Error ? err.message : 'Tick failed' })
    }
  }

  const play = (): void => {
    if (runningRef.current) return
    runningRef.current = true
    dispatch({ type: 'SET_RUNNING', running: true })
    void (async () => {
      while (runningRef.current) {
        await step()
      }
    })()
  }

  const pause = (): void => {
    runningRef.current = false
    dispatch({ type: 'SET_RUNNING', running: false })
  }

  const selectService = async (serviceId: string): Promise<void> => {
    const mergedRunId = mergedRunIdRef.current
    if (!mergedRunId) return
    try {
      const proposalLog = await mergedProposalAction(mergedRunId, {
        kind: 'select_service',
        selected_service_id: serviceId,
      })
      dispatch({ type: 'PROPOSAL_UPDATED', proposalLog })
    } catch (err) {
      dispatch({
        type: 'ERROR',
        message: err instanceof Error ? err.message : 'select_service failed',
      })
    }
  }

  const value: MergedCoordinatorContextValue = { state, create, play, pause, step, selectService }
  return React.createElement(MergedCoordinatorContext.Provider, { value }, children)
}

// ── Hook ───────────────────────────────────────────────────────────────────

export function useMergedCoordinator(): MergedCoordinatorContextValue {
  const ctx = useContext(MergedCoordinatorContext)
  if (!ctx) {
    throw new Error('useMergedCoordinator must be used within a MergedCoordinatorProvider')
  }
  return ctx
}
