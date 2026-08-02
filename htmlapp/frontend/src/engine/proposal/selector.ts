/**
 * proposal_selector dispatch — port of `services/proposal_selector.py`
 * (`dispatch_selector`, `_load_evaluate`, `_output_model_for_family`,
 * `_step_for_family`, `_error_evidence`, `_SelectorLoadError`; C2 Task 3).
 *
 * Resolves a proposal package id to its `evaluate` implementation, calls it,
 * and normalises the result into ONE of two neutral contracts depending on
 * the package's declared family — `service_selector` -> `ServiceSelectorOutput`,
 * anything else (in practice only `content_selector`) -> `CompletePlan` —
 * mirroring `_output_model_for_family`/`_step_for_family`'s own
 * "default to content for any non-service family" behavior exactly.
 *
 * INVARIANT (Constitution Principle V / FR-019-021, restated from Python's
 * own module docstring): ANY failure — an unregistered/unported package, a
 * thrown exception, a non-object return, or (service family only) a
 * ranked/excluded candidate outside the opportunity's frozen
 * `allowed_service_ids` — becomes an explicit `AlgorithmEvidence` with
 * `error = {category, message}` set and `output = null`. NEVER a fabricated
 * result. A caller distinguishes a failure from a real decision with one
 * check (`evidence.error !== null`, equivalently `evidence.output === null`
 * — the two are always set together, see `errorEvidence`/the success return
 * below).
 *
 * MECHANISM DIVERGENCE (by design — see the task brief's "one place the port
 * must NOT mirror Python's mechanism"): Python's `_load_evaluate` imports
 * `<packages_dir>/<package.id>/<entrypoint>` from the filesystem, with a
 * per-package-id module cache. htmlapp has no filesystem: the two ported
 * selector algorithms are registered ahead of time in `BUILTIN_EVALUATORS`
 * (`../../data/builtinEvaluators.ts`), keyed by package id — `loadEvaluate`
 * below mirrors `_load_evaluate`'s BEHAVIOR (resolve-or-fail with a single
 * `missing_evaluate` category) against that seam instead of a filesystem.
 * `UNPORTED_BUILTINS` (same file) still lists `mock_service_selector_v1` /
 * `mock_content_selector_v1` — real, dispatchable Python packages with no TS
 * port yet — so asking for one of those resolves exactly like a genuinely
 * unknown package id: `missing_evaluate`, `output: null`, `error` set, never
 * a crash, never a silently-empty result. The message text distinguishes the
 * two underlying causes for a developer reading the evidence, the same way
 * Python's own two `missing_evaluate` sub-cases (absent entrypoint file vs.
 * no callable `evaluate` attribute) differ only in message text, never in
 * category.
 *
 * TESTABILITY SEAM: `options.evaluators` (default `BUILTIN_EVALUATORS`) is
 * this port's analogue of Python's `packages_dir` parameter — the ONE seam
 * Python's own `test_proposal_selector.py` uses to substitute fake
 * `algorithm.py` modules (written to `tmp_path`) for the exception /
 * invalid-shape / candidate-outside-allowed-set branches that the two REAL
 * ported evaluators can never hit through their own logic (both are
 * statically typed to always return a well-shaped object or throw — see the
 * task report's branch-coverage table). Production call sites never pass it.
 *
 * ISOLATION (mirrors the Python module's own isolation note, and
 * `eligibility.ts`'s convention): this module defines its own small
 * `AlgorithmEvidence`/`EvidenceError` types rather than importing a
 * trigger-side type — the proposal domain's evidence contract is a separate
 * vocabulary in Python (`aica_api.models.proposal.evidence`), isolated from
 * the trigger package's `DecisionResult`/`AlgorithmError`.
 *
 * KNOWN UPSTREAM ARTEFACT, DELIBERATELY REPLICATED (C2 Task 3 fix round 1 —
 * owner-reviewed): a successful SERVICE-family result is passed through
 * `coerceServiceFeatureValueBooleanArtefact` below before it becomes
 * `evidence.output`, turning a real boolean `feature_value`/`raw_value`
 * into `1.0`/`0.0`. This mirrors an almost-certainly-unintended pydantic
 * union-ordering artefact in Python's own `dispatch_selector` re-validation
 * step — see that function's doc comment for the full evidence trail
 * (including a `ServiceExplainability.tsx` dead-code branch this artefact
 * causes in the real docker app). Read that comment before touching either
 * function.
 */
