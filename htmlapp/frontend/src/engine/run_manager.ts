/**
 * Run manager — orchestrates the full run lifecycle (create/tick/action) plus
 * IndexedDB-backed persistence and RunLog assembly.
 *
 * Ported from `app/api/aica_api/services/run_manager.py` (behavior-of-record,
 * 878 LoC — the largest module in the port). This is the KEYSTONE of the
 * htmlapp engine: it is the only module that wires together run_plan (draft
 * registry), tick_engine (advanceTick/computeTickState), the algorithm
 * adapter, recovery, and the evidence recorder into one deterministic run
 * loop, and it owns the authoritative RunLog assembly (S4.1's
 * `EvidenceRecorder` intentionally only assembles the M1 subset of RunLog
 * fields — see its module docstring — so the M2 audit-trail fields
 * (original_values/modified_values/initial|current_parameters/
 * initial|current_hyperparameters) and the M4/M5 fields (route_source,
 * display_route, driver/vehicle/speed profiles, profile_overrides) are
 * surfaced here instead, from the run header this module builds at
 * `createRun`).
 *
 * In-memory registry design: Python holds a single in-process dict keyed by
 * run_id, mapping to (RunState, PackageManifest, ScenarioDef, EvidenceRecorder,
 * priorTickState). The htmlapp offline build mirrors this with a module-level
 * `Map` for the SAME reason Python needs it (constant-time lookups without an
 * async round-trip on every tick/action call) — durability then comes from
 * ALSO persisting a run header row (`runsStore.putHeader`) at creation and on
 * every status change, and appending every event via `EvidenceRecorder`
 * (which itself writes straight through to the `run_events` IndexedDB store —
 * see its module docstring). `getActiveRunLog` reads the in-memory mirror
 * (header + events) exactly like Python's `get_active_run_log` reads
 * `entry[3].run_log` — no disk/IndexedDB round-trip for an active run.
 *
 * Design constraints (mirrors the Python docstring):
 *   - NO timestamps/UUIDs/randomness generated inside the decision path
 *     (tick()/action() never call Date.now()/Math.random(); `createRun`'s
 *     `created_at` timestamp is metadata generated ONCE, outside the
 *     per-tick loop, exactly like Python's `_now_iso()` call site).
 *   - planId is resolved from the draft registry (`./run_plan`).
 *   - runId is supplied by the caller.
 *   - Ordinal bands only reach the adapter (via tick_engine's
 *     buildAdapterContext).
 *   - Adapter failure -> an `algorithm_error` EVENT; NEVER a faked
 *     DecisionResult (master invariant, FR-011).
 *   - package_runtime_state is threaded tick-to-tick: pass current in,
 *     adapter returns next, store returned next.
 *
 * M1 path: scenario.driver_profile is null/undefined -> freezeEventPlan +
 *          computeTickState.
 * M2 path: scenario.driver_profile is set -> plan draft frozen (route_facts +
 *          event_plan already computed) + advanceTick.
 *
 * Only the exported function identifiers (createRun, tick, action, getRun,
 * getActiveRunLog, resolveRunLog, getPriorTickState, getScenario,
 * appendFeedback, clearRegistry) are camelCased. Every object key inside
 * RunState/RunLog/
 * event payloads is preserved byte-for-byte from the Python (snake_case)
 * because they cross the parity boundary.
 */

import type {
  ActionEvent,
  AlgorithmError,
  AlgorithmErrorEvent,
  DecisionResult,
  DisplayRoute,
  FeedbackEvent,
  RecoveryStateT,
  RestSpot,
  RunLog,
  RunLogEvent,
  RunState,
  RouteFacts,
  Snapshot,
} from '../api/types'
import { getDraftEntry, type PackageManifestM2 } from './run_plan'
import { freezeEventPlan, type EventPlan, type ScenarioDefM2 } from './event_plan'
import {
  advanceTick,
  buildAdapterContext,
  computeTickState,
  type FeatureGroups,
  type TickState,
} from './tick_engine'
import { evaluate } from './algorithms/adapter'
import { AlgorithmAdapterError } from './algorithms/errors'
import { startRecovery } from './recovery'
import { EvidenceRecorder } from './services/evidence_recorder'
import { runsStore } from '../storage/runs_store'
import type { RunHeader, EvidenceEvent } from '../storage/db'
import { deriveProposalHistory, deriveResponseSuppression } from './proposal_history'
export type { ProposalHistory } from './proposal_history'

// ---------------------------------------------------------------------------
// Simulator version
// ---------------------------------------------------------------------------

const SIMULATOR_VERSION = '0.1.0'

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

/** Raised when the run_id is not in the registry. */
export class RunNotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RunNotFoundError'
  }
}

/** Raised when an action is invalid given the current run state. */
export class ActionNotAllowedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ActionNotAllowedError'
  }
}

// ---------------------------------------------------------------------------
// Public types — RunState/RunLog M2 extensions genuinely absent from the
// synced ../api/types.ts (see module docstring for why these live here
// instead of editing the synced file).
// ---------------------------------------------------------------------------

