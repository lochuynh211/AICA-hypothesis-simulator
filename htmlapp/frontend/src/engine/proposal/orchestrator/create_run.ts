/**
 * `create_proposal_run` orchestrator — TS port of `routers/proposal.py`'s
 * `create_proposal_run` (818-1091, ~274 LOC) and `_freeze_setup_snapshot`
 * (738-814, ~77 LOC) — feature 026 (htmlapp Combined export), slice C4a
 * Task 3.
 *
 * This is the function the whole C4a slice exists for: the merged layer's
 * `quickview`/`after-rest-proposal` both reduce to
 * `create_proposal_run(..., cache={})` (`services/merged_quickview.py`).
 *
 * ── Control flow (Step 1, written before any code below) ───────────────────
 *
 *   1. Resolve `service_pkg`/`content_pkg` from the registry; reject unknown
 *      or mis-slotted (wrong family) ids.
 *   2. Reject a body with neither a typed `world` nor a non-empty legacy
 *      `world_snapshot`.
 *   3. `resolveRunSetup(body)` — resolve (triggerPurpose, lifecycleStage,
 *      motionState); typed-world path derives from `world.control_inputs`
 *      unless overridden, legacy path requires all 3 top-level fields.
 *   4. Load the frozen matrix; resolve `allowedServiceIds` for the pair —
 *      throws if the pair is incompatible/unrepresented.
 *   5. Mint `opportunity_id`; build the `ProposalOpportunity` — throws if
 *      `allowedServiceIds` is empty (the `during_rest_stopped` row).
 *   6. Resolve `parameters`/`hyperparameters` (body override or package
 *      defaults); merge `algorithm_config_overrides.service` if present.
 *   7. **Freeze a snapshot**: if `body.world` is set, validate + project it
 *      into `(worldSnapshot, setupSnapshot)` (`freezeSetupSnapshot` below);
 *      else `worldSnapshot = body.world_snapshot` verbatim, `setupSnapshot
 *      = null`.
 *   8. **Run eligibility**: narrow `allowedServiceIds` to eligible/excluded
 *      before any ranking.
 *   9. If NOTHING is eligible: append a `NO_ELIGIBLE_CANDIDATE` event and
 *      write a run log with `evidence: []`, status `service_selected` —
 *      NEVER dispatch a selector over an empty candidate set.
 *  10. Else **build the service context** and **dispatch the service
 *      selector**; on error, append `ALGORITHM_ERROR` (status `error`); on
 *      success with a non-empty `ranked_candidates`, select the reviewer's
 *      `quick_check_service_id` override (quick_check mode only, and only
 *      if it is itself among the ranked ids) or rank-1, and append
 *      `SERVICE_SELECTED`.
 *  11. Write the run log (`runManager.createRun`, `cache` forwarded).
 *  12. **Optionally dispatch content**: only in `quick_check` mode AND only
 *      when STEP 10 actually produced a `selectedServiceId` — resolve
 *      content parameters/hyperparameters (+ `algorithm_config_overrides
 *      .content`) and delegate to the injected `applyQuickCheckContent`
 *      seam (see "OUT OF SCOPE" below); its return value becomes this
 *      function's own return value.
 *  13. Return the run log.
 *
 * ── OUT OF SCOPE: `_apply_quick_check_content` / `_dispatch_content_for_service` ──
 *
 * Both (routers/proposal.py:1099-1296) are explicitly Task 4's job per the
 * C4a plan's own "Type consistency" table and progress ledger ("Task 2:
 * ... _dispatch_content_for_service explicitly out of scope, flagged for
 * Task 4."). `createProposalRun` below still calls into that step —
 * Python's own function does — but through an INJECTED seam,
 * `options.applyQuickCheckContent` (type `ApplyQuickCheckContentFn` below),
 * mirroring the exact positional/keyword arguments Python's own call site
 * passes (`run_id, run_log, selected_service_id, content_parameters,
 * content_hyperparameters, *, cache`). Production wiring supplies the real
 * Task-4 implementation once it exists; this task's own tests supply a
 * fake one to prove `createProposalRun` reaches the branch, resolves the
 * right content parameters (including the preset-override merge), and
 * forwards `cache` — exactly the surface THIS task owns, without
 * reimplementing Task 4's own logic. Omitting the option while the branch
 * is actually reached throws a loud, named error rather than silently
 * returning the STEP-1-only run log (a silent behavioral divergence from
 * Python would be worse than a loud wiring failure here).
 *
 * ── SCOPE FINDING (disclosed, not silently absorbed): `World.project()` ────
 *
 * `_freeze_setup_snapshot` calls `world.project()` (`models/proposal/
 * world.py:497-541`, ~45 LOC + a 10-LOC helper, backed by the 48-entry
 * frozen `CONTENT_FEATURE_DISPOSITIONS` registry, `models/proposal/
 * dispositions.py`). This function was NOT assigned to any C4a task (the
 * task's own file list only references `routers/proposal.py`), nor to any
 * C0/C1/C2 task (grepped every plan doc under `docs/superpowers/plans/` for
 * `project(` and `World.project` — the only two hits are in a C2 Task 2
 * doc-comment citing project()'s OWN docstring to justify an unrelated
 * validation-scope decision, and in this task's own C4a plan doc, neither a
 * porting assignment). It is also needed by Task 5 (`recompute_proposal_run`
 * calls `_freeze_setup_snapshot` too, `routers/proposal.py:1604`) — a
 * shared foundation dependency, not a Task-3-only one.
 *
 * Unlike `_dispatch_content_for_service` (explicitly, deliberately assigned
 * elsewhere — a real judgment call with one obviously-correct resolution:
 * leave it out, design a seam), `World.project()` has no such assignment
 * anywhere, and `_freeze_setup_snapshot` — explicitly in this task's own
 * reference scope — is not completable without it: it is not an optional
 * branch that can be deferred behind a seam, it is the primary path the
 * real merged-layer caller always takes (`merged_quickview.py` calls
 * `CreateProposalRunBody(world=world, ...)` — the typed-`world` path — on
 * EVERY call, never the legacy `world_snapshot` path). Per the brief's own
 * "ask before guessing" instruction, this was evaluated as a stop-and-ask
 * candidate; the judgment made (see task-3-report.md for the full
 * reasoning) was to port it here, in full, with its own hazard pass and
 * golden coverage, rather than block Task 3 (and transitively Task 5)
 * entirely for a small (~55 LOC), pure, fully-Python-verified function.
 * `projectWorld` below is that port — verified against a live Python
 * interpreter's `World.project()` output on the real committed
 * `seed-night-highway-oshi` seed (see task-3-report.md), and cross-checked
 * against C4a Task 2's own already-captured `proposal_context.json`
 * fixture, whose `build_service_context_cases[0].output.feature_snapshot`
 * is exactly this function's real output on that same seed (Task 2 called
 * the real Python `_freeze_setup_snapshot` directly when capturing that
 * fixture — this port's numbers were never independently guessed).
 *
 * ── `dict.get(key, default)` audit (the mechanical check with the best
 * track record on this port — brief's own framing) ──────────────────────
 *
 * Scoped with (see task-3-report.md for the exact raw output):
 *   `sed -n '818,1091p' app/api/aica_api/routers/proposal.py | grep -n '\.get('`  (3 hits)
 *   `sed -n '738,814p' app/api/aica_api/routers/proposal.py | grep -n '\.get('`   (2 hits)
 *   `sed -n '465,541p' app/api/aica_api/models/proposal/world.py | grep -n '\.get('` (1 hit)
 * 6 raw `.get(` hits total; read individually, not all are the hazard:
 *   - `registry.get(body.service_package_id)` / `registry.get(body.
 *     content_package_id)` (create_proposal_run): ONE-ARG registry lookups
 *     (no default parameter at all) — not the `dict.get(key,default)`
 *     pattern, excluded.
 *   - `evidence.output.get("ranked_candidates", [])` (create_proposal_run,
 *     only when `evidence.output` is Python-truthy — a `pyTruthy` guard,
 *     not `.get` itself, handles the "falsy-but-present" half).
 *   - `service_hyperparameters.get("parameter_set_version",
 *     service_pkg.version)` (`_freeze_setup_snapshot`).
 *   - `content_default_hyperparameters.get("parameter_set_version",
 *     content_pkg.version)` (`_freeze_setup_snapshot`).
 * -> THREE genuine two-arg `.get(key, default)` sites, ALL mirrored with
 * the local `pyGetDefault` helper below (never `??`/`||`).
 *   - `dumped.get(field_name) or {}` (`world.project()`'s own
 *     `_dump_optional_genre_field` helper): a ONE-ARG `.get(field_name)`
 *     (no default parameter) combined with a Python TRUTHINESS `or` — a
 *     DIFFERENT idiom from `.get(key,default)` (the `is None` check already
 *     ran first, so `.get` itself never substitutes anything here) —
 *     mirrored with `?? {}` (see `projectWorld` below), matching
 *     `context.ts`'s own documented distinction between the two idioms.
 *
 * ── Hazard pass (all eight, per Step 4) ─────────────────────────────────────
 * - Hazard 1 (banker's rounding): no `round()` anywhere in this file — N/A.
 * - Hazard 2 (`sorted()`/`.sort()`): none — N/A.
 * - Hazard 3 (`//`/`%` floor division): none — N/A.
 * - Hazard 4 (dict/insertion order): THREE sites, each reproduced
 *   structurally:
 *     1. `projectWorld`'s 4 group dicts (`situation`/`preference`/`history`/
 *        `additional_proposed`) — built via a single `for` loop over
 *        `getDispositions().entries` (the committed JSON array, itself in
 *        the SAME order as Python's `CONTENT_FEATURE_DISPOSITIONS` list —
 *        confirmed by direct comparison, see task-3-report.md), assigning
 *        one key per iteration into whichever group the entry's `category`
 *        maps to — matches Python's single `for entry in
 *        CONTENT_FEATURE_DISPOSITIONS` loop exactly, including the
 *        interleaving of insertion order ACROSS entries that share a group
 *        (e.g. `preference`'s keys land in registry order, not any
 *        alphabetical/other order).
 *     2. `projectWorld`'s `feature_snapshot` TOP-level key order:
 *        `situation, preference, history, additional_proposed` (object
 *        literal, matching Python's dict literal), THEN
 *        `_genre_extension_enabled` (assigned after the loop, matching
 *        Python), THEN `genre_affinity_v1` (assigned last, only when the
 *        extension is on) — reproduced by assigning in that exact sequence,
 *        not by combining into one literal.
 *     3. `featureProvenance` — built in the SAME loop as (1), so its key
 *        order is the SAME registry order.
 *   Everything else in this file (`parameters`/`hyperparameters` resolution,
 *   `events` array, `excludedCandidatesCtx`) is either a fixed-shape object
 *   literal (no dict/set iteration) or an array built by mapping over an
 *   already-ordered array/list (`eligibilityResult.excluded`,
 *   `content_pkg.hyperparameters`) — no additional hazard-4 sites.
 * - Hazard 5 (bare `str(float)`): no float value is ever formatted into a
 *   string anywhere in this file — every value this file reads
 *   (drowsiness_level, enthusiasm, ...) is passed through opaquely inside
 *   `world`/`worldSnapshot`/`context`, never interpolated into an error
 *   message or otherwise stringified here — N/A.
 * - Hazard 6 (`neumaierSum`): no `sum()` over floats — N/A.
 * - Hazard 7 (`pyFixed`/`:.Nf`): no format-spec float formatting — N/A.
 * - Hazard 8 (`isinstance(x, (int, float))` accepting `bool`): ZERO
 *   `isinstance` calls in `create_proposal_run`/`_freeze_setup_snapshot`/
 *   `World.project()`/`_dump_optional_genre_field` (all four bodies read in
 *   full, not grepped) — N/A, no site to audit for this file.
 *
 * ── Error-shape mirroring (brief: "say how") ────────────────────────────────
 *
 * Every `raise HTTPException(422, detail=...)` site in this file's Python
 * scope becomes `throw new ProposalHttpError(422, detail)` below —a single,
 * small `Error` subclass carrying BOTH the intended HTTP status and the
 * exact Python `detail` payload (a bare string for `create_proposal_run`'s
 * own direct raises; the `[{path, code, message}, ...]` validation-issue
 * array shape for `_freeze_setup_snapshot`'s two structured raises, and for
 * the `ProposalOpportunity`-construction failure, whose Python
 * `ValidationError` this mirrors with a clean single-line message rather
 * than pydantic's multi-line dump — same documented precedent as
 * `matrix.ts`'s `MatrixValidationError`/`world_validation.ts`'s issue
 * shape: "not a byte-exact reproduction of pydantic's formatted error
 * block", since nothing in this port's call sites depends on that
 * formatting). A later HTTP-handler-equivalent layer can therefore map
 * `.status`/`.detail` faithfully instead of re-parsing `.message`. This is a
 * NEW convention for this port (no earlier task's file raised a
 * structured-detail HTTPException from a pure function) rather than reusing
 * `world_overrides.ts#InvalidOverrideError`'s `.issues`-only shape, because
 * this file also needs to carry a BARE-STRING detail at other sites — one
 * class handles both shapes with one field rather than two parallel error
 * types.
 *
 * WIDENED by Task 4 (`../select_service.ts`, feature 026 C4a): that file
 * reuses this SAME `ProposalHttpError` class (rather than defining its own —
 * one error type a caller can `instanceof`-check regardless of which
 * orchestrator function raised it) for `select_service`'s
 * `{code: "service_not_eligible", message, reason_codes}` structured detail
 * (routers/proposal.py:1366-1376) — a THIRD detail shape, neither the bare
 * string nor the `{path,code,message}[]` validation-issue array this file's
 * own raises ever produce. `ProposalHttpDetail`/the constructor's
 * `super(...)` message-derivation below were widened to accommodate it
 * rather than Task 4 forking a parallel error class — see `select_service.ts`'s
 * own module doc for why this was judged the right seam shape, not a forced fit.
 *
 * WIDENED AGAIN by Task 5 (`../recompute.ts`, feature 026 C4a): `recompute_
 * proposal_run`'s `{code: "recompute_requires_idle_playback", message}`
 * structured detail (routers/proposal.py:1533-1543) — a FOURTH shape (no
 * `reason_codes`, so NOT `ServiceNotEligibleDetail` reused loosely — a
 * distinct `RecomputeRequiresIdlePlaybackDetail` member). Same reasoning as
 * Task 4's own widening: one shared error type, one shared union, rather
 * than a third parallel error class for what is structurally the same
 * "status + Python detail payload" carrier.
 *
 * WIDENED A THIRD TIME by Task 6 (`../journey_action.ts`, feature 026 C4a):
 * `apply_journey_action`'s `{"code": transition.rejected.code, "message":
 * transition.rejected.message}` structured detail (routers/proposal.py:
 * 1888-1895) — a FIFTH member, `JourneyActionRejectedDetail`. Unlike the
 * other four, this one is a straight TYPE ALIAS of `../journey.ts`'s own
 * `TransitionRejection` (not a fresh literal): the router's `detail=` dict
 * is built by unpacking `transition.rejected.code`/`.message` verbatim, so
 * the two shapes are the SAME two fields by construction, not a
 * coincidental match — aliasing keeps them from drifting apart if
 * `TransitionRejection` ever gains/loses a field. `code` here is a dynamic
 * string (`'invalid_precondition'` / `'invalid_payload'` /
 * `'no_eligible_candidate'` / `'capabilities_unavailable'`, minted by
 * `journey.ts`'s own handlers), NOT a fixed literal like
 * `RecomputeRequiresIdlePlaybackDetail`'s single value — so it cannot reuse
 * that member.
 */
