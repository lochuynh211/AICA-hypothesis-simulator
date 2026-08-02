/**
 * `select_service` orchestrator — TS port of `routers/proposal.py`'s
 * `select_service` (1328-1491, 164 LOC), `_dispatch_content_for_service`
 * (1099-1179, 88 LOC) and `_apply_quick_check_content` (1187-1296, 141 LOC)
 * — feature 026 (htmlapp Combined export), slice C4a Task 4.
 *
 * ── Step 1: control flow, enumerated before any code below ─────────────────
 *
 * `dispatchContentForService` (mirrors `_dispatch_content_for_service`) —
 * PURE, no I/O:
 *   1. Re-resolve `content_pkg` from `runLog.content_package_id` via the
 *      registry; throw `ProposalHttpError(422)` if unknown/mis-slotted (a
 *      redundant re-check of the SAME condition `selectService` already
 *      performed upstream — see "REDUNDANT-BUT-LIVE CHECK" below for why
 *      this is NOT dead code from every call path).
 *   2. If `content_pkg.id === REAL_CONTENT_PACKAGE_ID` AND
 *      `runLog.setup_snapshot != null`: build the REAL context
 *      (`buildRealContentContext`) and redact its catalog for the persisted
 *      `evidenceInputSnapshot` (`redactCatalogForEvidence`). Else: build the
 *      mock/legacy context (`buildContentContext`), `evidenceInputSnapshot`
 *      stays `null` (dispatchSelector falls back to `context` itself).
 *   3. `dispatchSelector(content_pkg, context, {...})` — no
 *      `allowedServiceIds` (Python's own call site never passes
 *      `allowed_service_ids` either; that check is service-family only).
 *   4. Return `{evidence, evidenceInputSnapshot}`.
 *
 * `selectService` (mirrors `select_service`, the interactive STEP-2 entry
 * point) — ASYNC (persists through `run_manager.ts`):
 *   1. `getRun(runId)` — `ProposalHttpError(404)` if not found.
 *   2. `selected_service_id` must be a member of
 *      `runLog.opportunity.allowed_service_ids` — `ProposalHttpError(422)`
 *      (bare string detail) otherwise.
 *   3. Re-resolve eligibility against the CURRENT `journey_state.motion_state`
 *      (a `motion_change` journey action may have fired since create) —
 *      `ProposalHttpError(422)` with the STRUCTURED `service_not_eligible`
 *      detail (see "SEAM VERDICT" below) if excluded.
 *   4. Resolve `content_pkg` from `runLog.content_package_id`; `422` if
 *      unknown/mis-slotted (bare string) — this is the check that makes
 *      `dispatchContentForService`'s OWN internal re-check unreachable from
 *      THIS call path specifically (see "REDUNDANT-BUT-LIVE CHECK" below).
 *   5. `selected_service_id` must be a member of
 *      `content_pkg.supported_services` — `422` (bare string, WITH the
 *      "(unsupported_service)" suffix — a DIFFERENT message shape from
 *      `_apply_quick_check_content`'s own unsupported-service handling,
 *      see that function's own step 2).
 *   6. Resolve `content_parameters`/`content_hyperparameters` (body override
 *      — Python truthiness `or`, NOT `.get()` — or package defaults); merge
 *      `algorithm_config_overrides.content` if present.
 *   7. `dispatchContentForService(...)`.
 *   8. Build the event (`ALGORITHM_ERROR` on `evidence.error`, else
 *      `CONTENT_SELECTED`), `newStatus` (`error`/`content_selected`), and
 *      `newActiveServiceId` (unchanged on error, else `selected_service_id`).
 *   9. Append the event, append the evidence.
 *  10. Rebuild `journey_state` — a BRAND NEW `JourneyState`, NOT a
 *      spread-and-patch of the existing one (see "JOURNEY-STATE RESET" below
 *      — a real, deliberately-mirrored Python behavior, not a porting bug).
 *  11. Re-freeze `setup_snapshot.content_package_id`/
 *      `.content_contract_version`/`.content_parameter_set_version` to what
 *      was ACTUALLY used at this STEP 2 (FIX 2, whole-branch review) — only
 *      when `runLog.setup_snapshot != null`.
 *  12. `updateState(...)`; return the result.
 *
 * `applyQuickCheckContent` (mirrors `_apply_quick_check_content`) — ASYNC,
 * threads `cache` verbatim to every `run_manager.ts` call (feature 020,
 * Slice-2c) — this IS the Task-3 seam (`ApplyQuickCheckContentFn`,
 * `create_run.ts`), wired for real below (see "SEAM VERDICT"):
 *   1. Resolve `content_pkg`; if `null` OR `selected_service_id` is NOT in
 *      its `supported_services` (note: `content_pkg` is checked FIRST via
 *      `||` short-circuit, mirroring Python's `or` — `content_pkg`'s
 *      `.supported_services` is never read when `content_pkg` is `null`):
 *      append an `ALGORITHM_ERROR` event (category `unsupported_service`,
 *      message uses `run_log.content_package_id!r` — NOT `content_pkg.id`,
 *      unlike `selectService`'s own unsupported-service message, and has NO
 *      "(unsupported_service)" suffix), `updateState(status: 'error')`, and
 *      RETURN NORMALLY — never raises for THIS specific condition (quick_check
 *      is automatic; there is no user request to 422 back to).
 *   2. `dispatchContentForService(...)` — UNGUARDED (no try/catch around
 *      this call in Python either) — see "REDUNDANT-BUT-LIVE CHECK": this
 *      means `applyQuickCheckContent` CAN still throw `ProposalHttpError`,
 *      via `dispatchContentForService`'s own re-check, for the one narrow
 *      case step 1's guard cannot catch (a mis-slotted `content_pkg` whose
 *      `supported_services` happens to already include the selected id —
 *      see the coverage table).
 *   3. Build the event/status exactly like `selectService`'s own step 8 —
 *      MINUS the `journey_state` rebuild: `journey_state` is NEVER touched
 *      here (Python's own docstring: both callers already set
 *      `active_service_id` to this same rank-1 service before this helper
 *      ever runs).
 *   4. Append event, append evidence (both `cache`-forwarded).
 *   5. Re-freeze `setup_snapshot` exactly like `selectService`'s step 11.
 *   6. `updateState(..., cache)`; return the result.
 *
 * ── REDUNDANT-BUT-LIVE CHECK: `dispatchContentForService`'s own
 * mis-slotted-package raise ──────────────────────────────────────────────
 *
 * `selectService` ALWAYS validates `content_pkg` (unknown/mis-slotted)
 * BEFORE ever calling `dispatchContentForService` — so from THAT call path,
 * `dispatchContentForService`'s own identical internal check can never fire
 * (dead code from `selectService`, exactly mirroring Python's own redundant
 * double-check at `select_service`/`_dispatch_content_for_service`'s two
 * call sites).
 *
 * `applyQuickCheckContent` has NO such upstream family check — its own
 * guard (step 1 above) only tests `content_pkg is None or selected_service_id
 * not in content_pkg.supported_services`. A `service_selector`-family
 * package that ALSO declares `supported_services` (the REAL
 * `aica_transparent_service_selector_v1` does — verified directly against
 * the committed manifest: `supported_services: ['music_playlist',
 * 'humming_karaoke', ...]`) slips PAST that guard when the selected service
 * happens to be one of them, reaching `dispatchContentForService`, whose OWN
 * family check then fires — and, because `applyQuickCheckContent` has no
 * try/except around that call (neither does Python), the
 * `ProposalHttpError(422)` propagates OUT of `applyQuickCheckContent`
 * uncaught. This is a REAL, reachable-with-real-committed-data branch (the
 * `quick_check_mis_slotted_raises` golden case), not a synthetic
 * unreachable-path fabrication — see the coverage table.
 *
 * ── JOURNEY-STATE RESET (disclosed, not silently ported): `selectService`
 * discards playback_state/current_plan_ref/previous_content/
 * rejected_service_ids ──────────────────────────────────────────────────
 *
 * Python's `JourneyState(lifecycle_stage=..., motion_state=..., active_
 * service_id=new_active_service_id, active_plan_id=run_log.journey_state.
 * active_plan_id)` constructs a BRAND NEW pydantic model — `active_plan_id`
 * is the only field explicitly carried over from the existing state;
 * `playback_state`/`current_plan_ref`/`previous_content`/
 * `rejected_service_ids` (models/proposal/journey.py:47-50, P4 additions)
 * are OMITTED from the constructor call, so pydantic fills them with their
 * OWN defaults (`idle`/`null`/`null`/`[]`) regardless of what the run's
 * existing `journey_state` actually held. This looks like it could be an
 * unintended side effect of P4's fields being bolted onto an `active_plan_id`-era
 * call site that was never revisited — but the brief's own framing is to
 * port function bodies faithfully, not to silently "fix" what might be a
 * latent Python bug. `makeJourneyState` below reproduces this EXACTLY: it
 * takes `activePlanId` as an explicit carried-over parameter and hard-codes
 * the 4 P4 fields to their defaults, matching create_run.ts's OWN local
 * `makeJourneyState` in spirit but NOT signature — that one hard-codes
 * `active_plan_id: null` too (matching `create_proposal_run`'s OWN
 * `JourneyState(..., active_plan_id=None)` call, a genuinely different
 * Python call site with a different literal) — so this file keeps its OWN
 * local copy rather than importing create_run.ts's (per this port's
 * established per-module-copy convention for small Python-mirroring
 * helpers), with the ONE difference that reality demands.
 *
 * ── SEAM VERDICT (brief: "you are the real test of a provisional seam") ────
 *
 * Task 3's `create_run.ts` designed `options.applyQuickCheckContent:
 * ApplyQuickCheckContentFn` against Python's OWN call-site argument list —
 * `(run_id, run_log, selected_service_id, content_parameters,
 * content_hyperparameters, *, cache)` — before this function existed.
 * `applyQuickCheckContent` below is written to satisfy that EXACT signature
 * (`(runId, runLog, selectedServiceId, contentParameters,
 * contentHyperparameters, options: {cache?}) => Promise<ProposalRunLog>`)
 * and IS wired in as the real seam value in this task's own test file
 * (`tests/proposal_select_service_port.test.ts`'s
 * "seam wiring — the real applyQuickCheckContent through createProposalRun"
 * describe block) — no reshaping was needed. Every one of the seam's design
 * choices holds up against the real implementation:
 *   - Argument order/names: exact match, no adapter/wrapper needed.
 *   - Async-ness: `applyQuickCheckContent` is inherently async (it calls
 *     `appendEvent`/`appendEvidence`/`updateState`, all
 *     `Promise<ProposalRunLog>`) — the seam's `Promise<ProposalRunLog>`
 *     return type was the right call, not a guess that happened to work.
 *   - Error propagation: the seam does not wrap or transform errors —
 *     `createProposalRun` lets whatever `options.applyQuickCheckContent`
 *     throws propagate untouched (proven directly: a fake seam that
 *     rejects is not caught/transformed anywhere in `createProposalRun`,
 *     see the seam-wiring test's own "no error transformation" case).
 *     This turns out to matter for real IN PRINCIPLE: the
 *     `quick_check_mis_slotted_raises` branch above means
 *     `applyQuickCheckContent` CAN throw `ProposalHttpError` (not just
 *     resolve to an error-status run log) — but that EXACT scenario is
 *     itself unreachable through `createProposalRun`'s own real call site
 *     (its STEP-1 pre-check already validates `content_package_id`'s
 *     family before quick_check's inline content-dispatch phase ever
 *     runs — the SAME "REDUNDANT-BUT-LIVE CHECK" phenomenon this file's
 *     own module doc documents, one layer higher). The un-wrapped
 *     pass-through still matters — a future caller reaching this
 *     function directly (as the golden's own capture does) needs it — it
 *     just cannot be demonstrated end-to-end through `createProposalRun`
 *     specifically for this one exception; see the seam-wiring test's own
 *     comment for the full reachability chain.
 *   - `cache` threading: the seam's `options: {cache?: ProposalRunCache}`
 *     trailing-object shape matches this file's own `cache` handling
 *     exactly (same `ProposalRunCache` type, same "forward verbatim,
 *     `undefined` when omitted" behavior already established by
 *     `run_manager.ts`).
 * VERDICT: the seam is correct as designed. `create_run.ts` required NO
 * changes for this task. (The widened `ProposalHttpError`/`ProposalHttpDetail`
 * union IS a `create_run.ts` change this task made — but it is unrelated to
 * the seam itself: it is this file's OWN new detail shape
 * (`service_not_eligible`) riding on the ALREADY-CORRECT, pre-existing
 * `ProposalHttpError` class, which this file reuses rather than forking a
 * parallel error type. See that class's own doc comment.)
 *
 * ── `dict.get(key, default)` audit (brief: "the mechanical check with the
 * best track record") ───────────────────────────────────────────────────
 *
 * `sed -n '1099,1491p' app/api/aica_api/routers/proposal.py | grep -n '\.get('`
 * — 5 raw hits (see task-4-report.md for the exact command + verbatim
 * output). Read individually:
 *   - `registry.get(run_log.content_package_id) if run_log.content_package_id
 *     else None` — THREE occurrences (once each in `_dispatch_content_for_
 *     service`, `_apply_quick_check_content`, `select_service`'s own body).
 *     ONE-ARG registry lookups (no default parameter) — excluded, same
 *     established convention as `create_run.ts`'s own audit for the
 *     identical idiom.
 *   - `content_hyperparameters.get("parameter_set_version", content_pkg.
 *     version)` — TWO occurrences (`select_service`, `_apply_quick_check_
 *     content` — byte-identical expression in both). GENUINE two-arg
 *     `.get(key, default)` hazard sites — BOTH mirrored with the local
 *     `pyGetDefault` below, never `??`/`||`.
 * -> 5 raw hits, 3 excluded (one-arg `.get`), 2 genuine sites, both fixed.
 *
 * Separately, `body.parameters or dict(content_pkg.parameters)` /
 * `body.hyperparameters or {...}` (`select_service`'s content-parameter
 * resolution) are Python TRUTHINESS `x or default` idioms, NOT `.get()` —
 * mirrored with `pyTruthy` below (an empty `{}` body default must still
 * fall back to the package defaults), matching `create_run.ts`'s own
 * identical-shaped service-side resolution.
 *
 * ── Hazard pass (all eight, per Step 3) ─────────────────────────────────────
 * - Hazard 1 (banker's rounding): no `round()` anywhere in this file's
 *   Python scope — N/A.
 * - Hazard 2 (`sorted()`/`.sort()`): none — N/A.
 * - Hazard 3 (`//`/`%` floor division): none — N/A.
 * - Hazard 4 (dict/insertion order): every object this file builds is a
 *   FIXED-SHAPE literal (event payloads, the `service_not_eligible` detail,
 *   the rebuilt `JourneyState`, the `setup_snapshot` patch) — none iterates
 *   a dict/set whose insertion order could diverge. The one borrowed
 *   iteration (`context.feature_snapshot` keys, for `usedFeatureIds`) reads
 *   an object already built by `context.ts`'s own hazard-4-audited
 *   functions — not a NEW ordering decision made in this file.
 * - Hazard 5 (bare `str(float)`): no float value is ever formatted into a
 *   string here — every field this file reads/writes is a string/enum/dict,
 *   never interpolated as a bare float — N/A.
 * - Hazard 6 (`neumaierSum`): no `sum()` over floats — N/A.
 * - Hazard 7 (`pyFixed`/`:.Nf`): no format-spec float formatting — N/A.
 * - Hazard 8 (`isinstance(x, (int, float))` accepting `bool`): ZERO
 *   `isinstance` calls anywhere in `select_service`/
 *   `_dispatch_content_for_service`/`_apply_quick_check_content` (confirmed
 *   by reading the full ~393-LOC span, not a keyword grep alone) — N/A, no
 *   site to audit for this file. (`dispatchSelector`, which this file calls,
 *   has its OWN hazard-8 handling already ported/documented in `selector.ts`
 *   — not re-audited here, service-family only anyway.)
 *
 * ── Error-shape mirroring (brief: "say how") ────────────────────────────────
 *
 * Every `raise HTTPException(...)` in this file's Python scope becomes
 * `throw new ProposalHttpError(status, detail)` (imported from
 * `./create_run`, NOT a new local class — see "SEAM VERDICT" above and that
 * class's own doc comment for the union widening this task made):
 *   - 404 (run not found): bare string detail.
 *   - 422 (not in allowed_service_ids / mis-slotted content package /
 *     unsupported service): bare string detail, three distinct message
 *     shapes (see the control-flow enumeration above for exact wording).
 *   - 422 (service_not_eligible): the NEW structured `ServiceNotEligibleDetail`
 *     shape (`{code, message, reason_codes}`), widened into
 *     `ProposalHttpDetail` by this task.
 * `_apply_quick_check_content`'s own "content package doesn't support this
 * service" condition does NOT raise at all (see the control-flow
 * enumeration's step 1) — it is a NORMAL return path (an `ALGORITHM_ERROR`
 * event + `status: 'error'`), deliberately, since quick_check has no HTTP
 * request to 422 back to.
 */