import { BUILTIN_EVALUATORS, UNPORTED_BUILTINS } from '../../data/builtinEvaluators'
import type { BuiltinEvaluateFn, SelectorEvaluateFn, ContentSelectorEvaluateFn } from '../../data/builtinEvaluators'

// ---------------------------------------------------------------------------
// Contract types — mirrors models/proposal/evidence.py (EvidenceError,
// AlgorithmEvidence) and the SCHEMA_VERSION constant (models/proposal/__init__.py).
// ---------------------------------------------------------------------------

/** Mirrors `aica_api.models.proposal.SCHEMA_VERSION` — stamped on every
 * AlgorithmEvidence this module produces, success or failure alike. */
export const SCHEMA_VERSION = '1.0.0'

export type EvidenceError = { category: string; message: string }

export type AlgorithmEvidence = {
  step: 'service' | 'content'
  package_id: string
  contract_version: string
  schema_version: string
  matrix_version: string
  input_snapshot: Record<string, unknown>
  output: Record<string, unknown> | null
  error: EvidenceError | null
  used_feature_ids: string[]
  unused_available_features: string[]
  missing_features: string[]
}

/** The union of evaluate() shapes `BUILTIN_EVALUATORS` can hold — same union
 * that file itself declares (re-exported here under a shorter local name
 * for readability; not a competing definition). */
export type SelectorEvaluator = BuiltinEvaluateFn | SelectorEvaluateFn | ContentSelectorEvaluateFn

// ---------------------------------------------------------------------------
// _SelectorLoadError -> SelectorLoadError
// ---------------------------------------------------------------------------

class SelectorLoadError extends Error {
  readonly category: string
  constructor(category: string, message: string) {
    super(message)
    this.name = 'SelectorLoadError'
    this.category = category
  }
}

// ---------------------------------------------------------------------------
// _load_evaluate -> loadEvaluate (BUILTIN_EVALUATORS lookup, not a
// filesystem import — see the module doc's "MECHANISM DIVERGENCE" note)
// ---------------------------------------------------------------------------

function loadEvaluate(packageId: string, evaluators: Record<string, SelectorEvaluator>): SelectorEvaluator {
  const fn = evaluators[packageId]
  if (typeof fn === 'function') return fn

  if (UNPORTED_BUILTINS.has(packageId)) {
    throw new SelectorLoadError(
      'missing_evaluate',
      `Package '${packageId}' is a recognized proposal package with no ported evaluate() in this htmlapp build (see UNPORTED_BUILTINS).`,
    )
  }
  throw new SelectorLoadError('missing_evaluate', `No evaluate() registered for package id '${packageId}'.`)
}

// ---------------------------------------------------------------------------
// _step_for_family -> stepForFamily ("default to content" for any
// non-service_selector family preserved exactly, including a garbage value)
// ---------------------------------------------------------------------------

function stepForFamily(family: string): 'service' | 'content' {
  return family === 'service_selector' ? 'service' : 'content'
}

// ---------------------------------------------------------------------------
// _error_evidence -> errorEvidence
// ---------------------------------------------------------------------------

function errorEvidence(args: {
  step: 'service' | 'content'
  packageId: string
  contractVersion: string
  matrixVersion: string
  context: Record<string, unknown>
  category: string
  message: string
  usedFeatureIds: string[]
}): AlgorithmEvidence {
  return {
    step: args.step,
    package_id: args.packageId,
    contract_version: args.contractVersion,
    schema_version: SCHEMA_VERSION,
    matrix_version: args.matrixVersion,
    input_snapshot: args.context,
    output: null,
    error: { category: args.category, message: args.message },
    used_feature_ids: args.usedFeatureIds,
    unused_available_features: [],
    missing_features: [],
  }
}

