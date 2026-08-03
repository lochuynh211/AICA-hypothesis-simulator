/**
 * aica_transparent_service_selector_v1 — TS port of the `python_module`
 * package `packages/aica_transparent_service_selector_v1/algorithm.py`
 * (behavior-of-record, 996 LoC; P5, `docs/master/
 * aica_transparent_service_proposal_algorithm.md`).
 *
 * PROPOSAL-family package (`package.json`: `kind`/`family` ==
 * `"service_selector"`), NOT a trigger package — `../../../engine/algorithms/
 * adapter.ts` (the trigger dispatch path, `BuiltinPyContext` ->
 * `DecisionResult`) never calls this file: `../index.ts`'s
 * `triggerFamilyManifests()` filters any manifest carrying `kind`/`family`
 * out of the trigger registry before `BUILTIN_EVALUATORS` is ever consulted
 * for it. Nothing in this codebase dispatches this package yet — the
 * proposal engine is a later slice (C2) — so `evaluate()` here is verified
 * standalone, by direct conformance against a captured golden
 * (`../../../engine/__fixtures__/parity/service_selector.json`,
 * `tests/service_selector_port.test.ts`), the same way the SS10 worked
 * example / SS11 contrast fixtures verify the Python original
 * (`app/api/tests/proposal/test_p5_service_math.py` and friends).
 *
 * Contract — deliberately NOT `BuiltinPyContext -> DecisionResult` (the
 * trigger shape): `evaluate(context: SelectorInput) -> ServiceSelectorOutput`,
 * mirroring algorithm.py's own `evaluate(context: dict) -> dict` exactly
 * (see the module doc there). `SelectorInput`/`ServiceSelectorOutput` below
 * mirror `app/api/aica_api/models/proposal/selector_input.py` /
 * `service_output.py` (Pydantic models NEITHER of which algorithm.py itself
 * imports — algorithm.py works on plain dicts throughout, direct-indexed via
 * its own `_hp`/`_param` helpers; a missing declared key is a real
 * configuration bug, not a silently-defaulted one) — those Pydantic models
 * are the wider CALLER-side contract a future C2 dispatch layer will
 * validate against; this port only needs the shape `evaluate()` itself
 * reads, so most `SelectorInput` fields below are typed optional even where
 * the real schema requires them non-null (`opportunity_id`, `run_seed`, ...
 * — evaluate() never touches them).
 *
 * `../index.ts`'s `BuiltinEvaluateFn` (`(input: BuiltinPyContext) =>
 * DecisionResult`) does not fit this shape at all — forcing this package's
 * `evaluate` into it would mean inventing a fake `signals`/`feature_groups`
 * wrapper around a dict this algorithm never uses that way. Per the task
 * brief: widen the registry's typing instead of distorting the port — see
 * `../../builtinEvaluators.ts`'s `SelectorEvaluateFn` / the widened
 * `BUILTIN_EVALUATORS` value type, and its doc comment for the one call site
 * that needed a narrowing cast as a result (`../../../engine/algorithms/
 * adapter.ts`, which only ever looks up TRIGGER-family package ids there in
 * practice — proposal-family ids are routed away before that lookup, per the
 * paragraph above — so the cast changes no runtime behavior).
 *
 * Purity: no file/network I/O, no clock, no randomness — same purity rule as
 * algorithm.py's own docstring states (and the same rule every other
 * `builtin_js_module` port here follows).
 *
 * ---------------------------------------------------------------------------
 * Divergence hazards checked against algorithm.py (996 LoC) while porting:
 * ---------------------------------------------------------------------------
 *
 * 1. Python `round()` itself: NOT called anywhere in algorithm.py (`grep -n
 *    'round('` — zero hits). But the SAME underlying round-half-to-even
 *    ("banker's rounding") algorithm ALSO governs Python's `:.Nf` format
 *    spec, and THAT is used, twice over:
 *      (a) `_build_rationale`'s `:.4f` fixed-decimal format specs
 *      (algorithm.py:708-713). `Number.prototype.toFixed` is NOT a safe
 *      substitute — confirmed via a live python3.12 stress comparison
 *      (4000 sampled/constructed doubles): `toFixed` agrees with Python's
 *      `:.4f` on every NON-tie value but disagrees at an EXACT binary tie,
 *      e.g. `(0.65625).toFixed(4) === "0.6563"` (JS rounds ties away from
 *      zero) vs Python's `f"{0.65625:.4f}"` == `"0.6562"` (rounds to the
 *      EVEN last digit). None of this port's 11 golden cases happen to
 *      produce an exact-tie contribution value (this hazard is real but
 *      NOT golden-exercised — see "branches not exercised" below), so
 *      relying on the golden alone would have let a `.toFixed(4)`
 *      implementation ship silently wrong. Ported via `mathUtils.ts`'s
 *      `pyFixed(x, 4)`, which reproduces Python's exact-binary-value tie
 *      test via BigInt rational arithmetic rather than trusting
 *      `toFixed`'s spec-mandated (away-from-zero) tie behavior.
 *      (b) `_apply_confidence_shrinkage`'s ONE bare f-string float
 *      interpolation, `f"...[confidence={conf}]"` — Python's float repr
 *      ALWAYS shows a decimal point (`str(1.0) == "1.0"`), while a naive JS
 *      template literal drops a trailing ".0" (`` `${1.0}` === "1" ``).
 *      Ported via `pyFloatRepr()` below, used ONLY at that one call site.
 *      The golden's `confidence_shrinkage_on` case deliberately includes a
 *      whole-number confidence value (`music_playlist`, confidence exactly
 *      `1.0`, PRESENT not missing) so THIS half of the hazard IS
 *      golden-exercised — every other confidence value in the fixture set
 *      has a nonzero fractional part and would format identically in both
 *      languages either way.
 *
 * 2. `sorted()` on tuples: **present, and load-bearing** — `evaluate()`'s
 *    ranking step, `scored.sort(key=lambda s: (-s["score"], s["candidate_id"]))`
 *    (algorithm.py:955), a genuine tuple-key sort (score descending, then
 *    candidate_id ascending as the tie-break). Ported as an explicit
 *    two-branch comparator passed to `.sort()` (score first, candidate_id
 *    only as the tie-break) — never a bare single-field
 *    `.sort((a, b) => b.score - a.score)`, which would leave same-score
 *    ties in whatever order they happened to land in `scored`. The golden's
 *    `tie_break_highway` case exercises the
 *    tie-break itself: `call_response_driving` and `quiz` share an IDENTICAL
 *    `service_response_profiles` row on every feature (differing only at
 *    `road_response_profiles.mountain`, never reached on this case's
 *    `road_type: "highway"`) and neither has a preference/history table
 *    entry in the snapshot, so their two scores are bit-for-bit identical —
 *    verified empirically (`0.4848812095032397` for both) — forcing the
 *    tie-break to actually decide the order (`call_response_driving` ranks
 *    above `quiz`, matching `'c' < 'q'`).
 *    `_build_rationale`'s `sorted(contributions, key=lambda c: c["contribution"],
 *    reverse=True)` is a plain single-key (non-tuple) descending sort —
 *    ported as `.slice().sort((a, b) => b.contribution - a.contribution)`,
 *    which is safe here because (a) it's a single numeric key, not a tuple,
 *    and (b) `Array.prototype.sort` has been spec-guaranteed STABLE since
 *    ES2019 (matching Python's guaranteed-stable `sorted()`), so tied
 *    contributions keep their original `FEATURE_ORDER` order in both
 *    languages. The three `sorted(some_set)` calls (`recognized`/`unknown`
 *    tag sets, `unused_available_features`, `missing_features`) sort plain
 *    string sets alphabetically — ported as `Array.from(set).sort()`
 *    (default lexicographic string sort matches Python's Unicode-codepoint
 *    string ordering for the ASCII identifiers these sets ever contain).
 *
 * 3. `//` / `%` floor semantics: NOT used anywhere in algorithm.py (grepped
 *    for `//` and a bare `%` operator — the only match is the substring "40%"
 *    inside an unrelated docstring comment, not an operator; zero hits).
 *
 * 4. Dict merge/iteration order feeding ordered output: **present, handled
 *    carefully** — `resolve_weights` builds its `entries` dict via NESTED
 *    iteration (`hierarchy_weights` categories -> subgroups -> leaves, in
 *    that insertion order); `compute_dominance`'s `w_d = sum(e[...] for e in
 *    weights.values() if ...)` sums over that SAME iteration order, and (per
 *    hazard 6 below) the exact summation order is load-bearing for
 *    Neumaier-compensated `sum()`. `resolveWeights` below builds its
 *    `Record<string, WeightEntry>` via the identical nested `for...of
 *    Object.keys(...)` structure (never `FEATURE_ORDER` directly, even
 *    though the package.json hierarchy happens to nest in that exact order
 *    today) so both the entries map's insertion order AND
 *    `Object.values(weights)`'s iteration order match Python's dict order
 *    property-for-property. `_normalize_siblings`'s `{k: float(v)/total for
 *    k, v in shares.items()}` is order-irrelevant (consumed by key only) —
 *    ported as a plain `for...of Object.entries(...)` loop, order kept for
 *    readability, not correctness. `feature_snapshot.preference.
 *    scene_service_usage_level` / `service_recency_state` / etc. are all
 *    consumed by direct key lookup (`table[candidate_id]`), never iterated
 *    in a way that would leak object order into the output — confirmed by
 *    re-reading every consumer.
 *
 * 5. Float->string formatting: see hazard 1 above (folded in, since both are
 *    the SAME underlying Python `str(float)`/`:.Nf` formatting concern) —
 *    `_build_rationale`'s two format specs and `_apply_confidence_shrinkage`'s
 *    one bare interpolation are the ONLY float->string formatting surfaces
 *    in the whole file (grepped every `f"` in algorithm.py — see the task
 *    report for the full annotated list); everything else that reaches an
 *    f-string with a numeric `{var}` is on an exception-raising
 *    (`_RequestError`/`_ConfigError`/`_CatalogError`) message, which this
 *    golden — by construction — never reaches (see "unverified branches"
 *    below), so those messages' exact text is not part of the parity
 *    boundary.
 *
 * 6. **CPython 3.12's `sum()` is Neumaier-compensated; confirmed load-bearing
 *    here too**, not just in the hybrid port. `grep -n 'sum('
 *    algorithm.py` finds exactly 4 hits:
 *      - `_normalize_siblings`: `total = sum(float(v) for v in shares.values())`
 *        (algorithm.py:232) — sums 2-4 sibling shares at a time (category /
 *        subgroup / leaf level). Verified empirically (python3.12 REPL,
 *        package.json's ACTUAL default `hierarchy_weights`): the
 *        `Situation` subgroups' shares (0.5 + 0.35 + 0.075 + 0.075) sum to
 *        `1.0` via CPython's `sum()` but `0.9999999999999999` via a naive
 *        left-to-right accumulator — a real, not merely theoretical, ULP
 *        divergence for the package's own shipped defaults.
 *      - `compute_dominance`: `w_d = sum(e["effective_weight"] for e in
 *        weights.values() if e["subgroup"] in _DOMINANCE_D_SUBGROUPS)`
 *        (algorithm.py:316) — also verified empirically to diverge from a
 *        naive accumulator for 3 of the 4 built-in purposes (`rest_recommended`,
 *        `route_music`, `child_passenger_experience`; only
 *        `inattentive_driving_prevention_recovery` happens to land on the
 *        same float either way). `w_d` feeds `w_l`, `required_gap`, the
 *        `preserved` boolean, and `safety_share_warning` — a ULP error here
 *        can flip a boolean field, exactly like the hybrid port's `clamped`
 *        finding.
 *      - `_scene_usage_evidence`: `sum(vals) / len(vals)` (algorithm.py:425)
 *        — `vals` entries are always one of `usage_ordinal_map`'s FOUR
 *        values (`-1.0, -0.5, 0.25, 1.0`, package.json), every one an exact
 *        dyadic rational (denominator <= 4). A sum of up to ~9 such terms
 *        (there are at most 9 possible scene ids, `derive_scene_ids`) stays
 *        exactly representable in a double regardless of addition order —
 *        confirmed empirically with 20,000 random-order trials (0
 *        divergences) in addition to the general float-exactness argument —
 *        so this one is safe with a plain reduction; using `neumaierSum`
 *        here would be harmless but is deliberately skipped to keep the
 *        "only use it where the divergence is real" discipline from the
 *        hybrid port's own note.
 *      - `_build_rationale`: `sorted(contributions, ...)` — not a `sum()`
 *        call (grep false-lead, it's `sorted`, already covered by hazard 2).
 *    `neumaierSum` was ALREADY written for the hybrid port
 *    (`./aica_transparent_hybrid_trigger_v1.ts`) — per the task brief,
 *    extracted to `./mathUtils.ts` and imported by BOTH ports now, rather
 *    than hand-copied a second time; the hybrid file was updated to import
 *    it too (see that file's diff — behavior unchanged, only where the
 *    function is defined).
 *
 * ---------------------------------------------------------------------------
 * Branches this port's golden does NOT exercise (see the task report for the
 * full per-branch table):
 * ---------------------------------------------------------------------------
 *
 * The three raising error classes (`_RequestError`/`_ConfigError`/
 * `_CatalogError` — invalid `trigger_purpose`/`lifecycle_stage`, a
 * candidate outside `allowed_service_ids` or outside its stage's frozen
 * candidate family, a malformed/out-of-range `response_coefficient_overrides`
 * entry, a missing declared hyperparameter/parameter, non-finite config
 * values, ...) can only be reached by calling `evaluate()` with an INVALID
 * input, which — by construction — cannot be captured as a golden "success"
 * case (the Python call would raise, not return a dict to snapshot). This
 * mirrors how `nri_fatigue_score_v1` / `aica_transparent_hybrid_trigger_v1`'s
 * own strict hyperparameter accessors are never golden-exercised on their
 * throwing path either. Every one of those Python `raise` statements is
 * still ported faithfully below (as a thrown `Error` subclass with an
 * equivalent, human-readable message) so a FUTURE caller that reaches this
 * code with bad input gets a real thrown error rather than silently wrong
 * output — but the exact THROWN MESSAGE TEXT is not part of the parity
 * boundary verified here (only successful, non-throwing `evaluate()` calls
 * are golden-compared).
 */

