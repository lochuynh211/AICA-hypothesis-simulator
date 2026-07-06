/**
 * aica_transparent_hybrid_trigger_v1 — TS port of the `python_module` package
 * `packages/aica_transparent_hybrid_trigger_v1/algorithm.py` (behavior-of-record,
 * 807 LoC, feature-009 signal-tier redesign). The headline M3/009 deliverable:
 * a faithful, STATEFUL transparent hybrid trigger whose full decision basis is
 * reviewable and whose runtime state (smoothed features, smoothed category
 * scores, persistence counters, state-machine labels, and env/monotony/
 * driving-time accumulators) evolves tick-to-tick.
 *
 * This is a TRUSTED builtin (bundled into the single-file offline app), NOT
 * the sandboxed-worker `js_module` path — see `../../../engine/algorithms/js_module.ts`
 * for that (untrusted user-uploaded) contract. Dispatched as strategy
 * `builtin_js_module` by `../../../engine/algorithms/adapter.ts`, which is
 * also responsible for applying the SAME required-context-field validation
 * and §11 `DecisionResult` normalization that
 * `app/api/aica_api/algorithms/python_module.py`'s `dispatch()` applies
 * around the package's `evaluate()` — mirroring the Python architecture and
 * the S9.3 `nri_fatigue_score_v1.ts` port exactly:
 *   python_module.dispatch()  (validate + build py_context + normalize)
 *     -> algorithm.py's evaluate(context)     (pure algorithm)
 *   adapter.ts's dispatchBuiltinJsModule()     (validate + normalize)
 *     -> aica_transparent_hybrid_trigger_v1.ts's evaluate(input)   (pure algorithm, HERE)
 *
 * `evaluate()` here is therefore the pure, deterministic, synchronous port
 * of algorithm.py's `evaluate(context: dict) -> dict` ONLY — it assumes the
 * input already has the feature-009 tiered `py_context` shape (
 * `simulation_time_sec`, `signals` ({fixed, dynamic, simulated}),
 * `feature_groups`, `parameters`, `hyperparameters`, `proposal_history`,
 * `user_action_history`, `package_runtime_state`, `recovery_active`). It
 * performs NO context validation itself (neither does algorithm.py —
 * python_module.dispatch validates BEFORE calling it).
 *
 * Pipeline (per tick, from `context` — see algorithm.py's module docstring /
 * `specs/009-signal-tier-redesign/contracts/tiered-context.md`):
 *   1. Accumulate `jam_min` / `hw_min` / `mono_min` (runtime state) while
 *      `signals.dynamic.motionState == "MOVING"`, using the elapsed minutes
 *      since the previous tick (`simulation_time_sec` delta; 0 on the very
 *      first tick).
 *   2. Feature extraction from `context.signals` (fixed/dynamic/simulated
 *      tiers) using the accumulators above; clamp 0-1. 9 features (no route
 *      look-ahead; 1 stochastic signal `anomaly_rate`; `driving_time` =
 *      banded time-on-task since last rest).
 *   3. Smoothing: smoothed_f[t] = alpha*f[t] + (1-alpha)*smoothed_f[t-1]
 *      (alpha=smoothing_alpha), prev from
 *      package_runtime_state.smoothed_features (empty on tick 0 -> prev 0).
 *   4. Category scores from the SMOOTHED features (base_safety_risk;
 *      rest_required_score = base + gated bonus iff base >=
 *      minimum_risk_for_rest_bonus, plus a child-passenger bonus;
 *      monotony_prevention_score).
 *   5. Velocity = score - prev smoothed score; persistence counters
 *      (rest/monotony consecutive over-threshold ticks; skip-if
 *      score/velocity bypasses persistence).
 *   6. State machines: REST_NORMAL->WATCH->SUGGEST->RECOMMEND->URGENT
 *      (->RECOVERY on an observed accept, scoped to `recovery_active`);
 *      MONOTONY_NORMAL->WATCH->CONTENT_SUGGEST.
 *   7. Fire-control, in order: no-candidate -> recovery -> persistence_gate
 *      -> emergency override -> cooldown (category-specific, using
 *      proposal_history.lastProposalTimeSec vs simulation_time_sec) ->
 *      30-min count limit (proposal_history.proposalCountLast30Min) -> pass.
 *   8. Strength gentle/clear/strong; priority [rest_required,
 *      monotony_prevention] then score.
 *   9. Localized proposal {ja,en} + explanation {ja,en} reason lines +
 *      reason_inputs.
 *
 * Returned dict: the normalized §11 DecisionResult shape PLUS next_package_runtime_state.
 * result_type is one of REST_PROPOSAL / MONOTONY_PROPOSAL / SUPPRESSED / NO_PROPOSAL (verbatim).
 * Non-fired / suppressed candidates are RETAINED in `candidates`.
 *
 * Every hyperparameter is read via a strict `hpNum`/`hpInt` accessor that
 * THROWS on a missing key — mirroring algorithm.py's direct `hp[key]`
 * indexing (NO `hp.get(key, <hardcoded default>)` fallback). The tiered
 * context's `hyperparameters` is guaranteed fully-resolved (manifest
 * defaults ⊕ overrides, every declared key present) by the run engine; a
 * missing key here is a real configuration bug and MUST surface as an error,
 * never a silently-wrong default.
 *
 * Every threshold/coefficient/ordering below is preserved EXACTLY from
 * algorithm.py — this is the parity boundary (see
 * `../../../engine/__fixtures__/parity/aica_transparent_hybrid_trigger_v1.json`,
 * captured from a full run of the real Python package via the app/api venv, and
 * `tests/hybrid_port.test.ts`, which replays it threading the evolving
 * `next_package_runtime_state` exactly as `run_manager.tick` does).
 *
 * Only the exported function identifier (`evaluate`) and local helper names
 * are camelCased; every DecisionResult key, ordinal/state/reason STRING
 * VALUE, and package_runtime_state key is preserved byte-for-byte because it
 * crosses the parity boundary.
 */