import { resolveRunSetup, getMatrix, getServiceCapabilities, makeOpportunityId, type RunSetupBody } from './context_base'
import { resolveMatrix, MatrixResolutionError, type TriggerPurpose } from '../matrix'
import type { LifecycleStage, TransitionRejection } from '../journey'
import { resolveEligibility, deriveRegisteredEntities, type ServiceId, type MotionState } from '../eligibility'
import { buildServiceContext, type PackageManifestLike } from './context'
import { dispatchSelector, type AlgorithmEvidence } from '../selector'
import { mergeAlgorithmConfig } from '../algorithm_config'
import { validateWorld, type SongDoc, type ValidationIssue } from '../world_validation'
import { proposalPackageRegistry, datasetCatalogRegistry } from '../stores'
import { pyReprQuoteOne } from '../py_repr'
import { getDispositions } from '../../../data/registry'
import {
  createRun as runManagerCreateRun,
  type ProposalRunLog,
  type ProposalOpportunity,
  type DiscreteEvent,
  type JourneyState as OpaqueJourneyState,
  type ProposalRunCache,
  type ProposalRunStatus,
} from '../run_manager'

// ---------------------------------------------------------------------------
// Small Python-mirroring local helpers (per-module-copy convention already
// established throughout this port — see context.ts's own module doc for
// why each module keeps its own copy rather than importing one).
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

