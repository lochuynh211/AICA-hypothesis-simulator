/**
 * Import / export portability — round-trips the docker file layout.
 *
 * Source of record for shapes (confirmed against the Python backend):
 *   - `app/api/aica_api/storage/evidence_recorder.py` persists the FULL
 *     `RunLog` (models/log.py) verbatim (`self._log.model_dump(mode="json")`)
 *     to `runs/<run_id>.json` — no field is ever stripped there. The docker
 *     `RunLog` never carries the Maps key (it isn't one of its fields), but
 *     this module still builds every export from an explicit field allowlist
 *     (never a spread of a live object) as a positive, structural guarantee
 *     that key/settings material can never ride along, plus a final runtime
 *     guard (`assertNoSensitiveKeys`) that throws if a forbidden key name is
 *     ever found in the constructed object.
 *   - `packages/<id>/package.json` is the `PackageManifest` (models/package.py).
 *   - `scenarios/<id>.json` is the `ScenarioDef` (models/scenario.py).
 *
 * This module does NOT re-port persistence — it consumes the existing seams:
 *   - `../run_manager#resolveRunLog` for the run's RunLog (RunLogM2 — a
 *     strict superset of the docker RunLog with the M2/M4/M5 extension
 *     fields the docker app's log.py model also carries). `resolveRunLog`
 *     mirrors Python's `_resolve_run_log` (active → persisted/IndexedDB →
 *     404 — REHYDRATE task), so unlike the pre-REHYDRATE `getActiveRunLog`,
 *     it also resolves runs that predate the current session (persisted in
 *     IndexedDB but no longer in the in-memory registry after a reload).
 *   - `../../storage/{runs_store,packages_store,scenarios_store}` for
 *     persistence of imported records.
 *   - `../../api/types` for the shapes imports are validated against.
 *
 * `exportRun`/`exportAllRuns` can therefore export ANY persisted run, not
 * just runs still active in this session (closes the S8.3 review's
 * "session-active-only" scope gap) — `exportAllRuns` enumerates every
 * persisted header via `runsStore.listHeaders()` and resolves each via
 * `resolveRunLog`.
 *
 * `importRun` additionally guards against clobbering a LIVE run: if
 * `run_id` is currently active in `../run_manager`'s in-memory registry
 * (`getRun(run_id) !== null`), it throws rather than delete-then-rebuild the
 * run's append-only event chain out from under an in-progress tick/action
 * loop (S8.3 Important review finding). Python has no equivalent import
 * feature to compare against — this guard is htmlapp-specific, motivated by
 * the same append-only invariant Python's evidence recorder enforces.
 *
 * Imported records are always persisted with `origin: 'user'` — an import
 * must never be able to masquerade as (or silently overwrite) a built-in
 * default, since `resetToDefaults`/`seedDefaults` treat `origin: 'builtin'`
 * specially.
 */
import { resolveRunLog, getRun, type RunLogM2 } from '../run_manager'
import { runsStore } from '../../storage/runs_store'
import { packagesStore } from '../../storage/packages_store'
import { scenariosStore } from '../../storage/scenarios_store'
import type { RunHeader, EvidenceEvent } from '../../storage/db'
import type { PackageRecord } from '../../data/types'
import type { PackageManifest, ScenarioDef, RunLogEvent } from '../../api/types'

// ── Sensitive-key guard ─────────────────────────────────────────────────────

/** Matches the Maps key field and any obvious settings-key alias. Defense in
 * depth on top of the explicit field allowlists below — every export is
 * built from named fields only, so this should never actually fire. */
const SENSITIVE_KEY_PATTERN = /googlemapsapikey|api[_-]?key|mapskey/i

function assertNoSensitiveKeys(value: unknown, path = '$'): void {
  if (value === null || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      throw new Error(
        `portability: refusing to export — sensitive key '${key}' found at ${path}.${key}`,
      )
    }
    assertNoSensitiveKeys(child, `${path}.${key}`)
  }
}

// ── Shared validation helpers ───────────────────────────────────────────────

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function requireString(obj: Record<string, unknown>, key: string, label: string): string {
  const v = obj[key]
  if (typeof v !== 'string') {
    throw new Error(`${label}: '${key}' must be a string, got ${JSON.stringify(v)}`)
  }
  return v
}

function requireNumber(obj: Record<string, unknown>, key: string, label: string): number {
  const v = obj[key]
  if (typeof v !== 'number') {
    throw new Error(`${label}: '${key}' must be a number, got ${JSON.stringify(v)}`)
  }
  return v
}