import type { Candidate, DecisionResult, FireControl, Proposal } from '../../../api/types'
import hybridManifestJson from '../aica_transparent_hybrid_trigger_v1.json'
import type { PackageManifest } from '../../../api/types'

/** Bundled package manifest — same JSON the offline app ships/loads. */
export const manifest = hybridManifestJson as unknown as PackageManifest

// ---------------------------------------------------------------------------
// Input shape — mirrors python_module.dispatch()'s feature-009 tiered
// `py_context` dict, which is exactly what algorithm.py's
// `evaluate(context)` receives. Same shape as `../index.ts`'s
// `BuiltinPyContext` (redeclared locally, as `nri_fatigue_score_v1.ts` does
// for its own input type, to avoid a circular import with `../index.ts`).
// ---------------------------------------------------------------------------

export type HybridEvaluateInput = {
  simulation_time_sec: number
  signals: Record<string, unknown>
  feature_groups: Record<string, unknown>
  parameters: Record<string, unknown>
  hyperparameters: Record<string, unknown>
  proposal_history: Record<string, unknown>
  user_action_history: unknown[]
  package_runtime_state: Record<string, unknown>
  recovery_active: boolean
}

/** The stateful accumulator carried in package_runtime_state across ticks. */
export type HybridRuntimeState = {
  smoothed_features: Record<string, number>
  smoothed_scores: { rest_required_score: number; monotony_prevention_score: number }
  persistence_counters: { rest_required: number; monotony_prevention: number }
  states: { rest_state: string; monotony_state: string }
  accumulators: { jam_min: number; hw_min: number; mono_min: number; drive_min_since_rest: number }
  drive_min_baseline: number
  accum_baseline: Record<string, number>
  prev_sim_time_sec: number
}

export type EvaluateOutput = DecisionResult

// ---------------------------------------------------------------------------
// Small helpers — dict.get()-with-default semantics + numeric coercion.
// ---------------------------------------------------------------------------

/** Mirrors Python's `dict.get(key, default)`: only the ABSENT key falls back. */
function dget(obj: Record<string, unknown> | undefined | null, key: string, dflt: unknown): unknown {
  if (obj && Object.prototype.hasOwnProperty.call(obj, key)) return obj[key]
  return dflt
}

/**
 * Mirrors algorithm.py's direct `hp[key]` indexing — NO hardcoded-default
 * fallback. A missing hyperparameter is a real configuration bug and MUST
 * surface as an error (Python: KeyError), never a silently-wrong default.
 */
function hpNum(hp: Record<string, unknown>, key: string): number {
  if (!Object.prototype.hasOwnProperty.call(hp, key)) {
    throw new Error(`KeyError: '${key}'`)
  }
  return Number(hp[key])
}

function hpInt(hp: Record<string, unknown>, key: string): number {
  return Math.trunc(hpNum(hp, key))
}

function clamp(value: number, lo = 0.0, hi = 1.0): number {
  return Math.max(lo, Math.min(hi, value))
}

// ---------------------------------------------------------------------------
// Feature-level scoring helpers
// ---------------------------------------------------------------------------

/** Banded rest-window urgency (Principle IV — boundary-binned, not raw minutes). */
function restWindowScore(nextRestMin: number): number {
  if (nextRestMin >= 9999.0) return 0.0
  if (nextRestMin <= 3.0) return 0.6
  if (nextRestMin <= 10.0) return 1.0
  if (nextRestMin <= 20.0) return 0.6
  return 0.2
}

/** clamp((nextRestSpotMin - 10) / 50) — data-model §5. */
function restScarcityScore(nextRestMin: number): number {
  return clamp((nextRestMin - 10.0) / 50.0)
}

/**
 * Banded time-on-task urgency (Principle IV — boundary-binned, not raw
 * minutes). Input is minutes driven SINCE the last rest (the Hybrid
 * rebaselines the monotonic `continuousDrivingMin` signal on recovery; see
 * `evaluate`).
 */
function drivingTimeScore(driveMinSinceRest: number): number {
  if (driveMinSinceRest < 60.0) return 0.0
  if (driveMinSinceRest < 120.0) return 0.4
  if (driveMinSinceRest < 180.0) return 0.7
  return 1.0
}

