/**
 * nri_fatigue_score_v1 — TS port of the `python_module` package
 * `packages/nri_fatigue_score_v1/algorithm.py` (behavior-of-record).
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
 * Fire condition (design-aligned — a SINGLE threshold): fire ⇔
 * S_total >= threshold_fire, then a post-fire filter (next rest spot ETA
 * <= rest_spot_eta_filter_min, or no spot ahead). Recovery suppresses firing
 * unconditionally. There is NO suggest/recommend/urgent ladder, persistence
 * gate, cooldown, 30-min cap, or emergency override — those were Hybrid
 * carry-overs removed to match the NRI spec.
 *
 * State carried across ticks (via package_runtime_state — see
 * `NriRuntimeState`):
 *   - cumulative_jam_min / cumulative_highway_min / cumulative_monotonous_min
 *   - driving_min_since_rest
 *   - last_sim_time
 *   - was_in_recovery (drives the accumulator reset on recovery completion)
 *
 * Every hyperparameter is read via a STRICT `hp[key]` lookup — NO
 * `hp.get(key, <hardcoded default>)` fallback, mirroring algorithm.py's
 * direct `hp["key"]` dict indexing exactly: `context["hyperparameters"]` is
 * guaranteed fully resolved (manifest defaults ⊕ overrides, every declared
 * key present) by the adapter (FR-009); a missing key here is a real
 * configuration bug and MUST surface as an error -> algorithm_error, never a
 * silently-wrong default.
 *
 * Every threshold/coefficient/ordering below is preserved EXACTLY from
 * algorithm.py — this is the parity boundary (see
 * `../../../engine/__fixtures__/parity/nri_fatigue_score_v1.json`, captured
 * from a full run of the real Python package, and `tests/nri_port.test.ts`,
 * which replays it threading the evolving `next_package_runtime_state`
 * exactly as `run_manager.tick` does).
 *
 * Only the exported function identifier (`evaluate`) and local helper names
 * are camelCased; every DecisionResult key, ordinal/state/reason STRING
 * VALUE, and package_runtime_state key is preserved byte-for-byte because it
 * crosses the parity boundary.
 */

import type { Candidate, DecisionResult, FireControl, Proposal } from '../../../api/types'
import nriManifestJson from '../nri_fatigue_score_v1.json'
import type { PackageManifest } from '../../../api/types'

/** Bundled package manifest — same JSON the offline app ships/loads. */
export const manifest = nriManifestJson as unknown as PackageManifest

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
}

export type EvaluateOutput = DecisionResult

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
// State label — a single fire threshold (design-aligned; no suggest/recommend/
// urgent ladder). REST_RECOVERY while resting, REST_FIRE at/above
// threshold_fire, else REST_NORMAL.
// ---------------------------------------------------------------------------

