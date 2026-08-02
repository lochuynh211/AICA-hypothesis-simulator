/**
 * Merged-run SETUP endpoints — TS port of the setup half of
 * `app/api/aica_api/routers/merged_runs.py` (feature 026, htmlapp Combined
 * export, slice C4 Task 5):
 *
 *   - `_make_trigger_run_id` / `_make_merged_plan_id` (id minting, 101-112)
 *   - `_readable_error_text` (115-139)
 *   - `_build_quickview_route_facts` (363-441)
 *   - the four endpoint BODIES: `create_merged_plan_endpoint` (POST
 *     /api/merged-runs/plan, 216-360), `create_merged_run_endpoint` (POST
 *     /api/merged-runs, 681-709), `get_merged_run_endpoint` (GET
 *     /api/merged-runs/{id}, 712-753), `list_merged_runs_endpoint` (GET
 *     /api/merged-runs, 756-781).
 *
 * Ported as plain functions — HTTP framing (status codes, path params,
 * FastAPI `Depends`) is a LATER task's job (Task 9's handlers), not this
 * one's. Every raise site mirrors its Python `HTTPException` by throwing
 * `ProposalHttpError` (`../proposal/orchestrator/create_run.ts`) with the
 * SAME status + detail shape, reusing/extending that file's existing
 * `ProposalHttpDetail` union (see its own module doc, "WIDENED AN EIGHTH
 * TIME") rather than inventing a parallel error scheme, per the brief.
 *
 * ── Step 1 — enumeration (written BEFORE porting, per the brief) ──────────
 *
 * `createMergedPlan` (create_merged_plan_endpoint):
 *   400 string   — package_id unknown/invalid:
 *                  `Package {id!r} not found or invalid`
 *   400 string   — scenario_id unknown/invalid:
 *                  `Scenario {id!r} not found or invalid`
 *   400 string   — package/scenario incompatible:
 *                  `Package {id!r} is not compatible with scenario {id!r} (type={type!r})`
 *   404 string   — route_preset_id given but unknown (propagates UNCAUGHT
 *                  from `loadRoutePreset`, a DIFFERENT status code than
 *                  every other raise in this function):
 *                  `Route preset not found. / ルートプリセットが見つかりません。`
 *   400 PlanValidationDetail — one or more `initial_state` entries invalid
 *                  (3 sub-branches: unknown key / wrong type / out of range)
 *   400 PlanValidationDetail — one or more `context_overrides` entries
 *                  invalid (4 sub-branches: unknown key / weather_risk wrong
 *                  type / weather_risk out of range / other key not boolean)
 *   400 PlanValidationDetail — one or more parameter/hyperparameter values
 *                  invalid (from `createDraft`'s own `validation_errors`)
 *   success      — `{ plan_id }`
 *
 * `buildQuickviewRouteFacts` (_build_quickview_route_facts): the SAME first
 *   three 400s + the 404 as above (package/scenario/compat/preset-not-found)
 *   — shares `resolvePaintedRoute` below with `createMergedPlan` for this
 *   part; has NO initial_state/context_overrides/hyperparameter validation
 *   of its own (that lives on `MergedQuickviewBody`'s own path, C4 Task 4).
 *
 * `createMergedRun` (create_merged_run_endpoint):
 *   400 string   — unknown trigger_plan_id, caught from the trigger-side
 *                  `createRun`'s thrown `Error` (Python: caught `ValueError`,
 *                  `str(exc)`): `Unknown plan_id {id!r}` (or one of two OTHER
 *                  ValueError messages `createRun` can throw — see that
 *                  function's own doc comment; this port catches ANY thrown
 *                  Error from it, matching Python's `except ValueError`
 *                  scope, since all three of `run_manager.create_run`'s own
 *                  raises are ValueError)
 *   success      — `{ merged_run_id, trigger_run_id }`
 *
 * `getMergedRun` (get_merged_run_endpoint):
 *   404 string   — unknown merged_run_id: `Merged run {id!r} not found`
 *   success      — `{ handle, trigger_log, proposal_logs }` — `trigger_log`
 *                  best-effort `null` if the trigger run is unresolvable
 *                  (never raises for this); `proposal_logs` best-effort,
 *                  entries that resolve to `null` are skipped.
 *
 * `listMergedRuns` (list_merged_runs_endpoint): no raises at all — a listing
 *   helper, not a validator; corrupt/unusable rows are silently skipped.
 *
 * ── The three-way `.get` distinction — full audit ──────────────────────────
 * `F=app/api/aica_api/routers/merged_runs.py; for range in "101,105"
 * "108,112" "115,139" "216,360" "363,441" "681,709" "712,753" "756,781"; do
 * sed -n "${range}p" "$F"; done | grep -n '\.get('` (the 8 ported Python
 * spans, run against the real file) -> 12 raw hits: 4 are
 * `pkg_reg.get(...)`/`sc_reg.get(...)` REGISTRY method calls (id ->
 * `Manifest | None`, not Python's `dict.get(key, default)` idiom this
 * section classifies — already handled via the pre-existing
 * try/catch-on-throw convention `resolvePaintedRoute` reuses from
 * `../worker/handlers/run_plans.ts#runPlansCreate`; 2 hits each, duplicated
 * once across `create_merged_plan_endpoint`/`_build_quickview_route_facts`);
 * 2 are the `@router.get(...)` FastAPI route DECORATOR on
 * `get_merged_run_endpoint`/`list_merged_runs_endpoint` (not a `.get()` call
 * at all — a grep-pattern false positive, disclosed rather than silently
 * dropped from the count). The remaining 6 are real `dict.get()` sites,
 * classified:
 *   `pyGetDefault` (two-arg `.get(key, default)`) — 2 sites:
 *     - `create_merged_plan_endpoint`'s `presets.get("traffic_events", [])`
 *       -> `createMergedPlan`'s own `pyGetDefault(presets, 'traffic_events', [])`.
 *     - `list_merged_runs_endpoint`'s `data.get("merged_run_id", path.stem)`
 *       -> `summarizeMergedRunRow`'s `pyGetDefault(data, 'merged_run_id', key)`.
 *   One-arg `.get(key)` (no default, `undefined`/`None` if absent) + NO
 *   truthy `or` — 2 sites:
 *     - `_readable_error_text`'s `detail.get("message")` (dict branch) ->
 *       `readableErrorText`'s plain `detail['message']` property read.
 *     - `list_merged_runs_endpoint`'s `data.get("trigger_run_id")` ->
 *       `summarizeMergedRunRow`'s plain `data['trigger_run_id']` read,
 *       `?? null` to normalize `undefined` (absent) to `null` (matches
 *       Python's `None` either way — a present `null` passes through
 *       unchanged under both).
 *   `.get()` + truthy `or` (`pyTruthy`) — 2 sites:
 *     - `_readable_error_text`'s `first.get("message") or first.get("msg")`
 *       -> `readableErrorText`'s `pyTruthy(message) ? message : first['msg']`.
 *     - `list_merged_runs_endpoint`'s `len(data.get("proposal_run_ids") or
 *       [])` -> `summarizeMergedRunRow`'s `pyTruthy(rawIds) ? rawIds : []`.
 *   Total: 2 two-arg-default sites, 2 one-arg-(no-`or`) sites, 2
 *   `.get()`-plus-`or` sites — 6 real dict `.get()` sites in all.
 *
 * ── Hazard pass ─────────────────────────────────────────────────────────
 * - Hazard 1 (banker's rounding): no `round()` anywhere in the 5 ported
 *   Python functions (read in full) — N/A.
 * - Hazard 2 (`sorted()`): `_VALID_CONTEXT_OVERRIDE_KEYS`/
 *   `_VALID_INITIAL_STATE_KEYS` are sorted only for their error-MESSAGE
 *   display (a fixed 2/4-element literal set, not runtime-derived) —
 *   reproduced as an already-alphabetical literal array, not a live `.sort()`
 *   call; no other `sorted()`/`.sort()` in this file's Python scope.
 * - Hazard 3 (`//`/`%` floor division): none in the 5 ported functions —
 *   N/A. (The mountain/jam painting math is `/` true division, already
 *   hazard-3-audited in `./painter.ts`'s own module doc.)
 * - Hazard 4 (dict/insertion order) — THE PRIMARY risk for this slice, per
 *   the brief: `listMergedRuns`'s ordering. Python iterates
 *   `sorted(merged_dir.glob("*.json"))` — filename IS `merged_run_id`, so
 *   this is a plain lexicographic `merged_run_id` sort. Verified (not
 *   assumed) that `idb`'s `getAllKeys()`/`getAll()` on a keyPath-only store
 *   return ascending-key order by a DIRECT test inserting 3 handles in
 *   DELIBERATELY non-alphabetical order (`mrun_bbb`, `mrun_aaa`, `mrun_ccc`)
 *   and asserting the listed order is `aaa, bbb, ccc` — both against the
 *   REAL captured Python golden (same 3 ids, same order) AND independently
 *   in a synthetic IDB-only test with no Python counterpart. See
 *   `makeMergedRunId`'s own doc comment (`../../storage/merged_runs_store.ts`)
 *   for why this format divergence still produces the same ordering
 *   property as a *coincidence* worth stating, not relying on silently —
 *   restated here because THIS function is where that coincidence actually
 *   matters.
 * - Hazard 5 (bare `str(float)`): no float is interpolated into a message
 *   string in this file's own new code — the two validators
 *   (`validateMergedInitialState`/`context_overrides`) interpolate `value`
 *   itself via `pyRepr` (a proper Python-`repr()`-shaped formatter, not a
 *   bare `str()`/f-string float format), and no float ever reaches that
 *   `!r` slot through this file's own captured cases (drowsiness_level/
 *   weather_risk inputs in the golden are ints/bool/str, never floats) — see
 *   `pyRepr`'s own doc comment for the one disclosed float-vs-int
 *   `repr()` gap this shares with every other per-module `pyRepr` copy in
 *   this port.
 * - Hazard 6 (`neumaierSum`): no `sum()` over floats — N/A.
 * - Hazard 7 (`pyFixed`/`:.Nf`): no format-spec float formatting — N/A.
 * - Hazard 8 (`isinstance(x, (int, float))` accepting `bool`): `grep -n
 *   isinstance` over the same 8 ported Python spans (same technique as the
 *   `.get` audit above) -> 7 hits: 6 are `isinstance(x, dict/str/list)` type
 *   DISPATCH in `_readable_error_text` (not int/float-vs-bool — irrelevant to
 *   this hazard), and exactly ONE is hazard-8-shaped:
 *   `create_merged_plan_endpoint`'s own `initial_state` check (merged_runs.py
 *   line 307, "not isinstance(value, (int, float)) or isinstance(value,
 *   bool)"). The REUSED `validate_context_overrides` (services/run_plan.py:
 *   244) has a SECOND hazard-8-shaped site for its own `weather_risk` field
 *   (`grep -n isinstance` on that function's 223-259 span -> 2 hits: the
 *   `weather_risk` one, hazard-8-shaped; the other, `elif not
 *   isinstance(value, bool)`, checks the OPPOSITE direction — rejecting a
 *   non-bool for a boolean field — not this hazard). BOTH of this file's
 *   two hazard-8 sites EXPLICITLY exclude bool in Python — a THIRD
 *   distribution from the seven this program has already found — see
 *   `validateMergedInitialState`'s own doc comment for the full writeup,
 *   including the DIVERGENT sibling validator this uncovered in
 *   `routers/run_plans.py` (`elif not isinstance(value, (int, float)):`,
 *   line 190 — no bool exclusion), which does NOT exclude bool for the
 *   IDENTICAL `initial_state` field name.
 *
 * ── A singular/plural pair, checked ─────────────────────────────────────
 * No `rest_option`/`rest_options[0]`-shaped aliasing anywhere in this file's
 * own scope (that invariant lives in `./quickview.ts`, C4 Task 4) — checked
 * per the brief's standing instruction to look for one whenever porting a
 * merged-run function.
 */