/** clamp(0.5*(isTrafficJam?1:clamp(jam_min/20)) + 0.3*clamp(hw_min/60) + 0.2*(weather/100)). */
function envLoadScore(isTrafficJam: boolean, jamMin: number, hwMin: number, weatherLevel: number): number {
  const jamTerm = isTrafficJam ? 1.0 : clamp(jamMin / 20.0)
  const hwTerm = clamp(hwMin / 60.0)
  const weatherTerm = clamp(weatherLevel / 100.0)
  return clamp(0.5 * jamTerm + 0.3 * hwTerm + 0.2 * weatherTerm)
}

/** clamp(0.6*clamp(mono_min/30) + 0.4*(isNight?1:0)). */
function monotonyScore(monoMin: number, isNight: boolean): number {
  const monoTerm = clamp(monoMin / 30.0)
  const nightTerm = isNight ? 1.0 : 0.0
  return clamp(0.6 * monoTerm + 0.4 * nightTerm)
}

// ---------------------------------------------------------------------------
// Runtime-state accumulators — jam_min / hw_min / mono_min (advance while MOVING)
// ---------------------------------------------------------------------------

// Segment types treated as "monotonous" for the accumulator — mirrors the
// sibling NRI package's convention over the same simulator segment vocabulary.
const MONOTONOUS_SEGMENT_TYPES = new Set(['highway', 'normal_road'])

/**
 * Advance jam_min/hw_min/mono_min while `motionState == MOVING`.
 *
 * Elapsed minutes since the previous tick are derived from the delta between
 * this tick's `simulation_time_sec` and the previous tick's (stored in
 * runtime state as `prev_sim_time_sec`). On the very first tick (no prior
 * state) the delta is 0 — there is no elapsed exposure to attribute yet.
 *
 * Returns the NEW accumulated totals, ready to thread into
 * `next_package_runtime_state`.
 */
function advanceAccumulators(
  dynamic: Record<string, unknown>,
  prevState: Record<string, unknown>,
  simTime: number,
): { jam_min: number; hw_min: number; mono_min: number } {
  const prevAccumulators = (dget(prevState, 'accumulators', {}) ?? {}) as Record<string, unknown>
  const prevJamMin = Number(dget(prevAccumulators, 'jam_min', 0.0))
  const prevHwMin = Number(dget(prevAccumulators, 'hw_min', 0.0))
  const prevMonoMin = Number(dget(prevAccumulators, 'mono_min', 0.0))

  const prevSimTimeSec = dget(prevState, 'prev_sim_time_sec', null)
  const tickDurationMin = prevSimTimeSec === null || prevSimTimeSec === undefined
    ? 0.0
    : Math.max(0.0, simTime - Number(prevSimTimeSec)) / 60.0

  const isMoving = dget(dynamic, 'motionState', undefined) === 'MOVING'
  const isTrafficJam = Boolean(dget(dynamic, 'isTrafficJam', false))
  const segmentType = String(dget(dynamic, 'segmentType', 'normal_road'))
  const isHighway = segmentType === 'highway'
  const isMonotonous = MONOTONOUS_SEGMENT_TYPES.has(segmentType)

  const advance = isMoving ? tickDurationMin : 0.0
  return {
    jam_min: prevJamMin + (isTrafficJam ? advance : 0.0),
    hw_min: prevHwMin + (isHighway ? advance : 0.0),
    mono_min: prevMonoMin + (isMonotonous ? advance : 0.0),
  }
}

// ---------------------------------------------------------------------------
// Feature extraction — pre-smoothing raw feature vector (0-1 each)
// ---------------------------------------------------------------------------

/**
 * The 9 compact features that feed the category scores (data-model §5). All
 * are clamped to [0, 1]. No route look-ahead; only 1 stochastic signal
 * (anomaly_rate).
 */
const FEATURE_KEYS = [
  'drowsiness',
  'fatigue',
  'driving_anomaly',
  'driving_time',
  'env_load',
  'monotony',
  'rest_window',
  'rest_scarcity',
  'familiar_route',
] as const

/**
 * Extract the pre-smoothing 0-1 feature vector from a tick's tiered signals.
 *
 * `accumulators` is this tick's advanced `{jam_min, hw_min, mono_min}` (see
 * `advanceAccumulators`), plus `drive_min_since_rest` (minutes driven since
 * the last rest, computed in `evaluate`).
 */