/** Mirrors `copy.deepcopy`/`dict(x)` for the plain JSON-shaped values this
 * file handles — local copy, not shared/exported (established convention). */
function shallowCopyRecord(value: Record<string, unknown>): Record<string, unknown> {
  return { ...value }
}

// ---------------------------------------------------------------------------
// ProposalHttpError — see module doc's "Error-shape mirroring" section.
// ---------------------------------------------------------------------------

/** The `select_service`-only structured detail (routers/proposal.py:1368-1375)
 * — see the module doc's "WIDENED by Task 4" note. */
export type ServiceNotEligibleDetail = {
  code: 'service_not_eligible'
  message: string
  reason_codes: string[]
}

/** The `recompute_proposal_run`-only structured detail (routers/proposal.py:
 * 1533-1543) — see `recompute.ts`'s own module doc ("WIDENED by Task 5",
 * mirroring the SAME "widen the one shared union" pattern Task 4 already
 * established for `ServiceNotEligibleDetail` rather than forking a second
 * parallel error class). No `reason_codes` field — a genuinely different
 * shape from `ServiceNotEligibleDetail`, not a copy of it. */
export type RecomputeRequiresIdlePlaybackDetail = {
  code: 'recompute_requires_idle_playback'
  message: string
}

/** The `apply_journey_action`-only structured detail (routers/proposal.py:
 * 1888-1895) — see the module doc's "WIDENED A THIRD TIME" note. A straight
 * alias of `../journey.ts#TransitionRejection`, not an independent literal. */