import { neumaierSum, pyFixed } from './mathUtils'

// ---------------------------------------------------------------------------
// Public input/output types — mirror app/api/aica_api/models/proposal/
// selector_input.py / service_output.py (see the module doc above for why
// most SelectorInput fields are optional here).
// ---------------------------------------------------------------------------

export type CandidateRef = { candidate_id: string }
export type ExcludedCandidateRef = { candidate_id: string; platform_reason: string }

export type SelectorInput = {
  contract_version?: string | null
  schema_version?: string | null
  opportunity_id?: string
  simulation_time?: string | number
  trigger_purpose: string
  lifecycle_stage: string
  allowed_service_ids: string[]
  selected_service_id?: string | null
  feature_snapshot: Record<string, unknown>
  feature_provenance?: Record<string, unknown>
  enabled_feature_extensions?: string[]
  eligible_candidates: CandidateRef[]
  excluded_candidates?: ExcludedCandidateRef[]
  parameters: Record<string, unknown>
  hyperparameters: Record<string, unknown>
  package_runtime_state?: Record<string, unknown>
  catalog_version?: string
  run_seed?: string
}

export type FeatureContribution = {
  feature_id: string
  feature_value: string | number | boolean | null
  response_coefficient: number
  weight: number
  contribution: number
  source_reference: string | null
  raw_value: string | number | boolean | null
  normalization_function: string
  normalized_evidence: number
  response_provenance: string | null
  normalized_feature_response: number
  hierarchy_path: string
  base_weight: number
  purpose_multiplier: number
  effective_weight: number
  status: 'used' | 'missing' | 'zero_weight' | 'neutral'
  customer_override: number | null
}

export type DominanceReadout = {
  status: 'default_dominance_preserved' | 'dominance_not_guaranteed'
  w_d: number
  w_l: number
  required_gap: number
  material_safety_gap: number
  safety_share: number
  safety_share_warning: boolean
}

export type StrongestContribution = { feature_id: string; contribution: number } | null

