/**
 * weighted_score algorithm - multi-category weighted scoring.
 *
 * Ported from `app/api/aica_api/algorithms/weighted_score.py` (behavior-of-record).
 * Same adapter contract as declarative_rule: evaluate(context, parameters,
 * hyperparameters) -> DecisionResult.
 *
 * Implements the §11 normalized DecisionResult shape with:
 *   - scores{base_safety_risk, rest_required_score, monotony_prevention_score}
 *   - states{rest, monotony}
 *   - candidates[] (all, including suppressed/non-selected)
 *   - selected_category (highest priority fired candidate)
 *
 * M2 constraints:
 *   - No smoothing, no persistence (those are M3).
 *   - next_package_runtime_state always returned as {}.
 *   - Pure and deterministic: same inputs -> same outputs.
 *
 * Feature extraction (from research R4 + proposal §§7,8,9,10,13,15):
 *   - Consumes context.raw_state (camelCase numerics). The normalized 0-1
 *     scores are derived via `buildFeatureGroups` (the ported binning
 *     service) rather than trusting a caller-supplied feature_groups.normalized,
 *     matching the exact same per-field formula the Python module's callers use.
 *
 * Only the exported function identifier (`evaluateWeighted`) is camelCased.
 * All DecisionResult object keys and every band/state/reason string value are
 * preserved byte-for-byte from the Python because they cross the parity boundary.
 */

import type { Candidate, DecisionResult, FireControl, Proposal } from '../../api/types'
import { buildFeatureGroups } from '../binning'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(value: number, lo = 0.0, hi = 1.0): number {
  return Math.max(lo, Math.min(hi, value))
}

function toNum(value: unknown, fallback: number): number {
  if (value === undefined || value === null) {
    return fallback
  }
  return Number(value)
}

// ---------------------------------------------------------------------------
// Feature extraction - from raw_state
// ---------------------------------------------------------------------------

/** How actionable is the next rest stop timing? (proposal §8.1) */
function restWindowScore(nextRestMin: number): number {
  if (nextRestMin >= 9999.0) return 0.0
  if (nextRestMin <= 3.0) return 0.6
  if (nextRestMin <= 10.0) return 1.0
  if (nextRestMin <= 20.0) return 0.6
  return 0.2
}

/** How scarce are upcoming rest spots? (proposal §8.2) */
function restScarcityScore(density: number): number {
  if (density <= 0) return 1.0
  if (density === 1) return 0.7
  if (density === 2) return 0.4
  return 0.1
}

/** Traffic jam forward pressure (proposal §7.4). */
function trafficJamScore(aheadMin: number, lowSpeedMin: number): number {
  let jam: number
  if (aheadMin <= 0.0) jam = 0.0
  else if (aheadMin < 10.0) jam = 0.3
  else if (aheadMin < 30.0) jam = 0.6
  else jam = 1.0
  const low = clamp(lowSpeedMin / 20.0)
  return Math.max(jam, low)
}

/** Monotony contribution from long highway (proposal §7.5). */
function longHighwayScore(highwayMin: number): number {
  if (highwayMin < 10.0) return 0.0
  if (highwayMin < 30.0) return 0.3
  if (highwayMin < 60.0) return 0.6
  return 1.0
}

function weatherRiskScore(weatherLevel: number): number {
  return clamp(weatherLevel / 100.0)
}

/** Expected future fatigue from route conditions (proposal §7.7). */
function futureFatigueScore(tj: number, lh: number, wr: number): number {
  return clamp(0.45 * tj + 0.35 * lh + 0.2 * wr)
}

/** Monotony quality of the current road (proposal §9.5). */
function monotonyScore(
  monotonousRoadMin: number,
  tunnelMin: number,
  isNight: boolean,
  lowSpeedMin: number,
): number {
  const monotonousRoad = clamp(monotonousRoadMin / 30.0)
  const tunnel = clamp(tunnelMin / 15.0)
  const night = isNight ? 1.0 : 0.0
  const lowSpeed = clamp(lowSpeedMin / 20.0)
  return clamp(0.35 * monotonousRoad + 0.25 * tunnel + 0.2 * night + 0.2 * lowSpeed)
}