function extractFeatures(
  signals: Record<string, unknown>,
  accumulators: Record<string, unknown>,
  hp: Record<string, unknown>,
): Record<string, number> {
  const fixed = (dget(signals, 'fixed', {}) ?? {}) as Record<string, unknown>
  const dynamic = (dget(signals, 'dynamic', {}) ?? {}) as Record<string, unknown>
  const simulated = (dget(signals, 'simulated', {}) ?? {}) as Record<string, unknown>

  const drowsiness = clamp(Number(dget(simulated, 'drowsiness', 0.0)) / 100.0)
  const fatigue = clamp(Number(dget(simulated, 'fatigue', 0.0)) / 100.0)
  const anomalyRate = Number(dget(simulated, 'anomaly_rate', 0.0))
  const drivingAnomaly = clamp(anomalyRate / hpNum(hp, 'K'))
  const drivingTime = drivingTimeScore(Number(dget(accumulators, 'drive_min_since_rest', 0.0)))

  const isNight = Boolean(dget(fixed, 'isNight', false))
  const familiarRoute = Boolean(dget(fixed, 'familiarRoute', false))
  const weatherLevel = Number(dget(fixed, 'weatherRiskLevel', 0.0))

  const isTrafficJam = Boolean(dget(dynamic, 'isTrafficJam', false))
  const nextRestMin = Number(dget(dynamic, 'nextRestSpotMin', 9999.0))

  const envLoad = envLoadScore(
    isTrafficJam,
    Number(dget(accumulators, 'jam_min', 0.0)),
    Number(dget(accumulators, 'hw_min', 0.0)),
    weatherLevel,
  )
  const monotony = monotonyScore(Number(dget(accumulators, 'mono_min', 0.0)), isNight)

  return {
    drowsiness,
    fatigue,
    driving_anomaly: drivingAnomaly,
    driving_time: drivingTime,
    env_load: envLoad,
    monotony,
    rest_window: restWindowScore(nextRestMin),
    rest_scarcity: restScarcityScore(nextRestMin),
    familiar_route: familiarRoute ? 1.0 : 0.0,
  }
}

/** Exponentially smooth each feature: alpha*raw + (1-alpha)*prev (prev 0 if absent). */
function smoothFeatures(
  rawFeatures: Record<string, number>,
  prevSmoothed: Record<string, unknown>,
  alpha: number,
): Record<string, number> {
  const oneMinus = 1.0 - alpha
  const out: Record<string, number> = {}
  for (const key of FEATURE_KEYS) {
    out[key] = alpha * rawFeatures[key] + oneMinus * Number(dget(prevSmoothed, key, 0.0))
  }
  return out
}

// ---------------------------------------------------------------------------
// Category scores — computed from the SMOOTHED features
// ---------------------------------------------------------------------------

type CategoryScores = {
  base_safety_risk: number
  rest_required_score: number
  monotony_prevention_score: number
}

/**
 * Compute base_safety_risk, rest_required_score and monotony_prevention_score.
 *
 * `childPassenger` is the raw (unsmoothed) `fixed.childPassenger` flag; when
 * true it adds a fixed `w_child_bonus` to `rest_required_score` (only) — a
 * conservatism dial that makes AICA propose a rest sooner with a child
 * aboard. It is added AFTER the rest-spot bonus gate so it can never unlock
 * that gate on its own, and it is deliberately kept out of
 * `base_safety_risk` and monotony.
 */
function categoryScores(
  features: Record<string, number>,
  hp: Record<string, unknown>,
  childPassenger: boolean,
): CategoryScores {
  const baseSafetyRisk = clamp(
    hpNum(hp, 'w_drowsiness') * features['drowsiness']
    + hpNum(hp, 'w_fatigue') * features['fatigue']
    + hpNum(hp, 'w_driving_anomaly') * features['driving_anomaly']
    + hpNum(hp, 'w_driving_time') * features['driving_time']
    + hpNum(hp, 'w_env') * features['env_load'],
  )

  const restBonus = baseSafetyRisk >= hpNum(hp, 'minimum_risk_for_rest_bonus')
    ? hpNum(hp, 'w_rest_window') * features['rest_window'] + hpNum(hp, 'w_rest_scarcity') * features['rest_scarcity']
    : 0.0
  const childBonus = childPassenger ? hpNum(hp, 'w_child_bonus') : 0.0
  const restRequiredScore = clamp(baseSafetyRisk + restBonus + childBonus)

  const monotonyPreventionScore = clamp(
    hpNum(hp, 'w_monotony') * features['monotony']
    + hpNum(hp, 'w_env_mono') * features['env_load']
    + hpNum(hp, 'w_familiar') * features['familiar_route'],
  )

  return {
    base_safety_risk: baseSafetyRisk,
    rest_required_score: restRequiredScore,
    monotony_prevention_score: monotonyPreventionScore,
  }
}

// ---------------------------------------------------------------------------
// State machines
// ---------------------------------------------------------------------------

/** REST_NORMAL->WATCH->SUGGEST->RECOMMEND->URGENT (->RECOVERY on an accept). */
function restStateLabel(score: number, accepted: boolean, hp: Record<string, unknown>): string {
  if (accepted) return 'REST_RECOVERY'
  const watch = hpNum(hp, 'rest_watch_threshold')
  const suggest = hpNum(hp, 'threshold_suggest')
  const recommend = hpNum(hp, 'threshold_recommend')
  const urgent = hpNum(hp, 'threshold_urgent')
  if (score >= urgent) return 'REST_URGENT'
  if (score >= recommend) return 'REST_RECOMMEND'
  if (score >= suggest) return 'REST_SUGGEST'
  if (score >= watch) return 'REST_WATCH'
  return 'REST_NORMAL'
}

/** MONOTONY_NORMAL->WATCH->CONTENT_SUGGEST. */
function monotonyStateLabel(score: number, hp: Record<string, unknown>): string {
  const watch = hpNum(hp, 'monotony_watch_threshold')
  const suggest = hpNum(hp, 'monotony_suggest_threshold')
  if (score >= suggest) return 'MONOTONY_CONTENT_SUGGEST'
  if (score >= watch) return 'MONOTONY_WATCH'
  return 'MONOTONY_NORMAL'
}