export type RankedCandidate = {
  rank: number
  candidate_id: string
  score: number
  rationale: string[]
  supporting_feature_ids: string[]
  opposing_feature_ids: string[]
  uncertainty: null
  feature_contributions: FeatureContribution[]
  situation_fit: number
  preference_fit: number
  history_fit: number
  strongest_support: StrongestContribution
  strongest_oppose: StrongestContribution
  dominance: DominanceReadout
}

export type ServiceSelectorOutput = {
  decision_type: 'ranked_candidates' | 'no_proposal'
  ranked_candidates: RankedCandidate[]
  excluded_candidates: ExcludedCandidateRef[]
  unused_available_features: string[]
  missing_features: string[]
  next_package_runtime_state: Record<string, unknown>
  algorithm_provenance: Record<string, unknown>
  dominance: DominanceReadout
  effective_weights: Record<string, number>
  resolved_config_versions: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Contract-order feature ids (SS5.3, the 17 CDC-SU baseline service features)
// ---------------------------------------------------------------------------

const FEATURE_ORDER: string[] = [
  'drowsiness_level',
  'fatigue_level',
  'traffic_state',
  'road_type',
  'night_state',
  'monotony_level',
  'route_tags',
  'destination_tags',
  'child_present',
  'multiple_passengers',
  'oshi_registered',
  'oshi_mode',
  'service_recency_state',
  'service_usage_level',
  'scene_service_usage_level',
  'service_proposal_acceptance_rate',
  'service_recovery_rate',
]

const DIRECT_FEATURES = new Set<string>([
  'service_recency_state',
  'service_usage_level',
  'scene_service_usage_level',
  'service_proposal_acceptance_rate',
  'service_recovery_rate',
])

const VALID_PURPOSES = new Set<string>([
  'rest_recommended',
  'inattentive_driving_prevention_recovery',
  'route_music',
  'child_passenger_experience',
])
const VALID_STAGES = new Set<string>([
  'before_rest_until_stop',
  'during_rest_stopped',
  'after_rest_before_restart',
  'active_driving_content',
])
const REST_STAGES = new Set<string>(['before_rest_until_stop', 'during_rest_stopped', 'after_rest_before_restart'])
const ACTIVE_DRIVING_PURPOSES = new Set<string>([
  'inattentive_driving_prevention_recovery',
  'route_music',
  'child_passenger_experience',
])

const DOMINANCE_D_SUBGROUPS = new Set<string>(['driver_state', 'driving_environment', 'recovery'])

const SNAPSHOT_GROUPS = ['situation', 'preference', 'history', 'additional_proposed'] as const

const CONFIDENCE_FIELD_FOR_FEATURE: Record<string, string> = {
  service_proposal_acceptance_rate: 'service_proposal_acceptance_confidence',
  service_recovery_rate: 'service_recovery_confidence',
}

const FEATURE_LABELS: Record<string, { ja: string; en: string }> = {
  drowsiness_level: { ja: '眠気', en: 'drowsiness' },
  fatigue_level: { ja: '疲労', en: 'fatigue' },
  traffic_state: { ja: '渋滞', en: 'traffic' },
  road_type: { ja: '道路種別', en: 'road type' },
  night_state: { ja: '夜間', en: 'night' },
  monotony_level: { ja: '単調性', en: 'monotony' },
  route_tags: { ja: 'ルート特性', en: 'route characteristics' },
  destination_tags: { ja: '目的地特性', en: 'destination characteristics' },
  child_present: { ja: '子供同乗', en: 'child present' },
  multiple_passengers: { ja: '複数乗員', en: 'multiple passengers' },
  oshi_registered: { ja: '推し登録', en: 'oshi registered' },
  oshi_mode: { ja: '推しモード', en: 'oshi mode' },
  service_recency_state: { ja: 'サービス未使用度', en: 'service recency' },
  service_usage_level: { ja: 'サービス利用頻度', en: 'overall service usage' },
  scene_service_usage_level: { ja: '場面別サービス利用', en: 'scene-specific service usage' },
  service_proposal_acceptance_rate: { ja: '提案受諾率', en: 'proposal acceptance rate' },
  service_recovery_rate: { ja: '回復率', en: 'recovery rate' },
}

// ---------------------------------------------------------------------------
// Errors — mirror _RequestError / _CatalogError / _ConfigError. Unverified
// by the golden (see the module doc's "branches not exercised" section) but
// ported faithfully so a future caller sees a real thrown error, never
// silently-wrong output.
// ---------------------------------------------------------------------------

export class SelectorRequestError extends Error {}
export class SelectorCatalogError extends Error {}
export class SelectorConfigError extends Error {}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function clamp(v: number, lo = -1.0, hi = 1.0): number {
  return Math.max(lo, Math.min(hi, v))
}

/** Normalize -0 to +0 for deterministic serialization (SS3.4). */
function norm0(v: number): number {
  return v === 0 ? v + 0.0 : v
}

/**
 * Coerce a raw/feature value to the `str | float | int | bool | None` shape
 * the `FeatureContribution` contract requires (data-model.md SS1). Python's
 * `isinstance(v, (str, float, int))` ALSO matches `bool` (a `bool` is an
 * `int` subclass in Python), so a boolean raw value passes through
 * UNCHANGED (never stringified) — mirrored here with an explicit
 * `typeof v === 'boolean'` branch. Only `route_tags`/`destination_tags`
 * (list[str]) and the derived scene-id list for `scene_service_usage_level`
 * are ever non-scalar here; represented as a comma-joined display string
 * rather than widening the shared contract.
 */
function scalarize(v: unknown): string | number | boolean | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v
  if (Array.isArray(v)) return v.map((item) => String(item)).join(', ')
  return String(v)
}

/** Direct-index hyperparameter read; a missing key is invalid_configuration. */
function hpGet(hp: Record<string, unknown>, key: string): unknown {
  if (!hp || !Object.prototype.hasOwnProperty.call(hp, key)) {
    throw new SelectorConfigError(`missing hyperparameter '${key}'`)
  }
  return hp[key]
}

/** Direct-index parameter read; a missing key is invalid_configuration. */
function paramGet(params: Record<string, unknown>, key: string): unknown {
  if (!params || !Object.prototype.hasOwnProperty.call(params, key)) {
    throw new SelectorConfigError(`missing parameter '${key}'`)
  }
  return params[key]
}

/**
 * Mirrors `_finite()`: coerce to a finite number or raise. Python's
 * `float(True) == 1.0` (bool is an int subclass) is mirrored explicitly;
 * every config value this is actually called on in the golden is already a
 * genuine JSON number, so this is defensive parity, not a load-bearing path.
 */
function finiteNum(v: unknown, label: string): number {
  let f: number
  if (typeof v === 'boolean') {
    f = v ? 1.0 : 0.0
  } else if (typeof v === 'number') {
    f = v
  } else {
    throw new SelectorConfigError(`${label} is not numeric: ${JSON.stringify(v)}`)
  }
  if (!Number.isFinite(f)) {
    throw new SelectorConfigError(`${label} is not finite: ${JSON.stringify(v)}`)
  }
  return f
}

/**
 * Mirrors Python's `str(float)` for the ONE bare f-string float
 * interpolation in algorithm.py (`_apply_confidence_shrinkage`,
 * `f"...[confidence={conf}]"`) — a whole-number float renders WITH a
 * trailing ".0" in Python (`str(1.0) == "1.0"`), unlike a plain JS template
 * literal (`` `${1.0}` === "1" ``). Not used anywhere else — see hazard 1/5
 * in the module doc for why this is the only call site that needs it.
 */
function pyFloatRepr(x: number): string {
  if (Number.isNaN(x)) return 'nan'
  if (!Number.isFinite(x)) return x > 0 ? 'inf' : '-inf'
  const s = String(x)
  return /[.eE]/.test(s) ? s : `${s}.0`
}

// ---------------------------------------------------------------------------
// WeightResolver (SS6): normalize siblings -> base = cat x subgroup x leaf ->
// apply purpose multipliers -> renormalize Sigma=1.
// ---------------------------------------------------------------------------

/**
 * Mirrors `_normalize_siblings`. `total` is computed via `neumaierSum`
 * (Python's `sum()`, algorithm.py:232) — verified empirically to matter for
 * the package's own shipped `hierarchy_weights` defaults (see hazard 6 in
 * the module doc).
 */
