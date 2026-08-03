/**
 * `merged_quickview` — TS port of `app/api/aica_api/services/merged_quickview.py`
 * (312 LOC), feature 026 (htmlapp Combined export), slice C4 Task 4.
 *
 * `project` is the ephemeral whole-chain projection: one headless trigger
 * preview pass plus a default quick-check proposal attached to every
 * actionable fire. **Nothing it produces is ever persisted** — the trigger
 * side never touches a runs store (`iterPreviewTicks` is the same
 * non-persisting engine `runsPreview`/`POST /api/runs/preview` uses), and
 * every projected proposal run is built with a FRESH, per-call, in-memory
 * `cache` (a `Map`, never `proposalRunsStore`) — feature 020's Slice-2c
 * `cache={}` seam, threaded through C4 Task 1's cache parameter on
 * `createRun`/`getRun`/`appendEvent`/`appendEvidence`/`updateState`.
 *
 * ── Dependency on C4a (read this before assuming anything is missing) ──────
 * `_project_fire`/`_project_after_rest` both reduce to
 * `create_proposal_run(proposal_body, cache={})`. A prior attempt at this
 * task correctly returned BLOCKED because NONE of `routers/proposal.py`'s
 * orchestration was ported at the time. Slice C4a (7 tasks, complete,
 * verified field-by-field against real Python: 10,323 leaf fields, 0
 * mismatches outside clock/random ids) closed that gap —
 * `../proposal/orchestrator/create_run.ts#createProposalRun` and
 * `../proposal/orchestrator/select_service.ts#applyQuickCheckContent` are
 * the real, reviewed, non-stub implementations this file calls.
 *
 * ── A SECOND gap, found and closed inside this task (disclosed in full in
 * task-4-report.md) ──────────────────────────────────────────────────────
 * `project()` also needs `services/preview.py::iter_preview_ticks` — a
 * reusable GENERATOR yielding a `PreviewFireEvent` (with the tick_state AT
 * each fire) per rising edge, plus a stash of the recovered driver's
 * tick_state at the end of each auto-accepted rest. Nothing in htmlapp
 * exposed that shape before this task; the pre-existing `runsPreview`
 * (`../worker/handlers/runs.ts`, feature 009/020, NOT part of this C4
 * program) only returns the FINAL accumulated result. `../services/
 * preview_ticks.ts#iterPreviewTicks` is a same-commit extraction — the
 * SAME refactor Python's own `services/preview.py` history describes
 * (`iter_preview_ticks` extracted from `evaluate_preview`) — with
 * `runsPreview` reduced to a thin drain-and-return wrapper over it,
 * preserving its exact prior behavior (its own pre-existing test suite,
 * `tests/preview.test.ts`, passes unchanged). See that file's own module
 * doc for the full scope-decision writeup.
 *
 * ── Isolation (mirrors the Python module docstring) ─────────────────────
 * This file imports only: `./types` (this module's own body/result types),
 * `./adapter` (`mapTriggerPurpose`/`mapLifecycleStage`/`buildWorldFromTick`),
 * `../services/preview_ticks` (`iterPreviewTicks`/`PreviewFireEvent`), and
 * `../proposal/orchestrator/*` (`createProposalRun`/`applyQuickCheckContent`/
 * `ProposalHttpError`). htmlapp has no trigger/proposal Pydantic-model-vs-
 * plain-dict import boundary to police (no pydantic at all), so the
 * isolation TEST Python's module doc describes has no htmlapp equivalent —
 * noted for completeness, not a gap.
 *
 * ── The three-way `.get` distinction — full audit ───────────────────────
 * `grep -n "\.get(" app/api/aica_api/services/merged_quickview.py` → 4 hits:
 *   L72  `detail.get("message")`               — ONE-arg `.get(key)`, no
 *        default (`None` if absent) — mirrored with plain property access
 *        (`detail['message']`, `undefined` if absent — TS's own "absent"
 *        value), NOT `pyGetDefault`.
 *   L78  `first.get("message") or first.get("msg")` — TWO one-arg `.get()`
 *        calls combined with Python TRUTHINESS `or` — the THIRD, distinct
 *        idiom (neither `pyGetDefault` nor `?? {}`) — mirrored with a local
 *        `pyTruthy`-gated helper (`readableErrorText` below).
 *   L93  `errors[0].get("msg")`                 — ONE-arg `.get(key)`, same
 *        as L72 — plain property access.
 *   L287 `result.get("rest_options", [])`       — the ONE genuine two-arg
 *        `.get(key, default)` site. `result`'s TS shape
 *        (`PreviewLoopResult`) declares `rest_options` as ALWAYS present
 *        (never optional — `../services/preview_ticks.ts`'s generator sets
 *        it on every return), so the port reads `result.rest_options`
 *        directly rather than via `pyGetDefault` — the default is
 *        defensive-only in Python too (the accumulator dict always has the
 *        key by construction).
 * Total: 2 one-arg `.get(key)` sites, 1 truthy-`or`-of-two-`.get()` site,
 * 1 two-arg `.get(key,default)` site (mirrored via direct, always-safe
 * property access given the stronger TS type).
 *
 * ── Hazard 8 (`isinstance(x, (int, float))` accepting `bool`) ──────────────
 * `grep -n "isinstance" app/api/aica_api/services/merged_quickview.py` → 7
 * hits, ALL `isinstance(x, dict)` / `isinstance(x, list)` / `isinstance(x,
 * str)` (the `_readable_error_text`/`_readable_validation_text` type
 * dispatch) — ZERO `isinstance(x, (int, float))` sites. Hazard 8 is N/A for
 * this whole module.
 *
 * ── Hazards 1/2/3/5/6/7 ─────────────────────────────────────────────────
 * - Hazard 1 (banker's rounding): no `round()` in this file — the tick/
 *   score/minute values it touches are only ever passed through opaquely
 *   (already rounded upstream by `../merged/adapter.ts#buildWorldFromTick`
 *   or produced by the tick loop itself) — N/A.
 * - Hazard 2 (`sorted()`/`.sort()`): none in `merged_quickview.py` itself —
 *   N/A (the one `sorted()` in this dependency chain,
 *   `_pick_rest_spot`/`pickPreviewRestSpot`, was already hazard-audited in
 *   `../services/preview_ticks.ts`).
 * - Hazard 3 (`//`/`%` floor division): none — N/A.
 * - Hazard 4 (dict/insertion order): the PRIMARY risk for this file — see
 *   the "Hazard 4" section below `project` for the full per-site writeup.
 * - Hazard 5 (bare `str(float)`): no float is interpolated into a message
 *   string anywhere in this file — N/A.
 * - Hazard 6 (`neumaierSum`): no `sum()` over floats — N/A.
 * - Hazard 7 (`pyFixed`/`:.Nf`): no format-spec float formatting — N/A.
 *
 * ── The `CreateProposalRunBody(...)` `ValidationError` catch — ported as a
 * structural no-op, disclosed rather than silently dropped ───────────────
 * Python wraps `CreateProposalRunBody(world=world, trigger_purpose=purpose,
 * ...)` construction in `try/except ValidationError`. Every field passed at
 * BOTH call sites (`_project_fire`/`_project_after_rest`) is ALREADY a
 * validated value by construction — `world` is a `World` instance freshly
 * built by `buildWorldFromTick` (never a raw dict), `purpose`/`stage` are
 * literal members returned by `mapTriggerPurpose`/`mapLifecycleStage` (never
 * an arbitrary string), and `motion_state` is read off that same already-
 * valid `World`. So even in PYTHON this `ValidationError` branch is
 * unreachable from these two call sites specifically (verified field-by-
 * field against `CreateProposalRunBody`'s declared types,
 * `routers/proposal.py:658-706`) — a defensive catch that never fires here,
 * consistent with several other disclosed-dead defensive branches elsewhere
 * in this port (e.g. `MatrixResolutionError` deadness, C4a Task 4's
 * mis-slotted-content-package unreachability).
 *
 * TypeScript sharpens this from "empirically unreachable" to "structurally
 * impossible": building a plain object literal cannot throw at runtime the
 * way a pydantic model constructor can (TS's type system is compile-time
 * only) — there is no analogous statement to wrap in `try/catch` at all. So
 * `projectFire`/`projectAfterRest` below build the `CreateProposalRunBody`-
 * shaped object directly, with no try/catch around that step (there is
 * nothing to catch), and ONLY wrap the `createProposalRun(...)` call itself
 * in try/catch (mirroring the SEPARATE, genuinely-reachable
 * `except HTTPException` block). `readableValidationText` is still ported,
 * exported, and unit-tested DIRECTLY against a duck-typed "has an
 * `errors()` method" input (mirroring pydantic's `ValidationError.errors()`
 * contract) — this port's convention for a function with no live call site
 * (see `../proposal/orchestrator/create_run.ts`'s own precedent for
 * ValidationError-shaped Python raises with no literal TS equivalent).
 */