/** attention_drop = 1 - attention_score (proposal §9.7). */
function attentionDropScore(attentionNormalized: number): number {
  return clamp(1.0 - attentionNormalized)
}

function familiarRouteScore(ratio: number): number {
  return clamp(ratio)
}

// ---------------------------------------------------------------------------
// Score computation
// ---------------------------------------------------------------------------

type ComputedScores = {
  base_safety_risk: number
  rest_required_score: number
  monotony_prevention_score: number
  nextRestMin: number
}

/** Compute all feature-level and category scores. */
function computeScores(
  raw: Record<string, unknown>,
  norm: Record<string, unknown>,
  hp: Record<string, unknown>,
): ComputedScores {
  // -- normalized features (from binning) --
  const drowsiness = toNum(norm['drowsiness_score'], 0.0)
  const fatigue = toNum(norm['fatigue_score'], 0.0)
  const drivingAnomaly = toNum(norm['driving_anomaly_score'], 0.0)
  const attentionNorm = toNum(norm['attention_score'], 1.0)

  // -- raw_state derived features --
  const nextRestMin = toNum(raw['nextRestSpotMin'], 9999.0)
  const isNight = Boolean(raw['isNight'] ?? false)
  const weatherLevel = toNum(raw['weatherRiskLevel'], 0.0)

  const aheadMin = toNum(raw['trafficJamAheadMin'], 0.0)
  const lowSpeedMin = toNum(raw['lowSpeedDurationMin'], 0.0)
  const highwayMin = toNum(raw['highwayRemainingMin'], 0.0)
  const monotonousRoadMin = toNum(raw['monotonousRoadRemainingMin'], 0.0)
  const tunnelMin = toNum(raw['tunnelRemainingMin'], 0.0)
  const familiarRatio = toNum(raw['familiarRouteRatio'], 0.0)
  const restDensity = Math.trunc(toNum(raw['restSpotDensityNext30Min'], 999))

  // -- intermediate feature scores --
  const tj = trafficJamScore(aheadMin, lowSpeedMin)
  const lh = longHighwayScore(highwayMin)
  const wr = weatherRiskScore(weatherLevel)
  const ff = futureFatigueScore(tj, lh, wr)
  const rw = restWindowScore(nextRestMin)
  const rs = restScarcityScore(restDensity)
  const mono = monotonyScore(monotonousRoadMin, tunnelMin, isNight, lowSpeedMin)
  const fr = familiarRouteScore(familiarRatio)
  const ad = attentionDropScore(attentionNorm)

  // -- base_safety_risk --
  const wD = toNum(hp['w_drowsiness'], 0.4)
  const wF = toNum(hp['w_fatigue'], 0.25)
  const wDa = toNum(hp['w_driving_anomaly'], 0.25)
  const wFf = toNum(hp['w_future_fatigue'], 0.1)
  const baseSafetyRisk = clamp(wD * drowsiness + wF * fatigue + wDa * drivingAnomaly + wFf * ff)

  // -- rest_required_score (gated bonus) --
  const minRisk = toNum(hp['minimum_risk_for_rest_bonus'], 0.45)
  const wRw = toNum(hp['w_rest_window'], 0.1)
  const wRs = toNum(hp['w_rest_scarcity'], 0.08)
  let restBonus = 0.0
  if (baseSafetyRisk >= minRisk) {
    restBonus = wRw * rw + wRs * rs
  }
  const restRequiredScore = clamp(baseSafetyRisk + restBonus)

  // -- monotony_prevention_score --
  const wMono = toNum(hp['w_monotony'], 0.3)
  const wFr = toNum(hp['w_familiar_route'], 0.2)
  const wAd = toNum(hp['w_attention_drop'], 0.25)
  const wTj = toNum(hp['w_traffic_jam'], 0.15)
  const wLh = toNum(hp['w_long_highway'], 0.1)
  const monotonyPreventionScore = clamp(
    wMono * mono + wFr * fr + wAd * ad + wTj * tj + wLh * lh,
  )

  return {
    base_safety_risk: baseSafetyRisk,
    rest_required_score: restRequiredScore,
    monotony_prevention_score: monotonyPreventionScore,
    nextRestMin,
  }
}

