/**
 * `iter_preview_ticks` — TS port of `app/api/aica_api/services/preview.py`'s
 * reusable, non-persisting preview tick-loop GENERATOR (feature 026, htmlapp
 * Combined export, slice C4 Task 4 — extracted while porting
 * `merged_quickview.py`, see that module's own doc for why).
 *
 * ── Why this file exists (a Task-4-time scope finding, disclosed) ──────────
 *
 * `merged_quickview.py::project()` needs a `PreviewFireEvent` (the tick_state
 * AT each rising-edge fire) to build a proposal per fire, plus the recovered
 * driver's tick_state at the end of each auto-accepted rest (`_post_rest_
 * tick_state`) to build the after-nap proposal. Neither is available from
 * `../worker/handlers/runs.ts`'s pre-existing `runsPreview` — a monolithic,
 * already-tested, already-reviewed function (feature 009/020, NOT part of
 * this C4 program) that only returns the FINAL accumulated `InstantResult`.
 * Python solved the identical problem the identical way: `services/
 * preview.py`'s own history is that `iter_preview_ticks` was EXTRACTED from
 * `evaluate_preview` (see that Python function's docstring, "Slice-2c Task
 * 1") into a reusable generator, with `evaluate_preview` reduced to a thin
 * drain-and-return wrapper. This file is the same extraction, done the same
 * way, for the same reason: a caller other than the trigger-only preview
 * endpoint (this port's merged quickview) needs a per-fire hook without a
 * second, independently-drifting copy of the tick loop.
 *
 * `../worker/handlers/runs.ts#runsPreview` is refactored (same commit) to
 * become a thin wrapper over `iterPreviewTicks`/`drainPreviewTicks` below,
 * preserving its exact prior behavior — verified by its own pre-existing
 * test suite (`tests/preview.test.ts`) staying green with ZERO test changes,
 * the same regression discipline Python's own extraction used (full-dict
 * equality against a pre-refactor characterization baseline).
 *
 * ── Scope decision, disclosed explicitly ────────────────────────────────
 *
 * This is real net-new ported logic beyond quickview.ts itself, touching a
 * file (`runs.ts`) outside Task 4's stated "Files:" list. Judged in scope
 * (not a stop-and-report candidate) because, unlike `routers/proposal.py`'s
 * `create_proposal_run` chain (the C4a gap — ~1,030 LOC of NET-NEW
 * orchestration across many previously-unported functions/models), every
 * PRIMITIVE this loop calls (`advanceTick`, `buildAdapterContext`,
 * `evaluate`, `startRecovery`, `createDraft`, `deriveProposalHistory`,
 * `packageRegistry`/`scenarioRegistry`) is ALREADY ported and already
 * exercised by `runsPreview`'s own passing tests — this file only re-shapes
 * an existing, working composition into a reusable generator plus three
 * small, additive extensions (yield-per-fire, `_post_rest_tick_state` stash,
 * `presets`/`initialState` threading), with the pre-existing test suite as
 * a strong regression backstop on the refactor itself. See
 * task-4-report.md's "The iter_preview_ticks gap" section for the full
 * judgment record.
 *
 * ── `dict.get(key, default)` / `pyGetDefault` audit for THIS file ──────────
 * Ported verbatim from `runsPreview`'s already-reviewed idiom choices (this
 * file changes none of them) — see that function's own history for the
 * per-site classification. No NEW two-arg `.get(key, default)` site is
 * introduced by the 3 additions.
 *
 * ── Hazard pass (this file; unchanged from `runsPreview`'s own, restated
 * here since the code now lives in a new file) ──────────────────────────
 * - Hazard 1 (banker's rounding): no bare `round()`/`Math.round` in this
 *   loop — score/threshold values are read and compared, never rounded.
 * - Hazard 2 (`sorted()`/`.sort()`): `pickPreviewRestSpot`'s two-stage
 *   `sortTuples` (km primary, name tie-break) — unchanged, moved verbatim.
 * - Hazard 3 (`//`/`%` floor division): none in this loop (elapsed_min is
 *   `/ 60.0`, a true float division, not floor/`%`).
 * - Hazard 4 (dict/insertion order): `fires`/`score_series`/`progress`/
 *   `monotony_series`/`segments`/`rest_spots`/`rest_options` are all plain
 *   arrays built by `.push()` in tick order — structurally ordered, not
 *   incidentally.
 * - Hazard 5 (bare `str(float)`): none — no float interpolated into a
 *   stringified message in this loop.
 * - Hazard 6 (`neumaierSum`): no `sum()` over floats.
 * - Hazard 7 (`pyFixed`/`:.Nf`): no format-spec float formatting.
 * - Hazard 8 (`isinstance(x, (int, float))` accepting `bool`): N/A, but not
 *   because there are no `isinstance` calls — an earlier revision of this
 *   comment said that and was wrong. `services/preview.py`'s
 *   `iter_preview_ticks` body has TWO (lines 278 and 282):
 *     route_facts if isinstance(route_facts, RouteFacts) else RouteFacts.model_validate(...)
 *     display_route if isinstance(display_route, DisplayRoute) else ...
 *   Both are pydantic model-coercion checks — "is this already the parsed
 *   model, or a raw dict needing validation?" — not numeric guards. Hazard 8
 *   is specifically about `(int, float)` accepting `bool` because `bool`
 *   subclasses `int`; neither of these tests a numeric type, so the hazard
 *   genuinely does not apply. The conclusion was right; the stated reason
 *   was not.
 *
 *   Verified: `grep -c isinstance app/api/aica_api/services/preview.py` -> 2,
 *   and `grep -cE "isinstance\([^,]+,\s*\(int,\s*float\)\)"` -> 0.
 */
