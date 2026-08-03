/**
 * `recompute_proposal_run` orchestrator — TS port of `routers/proposal.py`'s
 * `recompute_proposal_run` (1492-1815, 324 LOC) — feature 026 (htmlapp
 * Combined export), slice C4a Task 5.
 *
 * ── Step 1: control flow, enumerated before any code below ─────────────────
 *
 *  1. `getRun(runId)` — `ProposalHttpError(404)` if not found. ALWAYS disk
 *     mode (Python's own function signature has NO `cache` parameter at
 *     all, unlike `create_proposal_run`/`select_service`'s own — verified by
 *     reading the full 324-LOC span and grepping every `prm.*`/
 *     `_apply_quick_check_content` call site inside it: none passes
 *     `cache=`). `recomputeProposalRun` below matches: no `cache` option.
 *  2. `runLog.world == null` -> `ProposalHttpError(422)`, bare string
 *     ("recompute requires a typed-world run") — a legacy `world_snapshot`
 *     -only run can never be recomputed.
 *  3. `journey_state.playback_state in (active, backgrounded)` ->
 *     `ProposalHttpError(422)`, STRUCTURED `{code:
 *     "recompute_requires_idle_playback", message}` detail (a NEW shape,
 *     widening `ProposalHttpDetail` in `./create_run` — see "WIDENED"
 *     below) — never silently ends a playing content plan.
 *  4. Stamp the run's CURRENT `journey_state.lifecycle_stage`/`.motion_state`
 *     onto a COPY of the run's base `world.control_inputs`/`.situation`
 *     (mirrors `World.model_copy(update=...)`, a shallow-copy-with-override —
 *     reproduced here as a plain object spread) — BEFORE the reviewer's own
 *     `body.overrides` are applied, so an override can still win.
 *  5. Resolve the dataset catalog for the (possibly stale) dataset_id, then
 *     `applyOverrides(effectiveBaseWorld, body.overrides, {catalog})` — an
 *     empty `overrides` array is a legitimate no-op (returns the base world
 *     unchanged, zero diffs). Catches `InvalidOverrideError` ->
 *     `ProposalHttpError(422, exc.issues)`.
 *  6. Re-resolve `service_pkg`/`content_pkg` from the run's OWN
 *     `service_package_id`/`content_package_id` (never from a request body —
 *     `RecomputeRequest` has no package-id fields) — `ProposalHttpError(422)`
 *     if either is unknown/mis-slotted (wrong family). **This is the SAME
 *     pre-check `create_proposal_run` performs at its own call site, and it
 *     unconditionally fires BEFORE step 12's quick_check dispatch phase ever
 *     runs — see "UNREACHABLE: applyQuickCheckContent's own mis-slotted-
 *     package raise" below.**
 *  7. Resolve `parameters`/`hyperparameters`: `body.parameters` truthy ->
 *     itself, else **`runLog.parameters` (the RUN's own current parameters —
 *     NOT `service_pkg`'s manifest defaults)** — see "DIVERGES FROM
 *     create_run.ts" below. Same shape for `hyperparameters`/
 *     `runLog.hyperparameters`.
 *  8. `origin = runLog.setup_snapshot?.origin ?? null` (the run's EXISTING
 *     origin carried forward, never re-derived — there is no
 *     `CreateProposalRunBody` here to derive one from). **Freeze a new
 *     snapshot**: `freezeSetupSnapshot({world: newWorld, matrixVersion:
 *     runLog.matrix_version, ...})` — imported from `./create_run` (Task 3),
 *     NOT re-ported. Note `matrixVersion` here is the RUN's OWN frozen
 *     value, not the freshly-loaded matrix's version (see "WHICH
 *     matrix_version" below).
 *  9. Load the CURRENT matrix (`getMatrix()`) and `resolveMatrix(matrix,
 *     newWorld.control_inputs.trigger_purpose, .lifecycle_stage)` — catches
 *     `MatrixResolutionError` -> `ProposalHttpError(422, exc.message)`. See
 *     "UNREACHABLE: MatrixResolutionError" below for why real committed data
 *     can never actually throw this, from THIS call site specifically.
 * 10. Mint a fresh `opportunity_id`; `buildProposalOpportunity(...)`
 *     (imported from `./create_run`, Task 3 — NOT re-ported) — reusing
 *     `runLog.opportunity.simulation_time`/`.run_seed` unchanged. Throws for
 *     an empty `allowedServiceIds` (the `during_rest_stopped` row — REACHABLE
 *     here via an override that lands lifecycle_stage on that row while
 *     trigger_purpose stays `rest_recommended`, a structurally-compatible
 *     pair per `World`'s own validator).
 * 11. Run eligibility (`resolveEligibility`) against the NEW
 *     `worldSnapshot`/`new_world.control_inputs.motion_state`; build
 *     `excludedCandidatesCtx` unconditionally (used only in the eligible
 *     branch, computed either way — matches Python's own ordering).
 * 12. Build events, ALL sharing one `at = nowIso()`:
 *       - `CONTEXT_EDITED` (payload `{diffs}`) IFF `diffs.length > 0` — keyed
 *         on a non-empty OVERRIDES LIST, not on whether any value actually
 *         changed.
 *       - `OPPORTUNITY_OPENED` (always).
 *       - `RECOMPUTED` (always) — `{from_opportunity_id: runLog.opportunity
 *         .opportunity_id, to_opportunity_id: opportunityId}`.
 *       - Then either:
 *         - `eligibilityResult.eligible.length === 0` -> `NO_ELIGIBLE_
 *           CANDIDATE`, `status = 'service_selected'`, no selector dispatch,
 *           no evidence. **Unreachable with real committed data** — same
 *           class of branch `create_run.ts`'s own T017a note documents (the
 *           matrix's 5 non-empty rows always have >=1 motion/entity-safe
 *           service); Python's OWN test suite
 *           (`test_recompute_zero_eligible_records_no_eligible_candidate_
 *           never_fabricated`) reaches it only by monkeypatching
 *           `resolve_eligibility` — covered here the same way, via
 *           `vi.spyOn(getServiceCapabilities)` (see the test file).
 *         - else: `buildServiceContext` + `dispatchSelector` (service).
 *           `evidence.error !== null` -> `ALGORITHM_ERROR`, `status =
 *           'error'`. Else: `ranked_candidates = pyGetDefault(evidence.
 *           output, 'ranked_candidates', [])` GUARDED by `pyTruthy(evidence
 *           .output)` (same two-idiom split as `create_run.ts`'s own item 1
 *           — see "dict.get audit" below); non-empty -> `selectedServiceId =
 *           ranked_candidates[0].candidate_id`, `SERVICE_SELECTED` event
 *           with **`rank` HARD-CODED to the literal `1`** (recompute has NO
 *           `quick_check_service_id`-style override — `selectedServiceId` is
 *           ALWAYS rank-1 by construction, so Python writes the literal
 *           rather than computing `rankedIds.indexOf(...)+1` the way
 *           `create_run.ts` must, for the fidelity of a literal-vs-computed
 *           difference that happens to be numerically equal always). `status
 *           = 'service_selected'` either way (error or not, rank-0
 *           ranked_candidates or not).
 * 13. `newOpportunityHistory = [...runLog.opportunity_history, runLog.
 *     opportunity]` / `newSetupSnapshotHistory = [...runLog.setup_snapshot_
 *     history, runLog.setup_snapshot]` — push the PRIOR head (not the new
 *     one) — append-only (Step 4's own discipline).
 * 14. `newJourneyState = {...js, active_service_id: selectedServiceId,
 *     rejected_service_ids: []}` — a PATCH (`model_copy(update=...)`), NOT a
 *     full reconstruction. **Diverges from `select_service.ts`'s own
 *     JOURNEY-STATE RESET** — `lifecycle_stage`/`motion_state`/
 *     `playback_state`/`previous_content`/`current_plan_ref`/
 *     `active_plan_id` are all PRESERVED here, not defaulted.
 * 15. Append every event (`appendEvent`, in order), then the service evidence
 *     if any (`appendEvidence`) — both plain disk-mode calls (no `cache`).
 * 16. `updateState(runId, {status, journeyState, opportunity, worldSnapshot,
 *     setupSnapshot, opportunityHistory, setupSnapshotHistory})` — `content_
 *     parameters`/`content_hyperparameters` are NOT touched here (omitted
 *     kwargs stay unchanged) — a STALE prior decision point's content
 *     parameters survive an interactive recompute untouched, faithfully.
 * 17. `runLog.mode === 'quick_check' && selectedServiceId !== null` ->
 *     resolve `content_parameters_for_dispatch = pyTruthy(body.content_
 *     parameters) ? body.content_parameters : {...contentPkg.parameters}` /
 *     `content_hyperparameters_for_dispatch` the same shape against
 *     `contentPkg`'s own hyperparameter defaults (package defaults here —
 *     NOT the run's own, unlike step 7's parameters/hyperparameters — see
 *     "DIVERGES" below), then `applyQuickCheckContent(runId, runLog,
 *     selectedServiceId, ..., {})` — imported from `./select_service` (Task
 *     4), called DIRECTLY (no injected seam: unlike `create_run.ts`,
 *     Python's own `recompute_proposal_run` call site has no seam either —
 *     `_apply_quick_check_content` already existed when recompute was
 *     written, so it is just a normal function call). `runLog` reassigned to
 *     its return value.
 * 18. Return `runLog`.
 *
 * ── DIVERGES FROM create_run.ts: parameters/hyperparameters fallback, AND
 * are NEVER PERSISTED back onto the run ──────────────────────────────────
 *
 * `create_proposal_run` falls back to `service_pkg`'s OWN manifest defaults
 * when `body.parameters`/`.hyperparameters` are absent (a brand-new run has
 * no prior state to fall back to). `recompute_proposal_run` falls back to
 * **`run_log.parameters`/`run_log.hyperparameters` — the run's CURRENT
 * values** (`parameters = body.parameters or dict(run_log.parameters)`).
 *
 * A SECOND, easy-to-miss fact matters more than the fallback source: verify
 * step 16's `prm.update_state(...)` call site directly (`routers/
 * proposal.py:1778-1787`) — it passes NO `parameters=`/`hyperparameters=`
 * kwarg at all, and `update_state`'s OWN signature (`services/proposal_run_
 * manager.py`) has no such parameter to receive one even if it tried
 * (only `content_parameters`/`content_hyperparameters` are settable there).
 * **`runLog.parameters`/`.hyperparameters` are therefore IMMUTABLE after
 * create, forever — no recompute, regardless of what `body.parameters`/
 * `.hyperparameters` contains, EVER changes them.** The `parameters`/
 * `hyperparameters` this function resolves at step 7 are used ONLY for (a)
 * `freezeSetupSnapshot`'s `serviceHyperparameters` (-> `setupSnapshot.
 * service_parameter_set_version`, which the run's `setup_snapshot` field
 * DOES persist) and (b) `buildServiceContext`'s own `parameters`/
 * `hyperparameters` fields, which flow into the DISPATCHED evidence's
 * `input_snapshot` (also persisted, as a new `evidence[]` entry) — but
 * `result.parameters`/`result.hyperparameters` themselves are byte-identical
 * to `runLog0.parameters`/`.hyperparameters` after EVERY recompute, success
 * or not, override supplied or not. This was verified empirically against
 * the real Python capture before writing this note (an early draft of the
 * `parameters_explicit_override_supplied_at_recompute` golden case assumed
 * `result.parameters` would reflect a supplied override — it does not; the
 * discriminating field is `evidence[-1].input_snapshot.parameters`, the
 * freshly-dispatched context, not the run's own top-level field). See both
 * golden cases + their tests for the mechanical proof (real package
 * defaults deliberately differ from the probe values so a golden alone
 * discriminates "supplied"/"fell back to run's own" from "package default").
 *
 * Content parameters/hyperparameters (step 17), by contrast, ARE persisted
 * — `applyQuickCheckContent` (`./select_service`) calls `updateState` with
 * `contentParameters`/`contentHyperparameters` set, and DOES fall back to
 * `content_pkg`'s own manifest defaults (matching `create_run.ts`'s own
 * quick_check content resolution) — there is no "run's own prior content
 * parameters" to fall back to differently here: `content_parameters` on the
 * run only gets frozen BY a content dispatch, and recompute's own step 17 IS
 * that dispatch.
 *
 * ── WHICH matrix_version: the run's OWN frozen value, never the freshly-
 * loaded matrix's ─────────────────────────────────────────────────────────
 *
 * Python passes `matrix_version=run_log.matrix_version` to BOTH `_freeze_
 * setup_snapshot` (step 8) AND `dispatch_selector` (step 12's `matrix_
 * version=run_log.matrix_version` kwarg) — the run's OWN value, frozen at
 * create time, NEVER the `matrix = PurposeStageServiceMatrix.load(...)`
 * object's own `.matrix_version` loaded fresh at step 9 purely to resolve
 * `allowed_service_ids`. `prm.update_state(...)` (step 16) has no `matrix_
 * version` kwarg at all — `run_log.matrix_version` is therefore IMMUTABLE
 * after create, forever, across any number of recomputes. Mirrored below by
 * reading `runLog.matrix_version` at every one of those 2 call sites and
 * never touching it via `updateState`.
 *
 * ── UNREACHABLE: applyQuickCheckContent's own mis-slotted-package raise ────
 *
 * `select_service.ts`'s own module doc documents `dispatchContentForService`
 * /`applyQuickCheckContent`'s internal re-check of `content_pkg`'s family
 * (`REDUNDANT-BUT-LIVE CHECK`) — reachable from `applyQuickCheckContent`'s
 * OTHER real caller (`createProposalRun`'s quick_check seam) only in the
 * narrow case where a `service_selector`-family package ALSO happens to
 * declare the selected service in its own `supported_services`. From
 * `recomputeProposalRun`'s OWN call site that raise is provably UNREACHABLE:
 * step 6 above validates `contentPkg`'s family UNCONDITIONALLY, before
 * step 12 (dispatch) or step 17 (quick_check) ever run — a mis-slotted
 * `content_package_id` always 422s at step 6, long before `applyQuickCheck
 * Content` is ever called. Proven structurally (not merely asserted) by a
 * `vi.spyOn` on `../select_service`'s `applyQuickCheckContent` in the test
 * file, confirming it is NEVER invoked for a mis-slotted-content-package
 * hand-built run, even in `quick_check` mode.
 *
 * ── UNREACHABLE: MatrixResolutionError ──────────────────────────────────────
 *
 * The real committed `purpose_stage_matrix.v1.json` has exactly 6 rows: one
 * per `(rest_recommended, {before_rest_until_stop, during_rest_stopped,
 * after_rest_before_restart})` triple, and one per `({inattentive_driving_
 * prevention_recovery, route_music, child_passenger_experience},
 * active_driving_content)` pair — i.e. EVERY `(trigger_purpose,
 * lifecycle_stage)` pair `World`'s OWN `_purpose_stage_compatible` validator
 * allows (`models/proposal/world.py:100-126`, mirrored by `world_validation
 * .ts`'s `structuralIssues`) already has a row. Since `applyOverrides`
 * re-validates the WHOLE world (including this compatibility rule) before
 * `resolveMatrix` ever runs, any override that would make `resolveMatrix`
 * throw an "unrepresented pair" `MatrixResolutionError` is ALREADY rejected
 * one step earlier, as an `InvalidOverrideError` (422, structural) at step
 * 5. `resolveMatrix` genuinely CAN still return an EMPTY list for a
 * compatible-but-empty row (`during_rest_stopped`) — that reaches step 10's
 * `buildProposalOpportunity`, a DIFFERENT 422. `recomputeProposalRun`'s own
 * `MatrixResolutionError` catch is therefore unreachable through real
 * committed data — covered instead via `vi.spyOn(matrixModule,
 * 'resolveMatrix')` forcing a throw (see the test file), proving the
 * catch-and-wrap itself, not `resolveMatrix`'s own logic (already tested
 * elsewhere).
 *
 * ── `dict.get(key, default)` / truthiness-`or` audit ────────────────────────
 *
 * `sed -n '1492,1815p' app/api/aica_api/routers/proposal.py | grep -n '\.get('`
 * — 4 raw hits (see task-5-report.md for the exact command + verbatim
 * output):
 *   - `registry.get(run_log.service_package_id)` / `registry.get(run_log.
 *     content_package_id) if run_log.content_package_id else None` — TWO
 *     ONE-ARG registry lookups (no default parameter) — excluded, same
 *     established convention as `create_run.ts`/`select_service.ts`'s own
 *     identical-shaped audits.
 *   - `evidence.output.get("ranked_candidates", []) if evidence.output else
 *     []` — the ONE genuine two-arg `.get(key, default)` site, GUARDED by a
 *     Python-truthiness ternary on the OUTER `evidence.output` (the SAME
 *     two-idiom split `create_run.ts`'s own item 1 documents) — mirrored
 *     with `pyGetDefault` INSIDE a `pyTruthy(evidence.output)` guard, never
 *     `??`/`||` alone.
 *   - `@router.get("/api/proposal/runs")` (line 1815, the LAST line of the
 *     324-LOC span per the brief) — a FastAPI route DECORATOR for the NEXT
 *     function (`list_runs`, out of this task's scope entirely), not a
 *     dict/registry `.get()` call at all — a false positive from the raw
 *     grep, excluded.
 * A SEPARATE truthiness site sits right next to it: `if ranked_candidates:`
 * (`routers/proposal.py:1743`) tests the `.get()` RESULT itself, Python-
 * truthy — NOT `len(ranked_candidates) > 0`. `create_run.ts`'s own
 * otherwise-identical code mirrors this with `.length > 0`, which is safe in
 * practice (a real `evaluate()` never returns an explicit-null `ranked_
 * candidates`) but would throw reading `.length` off `null` if `pyGetDefault`
 * ever passed one through (the present-but-null case `pyGetDefault` exists
 * to preserve). This file's own version below (`pyTruthy(rankedCandidatesRaw)`,
 * not `.length`) mirrors Python's SECOND truthiness check exactly instead —
 * found while designing this file's OWN `dict.get` mechanical-proof test
 * (which deliberately constructs `{ranked_candidates: null}` via a spy),
 * not a claim that `create_run.ts`'s equivalent is reachably broken (it
 * isn't, for the same "no real evaluate() output does this" reason) —
 * disclosed rather than silently copying a pattern that would crash under
 * this file's own test.
 * -> 4 raw hits, 3 excluded (2 one-arg registry lookups + 1 decorator false
 * positive), 1 genuine site, fixed with `pyGetDefault`.
 *
 * Separately (` or `, NOT `.get()`), 4 genuine Python-truthiness sites, ALL
 * mirrored with `pyTruthy` (never `??`/`||`):
 *   - `parameters = body.parameters or dict(run_log.parameters)`.
 *   - `hyperparameters = body.hyperparameters or dict(run_log.hyperparameters)`.
 *   - `content_parameters_for_dispatch = body.content_parameters or dict
 *     (content_pkg.parameters)`.
 *   - `content_hyperparameters_for_dispatch = body.content_hyperparameters or
 *     {hp.key: hp.default for hp in content_pkg.hyperparameters}`.
 *
 * ── Hazard pass (all eight, per Step 3) ─────────────────────────────────────
 * - Hazard 1 (banker's rounding): no `round()` in this function's own body —
 *   N/A (the algorithms it dispatches to have their own, already-audited
 *   handling; not re-audited here).
 * - Hazard 2 (`sorted()`/`.sort()`): none — N/A.
 * - Hazard 3 (`//`/`%` floor division): none — N/A.
 * - Hazard 4 (dict/insertion order): the only NEW ordering decisions this
 *   function makes (not inherited from an already-audited callee) are (a)
 *   the `events` array — built via sequential `.push()` in the EXACT order
 *   enumerated above (CONTEXT_EDITED?, OPPORTUNITY_OPENED, RECOMPUTED,
 *   then the eligible/not-eligible branch's own event(s)) — an array, whose
 *   order is structurally guaranteed by push-order, not incidental; (b) the
 *   `newOpportunityHistory`/`newSetupSnapshotHistory` APPENDS (`[...prior,
 *   headBeforeThisCall]`) — also array spread + push, structurally ordered.
 *   `excludedCandidatesCtx` maps over `eligibilityResult.excluded`, an
 *   already-ordered array from an already-audited callee (`resolveEligibility`)
 *   — no new hazard-4 site.
 * - Hazard 5 (bare `str(float)`): no float value is formatted into a string
 *   anywhere in this function — N/A.
 * - Hazard 6 (`neumaierSum`): no `sum()` over floats — N/A.
 * - Hazard 7 (`pyFixed`/`:.Nf`): no format-spec float formatting — N/A.
 * - Hazard 8 (`isinstance(x, (int, float))` accepting `bool`): ZERO
 *   `isinstance` calls anywhere in the 324-LOC span (confirmed by reading the
 *   full body, not a keyword grep alone) — N/A, no site to audit for this
 *   file.
 *
 * ── Error-shape mirroring (brief: "say how") ────────────────────────────────
 *
 * Every `raise HTTPException(...)` in this file's Python scope becomes
 * `throw new ProposalHttpError(status, detail)` (imported from `./create_run`,
 * the SAME shared class `select_service.ts` already reuses/widens):
 *   - 404 (run not found): bare string.
 *   - 422 (no typed world / unknown-mis-slotted service or content package /
 *     `MatrixResolutionError`): bare string, four distinct message shapes.
 *   - 422 (`InvalidOverrideError`): the EXISTING `Array<{path,code,message}>`
 *     shape (`exc.issues`, already a `ValidationIssue[]` — no reshaping
 *     needed, same array member `freezeSetupSnapshot` itself already
 *     produces).
 *   - 422 (`recompute_requires_idle_playback`): a NEW structured
 *     `{code, message}` shape (no `reason_codes` — unlike `select_service
 *     .ts`'s own `ServiceNotEligibleDetail`) — `ProposalHttpDetail` in
 *     `./create_run` is WIDENED (this task) to include
 *     `RecomputeRequiresIdlePlaybackDetail`, the same "widen the one shared
 *     union" pattern `select_service.ts` already established for its own
 *     new shape, rather than forking a second parallel error class.
 *   - 422 (empty `allowedServiceIds` at `buildProposalOpportunity`): bare
 *     string, propagates from `./create_run` unchanged (not re-thrown here).
 */