function requireArray(obj: Record<string, unknown>, key: string, label: string): unknown[] {
  const v = obj[key]
  if (!Array.isArray(v)) {
    throw new Error(`${label}: '${key}' must be an array, got ${JSON.stringify(v)}`)
  }
  return v
}

function requireObject(obj: Record<string, unknown>, key: string, label: string): Record<string, unknown> {
  const v = obj[key]
  if (!isPlainObject(v)) {
    throw new Error(`${label}: '${key}' must be an object, got ${JSON.stringify(v)}`)
  }
  return v
}

// ── RunLog import validation ────────────────────────────────────────────────

const RUN_LOG_EVENT_KINDS = new Set(['tick', 'action', 'algorithm_error', 'feedback'])

function validateRunLogEvent(raw: unknown, index: number): RunLogEvent {
  const label = `importRun: events[${index}]`
  if (!isPlainObject(raw)) throw new Error(`${label} must be an object`)
  const kind = raw['kind']
  if (typeof kind !== 'string' || !RUN_LOG_EVENT_KINDS.has(kind)) {
    throw new Error(`${label}: unknown or missing 'kind' (${JSON.stringify(kind)})`)
  }
  switch (kind) {
    case 'tick':
      requireNumber(raw, 'tick_index', label)
      requireObject(raw, 'tick_state', label)
      requireObject(raw, 'trace', label)
      break
    case 'action':
      requireNumber(raw, 'tick_index', label)
      requireString(raw, 'action', label)
      requireString(raw, 'resulting_status', label)
      break
    case 'algorithm_error':
      requireNumber(raw, 'tick_index', label)
      requireString(raw, 'error_type', label)
      requireString(raw, 'message', label)
      break
    case 'feedback':
      requireObject(raw, 'target', label)
      requireObject(raw, 'labels', label)
      break
  }
  return raw as unknown as RunLogEvent
}

/** Validate `json` against the docker/`../../api/types` RunLog shape.
 * Throws a descriptive Error on any mismatch; never returns partial data. */
function validateRunLog(json: unknown): RunLogM2 {
  if (!isPlainObject(json)) throw new Error('importRun: expected a JSON object')
  const label = 'importRun'
  requireString(json, 'run_id', label)
  requireString(json, 'created_at', label)
  requireString(json, 'simulator_version', label)
  const snapshot = requireObject(json, 'snapshot', label)
  const pkgSnap = requireObject(snapshot, 'package', `${label}: snapshot`)
  requireString(pkgSnap, 'id', `${label}: snapshot.package`)
  requireString(pkgSnap, 'version', `${label}: snapshot.package`)
  requireString(pkgSnap, 'hash', `${label}: snapshot.package`)
  const scenSnap = requireObject(snapshot, 'scenario', `${label}: snapshot`)
  requireString(scenSnap, 'id', `${label}: snapshot.scenario`)
  requireString(scenSnap, 'version', `${label}: snapshot.scenario`)
  requireString(scenSnap, 'hash', `${label}: snapshot.scenario`)
  if (!('route_facts' in json)) throw new Error(`${label}: missing 'route_facts'`)
  if (!('event_plan' in json)) throw new Error(`${label}: missing 'event_plan'`)
  requireString(json, 'run_mode', label)
  requireString(json, 'evidence_status', label)
  const events = requireArray(json, 'events', label)
  events.forEach((e, i) => validateRunLogEvent(e, i))
  return json as unknown as RunLogM2
}

// ── Package import validation ───────────────────────────────────────────────

function validatePackageManifest(json: unknown): PackageManifest {
  if (!isPlainObject(json)) throw new Error('importPackage: expected a JSON object')
  const label = 'importPackage'
  requireString(json, 'id', label)
  requireString(json, 'version', label)
  requireObject(json, 'label', label)
  const compat = requireArray(json, 'compatible_scenario_types', label)
  if (compat.length === 0) throw new Error(`${label}: 'compatible_scenario_types' must not be empty`)
  const algorithm = requireObject(json, 'algorithm', label)
  requireString(algorithm, 'type', `${label}: algorithm`)
  requireString(algorithm, 'entrypoint', `${label}: algorithm`)
  requireArray(json, 'parameters', label)
  requireArray(json, 'features', label)
  requireArray(json, 'hyperparameters', label)
  requireArray(json, 'trigger_categories', label)
  requireArray(json, 'rules', label)
  const fireControl = requireObject(json, 'fire_control', label)
  requireString(fireControl, 'threshold_source', `${label}: fire_control`)
  if (!('actionability_guard' in fireControl)) {
    throw new Error(`${label}: fire_control missing 'actionability_guard'`)
  }
  requireArray(json, 'proposals', label)
  return json as unknown as PackageManifest
}

// ── Scenario import validation ──────────────────────────────────────────────