import type {
  RouteFacts,
  DisplayRoute,
  PackageManifest,
  ScenarioDef,
  ValidationError,
  DecisionResult,
  RecoveryStateT,
  FirePoint,
  TriggerCategoryChain,
  ScoreSeriesPoint,
  SpikePoint,
  PreviewSegment,
  PreviewRestSpot,
  PreviewRestOption,
  PreviewError,
  PreviewOverrideEntry,
  ProgressPoint,
  PreviewTrafficJam,
  RestSpot,
} from '../../api/types'
import { packageRegistry } from './package_registry'
import { scenarioRegistry } from './scenario_registry'
import { createDraft, type PackageManifestM2 } from '../run_plan'
import type { ScenarioDefM2 } from '../event_plan'
import { advanceTick, buildAdapterContext, type TickState } from '../tick_engine'
import { deriveProposalHistory, deriveResponseSuppression } from '../proposal_history'
import { evaluate as evaluateAlgorithm } from '../algorithms/adapter'
import { AlgorithmAdapterError } from '../algorithms/errors'
import { startRecovery } from '../recovery'
import type { RouteFactsFull } from './route_analysis'

// ---------------------------------------------------------------------------
// Preview-only validation helpers — moved verbatim from
// `../worker/handlers/runs.ts` (no behavior change).
// ---------------------------------------------------------------------------

/**
 * Loose stand-in for Python's `!r` repr formatting, scoped to preview
 * errors. Every PRE-EXISTING call site here only ever repr's a `string`
 * (a package/scenario id, or a `context_overrides` KEY) — for which
 * `String(value)` and Python's `str.__repr__` already agree modulo
 * quoting, so the `typeof value === 'string'` branch was, and remains,
 * sufficient for those.
 *
 * `bool`/`None` handling added by feature 026 (htmlapp Combined export,
 * slice C4 Task 5): `validatePreviewContextOverrides`'s own `weather_risk`
 * VALUE (not key) can be an explicit `bool` — Python's `isinstance(value,
 * (int, float))` check for that field explicitly EXCLUDES `bool`
 * (`services/run_plan.py::validate_context_overrides`), so a rejected bool
 * reaches THIS repr slot for real, and `String(true)` (`'true'`, lowercase)
 * silently diverged from Python's `repr(True)` (`'True'`) — a real,
 * previously-undetected defect in this file's OWN `context_overrides`
 * rejection message (this function's only value-typed call site), caught
 * while porting `../merged/run_setup.ts#createMergedPlan` (C4 Task 5), which
 * reuses `validatePreviewContextOverrides` and surfaced it via a real
 * captured-Python-golden comparison — not merely inspected. Fixed here
 * (not worked around at the new call site) because it benefits BOTH: this
 * file's own preview endpoint's `context_overrides.weather_risk` rejection
 * message was ALSO wrong before this fix, just never asserted against a
 * literal string by any existing test.
 */
function pyPreviewRepr(value: unknown): string {
  if (typeof value === 'string') return `'${value}'`
  if (typeof value === 'boolean') return value ? 'True' : 'False'
  if (value === null || value === undefined) return 'None'
  return String(value)
}

const _VALID_PREVIEW_CONTEXT_OVERRIDE_KEYS = ['child_passenger', 'familiar_route', 'is_night', 'weather_risk']

