/**
 * nri_fatigue_score_v1 — TS port of the `python_module` package
 * `packages/nri_fatigue_score_v1/algorithm.py` (behavior-of-record, 721 LoC,
 * NRI proposal 20260630 + feature 025's two-band redesign).
 *
 * This is a TRUSTED builtin (bundled into the single-file offline app), NOT
 * the sandboxed-worker `js_module` path — see `../../../engine/algorithms/js_module.ts`
 * for that (untrusted user-uploaded) contract. Dispatched as strategy
 * `builtin_js_module` by `../../../engine/algorithms/adapter.ts`, which is
 * also responsible for applying the SAME required-context-field validation
 * and §11 `DecisionResult` normalization that
 * `app/api/aica_api/algorithms/python_module.py`'s `dispatch()` applies
 * around the package's `evaluate()` — mirroring the Python architecture:
 *   python_module.dispatch()  (validate + build py_context + normalize)
 *     -> algorithm.py's evaluate(context)     (pure algorithm)
 *   adapter.ts's dispatchBuiltinJsModule()     (validate + normalize)
 *     -> nri_fatigue_score_v1.ts's evaluate(input)   (pure algorithm, HERE)
 *
 * `evaluate()` here is therefore the pure, deterministic, synchronous port
 * of algorithm.py's `evaluate(context: dict) -> dict` ONLY — it assumes the
 * input already has the shape `python_module.dispatch()` builds as
 * `py_context`. Feature 009 (signal-tier redesign) reads from the TIERED
 * `context["signals"]` contract (`specs/009-signal-tier-redesign/contracts/
 * tiered-context.md`) instead of a flat `raw_state`:
 *   - Tier 1 (fixed, scenario constants): `isNight`, `familiarRoute`, `childPassenger`.
 *   - Tier 2 (dynamic): `isTrafficJam`, `segmentType`, `motionState`,
 *     `nextRestSpotMin`, `recoveryPhase`.
 *   - Tier 3a (simulated, latent): `drowsiness`, `fatigue` — feed `S_realtime`
 *     as RAW 0-100 values (NOT divided by 100 — that's the Hybrid package's
 *     convention, not NRI's).
 * It performs NO context validation itself (neither does algorithm.py —
 * python_module.dispatch validates BEFORE calling it).
 *
 * Implements the NRI proposal (20260630) cumulative fatigue accumulation
 * score:
 *
 *   S_total(t) = S_base(t) + S_env(t) + S_realtime(t)
 *
 * Where:
 *   S_base     = child_offset + T_drive * W_base * M_night * M_familiar
 *   S_env      = T_jam * W_jam + T_hw * W_highway + T_mono * W_monotonous
 *   S_realtime = max(0, V_sleep - theta_sleep) * W_sleep
 *              + max(0, V_fatigue - theta_fatigue) * W_fatigue
 *
 * Fire condition — TWO thresholds banding the ONE score (feature 025):
 *
 *     S_total >= threshold_fire                       -> rest_required
 *     threshold_monotony <= S_total < threshold_fire  -> monotony_prevention
 *     S_total <  threshold_monotony                   -> nothing
 *
 * `threshold_monotony` is the LOWER of the pair, so a run reaches the monotony
 * band before the rest band and escalates into it. Only ONE score exists, so
 * the package publishes a monotony THRESHOLD but no `monotony_prevention_score`
 * — a second curve would be an exact duplicate of the first.
 *
 * Post-fire filter: next rest spot ETA <= rest_spot_eta_filter_min (or no spot
 * ahead) — applied to the REST band ONLY, since refreshing content needs no
 * place to stop. Recovery suppresses both bands. There is still NO
 * suggest/recommend/urgent ladder, persistence gate, cooldown, 30-min cap, or
 * emergency override — this adds a band, not a ladder.
 *
 * `evaluate()` returns TWO categories every tick — `rest_required` and
 * `monotony_prevention` — both RETAINED in `candidates` whether fired or not
 * (§11), plus a `feature_contributions` block for EACH category (see
 * `buildFeatureContributions` below): an exact additive decomposition of
 * `s_total`, mirroring `aica_transparent_hybrid_trigger_v1.category_scores()`'s
 * `feature_contributions` shape so the review panel's `triggerOptions()`
 * (`app/frontend/src/lib/review/chains.ts`) can render either package.
 *
 * State carried across ticks (via package_runtime_state):
 *   - cumulative_jam_min: minutes spent in traffic jam
 *   - cumulative_highway_min: minutes spent on highway
 *   - cumulative_monotonous_min: minutes spent on monotonous road
 *   - driving_min_since_rest: minutes driven since the last rest (FROZEN —
 *     not accrued — for the entire recoveryActive window, then reset to 0
 *     at the recoveryJustCompleted resume edge)
 *   - last_sim_time: the previous tick's simulation_time_sec (tick-duration source)
 *   - was_in_recovery: whether the previous tick was a recovery tick (reset edge)
 *   - mono_intervention_handled_sec: sim_time of the last monotony_prevention
 *     proposal whose ANSWER (acknowledge OR decline) already relieved
 *     cumulative_monotonous_min, so the same served proposal does not re-zero
 *     it every tick (mirrors aica_transparent_hybrid_trigger_v1's mono_min
 *     rebaseline)
 *
 * Bugfix (2026-08-04): cumulative_monotonous_min is now RELIEVED (reset to 0)
 * when its own monotony_prevention proposal is ANSWERED — acknowledge OR
 * decline, any non-null `lastProposalResult` — mirroring
 * aica_transparent_hybrid_trigger_v1's `mono_min` rebaseline. Before this fix
 * the monotony accumulator never fell once it entered the band, so the score
 * stayed pinned above `threshold_monotony` and could re-fire every tick for
 * the rest of the run. Only the monotony accumulator is relieved; jam/
 * highway/driving accumulators are untouched. See
 * `mono_intervention_handled_sec` above for the once-per-intervention guard.
 *
 * Bugfix (2026-08-04): the four cumulative accumulators
 * (`cumulative_jam_min`, `cumulative_highway_min`, `cumulative_monotonous_min`,
 * `driving_min_since_rest`) are now FROZEN — held at their pre-accept value,
 * neither growing nor zeroing — for the ENTIRE `recoveryActive` window
 * (accept tick, drive-to-spot, dwell), then reset to 0 only at the
 * `recoveryJustCompleted` (resume) edge. Before this fix `motionState` is
 * still "MOVING" during the drive-to-spot, so the accumulators kept growing
 * and sTotal kept rising throughout the approach.
 *
 * This deliberately does NOT mirror aica_transparent_hybrid_trigger_v1's
 * continuous rebaseline. Hybrid's rest/safety score is CLAMPED to [0,1] and
 * dominated by drowsiness/fatigue/anomaly (weight 0.75, vs 0.25 for
 * exposure), so zeroing its exposure accumulator every tick barely moves the
 * (already saturated) clamped score — it stays flat-high through the whole
 * recovery window. NRI's `sTotal` is UNBOUNDED and dominated by the
 * accumulated-exposure terms `sBase`/`sEnv` (sRealtime/drowsiness/fatigue is
 * the minority term), so zeroing the accumulators at accept-time would
 * collapse the score to near-zero immediately — the wrong behavior.
 * Freezing (not zeroing) keeps sTotal flat-high through the whole recovery
 * window, matching Hybrid's observable OUTCOME (flat-high until resume) via
 * a different mechanism suited to NRI's unclamped, exposure-dominated
 * shape. The score only drops at resume, when the accumulators reset to 0
 * and start re-accumulating from scratch.
 *
 * Every hyperparameter is read via a STRICT `reqNum(hp, key)` lookup — NO
 * `hp.get(key, <hardcoded default>)` fallback, mirroring algorithm.py's
 * direct `hp["key"]` dict indexing exactly (including the NEW
 * `threshold_monotony` key): `context["hyperparameters"]` is guaranteed fully
 * resolved (manifest defaults (+) overrides, every declared key present) by
 * the adapter (FR-009); a missing key here is a real configuration bug and
 * MUST surface as an error -> algorithm_error, never a silently-wrong default.
 *
 * Every threshold/coefficient/ordering below is preserved EXACTLY from
 * algorithm.py — this is the parity boundary (see
 * `../../../engine/__fixtures__/parity/nri_fatigue_score_v1.json` and
 * `nri_tick_by_tick.json`, both captured from a full run of the real Python
 * package, and `tests/nri_port.test.ts`, which replays the first threading
 * the evolving `next_package_runtime_state` exactly as `run_manager.tick`
 * does).
 *
 * Divergence hazards checked against algorithm.py (721 LoC) while porting:
 *   - Python `round()`: NOT used anywhere in algorithm.py (only f-string
 *     `:.0f` / `:.1f` format specs in the explanation/band strings below,
 *     ported with `pyFixed()` (see `./mathUtils` — NOT `.toFixed(...)`, which
 *     rounds ties away from zero instead of half-to-even; divergence hazard
 *     7), verified byte-for-byte against the goldens).
 *   - `sorted()` on tuples: not used — no sorting anywhere in this package.
 *   - `//` / `%` floor semantics: not used — no integer division/modulo.
 *   - Dict iteration order feeding ordered output: the `_rows()` / `rows()`
 *     list order below is preserved EXACTLY (9 rows, fixed order); the two
 *     `feature_contributions` blocks get INDEPENDENT row arrays (mirroring
 *     algorithm.py's comment that `_rows()` is called twice so a caller
 *     mutating one block's `row.band` can never alias the other's).
 *   - Float -> string formatting: the explanation/band template strings are
 *     verified against the captured golden JSON (parsed, not text-diffed).
 *
 * Only the exported function identifier (`evaluate`) and local helper names
 * are camelCased; every DecisionResult key, ordinal/state/reason STRING
 * VALUE, and package_runtime_state key is preserved byte-for-byte because it
 * crosses the parity boundary.
 */