import {
  ProposalHttpError,
  type ServiceNotEligibleDetail,
  type SetupSnapshot,
  type ApplyQuickCheckContentFn,
} from './create_run'
import { getServiceCapabilities, nowIso } from './context_base'
import { buildContentContext, buildRealContentContext, redactCatalogForEvidence, type PackageManifestLike } from './context'
import { resolveEligibility, deriveRegisteredEntities, type ServiceId, type MotionState } from '../eligibility'
import { dispatchSelector, type AlgorithmEvidence } from '../selector'
import { mergeAlgorithmConfig } from '../algorithm_config'
import { proposalPackageRegistry } from '../stores'
import { pyReprQuoteOne } from '../py_repr'
import {
  getRun,
  appendEvent,
  appendEvidence,
  updateState,
  type ProposalRunLog,
  type DiscreteEvent,
  type JourneyState,
  type ProposalRunStatus,
  type ProposalRunCache,
} from '../run_manager'

// ---------------------------------------------------------------------------
// Small Python-mirroring local helpers — per-module-copy convention (see
// create_run.ts's own module doc for why each module keeps its own copy
// rather than importing one; `pyReprQuoteOne` is the ONE deliberately shared
// exception, see py_repr.ts's own doc for why).
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

/** Mirrors `dict(x)` for the plain JSON-shaped values this file handles. */
function shallowCopyRecord(value: Record<string, unknown>): Record<string, unknown> {
  return { ...value }
}