/**
 * Exported (feature 026, htmlapp Combined export, slice C4 Task 5) — this is
 * actually a port of the SHARED `services/run_plan.py::validate_context_overrides`
 * (see that function's own docstring: "shared by routers/run_plans.py ... and
 * services/preview.py ... so both paths reject the identical set of bad
 * inputs"), captured here under a preview-scoped name because this file was
 * the first port to need it. `../merged/run_setup.ts#createMergedPlan` (which
 * calls the REAL `validate_context_overrides` on the Python side, via
 * `create_merged_plan_endpoint`) reuses this EXACT function under an import
 * alias rather than adding a THIRD independent copy — see py_repr.ts's own
 * module doc for the documented C2 cautionary tale about validator logic
 * drifting across duplicate copies once a fix lands in only one of them.
 * (`../worker/handlers/run_plans.ts#runPlansCreate` used to carry its own
 * stale, narrower 2-key copy — reconciled to reuse this exact function
 * instead, bugfix 2026-08-04, once it was confirmed to reject `is_night`/
 * `weather_risk` that the backend accepts.)
 */
export function validatePreviewContextOverrides(contextOverrides: Record<string, unknown>): ValidationError[] {
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

// How far AHEAD of the car the nearest auto-picked preview spot must be.
// Mirrors `_PREVIEW_REST_MIN_AHEAD_KM` in
// app/api/aica_api/services/preview.py, which itself mirrors
// `_REST_SPOTS_MIN_AHEAD_KM` in routers/runs.py "so the quickview and the
// live run offer comparable spots."
const PREVIEW_REST_MIN_AHEAD_KM = 20.0

export function pickPreviewRestSpot(routeFacts: RouteFactsFull, currentDistanceKm: number): RestSpot | null {
  const totalKm = routeFacts.total_route_distance_km || 120.0

  const named = (routeFacts.named_rest_spots ?? []).filter((s) => !s.synthetic)
  const candidates: [number, string][] = named.length > 0
    ? named.map((s): [number, string] => [s.position_km, s.name])
    : (routeFacts.rest_spot_positions ?? []).map((posKm, i): [number, string] => [posKm, `Rest stop ${i + 1}`])

  // Python's `sorted((km, name) for km, name in candidates if ...)` sorts a
  // plain tuple generator per stage — lexicographic comparison, km primary,
  // name as tie-break (divergence hazard #2). Mirrored explicitly here
  // rather than relying on a bare .sort() on [number, string] pairs.
  const sortTuples = (arr: [number, string][]): [number, string][] =>
    arr
      .slice()
      .sort(([kmA, nameA], [kmB, nameB]) => (kmA !== kmB ? kmA - kmB : nameA < nameB ? -1 : nameA > nameB ? 1 : 0))

  // Two-stage selection mirroring preview.py's _pick_rest_spot: stage 1
  // prefers candidates more than PREVIEW_REST_MIN_AHEAD_KM ahead; falls back
  // to "anything ahead" only when stage 1 is empty.
  let ahead = sortTuples(candidates.filter(([km]) => km > currentDistanceKm + PREVIEW_REST_MIN_AHEAD_KM))
  if (ahead.length === 0) {
    ahead = sortTuples(candidates.filter(([km]) => km > currentDistanceKm))
  }
  if (ahead.length === 0) return null

  const [km, name] = ahead[0]
  const routeFraction = totalKm ? Math.min(1.0, km / totalKm) : 1.0
  return { id: 'preview_auto_rest', label: { ja: name, en: name }, route_fraction: routeFraction }
}

/**
 * In-memory-only event shape fed to deriveProposalHistory — never persisted.
 *
 * `tick_state` carries the fired tick's OWN `elapsed_seconds` (mirroring
 * Python's `preview.py` `TickEvent(..., tick_state=tick_state, ...)`, which
 * stores the real per-tick `TickState`) — bugfix 2026-08-04: without it,
 * `deriveProposalHistory` falls back to `tick_index * tickSeconds`, which
 * back-dates every M2 proposal by exactly one tick (see that function's own
 * doc comment).
 */
type PreviewEvent =
  | { kind: 'tick'; tick_index: number; trace: { tick_index: number; decision_result: DecisionResult }; tick_state: { elapsed_seconds: number } }
  | { kind: 'action'; tick_index: number; action: string; resulting_status: string }

const _MAX_PREVIEW_TICKS = 2000

// ---------------------------------------------------------------------------
// iterPreviewTicks — the extracted generator
// ---------------------------------------------------------------------------

/** One actionable-proposal EPISODE (rising edge), yielded for reuse by a
 * caller other than the trigger-only preview drain (`runsPreview` /
 * `drainPreviewTicks` below) — the merged simulator's quickview projection.
 * Mirrors Python's `PreviewFireEvent` dataclass (`services/preview.py:64-86`)
 * field-for-field, camelCased. `decision.proposal` is guaranteed non-null on
 * every yielded event. `restSpot` is the nearest named/synthetic rest spot
 * ahead of the vehicle's current position at this tick — null if none is
 * ahead. */
export type PreviewFireEvent = {
  tickIndex: number
  tickState: TickState
  decision: DecisionResult
  elapsedMin: number
  routeFacts: RouteFactsFull
  effectiveScenario: ScenarioDefM2
  restSpot: RestSpot | null
}

export type IterPreviewTicksArgs = {
  packageId: string
  scenarioId: string
  hyperparameterOverrides: Record<string, unknown> | null
  runSeed: number
  restOptionId?: string | null
  profiles?: Record<string, unknown> | null
  contextOverrides?: Record<string, unknown> | null
  /** Setup pins (feature 020 quickview alignment) — folded into the draft's
   * effective scenario the same way `profiles`/`contextOverrides` are.
   * `null`/omitted (every pre-existing `runsPreview` caller) behaves exactly
   * as before this field existed. */
  initialState?: Record<string, unknown> | null
  routeSource?: 'maps' | 'local'
  routeFacts?: RouteFacts | null
  displayRoute?: DisplayRoute | null
  /** Feature 020 (Slice-2c) — additive, `null`/omitted by default: the same
   * `presets` shape `createDraft`/`POST /api/run-plans` accepts (e.g.
   * `{traffic_events: [...]}`), forwarded verbatim to `createDraft`. Lets a
   * caller other than `runsPreview` (the merged quickview, which paints an
   * ad-hoc traffic jam) drive a jam-painted preview. `null`/omitted resolves
   * to `{}` — the value every pre-existing caller already got hardcoded. */
  presets?: Record<string, unknown> | null
}

/** Extends `PreviewRestOption` with the merged-quickview-only stash of the
 * LAST stopped-recovery-tick's `TickState` — mirrors Python's private
 * `_post_rest_tick_state` dict key (`services/preview.py:429`), popped/
 * stripped before it ever reaches a trigger-only `InstantResult` (see
 * `drainPreviewTicks` below, mirroring `evaluate_preview`'s own strip). */
export type PreviewLoopRestOption = PreviewRestOption & { _post_rest_tick_state?: TickState }

/** The generator's own `return` value — same shape as `InstantResult`
 * except `rest_options` entries may still carry the private stash above
 * (present only while an in-progress recovery has produced at least one
 * STOPPED tick; absent otherwise). `drainPreviewTicks` strips it before
 * exposing the result as a genuine `InstantResult`; `quickview.ts` reads it
 * directly (that IS the purpose of this generator's extraction). */
/**
 * Declared with every field REQUIRED (unlike `InstantResult`, whose optional
 * markers exist only so pre-existing hand-built fixtures predating a field's
 * addition still typecheck) — this generator always sets every one of them,
 * every run, so a consumer (`quickview.ts::project`) can read them without
 * an extra non-null assertion at each site. `runsPreview`'s `as InstantResult`
 * cast at the end of `drainPreviewTicks`'s caller narrows this MORE-specific
 * shape to `InstantResult`'s looser one, which is always sound.
 */
export type PreviewLoopResult = {
  fired: boolean
  fire: FirePoint | null
  fires: FirePoint[]
  peak_score: number
  threshold: number | null
  score_series: ScoreSeriesPoint[]
  progress: ProgressPoint[]
  spikes: SpikePoint[]
  monotony_series: ScoreSeriesPoint[]
  monotony_threshold: number | null
  segments: PreviewSegment[]
  traffic_jams: PreviewTrafficJam[]
  rest_spot: PreviewRestSpot | null
  rest_option: PreviewRestOption | null
  rest_spots: PreviewRestSpot[]
  rest_options: PreviewLoopRestOption[]
  completed_min: number | null
  seed: number
  overrides: PreviewOverrideEntry[]
  error: PreviewError | null
}

/**
 * Mirrors `iter_preview_ticks` (`services/preview.py:183-721`). Runs the
 * headless, non-persisting preview tick loop, yielding a `PreviewFireEvent`
 * at each new actionable-proposal episode (rising edge), and RETURNING (via
 * the generator's own `return`, retrievable as `{done: true, value}` on the
 * final `.next()` — no `StopIteration.value` trick needed, unlike Python)
 * the full accumulated `PreviewLoopResult` once the loop completes.
 *
 * Setup (package/scenario resolution, overrides validation, draft creation)
 * happens lazily, on the FIRST `.next()` call — an `async function*`'s body
 * does not start executing until first pulled, mirroring Python generator
 * semantics exactly (the module doc's "generator bodies are lazy" note).
 *
 * @throws Error mirroring `PreviewValidationError` — unknown/incompatible
 *   package or scenario, invalid context overrides, invalid setup overrides,
 *   or (maps route source) a missing `routeFacts`.
 */
export async function* iterPreviewTicks(
  args: IterPreviewTicksArgs,
): AsyncGenerator<PreviewFireEvent, PreviewLoopResult, void> {
  const overrides: Record<string, unknown> = { ...(args.hyperparameterOverrides ?? {}) }

  let pkgManifest: PackageManifest
  try {
    pkgManifest = await packageRegistry.get(args.packageId)
  } catch {
    throw new Error(`Package ${pyPreviewRepr(args.packageId)} not found or invalid`)
  }

  let scenario: ScenarioDef
  try {
    scenario = await scenarioRegistry.get(args.scenarioId)
  } catch {
    throw new Error(
      `Scenario ${pyPreviewRepr(args.scenarioId)} not found or invalid (unknown id, or incompatible `
        + 'old-shape scenario — re-author with driver_signal_params and anomaly_signal_params).',
    )
  }

  if (!packageRegistry.isCompatible(pkgManifest, scenario)) {
    throw new Error(
      `Package ${pyPreviewRepr(args.packageId)} is not compatible with scenario `
        + `${pyPreviewRepr(args.scenarioId)} (type=${pyPreviewRepr(scenario.type)})`,
    )
  }

  const contextOverrides = (args.contextOverrides ?? null) as Record<string, unknown> | null
  if (contextOverrides && Object.keys(contextOverrides).length > 0) {
    const ctxErrors = validatePreviewContextOverrides(contextOverrides)
    if (ctxErrors.length > 0) {
      throw new Error(
        'Invalid context overrides: ' + ctxErrors.map((e) => `${e.field}: ${e.message}`).join('; '),
      )
    }
  }

  // Mirrors `iter_preview_ticks`'s OWN route resolution (services/preview.py:
  // 267-284): the generator itself requires routeFacts when routeSource is
  // 'maps', rather than the caller silently downgrading to 'local'. This is
  // a NEW call site (quickview.ts); `runsPreview`'s wrapper below continues
  // to pre-resolve its OWN routeSource before calling this generator (see
  // that function's own comment for why — a pre-existing, out-of-scope
  // divergence from Python this refactor does not change).
  const routeSource: 'maps' | 'local' = args.routeSource ?? 'local'
  let selectedRouteFacts: RouteFacts | null = null
  let selectedDisplayRoute: DisplayRoute | null = null
  if (routeSource === 'maps') {
    if (args.routeFacts == null) {
      throw new Error("route_facts is required when route_source is 'maps'.")
    }
    selectedRouteFacts = args.routeFacts
    selectedDisplayRoute = args.displayRoute ?? null
  }

  const routeKey = routeSource === 'maps'
    ? ((selectedRouteFacts as unknown as { route_source?: string } | null)?.route_source ?? 'maps')
    : 'local'
  const planId = `preview_${args.packageId}_${args.scenarioId}_${args.runSeed}_${routeKey}`

  const { draft, package: draftPkg, scenario: effectiveScenario } = createDraft({
    planId,
    package: pkgManifest as unknown as PackageManifestM2,
    scenario: scenario as unknown as ScenarioDefM2,
    presets: args.presets ?? {},
    parameters: {},
    hyperparameters: overrides,
    runMode: 'standard',
    routeFacts: selectedRouteFacts,
    routeSource,
    displayRoute: selectedDisplayRoute,
    profiles: (args.profiles ?? null) as Record<string, unknown> | null,
    contextOverrides,
    initialState: (args.initialState ?? null) as Record<string, unknown> | null,
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

  const overridesOut: PreviewOverrideEntry[] = []
  for (const [key, value] of Object.entries(overrides)) {
    if (key in defaultHps && defaultHps[key] !== value) {
      overridesOut.push({ key, default: defaultHps[key], value })
    }
  }

  let priorTickState: TickState | null = null
  let packageRuntimeState: Record<string, unknown> = {}
  let recovery: RecoveryStateT | null = null
  const events: PreviewEvent[] = []

  let firedAt: FirePoint | null = null
  const fires: FirePoint[] = []
  // The category of the episode currently in progress, or null when nothing
  // actionable is in flight. Holding the CATEGORY (not just a bool) is what
  // lets a monotony -> rest escalation on consecutive ticks split into two
  // (mirrors app/api/aica_api/services/preview.py's `fire_active: str | None`).
  let fireActive: string | null = null
  let peakScore = 0.0
  let threshold: number | null = null
  const scoreSeries: ScoreSeriesPoint[] = []
  const spikes: SpikePoint[] = []
  const monotonySeries: ScoreSeriesPoint[] = []
  let monotonyThreshold: number | null = null

  const segments: PreviewSegment[] = []
  let segType: string | null = null
  const progress: ProgressPoint[] = []
  // traffic_jams are derived from event_plan.traffic_events (not ticks) — built after the loop
  let segStartMin = 0.0
  let lastElapsedMin = 0.0

  let completedMin: number | null = null
  let errorOut: PreviewError | null = null
  const restSpotsOut: PreviewRestSpot[] = []
  const restOptionsOut: PreviewLoopRestOption[] = []

  for (let tickIndex = 0; tickIndex < _MAX_PREVIEW_TICKS; tickIndex++) {
    const tickState = advanceTick({
      priorState: priorTickState,
      tickIndex,
      eventPlan,
      routeFacts,
      scenario: effectiveScenario,
      recovery,
      runSeed: args.runSeed,
    })
    const recNext = tickState._recovery_next

    const dynamic = ((tickState.signals as { dynamic?: Record<string, unknown> })?.dynamic) ?? {}
    const elapsedMin = tickState.elapsed_seconds / 60.0

    if (recovery !== null && recovery.active && dynamic['motionState'] === 'STOPPED' && restOptionsOut.length > 0) {
      const cur = restOptionsOut[restOptionsOut.length - 1]
      if (cur.recovery_from_min === null) cur.recovery_from_min = elapsedMin
      cur.to_min = elapsedMin
      // Stash the LATEST stopped-tick state so the merged quickview can
      // project an AFTER-REST proposal from the recovered driver state
      // (feature 020 — clickable purple/green journey dots). Overwritten
      // every stopped tick, so it lands on the last one before the driver
      // resumes (the recovered drowsiness/fatigue). Stripped by
      // `drainPreviewTicks` before a trigger-only `InstantResult` is built —
      // mirrors Python's private `_post_rest_tick_state` key exactly.
      cur._post_rest_tick_state = tickState
    }

    if (recNext !== undefined) {
      recovery = recNext.active ? recNext : null
    }

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

    if (tickState.completed && !(recovery && recovery.active)) {
      completedMin = elapsedMin
      break
    }

    const context = buildAdapterContext(tickState)
    context['simulation_time_sec'] = Number(tickState.elapsed_seconds)
    const [proposalHistory, userActionHistory] = deriveProposalHistory(
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
      tick_state: { elapsed_seconds: Number(tickState.elapsed_seconds) },
    })

    const scoresRec = decision.scores as Record<string, unknown>
    let scoreRaw = scoresRec['rest_required_score']
    if (scoreRaw == null) scoreRaw = decision.score ?? 0.0
    const score = Number(scoreRaw)
    scoreSeries.push({ t: tickIndex, score })
    peakScore = Math.max(peakScore, score)

    // Feature 020: per-tick route-progress (distance axis alignment).
    // Mirrors Python: route_fraction = min(1, max(0, distance_km / total_km)); frac clipped.
    const totalKmForProgress = routeFacts.total_route_distance_km || 120.0
    const fracForProgress = totalKmForProgress > 0
      ? Math.min(1.0, Math.max(0.0, (tickState.distance_km ?? 0.0) / totalKmForProgress))
      : 0.0
    progress.push({ t: tickIndex, min: elapsedMin, frac: fracForProgress })

    if ((tickState.anomaly_events ?? []).includes(tickIndex)) {
      spikes.push({ t: tickIndex, time_min: elapsedMin })
    }

    const critRec = decision.criteria as Record<string, unknown>
    let critThreshold = critRec['rest_required_threshold']
    if (critThreshold == null) critThreshold = critRec['threshold_suggest'] ?? critRec['threshold_fire']
    if (critThreshold != null) threshold = Number(critThreshold)

    // ── Monotony threshold — read INDEPENDENTLY of the curve ────────────────
    // This used to be nested inside the `monoScoreRaw != null` branch, which
    // silently assumed a monotony threshold only exists where a monotony
    // CURVE does. NRI breaks that assumption by design: it bands ONE score
    // with two thresholds (rest above, monotony below), so it publishes a
    // monotony threshold and no second curve — emitting one would just draw a
    // duplicate of the rest curve on top of itself. Nested, its rule was
    // dropped and the strip showed a monotony fire with nothing to fire
    // against (mirrors app/api/aica_api/services/preview.py's fix).
    const monoScoreRaw = scoresRec['monotony_prevention_score']
    if (monoScoreRaw != null) {
      monotonySeries.push({ t: tickIndex, score: Number(monoScoreRaw) })
    }
    const monoCrit = critRec['monotony_suggest_threshold']
    if (monoCrit != null) monotonyThreshold = Number(monoCrit)

    const proposalFired = decision.fire_control.fired && decision.proposal !== null
    let proposalIsActionable = proposalFired
      && decision.proposal!.options.some((opt) => effectiveScenario.allowed_actions.includes(opt))
    const recoveryActiveNow = Boolean(recovery && recovery.active)
    if (recoveryActiveNow && proposalIsActionable && decision.result_type === 'REST_PROPOSAL') {
      proposalIsActionable = false
    }

    // ── Fire-control: post-response trigger de-duplication (fixbug-0804) ──
    // See docs/fixbug-0804-trigger-dedup-plan.md §5 — mirrors Python's gate
    // right after the recovery_active gate above.
    if (proposalIsActionable && decision.selected_category !== null) {
      const suppression = deriveResponseSuppression(
        events,
        Number(tickState.elapsed_seconds),
        Number(eventPlan.tick_seconds),
      )
      if (suppression[decision.selected_category as 'rest_required' | 'monotony_prevention']) {
        proposalIsActionable = false
      }
    }

    // Trigger capture — one marker per actionable EPISODE, matching the
    // Review timeline where the run pauses once per proposal then resumes.
    // An episode starts on a rising edge (nothing actionable -> actionable)
    // OR when the fired CATEGORY changes, so a long route shows a handful of
    // triggers rather than one per tick.
    //
    // The category clause is load-bearing: this used to be purely
    // category-agnostic (`fireActive: boolean`), and a run that escalates
    // monotony -> rest on CONSECUTIVE ticks (the normal shape now that both
    // packages fire two categories) was collapsed into a single monotony
    // marker. The rest proposal — the consequential one — never appeared on
    // the strip at all (mirrors app/api/aica_api/services/preview.py's fix).
    if (proposalIsActionable) {
      if (decision.selected_category !== fireActive) {
        const strength = decision.candidates.find((c) => c.category === decision.selected_category)?.strength ?? null
        const fire: FirePoint = {
          category: decision.selected_category,
          strength,
          tick: tickIndex,
          time_min: elapsedMin,
          // `DecisionResult.feature_contributions` stays `Record<string,
          // unknown>` (see that field's own comment in api/types.ts) so the
          // hybrid package's wider return type keeps assigning to it; every
          // algorithm that actually populates it produces the real
          // per-category-chain shape, which is what `FirePoint` (narrowed by
          // C5 Task 3 for `lib/review/chains.ts`) declares — cast, not widen.
          feature_contributions: (decision.feature_contributions ?? {}) as Record<string, TriggerCategoryChain>,
          criteria: decision.criteria,
        }
        fires.push(fire)
        if (firedAt === null) firedAt = fire
        // Rising edge — a fresh trigger episode. Reusable notification for
        // callers other than the trigger-only drain (the merged quickview
        // projection — feature 020/026); the drain itself (`runsPreview` via
        // `drainPreviewTicks`) ignores yielded values, mirroring Python's
        // `evaluate_preview` doing the same to its own generator.
        yield {
          tickIndex,
          tickState,
          decision,
          elapsedMin,
          routeFacts,
          effectiveScenario,
          restSpot: pickPreviewRestSpot(routeFacts, tickState.distance_km ?? 0.0),
        }
      }
      fireActive = decision.selected_category
    } else {
      fireActive = null
    }

    if (proposalIsActionable) {
      const canAccept = !(recovery && recovery.active)
        && decision.selected_category === 'rest_required'
        && Boolean(effectiveScenario.recovery_options && effectiveScenario.recovery_options.length > 0)
        && decision.proposal!.options.includes('accept_rest')

      if (canAccept) {
        const recoveryOptions = effectiveScenario.recovery_options!
        let option = args.restOptionId ? (recoveryOptions.find((o) => o.id === args.restOptionId) ?? null) : null
        if (option === null) option = recoveryOptions[0]

        const spot = pickPreviewRestSpot(routeFacts, tickState.distance_km ?? 0.0)
        if (spot !== null) {
          const totalKm = routeFacts.total_route_distance_km || 120.0
          // INVARIANT — the third singular/plural alias pair in
          // `MergedInstantResult` (models/merged_run.py:222/235/236):
          // `fire`/`fires`, `rest_spot`/`rest_spots`, `rest_option`/`rest_options`.
          // In each, the singular IS the same object as `plural[0]`, so anything
          // written onto that entry also appears on the singular. Python gets away
          // with mutating in place because pydantic silently filters undeclared
          // keys on validation; this port has no such filter and must not add
          // fields here.
          //
          // The sibling pair `rest_option` already shipped a real bug from exactly
          // this — an `after_rest_proposal` written onto `rest_options[0]` surfaced
          // on `rest_option` too, caught only by a golden key-set mismatch. These
          // entries stay strictly two-field for the same reason. If you need to
          // attach anything per-rest-spot, build a fresh object rather than
          // extending this one.
          restSpotsOut.push({
            at_km: spot.route_fraction * totalKm,
            eta_min: (dynamic['nextRestSpotMin'] as number | undefined) ?? null,
          })
          restOptionsOut.push({ id: option.id, auto_chosen: true, recovery_from_min: null, to_min: null })
          recovery = startRecovery(option, spot)
          events.push({ kind: 'action', tick_index: tickIndex, action: 'accept_rest', resulting_status: 'playing' })
        } else {
          const decline = decision.proposal!.options.includes('decline') ? 'decline' : decision.proposal!.options[0]
          events.push({ kind: 'action', tick_index: tickIndex, action: decline, resulting_status: 'playing' })
        }
      } else if (
        !(effectiveScenario.recovery_options && effectiveScenario.recovery_options.length > 0)
        && decision.proposal!.options.includes('accept_rest')
        && restOptionsOut.length === 0
        && decision.selected_category === 'rest_required'
      ) {
        completedMin = elapsedMin
        events.push({ kind: 'action', tick_index: tickIndex, action: 'accept_rest', resulting_status: 'completed' })
        break
      } else if (decision.selected_category === 'rest_required') {
        // A rest proposal this loop cannot accept (e.g. one fired during an
        // active recovery) is still ANSWERED — the auto-drive's job is to
        // resolve rest proposals so the run reaches its end. Mirrors
        // preview.py's `elif decision.selected_category == "rest_required"`.
        const decline = decision.proposal!.options.includes('decline') ? 'decline' : decision.proposal!.options[0]
        events.push({ kind: 'action', tick_index: tickIndex, action: decline, resulting_status: 'playing' })
      } else if (decision.proposal!.options.includes('acknowledge')) {
        // A MONOTONY proposal is TAKEN UP — the projected driver accepts the
        // content, which is what the projection then renders (the service and
        // song list attached to this fire). Mirrors preview.py's
        // `elif "acknowledge" in decision.proposal.options`.
        //
        // Recording `acknowledge` (NOT `decline`) matters beyond bookkeeping:
        // the response reaches the algorithm through
        // `proposal_history.lastProposalResult`, AND feeds the fixbug-0804
        // dedup gate (`deriveResponseSuppression`) above — acknowledge
        // suppresses monotony until a rest proposal fires, whereas a wrong
        // `decline` only suppresses for 30 min and then lets the SAME monotony
        // proposal re-fire, producing a duplicate quickview fire the live run
        // never shows. It must be `acknowledge`, not `decline`: declining is
        // the driver refusing the content, which is not what the projection
        // goes on to display; the merged run records the same acknowledge when
        // the reviewer picks a service for a monotony opportunity, so the
        // projection and the run model the same driver.
        events.push({ kind: 'action', tick_index: tickIndex, action: 'acknowledge', resulting_status: 'playing' })
      }
    }

    priorTickState = tickState
  }

  if (segType !== null) {
    segments.push({ type: segType, from_min: segStartMin, to_min: lastElapsedMin })
  }

  // Feature 020: traffic-jam ranges derived from event_plan.traffic_events (same axis as segments).
  const trafficJams: PreviewTrafficJam[] = (
    (eventPlan as unknown as { traffic_events?: { start_min: number; duration_min: number }[] }).traffic_events ?? []
  ).map((ev) => ({ from_min: ev.start_min, to_min: ev.start_min + ev.duration_min }))

  const fired = firedAt !== null && errorOut === null

  return {
    fired,
    fire: fired ? firedAt : null,
    fires: errorOut === null ? fires : [],
    peak_score: peakScore,
    threshold,
    score_series: scoreSeries,
    progress: progress,
    spikes: errorOut === null ? spikes : [],
    monotony_series: monotonySeries,
    monotony_threshold: monotonyThreshold,
    segments,
    traffic_jams: trafficJams,
    rest_spot: restSpotsOut.length > 0 ? restSpotsOut[0] : null,
    rest_option: restOptionsOut.length > 0 ? restOptionsOut[0] : null,
    rest_spots: restSpotsOut,
    rest_options: restOptionsOut,
    completed_min: completedMin,
    seed: args.runSeed,
    overrides: overridesOut,
    error: errorOut,
  }
}

/**
 * Mirrors `evaluate_preview`'s own "pure drain-and-return" pattern
 * (`services/preview.py:724-818`): advances `iterPreviewTicks` to
 * completion, discarding every yielded `PreviewFireEvent` (for OTHER
 * callers — `quickview.ts`, which iterates the generator directly for its
 * own per-fire hook, exactly as `merged_quickview.py::project` does), and
 * returns the generator's own accumulated `PreviewLoopResult` unchanged.
 *
 * Does NOT strip `_post_rest_tick_state` — that is `runsPreview`'s job
 * (mirrors Python: the strip lives in `evaluate_preview` itself, "so it
 * never leaks into the trigger-only InstantResult response").
 */
export async function drainPreviewTicks(args: IterPreviewTicksArgs): Promise<PreviewLoopResult> {
  const gen = iterPreviewTicks(args)
  let step = await gen.next()
  while (!step.done) {
    step = await gen.next()
  }
  return step.value
}