import type { Candidate, DecisionResult, FireControl, Proposal } from '../../../api/types'
import type { PackageManifest } from '../../../api/types'
import { getPackageManifest } from '../../registry'
import { pyFixed } from './mathUtils'

/**
 * Bundled package manifest — read from the generated data payload (not a
 * hand-copied JSON import; this file is SOURCE, the manifest is DATA). A
 * function, not a const: the registry is installed during boot, after this
 * module evaluates. Unused within this file (see the doc comment above on
 * why `hyperparameters` is trusted as fully-resolved) — kept as a
 * convenience export mirroring `manifest.algorithm.entrypoint`-style
 * lookups elsewhere.
 */
export function manifest(): PackageManifest {
  const m = getPackageManifest('nri_fatigue_score_v1')
  if (!m) throw new Error("nri_fatigue_score_v1: manifest not found in the registry")
  return m
}

// ---------------------------------------------------------------------------
// Input shape — mirrors python_module.dispatch()'s tiered `py_context` dict
// (feature 009), which is exactly what algorithm.py's `evaluate(context)`
// receives. Same shape as `../index.ts`'s `BuiltinPyContext`.
// ---------------------------------------------------------------------------

export type NriEvaluateInput = {
  simulation_time_sec: number
  signals: Record<string, unknown>
  feature_groups: Record<string, unknown>
  parameters: Record<string, unknown>
  hyperparameters: Record<string, unknown>
  proposal_history: Record<string, unknown>
  user_action_history: unknown[]
  package_runtime_state: Record<string, unknown>
  recovery_active?: boolean
}