/** Mirrors Python's `{value!r}` for an `Optional[str]` — `repr(None) ==
 * 'None'` (bare, unquoted), a present string goes through `pyReprQuoteOne`.
 * Needed here (unlike `create_run.ts`, whose equivalent fields are all
 * REQUIRED strings) because `run_log.content_package_id: str | None` is
 * genuinely nullable on `ProposalRunLog`. */
function pyReprOptionalStr(v: string | null | undefined): string {
  return v == null ? 'None' : pyReprQuoteOne(v)
}

/** Mirrors the literal `JourneyState(...)` reconstruction at
 * `select_service`'s own call site (routers/proposal.py:1445-1450) — see
 * module doc's "JOURNEY-STATE RESET" section for why `activePlanId` is the
 * ONLY field carried over, and the other P4 fields are hard-defaulted. */
function makeJourneyState(
  lifecycleStage: string,
  motionState: string,
  activeServiceId: ServiceId | null,
  activePlanId: string | null,
): JourneyState {
  return {
    lifecycle_stage: lifecycleStage,
    motion_state: motionState,
    active_service_id: activeServiceId,
    active_plan_id: activePlanId,
    playback_state: 'idle',
    current_plan_ref: null,
    previous_content: null,
    rejected_service_ids: [],
  }
}