export type JourneyActionRejectedDetail = TransitionRejection

export type ProposalHttpDetail =
  | string
  | Array<{ path: string; code: string; message: string }>
  | ServiceNotEligibleDetail
  | RecomputeRequiresIdlePlaybackDetail
  | JourneyActionRejectedDetail

/** Mirrors a FastAPI `HTTPException` this file's Python source raises
 * DIRECTLY (never a caught+rethrown domain error) — carries both `status`
 * and the exact Python `detail` payload shape. See module doc (widened by
 * Task 4 to also carry `ServiceNotEligibleDetail`). */
export class ProposalHttpError extends Error {
  readonly status: number
  readonly detail: ProposalHttpDetail
  constructor(status: number, detail: ProposalHttpDetail) {
    super(
      typeof detail === 'string'
        ? detail
        : Array.isArray(detail)
          ? detail.map((d) => d.message).join('; ')
          : detail.message,
    )
    this.name = 'ProposalHttpError'
    this.status = status
    this.detail = detail
  }
}

// ---------------------------------------------------------------------------
// World.project() -> projectWorld — SCOPE FINDING, see module doc.
// Mirrors `models/proposal/world.py:465-541` (`World.project` +
// `_dump_optional_genre_field`).
// ---------------------------------------------------------------------------

export type FeatureProvenanceEntry = { feature_origin: string; source_reference: string }

/** Mirrors `_CATEGORY_TO_GROUP` (world.py:457-462) — the disposition
 * registry's `category` string to `feature_snapshot` group-key mapping. */
const CATEGORY_TO_GROUP: Record<string, string> = {
  Situation: 'situation',
  Preference: 'preference',
  History: 'history',
  'Additional proposed': 'additional_proposed',
}

type DispositionEntry = {
  feature_id: string
  category: string
  feature_origin: string
  source_reference: string
  [k: string]: unknown
}

/**
 * Deterministic World -> feature_snapshot/feature_provenance bridge.
 * Mirrors `World.project()` (world.py:497-541) exactly — see module doc's
 * "SCOPE FINDING" section for why this exists in this file, and its hazard-4
 * item for the exact ordering this reproduces.
 *
 * Reads `world.situation`/`world.driver_profile` directly, with NO
 * completeness re-validation of its own — mirrors Python's own `project()`,
 * which has zero defensive code and would raise `KeyError` on an incomplete
 * World; `_freeze_setup_snapshot` always calls `validateWorld` immediately
 * before this, exactly like Python calls `validate_world` immediately before
 * `world.project()`. A `flat[featureId]` miss here silently yields
 * `undefined` rather than Python's `KeyError` — a narrow, PRE-EXISTING class
 * of divergence (not introduced by this function): `world_validation.ts`'s
 * own module doc already extensively discloses that its coverage is
 * deliberately scoped to `scored`+selector-read fields, not every
 * `context_only` field this registry also walks, for the documented
 * false-positive-avoidance reason. Both this port's `applyOverrides`/
 * `validateWorld` and this function share the SAME "treat `world` as
 * already-complete" posture the whole `engine/proposal/world_*` port
 * establishes.
 */
export function projectWorld(world: Record<string, unknown>): {
  featureSnapshot: Record<string, unknown>
  featureProvenance: Record<string, FeatureProvenanceEntry>
} {
  const situation = (world.situation ?? {}) as Record<string, unknown>
  const driverProfile = (world.driver_profile ?? {}) as Record<string, unknown>

  // flat = {**situation_values, **profile_values} — profile_values excludes
  // the 3 genre-extension-only fields (never disposition-registry members;
  // verified no Situation/DriverProfile field names collide, so spread order
  // has no observable effect either way — see task-3-report.md).
  const {
    genre_affinity_v1_enabled: _genreEnabled,
    usage_by_genre: _usageByGenre,
    scene_genre_usage: _sceneGenreUsage,
    ...profileRest
  } = driverProfile
  const flat: Record<string, unknown> = { ...situation, ...profileRest }

  const featureSnapshot: Record<string, unknown> = {
    situation: {},
    preference: {},
    history: {},
    additional_proposed: {},
  }
  const featureProvenance: Record<string, FeatureProvenanceEntry> = {}

  const dispositions = getDispositions() as { entries: DispositionEntry[] }
  for (const entry of dispositions.entries) {
    const group = CATEGORY_TO_GROUP[entry.category]
    ;(featureSnapshot[group] as Record<string, unknown>)[entry.feature_id] = flat[entry.feature_id]
    featureProvenance[entry.feature_id] = {
      feature_origin: entry.feature_origin,
      source_reference: entry.source_reference,
    }
  }

  const genreOn = Boolean(driverProfile.genre_affinity_v1_enabled)
  featureSnapshot._genre_extension_enabled = genreOn
  if (genreOn) {
    // Mirrors `_dump_optional_genre_field`: `is None -> {}`, else the
    // dumped value itself — `??` is the correct mirror here (NOT a
    // `.get(key,default)` hazard site; see module doc's audit).
    featureSnapshot.genre_affinity_v1 = {
      usage_by_genre: driverProfile.usage_by_genre ?? {},
      scene_genre_usage: driverProfile.scene_genre_usage ?? {},
    }
  }

  return { featureSnapshot, featureProvenance }
}

