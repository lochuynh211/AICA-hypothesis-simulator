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

  const validated = rawResult as Record<string, unknown>

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