function makeEvent(eventType: string, at: string | number, payload: Record<string, unknown>): DiscreteEvent {
  return { event_type: eventType, at, payload }
}

/** `content_pkg.id == _REAL_CONTENT_PACKAGE_ID` gate (routers/proposal.py:101). */
const REAL_CONTENT_PACKAGE_ID = 'aica_transparent_content_selector_v1'

// ---------------------------------------------------------------------------
// _dispatch_content_for_service -> dispatchContentForService
// (routers/proposal.py:1099-1179)
// ---------------------------------------------------------------------------

/**
 * Dispatch the CONTENT selector for `selectedServiceId` against `runLog`.
 * PURE — no I/O, no persistence; the caller (`selectService`/
 * `applyQuickCheckContent`) owns appending the resulting event/evidence.
 *
 * Mirrors `_dispatch_content_for_service` exactly, including its OWN
 * re-check of `runLog.content_package_id`'s validity — see the module doc's
 * "REDUNDANT-BUT-LIVE CHECK" section for which callers can and cannot reach
 * this function's own raise.
 *
 * @throws ProposalHttpError(422) — `runLog.content_package_id` resolves to
 *   no package, or a package whose `family !== 'content_selector'`.
 */
export function dispatchContentForService(
  runLog: ProposalRunLog,
  selectedServiceId: ServiceId,
  contentParameters: Record<string, unknown>,
  contentHyperparameters: Record<string, unknown>,
): { evidence: AlgorithmEvidence; evidenceInputSnapshot: Record<string, unknown> | null } {
  const contentPkg = runLog.content_package_id
    ? (proposalPackageRegistry.get(runLog.content_package_id) as PackageManifestLike | null)
    : null
  if (contentPkg === null || contentPkg.family !== 'content_selector') {
    throw new ProposalHttpError(
      422,
      `Unknown or mis-slotted content_package_id: ${pyReprOptionalStr(runLog.content_package_id)}`,
    )
  }

  let evidenceInputSnapshot: Record<string, unknown> | null = null
  let context: Record<string, unknown>
  // T034 (P3c) real-vs-mock gate — see module doc's control-flow step 2.
  if (contentPkg.id === REAL_CONTENT_PACKAGE_ID && runLog.setup_snapshot != null) {
    context = buildRealContentContext({
      package: contentPkg,
      runLog,
      selectedServiceId,
      contentParameters,
      contentHyperparameters,
    })
    const setup = runLog.setup_snapshot as unknown as SetupSnapshot
    evidenceInputSnapshot = redactCatalogForEvidence(context, setup.dataset_id)
  } else {
    context = buildContentContext({
      package: contentPkg,
      runLog,
      selectedServiceId,
      contentParameters,
      contentHyperparameters,
    })
  }

  const evidence = dispatchSelector(contentPkg, context, {
    matrixVersion: runLog.matrix_version,
    usedFeatureIds: Object.keys(context.feature_snapshot as Record<string, unknown>),
    evidenceInputSnapshot,
  })
  return { evidence, evidenceInputSnapshot }
}