// ---------------------------------------------------------------------------
// _freeze_setup_snapshot -> freezeSetupSnapshot (routers/proposal.py:738-814)
// ---------------------------------------------------------------------------

export type SetupSnapshotOrigin = {
  seed_id: string | null
  clone_id: string | null
  profile_id: string | null
  origin_preset_id: string | null
}

export type SetupSnapshot = {
  origin: SetupSnapshotOrigin
  matrix_version: string
  dataset_id: string
  dataset_hash: string
  service_package_id: string
  service_contract_version: string
  content_package_id: string | null
  content_contract_version: string | null
  service_parameter_set_version: string
  content_parameter_set_version: string | null
  feature_provenance: Record<string, FeatureProvenanceEntry>
}

export type FreezeSetupSnapshotArgs = {
  world: Record<string, unknown>
  matrixVersion: string
  servicePkg: PackageManifestLike
  contentPkg: PackageManifestLike
  serviceHyperparameters: Record<string, unknown>
  originSeedId?: string | null
  originCloneId?: string | null
  originProfileId?: string | null
  originPresetId?: string | null
}

/**
 * Validate the typed world and build `(worldSnapshot, setupSnapshot)`.
 * Mirrors `_freeze_setup_snapshot` (routers/proposal.py:738-814) exactly.
 *
 * @throws ProposalHttpError(422) — unknown `dataset_id`
 *   (`code: 'unknown_dataset'`), or the world fails `validateWorld`
 *   (`detail` = the raw `ValidationIssue[]`) — never a fabricated snapshot
 *   for an invalid world.
 */
export function freezeSetupSnapshot(args: FreezeSetupSnapshotArgs): {
  worldSnapshot: Record<string, unknown>
  setupSnapshot: SetupSnapshot
} {
  const controlInputs = (args.world.control_inputs ?? {}) as Record<string, unknown>
  const datasetId = controlInputs.dataset_id as string

  const catalog = datasetCatalogRegistry.getCatalog(datasetId)
  if (catalog === null) {
    throw new ProposalHttpError(422, [
      {
        path: 'control_inputs.dataset_id',
        code: 'unknown_dataset',
        message: `Unknown dataset_id: ${pyReprQuoteOne(datasetId)}`,
      },
    ])
  }

  const issues: ValidationIssue[] = validateWorld(args.world, catalog as SongDoc[])
  if (issues.length > 0) {
    throw new ProposalHttpError(422, issues)
  }

  const { featureSnapshot, featureProvenance } = projectWorld(args.world)
  const catalogRef = (args.world.catalog_ref ?? {}) as Record<string, unknown>
  const worldSnapshot: Record<string, unknown> = {
    feature_snapshot: featureSnapshot,
    feature_provenance: featureProvenance,
    catalog_version: catalogRef.dataset_hash,
  }

  const provenance = datasetCatalogRegistry.getProvenance(datasetId)
  if (provenance === null) {
    // Mirrors Python's `assert dataset_provenance is not None` — an
    // invariant, not a user-facing HTTPException (a resolved catalog above
    // always has provenance; see datasetCatalogRegistry's own module doc).
    throw new Error(
      `freezeSetupSnapshot: invariant violated — catalog resolved for dataset_id=${datasetId} but provenance is missing`,
    )
  }

  const contentDefaultHyperparameters: Record<string, unknown> = {}
  for (const hp of (args.contentPkg.hyperparameters as Array<{ key: string; default: unknown }> | undefined) ?? []) {
    contentDefaultHyperparameters[hp.key] = hp.default
  }

  const setupSnapshot: SetupSnapshot = {
    origin: {
      seed_id: args.originSeedId ?? null,
      clone_id: args.originCloneId ?? null,
      profile_id: args.originProfileId ?? null,
      origin_preset_id: args.originPresetId ?? null,
    },
    matrix_version: args.matrixVersion,
    dataset_id: datasetId,
    dataset_hash: provenance.dataset_hash,
    service_package_id: args.servicePkg.id as string,
    service_contract_version: args.servicePkg.contract_version,
    content_package_id: args.contentPkg.id as string,
    content_contract_version: args.contentPkg.contract_version,
    // Hazard: dict.get(key, default) — see module doc's audit items 2/3.
    service_parameter_set_version: pyGetDefault(
      args.serviceHyperparameters,
      'parameter_set_version',
      args.servicePkg.version,
    ) as string,
    content_parameter_set_version: pyGetDefault(
      contentDefaultHyperparameters,
      'parameter_set_version',
      args.contentPkg.version,
    ) as string,
    feature_provenance: featureProvenance,
  }

  return { worldSnapshot, setupSnapshot }
}