/** The stateful accumulator carried in package_runtime_state across ticks. */
export type NriRuntimeState = {
  cumulative_jam_min: number
  cumulative_highway_min: number
  cumulative_monotonous_min: number
  driving_min_since_rest: number
  last_sim_time: number
  was_in_recovery: boolean
  mono_intervention_handled_sec: number | null
}

export type EvaluateOutput = DecisionResult

// ---------------------------------------------------------------------------
// feature_contributions shapes — see `_build_feature_contributions` in
// algorithm.py. Not part of the shared (synced) `DecisionResult` type in
// `../../../api/types.ts` (out of scope to edit — same known compromise as
// the `explanation` cast below), so `evaluate()` returns an object that is
// STRUCTURALLY wider than `DecisionResult` and relies on TypeScript not
// excess-property-checking a variable (as opposed to a literal) on return.
// ---------------------------------------------------------------------------

type ContributionRow = {
  feature_id: string
  value: number
  band: string | null
  weight: number
  contribution: number
}

type Gate = {
  gate_id: string
  evaluated_inputs: Record<string, unknown>
  threshold: number
  passed: boolean
  effect: 'allow' | 'suppress'
}

type FeatureContributionBlock = {
  score: number
  clamped: boolean
  rows: ContributionRow[]
  gates: Gate[]
}

type FeatureContributions = {
  rest_required: FeatureContributionBlock
  monotony_prevention: FeatureContributionBlock
}

// ---------------------------------------------------------------------------
// Small helpers — dict.get()-with-default semantics + strict hp indexing.
// ---------------------------------------------------------------------------

/** Mirrors Python's `dict.get(key, default)`: only the ABSENT key falls back. */
function dget(obj: Record<string, unknown> | undefined | null, key: string, dflt: unknown): unknown {
  if (obj && Object.prototype.hasOwnProperty.call(obj, key)) return obj[key]
  return dflt
}

/**
 * Mirrors Python's direct `hp["key"]` indexing (no `.get` default): raises
 * if the key is absent, since a missing declared hyperparameter is a real
 * configuration bug that must surface as `algorithm_error`, never silently
 * fall back to a hardcoded default.
 */
function reqNum(hp: Record<string, unknown>, key: string): number {
  if (!hp || !Object.prototype.hasOwnProperty.call(hp, key)) {
    throw new Error(`nri_fatigue_score_v1: missing required hyperparameter '${key}'`)
  }
  return Number(hp[key])
}

// ---------------------------------------------------------------------------
// Score computation
// ---------------------------------------------------------------------------

function computeBaseScore(
  continuousDrivingMin: number,
  childPassenger: boolean,
  isNight: boolean,
  familiarRoute: boolean,
  hp: Record<string, unknown>,
): number {
  const wBase = reqNum(hp, 'w_base')
  const wChild = reqNum(hp, 'w_child')
  const mNight = isNight ? reqNum(hp, 'm_night') : 1.0
  const mFamiliar = familiarRoute ? reqNum(hp, 'm_familiar') : 1.0

  const childOffset = childPassenger ? wChild : 0.0
  const timeDamage = continuousDrivingMin * wBase * mNight * mFamiliar

  return childOffset + timeDamage
}

function computeEnvScore(
  cumulativeJamMin: number,
  cumulativeHighwayMin: number,
  cumulativeMonotonousMin: number,
  hp: Record<string, unknown>,
): number {
  const wJam = reqNum(hp, 'w_jam')
  const wHighway = reqNum(hp, 'w_highway')
  const wMonotonous = reqNum(hp, 'w_monotonous')

  return (
    cumulativeJamMin * wJam
    + cumulativeHighwayMin * wHighway
    + cumulativeMonotonousMin * wMonotonous
  )
}

function computeRealtimeScore(
  drowsinessLevel: number,
  fatigueLevel: number,
  hp: Record<string, unknown>,
): number {
  const thetaSleep = reqNum(hp, 'theta_sleep')
  const wSleep = reqNum(hp, 'w_sleep')
  const thetaFatigue = reqNum(hp, 'theta_fatigue')
  const wFatigue = reqNum(hp, 'w_fatigue')

  const sleepPenalty = Math.max(0.0, drowsinessLevel - thetaSleep) * wSleep
  const fatiguePenalty = Math.max(0.0, fatigueLevel - thetaFatigue) * wFatigue

  return sleepPenalty + fatiguePenalty
}

// ---------------------------------------------------------------------------
// Feature contributions — EXACT additive decomposition of s_total
// ---------------------------------------------------------------------------
//
// NRI is a pure additive sum (S_total = S_base + S_env + S_realtime, each of
// those itself a sum of terms — see the module docstring), so unlike the
// Hybrid's clamped/smoothed score this decomposition is not an approximation:
// the rows below sum to s_total exactly (mod float summation order). Shape
// mirrors `aica_transparent_hybrid_trigger_v1.category_scores()`'s
// `feature_contributions` block so the review panel's `triggerOptions()`
// (app/frontend/src/lib/review/chains.ts) can render either package.

type BuildFeatureContributionsArgs = {
  drivingMinSinceRest: number
  isNight: boolean
  familiarRoute: boolean
  childPassenger: boolean
  cumulativeJamMin: number
  cumulativeHighwayMin: number
  cumulativeMonotonousMin: number
  drowsinessLevel: number
  fatigueLevel: number
  sTotal: number
  recovered: boolean
  nextRestMin: number
  restEtaFilter: number
  thresholdFire: number
  hp: Record<string, unknown>
}