// ---------------------------------------------------------------------------
// Candidate helpers
// ---------------------------------------------------------------------------

/** Map score to strength label (gentle/clear/strong) or None. */
function strength(score: number, hp: Record<string, unknown>): string | null {
  const suggest = toNum(hp['threshold_suggest'], 0.62)
  const recommend = toNum(hp['threshold_recommend'], 0.76)
  const urgent = toNum(hp['threshold_urgent'], 0.88)
  if (score >= urgent) return 'strong'
  if (score >= recommend) return 'clear'
  if (score >= suggest) return 'gentle'
  return null
}

function makeFireControl(
  fired: boolean,
  suppressed: boolean,
  reason: string | null = null,
  override = false,
): FireControl {
  return { fired, suppressed, override, reason }
}

/** Build a rest_required Candidate with fire-control applied. */
function buildRestCandidate(score: number, hp: Record<string, unknown>, nextRestMin: number): Candidate {
  const suggest = toNum(hp['threshold_suggest'], 0.62)
  const exists = score >= suggest
  const strn = exists ? strength(score, hp) : null

  const requireActionable = Boolean(hp['require_rest_actionable'] ?? true)
  const maxRestMin = toNum(hp['rest_actionable_max_min'], 30.0)
  const actionable = nextRestMin <= maxRestMin

  let fc: FireControl
  if (!exists) {
    fc = makeFireControl(false, false, 'below_suggest_threshold')
  } else if (requireActionable && !actionable) {
    fc = makeFireControl(false, true, 'actionability_guard_rest_not_reachable')
  } else {
    fc = makeFireControl(true, false, 'threshold_passed')
  }

  return {
    category: 'rest_required',
    exists,
    score,
    state: exists ? 'REST_RECOMMEND' : null,
    strength: strn,
    fire_control: fc,
  }
}

/** Build a monotony_prevention Candidate with fire-control applied. */
function buildMonotonyCandidate(score: number, hp: Record<string, unknown>): Candidate {
  const suggest = toNum(hp['threshold_suggest'], 0.62)
  const exists = score >= suggest
  const strn = exists ? strength(score, hp) : null

  const fc = !exists
    ? makeFireControl(false, false, 'below_suggest_threshold')
    : makeFireControl(true, false, 'threshold_passed')

  return {
    category: 'monotony_prevention',
    exists,
    score,
    state: exists ? 'MONOTONY_WATCH' : null,
    strength: strn,
    fire_control: fc,
  }
}

// ---------------------------------------------------------------------------
// Priority resolution
// ---------------------------------------------------------------------------

// Priority order: rest_required (1) > monotony_prevention (2)
const PRIORITY: Record<string, number> = { rest_required: 1, monotony_prevention: 2 }

/** Select the highest-priority fired candidate (priority then score desc). */
function selectCandidate(candidates: Candidate[]): Candidate | null {
  const fired = candidates.filter((c) => c.fire_control.fired)
  if (fired.length === 0) return null
  fired.sort((a, b) => {
    const pa = PRIORITY[a.category] ?? 99
    const pb = PRIORITY[b.category] ?? 99
    if (pa !== pb) return pa - pb
    return b.score - a.score
  })
  return fired[0]
}

// ---------------------------------------------------------------------------
// Result type mapping
// ---------------------------------------------------------------------------

/** Map candidate selection to one of the 5 result types. */
function resultTypeFrom(selected: Candidate | null, restCandidate: Candidate): string {
  if (selected === null) {
    if (restCandidate.exists && restCandidate.fire_control.suppressed) {
      return 'NO_PRACTICAL_ACTION_FALLBACK'
    }
    return 'NO_TRIGGER'
  }

  if (selected.category === 'rest_required') {
    if (selected.strength === 'strong') {
      return 'SEVERE_INTERVENTION'
    }
    return 'REST_PROPOSAL'
  }

  // monotony_prevention (or any other category)
  return 'SOFT_WARNING'
}

