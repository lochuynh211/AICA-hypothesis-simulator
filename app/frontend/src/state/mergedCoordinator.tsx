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
  acceptRest as acceptRestClient,
  mergedQuickview,
  type CreateMergedRunReq,
  type MergedTickResponse,
  type MergedTriggerTick,
  type CorrelationEntry,
  type AcceptRestReq,
  type MergedQuickviewReq,
  type MergedInstantResult,
} from '../api/mergedClient'

// ── State ──────────────────────────────────────────────────────────────────

export type MergedCoordinatorState = {
  mergedRunId: string | null
  /** The paired trigger run id (from `create()`'s response) — needed by
   * `MergedCenterPanel`'s rest-accept affordance to fetch candidate rest
   * spots via `getRestSpots(triggerRunId, ...)` (slice-2 core Task 4), the
   * SAME client `RecoveryPicker` uses for the trigger-only screen. */
  triggerRunId: string | null
  /** The scenario catalog id the run was created from, when the caller
   * supplies one to `create()` — needed to fetch `recovery_options` via
   * `getScenario(scenarioId)` (same client `RecoveryPicker` uses). `null`
   * when the caller doesn't pass one (existing callers/tests are
   * unaffected — the rest-accept affordance simply stays unable to load
   * recovery options until a scenarioId is available). */
  scenarioId: string | null
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
  /** The service candidate id currently being selected, or null when no
   * `selectService()` call is in flight — mirrors `ServiceProposalPanel`'s
   * local `choosingId` state, but lives in the coordinator here since
   * `selectService()` itself lives on the coordinator. Drives the
   * Choose-button busy/disabled affordance in `ServiceResultOverlay` and
   * doubles as the double-submit guard's visible state. */
  choosingId: string | null
  error: string | null
  /** The most recent `mergedQuickview()` projection (feature 020, Slice-2c
   * Task 5) — an ephemeral, non-persisting whole-chain preview, independent
   * of `mergedRunId`/the tick loop (callable before, instead of, or alongside
   * a real run). `null` until `quickview()` is called. */
  quickviewResult: MergedInstantResult | null
  /** Index into `quickviewResult.fires` the reviewer clicked to inspect, or
   * `null` when nothing is being inspected. Set by `inspectFire()`. */
  inspectedFireIndex: number | null
}

export const initialMergedCoordinatorState: MergedCoordinatorState = {
  mergedRunId: null,
  triggerRunId: null,
  scenarioId: null,
  triggerTrace: [],
  latestTrigger: null,
  proposalLog: null,
  correlation: [],
  paused: false,
  completed: false,
  running: false,
  choosingId: null,
  error: null,
  quickviewResult: null,
  inspectedFireIndex: null,
}

// ── Actions ────────────────────────────────────────────────────────────────

export type MergedCoordinatorAction =
  | { type: 'CREATED'; mergedRunId: string; triggerRunId: string; scenarioId: string | null }
  | { type: 'TICK_APPENDED'; response: MergedTickResponse }
  | { type: 'PROPOSAL_UPDATED'; proposalLog: ProposalRunLog }
  | { type: 'SET_RUNNING'; running: boolean }
  | { type: 'SET_CHOOSING'; serviceId: string | null }
  | { type: 'ERROR'; message: string }
  | { type: 'QUICKVIEW_LOADED'; result: MergedInstantResult }
  | { type: 'INSPECT_FIRE'; index: number | null }

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
      return {
        ...initialMergedCoordinatorState,
        mergedRunId: action.mergedRunId,
        triggerRunId: action.triggerRunId,
        scenarioId: action.scenarioId,
      }

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
        // Surface a per-tick algorithm_error, OR a synchronous
        // create_proposal_run failure during this tick's fire
        // (`trigger.proposal_error` — set by merged_runs.py when the fire
        // itself succeeds but spawning the proposal run threw), without
        // disguising the trigger tick as failed (CLAUDE.md: failures are
        // never disguised/silently swallowed) — otherwise leave any prior
        // error alone.
        error: trigger.proposal_error
          ? trigger.proposal_error
          : trigger.error
            ? trigger.error.message
            : state.error,
      }
    }

    case 'PROPOSAL_UPDATED':
      return { ...state, proposalLog: action.proposalLog }

    case 'SET_RUNNING':
      // Starting the live tick loop invalidates any fire currently being
      // inspected from a (pre-run/paused) quickview projection — otherwise a
      // stale ephemeral read-only overlay could keep masking the live dock
      // across a later pause. `quickviewResult` itself is left alone (only
      // the strip's visibility, gated on `!running` elsewhere, hides it).
      return {
        ...state,
        running: action.running,
        inspectedFireIndex: action.running ? null : state.inspectedFireIndex,
      }

    case 'SET_CHOOSING':
      return { ...state, choosingId: action.serviceId }

    case 'ERROR':
      return { ...state, error: action.message, running: false }

    case 'QUICKVIEW_LOADED':
      // A fresh projection invalidates any previously-inspected fire index
      // (it indexed into the PRIOR quickviewResult.fires, which this replaces).
      return { ...state, quickviewResult: action.result, inspectedFireIndex: null }

    case 'INSPECT_FIRE':
      return { ...state, inspectedFireIndex: action.index }

    default:
      return state
  }
}

