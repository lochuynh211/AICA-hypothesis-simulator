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
import type { TraceEntry, RestSpot } from '../api/types'
import type { ProposalRunLog } from '../api/proposalClient'
import {
  createMergedRun,
  tickMergedRun,
  mergedProposalAction,
  acceptRest as acceptRestClient,
  declineRest as declineRestClient,
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
  /** True once the setup panel has a complete, valid selection and has
   * registered a start function via `prepareStart()`. The center-panel Play
   * button uses this (OR an already-created run) to enable itself — there is
   * no separate "Start run" button; Play lazily creates the run. */
  ready: boolean
  /** Rest spots the driver accepted this run, captured at accept time so the
   * center map can show gold rest markers (the merged run has no runStore
   * `restHistory` — the tick loop lives here). */
  acceptedRestSpots: RestSpot[]
  /** Playback speed multiplier (1×/2×/4×) — the `play()` loop delays
   * `1000/speed` ms between ticks (mirrors the Trigger review's PlaybackControls). */
  speed: 1 | 2 | 4
}

/** A function the setup panel registers via `prepareStart()`: builds the
 * trigger run-plan + calls `create()`, resolving `true` on success. `startAndPlay()`
 * invokes it once (lazily) the first time Play is pressed with no run yet. */
export type StartFn = () => Promise<boolean>

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
  ready: false,
  acceptedRestSpots: [],
  speed: 1,
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
  | { type: 'SET_READY'; ready: boolean }
  /** Rest declined — clear the pending proposal + unpause so the on-map rest
   * overlay + right-panel dock hide and the tick loop can resume. */
  | { type: 'REST_DECLINED' }
  /** Rest accepted at a spot — record it for the map's gold rest markers. */
  | { type: 'REST_ACCEPTED'; spot: RestSpot }
  /** Reset the whole run (+ log/projection) back to a fresh, un-started state.
   * Preserves `ready` (the setup panel's registered start fn is still valid). */
  | { type: 'RESET' }
  /** Set the 1×/2×/4× playback speed. */
  | { type: 'SET_SPEED'; speed: 1 | 2 | 4 }

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
      // A fresh merged run starts clean — mirrors runStore's RUN_CREATED — BUT
      // preserves the quickview projection + any inspected fire (owner review):
      // pressing Play/creating the run must NOT wipe the persistent top-panel
      // quickview.
      return {
        ...initialMergedCoordinatorState,
        mergedRunId: action.mergedRunId,
        triggerRunId: action.triggerRunId,
        scenarioId: action.scenarioId,
        quickviewResult: state.quickviewResult,
        inspectedFireIndex: state.inspectedFireIndex,
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

    case 'SET_READY':
      return { ...state, ready: action.ready }

    case 'REST_DECLINED':
      // Drop the declined proposal so the overlay/dock hide; a later re-fire
      // brings a fresh one. Unpause so `play()` can resume ticking.
      return { ...state, proposalLog: null, paused: false }

    case 'REST_ACCEPTED':
      return { ...state, acceptedRestSpots: [...state.acceptedRestSpots, action.spot] }

    case 'RESET':
      // Fresh start — clear the run, log, and projection, but keep `ready` (so
      // the Play button stays enabled) + `speed` (a reviewer preference).
      return { ...initialMergedCoordinatorState, ready: state.ready, speed: state.speed }

    case 'SET_SPEED':
      return { ...state, speed: action.speed }

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
  /** Decline the pending REST proposal (the on-map rest overlay's reject) and
   * resume ticking — no recovery is started. */
  declineRest(): Promise<void>
  /** Ephemeral whole-chain projection (feature 020, Slice-2c Task 5) —
   * populates `state.quickviewResult`; independent of `create()`/the tick
   * loop, so it may be called before, instead of, or alongside a real run. */
  quickview(body: MergedQuickviewReq): Promise<void>
  /** Sets `state.inspectedFireIndex` — `null` clears the inspected fire. */
  inspectFire(index: number | null): void
  /** Reset the whole run (+ log/projection) to a fresh, un-started state. */
  reset(): void
  /** Set the 1×/2×/4× playback speed (paces the tick loop). */
  setSpeed(speed: 1 | 2 | 4): void
  /** Registers (or clears, with `null`) the setup panel's start function and
   * flips `state.ready`. The center-panel Play button calls `startAndPlay()`,
   * which invokes this once when no run exists yet — so there is no separate
   * "Start run" button. */
  prepareStart(fn: StartFn | null): void
  /** Lazily creates the run (via the registered `prepareStart` fn) if none
   * exists yet, then starts the tick loop. No-op if not ready and no run. */
  startAndPlay(): Promise<void>
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
  // Playback speed read synchronously by play()'s loop (like runningRef) so a
  // mid-run speed change takes effect on the next tick without a re-render.
  const speedRef = useRef<1 | 2 | 4>(1)

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
        // Pace the loop to the selected speed (1×=1000ms, 2×=500ms, 4×=250ms)
        // — mirrors PlaybackControls' `1000/speed` interval. Skip the wait if a
        // tick already stopped the loop (pause/proposal-pause/completion).
        if (runningRef.current) {
          await new Promise((r) => setTimeout(r, 1000 / speedRef.current))
        }
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
      // Record the accepted spot for the map's gold markers. Do NOT resume Play
      // (owner review): the run STAYS paused showing the auto-selected
      // service+content proposal until the reviewer presses "Continue" — the
      // caller (handleChooseSpot) dispatches the rank-1 content selection.
      dispatch({ type: 'REST_ACCEPTED', spot: body.rest_spot })
    } catch (err) {
      dispatch({
        type: 'ERROR',
        message: err instanceof Error ? err.message : 'accept_rest failed',
      })
    }
  }

  const declineRest = async (): Promise<void> => {
    const mergedRunId = mergedRunIdRef.current
    if (!mergedRunId) return
    try {
      await declineRestClient(mergedRunId)
      // Clear the declined proposal + unpause, then resume the tick loop so the
      // drive continues (a later re-fire, after cooldown, asks again).
      dispatch({ type: 'REST_DECLINED' })
      play()
    } catch (err) {
      dispatch({
        type: 'ERROR',
        message: err instanceof Error ? err.message : 'decline failed',
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

  const setSpeed = (speed: 1 | 2 | 4): void => {
    speedRef.current = speed
    dispatch({ type: 'SET_SPEED', speed })
  }

  const reset = (): void => {
    // Stop the tick loop + drop the run identity so later step()/selectService()
    // /acceptRest() no-op until a new run is created. `startFnRef` is kept — the
    // setup panel's registered build+create fn is still valid for the next Play.
    runningRef.current = false
    mergedRunIdRef.current = null
    choosingRef.current = null
    dispatch({ type: 'RESET' })
  }

  // The setup panel's start function (build plan + create), registered via
  // prepareStart(). A ref (not state) so startAndPlay() always sees the current
  // one synchronously.
  const startFnRef = useRef<StartFn | null>(null)

  const prepareStart = (fn: StartFn | null): void => {
    startFnRef.current = fn
    dispatch({ type: 'SET_READY', ready: fn != null })
  }

  const startAndPlay = async (): Promise<void> => {
    // Lazily create the run the first time Play is pressed (no "Start" button).
    if (!mergedRunIdRef.current) {
      if (!startFnRef.current) return
      const ok = await startFnRef.current()
      if (!ok) return
    }
    play()
  }

  const value: MergedCoordinatorContextValue = {
    state,
    create,
    play,
    pause,
    step,
    selectService,
    acceptRest,
    declineRest,
    quickview,
    inspectFire,
    reset,
    setSpeed,
    prepareStart,
    startAndPlay,
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