// ---------------------------------------------------------------------------
// ProposalOpportunity construction — mirrors the 3 validators on
// `models/proposal/opportunity.py::ProposalOpportunity` that
// `create_proposal_run`'s own `try: ProposalOpportunity(...) except
// ValidationError` can reach.
// ---------------------------------------------------------------------------

// Local module copy — same duplication convention `matrix.ts`/
// `world_validation.ts` already document/follow for this exact rule
// (Python itself duplicates this frozenset independently in world.py,
// opportunity.py, AND matrix.py).
const REST_STAGES: ReadonlySet<LifecycleStage> = new Set([
  'before_rest_until_stop',
  'during_rest_stopped',
  'after_rest_before_restart',
])
const ACTIVE_DRIVING_PURPOSES: readonly TriggerPurpose[] = [
  'inattentive_driving_prevention_recovery',
  'route_music',
  'child_passenger_experience',
]

function pyListRepr(values: readonly string[]): string {
  return `[${values.map((v) => `'${v}'`).join(', ')}]`
}

export type BuildProposalOpportunityArgs = {
  opportunityId: string
  triggerPurpose: TriggerPurpose
  lifecycleStage: LifecycleStage
  allowedServiceIds: ServiceId[]
  simulationTime: string | number
  runSeed: string
}

/**
 * Mirrors `ProposalOpportunity(...)` construction at `create_proposal_run`'s
 * own call site (routers/proposal.py:854-864), including all 3 of the
 * model's validators. Only the `allowed_service_ids` non-empty check is
 * reachable via `createProposalRun`'s own call site (an empty
 * `during_rest_stopped` row) — `opportunity_id` is always non-empty
 * (minted by `makeOpportunityId`), and purpose/stage compatibility is
 * already guaranteed by `resolveMatrix` succeeding first (a matrix row only
 * exists for a compatible pair). Ported in full anyway, matching this
 * port's established "validate the whole model, not just the reachable
 * subset" precedent (`matrix.ts`) — a future caller of this exported
 * function directly (e.g. a test, or a later recompute-style caller) is not
 * guaranteed the same reachability guarantees `createProposalRun` provides
 * itself.
 *
 * @throws ProposalHttpError(422) — mirrors `HTTPException(422,
 *   detail=str(exc))` for a caught `pydantic.ValidationError`. The message
 *   is a clean single line (this validator's own text), NOT pydantic's
 *   multi-line `str(ValidationError)` dump — same documented precedent as
 *   `matrix.ts`'s `MatrixValidationError`.
 */
export function buildProposalOpportunity(args: BuildProposalOpportunityArgs): ProposalOpportunity {
  if (!args.opportunityId) {
    throw new ProposalHttpError(422, 'opportunity_id must not be empty.')
  }
  if (args.allowedServiceIds.length === 0) {
    throw new ProposalHttpError(
      422,
      'allowed_service_ids must not be empty; supply at least one ServiceId.',
    )
  }
  if (REST_STAGES.has(args.lifecycleStage) && args.triggerPurpose !== 'rest_recommended') {
    throw new ProposalHttpError(
      422,
      `Lifecycle stage '${args.lifecycleStage}' is only compatible with trigger_purpose 'rest_recommended', but got '${args.triggerPurpose}'.`,
    )
  }
  if (args.lifecycleStage === 'active_driving_content' && !ACTIVE_DRIVING_PURPOSES.includes(args.triggerPurpose)) {
    throw new ProposalHttpError(
      422,
      `Lifecycle stage 'active_driving_content' is only compatible with purposes ${pyListRepr(ACTIVE_DRIVING_PURPOSES)}, but got '${args.triggerPurpose}'.`,
    )
  }
  return {
    opportunity_id: args.opportunityId,
    trigger_purpose: args.triggerPurpose,
    lifecycle_stage: args.lifecycleStage,
    allowed_service_ids: [...args.allowedServiceIds],
    simulation_time: args.simulationTime,
    run_seed: args.runSeed,
  }
}

// ---------------------------------------------------------------------------
// createProposalRun (routers/proposal.py:818-1091)
// ---------------------------------------------------------------------------

/** Mirrors `CreateProposalRunBody` (routers/proposal.py:658-706) — the SAME
 * widened type `context_base.ts#resolveRunSetup` reads a subset of. See
 * that module's own doc for why this is one type, not two. */
export type CreateProposalRunBody = RunSetupBody

/**
 * Task 4 seam — see module doc's "OUT OF SCOPE" section. Mirrors
 * `_apply_quick_check_content`'s exact call signature
 * (routers/proposal.py:1082-1089): `(run_id, run_log, selected_service_id,
 * content_parameters, content_hyperparameters, *, cache)`.
 */
export type ApplyQuickCheckContentFn = (
  runId: string,
  runLog: ProposalRunLog,
  selectedServiceId: ServiceId,
  contentParameters: Record<string, unknown>,
  contentHyperparameters: Record<string, unknown>,
  options: { cache?: ProposalRunCache },
) => Promise<ProposalRunLog>

export type CreateProposalRunOptions = {
  /** Feature 020 (Slice-2c) seam — forwarded VERBATIM to every
   * `runManager` call below, exactly like Python forwards its own `cache`
   * kwarg. Supplied (even an empty `Map`, mirroring Python's `cache={}`):
   * the run is built entirely in memory, `proposalRunsStore` is NEVER
   * touched. Omitted: behavior is exactly as before this feature — every
   * write persists through `proposalRunsStore`. */
  cache?: ProposalRunCache
  /** See module doc's "OUT OF SCOPE" section. Required whenever
   * `quick_check` mode actually selects a service; throws a named error if
   * that branch is reached without it. */
  applyQuickCheckContent?: ApplyQuickCheckContentFn
}