// ---------------------------------------------------------------------------
// State label helpers
// ---------------------------------------------------------------------------

/** Map rest_required_score to a REST_* state label. */
function restStateLabel(score: number, hp: Record<string, unknown>): string {
  const suggest = toNum(hp['threshold_suggest'], 0.62)
  const recommend = toNum(hp['threshold_recommend'], 0.76)
  const urgent = toNum(hp['threshold_urgent'], 0.88)
  const watch = 0.45
  if (score >= urgent) return 'REST_URGENT'
  if (score >= recommend) return 'REST_RECOMMEND'
  if (score >= suggest) return 'REST_RECOMMEND'
  if (score >= watch) return 'REST_WATCH'
  return 'REST_NORMAL'
}

/** Map monotony_prevention_score to a MONOTONY_* state label. */
function monotonyStateLabel(score: number, hp: Record<string, unknown>): string {
  const suggest = toNum(hp['threshold_suggest'], 0.62)
  if (score >= suggest) return 'MONOTONY_WATCH'
  return 'MONOTONY_NORMAL'
}

// ---------------------------------------------------------------------------
// Proposal builder
// ---------------------------------------------------------------------------

const REST_PROPOSALS: Record<string, { ja: string; en: string }> = {
  gentle: {
    ja: '長時間の運転が続いています。近くの休憩施設でご休憩をお勧めします。',
    en: 'You have been driving for a long time. We recommend resting at the nearby facility.',
  },
  clear: {
    ja: '疲労サインが検出されました。早めの休憩をお勧めします。',
    en: 'Fatigue signals detected. We recommend resting soon.',
  },
  strong: {
    ja: '安全のため、直ちに休憩を取ってください。',
    en: 'For safety, please rest immediately.',
  },
}

const MONOTONY_PROPOSALS: Record<string, { ja: string; en: string }> = {
  gentle: {
    ja: '単調な走行が続いています。気分転換をお勧めします。',
    en: 'Monotonous driving detected. Consider a short break or content.',
  },
  clear: {
    ja: '注意力の低下が検出されました。安全運転に注意してください。',
    en: 'Attention drop detected. Please drive with caution.',
  },
  strong: {
    ja: '注意力が著しく低下しています。休憩をお勧めします。',
    en: 'Significant attention drop. Rest is recommended.',
  },
}

function buildProposal(selected: Candidate): Proposal {
  if (selected.category === 'rest_required') {
    const message = REST_PROPOSALS[selected.strength ?? 'gentle'] ?? REST_PROPOSALS['gentle']
    return { id: `${selected.category}_proposal`, message, options: ['accept_rest', 'postpone', 'decline'] }
  }
  const message = MONOTONY_PROPOSALS[selected.strength ?? 'gentle'] ?? MONOTONY_PROPOSALS['gentle']
  return { id: `${selected.category}_proposal`, message, options: ['acknowledge', 'decline'] }
}

// ---------------------------------------------------------------------------
// Explanation + reason_inputs
// ---------------------------------------------------------------------------

function fmt3(value: number): string {
  return value.toFixed(3)
}

/** Python repr() of a string: single-quoted. */
function pyRepr(value: string): string {
  return `'${value}'`
}