import {
  freezeSetupSnapshot,
  buildProposalOpportunity,
  ProposalHttpError,
  type SetupSnapshot,
} from './create_run'
import { getMatrix, makeOpportunityId, nowIso, getServiceCapabilities } from './context_base'
import { resolveMatrix, MatrixResolutionError, type TriggerPurpose } from '../matrix'
import type { LifecycleStage } from '../journey'
import { resolveEligibility, deriveRegisteredEntities, type ServiceId, type MotionState } from '../eligibility'
import { buildServiceContext, type PackageManifestLike } from './context'
import { dispatchSelector, type AlgorithmEvidence } from '../selector'
import { applyOverrides, InvalidOverrideError, type FieldOverride, type FieldDiff } from '../world_overrides'
import type { SongDoc } from '../world_validation'
import { proposalPackageRegistry, datasetCatalogRegistry } from '../stores'
import { pyReprQuoteOne } from '../py_repr'
import { applyQuickCheckContent } from './select_service'
import {
  getRun,
  appendEvent,
  appendEvidence,
  updateState,
  type ProposalRunLog,
  type DiscreteEvent,
  type JourneyState,
  type ProposalRunStatus,
} from '../run_manager'

// ---------------------------------------------------------------------------
// Small Python-mirroring local helpers — per-module-copy convention (see
// create_run.ts's own module doc for why each module keeps its own copy).
// ---------------------------------------------------------------------------

