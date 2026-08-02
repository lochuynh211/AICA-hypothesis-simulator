/**
 * Proposal run manager — TS port of `aica_api.services.proposal_run_manager`
 * (`create_run`, `get_run`, `list_runs`, `delete_run`, `append_event`,
 * `append_evidence`, `append_explanation`, `update_state`,
 * `ProposalRunNotFoundError`).
 *
 * Substrate change for the offline htmlapp: Python persists one JSON file
 * per run under `runs_dir` (`_persist`/`_run_path`, atomic write). There is
 * no filesystem here — persistence goes through `proposalRunsStore`
 * (../../storage/proposal_runs_store.ts), the way trigger runs already do
 * (`../run_manager.ts` + `../../storage/runs_store.ts`). This module owns
 * NO storage details itself — it only assembles/disassembles a
 * `ProposalRunLog` from the store's header + three append-only lists.
 *
 * Design constraints mirrored from the Python module docstring:
 *   - `run_id` generation (timestamp + random hex) happens ONLY inside
 *     `createRun` — the sole place randomness/clock is allowed in this
 *     module (Python: `prun_<YYYYMMDD-HHMMSS>_<6hex>`; here:
 *     `prun_<base36 timestamp>_<6hex>`, the same collision-resistant scheme
 *     already used by the trigger side's `makeRunId`/`makeProfileId` — the
 *     literal format differs but both are stripped by the parity helper
 *     (`normalizeForParity`, ../__fixtures__/transcript.ts), so this does
 *     not disturb goldens). Called ONCE per run, never inside a loop.
 *   - Params/hyperparameters (and the other object-valued fields Python
 *     `copy.deepcopy`s) are frozen at creation/update: deep-copied before
 *     being stored, so a later mutation of the caller's own object cannot
 *     retroactively change the persisted log.
 *   - Append-only: `appendEvent`/`appendEvidence`/`appendExplanation` only
 *     ever add to the end of their list — see `proposal_runs_store.ts` for
 *     the storage-level enforcement (IDB `add`, never `put`, on those three
 *     stores).
 *   - `getRun` renders the log from storage WITHOUT recomputing any
 *     selector — no algorithm is ever invoked in this module.
 *
 * Feature 020 (Slice-2c)'s `cache: dict[str, ProposalRunLog] | None`
 * parameter (an in-memory disk stand-in for the merged-run orchestrator) is
 * NOT ported here — every call site of `proposal_run_manager.*` in the
 * current committed `app/api/aica_api/routers/proposal.py` passes
 * `cache=None` unless invoked from that not-yet-ported orchestrator; this
 * module always persists through `proposalRunsStore` (the `cache=None`
 * path). Add an in-memory override later if/when the merged-run quick-check
 * orchestrator is ported.
 */
import { proposalRunsStore } from '../../storage/proposal_runs_store'
import type { ProposalRunHeader } from '../../storage/db'
import type { AlgorithmEvidence } from './selector'

// ---------------------------------------------------------------------------
// Domain types (mirrors models/proposal/{proposal_run,events,explanation,
// journey,opportunity}.py — this module treats journey_state/world/
// setup_snapshot as opaque pass-through payloads, matching Python's own
// create_run/update_state, which never inspect their internals).
// ---------------------------------------------------------------------------

export type ProposalRunStatus =
  | 'created' | 'service_selected' | 'content_selected' | 'error'
  | 'content_started' | 'content_completed' | 'content_stopped'

export type ProposalRunMode = 'interactive' | 'quick_check'

export type ProposalOpportunity = {
  opportunity_id: string
  trigger_purpose: string
  lifecycle_stage: string
  allowed_service_ids: string[]
  simulation_time: string | number
  run_seed: string
}

export type JourneyState = {
  lifecycle_stage: string
  motion_state: string
  active_service_id: string | null
  active_plan_id: string | null
  [k: string]: unknown
}

export type DiscreteEvent = {
  event_type: string
  at: string | number
  payload: Record<string, unknown>
}