function validateScenarioDef(json: unknown): ScenarioDef {
  if (!isPlainObject(json)) throw new Error('importScenario: expected a JSON object')
  const label = 'importScenario'
  // Feature 009 (FR-017): reject old-shape scenarios rather than silently
  // mis-reading them — driver_profile/vehicle_profile were retired in favor of
  // driver_signal_params/anomaly_signal_params.
  if ('driver_profile' in json || 'vehicle_profile' in json) {
    throw new Error(
      'importScenario: incompatible scenario shape — re-author: driver_profile/vehicle_profile removed (feature 009 signal-tier redesign).',
    )
  }
  requireString(json, 'id', label)
  requireString(json, 'version', label)
  requireString(json, 'type', label)
  requireObject(json, 'persona', label)
  const routeIntent = requireObject(json, 'route_intent', label)
  requireObject(routeIntent, 'rest_facility', `${label}: route_intent`)
  requireArray(routeIntent, 'segments', `${label}: route_intent`)
  requireObject(json, 'initial_state', label)
  const eventPresets = requireObject(json, 'event_presets', label)
  requireString(eventPresets, 'signal_duration_at_trigger', `${label}: event_presets`)
  requireNumber(json, 'total_duration_seconds', label)
  requireNumber(json, 'tick_seconds', label)
  requireArray(json, 'allowed_actions', label)
  return json as unknown as ScenarioDef
}

// ── Exports ──────────────────────────────────────────────────────────────────

/** Export one run as its docker `runs/<id>.json`-shaped RunLog. Built from an
 * explicit field allowlist (never a spread) so no settings/key material can
 * ever ride along, then guarded. Resolves active OR persisted (inactive)
 * runs via `resolveRunLog` (REHYDRATE task) — not session-active-only. */
export async function exportRun(runId: string): Promise<RunLogM2> {
  const log = await resolveRunLog(runId)
  const dump: RunLogM2 = {
    run_id: log.run_id,
    created_at: log.created_at,
    simulator_version: log.simulator_version,
    snapshot: log.snapshot,
    route_facts: log.route_facts,
    event_plan: log.event_plan,
    run_mode: log.run_mode,
    evidence_status: log.evidence_status,
    events: log.events,
    original_values: log.original_values,
    modified_values: log.modified_values,
    initial_parameters: log.initial_parameters,
    current_parameters: log.current_parameters,
    initial_hyperparameters: log.initial_hyperparameters,
    current_hyperparameters: log.current_hyperparameters,
    route_source: log.route_source,
    display_route: log.display_route,
    driver_profile: log.driver_profile,
    vehicle_profile: log.vehicle_profile,
    speed_profile: log.speed_profile,
    profile_overrides: log.profile_overrides,
  }
  assertNoSensitiveKeys(dump)
  return dump
}

/**
 * Export every PERSISTED run (active or inactive — REHYDRATE task closed the
 * former "session-active-only" scope gap: `resolveRunLog` reconstructs
 * inactive runs from IndexedDB exactly like Python's `_resolve_run_log` disk
 * fallback). Enumerates every header via `runsStore.listHeaders()` and
 * resolves+exports each via `exportRun`. Shape: `{ runs: RunLog[] }`
 * (documented choice — an object envelope rather than a bare array, so the
 * export is self-describing and mirrors the `{ runs: [...] }` shape already
 * used by `listRuns()`).
 */
export async function exportAllRuns(): Promise<{ runs: RunLogM2[] }> {
  const headers = await runsStore.listHeaders()
  const runs: RunLogM2[] = []
  for (const h of headers) {
    runs.push(await exportRun(h.id))
  }
  const dump = { runs }
  assertNoSensitiveKeys(dump)
  return dump
}

/** Export one package as its docker `packages/<id>/package.json`-shaped manifest. */
export async function exportPackage(id: string): Promise<PackageManifest> {
  const rec = await packagesStore.get(id)
  if (!rec) throw new Error(`exportPackage: package '${id}' not found`)
  const m = rec.manifest
  const dump: PackageManifest = {
    id: m.id,
    version: m.version,
    label: m.label,
    compatible_scenario_types: m.compatible_scenario_types,
    algorithm: m.algorithm,
    parameters: m.parameters,
    features: m.features,
    hyperparameters: m.hyperparameters,
    trigger_categories: m.trigger_categories,
    rules: m.rules,
    fire_control: m.fire_control,
    proposals: m.proposals,
    feedback_schema: m.feedback_schema,
    evidence_metrics: m.evidence_metrics,
  }
  assertNoSensitiveKeys(dump)
  return dump
}