function normalizeSiblings(shares: Record<string, unknown>, label: string): Record<string, number> {
  for (const [k, v] of Object.entries(shares)) {
    const fv = finiteNum(v, `${label}[${k}]`)
    if (fv < 0) throw new SelectorConfigError(`${label}[${k}] is negative: ${fv}`)
  }
  const values = Object.values(shares).map((v) => Number(v))
  const total = neumaierSum(values)
  if (!Number.isFinite(total) || total <= 0) {
    throw new SelectorConfigError(`all-zero or non-finite sibling weight group: ${label}`)
  }
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(shares)) out[k] = Number(v) / total
  return out
}

type WeightEntry = {
  feature_id: string
  category: string
  subgroup: string
  hierarchy_path: string
  base_weight: number
  purpose_multiplier: number
  raw: number
  effective_weight: number
}

/**
 * Return `{feature_id: entry}` with base_weight/purpose_multiplier/raw/
 * effective_weight/category/subgroup/hierarchy_path, Sigma(effective_weight)
 * == 1. Built via the SAME nested (category -> subgroup -> leaf) iteration
 * Python uses (never `FEATURE_ORDER` directly) — see hazard 4 in the module
 * doc for why the resulting object's insertion order matters downstream
 * (`compute_dominance`'s `sum()`).
 */
function resolveWeights(hp: Record<string, unknown>, purpose: string): Record<string, WeightEntry> {
  const hierarchy = hpGet(hp, 'hierarchy_weights') as Record<string, any>
  const multipliers = hpGet(hp, 'purpose_multipliers') as Record<string, any>

  if (!hierarchy || Object.keys(hierarchy).length === 0) {
    throw new SelectorConfigError('hierarchy_weights is empty')
  }

  const catShares: Record<string, unknown> = {}
  for (const cat of Object.keys(hierarchy)) catShares[cat] = hierarchy[cat].share
  const normCats = normalizeSiblings(catShares, 'categories')

  const entries: Record<string, WeightEntry> = {}
  let rawTotal = 0.0
  for (const cat of Object.keys(hierarchy)) {
    const catDef = hierarchy[cat]
    const subgroups: Record<string, any> = catDef.subgroups || {}
    const subShares: Record<string, unknown> = {}
    for (const sg of Object.keys(subgroups)) subShares[sg] = subgroups[sg].share
    const normSubs = normalizeSiblings(subShares, `${cat} subgroups`)

    for (const sg of Object.keys(subgroups)) {
      const sub = subgroups[sg]
      const leaves: Record<string, any> = sub.leaves || {}
      const leafShares: Record<string, unknown> = {}
      for (const leaf of Object.keys(leaves)) leafShares[leaf] = leaves[leaf].share
      const normLeaves = normalizeSiblings(leafShares, `${cat}/${sg} leaves`)

      const sgMultipliers = multipliers[sg]
      if (sgMultipliers === undefined || sgMultipliers === null) {
        throw new SelectorConfigError(`purpose_multipliers missing subgroup '${sg}'`)
      }
      if (!Object.prototype.hasOwnProperty.call(sgMultipliers, purpose)) {
        throw new SelectorConfigError(`purpose_multipliers['${sg}'] missing purpose '${purpose}'`)
      }
      const pmult = finiteNum(sgMultipliers[purpose], `purpose_multipliers['${sg}']['${purpose}']`)
      if (pmult < 0) {
        throw new SelectorConfigError(`purpose_multipliers['${sg}']['${purpose}'] is negative: ${pmult}`)
      }

      for (const leaf of Object.keys(leaves)) {
        const base = normCats[cat] * normSubs[sg] * normLeaves[leaf]
        const raw = base * pmult
        rawTotal += raw
        entries[leaf] = {
          feature_id: leaf,
          category: cat,
          subgroup: sg,
          hierarchy_path: `${cat}/${sg}/${leaf}`,
          base_weight: base,
          purpose_multiplier: pmult,
          raw,
          effective_weight: 0, // filled in below
        }
      }
    }
  }

  if (!Number.isFinite(rawTotal) || rawTotal <= 0) {
    throw new SelectorConfigError('zero or non-finite active-weight denominator')
  }
  for (const e of Object.values(entries)) e.effective_weight = e.raw / rawTotal

  const missing = FEATURE_ORDER.filter((fid) => !(fid in entries))
  if (missing.length > 0) {
    throw new SelectorConfigError(`hierarchy_weights is missing leaves for feature(s): ${JSON.stringify(missing)}`)
  }

  return entries
}

// ---------------------------------------------------------------------------
// EvidenceBuilder (SS6.4 / SS9 step 6 / SS14): the dominance readout is a
// pure function of the resolved weights alone — identical for every
// candidate scored in one evaluate() call.
// ---------------------------------------------------------------------------

/**
 * Mirrors `compute_dominance`. `w_d` is computed via `neumaierSum` (Python's
 * `sum()`, algorithm.py:316) — verified empirically to matter for 3 of the 4
 * built-in purposes on the package's own defaults (see hazard 6 in the
 * module doc); iteration order matches `resolveWeights`'s entries object.
 */
function computeDominance(
  weights: Record<string, WeightEntry>,
  hp: Record<string, unknown>,
  params: Record<string, unknown>,
): DominanceReadout {
  const dValues = Object.values(weights)
    .filter((e) => DOMINANCE_D_SUBGROUPS.has(e.subgroup))
    .map((e) => e.effective_weight)
  const wD = neumaierSum(dValues)
  const wL = 1.0 - wD

  const materialSafetyGap = finiteNum(paramGet(params, 'material_safety_gap'), 'material_safety_gap')
  if (materialSafetyGap < 0) {
    throw new SelectorConfigError(`material_safety_gap is negative: ${materialSafetyGap}`)
  }

  let requiredGap: number
  if (wD > 1e-12) {
    requiredGap = (2.0 * wL) / wD
  } else {
    // W_D ~ 0 can never satisfy the invariant for any finite gap; report a
    // large-but-finite sentinel rather than +Infinity (JSON-safety).
    requiredGap = 1.0e12
  }

  const preserved = wD * materialSafetyGap > 2.0 * wL
  const floor = finiteNum(hpGet(hp, 'safety_share_warning_floor'), 'safety_share_warning_floor')

  return {
    status: preserved ? 'default_dominance_preserved' : 'dominance_not_guaranteed',
    w_d: norm0(wD),
    w_l: norm0(wL),
    required_gap: norm0(requiredGap),
    material_safety_gap: materialSafetyGap,
    safety_share: norm0(wD),
    safety_share_warning: wD < floor,
  }
}

/**
 * Generic sweep: any key present under one of the four `feature_snapshot`
 * groups that is not one of the 17 scored `FEATURE_ORDER` features is
 * "available but not used" (doc SS5.6). When `confidence_shrinkage_v1` is
 * ON, the two confidence fields ARE consumed — they move out of "unused"
 * into "used".
 */
function scanUnusedSnapshotKeys(snapshot: Record<string, unknown>, confidenceShrinkageOn = false): Set<string> {
  const used = new Set<string>(FEATURE_ORDER)
  if (confidenceShrinkageOn) {
    for (const v of Object.values(CONFIDENCE_FIELD_FOR_FEATURE)) used.add(v)
  }
  const found = new Set<string>()
  for (const group of SNAPSHOT_GROUPS) {
    const groupObj = (snapshot[group] as Record<string, unknown> | undefined) || {}
    for (const key of Object.keys(groupObj)) {
      if (!used.has(key)) found.add(key)
    }
  }
  return found
}

// ---------------------------------------------------------------------------
// SceneResolver (SS5.7): derive the current scene ids from situation, then
// average usage-normalized values over matching scene records.
// ---------------------------------------------------------------------------