function makeJourneyState(
  lifecycleStage: LifecycleStage,
  motionState: MotionState,
  activeServiceId: ServiceId | null,
): OpaqueJourneyState {
  // Mirrors JourneyState(...)'s pydantic-materialized P4 defaults
  // (models/proposal/journey.py:47-50) — Python's constructor fills these
  // in even though create_proposal_run's own call site never sets them
  // explicitly; run_manager.ts#createRun does NOT add these defaults
  // itself (it treats journeyState as an opaque pass-through), so the
  // CALLER (this function) must supply the full materialized shape.
  return {
    lifecycle_stage: lifecycleStage,
    motion_state: motionState,
    active_service_id: activeServiceId,
    active_plan_id: null,
    playback_state: 'idle',
    current_plan_ref: null,
    previous_content: null,
    rejected_service_ids: [],
  }
}

function makeEvent(eventType: string, at: string | number, payload: Record<string, unknown>): DiscreteEvent {
  return { event_type: eventType, at, payload }
}

/**
 * Port of `create_proposal_run` (routers/proposal.py:818-1091). See module
 * doc for the full control-flow enumeration, the `_apply_quick_check_content`
 * seam, the `World.project()` scope finding, and the hazard pass.
 *
 * @throws ProposalHttpError(422) at every point Python raises
 *   `HTTPException(422, ...)` directly (unknown/mis-slotted package ids,
 *   neither `world` nor `world_snapshot` supplied, an incompatible/
 *   unrepresented matrix pair, an empty resolved `allowed_service_ids`, an
 *   unknown dataset, or a structurally invalid world).
 * @throws Error if `quick_check` mode selects a service but
 *   `options.applyQuickCheckContent` was not supplied (see module doc).
 */