function describeType(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? (value as string[]) : []
}

// ---------------------------------------------------------------------------
// coerceServiceFeatureValueBooleanArtefact — KNOWN UPSTREAM ARTEFACT,
// DELIBERATELY REPLICATED. Read this whole comment before touching it.
// ---------------------------------------------------------------------------
//
// WHAT: Python's `dispatch_selector` re-validates a successful service-family
// return through `ServiceSelectorOutput(**raw_result)` (pydantic). That
// model's `FeatureContribution.feature_value: str | float | int` and
// `.raw_value: str | float | int | None` (`models/proposal/service_output.py`)
// have NO `bool` member in either union. The real algorithm's own
// `_scalarize()` helper (`packages/aica_transparent_service_selector_v1/
// algorithm.py`) deliberately PRESERVES a genuine Python bool for
// boolean-valued candidate features (`child_present`, `multiple_passengers`,
// `oshi_registered`) — `isinstance(v, (str, float, int))` is `True` for a
// bool (bool is an int subclass in Python), so `_scalarize(True) is True`,
// unchanged. It is ONLY pydantic's later re-validation — reached exclusively
// through `dispatch_selector`, never through a direct `evaluate()` call —
// that silently coerces that `True` into `1.0`: pydantic v2's smart-union
// LAX matching tries union members in DECLARATION order and returns the
// first successful lax conversion; `float` is declared before `int` with no
// `bool` member at all, so a bool ends up widened to `float` rather than
// preserved. Confirmed by a direct interpreter repro (C2 Task 3 report,
// "pydantic smart-union coercion" section) — nothing in the codebase or
// docs suggests this was a deliberate design choice.
//
// WHY WE REPLICATE IT ANYWAY (owner ruling, C2 Task 3 fix round 1): this
// whole program exists so a docker-generated run and an htmlapp-generated
// run can be compared as evidence of the SAME algorithm. If htmlapp emitted
// a real JS boolean here while the docker app always emits `1.0`/`0.0`, a
// future tool diffing the two would report a spurious mismatch on every
// ranked candidate's child_present/multiple_passengers/oshi_registered row
// — a divergence invisible in either app's own UI, discoverable only by
// reading source. A replicated wart that keeps the two apps' JSON
// byte-comparable beats a silent, undiscoverable divergence between them.
//
// CORROBORATING EVIDENCE this is genuinely an upstream artefact, not
// intended behavior: `app/frontend/src/components/proposal/
// ServiceExplainability.tsx`'s `fmtRaw()` has a `typeof raw === 'boolean'`
// branch (rendering a localized true/false label) that is CURRENTLY DEAD
// CODE in the real docker app — every API response that component reads
// already went through this same pydantic coercion, so `raw` can never
// actually be a boolean by the time it gets there. htmlapp's OWN evaluate()
// output (before this function runs) is arguably MORE correct than the
// reference; we mirror the reference's actual behavior anyway, not our
// opinion of what it should be — this is a bug we have been told to
// REPLICATE (for cross-app evidence comparability), not a bug we get to
// silently fix.
//
// SCOPE (do not widen): only `ranked_candidates[].feature_contributions[].
// feature_value` and `.raw_value` — the exact two fields `FeatureContribution`
// declares with this union. This is a targeted walk of the known
// `ServiceSelectorOutput` shape, never a blanket recursive transform of the
// whole output tree (an earlier draft of this port did that in a TEST-ONLY
// normalizer instead of here — see the C2 Task 3 report's fix-round-1
// section for why that was wrong: a one-directional normalizer between a
// port and its own golden is a structural weak point, and it hid a real
// production-visible divergence). Content family is untouched — CompletePlan
// has no equivalent field at all (`ContentFeatureContribution` has no
// `feature_value`/`raw_value` — see `content_output.py`).
//
// IF UPSTREAM FIXES THIS (adds `bool` to the union, reorders `int` before
// `float`, or stops re-validating success through pydantic): DELETE this
// function and its one call site in the same change, then re-run the
// capture rig (`scripts/gen/capture_all.py proposal_selector_dispatch`). A
// re-capture that suddenly shows real booleans in
// `proposal_selector_dispatch.json` is the signal upstream fixed it — not a
// signal this port broke.
function coerceServiceFeatureValueBooleanArtefact(output: Record<string, unknown>): Record<string, unknown> {
  const rankedCandidates = output.ranked_candidates
  if (!Array.isArray(rankedCandidates)) return output

  return {
    ...output,
    ranked_candidates: rankedCandidates.map((candidate) => {
      if (!candidate || typeof candidate !== 'object') return candidate
      const c = candidate as Record<string, unknown>
      const contributions = c.feature_contributions
      if (!Array.isArray(contributions)) return candidate
      return {
        ...c,
        feature_contributions: contributions.map((row) => {
          if (!row || typeof row !== 'object') return row
          const r = row as Record<string, unknown>
          const featureValueIsBool = typeof r.feature_value === 'boolean'
          const rawValueIsBool = typeof r.raw_value === 'boolean'
          if (!featureValueIsBool && !rawValueIsBool) return row
          return {
            ...r,
            ...(featureValueIsBool ? { feature_value: r.feature_value ? 1.0 : 0.0 } : {}),
            ...(rawValueIsBool ? { raw_value: r.raw_value ? 1.0 : 0.0 } : {}),
          }
        }),
      }
    }),
  }
}