function deriveSceneIds(
  situation: Record<string, unknown>,
  hp: Record<string, unknown>,
  params: Record<string, unknown>,
): string[] {
  const scenes: string[] = []
  if (situation.traffic_state === 'congested') scenes.push('traffic:congested')
  const road = situation.road_type
  if (road === 'highway' || road === 'local' || road === 'mountain' || road === 'parking') {
    scenes.push(`road:${road}`)
  }
  if (situation.night_state === 'night') scenes.push('time:night')

  const monotony = situation.monotony_level
  if (typeof monotony === 'number') {
    const medMin = finiteNum(hpGet(hp, 'monotony_medium_min'), 'monotony_medium_min')
    const highMin = finiteNum(hpGet(hp, 'monotony_high_min'), 'monotony_high_min')
    if (monotony >= highMin) scenes.push('monotony:high')
    else if (monotony >= medMin) scenes.push('monotony:medium')
  }

  if (situation.child_present) scenes.push('passenger:child')
  if (situation.multiple_passengers) scenes.push('passenger:group')

  const recognizedRoute = new Set<string>((paramGet(params, 'recognized_route_tags') as string[]) ?? [])
  const recognizedDest = new Set<string>((paramGet(params, 'recognized_destination_tags') as string[]) ?? [])
  for (const t of (situation.route_tags as string[] | undefined) ?? []) {
    if (recognizedRoute.has(t)) scenes.push(`route:${t}`)
  }
  for (const t of (situation.destination_tags as string[] | undefined) ?? []) {
    if (recognizedDest.has(t)) scenes.push(`destination:${t}`)
  }

  const seen = new Set<string>()
  const out: string[] = []
  for (const s of scenes) {
    if (!seen.has(s)) {
      seen.add(s)
      out.push(s)
    }
  }
  return out
}

/**
 * Mirrors `_scene_usage_evidence`. `vals` entries are always one of
 * `usage_ordinal_map`'s four exact dyadic-rational values, so a plain
 * reduction (not `neumaierSum`) is safe here — see hazard 6 in the module
 * doc for the empirical check.
 */
function sceneUsageEvidence(
  candidateId: string,
  sceneIds: string[],
  sceneMap: Record<string, Record<string, string>> | undefined,
  usageMap: Record<string, number>,
): [number, string] {
  const vals: number[] = []
  for (const sid of sceneIds) {
    const rec = (sceneMap && sceneMap[sid]) || {}
    if (Object.prototype.hasOwnProperty.call(rec, candidateId)) {
      const level = rec[candidateId]
      if (Object.prototype.hasOwnProperty.call(usageMap, level)) {
        vals.push(usageMap[level])
      }
    }
  }
  if (vals.length === 0) return [0.0, 'missing_neutral']
  const sum = vals.reduce((a, b) => a + b, 0)
  return [sum / vals.length, 'used']
}

// ---------------------------------------------------------------------------
// FeatureNormalizer (SS5.3/SS5.7): (raw_value, e, normalization_function,
// status) per non-candidate-indexed feature.
// ---------------------------------------------------------------------------

type Evidence = {
  raw_value: unknown
  e: number
  normalization_function: string
  status: 'used' | 'missing' | 'missing_neutral'
  unknown_tags?: string[]
}

function powEvidence(x: number, gamma: number): number {
  return clamp((x / 100.0) ** gamma, 0.0, 1.0)
}

/**
 * Return evidence for one of the 10 Situation-group features +
 * oshi_registered/oshi_mode (12 non-candidate-indexed features). Road type
 * is handled separately by `resolveRoadEvidence`.
 */
function resolveScalarEvidence(
  featureId: string,
  situation: Record<string, unknown>,
  hp: Record<string, unknown>,
  params: Record<string, unknown>,
): Evidence {
  const present = Object.prototype.hasOwnProperty.call(situation, featureId)
  const raw = present ? situation[featureId] : undefined

  if (featureId === 'drowsiness_level' || featureId === 'fatigue_level' || featureId === 'monotony_level') {
    const gammaKey =
      featureId === 'drowsiness_level' ? 'gamma_drowsiness' : featureId === 'fatigue_level' ? 'gamma_fatigue' : 'gamma_monotony'
    const gamma = finiteNum(hpGet(hp, gammaKey), gammaKey)
    if (!present || raw === null || raw === undefined) {
      return { raw_value: null, e: 0.0, normalization_function: '(x/100)^gamma', status: 'missing' }
    }
    if (typeof raw !== 'number' || !(raw >= 0 && raw <= 100)) {
      throw new SelectorRequestError(`${featureId} must be numeric in [0,100], got ${JSON.stringify(raw)}`)
    }
    // SIGNED activation-need evidence: [0,100] -> [-1,+1].
    const e = 2.0 * powEvidence(raw, gamma) - 1.0
    return { raw_value: raw, e, normalization_function: '2*(x/100)^gamma - 1', status: 'used' }
  }

  if (featureId === 'traffic_state') {
    if (!present || raw === null || raw === undefined) {
      return { raw_value: null, e: 0.0, normalization_function: 'categorical(congested=1,normal=0)', status: 'missing' }
    }
    if (raw !== 'normal' && raw !== 'congested') {
      throw new SelectorRequestError(`traffic_state must be 'normal' or 'congested', got ${JSON.stringify(raw)}`)
    }
    return {
      raw_value: raw,
      e: raw === 'congested' ? 1.0 : 0.0,
      normalization_function: 'categorical(congested=1,normal=0)',
      status: 'used',
    }
  }

  if (featureId === 'night_state') {
    if (!present || raw === null || raw === undefined) {
      return { raw_value: null, e: 0.0, normalization_function: 'categorical(night=1,day=0)', status: 'missing' }
    }
    if (raw !== 'day' && raw !== 'night') {
      throw new SelectorRequestError(`night_state must be 'day' or 'night', got ${JSON.stringify(raw)}`)
    }
    return {
      raw_value: raw,
      e: raw === 'night' ? 1.0 : 0.0,
      normalization_function: 'categorical(night=1,day=0)',
      status: 'used',
    }
  }

  if (featureId === 'route_tags' || featureId === 'destination_tags') {
    const satKey = featureId === 'route_tags' ? 'route_tag_saturation' : 'destination_tag_saturation'
    const recogKey = featureId === 'route_tags' ? 'recognized_route_tags' : 'recognized_destination_tags'
    const saturation = finiteNum(hpGet(hp, satKey), satKey)
    const recognizedVocab = new Set<string>((paramGet(params, recogKey) as string[]) ?? [])
    const tags: string[] = present && Array.isArray(raw) ? (raw as string[]) : []
    const recognized = Array.from(new Set(tags.filter((t) => recognizedVocab.has(t)))).sort()
    const unknown = Array.from(new Set(tags.filter((t) => !recognizedVocab.has(t)))).sort()
    const e = saturation > 0 ? Math.min(1.0, recognized.length / saturation) : 0.0
    return {
      raw_value: present ? tags : null,
      e,
      normalization_function: 'min(1, recognized_unique_tags/saturation)',
      status: present ? 'used' : 'missing',
      unknown_tags: unknown,
    }
  }

  if (featureId === 'child_present' || featureId === 'multiple_passengers') {
    if (!present || raw === null || raw === undefined) {
      return { raw_value: null, e: 0.0, normalization_function: 'bool(true=1,false=0)', status: 'missing' }
    }
    if (typeof raw !== 'boolean') {
      throw new SelectorRequestError(`${featureId} must be boolean, got ${JSON.stringify(raw)}`)
    }
    return { raw_value: raw, e: raw ? 1.0 : 0.0, normalization_function: 'bool(true=1,false=0)', status: 'used' }
  }

  if (featureId === 'oshi_registered') {
    if (!present || raw === null || raw === undefined) {
      return { raw_value: null, e: 0.0, normalization_function: 'bool(true=1,false=0)', status: 'missing' }
    }
    if (typeof raw !== 'boolean') {
      throw new SelectorRequestError(`oshi_registered must be boolean, got ${JSON.stringify(raw)}`)
    }
    return { raw_value: raw, e: raw ? 1.0 : 0.0, normalization_function: 'bool(true=1,false=0)', status: 'used' }
  }

  if (featureId === 'oshi_mode') {
    if (!present || raw === null || raw === undefined) {
      return { raw_value: null, e: 0.0, normalization_function: 'signed(on=+1,off=-1)', status: 'missing' }
    }
    if (raw !== 'on' && raw !== 'off') {
      throw new SelectorRequestError(`oshi_mode must be 'on' or 'off', got ${JSON.stringify(raw)}`)
    }
    return { raw_value: raw, e: raw === 'on' ? 1.0 : -1.0, normalization_function: 'signed(on=+1,off=-1)', status: 'used' }
  }

  throw new SelectorConfigError(`resolveScalarEvidence: unknown feature_id '${featureId}'`)
}