import type { PackageManifest, RouteFacts, ScenarioDef, ValidationError } from '../../api/types'
import { createDraft, type PackageManifestM2 } from '../run_plan'
import type { ScenarioDefM2 } from '../event_plan'
import { packageRegistry } from '../services/package_registry'
import { scenarioRegistry } from '../services/scenario_registry'
import { analyzeRoute, buildRouteSegmentsMaps, type RouteFactsFull, type NamedRestSpot } from '../services/route_analysis'
import { injectMountainSegment, jamTrafficEvent } from './painter'
import { getRoutePresetDoc } from '../../data/registry'
import { createRun as triggerCreateRun, resolveRunLog, type RunLogM2 } from '../run_manager'
import { getRun as getProposalRunLog } from '../proposal/run_manager'
import { validatePreviewContextOverrides } from '../services/preview_ticks'
import { pyReprQuoteOne } from '../proposal/py_repr'
import { ProposalHttpError, type PlanValidationDetail } from '../proposal/orchestrator/create_run'
import {
  createHandle,
  saveHandle,
  getHandle,
  makeMergedRunId,
  listHandleEntries,
} from '../../storage/merged_runs_store'
import type { MergedRunHandle } from './types'

// ---------------------------------------------------------------------------
// Small Python-mirroring local helpers (per-module-copy convention already
// established throughout this port — see create_run.ts's/context.ts's own
// module docs for why each module keeps its own copy).
// ---------------------------------------------------------------------------