export type RunStateM2 = RunState & {
  run_mode: string
  evidence_status: string
  driver_profile: Record<string, unknown> | null
  vehicle_profile: Record<string, unknown> | null
  speed_profile: Record<string, unknown> | null
  initial_parameters: Record<string, unknown>
  current_parameters: Record<string, unknown>
  initial_hyperparameters: Record<string, unknown>
  current_hyperparameters: Record<string, unknown>
  original_values: Record<string, unknown>
  modified_values: Record<string, unknown>
  route_source: 'maps' | 'local'
  display_route: DisplayRoute | null
  /** run_seed frozen at run creation — used by the anomaly-signal generator.
   * Mirrors Python's RunState.run_seed (default 42). */
  run_seed: number
}

export type RunLogM2 = RunLog & {
  original_values: Record<string, unknown>
  modified_values: Record<string, unknown>
  initial_parameters: Record<string, unknown>
  current_parameters: Record<string, unknown>
  initial_hyperparameters: Record<string, unknown>
  current_hyperparameters: Record<string, unknown>
  route_source: 'maps' | 'local'
  display_route: DisplayRoute | null
  driver_profile: Record<string, unknown> | null
  vehicle_profile: Record<string, unknown> | null
  speed_profile: Record<string, unknown> | null
  profile_overrides: Record<string, unknown> | null
}

/** M2 TickEvent — feature_groups/driver_update/vehicle_update/package_runtime_state
 * are genuinely absent from the synced ../api/types.ts TickEvent (M1-only shape). */
export type TickEventM2 = {
  kind: 'tick'
  tick_index: number
  tick_state: Record<string, unknown>
  trace: { tick_index: number; decision_result: DecisionResult }
  raw_state: Record<string, unknown>
  feature_groups: FeatureGroups
  driver_update: Record<string, unknown>
  vehicle_update: Record<string, unknown>
  package_runtime_state: Record<string, unknown>
}

/**
 * Return value of tick(). `evaluatedTickIndex` is the tick_index of the
 * TickEvent (or algorithm_error event) persisted during this call — i.e. the
 * value of current_tick BEFORE the post-increment. It is null when no
 * evaluation happened (completed/no-op and tick_state.completed early-exit
 * paths). `tickState` carries the authoritative route_fraction, distance_km,
 * and raw_state (speedKph) evaluated this call; null on no-op ticks.
 */
export type TickOutcome = {
  runState: RunStateM2
  decision: DecisionResult | null
  algorithmError: AlgorithmError | null
  paused: boolean
  completed: boolean
  evaluatedTickIndex: number | null
  tickState: TickState | null
}

// ---------------------------------------------------------------------------
// In-memory registry
// ---------------------------------------------------------------------------

type RegistryEntry = {
  runState: RunStateM2
  package: PackageManifestM2
  scenario: ScenarioDefM2
  recorder: EvidenceRecorder
  /** Prior TickState for the M2 advanceTick path (null = no tick yet). */
  priorTickState: TickState | null
  /** In-memory mirror of persisted events — the source `getActiveRunLog` reads
   * from directly, exactly like Python's `entry[3].run_log.events`. */
  events: RunLogEvent[]
  /** Header (RunLog minus events) fixed at createRun — nothing in this port
   * mutates route_facts/event_plan/parameter snapshots after creation. */
  header: Omit<RunLogM2, 'events'>
}

const _registry = new Map<string, RegistryEntry>()

/** Clear the in-memory registry. Used for test isolation only. */
export function clearRegistry(): void {
  _registry.clear()
}

/** Return the current RunState for a run, or null if unknown. */
export function getRun(runId: string): RunStateM2 | null {
  return _registry.get(runId)?.runState ?? null
}

/**
 * Assemble a RunLogM2 from a header (RunLog minus events) and an ordered
 * event list. This is the ONE definition of "what a RunLog looks like" in
 * this module — both `getActiveRunLog` (in-memory header+events) and
 * `resolveRunLog`'s inactive/IndexedDB branch (persisted header+events,
 * reconstructed to the identical shape by `headerFromStore`/`eventsFromStore`
 * below) call this same helper, so active and inactive resolution produce
 * byte-identical RunLog shapes — never two divergent assembly definitions.
 */
function assembleRunLog(header: Omit<RunLogM2, 'events'>, events: RunLogEvent[]): RunLogM2 {
  return { ...header, events: [...events] }
}

/**
 * Return the in-memory RunLog for an active run, or null if not active.
 * No disk/IndexedDB round-trip — mirrors Python's `get_active_run_log`.
 */
export async function getActiveRunLog(runId: string): Promise<RunLogM2 | null> {
  const entry = _registry.get(runId)
  if (!entry) return null
  return assembleRunLog(entry.header, entry.events)
}

/**
 * Recover the exact `Omit<RunLogM2, 'events'>` shape `entry.header` already
 * is in the active path, from a `runs`-store row. `persistHeader` writes
 * `{ id, status, ...entry.header }` (see below) — `id`/`status` are
 * IndexedDB-only bookkeeping (keyPath + a redundant status mirror) that are
 * NOT RunLogM2 fields, so they must be stripped for `resolveRunLog`'s
 * inactive branch to produce a byte-identical RunLog to the active branch.
 */