function resolveRoadEvidence(situation: Record<string, unknown>): Evidence {
  const present = Object.prototype.hasOwnProperty.call(situation, 'road_type')
  const raw = situation.road_type
  if (!present || raw === null || raw === undefined) {
    return { raw_value: null, e: 0.0, normalization_function: 'categorical(e=1)', status: 'missing' }
  }
  if (raw !== 'highway' && raw !== 'local' && raw !== 'mountain' && raw !== 'parking') {
    throw new SelectorRequestError(`road_type must be one of highway/local/mountain/parking, got ${JSON.stringify(raw)}`)
  }
  return { raw_value: raw, e: 1.0, normalization_function: 'categorical(e=1)', status: 'used' }
}

/** Evidence for the 5 candidate-indexed direct features (SS5.4). */
function resolveDirectEvidence(
  featureId: string,
  candidateId: string,
  snapshot: Record<string, unknown>,
  hp: Record<string, unknown>,
  situation: Record<string, unknown>,
  params: Record<string, unknown>,
): Evidence {
  const preference = (snapshot.preference as Record<string, unknown>) || {}
  const history = (snapshot.history as Record<string, unknown>) || {}

  if (featureId === 'service_recency_state') {
    const recencyMap = paramGet(params, 'recency_ordinal_map') as Record<string, number>
    const table = (preference.service_recency_state as Record<string, string>) || {}
    if (!Object.prototype.hasOwnProperty.call(table, candidateId)) {
      return { raw_value: null, e: 0.0, normalization_function: 'recency_ordinal_map', status: 'missing_neutral' }
    }
    const level = table[candidateId]
    if (!Object.prototype.hasOwnProperty.call(recencyMap, level)) {
      throw new SelectorRequestError(`service_recency_state[${candidateId}] has unknown level ${JSON.stringify(level)}`)
    }
    return { raw_value: level, e: recencyMap[level], normalization_function: 'recency_ordinal_map', status: 'used' }
  }

  if (featureId === 'service_usage_level') {
    const usageMap = paramGet(params, 'usage_ordinal_map') as Record<string, number>
    const table = (preference.service_usage_level as Record<string, string>) || {}
    if (!Object.prototype.hasOwnProperty.call(table, candidateId)) {
      return { raw_value: null, e: 0.0, normalization_function: 'usage_ordinal_map', status: 'missing_neutral' }
    }
    const level = table[candidateId]
    if (!Object.prototype.hasOwnProperty.call(usageMap, level)) {
      throw new SelectorRequestError(`service_usage_level[${candidateId}] has unknown level ${JSON.stringify(level)}`)
    }
    return { raw_value: level, e: usageMap[level], normalization_function: 'usage_ordinal_map', status: 'used' }
  }

  if (featureId === 'scene_service_usage_level') {
    const usageMap = paramGet(params, 'usage_ordinal_map') as Record<string, number>
    const sceneMap = (preference.scene_service_usage_level as Record<string, Record<string, string>>) || {}
    const sceneIds = deriveSceneIds(situation, hp, params)
    const [e, status] = sceneUsageEvidence(candidateId, sceneIds, sceneMap, usageMap)
    return {
      raw_value: sceneIds,
      e,
      normalization_function: 'mean(usage_ordinal_map over current scene ids)',
      status: status as Evidence['status'],
    }
  }

  if (featureId in CONFIDENCE_FIELD_FOR_FEATURE) {
    const table = (history[featureId] as Record<string, number>) || {}
    if (!Object.prototype.hasOwnProperty.call(table, candidateId)) {
      return { raw_value: null, e: 0.0, normalization_function: '2*rate/100-1', status: 'missing_neutral' }
    }
    const rate = table[candidateId]
    if (typeof rate !== 'number' || !(rate >= 0 && rate <= 100)) {
      throw new SelectorRequestError(`${featureId}[${candidateId}] must be numeric in [0,100], got ${JSON.stringify(rate)}`)
    }
    const e = (2.0 * rate) / 100.0 - 1.0
    let result: Evidence = { raw_value: rate, e, normalization_function: '2*rate/100-1', status: 'used' }
    if (hpGet(hp, 'confidence_shrinkage_v1')) {
      result = applyConfidenceShrinkage(result, featureId, candidateId, snapshot)
    }
    return result
  }

  throw new SelectorConfigError(`resolveDirectEvidence: unknown feature_id '${featureId}'`)
}

/**
 * SS5.4 note / FR-020: shrink acceptance/recovery evidence toward neutral
 * (0) by the candidate's confidence value, `e <- e * clamp(conf, 0, 1)`. A
 * missing confidence entry is treated as full confidence (1.0 — no shrink)
 * and disclosed via `normalization_function`. Purely additive to the
 * evidence step — the caller is responsible for the response-coefficient
 * side (stays +1.0) and for marking the row's `response_provenance`.
 */
function applyConfidenceShrinkage(
  evidence: Evidence,
  featureId: string,
  candidateId: string,
  snapshot: Record<string, unknown>,
): Evidence {
  const confidenceField = CONFIDENCE_FIELD_FOR_FEATURE[featureId]
  const additional = (snapshot.additional_proposed as Record<string, unknown>) || {}
  const confidenceTable = (additional[confidenceField] as Record<string, unknown>) || {}
  const missing = !Object.prototype.hasOwnProperty.call(confidenceTable, candidateId)

  let conf: number
  if (missing) {
    conf = 1.0
  } else {
    const rawConf = confidenceTable[candidateId]
    conf = clamp(finiteNum(rawConf, `${confidenceField}[${candidateId}]`), 0.0, 1.0)
  }

  const shrunk: Evidence = { ...evidence, e: evidence.e * conf }
  if (missing) {
    shrunk.normalization_function = `${evidence.normalization_function} * clamp(confidence,0,1)[confidence=1.0 (missing, disclosed)]`
  } else {
    shrunk.normalization_function = `${evidence.normalization_function} * clamp(confidence,0,1)[confidence=${pyFloatRepr(conf)}]`
  }
  return shrunk
}

// ---------------------------------------------------------------------------
// ResponseResolver (SS5.2): candidate + road profiles from `parameters`.
// ---------------------------------------------------------------------------

type ResponseCell = {
  coefficient: number
  provenance: string | null
  source_reference: string | null
  customer_override?: number | null
}

function resolveResponse(
  candidateId: string,
  featureId: string,
  roadType: unknown,
  params: Record<string, unknown>,
): ResponseCell {
  if (featureId === 'road_type') {
    const table = paramGet(params, 'road_response_profiles') as Record<string, Record<string, ResponseCell>>
    const candTable = table[candidateId]
    if (candTable === undefined || candTable === null) {
      throw new SelectorConfigError(`road_response_profiles missing candidate '${candidateId}'`)
    }
    if (roadType === null || roadType === undefined) {
      return { coefficient: 0.0, provenance: null, source_reference: null }
    }
    const cell = candTable[roadType as string]
    if (cell === undefined || cell === null) {
      throw new SelectorConfigError(`road_response_profiles['${candidateId}'] missing road type '${roadType}'`)
    }
    return cell
  }

  const table = paramGet(params, 'service_response_profiles') as Record<string, Record<string, ResponseCell>>
  const candTable = table[candidateId]
  if (candTable === undefined || candTable === null) {
    throw new SelectorConfigError(`service_response_profiles missing candidate '${candidateId}'`)
  }
  const cell = candTable[featureId]
  if (cell === undefined || cell === null) {
    throw new SelectorConfigError(`service_response_profiles['${candidateId}'] missing feature '${featureId}'`)
  }
  return cell
}

function validateResponseCell(candidateId: string, featureId: string, cell: ResponseCell): number {
  const fcoef = finiteNum(cell.coefficient, `response coefficient for ${candidateId}/${featureId}`)
  if (!(fcoef >= -1.0 && fcoef <= 1.0)) {
    throw new SelectorConfigError(`response coefficient for ${candidateId}/${featureId} out of [-1,1]: ${fcoef}`)
  }
  return fcoef
}