// ---------------------------------------------------------------------------
// select_service -> selectService (routers/proposal.py:1327-1483, minus the
// `@router.post`/`SelectServiceBody` HTTP framing — see below)
// ---------------------------------------------------------------------------

/** Mirrors `SelectServiceBody` (routers/proposal.py:1304-1324) — the HTTP
 * request-body shape, minus pydantic's own defaulting (this port's callers
 * supply an already-resolved plain object; `parameters`/`hyperparameters`
 * default to `{}` the same way Python's pydantic `Field` defaults do). */
export type SelectServiceBody = {
  selected_service_id: ServiceId
  parameters?: Record<string, unknown>
  hyperparameters?: Record<string, unknown>
  algorithm_config_overrides?: { service?: Record<string, unknown> | null; content?: Record<string, unknown> | null } | null
}

/**
 * Port of `select_service` (routers/proposal.py:1328-1491). See module doc
 * for the full control-flow enumeration, the journey-state reset, and the
 * error-shape mirroring.
 *
 * @throws ProposalHttpError(404) — `runId` has no persisted run.
 * @throws ProposalHttpError(422) — `selected_service_id` not in the
 *   opportunity's `allowed_service_ids`; not currently eligible (structured
 *   `service_not_eligible` detail); `content_package_id` unknown/mis-slotted;
 *   or unsupported by the content package.
 */
