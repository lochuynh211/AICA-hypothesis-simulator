/**
 * nri_fatigue_score_v1 — TS port of the `python_module` package
 * `packages/nri_fatigue_score_v1/algorithm.py` (behavior-of-record, 420 LoC).
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
 * `py_context` (simulation_time_sec, raw_state, feature_groups, parameters,
 * hyperparameters, proposal_history, user_action_history,
 * package_runtime_state). It performs NO context validation itself (neither
 * does algorithm.py — python_module.dispatch validates BEFORE calling it).
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
 * Fire condition: S_total >= threshold_fire (subject to persistence-ticks,
 * cooldown, 30-min rate limit, and rest-spot-ETA post-fire filter — or an
 * emergency_override_threshold bypass).
 *
 * State carried across ticks (via package_runtime_state — see
 * `NriRuntimeState`):
 *   - cumulative_jam_min / cumulative_highway_min / cumulative_monotonous_min
 *   - driving_min_since_rest
 *   - persistence_counter
 *   - last_score / last_sim_time
 *   - was_in_recovery (drives the accumulator reset on recovery completion)
 *
 * Every threshold/coefficient/ordering below is preserved EXACTLY from
 * algorithm.py — this is the parity boundary (see
 * `../../../engine/__fixtures__/parity/nri_fatigue_score_v1.json`, captured
 * from a full run of the real Python package via the app/api venv, and
 * `tests/nri_port.test.ts`, which replays it threading the evolving
 * `next_package_runtime_state` exactly as `run_manager.tick` does).
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
// Input shape — mirrors python_module.dispatch()'s `py_context` dict, which
// is exactly what algorithm.py's `evaluate(context)` receives. NOT the same
// shape as `../../../engine/algorithms/js_module.ts`'s `EvaluateInput`
// (that one nests a separate `context`/`history` for the untrusted worker
// contract) — nri's shape below is the trusted python_module contract.
// ---------------------------------------------------------------------------

export type NriEvaluateInput = {
  simulation_time_sec: number
  raw_state: Record<string, unknown>
  feature_groups: Record<string, unknown>
  parameters: Record<string, unknown>
  hyperparameters: Record<string, unknown>
  proposal_history: Record<string, unknown>
  user_action_history: unknown[]
  package_runtime_state: Record<string, unknown>
}

/** The stateful accumulator carried in package_runtime_state across ticks. */
export type NriRuntimeState = {
  cumulative_jam_min: number
  cumulative_highway_min: number
  cumulative_monotonous_min: number
  driving_min_since_rest: number
  persistence_counter: number
  last_score: number
  last_sim_time: number
  was_in_recovery: boolean
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

function numHp(hp: Record<string, unknown>, key: string, dflt: number): number {
  const v = dget(hp, key, dflt)
  const n = Number(v)
  return Number.isNaN(n) ? dflt : n
}

function intHp(hp: Record<string, unknown>, key: string, dflt: number): number {
  return Math.trunc(numHp(hp, key, dflt))
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
  const wBase = numHp(hp, 'w_base', 0.5)
  const wChild = numHp(hp, 'w_child', 20.0)
  const mNight = isNight ? numHp(hp, 'm_night', 1.2) : 1.0
  const mFamiliar = familiarRoute ? numHp(hp, 'm_familiar', 1.2) : 1.0

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
  const wJam = numHp(hp, 'w_jam', 0.8)
  const wHighway = numHp(hp, 'w_highway', 0.2)
  const wMonotonous = numHp(hp, 'w_monotonous', 0.3)

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
  const thetaSleep = numHp(hp, 'theta_sleep', 60.0)
  const wSleep = numHp(hp, 'w_sleep', 1.5)
  const thetaFatigue = numHp(hp, 'theta_fatigue', 60.0)
  const wFatigue = numHp(hp, 'w_fatigue', 1.5)

  const sleepPenalty = Math.max(0.0, drowsinessLevel - thetaSleep) * wSleep
  const fatiguePenalty = Math.max(0.0, fatigueLevel - thetaFatigue) * wFatigue

  return sleepPenalty + fatiguePenalty
}

// ---------------------------------------------------------------------------
// Strength mapping
// ---------------------------------------------------------------------------

function strengthOf(score: number, suggest: number, recommend: number, urgent: number): string | null {
  if (score >= urgent) return 'strong'
  if (score >= recommend) return 'clear'
  if (score >= suggest) return 'gentle'
  return null
}

// ---------------------------------------------------------------------------
// State label
// ---------------------------------------------------------------------------

function stateLabel(score: number, recovered: boolean, hp: Record<string, unknown>): string {
  if (recovered) return 'REST_RECOVERY'
  const suggest = numHp(hp, 'threshold_suggest', 60.0)
  const recommend = numHp(hp, 'threshold_recommend', 80.0)
  const urgent = numHp(hp, 'threshold_urgent', 100.0)
  if (score >= urgent) return 'REST_URGENT'
  if (score >= recommend) return 'REST_RECOMMEND'
  if (score >= suggest) return 'REST_SUGGEST'
  if (score >= suggest * 0.7) return 'REST_WATCH'
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
  const params = input.parameters ?? {}
  const raw = input.raw_state ?? {}
  const featureGroups = (input.feature_groups ?? {}) as Record<string, unknown>
  const ordinal = (featureGroups['ordinal'] ?? {}) as Record<string, unknown>
  const prevState = (input.package_runtime_state ?? {}) as Record<string, unknown>
  const proposalHistory = input.proposal_history ?? {}
  const simTime = Number(input.simulation_time_sec ?? 0.0)

  // ── Extract parameters (setup-time, with raw_state fallback) ────────────
  const childPassenger = Boolean(dget(params, 'child_passenger', dget(raw, 'childPassenger', false)))
  const familiarRoute = Boolean(dget(params, 'familiar_route', dget(raw, 'familiarRoute', false)))

  // ── Extract raw_state values ──────────────────────────────────────────
  const isNight = Boolean(dget(raw, 'isNight', false))
  const isTrafficJam = Boolean(dget(raw, 'isTrafficJam', false))
  const segmentType = String(dget(raw, 'segmentType', 'normal_road'))
  const drowsinessLevel = Number(dget(raw, 'drowsinessLevel', 0.0))
  const fatigueLevel = Number(dget(raw, 'fatigueLevel', 0.0))
  const nextRestMin = Number(dget(raw, 'nextRestSpotMin', 9999.0))
  const motionState = String(dget(raw, 'motionState', 'MOVING'))

  // ── Hyperparameters ──────────────────────────────────────────────────
  const thresholdFire = numHp(hp, 'threshold_fire', 80.0)
  const thresholdSuggest = numHp(hp, 'threshold_suggest', 60.0)
  const thresholdRecommend = numHp(hp, 'threshold_recommend', 80.0)
  const thresholdUrgent = numHp(hp, 'threshold_urgent', 100.0)
  const restEtaFilter = numHp(hp, 'rest_spot_eta_filter_min', 15.0)
  const restCooldown = numHp(hp, 'rest_cooldown_sec', 600.0)
  const maxPer30min = intHp(hp, 'max_proposals_per_30min', 3)
  const emergencyThreshold = numHp(hp, 'emergency_override_threshold', 100.0)
  const persistenceRequired = intHp(hp, 'persistence_ticks', 2)

  // ── Recovery detection (early — needed before accumulation) ────────────
  const recoveryPhase = dget(raw, 'recoveryPhase', null)
  const recoveryActive = recoveryPhase !== null && recoveryPhase !== undefined
  const wasInRecovery = Boolean(dget(prevState, 'was_in_recovery', false))

  // Recovery just completed: driver was resting, now resumed driving.
  const recoveryJustCompleted = wasInRecovery && !recoveryActive

  // Suppress all firing while recovery is active (unconditional — the score
  // stays high due to cumulative accumulators, so we cannot rely on
  // lastProposalResult which gets overwritten if a new proposal fires).
  const recovered = recoveryActive

  // ── Retrieve cumulative state from previous tick ────────────────────────
  let prevJamMin = Number(dget(prevState, 'cumulative_jam_min', 0.0))
  let prevHighwayMin = Number(dget(prevState, 'cumulative_highway_min', 0.0))
  let prevMonoMin = Number(dget(prevState, 'cumulative_monotonous_min', 0.0))
  let prevDrivingMin = Number(dget(prevState, 'driving_min_since_rest', 0.0))
  let prevCounter = Math.trunc(Number(dget(prevState, 'persistence_counter', 0)))
  let prevScore = Number(dget(prevState, 'last_score', 0.0))

  // ── Reset accumulators after recovery completes ─────────────────────────
  if (recoveryJustCompleted) {
    prevJamMin = 0.0
    prevHighwayMin = 0.0
    prevMonoMin = 0.0
    prevDrivingMin = 0.0
    prevCounter = 0
    prevScore = 0.0
  }

  // ── Determine tick duration from simulation time ────────────────────────
  const prevSimTime = Number(dget(prevState, 'last_sim_time', 0.0))
  let tickDurationMin = prevSimTime > 0 ? (simTime - prevSimTime) / 60.0 : 1.0
  if (tickDurationMin <= 0) tickDurationMin = 1.0

  // ── Only accumulate time when MOVING (not during rest stops) ────────────
  const isMoving = motionState === 'MOVING'

  const cumulativeJamMin = prevJamMin + (isTrafficJam && isMoving ? tickDurationMin : 0.0)
  const cumulativeHighwayMin = prevHighwayMin + (segmentType === 'highway' && isMoving ? tickDurationMin : 0.0)
  const isMonotonous = segmentType === 'highway' || segmentType === 'normal_road'
  const cumulativeMonotonousMin = prevMonoMin + (isMonotonous && isMoving ? tickDurationMin : 0.0)
  const drivingMinSinceRest = prevDrivingMin + (isMoving ? tickDurationMin : 0.0)

  // ── Compute scores ──────────────────────────────────────────────────────
  const sBase = computeBaseScore(drivingMinSinceRest, childPassenger, isNight, familiarRoute, hp)
  const sEnv = computeEnvScore(cumulativeJamMin, cumulativeHighwayMin, cumulativeMonotonousMin, hp)
  const sRealtime = computeRealtimeScore(drowsinessLevel, fatigueLevel, hp)
  const sTotal = sBase + sEnv + sRealtime

  // ── Velocity ────────────────────────────────────────────────────────────
  const velocity = sTotal - prevScore

  // ── State label ─────────────────────────────────────────────────────────
  const label = stateLabel(sTotal, recovered, hp)

  // ── Candidate evaluation ────────────────────────────────────────────────
  const exists = sTotal >= thresholdSuggest
  const strengthLabel = strengthOf(sTotal, thresholdSuggest, thresholdRecommend, thresholdUrgent)
  const newCounter = sTotal >= thresholdFire ? prevCounter + 1 : 0

  // Fire-control logic
  let fired = false
  let suppressed = false
  let override = false
  let reason = 'below_fire_threshold'

  if (!exists) {
    reason = 'below_suggest_threshold'
  } else if (recovered) {
    suppressed = true
    reason = 'recovery_after_accept'
  } else if (sTotal < thresholdFire) {
    reason = 'below_fire_threshold'
  } else if (newCounter < persistenceRequired && sTotal < emergencyThreshold) {
    suppressed = true
    reason = 'persistence_gate'
  } else if (sTotal >= emergencyThreshold) {
    fired = true
    override = true
    reason = 'emergency_override'
  } else {
    // Check cooldown
    const lastTimeRaw = dget(proposalHistory, 'lastProposalTimeSec', null)
    const lastPropCat = dget(proposalHistory, 'lastProposalCategory', null)
    const hasLastTime = lastTimeRaw !== null && lastTimeRaw !== undefined
    if (
      hasLastTime
      && lastPropCat === 'rest_required'
      && (simTime - Number(lastTimeRaw)) < restCooldown
    ) {
      suppressed = true
      reason = 'cooldown_active'
    } else {
      // Check 30-min rate limit
      const count30 = Math.trunc(Number(dget(proposalHistory, 'proposalCountLast30Min', 0)))
      if (count30 >= maxPer30min) {
        suppressed = true
        reason = 'rate_limit_30min'
      } else {
        // Post-fire filter: rest spot ETA
        if (nextRestMin <= restEtaFilter || nextRestMin >= 9999.0) {
          fired = true
          reason = 'threshold_passed_persisted'
        } else {
          suppressed = true
          reason = 'rest_spot_too_far'
        }
      }
    }
  }

  // ── Build candidate ──────────────────────────────────────────────────────
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

  // ── Result type ────────────────────────────────────────────────────────
  const resultType = fired ? 'REST_PROPOSAL' : suppressed ? 'SUPPRESSED' : 'NO_PROPOSAL'

  // ── Overall fire_control ──────────────────────────────────────────────
  const overallFireControl: FireControl = { fired, suppressed, override, reason }

  // ── Proposal + explanation ─────────────────────────────────────────────
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

  // ── Next runtime state ──────────────────────────────────────────────────
  const nextRuntimeState: NriRuntimeState = {
    cumulative_jam_min: cumulativeJamMin,
    cumulative_highway_min: cumulativeHighwayMin,
    cumulative_monotonous_min: cumulativeMonotonousMin,
    driving_min_since_rest: drivingMinSinceRest,
    persistence_counter: newCounter,
    last_score: sTotal,
    last_sim_time: simTime,
    was_in_recovery: recoveryActive,
  }

  // ── Features ordinal (for trace display) ────────────────────────────────
  const featuresOrdinal: Record<string, string> = {}
  for (const [k, v] of Object.entries(ordinal)) {
    featuresOrdinal[k] = String(v)
  }

  // ── Normalized score (0-1 range for UI compatibility) ──────────────────
  const maxDisplay = Math.max(thresholdUrgent * 1.5, 150.0)
  const normalizedScore = maxDisplay > 0 ? Math.min(1.0, sTotal / maxDisplay) : 0.0

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
      velocity,
      rest_required_score: normalizedScore,
    },
    states: {
      rest: label,
    },
    criteria: {
      threshold_fire: thresholdFire,
      threshold_suggest: thresholdSuggest,
      threshold_recommend: thresholdRecommend,
      threshold_urgent: thresholdUrgent,
      rest_spot_eta_filter_min: restEtaFilter,
      persistence_ticks: persistenceRequired,
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