function stateLabel(score: number, recovered: boolean, thresholdFire: number): string {
  if (recovered) return 'REST_RECOVERY'
  if (score >= thresholdFire) return 'REST_FIRE'
  return 'REST_NORMAL'
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

function buildProposal(strengthLabel: string): Proposal {
  const message = PROPOSALS[strengthLabel] ?? PROPOSALS['gentle']
  return {
    id: 'rest_required_proposal',
    message,
    options: ['accept_rest', 'postpone', 'decline'],
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

  // ── Hyperparameters — a single fire threshold + post-fire ETA filter ────
  const thresholdFire = reqNum(hp, 'threshold_fire')
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

  // ── Retrieve cumulative state from previous tick ─────────────────────────
  let prevJamMin = Number(dget(prevState, 'cumulative_jam_min', 0.0))
  let prevHighwayMin = Number(dget(prevState, 'cumulative_highway_min', 0.0))
  let prevMonoMin = Number(dget(prevState, 'cumulative_monotonous_min', 0.0))
  let prevDrivingMin = Number(dget(prevState, 'driving_min_since_rest', 0.0))

  // ── Reset accumulators after recovery completes ──────────────────────────
  if (recoveryJustCompleted) {
    prevJamMin = 0.0
    prevHighwayMin = 0.0
    prevMonoMin = 0.0
    prevDrivingMin = 0.0
  }

  // ── Determine tick duration from simulation time ─────────────────────────
  const prevSimTime = Number(dget(prevState, 'last_sim_time', 0.0))
  let tickDurationMin = prevSimTime > 0 ? (simTime - prevSimTime) / 60.0 : 1.0
  if (tickDurationMin <= 0) tickDurationMin = 1.0

  // ── Only accumulate time when MOVING (not during rest stops) ─────────────
  const isMoving = motionState === 'MOVING'

  const cumulativeJamMin = prevJamMin + (isTrafficJam && isMoving ? tickDurationMin : 0.0)
  const cumulativeHighwayMin = prevHighwayMin + (segmentType === 'highway' && isMoving ? tickDurationMin : 0.0)
  const isMonotonous = segmentType === 'highway' || segmentType === 'normal_road'
  const cumulativeMonotonousMin = prevMonoMin + (isMonotonous && isMoving ? tickDurationMin : 0.0)
  const drivingMinSinceRest = prevDrivingMin + (isMoving ? tickDurationMin : 0.0)

  // ── Compute scores ────────────────────────────────────────────────────────
  const sBase = computeBaseScore(drivingMinSinceRest, childPassenger, isNight, familiarRoute, hp)
  const sEnv = computeEnvScore(cumulativeJamMin, cumulativeHighwayMin, cumulativeMonotonousMin, hp)
  const sRealtime = computeRealtimeScore(drowsinessLevel, fatigueLevel, hp)
  const sTotal = sBase + sEnv + sRealtime

  // ── State label ───────────────────────────────────────────────────────────
  const label = stateLabel(sTotal, recovered, thresholdFire)

  // ── Fire-control — a SINGLE fire threshold, then the post-fire ETA filter.
  // Order: recovery suppression (never propose while resting) -> below fire
  // threshold (no candidate) -> ETA filter -> fire. No persistence gate,
  // cooldown, 30-min cap, or emergency override (design: fire ⇔
  // S_total >= threshold_fire).
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

  // ── Build candidate ────────────────────────────────────────────────────────
  const candidateFireControl: FireControl = { fired, suppressed, override, reason }
  const candidate: Candidate = {
    category: 'rest_required',
    exists,
    score: sTotal,
    state: label,
    strength: strengthLabel,
    fire_control: candidateFireControl,
  }
  const candidates: Candidate[] = [candidate]

  // ── Result type ─────────────────────────────────────────────────────────
  const resultType = fired ? 'REST_PROPOSAL' : suppressed ? 'SUPPRESSED' : 'NO_PROPOSAL'

  // ── Overall fire_control ──────────────────────────────────────────────────
  const overallFireControl: FireControl = { fired, suppressed, override, reason }

  // ── Proposal + explanation ─────────────────────────────────────────────────
  const proposal = fired && strengthLabel ? buildProposal(strengthLabel) : null

  const reasonInputs = [
    'continuous_driving_min', 'drowsiness', 'fatigue',
    'traffic_jam', 'highway', 'monotonous_road',
  ]

  const explanation = [
    {
      ja: (
        `総合疲労スコア=${sTotal.toFixed(1)}点 `
        + `(基礎=${sBase.toFixed(1)} + 環境=${sEnv.toFixed(1)} + リアルタイム=${sRealtime.toFixed(1)})。`
        + `${fired ? '発火' : '未発火'}、状態=${label}。`
      ),
      en: (
        `Total fatigue score=${sTotal.toFixed(1)}pts `
        + `(base=${sBase.toFixed(1)} + env=${sEnv.toFixed(1)} + realtime=${sRealtime.toFixed(1)}). `
        + `${fired ? 'Fired' : 'Not fired'}, state=${label}.`
      ),
    },
  ]

  // ── Next runtime state ─────────────────────────────────────────────────────
  const nextRuntimeState: NriRuntimeState = {
    cumulative_jam_min: cumulativeJamMin,
    cumulative_highway_min: cumulativeHighwayMin,
    cumulative_monotonous_min: cumulativeMonotonousMin,
    driving_min_since_rest: drivingMinSinceRest,
    last_sim_time: simTime,
    was_in_recovery: recoveryActive,
  }

  // ── Features ordinal (for trace display) ────────────────────────────────
  const featuresOrdinal: Record<string, string> = {}
  for (const [k, v] of Object.entries(ordinal)) {
    featuresOrdinal[k] = String(v)
  }

  // ── Normalized score (0-1 range for UI compatibility) ───────────────────
  const maxDisplay = Math.max(thresholdFire * 1.5, 150.0)
  const normalizedScore = maxDisplay > 0 ? Math.min(1.0, sTotal / maxDisplay) : 0.0
  // The §11 `score`/`rest_required_score` is NORMALIZED to 0-1; the timeline
  // plots that curve and its threshold line on the same axis. `threshold_fire`
  // is on the RAW s_total scale (e.g. 80), so we also expose it normalized by
  // the same divisor — otherwise the UI's y-domain stretches to ~80 and the
  // 0-1 curve collapses to a flat line at the bottom (mirrors the hybrid's
  // already-0-1 `threshold_suggest`).
  const normalizedThreshold = maxDisplay > 0 ? Math.min(1.0, thresholdFire / maxDisplay) : 0.0

  return {
    result_type: resultType,
    trigger_candidate: fired,
    selected_category: fired ? 'rest_required' : null,
    score: normalizedScore,
    features: featuresOrdinal,
    scores: {
      s_total: sTotal,
      s_base: sBase,
      s_env: sEnv,
      s_realtime: sRealtime,
      rest_required_score: normalizedScore,
    },
    states: {
      rest: label,
    },
    criteria: {
      threshold_fire: thresholdFire,
      // threshold on the SAME 0-1 scale as rest_required_score (for the
      // timeline threshold line); threshold_fire above stays raw (s_total scale).
      rest_required_threshold: normalizedThreshold,
      rest_spot_eta_filter_min: restEtaFilter,
    },
    candidates,
    fire_control: overallFireControl,
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
}