/**
 * Build the `feature_contributions` block for both trigger categories.
 *
 * The S_base time-damage term `T * w_base * m_night * m_familiar` (T =
 * driving_min_since_rest) is split into THREE additive rows instead of one
 * opaque "driving time" row, so a reviewer can see the night/familiar-route
 * AMPLIFICATION separately from the raw accumulated minutes:
 *
 *     continuous_driving_min        = T * w_base
 *     night_amplification           = T * w_base * (m_night - 1)
 *     familiar_route_amplification  = T * w_base * m_night * (m_familiar - 1)
 *
 * Each amplification row reports the MULTIPLIER as its `value` (1.0 when the
 * corresponding flag is off), so `contribution` is exactly 0.0 — not merely
 * small — whenever that amplifier is inactive.
 *
 * `rest_required` and `monotony_prevention` get the SAME rows and the SAME
 * score: NRI publishes one score banded by two thresholds (see the module
 * docstring), so a second, differently-weighted decomposition would
 * misrepresent the model as having two independent curves. The two blocks
 * hold independent row-array/objects (not shared references) purely so a
 * caller mutating one (e.g. filling in `band`) can never accidentally alter
 * the other — `buildRows()` is called TWICE below, once per block.
 */
function buildFeatureContributions(args: BuildFeatureContributionsArgs): FeatureContributions {
  const {
    drivingMinSinceRest, isNight, familiarRoute, childPassenger,
    cumulativeJamMin, cumulativeHighwayMin, cumulativeMonotonousMin,
    drowsinessLevel, fatigueLevel, sTotal, recovered, nextRestMin,
    restEtaFilter, thresholdFire, hp,
  } = args

  const wBase = reqNum(hp, 'w_base')
  const wChild = reqNum(hp, 'w_child')
  const wJam = reqNum(hp, 'w_jam')
  const wHighway = reqNum(hp, 'w_highway')
  const wMonotonous = reqNum(hp, 'w_monotonous')
  const wSleep = reqNum(hp, 'w_sleep')
  const wFatigue = reqNum(hp, 'w_fatigue')
  const thetaSleep = reqNum(hp, 'theta_sleep')
  const thetaFatigue = reqNum(hp, 'theta_fatigue')

  const mNight = isNight ? reqNum(hp, 'm_night') : 1.0
  const mFamiliar = familiarRoute ? reqNum(hp, 'm_familiar') : 1.0
  const tDrive = drivingMinSinceRest

  function row(featureId: string, value: number, weight: number, contribution: number): ContributionRow {
    return {
      feature_id: featureId,
      value,
      band: null, // filled in by evaluate() from features_ordinal
      weight,
      contribution,
    }
  }

  function buildRows(): ContributionRow[] {
    return [
      row('continuous_driving_min', tDrive, wBase, tDrive * wBase),
      row(
        'night_amplification', mNight, wBase,
        tDrive * wBase * (mNight - 1.0),
      ),
      row(
        'familiar_route_amplification', mFamiliar, wBase,
        tDrive * wBase * mNight * (mFamiliar - 1.0),
      ),
      row(
        'child_passenger', childPassenger ? 1.0 : 0.0, wChild,
        childPassenger ? wChild : 0.0,
      ),
      row('traffic_jam', cumulativeJamMin, wJam, cumulativeJamMin * wJam),
      row(
        'long_highway', cumulativeHighwayMin, wHighway,
        cumulativeHighwayMin * wHighway,
      ),
      row(
        'monotony', cumulativeMonotonousMin, wMonotonous,
        cumulativeMonotonousMin * wMonotonous,
      ),
      row(
        'drowsiness', drowsinessLevel, wSleep,
        Math.max(0.0, drowsinessLevel - thetaSleep) * wSleep,
      ),
      row(
        'fatigue', fatigueLevel, wFatigue,
        Math.max(0.0, fatigueLevel - thetaFatigue) * wFatigue,
      ),
    ]
  }

  const gateRecovery: Gate = {
    gate_id: 'recovery_suppression',
    evaluated_inputs: {},
    threshold: 0.0,
    passed: !recovered,
    effect: !recovered ? 'allow' : 'suppress',
  }

  const etaPassed = nextRestMin <= restEtaFilter || nextRestMin >= 9999.0
  const gateEta: Gate = {
    gate_id: 'rest_spot_eta_filter_min',
    evaluated_inputs: { nextRestSpotMin: nextRestMin },
    threshold: restEtaFilter,
    passed: etaPassed,
    effect: etaPassed ? 'allow' : 'suppress',
  }

  const belowFire = sTotal < thresholdFire
  const gateSuperseded: Gate = {
    gate_id: 'superseded_by_rest_required',
    evaluated_inputs: { s_total: sTotal },
    threshold: thresholdFire,
    passed: belowFire,
    effect: belowFire ? 'allow' : 'suppress',
  }

  return {
    rest_required: {
      score: sTotal,
      clamped: false, // NRI never clamps; rows sum exactly to s_total
      rows: buildRows(),
      gates: [gateRecovery, gateEta],
    },
    monotony_prevention: {
      score: sTotal,
      clamped: false,
      rows: buildRows(),
      gates: [gateRecovery, gateSuperseded],
    },
  }
}

