/**
 * Orchestrator context helpers — TS port of the small, non-endpoint private
 * helpers living at the top of `app/api/aica_api/routers/proposal.py`:
 * `_resolve_run_setup` (29 LOC), `_make_opportunity_id` (12),
 * `_get_service_capabilities` (5), `_get_registry` (5),
 * `_get_dataset_registry` (5), `_service_capabilities_path` (4),
 * `_now_iso` (4), `_matrix_path` (4) — feature 026 (htmlapp Combined
 * export), slice C4a Task 1.
 *
 * These are the small pieces every later orchestrator task in this slice
 * needs before it can compose a full run — hence "context_base": the
 * shared ground floor, not a router and not an HTTP handler. Per the task
 * brief ("port functions, not endpoints"), HTTP framing (status codes,
 * path params, FastAPI `Depends`) is explicitly a LATER C4a task; nothing
 * here does that.
 *
 * ── Step 1: the `_get_*`/`_*_path` accessor mapping (no filesystem here) ──
 *
 * Python instantiates a fresh registry / computes a fresh `Path` on every
 * call (`ProposalPackageRegistry(settings.packages_dir)`, etc.) — cheap
 * because it's a local disk read, repeated deliberately so a monkeypatched
 * settings dir takes effect immediately (see that module's own docstring).
 * htmlapp has no filesystem: the identical committed data is already
 * scanned, validated, and indexed once at boot by `../../../data/registry.ts`
 * (`installRegistry()`), and FIVE of these SIX accessors are already ported
 * as ready-made lookups from an earlier task — reused here, not rewritten:
 *
 *   _get_registry()              -> `proposalPackageRegistry` (../stores.ts,
 *                                    C2 Task 1) — already the exact
 *                                    `.get(id)`/`.listSummaries()`/
 *                                    `.listSlots()` surface
 *                                    `ProposalPackageRegistry` has. Nothing
 *                                    to add here; a later task imports it
 *                                    directly from `../stores`.
 *   _get_dataset_registry()      -> `datasetCatalogRegistry` (../stores.ts,
 *                                    C2 Task 1) — already `.getCatalog(id)`/
 *                                    `.getProvenance(id)`/`.listDatasets()`.
 *                                    Same: import directly from `../stores`,
 *                                    nothing to add here.
 *   _get_service_capabilities()  -> `getServiceCapabilities()` BELOW — the
 *                                    one accessor with real (if small) glue
 *                                    left to write: composes the raw payload
 *                                    (`../../../data/registry.ts#getServiceCapabilities`,
 *                                    aliased `dataGetServiceCapabilities`
 *                                    below) with the lookup builder
 *                                    (`../eligibility.ts#buildServiceCapabilities`).
 *                                    That exact composition previously
 *                                    existed only inline at ONE test call
 *                                    site (`tests/proposal_eligibility_port.test.ts`)
 *                                    — no production/orchestrator code
 *                                    performed it before this task.
 *   _service_capabilities_path() -> NO EQUIVALENT. Its only job in Python is
 *                                    handing a `Path` to
 *                                    `_get_service_capabilities`'s
 *                                    `ServiceCapabilities.load()` call;
 *                                    `getServiceCapabilities()` above reads
 *                                    the already-parsed payload directly, so
 *                                    there is no "path" step to port — not
 *                                    stubbed, genuinely absent.
 *   _matrix_path()                -> NO EQUIVALENT, identical reasoning —
 *                                    folded into `getMatrix()` below instead
 *                                    of a separate path-then-load pair, the
 *                                    same way `_get_service_capabilities`
 *                                    folds above.
 *
 * ── Step 2: the clock / id-minting precedent ───────────────────────────────
 *
 * `_now_iso`/`_make_opportunity_id` mint a timestamp/random id. This port's
 * ESTABLISHED, already-reviewed precedent for exactly that is
 * `../run_manager.ts`'s own private `nowIso`/`makeProposalRunId` and
 * `../../../storage/merged_runs_store.ts`'s `makeMergedRunId`: a plain
 * `new Date().toISOString()` for the clock, and
 * `<prefix>_<Date.now().toString(36)>_<6 random hex chars>` for an id —
 * deliberately NOT byte-identical to Python's `strftime`-based
 * `<prefix>_<YYYYMMDD-HHMMSS>_<6hex>` format, because nothing parses either
 * format back apart.
 *
 * Verified for `_make_opportunity_id` SPECIFICALLY (not merely assumed from
 * the run-id precedent, per the brief's explicit instruction to check): a
 * repo-wide grep for `opportunity_id[`/`startswith("op_"`/`split("op_"`/any
 * regex asserting the literal `op_...` shape found ZERO call sites and zero
 * tests — `ProposalOpportunity`'s own `field_validator` only checks
 * non-empty (`models/proposal/opportunity.py`), never a format. So the same
 * divergent, collision-resistant scheme applies here too, tested the same
 * way `makeMergedRunId`'s own test does (`toMatch(/^op_[0-9a-z]+_[0-9a-f]{6}$/)`
 * + a distinctness check across many calls), not via a Python-captured
 * golden (nothing in this codebase captures a Python-side id/timestamp
 * value for byte comparison, for the same "nothing parses it, the exact
 * value is unverifiable across two independent clocks anyway" reason).
 *
 * Each module in this port that mints an id/timestamp keeps its OWN private
 * copy of `randHex`/the minting function (`run_manager.ts`,
 * `merged_runs_store.ts`, `stores.ts#makeProfileId` each have one) rather
 * than sharing across modules — this mirrors Python, where
 * `routers/proposal.py`'s `_now_iso`/`_make_opportunity_id` and
 * `services/proposal_run_manager.py`'s own SEPARATE private `_now_iso` are
 * two independent module-local helpers with identical bodies, never a
 * shared import (confirmed by reading both). `context_base.ts` follows the
 * same pattern: its own local `randHex`/`nowIso`/`makeOpportunityId`, not an
 * import from `../run_manager.ts`.
 *
 * ── `_resolve_run_setup` ────────────────────────────────────────────────────
 *
 * The one function here with real branching logic. Resolves the effective
 * `(trigger_purpose, lifecycle_stage, motion_state)`: the typed-world path
 * derives from `body.world.control_inputs` unless the caller ALSO passed
 * explicit top-level overrides (Python's `or`, ported as `??` — safe here
 * because `TriggerPurpose`/`LifecycleStage`/`MotionState` are string enums
 * that can never be falsy-but-present, so `None` is the only value `or`
 * treats specially, exactly what `??` checks); the legacy path requires all
 * three top-level fields (raises if any is missing — pydantic can't declare
 * "required unless `world` is set").
 *
 * Where Python raises `HTTPException(422, detail=...)` directly (this is
 * the ONE such site in this task's scope — `MatrixResolutionError`/etc. are
 * plain domain exceptions a LATER router layer wraps, not ported here), this
 * throws a plain `Error` carrying the exact Python `detail` text, with a
 * comment noting the status code — the SAME convention already established
 * at this port's router-equivalent layer
 * (`../../worker/handlers/proposal.ts`, e.g. `proposalPresetsGet`'s
 * `throw new Error(...)` for a 404). No `.statusCode` field is attached,
 * matching that precedent exactly rather than inventing a new shape; HTTP
 * status-code framing is explicitly a later C4a task per the brief.
 *
 * ── Hazard pass ──────────────────────────────────────────────────────────
 * - Hazard 1 (banker's rounding): no `round()` — N/A.
 * - Hazard 2 (`sorted()`/`.sort()`): none in these 8 functions — N/A.
 * - Hazard 3 (`//`/`%` floor division): none — N/A.
 * - Hazard 4 (dict/insertion order): none of these functions build output
 *   from dict/set iteration — N/A.
 * - Hazard 5 (bare `str(float)`): no float fields — N/A.
 * - Hazard 6 (`neumaierSum`): no `sum()` over floats — N/A.
 * - Hazard 7 (`pyFixed`/`:.Nf`): no format-spec float formatting — N/A.
 * - Hazard 8 (`isinstance(x, (int, float))` accepting `bool`): zero
 *   `isinstance` calls in any of these 8 Python functions (the full
 *   ~70-LOC span was read) — N/A, no site to audit.
 */