export type Explanation = {
  step: 'service' | 'content'
  target_id: string
  requested_provider: 'backend' | 'browser'
  provider_used: 'backend' | 'browser' | 'template'
  model: string
  rationale: string[]
  fell_back: boolean
  error?: string | null
  prompt_hash: string
  generated_at: string
}

export type SetupSnapshot = Record<string, unknown>
export type World = Record<string, unknown>

export type ProposalRunLog = {
  run_id: string
  created_at: string
  opportunity: ProposalOpportunity
  matrix_version: string
  world_snapshot: Record<string, unknown>
  setup_snapshot: SetupSnapshot | null
  service_package_id: string
  content_package_id: string | null
  parameters: Record<string, unknown>
  hyperparameters: Record<string, unknown>
  content_parameters: Record<string, unknown>
  content_hyperparameters: Record<string, unknown>
  journey_state: JourneyState
  events: DiscreteEvent[]
  evidence: AlgorithmEvidence[]
  status: ProposalRunStatus
  world: World | null
  opportunity_history: ProposalOpportunity[]
  setup_snapshot_history: SetupSnapshot[]
  mode: ProposalRunMode
  explanations: Explanation[]
}

/** Summary shape for run listings (mirrors Python's `ProposalRun`). */
export type ProposalRun = {
  run_id: string
  status: ProposalRunStatus
  opportunity_id: string
  created_at: string
  service_package_id: string
  content_package_id: string | null
  mode: ProposalRunMode
}

export class ProposalRunNotFoundError extends Error {
  constructor(runId: string) {
    super(`Unknown proposal run_id: '${runId}'`)
    this.name = 'ProposalRunNotFoundError'
  }
}

// ---------------------------------------------------------------------------
// Private helpers (mirrors _make_run_id / _now_iso / copy.deepcopy)
// ---------------------------------------------------------------------------

/** Collision-resistant id; mirrors Python's `prun_<ts>_<hex>` (see module
 * docstring). Runs ONCE at creation, outside any loop — same technique as
 * `../worker/handlers/runs.ts#makeRunId` / `./stores.ts#makeProfileId`. */
function randHex(n: number): string {
  let s = ''
  for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 16).toString(16)
  return s
}

function makeProposalRunId(): string {
  return `prun_${Date.now().toString(36)}_${randHex(6)}`
}

function nowIso(): string {
  return new Date().toISOString()
}

/** Mirrors Python's `copy.deepcopy` for the plain JSON-shaped values this
 * module freezes (dicts/lists of dicts) — same local pattern already used in
 * algorithm_config.ts / world_overrides.ts (not exported there, so a local
 * copy follows the established convention rather than reaching across
 * modules for a private helper). */
function deepCopy<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => deepCopy(v)) as unknown as T
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = deepCopy(v)
    return out as T
  }
  return value
}

/** Strips the storage-row-only `runId`/`seq` wrapper fields, recovering the
 * pure domain shape (Python's DiscreteEvent/AlgorithmEvidence/Explanation
 * never carry them). */
function stripRow<T>(row: Record<string, unknown>): T {
  const { runId: _runId, seq: _seq, ...rest } = row
  return rest as T
}

async function assembleLog(runId: string): Promise<ProposalRunLog | null> {
  const header = await proposalRunsStore.getHeader(runId)
  if (!header) return null
  const [eventRows, evidenceRows, explanationRows] = await Promise.all([
    proposalRunsStore.getEvents(runId),
    proposalRunsStore.getEvidence(runId),
    proposalRunsStore.getExplanations(runId),
  ])
  return {
    ...(header as unknown as Omit<ProposalRunLog, 'events' | 'evidence' | 'explanations'>),
    events: eventRows.map((r) => stripRow<DiscreteEvent>(r)),
    evidence: evidenceRows.map((r) => stripRow<AlgorithmEvidence>(r)),
    explanations: explanationRows.map((r) => stripRow<Explanation>(r)),
  }
}

// ---------------------------------------------------------------------------
// Public API — createRun
// ---------------------------------------------------------------------------