export async function selectService(runId: string, body: SelectServiceBody): Promise<ProposalRunLog> {
  const runLog = await getRun(runId)
  if (runLog === null) {
    throw new ProposalHttpError(404, `Proposal run ${pyReprQuoteOne(runId)} not found`)
  }

  const selectedServiceId = body.selected_service_id
  if (!runLog.opportunity.allowed_service_ids.includes(selectedServiceId)) {
    throw new ProposalHttpError(
      422,
      `${pyReprQuoteOne(selectedServiceId)} is not in the opportunity's allowed_service_ids`,
    )
  }

  // FIX (whole-branch review Critical / SC-002 / FR-002) — see module doc.
  const capabilities = getServiceCapabilities()
  const registeredEntities = deriveRegisteredEntities(runLog.world_snapshot)
  const eligibility = resolveEligibility(
    runLog.opportunity.allowed_service_ids as ServiceId[],
    runLog.journey_state.motion_state as MotionState,
    capabilities,
    { registeredEntities },
  )
  if (!eligibility.eligible.includes(selectedServiceId)) {
    const excluded = eligibility.excluded.find((e) => e.service_id === selectedServiceId)
    const reasonCodes = excluded ? excluded.reason_codes : []
    const detail: ServiceNotEligibleDetail = {
      code: 'service_not_eligible',
      message:
        `${pyReprQuoteOne(selectedServiceId)} is not currently eligible / ` +
        `${pyReprQuoteOne(selectedServiceId)} は現在選択できません`,
      reason_codes: reasonCodes,
    }
    throw new ProposalHttpError(422, detail)
  }

  const contentPkg = runLog.content_package_id
    ? (proposalPackageRegistry.get(runLog.content_package_id) as PackageManifestLike | null)
    : null
  if (contentPkg === null || contentPkg.family !== 'content_selector') {
    throw new ProposalHttpError(
      422,
      `Unknown or mis-slotted content_package_id: ${pyReprOptionalStr(runLog.content_package_id)}`,
    )
  }

  const supportedServices = (contentPkg.supported_services as string[] | undefined) ?? []
  if (!supportedServices.includes(selectedServiceId)) {
    throw new ProposalHttpError(
      422,
      `Content package ${pyReprQuoteOne(contentPkg.id as string)} does not support service ` +
        `${pyReprQuoteOne(selectedServiceId)} (unsupported_service)`,
    )
  }

  // Hazard: Python truthiness `x or default` — NOT `.get()`. See module doc.
  const contentParameters: Record<string, unknown> = pyTruthy(body.parameters)
    ? (body.parameters as Record<string, unknown>)
    : shallowCopyRecord((contentPkg.parameters as Record<string, unknown> | undefined) ?? {})

  let contentHyperparameters: Record<string, unknown>
  if (pyTruthy(body.hyperparameters)) {
    contentHyperparameters = body.hyperparameters as Record<string, unknown>
  } else {
    contentHyperparameters = {}
    for (const hp of (contentPkg.hyperparameters as Array<{ key: string; default: unknown }> | undefined) ?? []) {
      contentHyperparameters[hp.key] = hp.default
    }
  }

  if (body.algorithm_config_overrides != null) {
    contentHyperparameters = mergeAlgorithmConfig(contentHyperparameters, body.algorithm_config_overrides.content ?? null)
  }

  const { evidence } = dispatchContentForService(runLog, selectedServiceId, contentParameters, contentHyperparameters)

  const at = nowIso()
  let event: DiscreteEvent
  let newStatus: ProposalRunStatus
  let newActiveServiceId: ServiceId | null
  if (evidence.error !== null) {
    event = makeEvent('ALGORITHM_ERROR', at, { step: 'content', category: evidence.error.category, message: evidence.error.message })
    newStatus = 'error'
    newActiveServiceId = runLog.journey_state.active_service_id as ServiceId | null
  } else {
    event = makeEvent('CONTENT_SELECTED', at, { selected_service_id: selectedServiceId })
    newStatus = 'content_selected'
    newActiveServiceId = selectedServiceId
  }

  await appendEvent(runId, event)
  await appendEvidence(runId, evidence)

  // JOURNEY-STATE RESET — see module doc. A brand new state, not a patch.
  const newJourneyState = makeJourneyState(
    runLog.journey_state.lifecycle_stage,
    runLog.journey_state.motion_state,
    newActiveServiceId,
    runLog.journey_state.active_plan_id as string | null,
  )

  // FIX 2 (whole-branch review) — see module doc.
  let updatedSetupSnapshot: SetupSnapshot | undefined
  if (runLog.setup_snapshot != null) {
    const setup = runLog.setup_snapshot as unknown as SetupSnapshot
    // Hazard: dict.get(key, default) — see module doc's audit.
    const usedContentParameterSetVersion = pyGetDefault(
      contentHyperparameters,
      'parameter_set_version',
      contentPkg.version,
    ) as string | null
    updatedSetupSnapshot = {
      ...setup,
      content_package_id: contentPkg.id as string,
      content_contract_version: contentPkg.contract_version,
      content_parameter_set_version: usedContentParameterSetVersion,
    }
  }

  return await updateState(runId, {
    status: newStatus,
    journeyState: newJourneyState,
    contentParameters,
    contentHyperparameters,
    setupSnapshot: updatedSetupSnapshot,
  })
}