/**
 * SS4.2/SS12 customer response-coefficient override: an OPTIONAL
 * `hyperparameters['response_coefficient_overrides'][candidate_id][feature_id]`
 * replaces the cell's `coefficient` with a reviewer-entered value, while
 * RETAINING the cell's original `provenance`/`source_reference` and ADDING
 * `customer_override` with the changed value. A missing overrides
 * table/candidate/feature is simply "no override"; a PRESENT override value
 * that is non-finite or outside [-1,+1] is rejected as invalid_configuration
 * (never clamped).
 */
function applyResponseOverride(
  cell: ResponseCell,
  candidateId: string,
  featureId: string,
  hp: Record<string, unknown>,
): ResponseCell {
  const overrides = (hp.response_coefficient_overrides as Record<string, Record<string, unknown>>) || {}
  const candidateOverrides = overrides[candidateId] || {}
  if (!Object.prototype.hasOwnProperty.call(candidateOverrides, featureId)) {
    return cell
  }

  const raw = candidateOverrides[featureId]
  const value = finiteNum(raw, `response_coefficient_overrides['${candidateId}']['${featureId}']`)
  if (!(value >= -1.0 && value <= 1.0)) {
    throw new SelectorConfigError(
      `response_coefficient_overrides['${candidateId}']['${featureId}'] out of [-1,1]: ${value}`,
    )
  }

  return { ...cell, coefficient: value, customer_override: value }
}

// ---------------------------------------------------------------------------
// InputValidator (SS9 step 1) helpers
// ---------------------------------------------------------------------------

function validatePurposeStage(purpose: unknown, stage: unknown): void {
  if (typeof purpose !== 'string' || !VALID_PURPOSES.has(purpose)) {
    throw new SelectorRequestError(`invalid trigger_purpose: ${JSON.stringify(purpose)}`)
  }
  if (typeof stage !== 'string' || !VALID_STAGES.has(stage)) {
    throw new SelectorRequestError(`invalid lifecycle_stage: ${JSON.stringify(stage)}`)
  }
  if (REST_STAGES.has(stage) && purpose !== 'rest_recommended') {
    throw new SelectorRequestError(
      `lifecycle_stage '${stage}' is only compatible with trigger_purpose 'rest_recommended', got '${purpose}'`,
    )
  }
  if (stage === 'active_driving_content' && !ACTIVE_DRIVING_PURPOSES.has(purpose)) {
    throw new SelectorRequestError(`lifecycle_stage 'active_driving_content' is not compatible with trigger_purpose '${purpose}'`)
  }
}

/**
 * NOTE: algorithm.py names this function's parameter `situation` but
 * `evaluate()` actually calls it with the PREFERENCE dict (`_validate_oshi_
 * consistency(preference)`, algorithm.py:738) — a misleading parameter name
 * in the Python source, not a bug; ported faithfully by naming the TS
 * parameter for what it actually receives.
 */
function validateOshiConsistency(preference: Record<string, unknown>): void {
  if (preference.oshi_registered === false && preference.oshi_mode === 'on') {
    throw new SelectorRequestError("oshi_registered=false and oshi_mode='on' is invalid input")
  }
}

// ---------------------------------------------------------------------------
// Rationale (bilingual, top contributions)
// ---------------------------------------------------------------------------

function buildRationale(contributions: FeatureContribution[]): string[] {
  // Single numeric key, descending — safe as a bare .sort() (ES2019+
  // guarantees a stable sort, matching Python's guaranteed-stable sorted()).
  const ranked = contributions.slice().sort((a, b) => b.contribution - a.contribution)
  const pos = ranked.filter((c) => c.contribution > 1e-9).slice(0, 2)
  const neg = ranked.filter((c) => c.contribution < -1e-9).slice(-2)

  const linesJa: string[] = []
  const linesEn: string[] = []
  for (const c of pos) {
    const lab = FEATURE_LABELS[c.feature_id] ?? { ja: c.feature_id, en: c.feature_id }
    linesJa.push(`${lab.ja}が支持（+${pyFixed(c.contribution, 4)}）`)
    linesEn.push(`${lab.en} supports this pick (+${pyFixed(c.contribution, 4)})`)
  }
  for (const c of neg) {
    const lab = FEATURE_LABELS[c.feature_id] ?? { ja: c.feature_id, en: c.feature_id }
    linesJa.push(`${lab.ja}が抑制（${pyFixed(c.contribution, 4)}）`)
    linesEn.push(`${lab.en} weighs against it (${pyFixed(c.contribution, 4)})`)
  }
  if (linesJa.length === 0) {
    return ['中立的なスコアです。', 'Neutral score.']
  }
  return [`${linesJa.join('、')}。`, `${linesEn.join('; ')}.`]
}

// ---------------------------------------------------------------------------
// Public API — the algorithm.py evaluate() port.
// ---------------------------------------------------------------------------