/** Mirrors Python's `dict.get(key, default)` — `default` only when `key` is
 * ABSENT; a present `null`/`undefined` value passes through unchanged. */
function pyGetDefault(obj: Record<string, unknown>, key: string, def: unknown): unknown {
  return Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : def
}

/** Mirrors Python truthiness for `x or default`. */
function pyTruthy(value: unknown): boolean {
  if (value == null) return false
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'object') return Object.keys(value as object).length > 0
  return Boolean(value)
}

/** Mirrors `dict(x)` for the plain JSON-shaped values this file handles. */
function shallowCopyRecord(value: Record<string, unknown>): Record<string, unknown> {
  return { ...value }
}

/** Mirrors Python's `{value!r}` for an `Optional[str]` — `repr(None) ==
 * 'None'` (bare, unquoted); a present string goes through `pyReprQuoteOne`.
 * Needed here (like `select_service.ts`'s own copy) because `run_log.
 * content_package_id: str | None` is genuinely nullable. */
function pyReprOptionalStr(v: string | null | undefined): string {
  return v == null ? 'None' : pyReprQuoteOne(v)
}

function makeEvent(eventType: string, at: string | number, payload: Record<string, unknown>): DiscreteEvent {
  return { event_type: eventType, at, payload }
}

// ---------------------------------------------------------------------------
// RecomputeRequest — mirrors models/proposal/recompute.py::RecomputeRequest
// (a distinct file from routers/proposal.py, out of this task's own file
// list, but its shape is tiny — hand-mirrored inline here, matching this
// port's established convention for every other request-body shape
// (`SelectServiceBody` in select_service.ts, `CreateProposalRunBody` in
// context_base.ts) rather than a separate one-type "models" file).
// ---------------------------------------------------------------------------