export type CreateRunArgs = {
  opportunity: ProposalOpportunity
  matrixVersion: string
  worldSnapshot: Record<string, unknown>
  servicePackageId: string
  contentPackageId: string | null
  parameters: Record<string, unknown>
  hyperparameters: Record<string, unknown>
  journeyState: JourneyState
  events?: DiscreteEvent[]
  evidence?: AlgorithmEvidence[]
  status?: ProposalRunStatus
  setupSnapshot?: SetupSnapshot | null
  world?: World | null
  mode?: ProposalRunMode
}

/**
 * Build a `ProposalRunLog`, append any provided events/evidence, and persist
 * it. Mirrors `create_run(...)` exactly (data-model.md "ProposalRunLog");
 * `content_parameters`/`content_hyperparameters` always start empty (STEP 1)
 * — they are frozen separately at STEP 2 by `updateState`.
 */
export async function createRun(args: CreateRunArgs): Promise<ProposalRunLog> {
  const runId = makeProposalRunId()
  const header: ProposalRunHeader = {
    run_id: runId,
    created_at: nowIso(),
    opportunity: deepCopy(args.opportunity),
    matrix_version: args.matrixVersion,
    world_snapshot: deepCopy(args.worldSnapshot),
    setup_snapshot: args.setupSnapshot ?? null,
    service_package_id: args.servicePackageId,
    content_package_id: args.contentPackageId,
    parameters: deepCopy(args.parameters),
    hyperparameters: deepCopy(args.hyperparameters),
    content_parameters: {},
    content_hyperparameters: {},
    journey_state: args.journeyState,
    status: args.status ?? 'created',
    world: args.world != null ? deepCopy(args.world) : null,
    opportunity_history: [],
    setup_snapshot_history: [],
    mode: args.mode ?? 'interactive',
  }
  await proposalRunsStore.putHeader(header)

  const initialEvents = args.events ?? []
  const initialEvidence = args.evidence ?? []
  for (let i = 0; i < initialEvents.length; i++) {
    await proposalRunsStore.appendEvent(runId, i, initialEvents[i] as unknown as Record<string, unknown>)
  }
  for (let i = 0; i < initialEvidence.length; i++) {
    await proposalRunsStore.appendEvidence(runId, i, initialEvidence[i] as unknown as Record<string, unknown>)
  }

  return (await assembleLog(runId))!
}

// ---------------------------------------------------------------------------
// Public API — get / list / delete
// ---------------------------------------------------------------------------

/** Load the full `ProposalRunLog` for `runId`, or `null`. Renders from the
 * persisted record WITHOUT recomputing any selector. */
export async function getRun(runId: string): Promise<ProposalRunLog | null> {
  return assembleLog(runId)
}

/** Return summaries for every persisted run, sorted by `run_id` ascending
 * (mirrors Python's `sorted(runs_dir.glob("*.json"))` — filenames are
 * `<run_id>.json`, so a lexicographic path sort is a `run_id` string sort;
 * done explicitly here with a plain `<`/`>` comparator, matching Python's
 * codepoint-based `str` ordering for these ASCII ids, rather than relying on
 * IndexedDB's own ascending-key `getAll()` order). */
export async function listRuns(): Promise<ProposalRun[]> {
  const headers = await proposalRunsStore.listHeaders()
  const sorted = [...headers].sort((a, b) => (a.run_id < b.run_id ? -1 : a.run_id > b.run_id ? 1 : 0))
  return sorted.map((h) => ({
    run_id: h.run_id,
    status: h.status as ProposalRunStatus,
    opportunity_id: (h.opportunity as ProposalOpportunity).opportunity_id,
    created_at: h.created_at as string,
    service_package_id: h.service_package_id as string,
    content_package_id: h.content_package_id as string | null,
    mode: h.mode as ProposalRunMode,
  }))
}

/** Delete the run. Returns `true` if it existed, `false` otherwise. */
export async function deleteRun(runId: string): Promise<boolean> {
  const header = await proposalRunsStore.getHeader(runId)
  if (!header) return false
  await proposalRunsStore.deleteRun(runId)
  return true
}

// ---------------------------------------------------------------------------
// Public API — append_event / append_evidence / append_explanation
// ---------------------------------------------------------------------------