// ---------------------------------------------------------------------------
// fillCompletePlanDefaults — a SECOND pydantic-re-validation artefact,
// content family this time. DISCOVERED (not introduced) by feature 026 C4a
// Task 4 while capturing `proposal_select_service.json`'s
// `legacy_world_snapshot_mock_context_dispatch` case — read this whole
// comment before touching it, same as the artefact above.
// ---------------------------------------------------------------------------
//
// WHAT: Python's `dispatch_selector` re-validates EVERY successful result
// through its family's own pydantic model (`model_cls(**raw_result)`) and
// dumps THAT model (`validated.model_dump(mode="json")`) — not the raw
// `evaluate()` dict. For content family, `CompletePlan` declares THREE
// fields with pydantic defaults `_error()` (packages/
// aica_transparent_content_selector_v1/algorithm.py:621-638, the shared
// early-return helper for every `no_proposal`/failure decision) does NOT
// set: `scored_tail: list = []`, `cut_margin: float | None = None`,
// `tail_truncated: bool = False` (models/proposal/content_output.py:
// 217-219). Every SUCCESS-path dict the real algorithm returns (same file,
// ~line 926-928) already sets all three explicitly — this gap is invisible
// whenever content dispatch succeeds normally, and was invisible to this
// port until C4a Task 4's own capture rig dispatched a REAL `_error()`-shaped
// CompletePlan (`no_proposal`/`all_candidates_excluded`, reached via
// `select_service`'s mock/legacy content-context branch over an empty
// catalog) THROUGH `dispatch_selector` for the first time — C2 Task 3's own
// `proposal_selector_dispatch.json` capture has exactly one content-family
// case, `content_family_success_redacted_snapshot`, a SUCCESS path that
// never exercises `_error()` at all.
//
// WHY FIXED HERE, NOT WORKED AROUND ELSEWHERE: `dispatchSelector` is THE
// single place this port mirrors `dispatch_selector`'s pydantic
// re-validation step (see `coerceServiceFeatureValueBooleanArtefact` above,
// the FIRST such artefact) — an orchestrator caller (e.g. `orchestrator/
// select_service.ts#dispatchContentForService`) reproducing this same fix
// locally would duplicate exactly the kind of divergence-prone logic this
// file's own module doc warns about, and would leave any OTHER future
// caller of `dispatchSelector` for content family unfixed.
//
// SCOPE (do not widen): only these 3 named fields. Every OTHER `CompletePlan`
// field is REQUIRED (no `=` default) — a real absence there would make
// Python's own `CompletePlan(**raw_result)` RAISE (`invalid_result_shape`),
// never silently default; mirroring that here would be a DIFFERENT bug (a
// missing-validation gap), not this one. `ServiceSelectorOutput` (service
// family) has NO defaulted fields at all (verified by reading the model in
// full) — this function is content-family-only by construction, matching
// the only family where this specific gap can occur.
//
// KEY ORDER (hazard 4): `_error()`'s own key order already matches
// `CompletePlan`'s field-declaration order with these 3 keys simply OMITTED
// (not reordered) — verified by direct comparison of both sources. Inserted
// back in their DECLARED position (between `excluded_items` and
// `unused_available_features`), not appended at the end, so a byte-exact
// key-order dump matches pydantic's `model_dump()` exactly.
//
// IF UPSTREAM FIXES THIS (removes the defaults, or `_error()` starts setting
// all three): DELETE this function and its one call site, then re-run
// `scripts/gen/capture_all.py proposal_selector_dispatch proposal_select_service`.
function fillCompletePlanDefaults(output: Record<string, unknown>): Record<string, unknown> {
  const hasOwn = (k: string) => Object.prototype.hasOwnProperty.call(output, k)
  if (hasOwn('scored_tail') && hasOwn('cut_margin') && hasOwn('tail_truncated')) return output

  const result: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(output)) {
    result[k] = v
    if (k === 'excluded_items') {
      if (!hasOwn('scored_tail')) result.scored_tail = []
      if (!hasOwn('cut_margin')) result.cut_margin = null
      if (!hasOwn('tail_truncated')) result.tail_truncated = false
    }
  }
  // Defensive fallback: `excluded_items` is itself a REQUIRED CompletePlan
  // field, so its absence would already have failed Python's own
  // `CompletePlan(**raw_result)` validation — this only guards against a
  // TS-side evaluate() returning a shape Python could never produce at all,
  // rather than silently dropping the 3 fields in that case.
  if (!hasOwn('scored_tail') && !('scored_tail' in result)) result.scored_tail = []
  if (!hasOwn('cut_margin') && !('cut_margin' in result)) result.cut_margin = null
  if (!hasOwn('tail_truncated') && !('tail_truncated' in result)) result.tail_truncated = false
  return result
}