/** Mirrors Python's `dict.get(key, default)` — `default` only when `key` is
 * ABSENT; a present `null`/`undefined` value passes through unchanged. */
function pyGetDefault(obj: Record<string, unknown>, key: string, def: unknown): unknown {
  return Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : def
}

/** Mirrors Python truthiness for `if x:` / `x or default`. */
function pyTruthy(value: unknown): boolean {
  if (value == null) return false
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'object') return Object.keys(value as object).length > 0
  return Boolean(value)
}

/**
 * Loose stand-in for Python's `repr()` (`!r`) — same established convention
 * as `../run_plan.ts#pyRepr`/`../worker/handlers/run_plans.ts#pyReprValue`,
 * upgraded here to also cover `bool`/`None`/array (the earlier two copies
 * only special-case `string`, falling back to `String(value)` for
 * everything else — which silently mismatches Python for exactly the values
 * THIS file's own validators can receive: `create_merged_plan_endpoint`'s
 * `initial_state`/`context_overrides` checks explicitly reject `bool`
 * values [hazard 8 — see below], so a rejected bool's repr reaches a REAL
 * error message here, unlike at either of those two precedents' own call
 * sites). Verified against the real captured golden
 * (`merged_run_setup.json`'s `initial_state_wrong_type_bool` case): Python's
 * `f"...got {True!r}"` renders `got True`, NOT `got true`.
 *
 * NOT a claim of full `repr()` fidelity — nested dict/float formatting is
 * out of scope (no real call site in this file ever passes one; `pyReprQuoteOne`
 * itself is reused for the `string` branch, so THAT branch is exact).
 */
function pyRepr(value: unknown): string {
  if (typeof value === 'string') return pyReprQuoteOne(value)
  if (typeof value === 'boolean') return value ? 'True' : 'False'
  if (value === null || value === undefined) return 'None'
  if (Array.isArray(value)) return `[${value.map((v) => pyRepr(v)).join(', ')}]`
  return String(value)
}

// ---------------------------------------------------------------------------
// Id minting — merged_runs.py:101-112
// ---------------------------------------------------------------------------

/** Collision-resistant id; mirrors Python's `run_<ts>_<hex>` scheme but NOT
 * its literal format (`run_<YYYYMMDD-HHMMSS>_<6hex>`) — same deliberate,
 * documented divergence as every other id minter in this port
 * (`../worker/handlers/runs.ts#makeRunId`, `../../storage/
 * merged_runs_store.ts#makeMergedRunId`, ...). Runs ONCE at creation. */
function randHex(n: number): string {
  let s = ''
  for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 16).toString(16)
  return s
}

/** Mirrors `_make_trigger_run_id` (merged_runs.py:101-105). */
export function makeTriggerRunId(): string {
  return `run_${Date.now().toString(36)}_${randHex(6)}`
}

