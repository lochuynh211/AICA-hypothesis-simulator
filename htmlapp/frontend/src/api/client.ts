/**
 * API client seam — the ONE boundary the copied React presentation layer
 * calls through. Signatures are byte-identical to `app/frontend/src/api/client.ts`
 * (the frozen source of record): same exported function names, parameter
 * lists, and return types. Nothing in `src/components` or `src/state` may
 * import anything else from this module's surface.
 *
 * In the docker app, every one of these functions is a `fetch()` call to the
 * FastAPI backend. In the htmlapp offline build there is no backend: each
 * function is backed by an equivalent local computation (IndexedDB registries,
 * the local tick engine, evidence builder, etc.), wired in incrementally
 * across S2.x/S3.x/... slices.
 *
 * S2.6 implements the first 5 (health + package/scenario read paths). Every
 * other exported function is a stub — `throw new Error('not implemented: <name>')`
 * — purely so the copied components type-check against this module. Later
 * slices replace each stub body with a real implementation; NO signature
 * changes when that happens.
 *
 * Note: the frozen source imports the *runtime* classes `MapsError` and
 * `FeedbackValidationError` from './types' (used only inside the real
 * `routesAnalyze`/`submitFeedback` bodies). `MapsError` is imported as a
 * value (S7.3 implements `routesAnalyze`/`getRestSpots`); `FeedbackValidationError`
 * is now also imported as a value (S5.1 implements `submitFeedback`, throwing it
 * on validation failure — matching the docker client's 400 path). All *type*
 * imports referenced by the 21 signatures below are copied verbatim.
 */
import type {
  PackageSummary,
  PackageManifest,
  ScenarioSummary,
  ScenarioDef,
  RegistryError,
  RouteFacts,
  DisplayRoute,
  RouteEnvelope,
  RouteNotice,
  RoutePresetSummary,
  RunPlanResponse,
  RunState,
  RunSummary,
  SetupValue,
  TickResponse,
  RunLog,
  FeedbackSchema,
  FeedbackSubmitBody,
  FeedbackEvent,
  EvidenceReport,
  ProfileOverrides,
  RestSpot,
  ValidationError,
  Snapshot,
  RunConfig,
  InstantResult,
  FirePoint,
  ScoreSeriesPoint,
  SpikePoint,
  PreviewSegment,
  PreviewRestSpot,
  PreviewRestOption,
  PreviewError,
  PreviewOverrideEntry,
  DecisionResult,
  RecoveryStateT,
} from './types'
import { MapsError, FeedbackValidationError } from './types'
import { packageRegistry } from '../engine/services/package_registry'
import { scenarioRegistry } from '../engine/services/scenario_registry'
import { seedDefaults } from '../storage/db'
import { settingsStore } from '../storage/settings_store'
import { packagesStore } from '../storage/packages_store'
import { createJsModuleRunner, type EvaluateInput, type EvaluateOutput } from '../engine/algorithms/js_module'
import { DEFAULT_ROUTE_PRESETS } from '../data/routes'
import {
  analyzeRoute,
  analyzeRouteMaps,
  type RawRoute,
  type RawPlace,
  type RouteFactsFull,
} from '../engine/services/route_analysis'
import * as mapsClient from '../engine/services/maps_client'
import pkg from '../../package.json'
import {
  createDraft,
  regenerateDraft,
  getDraftEntry,
  type PackageManifestM2,
} from '../engine/run_plan'
import type { ScenarioDefM2 } from '../engine/event_plan'
import {
  createRun as engineCreateRun,
  tick as engineTick,
  action as engineAction,
  getRun as engineGetRun,
  resolveRunLog as engineResolveRunLog,
  getPriorTickState as engineGetPriorTickState,
  getScenario as engineGetScenario,
} from '../engine/run_manager'
import { runsStore } from '../storage/runs_store'
import {
  effectiveSchema,
  validate as validateFeedback,
  appendFeedback as engineAppendFeedback,
  resolveEventRef,
} from '../engine/services/feedback'
import { buildEvidenceReport } from '../engine/services/evidence'
import { renderEvidenceMarkdown } from '../engine/services/evidence_markdown'
import { advanceTick, buildAdapterContext, type TickState } from '../engine/tick_engine'
import { evaluate as evaluateAlgorithm } from '../engine/algorithms/adapter'
import { AlgorithmAdapterError } from '../engine/algorithms/errors'
import { startRecovery } from '../engine/recovery'

export type HealthStatus = {
  status: string
  service: string
  version: string
}

// ── Lazy first-launch seeding ────────────────────────────────────────────
//
// Registry reads must happen AFTER seedDefaults() has populated IndexedDB.
// ready() is idempotent (memoized promise) so every seam function can just
// `await ready()` without re-seeding on every call.

let _seeded: Promise<void> | null = null
function ready(): Promise<void> {
  return (_seeded ??= seedDefaults())
}

// ── Health ─────────────────────────────────────────────────────────────────

export async function getHealth(): Promise<HealthStatus> {
  return { status: 'ok', service: 'aica-htmlapp', version: pkg.version }
}

// ── Packages ───────────────────────────────────────────────────────────────

export async function listPackages(): Promise<{ packages: PackageSummary[]; errors: RegistryError[] }> {
  await ready()
  return packageRegistry.listSummaries()
}

export async function getPackage(id: string): Promise<PackageManifest> {
  await ready()
  return packageRegistry.get(id)
}

// ── User package upload (S9.2, offline-only seam) ──────────────────────────
//
// addUserPackage is NOT part of the frozen app/frontend/src/api/client.ts
// surface — the docker app has no upload UI, and the controller confirmed no
// copied component references any upload handler. It is a new offline-only
// seam that lets a developer add an UNTRUSTED `js_module` algorithm package
// (source text exporting `manifest` + `evaluate`) at runtime, gated by a
// smoke test so a broken/malformed package is never silently committed.
//
// The untrusted source is executed EXCLUSIVELY inside the sandboxed Web
// Worker (S9.1's `createJsModuleRunner`) — never on the main thread. Two
// worker round-trips happen against the SAME runner/worker instance:
//   1. `runner.getManifest()` triggers the worker's load handshake (module-
//      scope execution happens INSIDE the worker) and resolves with the
//      `manifest` the worker reported back as plain structured-clone data
//      (see `js_module.worker.ts#loadSource`). No `evaluate()` call happens
//      in this step.
//   2. `runner.evaluate(UPLOAD_SMOKE_INPUT)` calls `evaluate()` once with a
//      canned representative input — the untrusted, potentially-misbehaving
//      code path, still confined to the worker.
//
// SECURITY (S9.2 review fix): a prior version of this function additionally
// `import()`ed the raw source as a `data:` URL on the MAIN THREAD (via a
// since-removed `extractUserManifest` helper) purely to read `manifest`.
// Because ES module import executes ALL top-level module code, any top-level
// side effect in the uploaded source (fetch, DOM/window access, IndexedDB
// reads) ran with FULL MAIN-THREAD privileges before the worker-sandboxed
// smoke test ever started — defeating the isolation boundary the worker
// exists to provide. That helper is gone; `manifest` now comes exclusively
// from the worker's `loaded` message, so no untrusted source is ever
// imported/eval'd/`new Function`'d on the main thread.
//
// Strategy-seam reconciliation (S9.1 -> S9.2): every user-uploaded package is
// committed with `strategy: 'js_module'` AND `manifest.algorithm.type` FORCED
// to `'js_module'` (regardless of what the source declared), because
// `algorithms/adapter.ts` dispatches purely on `manifest.algorithm.type` —
// this is what routes the package to the async worker path
// (`evaluateJsModule`) instead of falling through to `unsupported_algorithm_type`.
//
// Commit gating: `packagesStore.put` is called ONLY after BOTH the manifest
// shape check and the smoke evaluate() succeed. Any failure (source fails to
// load, manifest missing required fields, evaluate() throws/rejects, or the
// response isn't a plain-object EvaluateOutput) throws and stores nothing.
// The smoke runner is always terminated (success or failure) — no leaked
// worker.

/** Minimal, representative probe input for the upload-time smoke test. */
const UPLOAD_SMOKE_INPUT: EvaluateInput = {
  context: {},
  parameters: {},
  hyperparameters: {},
  history: [],
  package_runtime_state: {},
}

/**
 * Loose shape guard for the required manifest fields addUserPackage/
 * packageRegistry.listSummaries actually need. Intentionally NOT a full
 * PackageManifest validation (parameters/features/rules/etc. may be empty
 * arrays or absent) — only the fields that would otherwise make the
 * registry/summary/adapter dispatch silently misbehave are required.
 */