// ---------------------------------------------------------------------------
// _apply_quick_check_content -> applyQuickCheckContent
// (routers/proposal.py:1187-1296) — the Task-3 seam, see module doc's
// "SEAM VERDICT".
// ---------------------------------------------------------------------------

/**
 * Quick-check-only: dispatch content for the auto-selected rank-1 service
 * via `dispatchContentForService` (the SAME helper `selectService` uses —
 * FR-014/SC-006 content parity) and advance the run to `content_selected` in
 * the SAME call. Shared by quick-check create (`createProposalRun`, via the
 * `create_run.ts#ApplyQuickCheckContentFn` seam) and quick-check recompute
 * (a later task).
 *
 * Satisfies `ApplyQuickCheckContentFn`'s exact signature (see module doc's
 * "SEAM VERDICT" for why no adapter was needed).
 *
 * `journey_state` is left COMPLETELY untouched here (unlike `selectService`)
 * — see module doc's control-flow step 3.
 *
 * @throws ProposalHttpError(422) — ONLY via `dispatchContentForService`'s own
 *   mis-slotted-package re-check, for the narrow real-data-reachable case
 *   documented in the module doc's "REDUNDANT-BUT-LIVE CHECK" section. The
 *   far more common "content package doesn't support this service" case
 *   does NOT throw — see step 1 below.
 */