// ---------------------------------------------------------------------------
// State labels — two thresholds banding ONE score (no suggest/recommend/
// urgent ladder). REST_RECOVERY while resting, REST_FIRE at/above
// threshold_fire, else REST_NORMAL; MONOTONY_FIRE only INSIDE the band, so
// the two labels never both read "fire" on the same tick.
// ---------------------------------------------------------------------------

function stateLabel(score: number, recovered: boolean, thresholdFire: number): string {
  if (recovered) return 'REST_RECOVERY'
  if (score >= thresholdFire) return 'REST_FIRE'
  return 'REST_NORMAL'
}

function monotonyStateLabel(
  score: number, recovered: boolean, thresholdMonotony: number, thresholdFire: number,
): string {
  if (recovered) return 'MONOTONY_RECOVERY'
  if (score >= thresholdMonotony && score < thresholdFire) return 'MONOTONY_FIRE'
  return 'MONOTONY_NORMAL'
}

// ---------------------------------------------------------------------------
// Localized proposals
// ---------------------------------------------------------------------------

const PROPOSALS: Record<string, { ja: string; en: string }> = {
  gentle: {
    ja: '疲労スコアが基準値を超えました。近くの休憩施設でのご休憩をお勧めします。',
    en: 'Fatigue score has exceeded the threshold. We suggest resting at a nearby facility.',
  },
  clear: {
    ja: '疲労が蓄積しています。早めの休憩をお勧めします。',
    en: 'Fatigue is accumulating. We recommend resting soon.',
  },
  strong: {
    ja: '安全のため、直ちに休憩を取ってください。',
    en: 'For your safety, please take a rest immediately.',
  },
}

const MONOTONY_PROPOSAL: { ja: string; en: string } = {
  ja: '単調な走行が続いています。気分転換をお勧めします。',
  en: 'Monotonous driving detected. Consider a short break or refreshing content.',
}

function buildProposal(strengthLabel: string): Proposal {
  const message = PROPOSALS[strengthLabel] ?? PROPOSALS['gentle']
  return {
    id: 'rest_required_proposal',
    message,
    options: ['accept_rest', 'postpone', 'decline'],
  }
}

/**
 * The monotony-band proposal.
 *
 * Deliberately NOT offering `accept_rest`: this band sits BELOW the rest
 * threshold, so it is a nudge toward refreshing content, not an instruction
 * to go and stop somewhere. Its options mirror the Hybrid's monotony
 * proposal so both algorithms are actionable under the same
 * `scenario.allowed_actions`.
 */
function buildMonotonyProposal(): Proposal {
  return {
    id: 'monotony_prevention_proposal',
    message: MONOTONY_PROPOSAL,
    options: ['acknowledge', 'decline'],
  }
}

// ---------------------------------------------------------------------------
// Public API — the algorithm.py evaluate() port.
// ---------------------------------------------------------------------------

/**
 * Evaluate the NRI fatigue accumulation score for one tick.
 *
 * Pure & deterministic: no Date.now, no Math.random, no I/O. Given the same
 * `input` (including the SAME `package_runtime_state`), always returns the
 * same `DecisionResult` (with the SAME `next_package_runtime_state`).
 */