function buildExplanation(
  selected: Candidate | null,
  baseSafetyRisk: number,
  restRequiredScore: number,
  monotonyPreventionScore: number,
): { reasonInputs: string[]; explanation: string } {
  if (selected === null) {
    return {
      reasonInputs: ['base_safety_risk', 'monotony_prevention_score'],
      explanation:
        `No trigger: base_safety_risk=${fmt3(baseSafetyRisk)}, `
        + `monotony_prevention=${fmt3(monotonyPreventionScore)}.`,
    }
  }

  if (selected.category === 'rest_required') {
    return {
      reasonInputs: [
        'drowsiness_score', 'fatigue_score', 'driving_anomaly_score',
        'future_fatigue_score', 'base_safety_risk', 'rest_window_score',
        'rest_scarcity_score', 'rest_required_score',
      ],
      explanation:
        `rest_required_score=${fmt3(restRequiredScore)} `
        + `(base=${fmt3(baseSafetyRisk)}) ≥ threshold; `
        + `strength=${pyRepr(selected.strength ?? '')}.`,
    }
  }

  return {
    reasonInputs: [
      'monotony_score', 'familiar_route_score', 'attention_drop_score',
      'traffic_jam_score', 'long_highway_score', 'monotony_prevention_score',
    ],
    explanation:
      `monotony_prevention_score=${fmt3(monotonyPreventionScore)} ≥ threshold; `
      + `strength=${pyRepr(selected.strength ?? '')}.`,
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Evaluate the weighted_score algorithm and return a full §11 DecisionResult.
 *
 * Hybrid fields (scores, states) are populated; next_package_runtime_state
 * is always {} (M2).
 */
export function evaluateWeighted(
  context: Record<string, unknown>,
  _parameters: Record<string, unknown>,
  hyperparameters: Record<string, unknown>,
): DecisionResult {
  const raw = (context['raw_state'] as Record<string, unknown>) ?? {}
  const { normalized } = buildFeatureGroups(raw)
  const norm = normalized as Record<string, unknown>

  // -- Compute all scores --
  const sc = computeScores(raw, norm, hyperparameters)
  const baseSafetyRisk = sc.base_safety_risk
  const restRequiredScore = sc.rest_required_score
  const monotonyPreventionScore = sc.monotony_prevention_score
  const nextRestMin = sc.nextRestMin

  const scores = {
    base_safety_risk: baseSafetyRisk,
    rest_required_score: restRequiredScore,
    monotony_prevention_score: monotonyPreventionScore,
  }

  // -- State labels --
  const states = {
    rest: restStateLabel(restRequiredScore, hyperparameters),
    monotony: monotonyStateLabel(monotonyPreventionScore, hyperparameters),
  }

  // -- Build candidates --
  const restCand = buildRestCandidate(restRequiredScore, hyperparameters, nextRestMin)
  const monoCand = buildMonotonyCandidate(monotonyPreventionScore, hyperparameters)
  const candidates = [restCand, monoCand]

  // -- Priority resolution --
  const selected = selectCandidate(candidates)

  // -- Result type --
  const resultType = resultTypeFrom(selected, restCand)
  const triggerCandidate = selected !== null

  // -- Overall fire_control (mirrors selected candidate's fire_control) --
  let overallFc: FireControl
  if (selected !== null) {
    overallFc = makeFireControl(true, false, selected.fire_control.reason)
  } else if (restCand.fire_control.suppressed) {
    overallFc = makeFireControl(false, true, restCand.fire_control.reason)
  } else {
    overallFc = makeFireControl(false, false, 'no_candidate_above_threshold')
  }

  // -- Proposal --
  const proposal = selected !== null ? buildProposal(selected) : null

  // -- Explanation + reason_inputs --
  const { reasonInputs, explanation } = buildExplanation(
    selected, baseSafetyRisk, restRequiredScore, monotonyPreventionScore,
  )

  return {
    result_type: resultType,
    trigger_candidate: triggerCandidate,
    selected_category: selected !== null ? selected.category : null,
    score: selected !== null ? selected.score : null,
    features: {}, // weighted_score uses numeric scores, not ordinal features
    scores,
    states,
    criteria: {
      threshold_suggest: toNum(hyperparameters['threshold_suggest'], 0.62),
      threshold_recommend: toNum(hyperparameters['threshold_recommend'], 0.76),
      threshold_urgent: toNum(hyperparameters['threshold_urgent'], 0.88),
    },
    candidates,
    fire_control: overallFc,
    proposal,
    reason_inputs: reasonInputs,
    explanation,
    next_package_runtime_state: {},
  }
}