import {
  getMatrix as dataGetMatrix,
  getServiceCapabilities as dataGetServiceCapabilities,
} from '../../../data/registry'
import {
  buildServiceCapabilities,
  type ServiceCapabilities,
  type ServiceCapabilitiesDoc,
  type MotionState,
} from '../eligibility'
import { loadMatrix, type PurposeStageServiceMatrix, type TriggerPurpose } from '../matrix'
import { SERVICE_ID_VALUES } from '../enums'
import type { LifecycleStage } from '../journey'

// ---------------------------------------------------------------------------
// _get_service_capabilities / _service_capabilities_path (routers/proposal.py:124-130)
// ---------------------------------------------------------------------------

/** Mirrors `_get_service_capabilities()` fused with `_service_capabilities_path()`
 * — see the module doc's Step 1 for why the two Python functions collapse
 * into this one call here. */
/**
 * Mirrors `ServiceCapabilities.load()`'s EAGER completeness check
 * (models/proposal/service_capabilities.py:90-95): every `ServiceId` member
 * must be present, and a malformed artifact is reported once with the FULL
 * list of what is missing.
 *
 * This lives at the `load()` seam, NOT in `buildServiceCapabilities`. In
 * Python the check is in `load()` — the artifact-reading path — while the
 * model constructor validates nothing, so callers may legitimately build a
 * partial `ServiceCapabilities` (the eligibility parity tests do exactly that
 * for focused branch coverage). `buildServiceCapabilities` is the constructor
 * equivalent; `getServiceCapabilities` below is the `load()` equivalent.
 *
 * Without this the only guard is `.get()`'s lazy per-key throw, which fires
 * mid-run naming a single id — a divergence in WHEN the failure happens, not
 * merely in its wording.
 *
 * Exported so it can be tested against a partial doc directly, without
 * mocking the data registry.
 */