/** Append one `DiscreteEvent` to an existing run and re-persist.
 * @throws ProposalRunNotFoundError if runId has no persisted log. */
export async function appendEvent(runId: string, event: DiscreteEvent): Promise<ProposalRunLog> {
  const header = await proposalRunsStore.getHeader(runId)
  if (!header) throw new ProposalRunNotFoundError(runId)
  const events = await proposalRunsStore.getEvents(runId)
  await proposalRunsStore.appendEvent(runId, events.length, event as unknown as Record<string, unknown>)
  return (await assembleLog(runId))!
}

/** Append one `AlgorithmEvidence` entry to an existing run and re-persist.
 * @throws ProposalRunNotFoundError if runId has no persisted log. */
export async function appendEvidence(runId: string, evidence: AlgorithmEvidence): Promise<ProposalRunLog> {
  const header = await proposalRunsStore.getHeader(runId)
  if (!header) throw new ProposalRunNotFoundError(runId)
  const existing = await proposalRunsStore.getEvidence(runId)
  await proposalRunsStore.appendEvidence(runId, existing.length, evidence as unknown as Record<string, unknown>)
  return (await assembleLog(runId))!
}

/** Append one `Explanation` (feature 019) to an existing run and re-persist.
 * @throws ProposalRunNotFoundError if runId has no persisted log. */
export async function appendExplanation(runId: string, explanation: Explanation): Promise<ProposalRunLog> {
  const header = await proposalRunsStore.getHeader(runId)
  if (!header) throw new ProposalRunNotFoundError(runId)
  const existing = await proposalRunsStore.getExplanations(runId)
  await proposalRunsStore.appendExplanation(runId, existing.length, explanation as unknown as Record<string, unknown>)
  return (await assembleLog(runId))!
}

// ---------------------------------------------------------------------------
// Public API — update_state
// ---------------------------------------------------------------------------

export type UpdateStateArgs = {
  status?: ProposalRunStatus
  journeyState?: JourneyState
  contentParameters?: Record<string, unknown>
  contentHyperparameters?: Record<string, unknown>
  setupSnapshot?: SetupSnapshot
  opportunity?: ProposalOpportunity
  worldSnapshot?: Record<string, unknown>
  opportunityHistory?: ProposalOpportunity[]
  setupSnapshotHistory?: SetupSnapshot[]
}

/**
 * Update `status`/`journeyState`/content overrides (and, P7: `opportunity`/
 * `worldSnapshot`/history lists) on an existing run and re-persist. Omitted
 * (`undefined`) fields are left unchanged — mirrors Python's `is not None`
 * gate on each optional kwarg exactly (Python has no way to distinguish
 * "omitted" from "explicitly None" either; `undefined` is this port's
 * equivalent sentinel).
 * @throws ProposalRunNotFoundError if runId has no persisted log.
 */
export async function updateState(runId: string, args: UpdateStateArgs = {}): Promise<ProposalRunLog> {
  const header = await proposalRunsStore.getHeader(runId)
  if (!header) throw new ProposalRunNotFoundError(runId)

  const next: ProposalRunHeader = { ...header }
  if (args.status !== undefined) next.status = args.status
  if (args.journeyState !== undefined) next.journey_state = args.journeyState
  if (args.contentParameters !== undefined) next.content_parameters = deepCopy(args.contentParameters)
  if (args.contentHyperparameters !== undefined) next.content_hyperparameters = deepCopy(args.contentHyperparameters)
  if (args.setupSnapshot !== undefined) next.setup_snapshot = args.setupSnapshot
  if (args.opportunity !== undefined) next.opportunity = deepCopy(args.opportunity)
  if (args.worldSnapshot !== undefined) next.world_snapshot = deepCopy(args.worldSnapshot)
  if (args.opportunityHistory !== undefined) next.opportunity_history = deepCopy(args.opportunityHistory)
  if (args.setupSnapshotHistory !== undefined) next.setup_snapshot_history = deepCopy(args.setupSnapshotHistory)

  await proposalRunsStore.putHeader(next)
  return (await assembleLog(runId))!
}