function headerFromStore(stored: RunHeader): Omit<RunLogM2, 'events'> {
  const { id, status, ...header } = stored as RunHeader & Record<string, unknown>
  return header as unknown as Omit<RunLogM2, 'events'>
}

/**
 * Recover the exact event shape `entry.events` already holds in the active
 * path (see `recordEvent`, which pushes the raw RunLogEvent with no storage
 * metadata), from `run_events`-store rows. `runsStore.appendEvent` writes
 * `{ ...event, runId, seq }` — `runId`/`seq` are IndexedDB-only bookkeeping
 * (index key + ordering) that are NOT RunLogEvent fields, so they must be
 * stripped for byte-identical parity with the active in-memory events.
 */
function eventsFromStore(stored: EvidenceEvent[]): RunLogEvent[] {
  return stored.map((e) => {
    const { seq, runId, ...rest } = e as EvidenceEvent & Record<string, unknown>
    return rest as unknown as RunLogEvent
  })
}

/**
 * Return the RunLog for run_id: active (in-memory registry) → persisted
 * (IndexedDB `runs` + `run_events` stores) → not-found. Mirrors Python's
 * `_resolve_run_log` (routers/runs.py:89-107) resolution order EXACTLY:
 *   1. Active run in the in-memory registry (no disk/IndexedDB I/O) — same
 *      source `getActiveRunLog` reads.
 *   2. Inactive: read the persisted header + ordered events written by
 *      `persistHeader`/`EvidenceRecorder.append` at every meaningful event
 *      (this build's equivalent of Python's `runs/{run_id}.json` disk read)
 *      and reassemble via the SAME `assembleRunLog` helper `getActiveRunLog`
 *      uses.
 *   3. Neither → throw (404-equivalent; matches the pre-existing `getRunLog`
 *      not-found message convention in `../api/client.ts`).
 *
 * READ-ONLY: never re-registers an inactive run as active/resumable in
 * `_registry` — Python has no such re-activation path either (continued
 * ticking after a reload is out of scope; see `_resolve_run_log`'s own
 * docstring, which only ever *reads* the resolved log).
 */
export async function resolveRunLog(runId: string): Promise<RunLogM2> {
  const active = await getActiveRunLog(runId)
  if (active !== null) return active

  const [storedHeader, storedEvents] = await Promise.all([
    runsStore.getHeader(runId),
    runsStore.getEvents(runId),
  ])
  if (storedHeader === undefined) {
    throw new Error(`Run log for '${runId}' not found`)
  }
  return assembleRunLog(headerFromStore(storedHeader), eventsFromStore(storedEvents))
}

/** Return the prior TickState for a run, or null if no tick yet / not active. */
export function getPriorTickState(runId: string): TickState | null {
  return _registry.get(runId)?.priorTickState ?? null
}

/** Return the ScenarioDefM2 for an active run, or null if unknown. */
export function getScenario(runId: string): ScenarioDefM2 | null {
  return _registry.get(runId)?.scenario ?? null
}

/**
 * Replace the ScenarioDefM2 installed in ONE run's own registry entry.
 *
 * Small helper ported here by C4 Task 7 (feature 026) — `services/
 * run_manager.py`'s `replace_scenario` (193-222) was not part of any
 * earlier task's file list; `accept_rest_endpoint` (`../merged/actions.ts`)
 * needs it to install a per-run nap-duration override
 * (`../merged/tick.ts#overrideNapStageTicks`) WITHOUT mutating the object
 * `getScenario` returns in place. That object may be shared with OTHER
 * runs built from the same `plan_id` (`getDraftEntry`/`freezeEventPlan`
 * never copy the `ScenarioDefM2` — see Python's own docstring for the
 * incident this guards against: `run_plan._draft_registry` is keyed by
 * plan_id, not run_id, so two runs created from the same plan_id start out
 * pointing at the literal same object). Mutating it in place would
 * silently leak an override into every other run built from that plan_id,
 * present or future.
 *
 * The caller must pass a NEW `ScenarioDefM2` (e.g.
 * `overrideNapStageTicks`'s own return value, which never mutates its
 * input) — this function only swaps the reference stored for `runId`; it
 * never mutates or copies anything itself. Mirrors Python's tuple
 * replacement (`_registry[run_id] = (run_state, package, scenario,
 * recorder, prior_tick_state)`) with an equivalent whole-entry replacement
 * (`_registry.set(runId, {...entry, scenario})`) rather than mutating
 * `entry.scenario` in place — same "replace, don't mutate" spirit as the
 * object it installs.
 *
 * @throws RunNotFoundError if runId is not in the registry.
 */
export function replaceScenario(runId: string, scenario: ScenarioDefM2): void {
  const entry = _registry.get(runId)
  if (!entry) {
    throw new RunNotFoundError(`Unknown run_id: '${runId}'`)
  }
  _registry.set(runId, { ...entry, scenario })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Recursively sort object keys so JSON.stringify is canonical (mirrors
 * Python's `json.dumps(data, sort_keys=True)`). */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(obj).sort()) sorted[key] = canonicalize(obj[key])
    return sorted
  }
  return value
}