export const applyQuickCheckContent: ApplyQuickCheckContentFn = async (
  runId,
  runLog,
  selectedServiceId,
  contentParameters,
  contentHyperparameters,
  options,
) => {
  const cache: ProposalRunCache | undefined = options?.cache
  const contentPkg = runLog.content_package_id
    ? (proposalPackageRegistry.get(runLog.content_package_id) as PackageManifestLike | null)
    : null
  const at = nowIso()

  // Step 1 — see module doc's control-flow enumeration + "REDUNDANT-BUT-LIVE
  // CHECK": `content_pkg === null` short-circuits BEFORE `.supported_services`
  // is ever read, mirroring Python's `or`.
  const supportedServices = contentPkg ? ((contentPkg.supported_services as string[] | undefined) ?? []) : []
  if (contentPkg === null || !supportedServices.includes(selectedServiceId)) {
    const event = makeEvent('ALGORITHM_ERROR', at, {
      step: 'content',
      category: 'unsupported_service',
      message:
        `Content package ${pyReprOptionalStr(runLog.content_package_id)} does not support service ` +
        `${pyReprQuoteOne(selectedServiceId)}`,
    })
    await appendEvent(runId, event, { cache })
    return await updateState(runId, { status: 'error', cache })
  }

  const { evidence } = dispatchContentForService(runLog, selectedServiceId, contentParameters, contentHyperparameters)

  let event: DiscreteEvent
  let newStatus: ProposalRunStatus
  if (evidence.error !== null) {
    event = makeEvent('ALGORITHM_ERROR', at, { step: 'content', category: evidence.error.category, message: evidence.error.message })
    newStatus = 'error'
  } else {
    event = makeEvent('CONTENT_SELECTED', at, { selected_service_id: selectedServiceId })
    newStatus = 'content_selected'
  }

  await appendEvent(runId, event, { cache })
  await appendEvidence(runId, evidence, { cache })

  // Mirrors selectService's own FIX 2 — see module doc.
  let updatedSetupSnapshot: SetupSnapshot | undefined
  if (runLog.setup_snapshot != null) {
    const setup = runLog.setup_snapshot as unknown as SetupSnapshot
    const usedContentParameterSetVersion = pyGetDefault(
      contentHyperparameters,
      'parameter_set_version',
      contentPkg.version,
    ) as string | null
    updatedSetupSnapshot = {
      ...setup,
      content_package_id: contentPkg.id as string,
      content_contract_version: contentPkg.contract_version,
      content_parameter_set_version: usedContentParameterSetVersion,
    }
  }

  return await updateState(runId, {
    status: newStatus,
    contentParameters,
    contentHyperparameters,
    setupSnapshot: updatedSetupSnapshot,
    cache,
  })
}