export function evaluate(input: NriEvaluateInput): EvaluateOutput {
  const hp = input.hyperparameters ?? {}
  const signals = (input.signals ?? {}) as Record<string, unknown>
  const fixed = (signals['fixed'] ?? {}) as Record<string, unknown>
  const dynamic = (signals['dynamic'] ?? {}) as Record<string, unknown>
  const simulated = (signals['simulated'] ?? {}) as Record<string, unknown>
  const featureGroups = (input.feature_groups ?? {}) as Record<string, unknown>
  const ordinal = (featureGroups['ordinal'] ?? {}) as Record<string, unknown>
  const prevState = (input.package_runtime_state ?? {}) as Record<string, unknown>
  const proposalHistory = (input.proposal_history ?? {}) as Record<string, unknown>
  const simTime = Number(input.simulation_time_sec ?? 0.0)

  // ── Extract Tier-1 fixed signals (scenario constants) ───────────────────
  const childPassenger = Boolean(dget(fixed, 'childPassenger', false))
  const familiarRoute = Boolean(dget(fixed, 'familiarRoute', false))
  const isNight = Boolean(dget(fixed, 'isNight', false))

  // ── Extract Tier-2 dynamic signals ───────────────────────────────────────
  const isTrafficJam = Boolean(dget(dynamic, 'isTrafficJam', false))
  const segmentType = String(dget(dynamic, 'segmentType', 'normal_road'))
  const nextRestMin = Number(dget(dynamic, 'nextRestSpotMin', 9999.0))
  const motionState = String(dget(dynamic, 'motionState', 'MOVING'))

  // ── Extract Tier-3a simulated signals (now live — feed S_realtime) ──────
  const drowsinessLevel = Number(dget(simulated, 'drowsiness', 0.0))
  const fatigueLevel = Number(dget(simulated, 'fatigue', 0.0))

  // ── Hyperparameters — TWO thresholds banding one score + the ETA filter ──
  // `threshold_monotony` is the LOWER of the pair: one S_total, banded into a
  // rest band (>= threshold_fire) and a monotony band ([monotony, fire)).
  const thresholdFire = reqNum(hp, 'threshold_fire')
  const thresholdMonotony = reqNum(hp, 'threshold_monotony')
  const restEtaFilter = reqNum(hp, 'rest_spot_eta_filter_min')

  // ── Recovery detection (early — needed before accumulation) ─────────────
  // Detect recovery from dynamic.recoveryPhase (set by tick engine when a
  // recovery sequence is active). No framework-level flag needed.
  const recoveryPhase = dget(dynamic, 'recoveryPhase', null)
  const recoveryActive = recoveryPhase !== null && recoveryPhase !== undefined
  const wasInRecovery = Boolean(dget(prevState, 'was_in_recovery', false))

  // Recovery just completed: driver was resting, now resumed driving.
  const recoveryJustCompleted = wasInRecovery && !recoveryActive

  // Suppress all firing while recovery is active (unconditional — the score
  // stays high due to cumulative accumulators, so we cannot rely on
  // lastProposalResult which gets overwritten if a new proposal fires).
  const recovered = recoveryActive

  // ── Relieve monotony exposure when its OWN proposal is answered ─────────
  // A rest is not the only intervention that relieves monotony — content
  // (acknowledge OR decline) does too, mirroring
  // aica_transparent_hybrid_trigger_v1's `mono_min` rebaseline. Without this,
  // once cumulative_monotonous_min saturated the monotony band it never
  // fell, and answering the monotony proposal changed nothing: the score
  // stayed pinned above threshold_monotony and could re-fire every tick (NRI
  // has no cooldown). DESIGN DECISION: ANY non-null lastProposalResult
  // relieves, not acknowledge-only — declining still counts as "answered".
  //
  // The guard mirrors Hybrid's `mono_intervention_handled_sec`: without it,
  // `lastProposalTimeSec` stays pointing at the same served proposal for
  // many ticks, so the accumulator would be re-zeroed every tick and
  // monotony could never rebuild to fire again. Only fires once per
  // intervention (until a NEW monotony proposal's sim_time appears).
  const lastProposalCategory = dget(proposalHistory, 'lastProposalCategory', null)
  const lastProposalResult = dget(proposalHistory, 'lastProposalResult', null)
  const monoInterventionSec =
    lastProposalCategory === 'monotony_prevention' && lastProposalResult !== null && lastProposalResult !== undefined
      ? (dget(proposalHistory, 'lastProposalTimeSec', null) as number | null)
      : null
  const prevMonoHandledSec = dget(prevState, 'mono_intervention_handled_sec', null) as number | null
  const monoInterventionRelievedThisTick =
    monoInterventionSec !== null && monoInterventionSec !== undefined && monoInterventionSec !== prevMonoHandledSec
  const monoInterventionHandledSec: number | null = monoInterventionRelievedThisTick
    ? monoInterventionSec
    : prevMonoHandledSec

  // ── Retrieve cumulative state from previous tick ─────────────────────────
  let prevJamMin = Number(dget(prevState, 'cumulative_jam_min', 0.0))
  let prevHighwayMin = Number(dget(prevState, 'cumulative_highway_min', 0.0))
  let prevMonoMin = Number(dget(prevState, 'cumulative_monotonous_min', 0.0))
  let prevDrivingMin = Number(dget(prevState, 'driving_min_since_rest', 0.0))

  // ── Reset accumulators after recovery completes ──────────────────────────
  // LOAD-BEARING: the accumulation step below FREEZES the four accumulators
  // (via `accrue = isMoving && !recoveryActive`) for the entire
  // recoveryActive window rather than zeroing them, so `prevState` on the
  // resume tick (recoveryJustCompleted=true) still holds the pre-accept
  // accumulated total. This is the ONLY place that resets it to 0 — drop
  // this block and the score would never fall after a completed recovery.
  if (recoveryJustCompleted) {
    prevJamMin = 0.0
    prevHighwayMin = 0.0
    prevMonoMin = 0.0
    prevDrivingMin = 0.0
  }

  // Relieve monotony exposure when its own proposal is answered (mirrors
  // Hybrid's mono_min rebaseline) — monotony ONLY; content does not clear a
  // traffic jam or un-drive the highway, so jam/highway/driving are
  // untouched.
  if (monoInterventionRelievedThisTick) {
    prevMonoMin = 0.0
  }

  // ── Determine tick duration from simulation time ─────────────────────────
  const prevSimTime = Number(dget(prevState, 'last_sim_time', 0.0))
  let tickDurationMin = prevSimTime > 0 ? (simTime - prevSimTime) / 60.0 : 1.0
  if (tickDurationMin <= 0) tickDurationMin = 1.0

  // ── Only accumulate time when MOVING, and FREEZE during recovery ─────────
  // `accrue` gates all four accumulators: they grow only while actually
  // driving (`isMoving`) AND not in a recovery window (`!recoveryActive`).
  // This freezes them at their pre-accept value for the WHOLE recovery
  // window: during the MOVING drive-to-spot, `recoveryActive` is true so
  // `accrue` is false (frozen, not growing); during the STOPPED dwell,
  // `isMoving` is already false (frozen for the same reason it always was).
  // Freezing — rather than zeroing — is deliberate: see the module doc
  // comment's 2026-08-04 bugfix note for why NRI must not mirror Hybrid's
  // continuous rebaseline. The frozen values reset to 0 only at the
  // `recoveryJustCompleted` resume edge, via `prev*` above.
  const isMoving = motionState === 'MOVING'
  const accrue = isMoving && !recoveryActive

  const cumulativeJamMin = prevJamMin + (isTrafficJam && accrue ? tickDurationMin : 0.0)
  const cumulativeHighwayMin = prevHighwayMin + (segmentType === 'highway' && accrue ? tickDurationMin : 0.0)
  const isMonotonous = segmentType === 'highway' || segmentType === 'normal_road'
  const cumulativeMonotonousMin = prevMonoMin + (isMonotonous && accrue ? tickDurationMin : 0.0)
  const drivingMinSinceRest = prevDrivingMin + (accrue ? tickDurationMin : 0.0)

  // ── Compute scores ────────────────────────────────────────────────────────
  const sBase = computeBaseScore(drivingMinSinceRest, childPassenger, isNight, familiarRoute, hp)
  const sEnv = computeEnvScore(cumulativeJamMin, cumulativeHighwayMin, cumulativeMonotonousMin, hp)
  const sRealtime = computeRealtimeScore(drowsinessLevel, fatigueLevel, hp)
  const sTotal = sBase + sEnv + sRealtime

  // ── Feature contributions (exact decomposition of s_total) ──────────────
  // Built here — after s_total but before the fire-control gates below reuse
  // the same recovered/next_rest_min/rest_eta_filter/threshold_fire inputs
  // to describe the SAME gates the fire-control block evaluates, so the
  // review panel's gate list matches what actually decided the tick.
  const featureContributions = buildFeatureContributions({
    drivingMinSinceRest,
    isNight,
    familiarRoute,
    childPassenger,
    cumulativeJamMin,
    cumulativeHighwayMin,
    cumulativeMonotonousMin,
    drowsinessLevel,
    fatigueLevel,
    sTotal,
    recovered,
    nextRestMin,
    restEtaFilter,
    thresholdFire,
    hp,
  })

  // ── State labels ──────────────────────────────────────────────────────────
  const label = stateLabel(sTotal, recovered, thresholdFire)
  const monotonyLabel = monotonyStateLabel(sTotal, recovered, thresholdMonotony, thresholdFire)

  // ── Fire-control — TWO thresholds banding ONE score, then the post-fire
  // ETA filter on the REST band only.
  //
  //     S_total >= threshold_fire                       -> rest_required
  //     threshold_monotony <= S_total < threshold_fire  -> monotony_prevention
  //     S_total <  threshold_monotony                   -> nothing
  //
  // Order within the rest band is unchanged: recovery suppression (never
  // propose while resting) -> below fire threshold (no candidate) -> ETA
  // filter -> fire. Still no persistence gate, cooldown, 30-min cap, or
  // emergency override — this adds a band, not a ladder.
  const exists = sTotal >= thresholdFire
  // Manifested-risk (drowsiness/fatigue past their theta dead-band) -> a
  // stronger message; otherwise the accumulated-fatigue message. Uses only
  // the existing theta thresholds — no extra fire-control hyperparameter.
  const strengthLabel: string | null = exists ? (sRealtime > 0.0 ? 'strong' : 'clear') : null

  let fired = false
  let suppressed = false
  const override = false
  let reason: string

  if (recovered) {
    suppressed = true
    reason = 'recovery_after_accept'
  } else if (!exists) {
    reason = 'below_fire_threshold'
  } else if (nextRestMin <= restEtaFilter || nextRestMin >= 9999.0) {
    fired = true
    reason = 'fire_threshold_passed'
  } else {
    suppressed = true
    reason = 'rest_spot_too_far'
  }

  // ── Monotony band ─────────────────────────────────────────────────────────
  // No ETA filter here: refreshing content needs no place to stop, so the
  // thing that suppresses a rest proposal must not suppress this one.
  const monoExists = sTotal >= thresholdMonotony
  const monoInBand = monoExists && sTotal < thresholdFire
  let monoFired = false
  let monoSuppressed = false
  let monoReason: string

  if (recovered) {
    monoSuppressed = true
    monoReason = 'recovery_after_accept'
  } else if (!monoExists) {
    monoReason = 'below_monotony_threshold'
  } else if (!monoInBand) {
    // The score cleared this threshold too, but the higher-priority rest band
    // owns the tick. Say so, rather than reporting it as below threshold.
    monoSuppressed = true
    monoReason = 'superseded_by_rest_required'
  } else {
    monoFired = true
    monoReason = 'monotony_threshold_passed'
  }

  // ── Build candidates (both RETAINED, fired or not — §11) ─────────────────
  const candidates: Candidate[] = [
    {
      category: 'rest_required',
      exists,
      score: sTotal,
      state: label,
      strength: strengthLabel,
      fire_control: { fired, suppressed, override, reason },
    },
    {
      category: 'monotony_prevention',
      exists: monoExists,
      score: sTotal,
      state: monotonyLabel,
      strength: monoInBand ? 'gentle' : null,
      fire_control: { fired: monoFired, suppressed: monoSuppressed, override: false, reason: monoReason },
    },
  ]

  // ── Result type + the overall fire_control mirror ────────────────────────
  // Rest outranks monotony (trigger_categories priority 1 vs 2), and the
  // bands are disjoint anyway, so at most one of them ever fires.
  let resultType: string
  let selectedCategory: string | null
  let overallFc: FireControl

  if (fired) {
    resultType = 'REST_PROPOSAL'
    selectedCategory = 'rest_required'
    overallFc = { fired: true, suppressed: false, override, reason }
  } else if (monoFired) {
    resultType = 'MONOTONY_PROPOSAL'
    selectedCategory = 'monotony_prevention'
    overallFc = { fired: true, suppressed: false, override: false, reason: monoReason }
  } else if (suppressed || monoSuppressed) {
    resultType = 'SUPPRESSED'
    selectedCategory = null
    // Report the REST suppression when there is one — it is the
    // higher-priority category and the more consequential thing to have
    // withheld.
    overallFc = suppressed
      ? { fired: false, suppressed: true, override: false, reason }
      : { fired: false, suppressed: true, override: false, reason: monoReason }
  } else {
    resultType = 'NO_PROPOSAL'
    selectedCategory = null
    overallFc = { fired: false, suppressed: false, override: false, reason }
  }

  // ── Proposal + explanation ─────────────────────────────────────────────────
  let proposal: Proposal | null = null
  if (fired && strengthLabel) {
    proposal = buildProposal(strengthLabel)
  } else if (monoFired) {
    proposal = buildMonotonyProposal()
  }

  const reasonInputs = [
    'continuous_driving_min', 'drowsiness', 'fatigue',
    'traffic_jam', 'highway', 'monotonous_road',
  ]

  // Name WHICH band the score landed in — with two thresholds on one score,
  // "fired / not fired" alone no longer says what happened.
  let bandJa: string
  let bandEn: string
  if (fired) {
    bandJa = `休憩しきい値(${pyFixed(thresholdFire, 0)})超で発火`
    bandEn = `fired: at/above the rest threshold (${pyFixed(thresholdFire, 0)})`
  } else if (monoFired) {
    bandJa = `単調性帯(${pyFixed(thresholdMonotony, 0)}〜${pyFixed(thresholdFire, 0)})で発火`
    bandEn = `fired: inside the monotony band (${pyFixed(thresholdMonotony, 0)}–${pyFixed(thresholdFire, 0)})`
  } else {
    bandJa = '未発火'
    bandEn = 'not fired'
  }

  const explanation = [
    {
      ja: (
        `総合疲労スコア=${pyFixed(sTotal, 1)}点 `
        + `(基礎=${pyFixed(sBase, 1)} + 環境=${pyFixed(sEnv, 1)} + リアルタイム=${pyFixed(sRealtime, 1)})。`
        + `${bandJa}、状態=${label}／${monotonyLabel}。`
      ),
      en: (
        `Total fatigue score=${pyFixed(sTotal, 1)}pts `
        + `(base=${pyFixed(sBase, 1)} + env=${pyFixed(sEnv, 1)} + realtime=${pyFixed(sRealtime, 1)}). `
        + `${bandEn}, state=${label} / ${monotonyLabel}.`
      ),
    },
  ]

  // ── Next runtime state ────────────────────────────────────────────────────
  const nextRuntimeState: NriRuntimeState = {
    cumulative_jam_min: cumulativeJamMin,
    cumulative_highway_min: cumulativeHighwayMin,
    cumulative_monotonous_min: cumulativeMonotonousMin,
    driving_min_since_rest: drivingMinSinceRest,
    last_sim_time: simTime,
    was_in_recovery: recoveryActive,
    mono_intervention_handled_sec: monoInterventionHandledSec,
  }

  // ── Features ordinal (for trace display) ──────────────────────────────────
  const featuresOrdinal: Record<string, string> = {}
  for (const [k, v] of Object.entries(ordinal)) {
    featuresOrdinal[k] = String(v)
  }

  // Attach the ordinal band word each row's raw value falls in, so the
  // review panel can lead with the value a reviewer already understands.
  // `ordinal` is keyed independently of the row feature_ids above (e.g. the
  // split-out `night_amplification` / `familiar_route_amplification` rows
  // have no ordinal entry of their own) — a miss stays null rather than
  // guessing (mirrors aica_transparent_hybrid_trigger_v1.evaluate()).
  for (const block of Object.values(featureContributions)) {
    for (const row of block.rows) {
      row.band = (featuresOrdinal[row.feature_id] as string | undefined) ?? null
    }
  }

  // ── Normalized score (0-1 range for UI compatibility) ─────────────────────
  const maxDisplay = Math.max(thresholdFire * 1.5, 150.0)
  const normalizedScore = maxDisplay > 0 ? Math.min(1.0, sTotal / maxDisplay) : 0.0
  // The §11 `score`/`rest_required_score` is NORMALIZED to 0-1; the timeline
  // plots that curve and its threshold line on the same axis. `threshold_fire`
  // is on the RAW s_total scale (e.g. 80), so we also expose it normalized by
  // the same divisor — otherwise the UI's y-domain stretches to ~80 and the
  // 0-1 curve collapses to a flat line at the bottom (mirrors the hybrid's
  // already-0-1 `threshold_suggest`).
  const normalizedThreshold = maxDisplay > 0 ? Math.min(1.0, thresholdFire / maxDisplay) : 0.0
  // Same divisor for the monotony rule — otherwise the timeline would draw it
  // at its RAW value (~55) on a 0-1 axis. Note there is deliberately no
  // `monotony_prevention_score`: NRI has ONE score, so a second curve would
  // just be a duplicate of the first drawn on top of it. Two thresholds, one
  // score.
  const normalizedMonotonyThreshold = maxDisplay > 0 ? Math.min(1.0, thresholdMonotony / maxDisplay) : 0.0

  const result = {
    result_type: resultType,
    trigger_candidate: fired || monoFired,
    selected_category: selectedCategory,
    score: normalizedScore,
    features: featuresOrdinal,
    scores: {
      s_total: sTotal,
      s_base: sBase,
      s_env: sEnv,
      s_realtime: sRealtime,
      rest_required_score: normalizedScore,
    },
    feature_contributions: featureContributions,
    states: {
      rest: label,
      monotony: monotonyLabel,
    },
    criteria: {
      threshold_fire: thresholdFire,
      threshold_monotony: thresholdMonotony,
      // thresholds on the SAME 0-1 scale as rest_required_score (for the
      // timeline threshold lines); the two above stay raw (s_total scale).
      rest_required_threshold: normalizedThreshold,
      monotony_suggest_threshold: normalizedMonotonyThreshold,
      rest_spot_eta_filter_min: restEtaFilter,
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
    // value at runtime (`typeof dr.explanation === 'string' ? ... : ...`).
    explanation: explanation as unknown as string,
    next_package_runtime_state: nextRuntimeState as unknown as Record<string, unknown>,
  }

  return result
}