export type RecomputeRequest = {
  overrides?: FieldOverride[]
  parameters?: Record<string, unknown>
  hyperparameters?: Record<string, unknown>
  content_parameters?: Record<string, unknown>
  content_hyperparameters?: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// recomputeProposalRun (routers/proposal.py:1492-1815)
// ---------------------------------------------------------------------------

/**
 * Port of `recompute_proposal_run`. See module doc for the full control-flow
 * enumeration, the two "DIVERGES"/"WHICH matrix_version" notes, and the two
 * "UNREACHABLE" branches (both covered via `vi.spyOn` in the test file
 * rather than a fabricated Python capture).
 *
 * Always disk-mode — mirrors Python's own signature, which has no `cache`
 * parameter (unlike `createProposalRun`/mirrors `selectService`'s own
 * cache-less signature exactly).
 *
 * @throws ProposalHttpError(404) — `runId` has no persisted run.
 * @throws ProposalHttpError(422) — no typed `world` on the run; the current
 *   content plan is still `active`/`backgrounded`; an invalid override
 *   (`InvalidOverrideError`); unknown/mis-slotted `service_package_id`/
 *   `content_package_id`; an unrepresented matrix pair (unreachable with
 *   real data, see module doc); or an empty resolved `allowed_service_ids`
 *   (`buildProposalOpportunity`, propagated from `./create_run`).
 */
export async function recomputeProposalRun(runId: string, body: RecomputeRequest): Promise<ProposalRunLog> {
  const runLog0 = await getRun(runId)
  if (runLog0 === null) {
    throw new ProposalHttpError(404, `Proposal run ${pyReprQuoteOne(runId)} not found`)
  }

  if (runLog0.world == null) {
    throw new ProposalHttpError(422, 'recompute requires a typed-world run')
  }

  const js = runLog0.journey_state
  if (js.playback_state === 'active' || js.playback_state === 'backgrounded') {
    throw new ProposalHttpError(422, {
      code: 'recompute_requires_idle_playback',
      message:
        'Recompute requires the current content plan to be completed or stopped first / ' +
        'recomputeの前に現在のコンテンツプランを完了または停止してください',
    })
  }

  // Step 4 — stamp js.lifecycle_stage/motion_state onto a COPY of the base
  // world's control_inputs/situation. Mirrors World.model_copy(update=...):
  // a shallow copy with the given fields overridden, everything else
  // untouched (a plain object spread reproduces this exactly).
  const world = runLog0.world as Record<string, unknown>
  const controlInputs = (world.control_inputs ?? {}) as Record<string, unknown>
  const situation = (world.situation ?? {}) as Record<string, unknown>
  const effectiveControlInputs: Record<string, unknown> = {
    ...controlInputs,
    lifecycle_stage: js.lifecycle_stage,
    motion_state: js.motion_state,
  }
  const effectiveSituation: Record<string, unknown> = { ...situation, motion_state: js.motion_state }
  const effectiveBaseWorld = { ...world, control_inputs: effectiveControlInputs, situation: effectiveSituation }

  const datasetId = effectiveControlInputs.dataset_id as string
  const catalog = datasetCatalogRegistry.getCatalog(datasetId) as SongDoc[] | null

  let newWorld: Record<string, unknown>
  let diffs: FieldDiff[]
  try {
    const applied = applyOverrides(effectiveBaseWorld, body.overrides ?? [], { catalog })
    newWorld = applied.world
    diffs = applied.diffs
  } catch (exc) {
    if (exc instanceof InvalidOverrideError) {
      throw new ProposalHttpError(422, exc.issues)
    }
    throw exc
  }

  // Step 6 — re-resolve service_pkg/content_pkg from the RUN's own ids
  // (never from the body — RecomputeRequest has no package-id fields).
  // This is the pre-check that makes applyQuickCheckContent's own internal
  // re-check UNREACHABLE from this call site — see module doc.
  const servicePkg = proposalPackageRegistry.get(runLog0.service_package_id) as PackageManifestLike | null
  if (servicePkg === null || servicePkg.family !== 'service_selector') {
    throw new ProposalHttpError(
      422,
      `Unknown or mis-slotted service_package_id: ${pyReprQuoteOne(runLog0.service_package_id)}`,
    )
  }
  const contentPkg = runLog0.content_package_id
    ? (proposalPackageRegistry.get(runLog0.content_package_id) as PackageManifestLike | null)
    : null
  if (contentPkg === null || contentPkg.family !== 'content_selector') {
    throw new ProposalHttpError(
      422,
      `Unknown or mis-slotted content_package_id: ${pyReprOptionalStr(runLog0.content_package_id)}`,
    )
  }

  // Step 7 — DIVERGES FROM create_run.ts: falls back to the RUN's own
  // current parameters/hyperparameters, not the package's manifest
  // defaults. See module doc.
  const parameters: Record<string, unknown> = pyTruthy(body.parameters)
    ? (body.parameters as Record<string, unknown>)
    : shallowCopyRecord(runLog0.parameters)
  const hyperparameters: Record<string, unknown> = pyTruthy(body.hyperparameters)
    ? (body.hyperparameters as Record<string, unknown>)
    : shallowCopyRecord(runLog0.hyperparameters)

  // Step 8 — origin carried forward from the run's EXISTING setup_snapshot
  // (never re-derived); freeze the new snapshot. `runLog0.setup_snapshot ==
  // null` is unreachable with real data (a typed-world run always has one,
  // frozen at create time, guaranteed by the `world == null` guard above) —
  // ported anyway, faithfully, and covered via a direct synthetic unit test
  // (see the test file) since a real Python call site cannot reach it either.
  const origin =
    runLog0.setup_snapshot != null ? (runLog0.setup_snapshot as unknown as SetupSnapshot).origin : null
  const { worldSnapshot, setupSnapshot } = freezeSetupSnapshot({
    world: newWorld,
    matrixVersion: runLog0.matrix_version,
    servicePkg,
    contentPkg,
    serviceHyperparameters: hyperparameters,
    originSeedId: origin?.seed_id ?? null,
    originCloneId: origin?.clone_id ?? null,
    originProfileId: origin?.profile_id ?? null,
  })

  // Step 9 — resolve against the CURRENT matrix (unreachable-with-real-data
  // MatrixResolutionError catch — see module doc).
  const matrix = getMatrix()
  const newControlInputs = newWorld.control_inputs as Record<string, unknown>
  const triggerPurpose = newControlInputs.trigger_purpose as TriggerPurpose
  const lifecycleStage = newControlInputs.lifecycle_stage as LifecycleStage
  const motionState = newControlInputs.motion_state as MotionState
  let allowedServiceIds: ServiceId[]
  try {
    allowedServiceIds = resolveMatrix(matrix, triggerPurpose, lifecycleStage)
  } catch (exc) {
    if (exc instanceof MatrixResolutionError) {
      throw new ProposalHttpError(422, exc.message)
    }
    throw exc
  }

  // Step 10 — reuse buildProposalOpportunity (./create_run, Task 3) rather
  // than re-porting the ProposalOpportunity(...) construction inline.
  const opportunityId = makeOpportunityId()
  const opportunity = buildProposalOpportunity({
    opportunityId,
    triggerPurpose,
    lifecycleStage,
    allowedServiceIds,
    simulationTime: runLog0.opportunity.simulation_time,
    runSeed: runLog0.opportunity.run_seed,
  })

  // Step 11 — eligibility narrows the allowed row BEFORE ranking.
  const capabilities = getServiceCapabilities()
  const registeredEntities = deriveRegisteredEntities(worldSnapshot)
  const eligibilityResult = resolveEligibility(allowedServiceIds, motionState, capabilities, { registeredEntities })
  const excludedCandidatesCtx = eligibilityResult.excluded.map((excl) => ({
    candidate_id: excl.service_id,
    platform_reason: excl.reason_codes.join(','),
  }))

  // Step 12 — events, all sharing one `at`.
  const at = nowIso()
  const events: DiscreteEvent[] = []
  if (diffs.length > 0) {
    events.push(makeEvent('CONTEXT_EDITED', at, { diffs }))
  }
  events.push(
    makeEvent('OPPORTUNITY_OPENED', at, {
      opportunity_id: opportunityId,
      trigger_purpose: opportunity.trigger_purpose,
      lifecycle_stage: opportunity.lifecycle_stage,
    }),
  )
  events.push(
    makeEvent('RECOMPUTED', at, {
      from_opportunity_id: runLog0.opportunity.opportunity_id,
      to_opportunity_id: opportunityId,
    }),
  )

  let evidence: AlgorithmEvidence | null = null
  let selectedServiceId: ServiceId | null = null
  let newStatus: ProposalRunStatus

  if (eligibilityResult.eligible.length === 0) {
    // T017a-equivalent — see module doc's "UNREACHABLE" note. Never
    // dispatch a selector, never fabricate a candidate.
    events.push(
      makeEvent('NO_ELIGIBLE_CANDIDATE', at, {
        excluded: eligibilityResult.excluded.map((excl) => ({
          service_id: excl.service_id,
          reason_codes: excl.reason_codes,
        })),
      }),
    )
    newStatus = 'service_selected'
  } else {
    const context = buildServiceContext({
      package: servicePkg,
      opportunity,
      worldSnapshot,
      enabledFeatureExtensions: [],
      parameters,
      hyperparameters,
      eligibleServiceIds: eligibilityResult.eligible,
      excludedCandidates: excludedCandidatesCtx,
    })
    evidence = dispatchSelector(servicePkg, context, {
      matrixVersion: runLog0.matrix_version,
      usedFeatureIds: Object.keys(context.feature_snapshot as Record<string, unknown>),
      allowedServiceIds: eligibilityResult.eligible,
    })
    if (evidence.error !== null) {
      newStatus = 'error'
      events.push(
        makeEvent('ALGORITHM_ERROR', at, { step: 'service', category: evidence.error.category, message: evidence.error.message }),
      )
    } else {
      // Hazard: dict.get(key, default) — see module doc's audit. Guarded by
      // pyTruthy on the OUTER evidence.output (matches create_run.ts's own
      // item 1 — a DIFFERENT idiom split, not both the same hazard).
      const rankedCandidatesRaw = pyTruthy(evidence.output)
        ? pyGetDefault(evidence.output as Record<string, unknown>, 'ranked_candidates', [])
        : []
      // Python: `if ranked_candidates:` — a SECOND, separate truthiness
      // check on the .get() RESULT itself (not `len(...) > 0`), so an
      // explicit-null `ranked_candidates` (pyGetDefault's present-but-null
      // passthrough — a real, exercised state, unlike create_run.ts's
      // otherwise-identical `.length > 0` precedent, which would throw
      // reading `.length` off `null`) is gracefully falsy here too, never a
      // crash. Mirrored with `pyTruthy`, not `.length`.
      if (pyTruthy(rankedCandidatesRaw)) {
        const rankedCandidates = rankedCandidatesRaw as Array<{ candidate_id: string }>
        selectedServiceId = rankedCandidates[0].candidate_id as ServiceId
        // rank is the LITERAL 1 (not rankedIds.indexOf(...)+1) — see module
        // doc step 12: recompute has no override, selectedServiceId is
        // always rank-1 by construction, and Python writes the literal.
        events.push(makeEvent('SERVICE_SELECTED', at, { selected_service_id: selectedServiceId, rank: 1 }))
      }
      newStatus = 'service_selected'
    }
  }

  // Step 13 — append-only history: push the PRIOR head, not the new one.
  const newOpportunityHistory = [...runLog0.opportunity_history, runLog0.opportunity]
  const newSetupSnapshotHistory = [...runLog0.setup_snapshot_history, runLog0.setup_snapshot as SetupSnapshot]

  // Step 14 — a PATCH of the existing journey_state, not a reconstruction.
  const newJourneyState: JourneyState = { ...js, active_service_id: selectedServiceId, rejected_service_ids: [] }

  // Step 15 — append events, then evidence. Disk-mode (no cache).
  for (const event of events) {
    await appendEvent(runId, event)
  }
  if (evidence !== null) {
    await appendEvidence(runId, evidence)
  }

  // Step 16 — content_parameters/content_hyperparameters intentionally
  // untouched (undefined -> preserved by updateState's own `!== undefined`
  // gate) unless step 17 below overwrites them.
  let runLog = await updateState(runId, {
    status: newStatus,
    journeyState: newJourneyState,
    opportunity,
    worldSnapshot,
    setupSnapshot,
    opportunityHistory: newOpportunityHistory,
    setupSnapshotHistory: newSetupSnapshotHistory,
  })

  // Step 17 — quick_check auto-dispatches content for the rank-1 service in
  // THIS SAME call, whenever this recompute actually yielded one. Falls back
  // to contentPkg's OWN manifest defaults (not the run's own — see module
  // doc's "DIVERGES" note, content side is unlike the service side).
  if (runLog.mode === 'quick_check' && selectedServiceId !== null) {
    const contentParametersForDispatch: Record<string, unknown> = pyTruthy(body.content_parameters)
      ? (body.content_parameters as Record<string, unknown>)
      : shallowCopyRecord((contentPkg.parameters as Record<string, unknown> | undefined) ?? {})
    let contentHyperparametersForDispatch: Record<string, unknown>
    if (pyTruthy(body.content_hyperparameters)) {
      contentHyperparametersForDispatch = body.content_hyperparameters as Record<string, unknown>
    } else {
      contentHyperparametersForDispatch = {}
      for (const hp of (contentPkg.hyperparameters as Array<{ key: string; default: unknown }> | undefined) ?? []) {
        contentHyperparametersForDispatch[hp.key] = hp.default
      }
    }
    runLog = await applyQuickCheckContent(
      runId,
      runLog,
      selectedServiceId,
      contentParametersForDispatch,
      contentHyperparametersForDispatch,
      {},
    )
  }

  return runLog
}