export async function createProposalRun(
  body: CreateProposalRunBody,
  options?: CreateProposalRunOptions,
): Promise<ProposalRunLog> {
  const cache = options?.cache

  const servicePkg = proposalPackageRegistry.get(body.service_package_id) as PackageManifestLike | null
  if (servicePkg === null || servicePkg.family !== 'service_selector') {
    throw new ProposalHttpError(
      422,
      `Unknown or mis-slotted service_package_id: ${pyReprQuoteOne(body.service_package_id)}`,
    )
  }

  const contentPkg = proposalPackageRegistry.get(body.content_package_id) as PackageManifestLike | null
  if (contentPkg === null || contentPkg.family !== 'content_selector') {
    throw new ProposalHttpError(
      422,
      `Unknown or mis-slotted content_package_id: ${pyReprQuoteOne(body.content_package_id)}`,
    )
  }

  const bodyWorldSnapshot = body.world_snapshot ?? {}
  if (body.world == null && !pyTruthy(bodyWorldSnapshot)) {
    throw new ProposalHttpError(
      422,
      "Request must include either a typed 'world' or a non-empty 'world_snapshot'.",
    )
  }

  const { triggerPurpose, lifecycleStage, motionState } = resolveRunSetup(body)

  const matrix = getMatrix()
  let allowedServiceIds: ServiceId[]
  try {
    allowedServiceIds = resolveMatrix(matrix, triggerPurpose, lifecycleStage)
  } catch (exc) {
    if (exc instanceof MatrixResolutionError) {
      throw new ProposalHttpError(422, exc.message)
    }
    throw exc
  }

  const opportunityId = makeOpportunityId()
  const opportunity = buildProposalOpportunity({
    opportunityId,
    triggerPurpose,
    lifecycleStage,
    allowedServiceIds,
    simulationTime: body.simulation_time,
    runSeed: body.run_seed,
  })

  let parameters: Record<string, unknown> = pyTruthy(body.parameters)
    ? (body.parameters as Record<string, unknown>)
    : shallowCopyRecord((servicePkg.parameters as Record<string, unknown> | undefined) ?? {})

  let hyperparameters: Record<string, unknown>
  if (pyTruthy(body.hyperparameters)) {
    hyperparameters = body.hyperparameters as Record<string, unknown>
  } else {
    hyperparameters = {}
    for (const hp of (servicePkg.hyperparameters as Array<{ key: string; default: unknown }> | undefined) ?? []) {
      hyperparameters[hp.key] = hp.default
    }
  }

  if (body.algorithm_config_overrides != null) {
    hyperparameters = mergeAlgorithmConfig(hyperparameters, body.algorithm_config_overrides.service ?? null)
  }

  let setupSnapshot: SetupSnapshot | null = null
  let worldSnapshot: Record<string, unknown> = bodyWorldSnapshot
  if (body.world != null) {
    const frozen = freezeSetupSnapshot({
      world: body.world as Record<string, unknown>,
      matrixVersion: matrix.matrix_version,
      servicePkg,
      contentPkg,
      serviceHyperparameters: hyperparameters,
      originSeedId: body.origin_seed_id,
      originCloneId: body.origin_clone_id,
      originProfileId: body.origin_profile_id,
      originPresetId: body.origin_preset_id,
    })
    worldSnapshot = frozen.worldSnapshot
    setupSnapshot = frozen.setupSnapshot
  }

  // ---------------------------------------------------------------------
  // US1 (P4) — eligibility narrows the allowed row BEFORE ranking.
  // ---------------------------------------------------------------------
  const capabilities = getServiceCapabilities()
  const registeredEntities = deriveRegisteredEntities(worldSnapshot)
  const eligibilityResult = resolveEligibility(allowedServiceIds, motionState, capabilities, {
    registeredEntities,
  })
  const excludedCandidatesCtx = eligibilityResult.excluded.map((excl) => ({
    candidate_id: excl.service_id,
    platform_reason: excl.reason_codes.join(','),
  }))

  const at = opportunity.simulation_time
  const events: DiscreteEvent[] = [
    makeEvent('OPPORTUNITY_OPENED', at, {
      opportunity_id: opportunityId,
      trigger_purpose: triggerPurpose,
      lifecycle_stage: lifecycleStage,
    }),
  ]

  if (eligibilityResult.eligible.length === 0) {
    // T017a — every allowed service was excluded. Never dispatch a
    // selector; no evaluate() call happened, so no AlgorithmEvidence is
    // fabricated to pretend one did (Constitution Principle V).
    events.push(
      makeEvent('NO_ELIGIBLE_CANDIDATE', at, {
        excluded: eligibilityResult.excluded.map((excl) => ({
          service_id: excl.service_id,
          reason_codes: excl.reason_codes,
        })),
      }),
    )
    const journeyState = makeJourneyState(lifecycleStage, motionState, null)
    return await runManagerCreateRun({
      opportunity,
      matrixVersion: matrix.matrix_version,
      worldSnapshot,
      servicePackageId: body.service_package_id,
      contentPackageId: body.content_package_id,
      parameters,
      hyperparameters,
      journeyState,
      events,
      evidence: [],
      status: 'service_selected',
      setupSnapshot,
      world: (body.world as Record<string, unknown> | null | undefined) ?? null,
      mode: body.mode,
      cache,
    })
  }

  const context = buildServiceContext({
    package: servicePkg,
    opportunity,
    worldSnapshot,
    enabledFeatureExtensions: body.enabled_feature_extensions ?? [],
    parameters,
    hyperparameters,
    eligibleServiceIds: eligibilityResult.eligible,
    excludedCandidates: excludedCandidatesCtx,
  })

  const evidence: AlgorithmEvidence = dispatchSelector(servicePkg, context, {
    matrixVersion: matrix.matrix_version,
    usedFeatureIds: Object.keys(context.feature_snapshot as Record<string, unknown>),
    allowedServiceIds: eligibilityResult.eligible,
  })

  let selectedServiceId: ServiceId | null = null
  let status: ProposalRunStatus
  if (evidence.error !== null) {
    status = 'error'
    events.push(
      makeEvent('ALGORITHM_ERROR', at, {
        step: 'service',
        category: evidence.error.category,
        message: evidence.error.message,
      }),
    )
  } else {
    // Hazard: dict.get(key, default) — see module doc's audit item 1
    // (guarded by pyTruthy, matching Python's `if evidence.output else []`).
    const rankedCandidates = pyTruthy(evidence.output)
      ? (pyGetDefault(evidence.output as Record<string, unknown>, 'ranked_candidates', []) as Array<{
          candidate_id: string
        }>)
      : []
    // Python's `if ranked_candidates:` (proposal.py:1016) is a TRUTHINESS check,
    // not a length check — and it is a second, distinct guard from the `.get()`
    // above. `pyGetDefault` substitutes its default only when the key is ABSENT,
    // so a key present with an explicit `null` returns `null`, on which
    // `.length` throws where Python simply takes the false branch. Mirrored with
    // `pyTruthy` to match, and to stay consistent with `recompute.ts:642`, which
    // ports the identical Python idiom at proposal.py:1743 — two sibling modules
    // mirroring one idiom two ways is how drift starts.
    if (pyTruthy(rankedCandidates)) {
      const rankedIds = rankedCandidates.map((c) => c.candidate_id)
      if (
        body.mode === 'quick_check' &&
        body.quick_check_service_id != null &&
        rankedIds.includes(body.quick_check_service_id)
      ) {
        selectedServiceId = body.quick_check_service_id as ServiceId
      } else {
        selectedServiceId = rankedCandidates[0].candidate_id as ServiceId
      }
      events.push(
        makeEvent('SERVICE_SELECTED', at, {
          selected_service_id: selectedServiceId,
          rank: rankedIds.indexOf(selectedServiceId) + 1,
        }),
      )
    }
    status = 'service_selected'
  }

  const journeyState = makeJourneyState(lifecycleStage, motionState, selectedServiceId)

  let runLog = await runManagerCreateRun({
    opportunity,
    matrixVersion: matrix.matrix_version,
    worldSnapshot,
    servicePackageId: body.service_package_id,
    contentPackageId: body.content_package_id,
    parameters,
    hyperparameters,
    journeyState,
    events,
    evidence: [evidence],
    status,
    setupSnapshot,
    world: (body.world as Record<string, unknown> | null | undefined) ?? null,
    mode: body.mode,
    cache,
  })

  // US3/T024 (FR-011-FR-013): quick_check auto-dispatches content for the
  // rank-1 service in the SAME call, whenever STEP 1 actually yielded one.
  if (body.mode === 'quick_check' && selectedServiceId !== null) {
    const contentParameters = shallowCopyRecord((contentPkg.parameters as Record<string, unknown> | undefined) ?? {})
    let contentHyperparameters: Record<string, unknown> = {}
    for (const hp of (contentPkg.hyperparameters as Array<{ key: string; default: unknown }> | undefined) ?? []) {
      contentHyperparameters[hp.key] = hp.default
    }
    if (body.algorithm_config_overrides != null) {
      contentHyperparameters = mergeAlgorithmConfig(
        contentHyperparameters,
        body.algorithm_config_overrides.content ?? null,
      )
    }

    if (!options?.applyQuickCheckContent) {
      throw new Error(
        'createProposalRun: quick_check mode selected a service but no options.applyQuickCheckContent was ' +
          'supplied — mirrors _apply_quick_check_content (routers/proposal.py:1187), explicitly out of this ' +
          "port's scope (Task 4, see create_run.ts's module doc). Supply a real or fake implementation.",
      )
    }
    runLog = await options.applyQuickCheckContent(
      runLog.run_id,
      runLog,
      selectedServiceId,
      contentParameters,
      contentHyperparameters,
      { cache },
    )
  }

  return runLog
}