/** Mirrors `_make_merged_plan_id` (merged_runs.py:108-112). */
export function makeMergedPlanId(): string {
  return `plan_${Date.now().toString(36)}_${randHex(6)}`
}

// ---------------------------------------------------------------------------
// _readable_error_text -> readableErrorText (merged_runs.py:115-139)
// ---------------------------------------------------------------------------

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Best-effort plain-text rendering of an `HTTPException.detail`-equivalent
 * (a `ProposalHttpError.detail`, or any caught error's payload). NO live
 * call site within Task 5's own 4 endpoint bodies (Python's own
 * `_readable_error_text` is only called from `tick_merged_run_endpoint`/
 * `accept_rest_endpoint` — a LATER task's scope) — ported now anyway per the
 * brief's explicit instruction, ready for that later task to import rather
 * than re-derive. Structurally IDENTICAL to `./quickview.ts#readableErrorText`
 * (both Python originals are byte-identical private duplicates — see that
 * module's own doc comment for why Python itself keeps two copies rather
 * than sharing one) — kept as a THIRD independent copy here rather than an
 * import, mirroring Python's own module-isolation choice, and per this
 * port's own established per-module-copy convention.
 *
 * Every branch below is covered by a DIRECT, literal-string assertion in
 * the test file — not `String(x)` compared against itself (the brief's own
 * named warning: three of a previous task's assertions did exactly that and
 * proved nothing).
 */
export function readableErrorText(detail: unknown): string {
  if (isPlainRecord(detail)) {
    const msg = detail['message']
    if (typeof msg === 'string' && msg) return msg
  } else if (Array.isArray(detail) && detail.length > 0) {
    const first: unknown = detail[0]
    if (isPlainRecord(first)) {
      // Mirrors `first.get("message") or first.get("msg")` — Python
      // truthiness `or` over two one-arg `.get()` reads, NOT `pyGetDefault`.
      const message = first['message']
      const msg = pyTruthy(message) ? message : first['msg']
      if (typeof msg === 'string' && msg) return msg
    }
  }
  if (typeof detail === 'string') return detail
  return String(detail)
}

// ---------------------------------------------------------------------------
// validate_context_overrides (services/run_plan.py:223-259) — reused, not
// re-copied a third time; see preview_ticks.ts's own doc comment (C4 Task 5).
// ---------------------------------------------------------------------------

export { validatePreviewContextOverrides as validateMergedContextOverrides }

// ---------------------------------------------------------------------------
// initial_state validation — inlined in create_merged_plan_endpoint
// (merged_runs.py:296-325), NOT a call to any shared helper.
// ---------------------------------------------------------------------------

const VALID_INITIAL_STATE_KEYS = ['drowsiness_level', 'fatigue_level']

/**
 * Mirrors `create_merged_plan_endpoint`'s inline `initial_state` validation
 * loop (merged_runs.py:296-325) EXACTLY — deliberately NOT the same function
 * as `../worker/handlers/run_plans.ts`'s own `validateInitialStateBody`
 * (trigger-only `POST /api/run-plans`), whose Python source
 * (`routers/run_plans.py:182-199`) reads `elif not isinstance(value,
 * (int, float)):` — WITHOUT `or isinstance(value, bool)`. Checked directly
 * against both live Python files, not assumed identical from the shared
 * `{"drowsiness_level", "fatigue_level"}` key set and near-identical
 * message wording: `merged_runs.py`'s OWN copy (line 307) explicitly
 * EXCLUDES `bool` (`elif not isinstance(value, (int, float)) or
 * isinstance(value, bool):`), so `initial_state={"drowsiness_level": true}`
 * is REJECTED here but would be silently ACCEPTED (coerced as `1`) by
 * `run_plans.py`'s own endpoint — a real, verified divergence between two
 * Python files this program had not previously catalogued (seven prior
 * tasks found seven hazard-8 DISTRIBUTIONS; this is an EIGHTH, between two
 * SIBLING Python files on the identical field name, not within one file).
 *
 * TS's `typeof value === 'number'` already naturally excludes `boolean`
 * (a distinct JS primitive type), so it mirrors THIS Python endpoint's
 * explicit bool-exclusion correctly with no extra guard needed — verified
 * against the real captured golden's `initial_state_wrong_type_bool` case
 * (`{"drowsiness_level": true}` -> rejected, message embeds `got True`).
 *
 * NaN is deliberately NOT special-cased: Python's `isinstance(nan, float)`
 * is `True` (NaN passes the type check), so `not (0 <= nan <= 100)` is what
 * actually rejects it (NaN comparisons are always `False` in Python) — the
 * SAME behavior `typeof NaN === 'number'` + `!(NaN >= 0 && NaN <= 100)`
 * produces in JS, so no separate `Number.isNaN` guard is needed or wanted.
 */
export function validateMergedInitialState(initialState: Record<string, unknown>): ValidationError[] {
  const errors: ValidationError[] = []
  for (const [key, value] of Object.entries(initialState)) {
    if (!VALID_INITIAL_STATE_KEYS.includes(key)) {
      errors.push({
        field: `initial_state.${key}`,
        message: `Unknown initial_state key ${pyRepr(key)}. Valid keys: ['drowsiness_level', 'fatigue_level']`,
      })
    } else if (typeof value !== 'number') {
      errors.push({
        field: `initial_state.${key}`,
        message: `initial_state.${key} must be a number in [0, 100]; got ${pyRepr(value)}`,
      })
    } else if (!(value >= 0 && value <= 100)) {
      errors.push({
        field: `initial_state.${key}`,
        message: `initial_state.${key} must be in [0, 100]; got ${pyRepr(value)}`,
      })
    }
  }
  return errors
}

// ---------------------------------------------------------------------------
// Shared package/scenario/route resolution — merged_runs.py:239-291 &
// 389-441 (create_merged_plan_endpoint's own block, and
// _build_quickview_route_facts) are near-duplicate ~50-line blocks in
// Python (deliberately NOT factored together there — see
// _build_quickview_route_facts's own docstring: "scoped to ONLY this
// endpoint's isolated helper"). Factored into ONE shared function HERE
// because, unlike Python's two call sites (different modules straddling the
// isolation boundary), both TS call sites live in this SAME file — reduces
// the risk of the two silently diverging under future maintenance, without
// changing observable behavior at either call site (both still raise the
// identical 3 400s + 1 404, in the identical order, for the identical
// reasons).
// ---------------------------------------------------------------------------

type ResolvedPaintedRoute = {
  package: PackageManifestM2
  scenario: ScenarioDefM2
  routeFacts: RouteFactsFull
}

type ResolvePaintedRouteArgs = {
  packageId: string
  scenarioId: string
  routePresetId: string | null
  mountainRangeKm: [number, number] | null
}

/**
 * Mirrors `load_route_preset` (`routers/route_presets.py:66-126`) — NOT
 * previously ported anywhere in htmlapp (a small unported helper, per the
 * brief's explicit allowance: "port it and say so"). Only the `route_facts`
 * half of Python's returned envelope is built (the caller only ever reads
 * `preset_envelope["alternatives"][0]["route_facts"]` — `display`/`notices`
 * are never consulted by either of THIS file's two callers).
 *
 * `buildRouteSegmentsMaps` is REUSED (newly exported from
 * `../services/route_analysis.ts` by this task) rather than duplicated —
 * Python's own `load_route_preset` imports `_build_route_segments_maps`
 * from `services/route_analysis.py` for the identical reason.
 */
export function loadRoutePreset(presetId: string): RouteFactsFull {
  const preset = getRoutePresetDoc(presetId)
  if (preset === null) {
    // Bilingual literal, byte-identical to Python's own — verified against
    // the real captured golden (`route_preset_not_found` case).
    throw new ProposalHttpError(404, 'Route preset not found. / ルートプリセットが見つかりません。')
  }

  const rawRoute = preset.raw_route
  const places = preset.places ?? []

  const totalKm = rawRoute.distance_m / 1000.0
  const durationMin = rawRoute.duration_s / 60.0
  const routeSegments = buildRouteSegmentsMaps(rawRoute.segments ?? [])

  // Python: `sorted(places, key=lambda p: p["distance_along_route_m"])` —
  // stable sort by one numeric key; JS `.sort()` is stable (ES2019+),
  // matching Python's Timsort stability (same technique already established
  // in `route_analysis.ts#analyzeRouteMaps`).
  const placesSorted = [...places].sort((a, b) => a.distance_along_route_m - b.distance_along_route_m)
  const restSpotPositions = placesSorted.map((p) => p.distance_along_route_m / 1000.0)
  const namedRestSpots: NamedRestSpot[] = placesSorted.map((p) => ({
    name: p.name,
    position_km: p.distance_along_route_m / 1000.0,
    lat: p.location.lat,
    lng: p.location.lng,
    synthetic: p.synthetic ?? false,
  }))

  const routeProgressCheckpoints = [0.25 * totalKm, 0.5 * totalKm, 0.75 * totalKm]

  return {
    segments: [],
    bands: {},
    total_route_distance_km: totalKm,
    estimated_route_duration_min: durationMin,
    route_segments: routeSegments,
    rest_spot_positions: restSpotPositions,
    route_progress_checkpoints: routeProgressCheckpoints,
    route_source: 'maps',
    named_rest_spots: namedRestSpots,
  }
}

/**
 * Shared package/scenario/route resolution for BOTH `createMergedPlan` and
 * `buildQuickviewRouteFacts` — see this section's own header comment for why
 * this is ONE function here despite being two duplicated Python blocks.
 *
 * @throws ProposalHttpError(400) — unknown/invalid package_id, unknown/
 *   invalid scenario_id, or an incompatible package/scenario pair.
 * @throws ProposalHttpError(404) — route_preset_id given but unknown
 *   (propagates UNCAUGHT from `loadRoutePreset` — see that function).
 */
async function resolvePaintedRoute(args: ResolvePaintedRouteArgs): Promise<ResolvedPaintedRoute> {
  // packageRegistry.get/scenarioRegistry.get THROW on not-found in this
  // port (unlike Python's own `PackageRegistry.get`/`ScenarioRegistry.get`,
  // which return `None`) — a pre-existing, already-established substrate
  // divergence (see `../worker/handlers/run_plans.ts#runPlansCreate`'s own
  // identical try/catch, the precedent this mirrors).
  let pkg: PackageManifest
  try {
    pkg = await packageRegistry.get(args.packageId)
  } catch {
    throw new ProposalHttpError(400, `Package ${pyReprQuoteOne(args.packageId)} not found or invalid`)
  }

  let scenario: ScenarioDef
  try {
    scenario = await scenarioRegistry.get(args.scenarioId)
  } catch {
    throw new ProposalHttpError(400, `Scenario ${pyReprQuoteOne(args.scenarioId)} not found or invalid`)
  }

  if (!packageRegistry.isCompatible(pkg, scenario)) {
    throw new ProposalHttpError(
      400,
      `Package ${pyReprQuoteOne(args.packageId)} is not compatible with scenario `
        + `${pyReprQuoteOne(args.scenarioId)} (type=${pyReprQuoteOne(scenario.type)})`,
    )
  }

  const scenarioM2 = scenario as unknown as ScenarioDefM2

  // route_facts = load_route_preset(...) if route_preset_id else analyze_route(scenario)
  const routeFacts: RouteFactsFull =
    args.routePresetId !== null ? loadRoutePreset(args.routePresetId) : analyzeRoute(scenarioM2)

  if (args.mountainRangeKm !== null) {
    const [startKm, endKm] = args.mountainRangeKm
    routeFacts.route_segments = injectMountainSegment(routeFacts.route_segments, startKm, endKm)
  }

  return { package: pkg as unknown as PackageManifestM2, scenario: scenarioM2, routeFacts }
}

// ---------------------------------------------------------------------------
// _build_quickview_route_facts -> buildQuickviewRouteFacts (merged_runs.py:363-441)
// ---------------------------------------------------------------------------

export type BuildQuickviewRouteFactsArgs = {
  package_id: string
  scenario_id: string
  route_preset_id: string | null
  mountain_range_km: [number, number] | null
  jam_range_km: [number, number] | null
  jam_speed_kph: number
}

export type QuickviewRouteFacts = {
  routeFacts: RouteFacts
  routeSource: 'maps'
  presets: Record<string, unknown> | null
}

/**
 * Mirrors `_build_quickview_route_facts` — resolves package/scenario and
 * builds a "painted" `route_facts` (+ any manual-jam `presets`) for the
 * quickview projection. The caller (a later task's `merged.quickview`
 * worker handler) only invokes this when a preset/mountain/jam field was
 * actually supplied — the common (unpainted) case stays as simple as
 * `/api/runs/preview` and never reaches this function, exactly like Python.
 *
 * Return shape matches `./quickview.ts#ProjectArgs` field-for-field
 * (`routeFacts`/`routeSource`/`presets`) so a caller can spread this
 * straight into `project(body, await buildQuickviewRouteFacts(body))`.
 */
export async function buildQuickviewRouteFacts(body: BuildQuickviewRouteFactsArgs): Promise<QuickviewRouteFacts> {
  const { routeFacts } = await resolvePaintedRoute({
    packageId: body.package_id,
    scenarioId: body.scenario_id,
    routePresetId: body.route_preset_id,
    mountainRangeKm: body.mountain_range_km,
  })

  let presets: Record<string, unknown> | null = null
  if (body.jam_range_km !== null) {
    const [startKm, endKm] = body.jam_range_km
    // `resolvePaintedRoute`'s two route-building paths (`loadRoutePreset`/
    // `analyzeRoute`) both always populate a concrete number here — `null`
    // is only possible on the M1-legacy local-run path elsewhere in this
    // port (`../run_manager.ts#createRun`'s own fallback), which neither of
    // THIS file's two route builders ever takes. Asserted, not silently cast.
    const totalKm = routeFacts.total_route_distance_km
    const durationMin = routeFacts.estimated_route_duration_min
    if (totalKm === null || durationMin === null) {
      throw new Error('buildQuickviewRouteFacts: route_facts is missing total_route_distance_km/estimated_route_duration_min')
    }
    const jam = jamTrafficEvent(startKm, endKm, totalKm, durationMin, { speedKph: body.jam_speed_kph })
    presets = { traffic_events: [jam] }
  }

  return { routeFacts, routeSource: 'maps', presets }
}

// ---------------------------------------------------------------------------
// create_merged_plan_endpoint -> createMergedPlan (merged_runs.py:216-360)
// ---------------------------------------------------------------------------

export type CreateMergedPlanBody = {
  package_id: string
  scenario_id: string
  route_preset_id: string | null
  run_seed: number
  mountain_range_km: [number, number] | null
  jam_range_km: [number, number] | null
  jam_speed_kph: number
  presets: Record<string, unknown>
  parameters: Record<string, unknown>
  hyperparameters: Record<string, unknown>
  profiles: Record<string, unknown> | null
  initial_state: Record<string, unknown> | null
  context_overrides: Record<string, unknown> | null
}

/**
 * Mirrors `create_merged_plan_endpoint` — builds a "painted" trigger
 * run-plan draft and returns its `plan_id`. See this file's own module doc
 * ("Step 1 — enumeration") for the full list of raise sites.
 */
export async function createMergedPlan(body: CreateMergedPlanBody): Promise<{ plan_id: string }> {
  const { package: pkg, scenario, routeFacts } = await resolvePaintedRoute({
    packageId: body.package_id,
    scenarioId: body.scenario_id,
    routePresetId: body.route_preset_id,
    mountainRangeKm: body.mountain_range_km,
  })

  // presets = dict(body.presets); if jam_range_km: traffic_events =
  // list(presets.get("traffic_events", [])); traffic_events.append(jam);
  // presets["traffic_events"] = traffic_events
  const presets: Record<string, unknown> = { ...body.presets }
  if (body.jam_range_km !== null) {
    const [startKm, endKm] = body.jam_range_km
    const totalKm = routeFacts.total_route_distance_km
    const durationMin = routeFacts.estimated_route_duration_min
    if (totalKm === null || durationMin === null) {
      throw new Error('createMergedPlan: route_facts is missing total_route_distance_km/estimated_route_duration_min')
    }
    const jam = jamTrafficEvent(startKm, endKm, totalKm, durationMin, { speedKph: body.jam_speed_kph })
    const existingTrafficEvents = pyGetDefault(presets, 'traffic_events', [])
    const trafficEvents = Array.isArray(existingTrafficEvents) ? [...existingTrafficEvents] : []
    trafficEvents.push(jam)
    presets['traffic_events'] = trafficEvents
  }

  if (body.initial_state !== null) {
    const initErrors = validateMergedInitialState(body.initial_state)
    if (initErrors.length > 0) {
      const detail: PlanValidationDetail = {
        detail: 'One or more initial_state values are invalid.',
        validation_errors: initErrors,
      }
      throw new ProposalHttpError(400, detail)
    }
  }

  if (body.context_overrides !== null) {
    const ctxErrors = validatePreviewContextOverrides(body.context_overrides)
    if (ctxErrors.length > 0) {
      const detail: PlanValidationDetail = {
        detail: 'One or more context_overrides values are invalid.',
        validation_errors: ctxErrors,
      }
      throw new ProposalHttpError(400, detail)
    }
  }

  const planId = makeMergedPlanId()
  const { draft } = createDraft({
    planId,
    package: pkg,
    scenario,
    presets,
    parameters: body.parameters,
    hyperparameters: body.hyperparameters,
    routeFacts,
    routeSource: routeFacts.route_source,
    runSeed: body.run_seed,
    profiles: body.profiles,
    initialState: body.initial_state,
    contextOverrides: body.context_overrides,
  })

  if (draft.validation_errors.length > 0) {
    const detail: PlanValidationDetail = {
      detail: 'One or more parameter/hyperparameter values are invalid.',
      validation_errors: draft.validation_errors,
    }
    throw new ProposalHttpError(400, detail)
  }

  return { plan_id: draft.plan_id }
}

// ---------------------------------------------------------------------------
// create_merged_run_endpoint -> createMergedRun (merged_runs.py:681-709)
// ---------------------------------------------------------------------------

export type CreateMergedRunBody = {
  trigger_plan_id: string
  world: Record<string, unknown>
  service_package_id: string
  content_package_id: string
  proposal_mode: string
  run_seed: string
  service_parameters: Record<string, unknown>
  service_hyperparameters: Record<string, unknown>
  content_parameters: Record<string, unknown>
  content_hyperparameters: Record<string, unknown>
}

/**
 * Mirrors `create_merged_run_endpoint` — creates the trigger run (from an
 * existing run-plan draft) and the paired `MergedRunHandle`.
 *
 * @throws ProposalHttpError(400) — unknown/invalid trigger_plan_id, caught
 *   from `../run_manager.ts#createRun`'s thrown `Error` (mirrors Python's
 *   `except ValueError as exc: raise HTTPException(400, detail=str(exc))`
 *   — ALL THREE of `createRun`'s own possible throws are ValueError-shaped
 *   in Python, so catching any `Error` here has the identical scope).
 */
export async function createMergedRun(body: CreateMergedRunBody): Promise<{ merged_run_id: string; trigger_run_id: string }> {
  const triggerRunId = makeTriggerRunId()
  try {
    await triggerCreateRun(body.trigger_plan_id, triggerRunId)
  } catch (exc) {
    throw new ProposalHttpError(400, exc instanceof Error ? exc.message : String(exc))
  }

  const mergedRunId = makeMergedRunId()
  const handle = createHandle({
    mergedRunId,
    triggerRunId,
    worldTemplate: body.world,
    servicePackageId: body.service_package_id,
    contentPackageId: body.content_package_id,
    proposalMode: body.proposal_mode,
    runSeed: body.run_seed,
    serviceParameters: body.service_parameters,
    serviceHyperparameters: body.service_hyperparameters,
    contentParameters: body.content_parameters,
    contentHyperparameters: body.content_hyperparameters,
  })
  await saveHandle(handle)

  return { merged_run_id: mergedRunId, trigger_run_id: triggerRunId }
}

// ---------------------------------------------------------------------------
// get_merged_run_endpoint -> getMergedRun (merged_runs.py:712-753)
// ---------------------------------------------------------------------------

export type GetMergedRunResult = {
  handle: MergedRunHandle
  trigger_log: RunLogM2 | null
  proposal_logs: Record<string, unknown>[]
}

/**
 * Mirrors `get_merged_run_endpoint` — reassembles a persisted merged run for
 * read-only replay: the `MergedRunHandle`, the trigger run's log (best-
 * effort — `null` if unresolvable, never raises for it), and every resolved
 * `ProposalRunLog` from `handle.proposal_run_ids` (best-effort, entries that
 * resolve to `null`/`undefined` skipped).
 *
 * `trigger_log` resolution: Python reads the trigger run's persisted JSON
 * file DIRECTLY (`runs_dir / f"{trigger_run_id}.json"`, tolerating a
 * missing file), NOT the same "active-registry-first" resolution
 * `routers/runs.py`'s own `_resolve_run_log` uses. This port instead reuses
 * `../run_manager.ts#resolveRunLog` (active-then-persisted, throws only on
 * true absence) rather than duplicating that module's private store-shape
 * helpers (`headerFromStore`/`eventsFromStore`/`assembleRunLog`, none
 * exported) — given the "persist after every meaningful event" invariant
 * (see project CLAUDE.md), the persisted store is never behind whatever
 * `resolveRunLog`'s active branch would return at any call boundary this
 * function is reached from, so the two are observably equivalent for a real
 * merged run; only the "genuinely absent" outcome (Python: file missing;
 * here: `resolveRunLog` throws) is caught and mapped to `null`, matching
 * Python's own tolerance.
 *
 * @throws ProposalHttpError(404) — unknown merged_run_id.
 */
export async function getMergedRun(mergedRunId: string): Promise<GetMergedRunResult> {
  const handle = await getHandle(mergedRunId)
  if (handle === undefined) {
    throw new ProposalHttpError(404, `Merged run ${pyReprQuoteOne(mergedRunId)} not found`)
  }

  let triggerLog: RunLogM2 | null
  try {
    triggerLog = await resolveRunLog(handle.trigger_run_id)
  } catch {
    triggerLog = null
  }

  const proposalLogs: Record<string, unknown>[] = []
  for (const proposalRunId of handle.proposal_run_ids) {
    // Mirrors `if proposal_run_id is None: continue` — DEAD by construction
    // given this port's `proposal_run_ids: string[]` type (matches Python's
    // OWN `list[str] = []` field type, models/merged_run.py:59 — a
    // `None` entry could never pass `MergedRunHandle` validation in Python
    // either). Ported anyway for structural parity; exercised directly in
    // the test file against a synthetic handle, since no real handle can
    // ever carry one.
    if (proposalRunId === null || proposalRunId === undefined) continue
    const plog = await getProposalRunLog(proposalRunId)
    if (plog !== null) {
      proposalLogs.push(plog as unknown as Record<string, unknown>)
    }
  }

  return { handle, trigger_log: triggerLog, proposal_logs: proposalLogs }
}

// ---------------------------------------------------------------------------
// list_merged_runs_endpoint -> listMergedRuns (merged_runs.py:756-781)
// ---------------------------------------------------------------------------

export type MergedRunSummary = {
  merged_run_id: string
  trigger_run_id: string | null
  proposal_run_ids_count: number
}

/**
 * Summarizes ONE stored row, mirroring the body of Python's `for path in
 * sorted(...)` loop (json.loads + `try/except: continue` + the 3-field
 * summary dict). Extracted as its own function — matching this port's
 * established precedent (`./quickview.ts#buildMergedRestOptions`,
 * `../proposal/orchestrator/create_run.ts#freezeSetupSnapshot`) — so the
 * skip-corrupt/`file-stem`-fallback branches (structurally unreachable
 * through the real `merged_runs` IDB store — see `listHandleEntries`'s own
 * doc comment) can be exercised DIRECTLY against a synthetic `(row, key)`
 * pair, not only through the real store's happy path.
 *
 * Returns `null` where Python's `except Exception: continue` would skip the
 * row — a genuinely corrupt/unusable row (Python: `json.loads` failure or a
 * non-dict top level; here: `row` is not a plain object, or extraction
 * itself throws for any other reason).
 */
export function summarizeMergedRunRow(row: unknown, key: unknown): MergedRunSummary | null {
  try {
    if (!isPlainRecord(row)) return null
    const data = row

    // data.get("merged_run_id", path.stem) — pyGetDefault. `key` (the IDB
    // storage key) is this substrate's equivalent of Python's `path.stem`
    // (the filename minus extension) — see `listHandleEntries`'s own doc
    // comment for why this is dead-by-construction for a REAL row (the
    // store's keyPath already forces `merged_run_id === key`), ported and
    // tested directly regardless.
    const mergedRunId = pyGetDefault(data, 'merged_run_id', key)

    // data.get("trigger_run_id") — one-arg .get, no default, no `or`:
    // `undefined` (absent) normalizes to `null`; a present value (including
    // an explicit `null`) passes through unchanged either way.
    const triggerRunId = (data['trigger_run_id'] as string | null | undefined) ?? null

    // len(data.get("proposal_run_ids") or []) — .get() + truthy `or`.
    const rawIds = data['proposal_run_ids']
    const idsForCount = pyTruthy(rawIds) ? rawIds : []
    const proposalRunIdsCount = Array.isArray(idsForCount)
      ? idsForCount.length
      : typeof idsForCount === 'string'
        ? idsForCount.length
        : 0

    return {
      merged_run_id: String(mergedRunId),
      trigger_run_id: triggerRunId,
      proposal_run_ids_count: proposalRunIdsCount,
    }
  } catch {
    return null
  }
}

/**
 * Mirrors `list_merged_runs_endpoint` — lists summaries for every persisted
 * merged run, skipping corrupt/unusable rows rather than raising ("a
 * listing helper, not a validator" — Python's own docstring).
 *
 * Ordering: Python's `sorted(merged_dir.glob("*.json"))` is a lexicographic
 * `merged_run_id` sort (filename == merged_run_id). `listHandleEntries`
 * returns rows in the `merged_runs` IDB store's own ascending-key order —
 * verified (not assumed) in the test file via a direct out-of-insertion-
 * order assertion, both against the real captured Python golden and
 * independently.
 *
 * Python's own `if not merged_dir.exists(): return {"merged_runs": []}`
 * early return has no distinct branch here: an empty/never-created IDB
 * store's `getAllKeys()`/`getAll()` already return `[]`, producing the
 * identical observable `{ merged_runs: [] }` through the same loop — a
 * substrate difference collapsing two Python branches into one here, not a
 * missed branch.
 */
export async function listMergedRuns(): Promise<{ merged_runs: MergedRunSummary[] }> {
  const entries = await listHandleEntries()
  const items: MergedRunSummary[] = []
  for (const { key, value } of entries) {
    const summary = summarizeMergedRunRow(value, key)
    if (summary !== null) items.push(summary)
  }
  return { merged_runs: items }
}