export function assertServiceCapabilitiesComplete(doc: ServiceCapabilitiesDoc): void {
  const present = new Set(doc.services.map((s) => s.service_id))
  const missing = SERVICE_ID_VALUES.filter((id) => !present.has(id))
  if (missing.length === 0) return
  // Python interpolates `sorted(m.value for m in missing)` — a list repr with
  // single quotes, e.g. ['a', 'b'] — so mirror that shape, not JSON's.
  const rendered = `[${[...missing].sort().map((m) => `'${m}'`).join(', ')}]`
  throw new Error(`service_capabilities artifact is missing ServiceId member(s): ${rendered}`)
}

export function getServiceCapabilities(): ServiceCapabilities {
  const doc = dataGetServiceCapabilities() as ServiceCapabilitiesDoc

  assertServiceCapabilitiesComplete(doc)
  return buildServiceCapabilities(doc)
}

// ---------------------------------------------------------------------------
// _matrix_path (routers/proposal.py:115-116) — folded into a loaded matrix
// ---------------------------------------------------------------------------

/** Mirrors the `PurposeStageServiceMatrix.load(_matrix_path())` call-site
 * idiom (routers/proposal.py:847, 1615) as ONE function — see the module
 * doc's Step 1 for why `_matrix_path()` has no separate TS equivalent. */
export function getMatrix(): PurposeStageServiceMatrix {
  return loadMatrix(dataGetMatrix())
}

// ---------------------------------------------------------------------------
// _now_iso / _make_opportunity_id (routers/proposal.py:159-172)
// ---------------------------------------------------------------------------

/** Mirrors `_now_iso()` (routers/proposal.py:171-172). Local copy — see
 * module doc's Step 2 for why this is not imported from `../run_manager.ts`. */
export function nowIso(): string {
  return new Date().toISOString()
}

/** Collision-resistant id; mirrors Python's `op_<ts>_<hex>` scheme
 * (`op_<YYYYMMDD-HHMMSS>_<6hex>`) but NOT its literal format — see module
 * doc's Step 2. Runs ONCE per opportunity, never inside a loop — same
 * technique as `../run_manager.ts#makeProposalRunId` /
 * `../../../storage/merged_runs_store.ts#makeMergedRunId`. */
function randHex(n: number): string {
  let s = ''
  for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 16).toString(16)
  return s
}

/** Mirrors `_make_opportunity_id()` (routers/proposal.py:159-168). */
export function makeOpportunityId(): string {
  return `op_${Date.now().toString(36)}_${randHex(6)}`
}

// ---------------------------------------------------------------------------
// _resolve_run_setup (routers/proposal.py:709-735)
// ---------------------------------------------------------------------------

/** The subset of `ControlInputs` (`models/proposal/world.py`) this function
 * reads — a typed `World`'s `control_inputs` always carries these 3 fields
 * (plus `matrix_version`/`dataset_id`, irrelevant here; the index signature
 * tolerates them and anything else without requiring callers to supply a
 * full `ControlInputs`). */
export type RunSetupControlInputs = {
  trigger_purpose: TriggerPurpose
  lifecycle_stage: LifecycleStage
  motion_state: MotionState
  [k: string]: unknown
}

/** The subset of `CreateProposalRunBody` (routers/proposal.py:658-706) this
 * function reads. */
export type RunSetupBody = {
  trigger_purpose?: TriggerPurpose | null
  lifecycle_stage?: LifecycleStage | null
  motion_state?: MotionState | null
  world?: { control_inputs: RunSetupControlInputs; [k: string]: unknown } | null
}

export type RunSetup = {
  triggerPurpose: TriggerPurpose
  lifecycleStage: LifecycleStage
  motionState: MotionState
}

/**
 * Resolve the effective `(trigger_purpose, lifecycle_stage, motion_state)`.
 * Mirrors `_resolve_run_setup` (routers/proposal.py:709-735) exactly — see
 * the module doc for the `or`/`??` equivalence and the HTTPException
 * mirroring convention.
 *
 * @throws Error — mirrors `HTTPException(422, detail="trigger_purpose,
 *   lifecycle_stage, and motion_state are required when 'world' is not
 *   supplied.")` — when `world` is absent and any of the three top-level
 *   fields is missing.
 */
export function resolveRunSetup(body: RunSetupBody): RunSetup {
  if (body.world != null) {
    const ci = body.world.control_inputs
    return {
      triggerPurpose: body.trigger_purpose ?? ci.trigger_purpose,
      lifecycleStage: body.lifecycle_stage ?? ci.lifecycle_stage,
      motionState: body.motion_state ?? ci.motion_state,
    }
  }
  if (body.trigger_purpose == null || body.lifecycle_stage == null || body.motion_state == null) {
    // Mirrors HTTPException(422, detail=...) — see module doc's
    // `_resolve_run_setup` section for the mirroring convention.
    throw new Error(
      "trigger_purpose, lifecycle_stage, and motion_state are required when 'world' is not supplied.",
    )
  }
  return {
    triggerPurpose: body.trigger_purpose,
    lifecycleStage: body.lifecycle_stage,
    motionState: body.motion_state,
  }
}