function isWellFormedUserManifest(value: unknown): value is PackageManifest {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  if (typeof v['id'] !== 'string' || v['id'].length === 0) return false
  if (typeof v['version'] !== 'string') return false
  const algorithm = v['algorithm'] as Record<string, unknown> | undefined
  if (!algorithm || typeof algorithm['type'] !== 'string') return false
  const label = v['label'] as Record<string, unknown> | undefined
  if (!label || typeof label['en'] !== 'string' || typeof label['ja'] !== 'string') return false
  if (!Array.isArray(v['compatible_scenario_types'])) return false
  return true
}

/** EvaluateOutput is a loose `Record<string, unknown>` — any plain, non-array object qualifies. */
function isEvaluateOutputShape(value: unknown): value is EvaluateOutput {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Add an untrusted `js_module` package: parse its manifest, smoke-test its
 * `evaluate()` in a sandboxed Web Worker, and commit to IndexedDB only if
 * both succeed. Throws a validation Error (storing nothing) otherwise.
 */
export async function addUserPackage(source: string): Promise<PackageSummary> {
  await ready()

  // ── Every step below runs against ONE sandboxed worker instance (S9.1
  // runner). The untrusted source is loaded/executed exclusively inside
  // that worker — see the module comment above (S9.2 review fix). ─────────
  const runner = createJsModuleRunner(source)
  try {
    // ── 1. Manifest — obtained FROM the worker's load handshake, never via
    // a main-thread import of the untrusted source. ────────────────────────
    let manifest: unknown
    try {
      manifest = await runner.getManifest()
    } catch (exc) {
      throw new Error(
        `invalid_package_source: failed to load package source (${exc instanceof Error ? exc.message : String(exc)})`,
      )
    }
    if (!isWellFormedUserManifest(manifest)) {
      throw new Error(
        "invalid_package_manifest: package source does not export a well-formed 'manifest' " +
          '(requires string id/version, algorithm.type, label.en/ja, and an array compatible_scenario_types)',
      )
    }

    // ── 2. Smoke test evaluate() in the same sandboxed worker ──────────────
    let output: EvaluateOutput
    try {
      output = await runner.evaluate(UPLOAD_SMOKE_INPUT)
    } catch (exc) {
      throw new Error(
        `js_module_smoke_failed: package evaluate() failed during smoke test (${exc instanceof Error ? exc.message : String(exc)})`,
      )
    }
    if (!isEvaluateOutputShape(output)) {
      throw new Error(
        'js_module_smoke_failed: package evaluate() did not return a valid object result during smoke test',
      )
    }

    // ── 3. Commit (only reached if both checks above passed) ───────────────
    // Force algorithm.type='js_module' regardless of what the source declared
    // — see module comment above (strategy-seam reconciliation with adapter.ts's
    // dispatch-by-manifest.algorithm.type).
    const committedManifest: PackageManifest = {
      ...manifest,
      algorithm: { ...manifest.algorithm, type: 'js_module' },
    }
    await packagesStore.put({
      id: committedManifest.id,
      manifest: committedManifest,
      origin: 'user',
      strategy: 'js_module',
      source,
    })

    return {
      id: committedManifest.id,
      version: committedManifest.version,
      label: committedManifest.label,
      algorithm_type: committedManifest.algorithm.type,
      compatible_scenario_types: committedManifest.compatible_scenario_types,
    }
  } finally {
    // Always terminate the smoke runner — success or failure — no leaked worker.
    runner.terminate()
  }
}

// ── Scenarios ──────────────────────────────────────────────────────────────

export async function listScenarios(): Promise<{ scenarios: ScenarioSummary[]; errors: RegistryError[] }> {
  await ready()
  return scenarioRegistry.listSummaries()
}

export async function getScenario(id: string): Promise<ScenarioDef> {
  await ready()
  return scenarioRegistry.get(id)
}

// ── Route presets ────────────────────────────────────────────────────────
//
// Mirrors app/api/aica_api/routers/route_presets.py's list_route_presets /
// load_route_preset EXACTLY, swapping the on-disk routes/presets/*.json glob
// for the bundled DEFAULT_ROUTE_PRESETS array. Presets are read-only bundled
// defaults (no IndexedDB involved, same as the docker app which reads them
// straight off disk on every request — no persistence layer either side).
//
// listRoutePresets: summary keys are byte-for-byte the router's dict
// (id/label/start/end/distance_km/duration_min/summary), rounded the same
// way (distance_km to 1 decimal, duration_min to the nearest whole minute).
//
// loadRoutePreset: the router returns a RouteEnvelope built with the exact
// same maps-path shaping used by /api/routes/analyze's maps branch
// (_build_route_segments_maps + rest-spot/named-rest-spot derivation) — no
// additional analysis. That shaping already exists here as
// `analyzeRouteMaps` (S7.2 port of the same Python helper), so it's reused
// rather than duplicated. notices is always [] (the router never populates
// it for presets).

export async function listRoutePresets(): Promise<{ presets: RoutePresetSummary[] }> {
  const presets: RoutePresetSummary[] = DEFAULT_ROUTE_PRESETS.map((preset) => ({
    id: preset.id,
    label: preset.label,
    start: preset.start,
    end: preset.end,
    distance_km: Math.round((preset.raw_route.distance_m / 1000) * 10) / 10,
    duration_min: Math.round(preset.raw_route.duration_s / 60),
    summary: preset.raw_route.summary ?? '',
  }))
  return { presets }
}

export async function loadRoutePreset(presetId: string): Promise<RouteEnvelope> {
  const preset = DEFAULT_ROUTE_PRESETS.find((p) => p.id === presetId)
  if (!preset) {
    throw new Error(`Preset ${pyReprValue(presetId)} not found`)
  }

  const [alternative] = analyzeRouteMaps(
    [preset.raw_route as unknown as RawRoute],
    { [preset.raw_route.route_id]: preset.places as unknown as RawPlace[] },
    preset.start,
    preset.end,
  )

  return {
    route_source: 'maps',
    alternatives: [
      {
        route_id: alternative.route_id,
        summary: alternative.summary,
        route_facts: alternative.route_facts,
        display: alternative.display,
        notices: [],
      },
    ],
  }
}

// ── Routes / run-plans (M4 setup flow) ──────────────────────────────────────
//
// createRunPlan/regenerateRunPlan replicate app/api/aica_api/routers/run_plans.py's
// create_run_plan_endpoint / regenerate_run_plan_endpoint EXACTLY (body-shaping,
// validation order, error semantics), swapping the FastAPI route lookups for the
// local IndexedDB-backed registries and the FastAPI HTTPException(400/404) raises
// for a thrown Error. Field names in the constructed body/response are preserved
// byte-for-byte from the Python router.
//
// Error convention: app/frontend's `apiFetch` throws a plain `Error` on any
// non-2xx response (`err instanceof Error ? err.message : ...` is the only thing
// any consumer — see components/setup/PlanPreview.tsx — ever inspects). We
// preserve that shape (every failure here is a plain `Error`, always
// `instanceof Error`) while additionally exposing the router's `{detail,
// validation_errors}` body as typed fields on `RunPlanError` (mirroring the
// `FeedbackValidationError` pattern already established in `./types`), so
// tests / future UI can inspect the structured detail without parsing message
// strings.

/** Thrown by createRunPlan/regenerateRunPlan on any router-equivalent 400/404. */
export class RunPlanError extends Error {
  readonly validationErrors: ValidationError[]
  constructor(detail: string, validationErrors: ValidationError[] = []) {
    super(detail)
    this.name = 'RunPlanError'
    this.validationErrors = validationErrors
  }
}

/** Loose stand-in for Python's `!r` repr formatting used in router error messages. */
function pyReprValue(value: unknown): string {
  if (typeof value === 'string') return `'${value}'`
  return String(value)
}

// plan_id generation (S3.4): the Python router uses
// `plan_<YYYYMMDD-HHMMSS>_<6-hex>` (os.urandom + wall clock — the ONE place
// timestamps/randomness are allowed in the Python service). This engine must
// stay deterministic, so plan_id here is a monotonic in-memory counter
// instead; only uniqueness (never the exact format) is a contract any caller
// depends on.
let _planIdCounter = 0
function makePlanId(): string {
  _planIdCounter += 1
  return `plan_${String(_planIdCounter).padStart(6, '0')}`
}

const VALID_INITIAL_STATE_KEYS = ['drowsiness_level', 'fatigue_level']
const VALID_CONTEXT_KEYS = ['child_passenger', 'familiar_route']

/** Mirrors the router's initial_state key/range validation. */
function validateInitialStateBody(initialState: Record<string, unknown>): ValidationError[] {
  const errors: ValidationError[] = []
  for (const [key, value] of Object.entries(initialState)) {
    if (!VALID_INITIAL_STATE_KEYS.includes(key)) {
      errors.push({
        field: `initial_state.${key}`,
        message: `Unknown initial_state key ${pyReprValue(key)}. Valid keys: ['drowsiness_level', 'fatigue_level']`,
      })
    } else if (typeof value !== 'number') {
      errors.push({
        field: `initial_state.${key}`,
        message: `initial_state.${key} must be a number in [0, 100]; got ${pyReprValue(value)}`,
      })
    } else if (!(value >= 0 && value <= 100)) {
      errors.push({
        field: `initial_state.${key}`,
        message: `initial_state.${key} must be in [0, 100]; got ${pyReprValue(value)}`,
      })
    }
  }
  return errors
}

/** Mirrors the router's context_overrides key/type validation. */
function validateContextOverridesBody(contextOverrides: Record<string, unknown>): ValidationError[] {
  const errors: ValidationError[] = []
  for (const [key, value] of Object.entries(contextOverrides)) {
    if (!VALID_CONTEXT_KEYS.includes(key)) {
      errors.push({
        field: `context_overrides.${key}`,
        message: `Unknown context key ${pyReprValue(key)}. Valid keys: ['child_passenger', 'familiar_route']`,
      })
    } else if (typeof value !== 'boolean') {
      errors.push({
        field: `context_overrides.${key}`,
        message: `context_overrides.${key} must be a boolean; got ${pyReprValue(value)}`,
      })
    }
  }
  return errors
}

// ── Routes / maps analysis (S7.3) ────────────────────────────────────────
//
// routesAnalyze replicates app/api/aica_api/routers/routes.py's
// analyze_route_endpoint EXACTLY (envelope shaping, path-selection order,
// notice derivation), swapping the FastAPI HTTPException(404) for a thrown
// Error, the maps_client urllib calls for the browser SDK wrapper
// (./engine/services/maps_client — S7.3, loaded lazily via loadMapsSdk),
// and the FastAPI HTTPException(502, {error_type,message,suggestion}) for a
// thrown MapsError carrying the SAME structured, key-free body. The key is
// a local variable only inside this function — never stored, logged, or
// echoed into any error.
//
// Path selection mirrors the router's `use_maps` truthiness check via the
// frozen docker client.ts convention (`if (args.mapsKey) ...` — a falsy/
// empty key is treated as "no key", same as the docker fetch body builder
// omitting the field entirely), not Python's `is not None`. When the caller
// omits mapsKey, the persisted settings-store key is used as a fallback
// (the UI itself normally passes the key explicitly, matching docker).

/** Read the persisted Maps key from IndexedDB settings, or undefined if unset/empty. */
async function resolvePersistedMapsKey(): Promise<string | undefined> {
  const stored = await settingsStore.get('googleMapsApiKey')
  return typeof stored === 'string' && stored.length > 0 ? stored : undefined
}

/** Mirrors routes.py's `_derive_context`: highway if any segment road_class is HIGHWAY, else urban. */
function deriveMapsContext(raw: RawRoute): { route_type: string } {
  const segments = raw.segments ?? []
  return { route_type: segments.some((s) => s.road_class === 'HIGHWAY') ? 'highway' : 'urban' }
}

/** Mirrors routes.py's `_scale_scenario_rest_positions`: fallback for a Places failure. */
function scaleScenarioRestPositions(localFacts: RouteFactsFull, mapsTotalKm: number): RawPlace[] {
  const localTotal = localFacts.total_route_distance_km || 1.0
  return localFacts.rest_spot_positions.map((pos) => ({
    name: 'scenario_fallback_rest_stop',
    location: { lat: 0.0, lng: 0.0 },
    distance_along_route_m: (pos / localTotal) * mapsTotalKm * 1000.0,
    synthetic: true,
  }))
}

export async function routesAnalyze(args: {
  scenarioId: string
  mapsKey?: string
  start?: string
  end?: string
}): Promise<RouteEnvelope> {
  await ready()

  // ── Validate scenario first (before any Maps call) — 404-equivalent ────────
  const scenario = await scenarioRegistry.get(args.scenarioId)

  const key = args.mapsKey || (await resolvePersistedMapsKey())
  const useMaps = !!key && !!args.start && !!args.end

  if (!useMaps) {
    // ── Local path ─────────────────────────────────────────────────────────
    const routeFacts = analyzeRoute(scenario as unknown as ScenarioDefM2)
    return {
      route_source: 'local',
      alternatives: [
        {
          route_id: 'local',
          summary: scenario.id,
          route_facts: routeFacts,
          display: null,
          notices: [],
        },
      ],
    }
  }

  // ── Maps path ────────────────────────────────────────────────────────────
  // key/start/end are local variables only from here down — never stored,
  // logged, or included in any error.
  const start = args.start as string
  const end = args.end as string

  let rawRoutes: RawRoute[]
  try {
    rawRoutes = await mapsClient.directions(key as string, start, end)
  } catch (exc) {
    if (exc instanceof MapsError) throw exc
    throw new MapsError({
      error_type: 'directions_failure',
      message: exc instanceof Error ? exc.message : 'Directions request failed',
      suggestion: 'Check your API key and network connection, or use the local route fallback.',
    })
  }

  // Local fallback facts (pre-computed once for all alternatives) — mirrors
  // the router computing this once, not per failing Places alternative.
  const localFallbackFacts = analyzeRoute(scenario as unknown as ScenarioDefM2)

  const placesByRoute: Record<string, RawPlace[]> = {}
  const noticesByRoute: Record<string, RouteNotice[]> = {}
  for (const raw of rawRoutes) {
    const rid = raw.route_id
    const context = deriveMapsContext(raw)
    try {
      const places = await mapsClient.placesRestStops(key as string, raw.encoded_polyline ?? '', context)
      placesByRoute[rid] = places
      noticesByRoute[rid] = places.length === 0 ? ['no_rest_stops_found'] : []
    } catch {
      // Places failure degrades gracefully to scenario-scaled fallback — never
      // surfaced as a MapsError (mirrors the router: only Directions failures
      // are fatal; Places failures degrade the notice instead).
      const mapsTotalKm = raw.distance_m / 1000.0
      const scaled = scaleScenarioRestPositions(localFallbackFacts, mapsTotalKm)
      placesByRoute[rid] = scaled
      noticesByRoute[rid] = scaled.length > 0 ? ['rest_data_degraded'] : ['rest_data_unavailable']
    }
  }

  const alternatives = analyzeRouteMaps(rawRoutes, placesByRoute, start, end)

  return {
    route_source: 'maps',
    alternatives: alternatives.map((alt) => ({
      route_id: alt.route_id,
      summary: alt.summary,
      route_facts: alt.route_facts,
      display: alt.display,
      notices: noticesByRoute[alt.route_id] ?? [],
    })),
  }
}

export async function createRunPlan(args: {
  packageId: string
  scenarioId: string
  parameters?: Record<string, SetupValue>
  hyperparameters?: Record<string, SetupValue>
  presets?: Record<string, unknown>
  runMode?: string
  // M4: route selection (optional — omitted for the local path)
  routeId?: string
  routeSource?: string
  routeFacts?: RouteFacts | null
  displayRoute?: DisplayRoute | null
  // T009: sparse profile overrides (omit entirely when nothing changed)
  profiles?: ProfileOverrides | null
  // Numeric starting driver-state override (omit to use scenario default)
  initialState?: { drowsiness_level?: number; fatigue_level?: number }
  // Boolean scenario context overrides
  contextOverrides?: { child_passenger?: boolean; familiar_route?: boolean }
}): Promise<RunPlanResponse> {
  await ready()

  // ── Package + scenario lookup (mirror pkg_reg.get / sc_reg.get 400s) ──────
  let pkgManifest: PackageManifest
  try {
    pkgManifest = await packageRegistry.get(args.packageId)
  } catch {
    throw new RunPlanError(`Package ${pyReprValue(args.packageId)} not found or invalid`)
  }

  let scenario: ScenarioDef
  try {
    scenario = await scenarioRegistry.get(args.scenarioId)
  } catch {
    throw new RunPlanError(`Scenario ${pyReprValue(args.scenarioId)} not found or invalid`)
  }

  if (!packageRegistry.isCompatible(pkgManifest, scenario)) {
    throw new RunPlanError(
      `Package ${pyReprValue(args.packageId)} is not compatible with scenario ${pyReprValue(args.scenarioId)} (type=${pyReprValue(scenario.type)})`,
    )
  }

  // ── M4 route selection validation ──────────────────────────────────────────
  const routeSource = args.routeSource ?? 'local'
  if (routeSource === 'maps') {
    if (args.routeId == null) {
      throw new RunPlanError(
        "route_id is required when route_source is 'maps'. Pass the route_id from the chosen /api/routes/analyze alternative.",
      )
    }
    if (args.routeFacts == null) {
      throw new RunPlanError(
        "route_facts is required when route_source is 'maps'. A run cannot be created without route facts. " +
          'Pass the route_facts from the chosen /api/routes/analyze alternative.',
      )
    }
  }

  // Local path discards any client-supplied route_facts / display_route —
  // local analysis is used exclusively (createDraft derives it fresh).
  const routeFacts = routeSource === 'maps' ? (args.routeFacts ?? null) : null
  const displayRoute = routeSource === 'maps' ? (args.displayRoute ?? null) : null

  const profilesDict: Record<string, unknown> | null = args.profiles ?? null

  // Validate initial_state override keys and ranges.
  if (args.initialState != null) {
    const initErrors = validateInitialStateBody(args.initialState)
    if (initErrors.length > 0) {
      throw new RunPlanError('One or more initial_state values are invalid.', initErrors)
    }
  }

  // Validate context_overrides keys and types.
  if (args.contextOverrides != null) {
    const ctxErrors = validateContextOverridesBody(args.contextOverrides)
    if (ctxErrors.length > 0) {
      throw new RunPlanError('One or more context_overrides values are invalid.', ctxErrors)
    }
  }

  const planId = makePlanId()
  const { draft } = createDraft({
    planId,
    package: pkgManifest as unknown as PackageManifestM2,
    scenario: scenario as unknown as ScenarioDefM2,
    presets: args.presets ?? {},
    parameters: args.parameters ?? {},
    hyperparameters: args.hyperparameters ?? {},
    runMode: args.runMode ?? 'standard',
    routeFacts,
    routeSource: routeSource as 'maps' | 'local',
    displayRoute,
    profiles: profilesDict,
    initialState: args.initialState ?? null,
    contextOverrides: args.contextOverrides ?? null,
  })

  if (draft.validation_errors.length > 0) {
    throw new RunPlanError('One or more parameter/hyperparameter values are invalid.', draft.validation_errors)
  }

  return {
    plan_id: draft.plan_id,
    draft_plan: draft.draft_event_plan,
    effective_setup: draft.effective_setup,
    validation_errors: draft.validation_errors,
  }
}

export async function regenerateRunPlan(
  planId: string,
  args: {
    parameters?: Record<string, SetupValue>
    hyperparameters?: Record<string, SetupValue>
    presets?: Record<string, unknown>
  },
): Promise<RunPlanResponse> {
  if (getDraftEntry(planId) === null) {
    throw new RunPlanError(`Run plan ${pyReprValue(planId)} not found`)
  }

  let draft: ReturnType<typeof regenerateDraft>
  try {
    draft = regenerateDraft(planId, {
      presets: args.presets ?? {},
      parameters: args.parameters ?? {},
      hyperparameters: args.hyperparameters ?? {},
    })
  } catch (exc) {
    throw new RunPlanError(exc instanceof Error ? exc.message : String(exc))
  }

  if (draft.validation_errors.length > 0) {
    throw new RunPlanError('One or more parameter/hyperparameter values are invalid.', draft.validation_errors)
  }

  return {
    plan_id: draft.plan_id,
    draft_plan: draft.draft_event_plan,
    effective_setup: draft.effective_setup,
    validation_errors: draft.validation_errors,
  }
}

// ── Ephemeral instant-result preview (feature 009, US1) ─────────────────────
//
// runPreview replicates app/api/aica_api/services/preview.py's evaluate_preview
// EXACTLY: a headless, NON-persisting evaluation of a RunConfig that runs the
// full tick loop through the SAME tick engine (advanceTick/buildAdapterContext)
// + algorithm adapter (evaluate) as a persisted run (mirrors run_manager.ts's
// tick()), and returns an InstantResult. No EvidenceRecorder, no IndexedDB
// writes, no runsStore involvement — nothing here is ever persisted.
//
// User actions are driven by the SAME deterministic auto-choice as Python: the
// FIRST actionable "rest_required" proposal is accepted (auto-picking a
// recovery option + the nearest-ahead rest spot); every other actionable
// proposal is declined. Distinct trigger EPISODES are captured by rising edge
// (category-agnostic), matching the Review timeline. An AlgorithmAdapterError
// populates `error` and halts the loop — `fired` is never fabricated.
//
// Kept private to this module (mirrors preview.py's own private helpers):
// pyPreviewRepr, validatePreviewContextOverrides, pickPreviewRestSpot,
// derivePreviewHistory, PreviewEvent.

/** Loose stand-in for Python's `!r` repr formatting, scoped to preview errors. */
function pyPreviewRepr(value: unknown): string {
  if (typeof value === 'string') return `'${value}'`
  return String(value)
}

const _VALID_PREVIEW_CONTEXT_OVERRIDE_KEYS = ['child_passenger', 'familiar_route', 'is_night', 'weather_risk']

/**
 * Validate context_overrides keys/types for the preview path — mirrors
 * services/run_plan.py's `validate_context_overrides` (the NEWER, 4-key
 * Fixed-tier validator shared by POST /api/run-plans and POST
 * /api/runs/preview), which is distinct from this module's older
 * `validateContextOverridesBody` (2-key, M4 initial_state+context path used
 * by createRunPlan). Returns [] when valid.
 */
function validatePreviewContextOverrides(contextOverrides: Record<string, unknown>): ValidationError[] {
  const errors: ValidationError[] = []
  const sortedKeys = [..._VALID_PREVIEW_CONTEXT_OVERRIDE_KEYS].sort()
  for (const [key, value] of Object.entries(contextOverrides)) {
    if (!_VALID_PREVIEW_CONTEXT_OVERRIDE_KEYS.includes(key)) {
      errors.push({
        field: `context_overrides.${key}`,
        message: `Unknown context key ${pyPreviewRepr(key)}. Valid keys: [${sortedKeys.map((k) => pyPreviewRepr(k)).join(', ')}]`,
      })
    } else if (key === 'weather_risk') {
      if (typeof value !== 'number' || Number.isNaN(value)) {
        errors.push({
          field: `context_overrides.${key}`,
          message: `context_overrides.${key} must be a number in [0, 100]; got ${pyPreviewRepr(value)}`,
        })
      } else if (!(value >= 0 && value <= 100)) {
        errors.push({
          field: `context_overrides.${key}`,
          message: `context_overrides.${key} must be in [0, 100]; got ${pyPreviewRepr(value)}`,
        })
      }
    } else if (typeof value !== 'boolean') {
      errors.push({
        field: `context_overrides.${key}`,
        message: `context_overrides.${key} must be a boolean; got ${pyPreviewRepr(value)}`,
      })
    }
  }
  return errors
}

/**
 * Deterministically pick the nearest rest spot ahead of the current position.
 * Ported from preview.py's `_pick_rest_spot`: prefers named (non-synthetic)
 * rest spots; falls back to generic "Rest stop N" positions. Simplified vs.
 * getRestSpots (only ONE spot is needed to hand to startRecovery()).
 */
function pickPreviewRestSpot(routeFacts: RouteFactsFull, currentDistanceKm: number): RestSpot | null {
  const totalKm = routeFacts.total_route_distance_km || 120.0

  const named = (routeFacts.named_rest_spots ?? []).filter((s) => !s.synthetic)
  const candidates: [number, string][] = named.length > 0
    ? named.map((s): [number, string] => [s.position_km, s.name])
    : (routeFacts.rest_spot_positions ?? []).map((posKm, i): [number, string] => [posKm, `Rest stop ${i + 1}`])

  const ahead = candidates
    .filter(([km]) => km > currentDistanceKm)
    .sort(([kmA, nameA], [kmB, nameB]) => (kmA !== kmB ? kmA - kmB : nameA < nameB ? -1 : nameA > nameB ? 1 : 0))
  if (ahead.length === 0) return null

  const [km, name] = ahead[0]
  const routeFraction = totalKm ? Math.min(1.0, km / totalKm) : 1.0
  return { id: 'preview_auto_rest', label: { ja: name, en: name }, route_fraction: routeFraction }
}

/** In-memory-only event shape fed to derivePreviewHistory — never persisted. */
type PreviewEvent =
  | { kind: 'tick'; tick_index: number; trace: { tick_index: number; decision_result: DecisionResult } }
  | { kind: 'action'; tick_index: number; action: string; resulting_status: string }

type PreviewProposalHistory = {
  lastProposalTimeSec: number | null
  lastProposalCategory: string | null
  lastProposalResult: string | null
  proposalCountLast30Min: number
  acceptanceRateRecent: number
}

/**
 * Derive proposal_history and user_action_history from the preview's
 * in-memory event log. Ported from Python's `_derive_history` (imported by
 * preview.py from services/run_manager) — identical field semantics to
 * run_manager.ts's private `deriveHistory` (not exported, so this is a
 * parallel copy operating on the preview's own never-persisted PreviewEvent[]
 * rather than RunLogEvent[]).
 */
function derivePreviewHistory(
  events: PreviewEvent[],
  tickSeconds: number,
  currentSimSec: number,
): [PreviewProposalHistory, { tick_index: number; action: string }[]] {
  const firedProposalTicks: number[] = []
  const firedProposalCategories: string[] = []
  const actionByOrder: [number, string][] = []
  const userActionHistory: { tick_index: number; action: string }[] = []

  for (const event of events) {
    if (event.kind === 'tick') {
      const dr = event.trace.decision_result
      if (dr.fire_control.fired && dr.proposal !== null) {
        firedProposalTicks.push(event.tick_index)
        firedProposalCategories.push(dr.selected_category ?? '')
      }
    } else if (event.kind === 'action') {
      actionByOrder.push([event.tick_index, event.action])
      userActionHistory.push({ tick_index: event.tick_index, action: event.action })
    }
  }

  if (firedProposalTicks.length === 0) {
    return [
      {
        lastProposalTimeSec: null,
        lastProposalCategory: null,
        lastProposalResult: null,
        proposalCountLast30Min: 0,
        acceptanceRateRecent: 0.0,
      },
      userActionHistory,
    ]
  }

  const lastTick = firedProposalTicks[firedProposalTicks.length - 1]
  const lastCategory = firedProposalCategories[firedProposalCategories.length - 1]
  const lastTimeSec = lastTick * tickSeconds

  let lastProposalResult: string | null = null
  for (const [actionTick, act] of actionByOrder) {
    if (actionTick >= lastTick) {
      lastProposalResult = act
      break
    }
  }

  const windowStartSec = currentSimSec - 1800.0
  const proposalsInWindow = firedProposalTicks.filter((t) => t * tickSeconds >= windowStartSec).length

  let actedCount = 0
  let acceptedCount = 0
  let searchStart = 0
  for (const proposalTick of firedProposalTicks) {
    for (let i = searchStart; i < actionByOrder.length; i++) {
      if (actionByOrder[i][0] >= proposalTick) {
        actedCount += 1
        if (actionByOrder[i][1] === 'accept_rest') acceptedCount += 1
        searchStart = i + 1
        break
      }
    }
  }
  const acceptanceRate = actedCount > 0 ? acceptedCount / actedCount : 0.0

  return [
    {
      lastProposalTimeSec: lastTimeSec,
      lastProposalCategory: lastCategory,
      lastProposalResult,
      proposalCountLast30Min: proposalsInWindow,
      acceptanceRateRecent: acceptanceRate,
    },
    userActionHistory,
  ]
}

// Generous ceiling — real UC-01 routes complete within a few hundred ticks.
// Safety net against a pathological package/scenario combination that never
// completes (mirrors preview.py's _MAX_PREVIEW_TICKS).
const _MAX_PREVIEW_TICKS = 2000

/**
 * Ephemeral, non-persisting evaluation of a RunConfig — the offline mirror of
 * POST /api/runs/preview. Reproduces `evaluate_preview` byte-for-byte: same
 * tick engine + algorithm adapter as a real run, deterministic given
 * (config, restOptionId), and NEVER writes to any store.
 *
 * Throws a plain Error (mirroring RunPlanError's un-typed message convention)
 * for an unknown/incompatible package or scenario, an old-shape scenario,
 * invalid hyperparameter/profile/context overrides — the offline equivalent
 * of the router's 400 PreviewValidationError path.
 */
export async function runPreview(config: RunConfig, restOptionId?: string | null): Promise<InstantResult> {
  await ready()

  const overrides: Record<string, unknown> = { ...(config.hyperparameter_overrides ?? {}) }

  // ── Resolve + validate package/scenario compatibility ─────────────────
  let pkgManifest: PackageManifest
  try {
    pkgManifest = await packageRegistry.get(config.package_id)
  } catch {
    throw new Error(`Package ${pyPreviewRepr(config.package_id)} not found or invalid`)
  }

  let scenario: ScenarioDef
  try {
    scenario = await scenarioRegistry.get(config.scenario_id)
  } catch {
    throw new Error(
      `Scenario ${pyPreviewRepr(config.scenario_id)} not found or invalid (unknown id, or incompatible `
        + 'old-shape scenario — re-author with driver_signal_params and anomaly_signal_params).',
    )
  }

  if (!packageRegistry.isCompatible(pkgManifest, scenario)) {
    throw new Error(
      `Package ${pyPreviewRepr(config.package_id)} is not compatible with scenario `
        + `${pyPreviewRepr(config.scenario_id)} (type=${pyPreviewRepr(scenario.type)})`,
    )
  }

  // Validate context_overrides BEFORE createDraft — mirrors preview.py.
  const contextOverrides = (config.context_overrides ?? null) as Record<string, unknown> | null
  if (contextOverrides && Object.keys(contextOverrides).length > 0) {
    const ctxErrors = validatePreviewContextOverrides(contextOverrides)
    if (ctxErrors.length > 0) {
      throw new Error(
        'Invalid context overrides: ' + ctxErrors.map((e) => `${e.field}: ${e.message}`).join('; '),
      )
    }
  }

  // Selected Maps/preset route — honored only when route_source=="maps"
  // (mirrors preview.py; the local path always re-derives locally).
  const routeSource: 'maps' | 'local' = config.route_source === 'maps' && config.route_facts != null ? 'maps' : 'local'
  const selectedRouteFacts: RouteFacts | null = routeSource === 'maps' ? (config.route_facts as RouteFacts) : null
  const selectedDisplayRoute: DisplayRoute | null = routeSource === 'maps' ? (config.display_route ?? null) : null

  const routeKey = routeSource === 'maps'
    ? ((selectedRouteFacts as unknown as { route_source?: string } | null)?.route_source ?? 'maps')
    : 'local'
  const planId = `preview_${config.package_id}_${config.scenario_id}_${config.run_seed}_${routeKey}`

  const { draft, package: draftPkg, scenario: effectiveScenario } = createDraft({
    planId,
    package: pkgManifest as unknown as PackageManifestM2,
    scenario: scenario as unknown as ScenarioDefM2,
    presets: {},
    parameters: {},
    hyperparameters: overrides,
    runMode: 'standard',
    routeFacts: selectedRouteFacts,
    routeSource,
    displayRoute: selectedDisplayRoute,
    profiles: (config.profiles ?? null) as Record<string, unknown> | null,
    contextOverrides,
  })

  if (draft.validation_errors.length > 0) {
    throw new Error(
      'Invalid setup overrides: ' + draft.validation_errors.map((e) => `${e.field}: ${e.message}`).join('; '),
    )
  }

  const pkgM2 = draftPkg as unknown as PackageManifestM2
  const routeFacts = draft.route_facts as RouteFactsFull
  const eventPlan = draft.draft_event_plan

  const defaultHps: Record<string, unknown> = Object.fromEntries(pkgM2.hyperparameters.map((hp) => [hp.key, hp.default]))
  const hyperparameters: Record<string, unknown> = { ...defaultHps, ...overrides }
  const parameters: Record<string, unknown> = Object.fromEntries(pkgM2.parameters.map((p) => [p.key, p.default]))

  // Overrides diff: only keys BOTH declared on the manifest AND actually
  // changed from default.
  const overridesOut: PreviewOverrideEntry[] = []
  for (const [key, value] of Object.entries(overrides)) {
    if (key in defaultHps && defaultHps[key] !== value) {
      overridesOut.push({ key, default: defaultHps[key], value })
    }
  }

  // ── Tick loop state (mirrors run_manager's in-memory registry entry) ────
  let priorTickState: TickState | null = null
  let packageRuntimeState: Record<string, unknown> = {}
  let recovery: RecoveryStateT | null = null
  const events: PreviewEvent[] = []

  let firedAt: FirePoint | null = null
  const fires: FirePoint[] = []
  let fireActive = false
  let peakScore = 0.0
  let threshold: number | null = null
  const scoreSeries: ScoreSeriesPoint[] = []
  const spikes: SpikePoint[] = []
  const monotonySeries: ScoreSeriesPoint[] = []
  let monotonyThreshold: number | null = null

  const segments: PreviewSegment[] = []
  let segType: string | null = null
  let segStartMin = 0.0
  let lastElapsedMin = 0.0

  let completedMin: number | null = null
  let errorOut: PreviewError | null = null
  const restSpotsOut: PreviewRestSpot[] = []
  const restOptionsOut: PreviewRestOption[] = []

  for (let tickIndex = 0; tickIndex < _MAX_PREVIEW_TICKS; tickIndex++) {
    const tickState = advanceTick({
      priorState: priorTickState,
      tickIndex,
      eventPlan,
      routeFacts,
      scenario: effectiveScenario,
      recovery,
      runSeed: config.run_seed,
    })
    const recNext = tickState._recovery_next

    const dynamic = ((tickState.signals as { dynamic?: Record<string, unknown> })?.dynamic) ?? {}
    const elapsedMin = tickState.elapsed_seconds / 60.0

    // ── Track recovery-in-progress span (STOPPED ticks of the CURRENT
    //    recovery, using the PRE-tick recovery state) ─────────────────────
    if (recovery !== null && recovery.active && dynamic['motionState'] === 'STOPPED' && restOptionsOut.length > 0) {
      const cur = restOptionsOut[restOptionsOut.length - 1]
      if (cur.recovery_from_min === null) cur.recovery_from_min = elapsedMin
      cur.to_min = elapsedMin
    }

    if (recNext !== undefined) {
      recovery = recNext.active ? recNext : null
    }

    // ── Route segments (collapse contiguous same-type runs) ─────────────
    const curSegType = (dynamic['segmentType'] as string | undefined) ?? null
    if (segType === null) {
      segType = curSegType
      segStartMin = 0.0
    } else if (curSegType !== segType) {
      segments.push({ type: segType, from_min: segStartMin, to_min: lastElapsedMin })
      segType = curSegType
      segStartMin = lastElapsedMin
    }
    lastElapsedMin = elapsedMin

    // ── Completion (route fully driven, no recovery still holding position) ─
    if (tickState.completed && !(recovery && recovery.active)) {
      completedMin = elapsedMin
      break
    }

    // ── Build adapter context (identical to run_manager.tick()) ─────────
    const context = buildAdapterContext(tickState)
    context['simulation_time_sec'] = Number(tickState.elapsed_seconds)
    const [proposalHistory, userActionHistory] = derivePreviewHistory(
      events,
      Number(eventPlan.tick_seconds),
      Number(tickState.elapsed_seconds),
    )
    context['proposal_history'] = proposalHistory
    context['user_action_history'] = userActionHistory
    context['recovery_active'] = Boolean(recovery && recovery.active)

    let decision: DecisionResult
    try {
      decision = evaluateAlgorithm({
        manifest: pkgM2,
        context,
        parameters,
        hyperparameters,
        history: [],
        packageRuntimeState,
      })
    } catch (exc) {
      if (!(exc instanceof AlgorithmAdapterError)) throw exc
      const detail = exc.detail as { error_type?: string } | undefined
      const errorType = detail?.error_type ?? 'unknown_error'
      const prefix = `${errorType}: `
      const cleanMessage = exc.message.startsWith(prefix) ? exc.message.slice(prefix.length) : exc.message
      errorOut = { tick_index: tickIndex, error_type: errorType, message: cleanMessage }
      break
    }

    packageRuntimeState = decision.next_package_runtime_state

    events.push({
      kind: 'tick',
      tick_index: tickIndex,
      trace: { tick_index: tickIndex, decision_result: decision },
    })

    // ── Score series (rest_required_score per tick) ──────────────────────
    const scoresRec = decision.scores as Record<string, unknown>
    let scoreRaw = scoresRec['rest_required_score']
    if (scoreRaw == null) scoreRaw = decision.score ?? 0.0
    const score = Number(scoreRaw)
    scoreSeries.push({ t: tickIndex, score })
    peakScore = Math.max(peakScore, score)

    // ── Anomaly spike marker (aligned with the score point above) ───────
    if ((tickState.anomaly_events ?? []).includes(tickIndex)) {
      spikes.push({ t: tickIndex, time_min: elapsedMin })
    }

    // ── Threshold line (same 0-1 scale as score_series) ──────────────────
    const critRec = decision.criteria as Record<string, unknown>
    let critThreshold = critRec['rest_required_threshold']
    if (critThreshold == null) critThreshold = critRec['threshold_suggest'] ?? critRec['threshold_fire']
    if (critThreshold != null) threshold = Number(critThreshold)

    // ── Second curve: monotony-prevention (hybrid only) ──────────────────
    const monoScoreRaw = scoresRec['monotony_prevention_score']
    if (monoScoreRaw != null) {
      monotonySeries.push({ t: tickIndex, score: Number(monoScoreRaw) })
      const monoCrit = critRec['monotony_suggest_threshold']
      if (monoCrit != null) monotonyThreshold = Number(monoCrit)
    }

    // ── Fire-control: actionable proposal? (identical rule to run_manager) ─
    const proposalFired = decision.fire_control.fired && decision.proposal !== null
    let proposalIsActionable = proposalFired
      && decision.proposal!.options.some((opt) => effectiveScenario.allowed_actions.includes(opt))
    const recoveryActiveNow = Boolean(recovery && recovery.active)
    if (recoveryActiveNow && proposalIsActionable && decision.result_type === 'REST_PROPOSAL') {
      proposalIsActionable = false
    }

    // Trigger capture — one marker per actionable EPISODE (rising edge).
    if (proposalIsActionable) {
      if (!fireActive) {
        const strength = decision.candidates.find((c) => c.category === decision.selected_category)?.strength ?? null
        const fire: FirePoint = {
          category: decision.selected_category,
          strength,
          tick: tickIndex,
          time_min: elapsedMin,
        }
        fires.push(fire)
        if (firedAt === null) firedAt = fire
      }
      fireActive = true
    } else {
      fireActive = false
    }

    if (proposalIsActionable) {
      // Accept EACH rest proposal — never while a recovery is still running.
      const canAccept = !(recovery && recovery.active)
        && decision.selected_category === 'rest_required'
        && Boolean(effectiveScenario.recovery_options && effectiveScenario.recovery_options.length > 0)
        && decision.proposal!.options.includes('accept_rest')

      if (canAccept) {
        const recoveryOptions = effectiveScenario.recovery_options!
        let option = restOptionId ? (recoveryOptions.find((o) => o.id === restOptionId) ?? null) : null
        if (option === null) option = recoveryOptions[0]

        const spot = pickPreviewRestSpot(routeFacts, tickState.distance_km ?? 0.0)
        if (spot !== null) {
          const totalKm = routeFacts.total_route_distance_km || 120.0
          restSpotsOut.push({
            at_km: spot.route_fraction * totalKm,
            eta_min: (dynamic['nextRestSpotMin'] as number | undefined) ?? null,
          })
          restOptionsOut.push({ id: option.id, auto_chosen: true, recovery_from_min: null, to_min: null })
          recovery = startRecovery(option, spot)
          events.push({ kind: 'action', tick_index: tickIndex, action: 'accept_rest', resulting_status: 'playing' })
        } else {
          // No rest spot ahead of the current position — decline like any
          // other unfulfillable proposal.
          const decline = decision.proposal!.options.includes('decline') ? 'decline' : decision.proposal!.options[0]
          events.push({ kind: 'action', tick_index: tickIndex, action: decline, resulting_status: 'playing' })
        }
      } else if (
        !(effectiveScenario.recovery_options && effectiveScenario.recovery_options.length > 0)
        && decision.proposal!.options.includes('accept_rest')
        && restOptionsOut.length === 0
        && decision.selected_category === 'rest_required'
      ) {
        // Back-compat: a scenario with no recovery menu completes the run
        // immediately on accept_rest.
        completedMin = elapsedMin
        events.push({ kind: 'action', tick_index: tickIndex, action: 'accept_rest', resulting_status: 'completed' })
        break
      } else {
        const decline = decision.proposal!.options.includes('decline') ? 'decline' : decision.proposal!.options[0]
        events.push({ kind: 'action', tick_index: tickIndex, action: decline, resulting_status: 'playing' })
      }
    }

    priorTickState = tickState
  }

  // Close the final open segment.
  if (segType !== null) {
    segments.push({ type: segType, from_min: segStartMin, to_min: lastElapsedMin })
  }

  const fired = firedAt !== null && errorOut === null

  return {
    fired,
    fire: fired ? firedAt : null,
    fires: errorOut === null ? fires : [],
    peak_score: peakScore,
    threshold,
    score_series: scoreSeries,
    spikes: errorOut === null ? spikes : [],
    monotony_series: monotonySeries,
    monotony_threshold: monotonyThreshold,
    segments,
    rest_spot: restSpotsOut.length > 0 ? restSpotsOut[0] : null,
    rest_option: restOptionsOut.length > 0 ? restOptionsOut[0] : null,
    rest_spots: restSpotsOut,
    rest_options: restOptionsOut,
    completed_min: completedMin,
    seed: config.run_seed,
    overrides: overridesOut,
    error: errorOut,
  }
}

// ── Runs (S4.3) ──────────────────────────────────────────────────────────────
//
// createRun/tickRun/actRun/listRuns/getRun/getRunLog replicate
// app/api/aica_api/routers/runs.py's create_run_endpoint/tick_endpoint/
// action_endpoint/list_runs_endpoint/get_run_endpoint/get_run_log EXACTLY
// (response-shaping), swapping the FastAPI in-process run_manager +
// on-disk `runs/` directory for the local `../engine/run_manager` module +
// IndexedDB-backed `runsStore`.
//
// Run-id generation (S4.3): the Python router's `_make_run_id()` uses
// `run_<YYYYMMDD-HHMMSS>_<6-hex>` (wall clock + os.urandom — the ONE place
// timestamps/randomness are allowed in the Python service, exactly like
// `_make_plan_id()`). This engine must stay deterministic, so run_id here is
// a monotonic in-memory counter instead (mirrors `makePlanId` above) — the id
// is generated ONCE at creation time, OUTSIDE the deterministic tick loop, so
// only uniqueness (never the exact format) is a contract any caller depends on.
let _runIdCounter = 0
function makeRunId(): string {
  _runIdCounter += 1
  return `run_${String(_runIdCounter).padStart(6, '0')}`
}

// Error convention: run_manager's RunNotFoundError/ActionNotAllowedError are
// already `Error` subclasses (see engine/run_manager.ts) carrying a clean
// human message — exactly the shape app/frontend's `apiFetch` convention
// requires of every failure here (`instanceof Error`, `.message` inspectable).
// We deliberately let them propagate unwrapped rather than re-throwing a
// generic `Error`: no behavior is lost (still `instanceof Error`), and the
// original class name/message survives for anything that wants to
// distinguish "not found" from "not allowed".

export async function createRun(planId: string): Promise<RunState> {
  await ready()
  const runId = makeRunId()
  return engineCreateRun(planId, runId)
}

/**
 * Shapes TickOutcome into TickResponseSuccess | TickResponseError exactly as
 * runs.py's tick_endpoint does: the authoritative display position
 * (route_fraction/distance_km) and raw_state-derived fields (speed_kph/
 * motion_state/recovery_phase/active_content/is_traffic_jam/segment_type)
 * are attached to BOTH branches (Python attaches them even on the error
 * branch — see tick_endpoint @266-280); the error branch swaps
 * decision/completed for `error` (the AlgorithmError).
 */
export async function tickRun(runId: string): Promise<TickResponse> {
  const outcome = await engineTick(runId)

  const ts = outcome.tickState
  const routeFraction = ts ? ts.route_fraction : null
  const distanceKm = ts ? ts.distance_km : null
  // Feature 009: dynamic display fields now come from signals.dynamic;
  // active_content is dead (always null — the attention loop was retired).
  const signals = (ts ? (ts as unknown as { signals?: Record<string, unknown> }).signals : {}) ?? {}
  const dyn = ((signals as Record<string, unknown>)['dynamic'] as Record<string, unknown> | undefined) ?? {}
  const speedKph = (dyn['speedKph'] as number | undefined) ?? null
  const motionState = (dyn['motionState'] as string | undefined) ?? null
  const recoveryPhase = (dyn['recoveryPhase'] as string | undefined) ?? null
  const activeContent = null
  const isTrafficJam = (dyn['isTrafficJam'] as boolean | undefined) ?? null
  const segmentType = (dyn['segmentType'] as string | undefined) ?? null

  const algorithmError = outcome.algorithmError
  if (algorithmError !== null) {
    const response = {
      run_state: outcome.runState,
      error: algorithmError,
      paused: outcome.paused,
      tick_index: outcome.evaluatedTickIndex,
      route_fraction: routeFraction,
      distance_km: distanceKm,
      speed_kph: speedKph,
      motion_state: motionState,
      recovery_phase: recoveryPhase,
      active_content: activeContent,
      is_traffic_jam: isTrafficJam,
      segment_type: segmentType,
    }
    return response as TickResponse
  }

  const response = {
    run_state: outcome.runState,
    decision: outcome.decision,
    paused: outcome.paused,
    completed: outcome.completed,
    tick_index: outcome.evaluatedTickIndex,
    route_fraction: routeFraction,
    distance_km: distanceKm,
    speed_kph: speedKph,
    motion_state: motionState,
    recovery_phase: recoveryPhase,
    active_content: activeContent,
    is_traffic_jam: isTrafficJam,
    segment_type: segmentType,
  }
  return response as TickResponse
}

export async function actRun(
  runId: string,
  action: string,
  opts: { recovery_option_id?: string; rest_spot?: RestSpot } = {},
): Promise<RunState> {
  // run_manager.action() already performs every check action_endpoint does
  // (unknown run -> RunNotFoundError; not paused/no pending proposal or
  // disallowed action / missing recovery option+rest spot -> ActionNotAllowedError)
  // — see its docstring. Nothing left to pre-check at this seam.
  return engineAction(runId, action, {
    recoveryOptionId: opts.recovery_option_id ?? null,
    restSpot: opts.rest_spot ?? null,
  })
}

// ── Rest spots (S7.3) ────────────────────────────────────────────────────
//
// getRestSpots ports app/api/aica_api/routers/runs.py's rest_spots_endpoint
// FAITHFULLY (candidate source/filter/sort/spacing/cap/enrichment/ceiling/
// notice — see that function's docstring, mirrored step-by-step below),
// swapping the FastAPI HTTPException(404) for a thrown Error and
// get_run/get_prior_tick_state/get_scenario for their run_manager.ts
// equivalents. Field names and rounding are preserved byte-for-byte.
//
// mapsKey is accepted (to keep the signature identical to app/frontend's
// client.ts) but, exactly like Python's rest_spots_endpoint, it is never
// used for candidate selection — Python's own docstring says maps_key is
// "not yet wired". No Places/SDK call is made here.

const REST_SPOTS_MAX = 5
const REST_SPOTS_DEFAULT_MIN_DISTANCE_KM = 20.0

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

/** (position_km, name) candidate pairs, named source preferred over generic positions. */
function buildRestSpotCandidates(routeFacts: RouteFactsFull): [number, string][] {
  const named = routeFacts.named_rest_spots ?? []
  if (named.length > 0) {
    const realNamed = named.filter((s) => !s.synthetic)
    return realNamed.map((s) => [s.position_km, s.name])
  }
  return (routeFacts.rest_spot_positions ?? []).map((pos, i) => [pos, `Rest stop ${i + 1}`])
}

export async function getRestSpots(
  runId: string,
  mapsKey?: string,
  drowsinessCeiling?: number,
  minDistanceKm?: number,
): Promise<{ rest_spots: RestSpot[]; notice?: string | null }> {
  // mapsKey is part of the signature (parity with app/frontend/src/api/client.ts)
  // but intentionally unused — matches Python's rest_spots_endpoint, which
  // accepts maps_key and never wires it up. See module comment above.
  void mapsKey
  await ready()

  const rs = engineGetRun(runId)
  if (rs === null) {
    throw new Error(`Run '${runId}' not found`)
  }

  const routeFacts = rs.route_facts as RouteFactsFull
  const totalKm = routeFacts.total_route_distance_km || 120.0

  // ── Current driving state from prior tick (zero-defaults if no tick yet) ──
  const priorTick = engineGetPriorTickState(runId)
  let currentDistanceKm = 0.0
  let currentDrowsiness = 0.0
  let currentSpeedKph = 0.0
  if (priorTick !== null) {
    currentDistanceKm = priorTick.distance_km ?? 0.0
    // Feature 009: drowsiness from signals.simulated, speed from signals.dynamic.
    const signals = ((priorTick as unknown as { signals?: Record<string, unknown> }).signals ?? {}) as Record<string, unknown>
    const sim = (signals['simulated'] as Record<string, unknown> | undefined) ?? {}
    const dyn = (signals['dynamic'] as Record<string, unknown> | undefined) ?? {}
    currentDrowsiness = Number(sim['drowsiness'] ?? 0)
    currentSpeedKph = Number(dyn['speedKph'] ?? 0)
  }

  // ── Drowsiness growth rate and safety ceiling from scenario ───────────────
  const scenario = engineGetScenario(runId)
  let baseGrowthPerMin = 0.0
  let ceiling = drowsinessCeiling ?? 100.0
  const driverSignalParams = scenario != null
    ? (scenario as unknown as Record<string, unknown>)['driver_signal_params']
    : null
  if (driverSignalParams != null) {
    const dsp = driverSignalParams as { drowsiness_model: { base_growth_per_min: number } }
    baseGrowthPerMin = dsp.drowsiness_model.base_growth_per_min
    ceiling = drowsinessCeiling ?? scenario!.rest_drowsiness_ceiling ?? 100.0
  }

  const effectiveMinDistanceKm = minDistanceKm ?? REST_SPOTS_DEFAULT_MIN_DISTANCE_KM

  // ── Build candidate list (named when available, else generic positions) ──
  // mapsKey is accepted but intentionally unused here — see module comment
  // above (matches Python's rest_spots_endpoint, which never wires it up).
  const candidates = buildRestSpotCandidates(routeFacts)

  // ── Filter to spots strictly ahead of the current position ───────────────
  const ahead = candidates.filter(([pos]) => pos > currentDistanceKm)

  // ── Sort ascending by position_km ─────────────────────────────────────────
  ahead.sort((a, b) => a[0] - b[0])

  // ── Greedy spacing filter ─────────────────────────────────────────────────
  const spaced: [number, string][] = []
  let lastTakenKm: number | null = null
  for (const [posKm, name] of ahead) {
    if (lastTakenKm === null || posKm - lastTakenKm >= effectiveMinDistanceKm) {
      spaced.push([posKm, name])
      lastTakenKm = posKm
      if (spaced.length >= REST_SPOTS_MAX) break
    }
  }

  // ── Enrich each selected candidate ───────────────────────────────────────
  const spots: RestSpot[] = spaced.map(([posKm, name], i) => {
    const routeFraction = Math.min(1.0, posKm / totalKm)
    const spotDistanceKm = round1(Math.max(0.0, posKm - currentDistanceKm))

    let etaMin: number | null
    let reachable: boolean
    if (currentSpeedKph <= 0) {
      etaMin = null
      reachable = false
    } else {
      const rawEta = (spotDistanceKm / currentSpeedKph) * 60.0
      etaMin = round1(rawEta)
      const projectedDrowsiness = currentDrowsiness + baseGrowthPerMin * rawEta
      reachable = projectedDrowsiness <= ceiling
    }

    return {
      id: `rest_${i}`,
      label: { ja: name, en: name },
      route_fraction: routeFraction,
      distance_km: spotDistanceKm,
      eta_min: etaMin,
      reachable,
    }
  })

  const notice = spots.length === 0 ? 'no_rest_stops_found' : null
  return { rest_spots: spots, notice }
}

export async function listRuns(): Promise<{ runs: RunSummary[] }> {
  const headers = await runsStore.listHeaders()
  const runs: RunSummary[] = headers
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((h) => {
      const snapshot = h['snapshot'] as Snapshot | undefined
      // Prefer in-memory status for currently active runs (mirrors
      // list_runs_endpoint's `get_run(run_id)` override of the persisted status).
      const active = engineGetRun(h.id)
      return {
        run_id: h.id,
        created_at: (h['created_at'] as string | undefined) ?? '',
        package_id: snapshot?.package.id ?? '',
        scenario_id: snapshot?.scenario.id ?? '',
        status: active?.status ?? h.status,
      }
    })
  return { runs }
}

export async function getRun(runId: string): Promise<RunState> {
  const runState = engineGetRun(runId)
  if (runState === null) {
    throw new Error(`Run '${runId}' not found`)
  }
  return runState
}

export async function getRunLog(runId: string): Promise<RunLog> {
  // resolveRunLog mirrors Python's `_resolve_run_log`: active (in-memory
  // registry) → persisted (IndexedDB) → throws its own 404-equivalent Error
  // (same message convention this seam always used) when neither resolves.
  return engineResolveRunLog(runId)
}

// ── M5 Feedback ──────────────────────────────────────────────────────────────
//
// Mirrors runs.py's get_feedback_schema/post_feedback: resolve the run's
// RunLog to find its package_id, load that package's full manifest (for
// feedback_schema extras), and derive the effective schema from it — same
// resolution `_resolve_run_log` + `PackageRegistry(...).get(package_id)`
// does server-side. Works for active AND persisted (inactive) runs — mirrors
// Python's `_resolve_run_log` disk fallback (REHYDRATE task) — via
// `resolveRunLog`. Note the ACTUAL feedback append below (`engineAppendFeedback`)
// still requires the run to be active (matches Python's `append_feedback`,
// which is registry-only even though `_resolve_run_log`/`post_feedback`'s
// earlier steps support the disk fallback for event_ref/schema resolution).

async function resolveFeedbackPackage(runId: string): Promise<{ log: RunLog; pkg: PackageManifest }> {
  const log = await engineResolveRunLog(runId)
  const pkg = await packageRegistry.get(log.snapshot.package.id)
  return { log, pkg }
}

export async function getFeedbackSchema(runId: string): Promise<FeedbackSchema> {
  const { pkg } = await resolveFeedbackPackage(runId)
  return { fields: effectiveSchema(pkg) }
}

// ── M5/S8 Evidence export ─────────────────────────────────────────────────
//
// Mirrors runs.py's get_evidence/get_evidence_markdown (@619/@656): resolve
// the run's log via buildEvidenceReport (which itself resolves the run via
// ../engine/run_manager's resolveRunLog — active (in-memory registry) →
// persisted (IndexedDB), mirroring Python's `_resolve_run_log` disk fallback
// exactly; REHYDRATE task) and shape/derive the §14.2 report. `ui_language`
// defaults to `"bilingual"`, matching the router's
// `Query(default="bilingual", ...)` back-compat default for pre-M6 callers.
// getEvidenceMarkdown calls build_evidence_report then render_evidence_markdown
// with NO divergent computation, exactly like the Python router.

export async function getEvidence(runId: string, uiLanguage?: string): Promise<EvidenceReport> {
  return buildEvidenceReport(runId, uiLanguage ?? 'bilingual')
}

export async function getEvidenceMarkdown(runId: string, uiLanguage?: string): Promise<string> {
  const report = await buildEvidenceReport(runId, uiLanguage ?? 'bilingual')
  return renderEvidenceMarkdown(report)
}

/**
 * Validate + append a reviewer FeedbackEvent to the run log.
 *
 * Mirrors `post_feedback`'s order (runs.py @557): resolve the run log ->
 * resolve `target.event_ref` from the human anchor (tick_index/action) when
 * omitted -> effective schema -> validate the RESOLVED target -> append.
 * The resolved target (with event_ref set) is what gets validated AND what
 * is stored on the appended FeedbackEvent — never the raw, unresolved body.
 *
 * Throws FeedbackValidationError (with validationErrors list) on invalid
 * input, including when event_ref resolution fails (not found / ambiguous /
 * missing anchor field) — matching the docker client's 400 path exactly.
 * Nothing is appended in that case. On success, the event is appended
 * (append-only) and returned.
 */
export async function submitFeedback(
  runId: string,
  body: FeedbackSubmitBody,
): Promise<FeedbackEvent> {
  const { log, pkg } = await resolveFeedbackPackage(runId)
  const resolvedTarget = resolveEventRef(body.target, log)
  const resolvedBody: FeedbackSubmitBody = { ...body, target: resolvedTarget }
  const schema = effectiveSchema(pkg)
  const result = validateFeedback(schema, resolvedBody, log)
  if (!result.ok) {
    throw new FeedbackValidationError({ validation_errors: result.errors })
  }
  return engineAppendFeedback(runId, resolvedBody)
}