/**
 * SHA-256 hash of the canonical JSON representation of a value, via Web
 * Crypto (`crypto.subtle`) — available in both the browser and the Vitest
 * (jsdom/Node) test environment; no Node-only `crypto` module dependency.
 * NOTE: this need not (and does not) byte-match Python's hash — Python
 * hashes the Pydantic-canonicalized `model_dump(mode="json")` representation
 * (which adds Pydantic-model defaults our raw JS objects don't carry), so an
 * identical hash algorithm on non-identical canonical bytes would still
 * diverge. Nothing in the parity contract asserts on `snapshot.*.hash`
 * (see task report) — only that *some* deterministic content hash exists.
 *
 * `crypto.subtle` is present in every real browser but jsdom (the Vitest
 * test environment) stubs `crypto` WITHOUT `.subtle` — falls back to a
 * simple deterministic (non-cryptographic) string hash in that case so the
 * test suite doesn't depend on a Node-only `node:crypto` import (which would
 * break the browser bundle).
 */
async function contentHash(data: unknown): Promise<string> {
  const payload = JSON.stringify(canonicalize(data))
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const bytes = new TextEncoder().encode(payload)
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }
  return fnv1aHash(payload)
}

/** Deterministic 32-bit FNV-1a hash, hex-encoded — fallback only (see contentHash). */
function fnv1aHash(payload: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < payload.length; i++) {
    hash ^= payload.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/** True if the scenario has M2 profile-driven fields (mirrors Python's
 * `scenario.driver_profile is not None` — checked for null/undefined only,
 * NOT emptiness, exactly like Python's `is not None`). */
function isM2Scenario(scenario: ScenarioDefM2): boolean {
  // Feature 009: M2 is now keyed on driver_signal_params (driver_profile retired).
  const dsp = (scenario as Record<string, unknown>)['driver_signal_params']
  return dsp !== null && dsp !== undefined
}


/** Append one event to the in-memory mirror, persist it (durability), and
 * re-persist the header's `status` field. Called after EVERY meaningful
 * event, matching the append-only + "persist after every meaningful event"
 * invariants. */
async function recordEvent(entry: RegistryEntry, event: RunLogEvent): Promise<void> {
  entry.events.push(event)
  await entry.recorder.append(event)
  await persistHeader(entry)
}

async function persistHeader(entry: RegistryEntry): Promise<void> {
  const header: RunHeader = { id: entry.runState.run_id, status: entry.runState.status, ...entry.header }
  await runsStore.putHeader(header)
}

// ---------------------------------------------------------------------------
// Public API — createRun
// ---------------------------------------------------------------------------

/**
 * Initialise a new run from a frozen run plan draft.
 *
 * @param planId The frozen draft plan identifier (from the run_plan draft registry).
 * @param runId  Unique run identifier (supplied by the caller).
 * @returns The initial RunStateM2 (status=created, current_tick=0).
 * @throws Error if planId is not in the draft registry, or an M1/M2 build
 *   guard fails (mirrors Python's ValueError raises exactly).
 */
export async function createRun(planId: string, runId: string): Promise<RunStateM2> {
  const entry = getDraftEntry(planId)
  if (entry === null) {
    throw new Error(`Unknown plan_id '${planId}'`)
  }
  const { draft, scenario } = entry
  // getDraftEntry's DraftEntry.package is typed as the plain (non-M2)
  // PackageManifest in run_plan.ts (a pre-existing typing gap in that
  // already-merged module — out of scope to edit here); the actual runtime
  // object createDraft stores is always a PackageManifestM2 (it accepts one
  // as input and stores it verbatim), so this cast is safe.
  const pkg = entry.package as PackageManifestM2

  let routeFacts: RouteFacts = draft.route_facts
  let eventPlan: EventPlan = draft.draft_event_plan

  // M1 fallback: if the scenario has no driver_profile and event_plan has no
  // ticks, re-freeze using the scenario's event_presets.
  if (!isM2Scenario(scenario) && eventPlan.ticks.length === 0) {
    if (pkg.algorithm.tick_seconds != null) {
      throw new Error(
        'package-declared tick_seconds is only supported for M2 profile-driven '
          + 'scenarios (scenario must have a driver_profile). '
          + 'The M1 legacy path (no driver_profile) re-freezes via freezeEventPlan '
          + 'which ignores the package tick_seconds override. '
          + 'Use an M2 scenario or remove tick_seconds from the package manifest.',
      )
    }
    eventPlan = freezeEventPlan(scenario)
    routeFacts = {
      segments: scenario.route_intent.segments as unknown as RouteFacts['segments'],
      bands: Object.fromEntries(pkg.features.map((f) => [f.key, f.band_values])),
      total_route_distance_km: null,
      estimated_route_duration_min: null,
      route_segments: [],
      rest_spot_positions: [],
      route_progress_checkpoints: [],
    }
  }

  // M2 guard: an M2 scenario with no rest opportunities on a LOCAL route
  // signals a failed or empty plan build — do not start the run.
  const isMapsRoute = (routeFacts as { route_source?: string }).route_source === 'maps'
  if (isM2Scenario(scenario) && !isMapsRoute && eventPlan.rest_opportunities.length === 0) {
    throw new Error(
      `M2 event plan for plan_id='${planId}' has no rest opportunities. `
        + 'The plan build may have failed or the scenario route has no rest spots. '
        + 'Fix the scenario/package and create a new run plan.',
    )
  }

  // Extract effective setup.
  const effectiveSetup = draft.effective_setup
  const effectiveParams = (effectiveSetup['parameters'] as Record<string, unknown> | undefined) ?? {}
  const effectiveHps = (effectiveSetup['hyperparameters'] as Record<string, unknown> | undefined) ?? {}
  const runMode = (effectiveSetup['run_mode'] as string | undefined) ?? 'standard'

  // original_values / modified_values diff.
  const originalValues: Record<string, unknown> = {}
  const modifiedValues: Record<string, unknown> = {}
  const defaultParams: Record<string, unknown> = Object.fromEntries(pkg.parameters.map((p) => [p.key, p.default]))
  const defaultHps: Record<string, unknown> = Object.fromEntries(pkg.hyperparameters.map((hp) => [hp.key, hp.default]))
  for (const [key, val] of Object.entries(effectiveParams)) {
    if (key in defaultParams && defaultParams[key] !== val) {
      originalValues[`parameters.${key}`] = defaultParams[key]
      modifiedValues[`parameters.${key}`] = val
    }
  }
  for (const [key, val] of Object.entries(effectiveHps)) {
    if (key in defaultHps && defaultHps[key] !== val) {
      originalValues[`hyperparameters.${key}`] = defaultHps[key]
      modifiedValues[`hyperparameters.${key}`] = val
    }
  }

  // Build snapshot.
  const snapshot: Snapshot = {
    package: { id: pkg.id, version: pkg.version, hash: await contentHash(pkg) },
    scenario: { id: scenario.id, version: scenario.version, hash: await contentHash(scenario) },
  }

  const draftRouteSource = draft.route_source ?? 'local'
  const draftDisplayRoute = draft.display_route ?? null

  // Feature 009: driver_profile RunLog field now carries driver_signal_params
  // (schema field name kept for log back-compat); vehicle_profile is retired.
  const driverProfile = ((scenario as Record<string, unknown>)['driver_signal_params'] as Record<string, unknown> | null | undefined) ?? null
  const vehicleProfile = null
  const speedProfile = (scenario.speed_profile as Record<string, unknown> | null | undefined) ?? null

  // run_seed is frozen in the event_plan at plan-creation time (see
  // event_plan.ts buildEventPlan / freezeEventPlan). Mirror Python's
  // RunState.run_seed which reads scenario.run_seed_default at the same point.
  const runSeed = (eventPlan as { run_seed?: number }).run_seed ?? 42

  const runState: RunStateM2 = {
    run_id: runId,
    status: 'created',
    current_tick: 0,
    pending_proposal: null,
    package_runtime_state: {},
    snapshot,
    event_plan: eventPlan,
    route_facts: routeFacts,
    run_mode: runMode,
    evidence_status: 'standard',
    driver_profile: driverProfile,
    vehicle_profile: vehicleProfile,
    speed_profile: speedProfile,
    initial_parameters: effectiveParams,
    current_parameters: { ...effectiveParams },
    initial_hyperparameters: effectiveHps,
    current_hyperparameters: { ...effectiveHps },
    original_values: originalValues,
    modified_values: modifiedValues,
    allowed_actions: [...scenario.allowed_actions],
    route_source: draftRouteSource,
    display_route: draftDisplayRoute,
    last_error: null,
    recovery: null,
    run_seed: runSeed,
  }

  const header: Omit<RunLogM2, 'events'> = {
    run_id: runId,
    created_at: new Date().toISOString(),
    simulator_version: SIMULATOR_VERSION,
    snapshot,
    route_facts: routeFacts,
    event_plan: eventPlan,
    run_mode: runMode,
    evidence_status: 'standard',
    initial_parameters: effectiveParams,
    current_parameters: { ...effectiveParams },
    initial_hyperparameters: effectiveHps,
    current_hyperparameters: { ...effectiveHps },
    original_values: originalValues,
    modified_values: modifiedValues,
    route_source: draftRouteSource,
    display_route: draftDisplayRoute,
    driver_profile: driverProfile,
    vehicle_profile: vehicleProfile,
    speed_profile: speedProfile,
    profile_overrides: draft.profile_overrides ?? null,
  }

  const recorder = new EvidenceRecorder(runId)
  const registryEntry: RegistryEntry = {
    runState,
    package: pkg,
    scenario,
    recorder,
    priorTickState: null,
    events: [],
    header,
  }
  _registry.set(runId, registryEntry)
  await persistHeader(registryEntry)

  return runState
}

// ---------------------------------------------------------------------------
// Public API — tick
// ---------------------------------------------------------------------------

/**
 * Advance one simulation tick for the given run.
 *
 * Dispatches to the adapter, appends a TickEvent (or algorithm_error),
 * persists, and pauses when an actionable proposal fires.
 *
 * @throws RunNotFoundError if runId is not in the registry.
 */
export async function tick(runId: string): Promise<TickOutcome> {
  const entry = _registry.get(runId)
  if (!entry) {
    throw new RunNotFoundError(`Unknown run_id: '${runId}'`)
  }
  const { runState, package: pkg, scenario } = entry

  // ── Already completed — no-op ─────────────────────────────────────────
  if (runState.status === 'completed') {
    return {
      runState,
      decision: null,
      algorithmError: null,
      paused: false,
      completed: true,
      evaluatedTickIndex: null,
      tickState: null,
    }
  }

  // ── Blocking-error halt guard ─────────────────────────────────────────
  // A run paused due to a blocking algorithm error (last_error is not null)
  // must not retry the broken tick. A normal proposal-pause has
  // last_error == null and is unaffected. Recovery requires a new run.
  if (runState.status === 'paused' && runState.last_error != null) {
    return {
      runState,
      decision: null,
      algorithmError: null,
      paused: true,
      completed: false,
      evaluatedTickIndex: null,
      tickState: null,
    }
  }

  const currentTick = runState.current_tick

  // ── Compute tick state ────────────────────────────────────────────────
  let tickState: TickState
  if (isM2Scenario(scenario)) {
    tickState = advanceTick({
      priorState: entry.priorTickState,
      tickIndex: currentTick,
      eventPlan: runState.event_plan as EventPlan,
      routeFacts: runState.route_facts as RouteFacts,
      scenario,
      recovery: runState.recovery ?? null,
      // Feature 009: seed the anomaly generator. The effective scenario carries
      // run_seed_default (baked by createDraft from any explicit setup seed).
      runSeed: ((scenario as Record<string, unknown>)['run_seed_default'] as number | undefined) ?? 42,
    })
    // Thread _recovery_next back: advanceTick stashes the updated
    // RecoveryStateT on the returned TickState when recovery is active.
    const recNext = tickState._recovery_next
    if (recNext !== undefined) {
      runState.recovery = recNext.active ? recNext : null
    }
  } else {
    tickState = computeTickState(runState.event_plan as EventPlan, currentTick, scenario)
  }

  if (tickState.completed) {
    // Do not exit early if recovery is still active — the tick engine holds
    // position at the rest spot, so this guard only applies once recovery
    // has finished (run_state.recovery already null in that case, per the
    // _recovery_next handling above).
    if (!(runState.recovery && runState.recovery.active)) {
      // NOTE: Python does NOT update the registry's prior_tick_state in this
      // early-exit branch (only the success/error paths below do) — matched
      // here by deliberately NOT touching entry.priorTickState.
      runState.status = 'completed'
      await persistHeader(entry)
      return {
        runState,
        decision: null,
        algorithmError: null,
        paused: false,
        completed: true,
        evaluatedTickIndex: null,
        tickState,
      }
    }
  }

  // ── Build context and call the adapter ────────────────────────────────
  const context = buildAdapterContext(tickState)

  // Inject simulation_time_sec, proposal_history, user_action_history —
  // required by python_module packages and harmless for built-ins.
  context['simulation_time_sec'] = Number(tickState.elapsed_seconds)
  const [proposalHistory, userActionHistory] = deriveProposalHistory(
    entry.events,
    Number((runState.event_plan as EventPlan).tick_seconds),
    Number(tickState.elapsed_seconds),
  )
  context['proposal_history'] = proposalHistory
  context['user_action_history'] = userActionHistory
  // recovery_active: true only while the driver is currently in an accepted
  // rest sequence — scopes REST_PROPOSAL suppression to the rest itself.
  context['recovery_active'] = Boolean(runState.recovery && runState.recovery.active)

  // Use current_parameters/hyperparameters (may be overridden in expert mode).
  // Feature 009 (FR-009 / resolve_manifest_defaults): merge overrides onto the
  // FULL manifest-default set per key, so every declared key is always present
  // (the old `?? {defaults}` swapped the whole dict and could drop keys).
  const hyperparameters = {
    ...Object.fromEntries(pkg.hyperparameters.map((hp) => [hp.key, hp.default])),
    ...(runState.current_hyperparameters ?? {}),
  }
  const parameters = {
    ...Object.fromEntries(pkg.parameters.map((p) => [p.key, p.default])),
    ...(runState.current_parameters ?? {}),
  }

  let decisionResult: DecisionResult
  try {
    decisionResult = evaluate({
      manifest: pkg,
      context,
      parameters,
      hyperparameters,
      history: [],
      packageRuntimeState: runState.package_runtime_state,
    })
  } catch (exc) {
    if (!(exc instanceof AlgorithmAdapterError)) {
      throw exc
    }

    // ── Adapter failure: record an algorithm_error EVENT, never a faked
    // decision (master invariant). CARRY 1: AlgorithmAdapterError stores
    // { message, detail } where detail.error_type is the machine category
    // and `.message` is `"${error_type}: ${humanMessage}"` (errors.ts
    // combines them for Error.message/console display). Python's
    // AlgorithmAdapterError instead keeps error_type and message as SEPARATE
    // attributes — `.message` is the clean human message WITHOUT the
    // "type: " prefix (see app/api/aica_api/algorithms/_errors.py:
    // `super().__init__(f"{error_type}: {message}")` — the combined string
    // only backs str(exc), never the `.message` attribute the router reads).
    // So here we read error_type from exc.detail.error_type and strip the
    // "${error_type}: " prefix from exc.message to recover the clean human
    // message, so the emitted event's `message` field matches Python's
    // AlgorithmError.message byte-for-byte (never double-embedding the type).
    const detail = exc.detail as { error_type?: string } | undefined
    const errorType = detail?.error_type ?? 'unknown_error'
    const prefix = `${errorType}: `
    const cleanMessage = exc.message.startsWith(prefix) ? exc.message.slice(prefix.length) : exc.message

    const algoError: AlgorithmError = { tick_index: currentTick, error_type: errorType, message: cleanMessage }
    const algoErrorEvent: AlgorithmErrorEvent = {
      kind: 'algorithm_error',
      tick_index: currentTick,
      error_type: errorType,
      message: cleanMessage,
    }
    await recordEvent(entry, algoErrorEvent)

    const errorMode = pkg.algorithm.error_mode ?? 'blocking'
    if (errorMode === 'non_blocking') {
      // Non-blocking: advance tick, continue the run unchanged.
      runState.current_tick += 1
      if (isM2Scenario(scenario)) entry.priorTickState = tickState
      await persistHeader(entry)
      return {
        runState,
        decision: null,
        algorithmError: algoError,
        paused: false,
        completed: false,
        evaluatedTickIndex: currentTick,
        tickState,
      }
    }

    // Blocking (default): pause the run; do NOT advance current_tick. The
    // run is halted at the broken tick — no decision is produced, and the
    // error is visible in the evidence trace. Recovery requires a new run.
    runState.status = 'paused'
    runState.last_error = { tick_index: currentTick, error_type: errorType, message: cleanMessage }
    if (isM2Scenario(scenario)) entry.priorTickState = tickState
    await persistHeader(entry)
    return {
      runState,
      decision: null,
      algorithmError: algoError,
      paused: true,
      completed: false,
      evaluatedTickIndex: currentTick,
      tickState,
    }
  }

  // ── Thread package_runtime_state: store what the algorithm returned ───
  runState.package_runtime_state = decisionResult.next_package_runtime_state

  // ── Extract M2 tick evidence fields from tick_state ────────────────────
  // Feature 009: the evidence field name `raw_state` is kept for log
  // back-compat, but it now carries the tiered `signals` dict. The vehicle
  // model is retired, so vehicle_update is always {}.
  const rawState = tickState.signals ?? {}
  const featureGroups = tickState.feature_groups
  const driverUpdate = tickState._driver_update ?? {}
  const vehicleUpdate = {}

  // ── Append TickEvent with M2 fields ────────────────────────────────────
  const tickEvent: TickEventM2 = {
    kind: 'tick',
    tick_index: currentTick,
    tick_state: tickState as unknown as Record<string, unknown>,
    trace: { tick_index: currentTick, decision_result: decisionResult },
    raw_state: rawState,
    feature_groups: featureGroups,
    driver_update: driverUpdate,
    vehicle_update: vehicleUpdate,
    package_runtime_state: decisionResult.next_package_runtime_state,
  }
  await recordEvent(entry, tickEvent as unknown as RunLogEvent)

  // ── Advance tick ─────────────────────────────────────────────────────
  runState.current_tick += 1

  // ── Update prior_state for M2 ───────────────────────────────────────
  if (isM2Scenario(scenario)) entry.priorTickState = tickState

  // ── Determine new status ────────────────────────────────────────────
  const proposalFired = decisionResult.fire_control.fired && decisionResult.proposal !== null
  // Pause ONLY when the fired proposal is actionable — at least one of the
  // proposal's options overlaps scenario.allowed_actions.
  let proposalIsActionable = proposalFired
    && decisionResult.proposal!.options.some((opt) => scenario.allowed_actions.includes(opt))

  // ── Fire-control: suppress REST_PROPOSAL during active recovery ───────
  // Only REST_PROPOSAL is suppressed — SEVERE_INTERVENTION still pauses the
  // run even during recovery (runtime_workflow §7.2).
  const recoveryActive = Boolean(runState.recovery && runState.recovery.active)
  if (recoveryActive && proposalIsActionable && decisionResult.result_type === 'REST_PROPOSAL') {
    proposalIsActionable = false
  }

  // ── Fire-control: post-response trigger de-duplication (fixbug-0804) ──
  // See docs/fixbug-0804-trigger-dedup-plan.md §5 — mirrors Python's gate
  // right after the recovery_active gate above.
  if (proposalIsActionable && decisionResult.selected_category !== null) {
    const suppression = deriveResponseSuppression(
      entry.events,
      Number(tickState.elapsed_seconds),
      Number((runState.event_plan as EventPlan).tick_seconds),
    )
    if (suppression[decisionResult.selected_category as 'rest_required' | 'monotony_prevention']) {
      proposalIsActionable = false
    }
  }

  let paused: boolean
  let completed: boolean
  if (proposalIsActionable) {
    runState.status = 'paused'
    runState.pending_proposal = decisionResult.proposal!.id
    paused = true
    completed = false
  } else if (recoveryActive) {
    // Recovery in progress: force playing regardless of M1/M2/completion.
    runState.status = 'playing'
    paused = false
    completed = false
  } else if (isM2Scenario(scenario)) {
    // M2: completion detected by tick_state (distance >= total_km).
    runState.status = 'playing'
    paused = false
    completed = false
  } else if (runState.current_tick >= (runState.event_plan as EventPlan).ticks.length) {
    // M1: completion by exhausting the per-tick plan.
    runState.status = 'completed'
    paused = false
    completed = true
  } else {
    runState.status = 'playing'
    paused = false
    completed = false
  }

  await persistHeader(entry)

  return {
    runState,
    decision: decisionResult,
    algorithmError: null,
    paused,
    completed,
    evaluatedTickIndex: currentTick,
    tickState,
  }
}

// ---------------------------------------------------------------------------
// Public API — action
// ---------------------------------------------------------------------------

export type ActionOpts = {
  /** M7 — required when actionStr === "accept_rest" and the scenario has recovery_options. */
  recoveryOptionId?: string | null
  /** M7 — required alongside recoveryOptionId. The rest facility the driver will stop at. */
  restSpot?: RestSpot | null
}

/**
 * Apply a driver action to a paused run.
 *
 * @throws RunNotFoundError if runId is not in the registry.
 * @throws ActionNotAllowedError if the run is not paused, no proposal is
 *   pending, the action is not in allowed_actions, or recoveryOptionId/
 *   restSpot are missing/invalid for a scenario with recovery_options.
 */
export async function action(runId: string, actionStr: string, opts: ActionOpts = {}): Promise<RunStateM2> {
  const entry = _registry.get(runId)
  if (!entry) {
    throw new RunNotFoundError(`Unknown run_id: '${runId}'`)
  }
  const { runState, scenario } = entry

  if (runState.status !== 'paused' || runState.pending_proposal === null) {
    throw new ActionNotAllowedError(
      `No pending proposal for run '${runId}' (status='${runState.status}', pending=${JSON.stringify(runState.pending_proposal)}).`,
    )
  }

  if (!scenario.allowed_actions.includes(actionStr)) {
    throw new ActionNotAllowedError(
      `Action '${actionStr}' is not in allowed_actions ${JSON.stringify(scenario.allowed_actions)}.`,
    )
  }

  // ── Determine resulting status ──────────────────────────────────────
  let newStatus: RunStateM2['status']
  if (actionStr === 'accept_rest') {
    if (scenario.recovery_options && scenario.recovery_options.length > 0) {
      // M7: scenario offers recovery options — validate and start recovery.
      const option = scenario.recovery_options.find((o) => o.id === opts.recoveryOptionId) ?? null
      if (option === null || !opts.restSpot) {
        throw new ActionNotAllowedError(
          `accept_rest requires a valid recovery_option_id + rest_spot (got ${JSON.stringify(opts.recoveryOptionId ?? null)}).`,
        )
      }
      runState.recovery = startRecovery(option, opts.restSpot) as RecoveryStateT
      newStatus = 'playing'
    } else {
      // Back-compat: no recovery menu — accept_rest completes the run.
      newStatus = 'completed'
    }
  } else {
    newStatus = 'playing'
  }

  // ── Update state ─────────────────────────────────────────────────────
  // Mutate runState BEFORE recordEvent() so its internal persistHeader()
  // call (which reads entry.runState.status at that moment) persists the
  // FINAL post-action status, not the stale pre-action one — mirrors how
  // tick() only calls persistHeader() after runState.status is finalized.
  runState.status = newStatus
  runState.pending_proposal = null

  // ── Append ActionEvent ──────────────────────────────────────────────
  // resulting_status is the previously-computed `newStatus` value (identical
  // to Python's ActionEvent.resulting_status = new_status.value) — unaffected
  // by the reordering above.
  const actionEvent: ActionEvent = {
    kind: 'action',
    tick_index: runState.current_tick - 1, // tick that fired the proposal
    action: actionStr,
    resulting_status: newStatus,
  }
  await recordEvent(entry, actionEvent)

  return runState
}

// ---------------------------------------------------------------------------
// Public API — appendFeedback (M5)
// ---------------------------------------------------------------------------

/**
 * Append a FeedbackEvent to an active run's evidence log.
 *
 * NON-ALGORITHMIC: only ever appends the event; never touches the adapter,
 * the tick engine, or any previously recorded event.
 *
 * @throws RunNotFoundError if runId is not in the active registry.
 */
export async function appendFeedback(runId: string, event: FeedbackEvent): Promise<void> {
  const entry = _registry.get(runId)
  if (!entry) {
    throw new RunNotFoundError(`Unknown run_id: '${runId}'`)
  }
  await recordEvent(entry, event)
}