// ---------------------------------------------------------------------------
// Strength
// ---------------------------------------------------------------------------

function strengthOf(score: number, suggest: number, recommend: number, urgent: number): string | null {
  if (score >= urgent) return 'strong'
  if (score >= recommend) return 'clear'
  if (score >= suggest) return 'gentle'
  return null
}

// ---------------------------------------------------------------------------
// Per-category candidate evaluation (persistence + fire-control)
// ---------------------------------------------------------------------------

type CandidateEvalArgs = {
  category: string
  score: number
  velocity: number
  prevCounter: number
  suggest: number
  recommend: number
  urgent: number
  persistenceRequired: number
  skipIfScore: number
  skipIfVelocity: number
  cooldownSec: number
  emergencyThreshold: number
  state: string
  simTime: number
  proposalHistory: Record<string, unknown>
  maxPer30min: number
  recovered: boolean
}

/**
 * Evaluate one trigger category; return (candidate, new_persistence_counter).
 *
 * Fire-control order: no-candidate -> recovery -> persistence_gate ->
 * emergency override -> cooldown -> 30-min count -> pass.
 */
function evaluateCandidate(args: CandidateEvalArgs): { candidate: Candidate; newCounter: number } {
  const {
    category, score, velocity, prevCounter, suggest, recommend, urgent,
    persistenceRequired, skipIfScore, skipIfVelocity, cooldownSec,
    emergencyThreshold, state, simTime, proposalHistory, maxPer30min, recovered,
  } = args

  const exists = score >= suggest
  const strengthLabel = exists ? strengthOf(score, suggest, recommend, urgent) : null

  // Persistence counter (consecutive over-threshold ticks).
  const newCounter = exists ? prevCounter + 1 : 0

  function cand(fired: boolean, suppressed: boolean, override: boolean, reason: string): Candidate {
    return {
      category,
      exists,
      score,
      state,
      strength: strengthLabel,
      fire_control: { fired, suppressed, override, reason },
    }
  }

  // 1) no candidate at all.
  if (!exists) {
    return { candidate: cand(false, false, false, 'below_suggest_threshold'), newCounter }
  }

  // Recovery: an accept was observed for this category — do not re-propose.
  if (recovered) {
    return { candidate: cand(false, true, false, 'recovery_after_accept'), newCounter }
  }

  // Persistence gate (skip-if bypass).
  const skipIf = score > skipIfScore || velocity > skipIfVelocity
  const persistenceOk = newCounter >= persistenceRequired || skipIf
  if (!persistenceOk) {
    return { candidate: cand(false, true, false, 'persistence_gate'), newCounter }
  }

  // 2) emergency override — fires regardless of cooldown / count limit.
  if (score >= emergencyThreshold) {
    return { candidate: cand(true, false, true, 'emergency_override'), newCounter }
  }

  // 3) cooldown (category-specific).
  const lastTime = dget(proposalHistory, 'lastProposalTimeSec', null)
  const lastCat = dget(proposalHistory, 'lastProposalCategory', null)
  if (
    lastTime !== null && lastTime !== undefined
    && lastCat === category
    && (simTime - Number(lastTime)) < cooldownSec
  ) {
    return { candidate: cand(false, true, false, 'cooldown_active'), newCounter }
  }

  // 4) 30-minute count limit.
  const count30 = Math.trunc(Number(dget(proposalHistory, 'proposalCountLast30Min', 0)))
  if (count30 >= maxPer30min) {
    return { candidate: cand(false, true, false, 'rate_limit_30min'), newCounter }
  }

  // 5) pass — fires.
  return { candidate: cand(true, false, false, 'threshold_passed_persisted'), newCounter }
}

// ---------------------------------------------------------------------------
// Priority
// ---------------------------------------------------------------------------

const PRIORITY: Record<string, number> = { rest_required: 1, monotony_prevention: 2 }

function selectCandidate(candidates: Candidate[]): Candidate | null {
  const fired = candidates.filter((c) => c.fire_control.fired)
  if (fired.length === 0) return null
  const sorted = [...fired].sort((a, b) => {
    const pa = PRIORITY[a.category] ?? 99
    const pb = PRIORITY[b.category] ?? 99
    if (pa !== pb) return pa - pb
    return b.score - a.score
  })
  return sorted[0]
}

// ---------------------------------------------------------------------------
// Localized proposals + explanations
// ---------------------------------------------------------------------------

const REST_PROPOSALS: Record<string, { ja: string; en: string }> = {
  gentle: {
    ja: '長時間の運転が続いています。近くの休憩施設でのご休憩をお勧めします。',
    en: 'You have been driving for a while. We suggest resting at a nearby facility.',
  },
  clear: {
    ja: '疲労のサインが続いています。早めの休憩をお勧めします。',
    en: 'Sustained fatigue signals detected. We recommend resting soon.',
  },
  strong: {
    ja: '安全のため、直ちに休憩を取ってください。',
    en: 'For your safety, please take a rest immediately.',
  },
}