// ── Context ────────────────────────────────────────────────────────────────

type MergedCoordinatorContextValue = {
  state: MergedCoordinatorState
  /** `scenarioId` is OPTIONAL local bookkeeping only — never sent over the
   * wire (the `POST /api/merged-runs` body is `req`, untouched) — so every
   * existing caller that omits it keeps working unchanged. */
  create(req: CreateMergedRunReq, scenarioId?: string): Promise<void>
  play(): void
  pause(): void
  step(): Promise<void>
  selectService(serviceId: string): Promise<void>
  acceptRest(body: AcceptRestReq): Promise<void>
  /** Ephemeral whole-chain projection (feature 020, Slice-2c Task 5) —
   * populates `state.quickviewResult`; independent of `create()`/the tick
   * loop, so it may be called before, instead of, or alongside a real run. */
  quickview(body: MergedQuickviewReq): Promise<void>
  /** Sets `state.inspectedFireIndex` — `null` clears the inspected fire. */
  inspectFire(index: number | null): void
}

const MergedCoordinatorContext = createContext<MergedCoordinatorContextValue | null>(null)

// ── Provider ───────────────────────────────────────────────────────────────

export function MergedCoordinatorProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(mergedCoordinatorReducer, initialMergedCoordinatorState)

  // Refs (not state) so play()'s loop and step() always see the CURRENT
  // merged_run_id / run flag synchronously, without waiting on a re-render.
  const mergedRunIdRef = useRef<string | null>(null)
  const runningRef = useRef(false)
  // Double-submit guard for selectService(): a ref (not just `state.choosingId`)
  // so a re-entrant call made before the next render commits still sees the
  // in-flight selection synchronously — mirrors `runningRef`'s role for play().
  const choosingRef = useRef<string | null>(null)

  const create = async (req: CreateMergedRunReq, scenarioId?: string): Promise<void> => {
    try {
      const resp = await createMergedRun(req)
      mergedRunIdRef.current = resp.merged_run_id
      dispatch({
        type: 'CREATED',
        mergedRunId: resp.merged_run_id,
        triggerRunId: resp.trigger_run_id,
        scenarioId: scenarioId ?? null,
      })
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
    // Double-submit guard (mirrors ServiceProposalPanel's local `choosingId`
    // state, see components/proposal/panels/ServiceProposalPanel.tsx): while
    // a selection is already in flight, a rapid double-click on Choose must
    // NOT fire a second concurrent proposal-action request — the backend's
    // select_service has no idempotency check, so a second call would append
    // a duplicate entry to the append-only evidence log.
    if (choosingRef.current) return
    choosingRef.current = serviceId
    dispatch({ type: 'SET_CHOOSING', serviceId })
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
    } finally {
      choosingRef.current = null
      dispatch({ type: 'SET_CHOOSING', serviceId: null })
    }
  }

  const acceptRest = async (body: AcceptRestReq): Promise<void> => {
    const mergedRunId = mergedRunIdRef.current
    if (!mergedRunId) return
    try {
      await acceptRestClient(mergedRunId, body)
      // The trigger's staged recovery has now started server-side — resume
      // Play so the existing tick loop auto-drives the rest journey
      // (Task 3's orchestrator) through to the after-rest recompute. No
      // separate per-stage action is needed (brief/CLAUDE.md).
      play()
    } catch (err) {
      dispatch({
        type: 'ERROR',
        message: err instanceof Error ? err.message : 'accept_rest failed',
      })
    }
  }

  const quickview = async (body: MergedQuickviewReq): Promise<void> => {
    try {
      const result = await mergedQuickview(body)
      dispatch({ type: 'QUICKVIEW_LOADED', result })
    } catch (err) {
      dispatch({
        type: 'ERROR',
        message: err instanceof Error ? err.message : 'Quickview failed',
      })
    }
  }

  const inspectFire = (index: number | null): void => {
    dispatch({ type: 'INSPECT_FIRE', index })
  }

  const value: MergedCoordinatorContextValue = {
    state,
    create,
    play,
    pause,
    step,
    selectService,
    acceptRest,
    quickview,
    inspectFire,
  }
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