/** Export one scenario as its docker `scenarios/<id>.json`-shaped def. */
export async function exportScenario(id: string): Promise<ScenarioDef> {
  const rec = await scenariosStore.get(id)
  if (!rec) throw new Error(`exportScenario: scenario '${id}' not found`)
  const d = rec.def
  const dump: ScenarioDef = {
    id: d.id,
    version: d.version,
    type: d.type,
    persona: d.persona,
    route_intent: d.route_intent,
    initial_state: d.initial_state,
    event_presets: d.event_presets,
    // Feature 009: driver_signal_params + anomaly_signal_params replace the
    // retired driver_profile/vehicle_profile.
    driver_signal_params: d.driver_signal_params,
    anomaly_signal_params: d.anomaly_signal_params,
    run_seed_default: d.run_seed_default,
    weather_risk: d.weather_risk,
    speed_profile: d.speed_profile,
    total_duration_seconds: d.total_duration_seconds,
    tick_seconds: d.tick_seconds,
    allowed_actions: d.allowed_actions,
    review_focus: d.review_focus,
    recovery_options: d.recovery_options,
    child_passenger: d.child_passenger,
    familiar_route: d.familiar_route,
    is_night: d.is_night,
  }
  assertNoSensitiveKeys(dump)
  return dump
}

// ── Imports ──────────────────────────────────────────────────────────────────

/**
 * Import a RunLog dump, validating it against the docker/`api/types` RunLog
 * shape and refusing (throwing) on any mismatch. Persists append-only via
 * `runsStore`: the header (RunLog minus events, plus a synthesized `status`
 * — status lives on the live RunState, not the persisted RunLog, so it
 * cannot be recovered from the dump; imported runs are marked `'completed'`
 * since they are being restored as historical evidence, matching the
 * read-only treatment past runs get elsewhere in this app) via `putHeader`,
 * then every event via `appendEvent` in original order so `seq` exactly
 * mirrors the source `events` array index.
 *
 * Import is a full restore, not a merge: if a run with this `run_id`
 * already has locally-persisted data (e.g. re-importing an export of a run
 * that also exists in this browser's IndexedDB — `run_events` is keyed on
 * `[runId, seq]` and `appendEvent` uses IDB `add`, which rejects duplicate
 * keys), any existing header/events/feedback for that id are cleared first
 * via `runsStore.deleteRun` (the one sanctioned event-deletion path) so the
 * import always lands cleanly and idempotently.
 *
 * ACTIVE-GUARD (S8.3 Important review finding): refuses to import over a
 * run_id that is currently ACTIVE in `../run_manager`'s in-memory registry
 * (`getRun(run_id) !== null`). Without this guard, the delete-then-rebuild
 * above would silently wipe an in-progress run's persisted append-only log
 * out from under it — a live tick()/action() call could then re-append to a
 * `seq` sequence that no longer matches what was just written, corrupting
 * the append-only chain. Nothing is deleted or written when this guard
 * fires.
 */
export async function importRun(json: unknown): Promise<void> {
  const log = validateRunLog(json)
  if (getRun(log.run_id) !== null) {
    throw new Error(
      `importRun: refusing to import over run '${log.run_id}' — it is currently active. `
        + 'Importing would clobber a live run\'s append-only log/seq-chain. '
        + 'Wait for the run to finish (or reload) before importing over it.',
    )
  }
  const { events, ...header } = log
  const runHeader: RunHeader = { id: log.run_id, status: 'completed', ...header }
  await runsStore.deleteRun(log.run_id)
  await runsStore.putHeader(runHeader)
  for (let seq = 0; seq < events.length; seq++) {
    const event = events[seq] as unknown as EvidenceEvent
    await runsStore.appendEvent(log.run_id, seq, event)
  }
}

/**
 * Import a PackageManifest dump, validating against `api/types`'s
 * `PackageManifest` shape and refusing on mismatch. Always persisted with
 * `origin: 'user'` — an import can never overwrite/masquerade as a builtin
 * default (see `storage/db.ts#seedDefaults`/`resetToDefaults`).
 */
export async function importPackage(json: unknown): Promise<void> {
  const manifest = validatePackageManifest(json)
  const rec: PackageRecord = {
    id: manifest.id,
    manifest,
    origin: 'user',
    strategy: manifest.algorithm.type,
  }
  await packagesStore.put(rec)
}

/**
 * Import a ScenarioDef dump, validating against `api/types`'s `ScenarioDef`
 * shape and refusing on mismatch. Always persisted with `origin: 'user'`
 * (see `importPackage` doc — same builtin-masquerade guard).
 */
export async function importScenario(json: unknown): Promise<void> {
  const def = validateScenarioDef(json)
  await scenariosStore.put({ id: def.id, def, origin: 'user' })
}