const MONOTONY_PROPOSALS: Record<string, { ja: string; en: string }> = {
  gentle: {
    ja: '単調な走行が続いています。気分転換をお勧めします。',
    en: 'Monotonous driving detected. Consider a short break or refreshing content.',
  },
  clear: {
    ja: '注意力の低下が続いています。安全運転にご注意ください。',
    en: 'Sustained attention drop detected. Please drive with extra caution.',
  },
  strong: {
    ja: '注意力が著しく低下しています。休憩をお勧めします。',
    en: 'Significant attention drop. A rest is strongly recommended.',
  },
}

function buildProposal(selected: Candidate): Proposal {
  const strengthLabel = selected.strength ?? 'gentle'
  if (selected.category === 'rest_required') {
    const message = REST_PROPOSALS[strengthLabel] ?? REST_PROPOSALS['gentle']
    return { id: `${selected.category}_proposal`, message, options: ['accept_rest', 'postpone', 'decline'] }
  }
  const message = MONOTONY_PROPOSALS[strengthLabel] ?? MONOTONY_PROPOSALS['gentle']
  return { id: `${selected.category}_proposal`, message, options: ['acknowledge', 'decline'] }
}

function buildExplanation(
  selected: Candidate | null,
  scores: CategoryScores,
  states: { rest: string; monotony: string },
): { reasonInputs: string[]; explanation: Array<{ ja: string; en: string }> } {
  const base = scores.base_safety_risk
  const rest = scores.rest_required_score
  const mono = scores.monotony_prevention_score

  if (selected === null) {
    const reasonInputs = ['base_safety_risk', 'rest_required_score', 'monotony_prevention_score']
    const explanation = [
      {
        ja: `提案なし: 平滑化済み 安全リスク=${base.toFixed(3)}, 休憩必要度=${rest.toFixed(3)}, 単調性=${mono.toFixed(3)}。`,
        en: `No proposal: smoothed base_safety_risk=${base.toFixed(3)}, rest_required=${rest.toFixed(3)}, monotony=${mono.toFixed(3)}.`,
      },
    ]
    return { reasonInputs, explanation }
  }

  if (selected.category === 'rest_required') {
    const reasonInputs = [
      'drowsiness', 'fatigue', 'driving_anomaly', 'env_load',
      'base_safety_risk', 'rest_window', 'rest_scarcity', 'rest_required_score',
    ]
    const explanation = [
      {
        ja: `休憩必要度(平滑化)=${rest.toFixed(3)}（基礎リスク=${base.toFixed(3)}）が閾値を超え、持続条件を満たしました。状態=${states.rest}、強度=${selected.strength}。`,
        en: `Smoothed rest_required=${rest.toFixed(3)} (base=${base.toFixed(3)}) crossed the threshold and persisted. state=${states.rest}, strength=${selected.strength}.`,
      },
    ]
    return { reasonInputs, explanation }
  }

  const reasonInputs = ['monotony', 'env_load', 'familiar_route', 'monotony_prevention_score']
  const explanation = [
    {
      ja: `単調性抑止(平滑化)=${mono.toFixed(3)} が閾値を超え、持続条件を満たしました。状態=${states.monotony}、強度=${selected.strength}。`,
      en: `Smoothed monotony_prevention=${mono.toFixed(3)} crossed the threshold and persisted. state=${states.monotony}, strength=${selected.strength}.`,
    },
  ]
  return { reasonInputs, explanation }
}

// ---------------------------------------------------------------------------
// Public API — the algorithm.py evaluate() port.
// ---------------------------------------------------------------------------

/**
 * Evaluate the transparent hybrid trigger for one tick.
 *
 * Pure & deterministic: no Date.now, no Math.random, no I/O. Given the same
 * `input` (including the SAME `package_runtime_state`), always returns the
 * same `DecisionResult` (with the SAME `next_package_runtime_state`).
 */