// ---------------------------------------------------------------------------
// dispatch_selector -> dispatchSelector
// ---------------------------------------------------------------------------

export function dispatchSelector(
  /** Whatever `proposalPackageRegistry.get(id)` (`./stores.ts`) returns — a
   * plain manifest dict. Only `id`/`family`/`contract_version` are read,
   * same convention `stores.ts` itself uses throughout (cast fields at the
   * read site rather than requiring a compiled ProposalPackageManifest
   * model, which htmlapp does not have — see this file's port-scope note). */
  pkg: Record<string, unknown>,
  context: Record<string, unknown>,
  options: {
    matrixVersion: string
    usedFeatureIds?: string[] | null
    /** Service-family only (FR-013, SC-002): every `candidate_id` in a
     * successful ServiceSelectorOutput's `ranked_candidates` and
     * `excluded_candidates` MUST be a member of this set — a
     * platform-excluded candidate (echoed back from
     * `context.excluded_candidates`) is exempt. `null`/`undefined` skips the
     * check entirely (non-service families, or callers without the allowed
     * set yet). */
    allowedServiceIds?: string[] | null
    /** The dict recorded as the evidence's `input_snapshot`, if given;
     * `evaluate(context)` is ALWAYS called with the full, un-redacted
     * `context` regardless — this only redacts what gets PERSISTED.
     * `null`/`undefined` (the default) falls back to `context` itself. */
    evidenceInputSnapshot?: Record<string, unknown> | null
    /** Test-only override of the evaluate registry — see the module doc's
     * "TESTABILITY SEAM" note. Defaults to the real `BUILTIN_EVALUATORS`. */
    evaluators?: Record<string, SelectorEvaluator>
  },
): AlgorithmEvidence {
  const packageId = pkg.id as string
  const family = pkg.family as string
  const contractVersion = pkg.contract_version as string

  const used = [...(options.usedFeatureIds ?? [])]
  const step = stepForFamily(family)
  const persistedSnapshot = options.evidenceInputSnapshot ?? context
  const evaluators = options.evaluators ?? (BUILTIN_EVALUATORS as Record<string, SelectorEvaluator>)

  let fn: SelectorEvaluator
  try {
    fn = loadEvaluate(packageId, evaluators)
  } catch (exc) {
    if (exc instanceof SelectorLoadError) {
      return errorEvidence({
        step,
        packageId,
        contractVersion,
        matrixVersion: options.matrixVersion,
        context: persistedSnapshot,
        category: exc.category,
        message: exc.message,
        usedFeatureIds: used,
      })
    }
    throw exc
  }

  let rawResult: unknown
  try {
    rawResult = (fn as (input: Record<string, unknown>) => unknown)(context)
  } catch (exc) {
    const message = exc instanceof Error ? exc.message : String(exc)
    return errorEvidence({
      step,
      packageId,
      contractVersion,
      matrixVersion: options.matrixVersion,
      context: persistedSnapshot,
      category: 'algorithm_exception',
      message,
      usedFeatureIds: used,
    })
  }

  if (rawResult === null || typeof rawResult !== 'object' || Array.isArray(rawResult)) {
    const modelName = step === 'service' ? 'ServiceSelectorOutput' : 'CompletePlan'
    return errorEvidence({
      step,
      packageId,
      contractVersion,
      matrixVersion: options.matrixVersion,
      context: persistedSnapshot,
      category: 'invalid_result_shape',
      message: `evaluate() returned a value of type '${describeType(rawResult)}'; expected an object matching the ${modelName} shape.`,
      usedFeatureIds: used,
    })
  }

  // Mirrors the point Python's `<Model>(**raw_result)` re-validation runs —
  // BEFORE the allowed_service_ids check below reads
  // `validated.ranked_candidates` — see coerceServiceFeatureValueBooleanArtefact's
  // (service family) and fillCompletePlanDefaults's (content family) own
  // doc comments for why each exists and why each is scoped to one family.
  const validated =
    step === 'service'
      ? coerceServiceFeatureValueBooleanArtefact(rawResult as Record<string, unknown>)
      : fillCompletePlanDefaults(rawResult as Record<string, unknown>)

  if (options.allowedServiceIds != null && step === 'service') {
    const allowedSet = new Set(options.allowedServiceIds)
    const platformExcluded = new Set(
      asArray(context.excluded_candidates).map((e) =>
        e && typeof e === 'object' ? (e as Record<string, unknown>).candidate_id : e,
      ),
    )
    const rankedCandidates = asArray(validated.ranked_candidates) as Array<{ candidate_id: string }>
    const excludedCandidates = asArray(validated.excluded_candidates) as Array<{ candidate_id: string }>

    const offending: string[] = []
    for (const cand of rankedCandidates) {
      if (!allowedSet.has(cand.candidate_id)) offending.push(cand.candidate_id)
    }
    for (const excl of excludedCandidates) {
      if (!allowedSet.has(excl.candidate_id) && !platformExcluded.has(excl.candidate_id)) {
        offending.push(excl.candidate_id)
      }
    }

    if (offending.length > 0) {
      return errorEvidence({
        step,
        packageId,
        contractVersion,
        matrixVersion: options.matrixVersion,
        context: persistedSnapshot,
        category: 'candidate_outside_allowed_set',
        message:
          `evaluate() returned candidate_id(s) ${JSON.stringify(offending)} not in the opportunity's frozen ` +
          `allowed_service_ids ${JSON.stringify([...allowedSet].sort())}.`,
        usedFeatureIds: used,
      })
    }
  }

  return {
    step,
    package_id: packageId,
    contract_version: contractVersion,
    schema_version: SCHEMA_VERSION,
    matrix_version: options.matrixVersion,
    input_snapshot: persistedSnapshot,
    output: validated,
    error: null,
    used_feature_ids: used,
    unused_available_features: asStringArray(validated.unused_available_features),
    missing_features: asStringArray(validated.missing_features),
  }
}