export function evaluate(context: SelectorInput): ServiceSelectorOutput {
  const hp = context.hyperparameters
  const params = context.parameters || {}
  const purpose = context.trigger_purpose
  const stage = context.lifecycle_stage
  const confidenceShrinkageOn = Boolean(hpGet(hp, 'confidence_shrinkage_v1'))

  validatePurposeStage(purpose, stage)

  const snapshot = context.feature_snapshot || {}
  const situation = (snapshot.situation as Record<string, unknown>) || {}
  const preference = (snapshot.preference as Record<string, unknown>) || {}
  validateOshiConsistency(preference)

  const allowed = new Set<string>(context.allowed_service_ids || [])
  const eligibleIds = (context.eligible_candidates || []).map((c) => c.candidate_id)

  const stageFamilyCfg = paramGet(params, 'candidate_stage_family') as Record<string, string[]>
  const stageFamily = new Set<string>(stageFamilyCfg[stage] || [])

  for (const cid of eligibleIds) {
    if (!allowed.has(cid)) {
      throw new SelectorCatalogError(`eligible candidate '${cid}' is not in allowed_service_ids`)
    }
    if (!stageFamily.has(cid)) {
      throw new SelectorCatalogError(`candidate '${cid}' is not a supported service for lifecycle_stage '${stage}'`)
    }
  }

  const excludedCandidates = context.excluded_candidates || []

  // Resolve effective weights once (SS9 step 3).
  const weights = resolveWeights(hp, purpose)

  // SS6.4 dominance readout + SS12 "resolved beside entered" evidence: pure
  // functions of the resolved weights, identical for every candidate.
  const dominance = computeDominance(weights, hp, params)
  const effectiveWeights: Record<string, number> = {}
  for (const [fid, e] of Object.entries(weights)) effectiveWeights[fid] = e.effective_weight
  const resolvedConfigVersions: Record<string, unknown> = {
    package_id: 'aica_transparent_service_selector_v1',
    contract_version: context.contract_version ?? null,
    schema_version: context.schema_version ?? null,
    purpose,
    lifecycle_stage: stage,
    entered_hierarchy_weights: hp.hierarchy_weights ?? null,
    entered_purpose_multipliers: hp.purpose_multipliers ?? null,
    entered_response_coefficient_overrides: hp.response_coefficient_overrides ?? {},
  }

  // Response-profile completeness sweep (SS9 step 1) for every eligible
  // candidate — always probes road_type with "highway" regardless of the
  // real situation, purely to validate table completeness.
  for (const cid of eligibleIds) {
    for (const fid of FEATURE_ORDER) {
      let cell = fid === 'road_type' ? resolveResponse(cid, fid, 'highway', params) : resolveResponse(cid, fid, null, params)
      cell = applyResponseOverride(cell, cid, fid, hp)
      validateResponseCell(cid, fid, cell)
    }
  }

  // Pre-compute the non-candidate-indexed evidence once (SS9 step 4).
  const scalarEvidence: Record<string, Evidence> = {}
  const unknownTags = new Set<string>()
  for (const fid of FEATURE_ORDER) {
    if (DIRECT_FEATURES.has(fid)) continue
    if (fid === 'road_type') {
      scalarEvidence[fid] = resolveRoadEvidence(situation)
    } else if (fid === 'oshi_registered' || fid === 'oshi_mode') {
      scalarEvidence[fid] = resolveScalarEvidence(fid, preference, hp, params)
    } else {
      scalarEvidence[fid] = resolveScalarEvidence(fid, situation, hp, params)
      for (const t of scalarEvidence[fid].unknown_tags ?? []) unknownTags.add(t)
    }
  }

  const missingFeatures = new Set<string>()
  for (const [fid, info] of Object.entries(scalarEvidence)) {
    if (info.status === 'missing' || info.status === 'missing_neutral') missingFeatures.add(fid)
  }

  const unusedAvailableFeatures = new Set<string>([
    ...unknownTags,
    ...scanUnusedSnapshotKeys(snapshot, confidenceShrinkageOn),
  ])

  if (eligibleIds.length === 0) {
    return {
      decision_type: 'no_proposal',
      ranked_candidates: [],
      excluded_candidates: excludedCandidates,
      unused_available_features: Array.from(unusedAvailableFeatures).sort(),
      missing_features: Array.from(missingFeatures).sort(),
      next_package_runtime_state: {},
      algorithm_provenance: {
        package_id: 'aica_transparent_service_selector_v1',
        contract_version: context.contract_version ?? null,
        schema_version: context.schema_version ?? null,
        purpose,
        lifecycle_stage: stage,
        extensions_on: confidenceShrinkageOn ? ['confidence_shrinkage_v1'] : [],
        reason: 'empty_eligible_candidate_set',
      },
      dominance,
      effective_weights: effectiveWeights,
      resolved_config_versions: resolvedConfigVersions,
    }
  }

  const roadType = situation.road_type ?? null

  type ScoredCandidate = {
    candidate_id: string
    score: number
    contributions: FeatureContribution[]
    supporting: string[]
    opposing: string[]
    situation_fit: number
    preference_fit: number
    history_fit: number
    strongest_support: StrongestContribution
    strongest_oppose: StrongestContribution
  }

  const scored: ScoredCandidate[] = []
  for (const cid of eligibleIds) {
    const contributions: FeatureContribution[] = []
    let unclampedSum = 0.0
    // SS9 step 6: situation/preference/history subtotals reconstruct the
    // unclamped Sigma k_i by construction — every feature belongs to
    // exactly one category, so summing this accumulator alongside
    // unclampedSum keeps the two identical by definition (never rescaled,
    // never a sort key). Both accumulated via a plain manual loop (NOT
    // neumaierSum) — mirrors algorithm.py's manual `unclamped_sum += k_i`
    // (not a `sum()` call).
    const subtotalByCategory: Record<string, number> = { Situation: 0.0, Preference: 0.0, History: 0.0 }

    for (const fid of FEATURE_ORDER) {
      const wEntry = weights[fid]
      const w = wEntry.effective_weight

      let ev: Evidence
      let resp: ResponseCell
      if (DIRECT_FEATURES.has(fid)) {
        ev = resolveDirectEvidence(fid, cid, snapshot, hp, situation, params)
        if (ev.status === 'missing_neutral') missingFeatures.add(fid)
        let provenance = 'cdc_su_direct_candidate_feature'
        if (confidenceShrinkageOn && fid in CONFIDENCE_FIELD_FOR_FEATURE) provenance = 'confidence_shrinkage_v1'
        resp = { coefficient: 1.0, provenance, source_reference: 'Slides 66-67 (direct candidate feature)' }
      } else if (fid === 'road_type') {
        ev = scalarEvidence[fid]
        resp = resolveResponse(cid, fid, roadType, params)
      } else {
        ev = scalarEvidence[fid]
        resp = resolveResponse(cid, fid, null, params)
      }

      resp = applyResponseOverride(resp, cid, fid, hp)

      const eI = ev.e
      const aI = validateResponseCell(cid, fid, resp)
      const rI = clamp(eI * aI)
      const kI = w * rI
      unclampedSum += kI
      subtotalByCategory[wEntry.category] += kI

      // SS14 status: missing takes priority; then zero_weight (the reviewer
      // disabled this feature's influence via the hierarchy); then neutral
      // (present, weighted, but contributes exactly 0); otherwise used.
      // Purely descriptive — never changes contribution/score.
      let status: FeatureContribution['status']
      if (ev.status === 'missing' || ev.status === 'missing_neutral') {
        status = 'missing'
      } else if (w <= 0.0) {
        status = 'zero_weight'
      } else if (Math.abs(kI) < 1e-12) {
        status = 'neutral'
      } else {
        status = 'used'
      }

      const rawValuePresent = ev.raw_value !== null && ev.raw_value !== undefined
      contributions.push({
        feature_id: fid,
        feature_value: rawValuePresent ? (scalarize(ev.raw_value) as string | number | boolean) : '',
        response_coefficient: aI,
        weight: w,
        contribution: norm0(kI),
        source_reference: resp.source_reference ?? null,
        raw_value: scalarize(ev.raw_value),
        normalization_function: ev.normalization_function,
        normalized_evidence: norm0(eI),
        response_provenance: resp.provenance ?? null,
        normalized_feature_response: norm0(rI),
        hierarchy_path: wEntry.hierarchy_path,
        base_weight: wEntry.base_weight,
        purpose_multiplier: wEntry.purpose_multiplier,
        effective_weight: w,
        status,
        customer_override: resp.customer_override ?? null,
      })
    }

    const score = norm0(clamp(unclampedSum, -1.0, 1.0))
    const supporting = contributions.filter((c) => c.contribution > 1e-9).map((c) => c.feature_id)
    const opposing = contributions.filter((c) => c.contribution < -1e-9).map((c) => c.feature_id)

    const positive = contributions.filter((c) => c.contribution > 0.0)
    const negative = contributions.filter((c) => c.contribution < 0.0)
    let strongestSupport: StrongestContribution = null
    if (positive.length > 0) {
      const best = positive.reduce((a, b) => (b.contribution > a.contribution ? b : a))
      strongestSupport = { feature_id: best.feature_id, contribution: best.contribution }
    }
    let strongestOppose: StrongestContribution = null
    if (negative.length > 0) {
      const worst = negative.reduce((a, b) => (b.contribution < a.contribution ? b : a))
      strongestOppose = { feature_id: worst.feature_id, contribution: worst.contribution }
    }

    scored.push({
      candidate_id: cid,
      score,
      contributions,
      supporting,
      opposing,
      situation_fit: norm0(subtotalByCategory.Situation),
      preference_fit: norm0(subtotalByCategory.Preference),
      history_fit: norm0(subtotalByCategory.History),
      strongest_support: strongestSupport,
      strongest_oppose: strongestOppose,
    })
  }

  // Rank: (score desc, candidate_id asc); take top_k (SS9 step 7). `score` —
  // and ONLY `score` — is the sort key. An EXPLICIT tuple comparator, never
  // a bare single-field `.sort()` (divergence hazard 2 — Python's
  // `sorted()` on a `(-score, candidate_id)` tuple).
  scored.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score
    if (a.candidate_id < b.candidate_id) return -1
    if (a.candidate_id > b.candidate_id) return 1
    return 0
  })
  const topK = Number(paramGet(params, 'top_k'))
  const chosen = scored.slice(0, topK)

  const rankedCandidates: RankedCandidate[] = chosen.map((s, i) => ({
    rank: i + 1,
    candidate_id: s.candidate_id,
    score: s.score,
    rationale: buildRationale(s.contributions),
    supporting_feature_ids: s.supporting,
    opposing_feature_ids: s.opposing,
    uncertainty: null,
    feature_contributions: s.contributions,
    situation_fit: s.situation_fit,
    preference_fit: s.preference_fit,
    history_fit: s.history_fit,
    strongest_support: s.strongest_support,
    strongest_oppose: s.strongest_oppose,
    dominance,
  }))

  return {
    decision_type: 'ranked_candidates',
    ranked_candidates: rankedCandidates,
    excluded_candidates: excludedCandidates,
    unused_available_features: Array.from(unusedAvailableFeatures).sort(),
    missing_features: Array.from(missingFeatures).sort(),
    next_package_runtime_state: {},
    algorithm_provenance: {
      package_id: 'aica_transparent_service_selector_v1',
      contract_version: context.contract_version ?? null,
      schema_version: context.schema_version ?? null,
      purpose,
      lifecycle_stage: stage,
      extensions_on: confidenceShrinkageOn ? ['confidence_shrinkage_v1'] : [],
    },
    dominance,
    effective_weights: effectiveWeights,
    resolved_config_versions: resolvedConfigVersions,
  }
}