export function evaluate(input: HybridEvaluateInput): EvaluateOutput {
  const hp = input.hyperparameters ?? {}
  const signals = (input.signals ?? {}) as Record<string, unknown>
  const dynamic = (dget(signals, 'dynamic', {}) ?? {}) as Record<string, unknown>
  const featureGroups = (input.feature_groups ?? {}) as Record<string, unknown>
  const ordinal = (dget(featureGroups, 'ordinal', {}) ?? {}) as Record<string, unknown>
  const prevState = (input.package_runtime_state ?? {}) as Record<string, unknown>
  const proposalHistory = input.proposal_history ?? {}
  const simTime = Number(input.simulation_time_sec ?? 0.0)

  const alpha = hpNum(hp, 'smoothing_alpha')
  const suggest = hpNum(hp, 'threshold_suggest')
  const recommend = hpNum(hp, 'threshold_recommend')
  const urgent = hpNum(hp, 'threshold_urgent')
  const monoSuggest = hpNum(hp, 'monotony_suggest_threshold')
  const monoRecommend = hpNum(hp, 'monotony_recommend_threshold')
  const monoUrgent = hpNum(hp, 'monotony_urgent_threshold')
  const restPersistence = hpInt(hp, 'rest_persistence_ticks')
  const monoPersistence = hpInt(hp, 'monotony_persistence_ticks')
  const skipIfScore = hpNum(hp, 'skip_if_score')
  const skipIfVelocity = hpNum(hp, 'skip_if_velocity')
  const restCooldown = hpNum(hp, 'rest_cooldown_sec')
  const monoCooldown = hpNum(hp, 'monotony_cooldown_sec')
  const emergencyThreshold = hpNum(hp, 'emergency_override_threshold')
  const maxPer30min = hpInt(hp, 'max_proposals_per_30min')

  const recoveryActive = Boolean(input.recovery_active ?? false)
  const childPassenger = Boolean(dget((dget(signals, 'fixed', {}) ?? {}) as Record<string, unknown>, 'childPassenger', false))

  // ── 1. advance the env/monotony accumulators (MOVING-gated) ────────────
  const accumulators = advanceAccumulators(dynamic, prevState, simTime) as unknown as Record<string, number>

  // ── 1b. time-on-task since the last rest ───────────────────────────────
  // `continuousDrivingMin` is monotonic (the engine never resets it), so the
  // Hybrid keeps its own baseline: while the driver is resting we rebaseline
  // it to the current value, making `drive_min_since_rest` drop to ~0 right
  // after a rest. Threaded forward as `drive_min_baseline`.
  const continuousDrivingMin = Number(dget(dynamic, 'continuousDrivingMin', 0.0))
  const driveMinBaseline = recoveryActive
    ? continuousDrivingMin
    : Number(dget(prevState, 'drive_min_baseline', 0.0))
  const driveMinSinceRest = Math.max(0.0, continuousDrivingMin - driveMinBaseline)
  accumulators.drive_min_since_rest = driveMinSinceRest

  // ── 1c. rebaseline env/monotony exposure on rest ───────────────────────
  // The jam/highway/monotony accumulators (feeding env_load + monotony) are
  // measured SINCE THE LAST REST, exactly like drive_min_since_rest: while
  // the driver is resting we rebaseline them to the current cumulative
  // totals, so a rest drops env_load AND monotony to ~0 and they rebuild
  // afterwards. The cumulative `accumulators` are still threaded forward
  // unchanged so advanceAccumulators keeps the running totals —
  // `accum_baseline` is separate.
  const accumBaseline: Record<string, number> = recoveryActive
    ? { jam_min: accumulators.jam_min, hw_min: accumulators.hw_min, mono_min: accumulators.mono_min }
    : ((dget(prevState, 'accum_baseline', {}) ?? {}) as Record<string, number>)
  const sinceRestAccumulators: Record<string, number> = {
    jam_min: Math.max(0.0, accumulators.jam_min - Number(dget(accumBaseline, 'jam_min', 0.0))),
    hw_min: Math.max(0.0, accumulators.hw_min - Number(dget(accumBaseline, 'hw_min', 0.0))),
    mono_min: Math.max(0.0, accumulators.mono_min - Number(dget(accumBaseline, 'mono_min', 0.0))),
    drive_min_since_rest: driveMinSinceRest,
  }

  // ── 2-3. extract + smooth features (from the since-rest exposures) ──────
  const rawFeatures = extractFeatures(signals, sinceRestAccumulators, hp)
  const prevSmoothedFeatures = (dget(prevState, 'smoothed_features', {}) ?? {}) as Record<string, unknown>
  const smoothedFeatures = smoothFeatures(rawFeatures, prevSmoothedFeatures, alpha)

  // ── 4. category scores from the smoothed features ──────────────────────
  const scores = categoryScores(smoothedFeatures, hp, childPassenger)
  const restScore = scores.rest_required_score
  const monoScore = scores.monotony_prevention_score

  // ── 5. velocity vs prev smoothed scores ────────────────────────────────
  const prevScores = (dget(prevState, 'smoothed_scores', {}) ?? {}) as Record<string, unknown>
  const restVelocity = restScore - Number(dget(prevScores, 'rest_required_score', 0.0))
  const monoVelocity = monoScore - Number(dget(prevScores, 'monotony_prevention_score', 0.0))

  const prevCounters = (dget(prevState, 'persistence_counters', {}) ?? {}) as Record<string, unknown>
  const prevRestCounter = Math.trunc(Number(dget(prevCounters, 'rest_required', 0)))
  const prevMonoCounter = Math.trunc(Number(dget(prevCounters, 'monotony_prevention', 0)))

  // Recovery: an accept seen for this category (only rest is acceptable
  // here). Scoped to the active rest sequence: recovery_active is true only
  // while the driver is currently resting. Once the driver resumes,
  // recovery_active is false and we leave REST_RECOVERY so a fresh proposal
  // can fire when drowsiness rebuilds — without this gate rest_recovered
  // would latch forever (lastProposalResult stays "accept_rest" because no
  // later rest proposal is ever allowed to fire).
  const lastResult = dget(proposalHistory, 'lastProposalResult', null)
  const lastCat = dget(proposalHistory, 'lastProposalCategory', null)
  const restRecovered = (
    recoveryActive
    && lastResult === 'accept_rest'
    && (lastCat === null || lastCat === undefined || lastCat === 'rest_required')
  )

  // ── 6. state-machine labels (recorded output) ───────────────────────────
  const states = {
    rest: restStateLabel(restScore, restRecovered, hp),
    monotony: monotonyStateLabel(monoScore, hp),
  }

  // ── 7. candidates with persistence + fire-control ───────────────────────
  const { candidate: restCand, newCounter: newRestCounter } = evaluateCandidate({
    category: 'rest_required',
    score: restScore,
    velocity: restVelocity,
    prevCounter: prevRestCounter,
    suggest,
    recommend,
    urgent,
    persistenceRequired: restPersistence,
    skipIfScore,
    skipIfVelocity,
    cooldownSec: restCooldown,
    emergencyThreshold,
    state: states.rest,
    simTime,
    proposalHistory,
    maxPer30min,
    recovered: restRecovered,
  })
  const { candidate: monoCand, newCounter: newMonoCounter } = evaluateCandidate({
    category: 'monotony_prevention',
    score: monoScore,
    velocity: monoVelocity,
    prevCounter: prevMonoCounter,
    suggest: monoSuggest,
    recommend: monoRecommend,
    urgent: monoUrgent,
    persistenceRequired: monoPersistence,
    skipIfScore,
    skipIfVelocity,
    cooldownSec: monoCooldown,
    emergencyThreshold,
    state: states.monotony,
    simTime,
    proposalHistory,
    maxPer30min,
    recovered: false,
  })
  const candidates: Candidate[] = [restCand, monoCand]

  // ── priority selection ────────────────────────────────────────────────
  const selected = selectCandidate(candidates)

  // ── result_type (verbatim hybrid categories) ──────────────────────────
  let resultType: string
  if (selected !== null) {
    resultType = selected.category === 'rest_required' ? 'REST_PROPOSAL' : 'MONOTONY_PROPOSAL'
  } else if (candidates.some((c) => c.fire_control.suppressed)) {
    resultType = 'SUPPRESSED'
  } else {
    resultType = 'NO_PROPOSAL'
  }

  // ── overall fire_control mirrors the selected / first-suppressed candidate ─
  let overallFc: FireControl
  if (selected !== null) {
    overallFc = {
      fired: true,
      suppressed: false,
      override: selected.fire_control.override,
      reason: selected.fire_control.reason,
    }
  } else {
    const suppressed = candidates.find((c) => c.fire_control.suppressed) ?? null
    if (suppressed !== null) {
      overallFc = {
        fired: false,
        suppressed: true,
        override: false,
        reason: suppressed.fire_control.reason,
      }
    } else {
      overallFc = {
        fired: false,
        suppressed: false,
        override: false,
        reason: 'no_candidate_above_threshold',
      }
    }
  }

  // ── 8. proposal + explanation ──────────────────────────────────────────
  const proposal = selected !== null ? buildProposal(selected) : null
  const { reasonInputs, explanation } = buildExplanation(selected, scores, states)

  // ── next runtime state (the recorded, threaded-forward output) ─────────
  const nextRuntimeState: HybridRuntimeState = {
    smoothed_features: smoothedFeatures,
    smoothed_scores: {
      rest_required_score: restScore,
      monotony_prevention_score: monoScore,
    },
    persistence_counters: {
      rest_required: newRestCounter,
      monotony_prevention: newMonoCounter,
    },
    states: {
      rest_state: states.rest,
      monotony_state: states.monotony,
    },
    accumulators: accumulators as unknown as HybridRuntimeState['accumulators'],
    drive_min_baseline: driveMinBaseline,
    accum_baseline: accumBaseline,
    prev_sim_time_sec: simTime,
  }

  // features field is dict[str, str]: the transparent ordinal view of the tick.
  const featuresOrdinal: Record<string, string> = {}
  for (const [k, v] of Object.entries(ordinal)) {
    featuresOrdinal[k] = String(v)
  }

  return {
    result_type: resultType,
    trigger_candidate: selected !== null,
    selected_category: selected !== null ? selected.category : null,
    score: selected !== null ? selected.score : null,
    features: featuresOrdinal,
    scores: {
      base_safety_risk: scores.base_safety_risk,
      rest_required_score: restScore,
      monotony_prevention_score: monoScore,
      rest_velocity: restVelocity,
      monotony_velocity: monoVelocity,
    },
    states,
    criteria: {
      smoothing_alpha: alpha,
      threshold_suggest: suggest,
      threshold_recommend: recommend,
      threshold_urgent: urgent,
      rest_persistence_ticks: restPersistence,
      monotony_persistence_ticks: monoPersistence,
      monotony_suggest_threshold: monoSuggest,
    },
    candidates,
    fire_control: overallFc,
    proposal,
    reason_inputs: reasonInputs,
    // DecisionResult['explanation'] is typed as plain `string` in the synced
    // `../../../api/types.ts` (an M1-era narrowing never widened for M2/M3
    // hybrid explanations) — out of scope to edit (synced file). algorithm.py
    // returns a list[LocalizedText] here (matching the Python model's actual
    // `ExplanationType = str | LocalizedText | list[...]`), and downstream
    // consumers (e.g. DecisionTracePanel.tsx) already tolerate a non-string
    // value at runtime (`typeof dr.explanation === 'string' ? ... : ...`) —
    // same known, accepted compromise as `nri_fatigue_score_v1.ts`.
    explanation: explanation as unknown as string,
    next_package_runtime_state: nextRuntimeState as unknown as Record<string, unknown>,
  }
}