import type {
  MergedFirePoint,
  MergedInstantResult,
  MergedQuickviewBody,
  MergedRestOption,
} from './types'
import { mapTriggerPurpose, mapLifecycleStage, buildWorldFromTick, type World } from './adapter'
import {
  iterPreviewTicks,
  type PreviewFireEvent,
  type PreviewLoopRestOption,
} from '../services/preview_ticks'
import type { TickState } from '../tick_engine'
import type { RouteFacts, PreviewRestOption } from '../../api/types'
import {
  createProposalRun,
  ProposalHttpError,
  type CreateProposalRunBody,
} from '../proposal/orchestrator/create_run'
import { applyQuickCheckContent } from '../proposal/orchestrator/select_service'
import type { ProposalRunCache } from '../proposal/run_manager'
import type { MotionState } from '../proposal/eligibility'

// ---------------------------------------------------------------------------
// pyTruthy — local copy, established per-module-copy convention (see
// ../proposal/orchestrator/create_run.ts's own module doc for why each
// module keeps its own rather than importing one shared helper).
// ---------------------------------------------------------------------------

function pyTruthy(value: unknown): boolean {
  if (value == null) return false
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'object') return Object.keys(value as object).length > 0
  return Boolean(value)
}

// ---------------------------------------------------------------------------
// _readable_error_text -> readableErrorText (merged_quickview.py:57-83)
// ---------------------------------------------------------------------------

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Best-effort plain-text rendering of a `ProposalHttpError.detail` (mirrors
 * an `HTTPException.detail`). Mirrors `routers/merged_runs.py`'s helper of
 * the same name (kept as a private duplicate rather than a shared import —
 * this module's own isolation scope, mirroring Python's, forbids a new
 * cross-module import beyond the ones documented above). `detail` is
 * normally a `{code, message}`-shaped object, or an array of such objects,
 * whose already-written human sentence lives under `message` (or, for a raw
 * validation-issue entry, `msg`); only when neither shape applies does this
 * fall back to a generic stringification, so a caller never surfaces a raw
 * JS object/array dump.
 *
 * The final `String(detail)` fallback (mirrors Python's `return
 * str(detail)`) has no reachable call site through any of this port's real
 * `ProposalHttpDetail` shapes (every structured member always carries a
 * non-empty `message`; the validation-issue array is never empty when
 * raised) — ported anyway (defensive, matches Python) and exercised
 * directly by this file's own tests via a synthetic edge case, not through
 * `project()`'s real call sites.
 *
 * DISCLOSED DIVERGENCE (verified, not assumed): `String(detail)` mirrors
 * Python's CONTROL FLOW (which branch fires) but is NOT byte-identical to
 * Python's `str(detail)` for a non-primitive fallback value — checked
 * directly against a live interpreter: `str([])` is `'[]'` where
 * `String([])` is the empty string, and `str({'code': 'x'})` is
 * `"{'code': 'x'}"` where `String({code:'x'})` is `'[object Object]'`.
 * Left as `String(detail)` rather than building a Python-`repr`-mirroring
 * formatter for a branch this port's own tests prove is exercised only
 * synthetically, never through a real caller.
 */
export function readableErrorText(detail: unknown): string {
  if (isPlainRecord(detail)) {
    const msg = detail['message']
    if (typeof msg === 'string' && msg) return msg
  } else if (Array.isArray(detail) && detail.length > 0) {
    const first: unknown = detail[0]
    if (isPlainRecord(first)) {
      // Mirrors `first.get("message") or first.get("msg")` — Python
      // truthiness `or` over two one-arg `.get()` reads (L78 in the audit
      // above), NOT `pyGetDefault`.
      const message = first['message']
      const msg = pyTruthy(message) ? message : first['msg']
      if (typeof msg === 'string' && msg) return msg
    }
  }
  if (typeof detail === 'string') return detail
  return String(detail)
}

// ---------------------------------------------------------------------------
// _readable_validation_text -> readableValidationText (merged_quickview.py:86-96)
// ---------------------------------------------------------------------------

/** Duck-typed stand-in for a caught `pydantic.ValidationError` — the
 * `.errors()` contract this function reads. No htmlapp call site produces a
 * real instance of this (see module doc's "ValidationError catch" section);
 * ported and tested directly rather than silently dropped. */
export type PydanticLikeValidationError = { errors(): Array<{ msg?: unknown }> }

/**
 * Plain-text rendering of a pydantic-`ValidationError`-shaped value — its
 * default `str()` would be a multi-line dump of raw field paths and type
 * jargon (never localized, never natural language); this surfaces just the
 * first error's own message instead. Falls back to `String(exc)` when
 * `errors()` yields nothing or no entry has a usable `msg`.
 */
export function readableValidationText(exc: PydanticLikeValidationError | unknown): string {
  if (isPlainRecord(exc) && typeof (exc as { errors?: unknown }).errors === 'function') {
    const errors = (exc as PydanticLikeValidationError).errors()
    if (errors.length > 0) {
      const msg = errors[0].msg
      if (typeof msg === 'string' && msg) return msg
    }
  }
  return String(exc)
}

// ---------------------------------------------------------------------------
// _with_tick_seconds -> withTickSeconds (merged_quickview.py:216-225)
// ---------------------------------------------------------------------------

/**
 * Folds a pinned tick duration into the presets the tick engine receives.
 * `tickSeconds` travels in `presets` on the live-run path too, so folding it
 * here keeps the projection and the run on the same clock. `null`/undefined
 * leaves `presets` untouched (returned AS-IS, not copied — mirrors Python
 * returning `presets` unchanged when `tick_seconds is None`).
 */
export function withTickSeconds(
  presets: Record<string, unknown> | null,
  tickSeconds: number | null,
): Record<string, unknown> | null {
  if (tickSeconds === null) return presets
  return { ...(presets ?? {}), tick_seconds: tickSeconds }
}

// ---------------------------------------------------------------------------
// Shared proposal-projection step (used by both _project_fire/projectFire
// and _project_after_rest/projectAfterRest — Python duplicates this ~15-LOC
// body instead of factoring it out; this port keeps the SAME duplication
// rather than introducing a shared helper Python doesn't have, so a future
// side-by-side diff against either Python function stays 1:1).
// ---------------------------------------------------------------------------

async function runQuickCheckProposal(
  proposalBody: CreateProposalRunBody,
): Promise<[Record<string, unknown> | null, string | null]> {
  try {
    const plog = await createProposalRun(proposalBody, {
      // Fresh, per-call, in-memory cache (feature 020 Slice-2c) — mirrors
      // Python's `cache={}` dict LITERAL at this exact call site (a NEW
      // empty dict per call, never shared across fires). This is why
      // C4 Task 1's cache seam exists: `proposalRunsStore` is NEVER touched.
      cache: new Map() as ProposalRunCache,
      applyQuickCheckContent,
    })
    return [plog as unknown as Record<string, unknown>, null]
  } catch (exc) {
    if (exc instanceof ProposalHttpError) {
      return [null, readableErrorText(exc.detail)]
    }
    throw exc
  }
}

// ---------------------------------------------------------------------------
// _project_fire -> projectFire (merged_quickview.py:99-159)
// ---------------------------------------------------------------------------

/**
 * Build and run ONE default quick-check proposal for a single fire episode.
 *
 * Returns `[proposalDict, proposalError]` — at most one is non-null.
 * `[null, null]` when the fire's `result_type` has no mapped
 * `trigger_purpose` (every fire `iterPreviewTicks` yields today is
 * REST_PROPOSAL or MONOTONY_PROPOSAL, both mapped — see
 * `./adapter.ts#mapTriggerPurpose`). `proposalError` is set from a caught
 * `ProposalHttpError` (an unknown/mis-slotted service/content package id, an
 * unresolvable matrix row, ...) exactly like `routers/merged_runs.py`'s own
 * `/tick` endpoint does for its single first-fire proposal.
 */
export async function projectFire(
  ev: PreviewFireEvent,
  body: MergedQuickviewBody,
): Promise<[Record<string, unknown> | null, string | null]> {
  const purpose = mapTriggerPurpose(ev.decision.result_type)
  if (purpose === null) return [null, null]

  const stage = mapLifecycleStage({ fired: true, resultType: ev.decision.result_type, recoveryPhase: null })
  const world = buildWorldFromTick(body.world as World, ev.tickState, {
    triggerPurpose: purpose,
    lifecycleStage: stage,
  })

  const proposalBody: CreateProposalRunBody = {
    world: world as unknown as CreateProposalRunBody['world'],
    trigger_purpose: purpose,
    lifecycle_stage: stage,
    motion_state: world.control_inputs.motion_state as MotionState,
    service_package_id: body.service_package_id,
    content_package_id: body.content_package_id,
    // "quick_check" — ProposalRunMode.quick_check.value in Python — see
    // module doc for why this is a plain string, not an enum import.
    mode: 'quick_check',
    run_seed: body.run_seed_proposal,
    simulation_time: ev.tickIndex,
    // feature 020 override plumbing: SERVICE parameters/hyperparameters.
    // content_parameters/content_hyperparameters are deliberately NOT
    // threaded here — see MergedQuickviewBody's own doc comment for why
    // (a real, unresolved gap in Python itself, not an oversight of this
    // port).
    parameters: body.service_parameters,
    hyperparameters: body.service_hyperparameters,
  }

  return runQuickCheckProposal(proposalBody)
}

// ---------------------------------------------------------------------------
// _project_after_rest -> projectAfterRest (merged_quickview.py:162-212)
// ---------------------------------------------------------------------------

/**
 * Build ONE quick-check proposal for the AFTER-NAP moment of a projected
 * rest (feature 020 — the clickable purple "after-nap" journey dot), from
 * the recovered driver state captured on the last STOPPED recovery tick.
 *
 * Modeled as the SAME rest journey that started this recovery:
 * `trigger_purpose="rest_recommended"` at
 * `lifecycle_stage="after_rest_before_restart"`, motion left as the
 * captured `stopped` state. Returns `[proposalDict, proposalError]` — at
 * most one non-null (`proposalError` only on a caught `ProposalHttpError`;
 * an in-run content error is carried in the proposal's own evidence, not
 * here).
 */
export async function projectAfterRest(
  tickState: TickState,
  body: MergedQuickviewBody,
): Promise<[Record<string, unknown> | null, string | null]> {
  const purpose = 'rest_recommended' as const
  const stage = 'after_rest_before_restart' as const
  // The captured tick is the last STOPPED recovery tick, so buildWorldFromTick
  // copies motion=stopped — exactly the after-nap state; no override needed.
  const world = buildWorldFromTick(body.world as World, tickState, {
    triggerPurpose: purpose,
    lifecycleStage: stage,
  })

  const proposalBody: CreateProposalRunBody = {
    world: world as unknown as CreateProposalRunBody['world'],
    trigger_purpose: purpose,
    lifecycle_stage: stage,
    motion_state: world.control_inputs.motion_state as MotionState,
    service_package_id: body.service_package_id,
    content_package_id: body.content_package_id,
    mode: 'quick_check',
    run_seed: body.run_seed_proposal,
    simulation_time: 0,
    parameters: body.service_parameters,
    hyperparameters: body.service_hyperparameters,
  }

  return runQuickCheckProposal(proposalBody)
}

// ---------------------------------------------------------------------------
// project (merged_quickview.py:227-312)
// ---------------------------------------------------------------------------

export type ProjectArgs = {
  routeFacts?: RouteFacts | null
  routeSource?: 'maps' | 'local'
  presets?: Record<string, unknown> | null
}

/**
 * Run one headless trigger preview, projecting a default quick-check
 * proposal at every actionable fire (rising edge).
 *
 * Nothing is persisted: the trigger side never touches a runs store
 * (`iterPreviewTicks` is the same non-persisting engine `runsPreview`/
 * `POST /api/runs/preview` uses) and every projected proposal run is built
 * with a fresh, per-call, in-memory `cache` — a `Map`, thrown away when this
 * call returns; `proposalRunsStore` is never written.
 *
 * `routeFacts`/`routeSource`/`presets` are opaque pass-throughs to
 * `iterPreviewTicks` (see module doc) — the caller (a later C4 task's
 * `merged.quickview` handler) builds any painted route/jam BEFORE calling
 * this, exactly like `routers/merged_runs.py`'s own
 * `_build_quickview_route_facts` does in Python.
 *
 * ── Hazard 4 (dict/insertion order) — the primary risk for this function ──
 * `fires[]`, `score_series[]`, `progress[]`, `monotony_series[]`,
 * `segments[]`, `rest_spots[]`, `rest_options[]` all come straight through
 * from `iterPreviewTicks`'s own `PreviewLoopResult` — already tick-ordered
 * arrays (audited in `../services/preview_ticks.ts`'s own hazard pass).
 * This function adds exactly two NEW order-sensitive constructs:
 *   1. `mergedFires` — built by `result.fires.map((fire, i) => ...)`, a
 *      POSITIONAL zip against `projected` (itself built by a single
 *      sequential `for`-loop over the SAME generator that produced
 *      `result.fires`, one push per yielded `PreviewFireEvent`, in yield
 *      order) — structurally the same order as `result.fires` by
 *      construction, mirroring Python's `zip(result["fires"], projected,
 *      strict=True)` exactly (see the length-mismatch guard below, which
 *      mirrors `strict=True`'s own `raise` on a length disagreement).
 *   2. `mergedRestOptions` — built by a single sequential `for...of` loop
 *      over `result.rest_options` (itself in auto-accept order from the
 *      tick loop), calling `projectAfterRest` and pushing exactly one
 *      output object per input, in input order — mirrors Python's own
 *      sequential `for opt in result.get("rest_options", [])` loop
 *      (deliberately NOT `Promise.all(...)`-parallelized, which would still
 *      preserve output ARRAY order but would run the async proposal
 *      projections concurrently rather than sequentially — a real
 *      behavioral divergence from Python's single-threaded sequential loop
 *      this port avoids on principle, not because a concrete concurrency
 *      bug was found).
 */
/**
 * Strips the private `_post_rest_tick_state` stash off a `rest_option`
 * (singular) value — see `project`'s own call site for why this is needed
 * DESPITE `rest_option`'s declared type never including that field: at
 * RUNTIME it is the exact same object as `rest_options[0]` (mirrors
 * Python's own aliasing), so the stash genuinely can be present on it even
 * though nothing in this file's TYPES say so.
 */
function stripPostRestTickState(opt: PreviewLoopRestOption | null): PreviewRestOption | null {
  if (opt === null) return null
  const { _post_rest_tick_state: _unused, ...rest } = opt
  return rest
}

/**
 * Merges the projected after-rest proposal onto every entry of
 * `restOptions` — the loop body of `project`'s own
 * `for opt in result.get("rest_options", [])` (merged_quickview.py:287-292).
 * Extracted as its own exported function (a Task-4-local convention, not a
 * Python `__all__` member — matches this port's established precedent of
 * pulling an inlined step out for direct testability, e.g.
 * `../proposal/orchestrator/create_run.ts#freezeSetupSnapshot`) so the
 * "both null" state of `after_rest_proposal`/`after_rest_proposal_error`
 * (invariant 3's SAME pairing, applied to this field) can be exercised
 * directly with a synthetic `restOptions` entry, rather than needing to
 * engineer a real end-to-end run that happens to error out mid-recovery.
 *
 * Every entry gets `_post_rest_tick_state` POPPED unconditionally (it must
 * NEVER reach the response — mirrors Python's `opt.pop(..., None)`, run for
 * every option regardless of whether an after-rest proposal follows); only
 * when a stash WAS present AND `runError` is `null` do we actually project
 * the after-rest proposal. Built via a FRESH object per entry (not in-place
 * mutation) so `after_rest_proposal`/`after_rest_proposal_error` are ALWAYS
 * both present (defaulting to `null`) — mirrors pydantic's own default-
 * filling on `MergedRestOption(**opt)` construction, which Python gets for
 * free and this port must do explicitly since a plain object literal has no
 * equivalent.
 */
export async function buildMergedRestOptions(
  restOptions: PreviewLoopRestOption[],
  runError: unknown,
  body: MergedQuickviewBody,
): Promise<MergedRestOption[]> {
  const mergedRestOptions: MergedRestOption[] = []
  for (const opt of restOptions) {
    const { _post_rest_tick_state, ...rest } = opt
    let afterRestProposal: Record<string, unknown> | null = null
    let afterRestProposalError: string | null = null
    if (_post_rest_tick_state !== undefined && runError === null) {
      const [proposal, proposalError] = await projectAfterRest(_post_rest_tick_state, body)
      afterRestProposal = proposal
      afterRestProposalError = proposalError
    }
    mergedRestOptions.push({
      ...rest,
      after_rest_proposal: afterRestProposal,
      after_rest_proposal_error: afterRestProposalError,
    })
  }
  return mergedRestOptions
}

export async function project(body: MergedQuickviewBody, args: ProjectArgs = {}): Promise<MergedInstantResult> {
  const gen = iterPreviewTicks({
    packageId: body.package_id,
    scenarioId: body.scenario_id,
    hyperparameterOverrides: body.hyperparameter_overrides,
    runSeed: body.run_seed,
    restOptionId: body.rest_option_id,
    routeSource: args.routeSource ?? 'local',
    routeFacts: args.routeFacts ?? null,
    presets: withTickSeconds(args.presets ?? null, body.tick_seconds),
    profiles: body.profiles ?? null,
    contextOverrides: body.context_overrides ?? null,
    initialState: body.initial_state ?? null,
  })

  const projected: Array<[Record<string, unknown> | null, string | null]> = []
  let step = await gen.next()
  while (!step.done) {
    projected.push(await projectFire(step.value, body))
    step = await gen.next()
  }
  const result = step.value

  const mergedRestOptions = await buildMergedRestOptions(result.rest_options, result.error, body)

  // `iterPreviewTicks` deliberately empties its OWN `fires`/`spikes` to `[]`
  // whenever the run ends in an algorithm error (`result.error` set) — even
  // if one or more fires (and their PreviewFireEvent yields) already
  // happened earlier in the SAME run, before the later tick that errored.
  // Mirror that same "don't trust fires from an errored run" suppression
  // here: on error, `result.fires` (length 0) and `projected` (length ==
  // the number of fires actually yielded before the error) can legitimately
  // disagree in length, so zipping them positionally would be wrong.
  let mergedFires: MergedFirePoint[]
  if (result.error !== null) {
    mergedFires = []
  } else {
    // Mirrors Python's `zip(result["fires"], projected, strict=True)` —
    // `strict=True` raises on a length mismatch rather than silently
    // truncating (Python's default `zip` behavior). No real call path
    // produces a mismatch here (see the doc comment above), but the guard
    // is ported anyway rather than silently trusting positional alignment.
    if (result.fires.length !== projected.length) {
      throw new Error(
        `merged quickview: fires/projected length mismatch (${result.fires.length} vs ${projected.length}) `
          + '— mirrors Python zip(..., strict=True).',
      )
    }
    mergedFires = result.fires.map((fire, i) => {
      const [proposal, proposalError] = projected[i]
      return { ...fire, proposal, proposal_error: proposalError }
    })
  }

  return {
    fired: result.fired,
    // `fire` (singular) is passed through UNAUGMENTED — mirrors Python's
    // `MergedInstantResult(**{**result, "fires": merged_fires})`, which
    // spreads `result["fire"]` (a plain FirePoint, never touched) verbatim.
    // Deliberate (see `./types.ts`'s own invariant-1 doc comment): the
    // setup-strip UI reads this for a "first trigger" marker and does not
    // want a proposal attached.
    fire: result.fire,
    fires: mergedFires,
    peak_score: result.peak_score,
    threshold: result.threshold,
    score_series: result.score_series,
    progress: result.progress,
    monotony_series: result.monotony_series,
    monotony_threshold: result.monotony_threshold,
    spikes: result.spikes,
    segments: result.segments,
    traffic_jams: result.traffic_jams,
    rest_spot: result.rest_spot,
    // `rest_option` (singular) is the SAME object as `rest_options[0]`
    // (mirrors Python — see `../services/preview_ticks.ts`'s own doc
    // comment for the aliasing). `_post_rest_tick_state` was stashed onto
    // that shared object during the tick loop, so it must be stripped here
    // too, even though this field's declared shape (a plain
    // `PreviewRestSpot`/`PreviewRestOption`, NEVER `MergedRestOption`) never
    // gains `after_rest_proposal`/`after_rest_proposal_error` either — in
    // Python this stripping happens FOR FREE via pydantic's field
    // filtering when `MergedInstantResult(**{**result, ...})` validates
    // `rest_option: PreviewRestOption | None` (a model that never declares
    // those extra keys, so pydantic silently drops them on construction,
    // confirmed against the captured golden's own `rest_option` — 4 fields
    // only). TS has no equivalent automatic filtering, so this strip is
    // explicit. CAUGHT BY THIS TASK'S OWN PARITY TEST (a real pre-fix
    // failure, not merely anticipated): `rest_option` came back carrying a
    // leaked `_post_rest_tick_state` key until this line was added.
    rest_option: stripPostRestTickState(result.rest_option as PreviewLoopRestOption | null),
    rest_spots: result.rest_spots,
    rest_options: mergedRestOptions,
    completed_min: result.completed_min,
    seed: result.seed,
    overrides: result.overrides,
    error: result.error,
  }
}
