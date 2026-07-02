/**
 * declarative_rule algorithm.
 *
 * Ported from `app/api/aica_api/algorithms/declarative_rule.py` (behavior-of-record).
 * Pure, deterministic, side-effect-free. Same inputs -> same DecisionResult.
 * All values are qualitative ordinals; no raw numbers enter the decision path.
 *
 * Decision flow (first-match R1-R5):
 *   R1  SEVERE_INTERVENTION        drowsiness=severe OR damped >= severeCut
 *   R2  NO_PRACTICAL_ACTION_FALLBACK  damped >= proposalCut AND rest NOT reachable
 *   R3  REST_PROPOSAL               damped >= proposalCut AND rest reachable
 *   R4  SOFT_WARNING                damped >= reactionPoint
 *   R5  NO_TRIGGER                  catch-all
 *
 * Cut-points (ordinal arithmetic, hyperparameter-driven):
 *   reactionPoint = 1.8 - ord(trigger_sensitivity) * 0.4
 *   proposalCut   = 2.0 + ord(proposal_threshold)  * 1.0
 *   severeCut     = 3.0 + ord(severe_threshold)    * 1.0
 *
 * Blend and persistence damping (porting functional skeleton):
 *   blend  = drowsiness*(0.5+0.25*wD) + fatigue*(0.2*wF) + drive*0.4
 *   damped = max(0, blend - shortfall + persistenceLift)
 *     shortfall       = max(0, (req+1) - dur)
 *     persistenceLift = max(0, dur-1) * 0.6
 *
 * wD and wF default to 1 (medium) when absent from the hyperparameters dict.
 *
 * Only the exported function identifier (`evaluateDeclarative`) is camelCased.
 * All DecisionResult object keys and every ordinal/band/reason string value
 * are preserved byte-for-byte from the Python because they cross the parity
 * boundary.
 */

import type { Candidate, DecisionResult, FireControl, Proposal } from '../../api/types'

// ---------------------------------------------------------------------------
// ORD table (mirrors the Python _ORD dict, which mirrors the JS ORD constant
// in evaluate_trigger.mjs exactly). "moderate" is set once (ord=2, from the
// drowsiness group) and shared across features.
// ---------------------------------------------------------------------------

const ORD: Record<string, number> = {
  // drowsiness_level
  none: 0, weak: 1, moderate: 2, strong: 3, severe: 4,
  // fatigue_level / band weights / thresholds / sensitivities
  low: 0, medium: 1, high: 2,
  // signal_duration
  transient: 0, brief: 1, sustained: 2, persistent: 3,
  // continuous_driving_time - "moderate" already defined above (-> 2)
  short: 0, long: 2,
  // rest_spot_eta - "none" already defined above (-> 0)
  near: 1, far: 2,
}

function ord(value: unknown): number {
  if (typeof value === 'string' && value in ORD) {
    return ORD[value]
  }
  return 0
}

/**
 * Extract the ordinal bands dict from either M1 (flat) or M2 context.
 *
 * For M2 context (with feature_groups.ordinal): returns the ordinal sub-dict.
 * For M1 context (flat string values at the top level): returns ctx directly.
 */
function resolveOrdinals(ctx: Record<string, unknown>): Record<string, unknown> {
  const fg = ctx['feature_groups']
  if (fg && typeof fg === 'object') {
    const ordinal = (fg as Record<string, unknown>)['ordinal']
    if (ordinal && typeof ordinal === 'object') {
      return ordinal as Record<string, unknown>
    }
  }
  return ctx
}

// ---------------------------------------------------------------------------
// Stage 1: blend danger signals
// ---------------------------------------------------------------------------

function blend(ordinals: Record<string, unknown>, hp: Record<string, unknown>): number {
  const wD = ord(hp['weight_drowsiness'] ?? 'medium')
  const wF = ord(hp['weight_fatigue'] ?? 'medium')
  const drowsiness = ord(ordinals['drowsiness_level'] ?? 'none')
  const fatigue = ord(ordinals['fatigue_level'] ?? 'low')
  const drive = ord(ordinals['continuous_driving_time'] ?? 'short')
  return drowsiness * (0.5 + 0.25 * wD) + fatigue * (0.2 * wF) + drive * 0.4
}

// ---------------------------------------------------------------------------
// Stage 2: persistence damping
// ---------------------------------------------------------------------------

function damped(ordinals: Record<string, unknown>, hp: Record<string, unknown>): number {
  const b = blend(ordinals, hp)
  const dur = ord(ordinals['signal_duration'] ?? 'transient')
  const req = ord(hp['persistence_requirement'] ?? 'medium')
  const shortfall = Math.max(0, req + 1 - dur)
  const persistenceLift = Math.max(0, dur - 1) * 0.6
  return Math.max(0.0, b - shortfall + persistenceLift)
}

// ---------------------------------------------------------------------------
// Stage 3: cut-points
// ---------------------------------------------------------------------------

function reactionPoint(hp: Record<string, unknown>): number {
  return 1.8 - ord(hp['trigger_sensitivity'] ?? 'medium') * 0.4
}

function proposalCut(hp: Record<string, unknown>): number {
  return 2.0 + ord(hp['proposal_threshold'] ?? 'medium') * 1.0
}

function severeCut(hp: Record<string, unknown>): number {
  return 3.0 + ord(hp['severe_threshold'] ?? 'medium') * 1.0
}

// ---------------------------------------------------------------------------
// Actionability guard
// ---------------------------------------------------------------------------

/**
 * Return true if a rest action is practically reachable.
 * Mirrors `restReachable` / `_rest_reachable`:
 *   - require_actionable=False -> always reachable.
 *   - rest_spot_eta='none'    -> not reachable.
 *   - rest_spot_eta='far' AND rest_spot_sensitivity=low -> not reachable.
 *   - Otherwise               -> reachable.
 */
function restReachable(ordinals: Record<string, unknown>, hp: Record<string, unknown>): boolean {
  const requireActionable = hp['require_actionable']
  if (requireActionable !== undefined && requireActionable !== true) {
    return true
  }
  const eta = ordinals['rest_spot_eta'] ?? 'none'
  if (eta === 'none') {
    return false
  }
  if (eta === 'far' && ord(hp['rest_spot_sensitivity'] ?? 'medium') === 0) {
    return false
  }
  return true
}

// ---------------------------------------------------------------------------
// Candidate and result builders
// ---------------------------------------------------------------------------

function makeCandidate(args: {
  category: string
  score: number
  exists: boolean
  fired: boolean
  suppressed: boolean
  strength: string | null
  reason: string
}): Candidate {
  return {
    category: args.category,
    exists: args.exists,
    score: args.score,
    state: null,
    strength: args.strength,
    fire_control: {
      fired: args.fired,
      suppressed: args.suppressed,
      override: false,
      reason: args.reason,
    },
  }
}

function fireControl(args: { suppressed: boolean; reason: string | null }): FireControl {
  return { fired: !args.suppressed, suppressed: args.suppressed, override: false, reason: args.reason }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Evaluate the declarative_rule algorithm and return a full DecisionResult.
 *
 * Hybrid-only fields (`scores`, `states`, `next_package_runtime_state`) are
 * always empty for this algorithm.
 */
export function evaluateDeclarative(
  context: Record<string, unknown>,
  _parameters: Record<string, unknown>,
  hyperparameters: Record<string, unknown>,
): DecisionResult {
  const hp = hyperparameters
  const ordinals = resolveOrdinals(context)
  const d = damped(ordinals, hp)
  const reaction = reactionPoint(hp)
  const propCut = proposalCut(hp)
  const sevCut = severeCut(hp)
  const reachable = restReachable(ordinals, hp)

  const criteria = {
    reaction_point: reaction,
    proposal_cut: propCut,
    severe_cut: sevCut,
  }

  // Features come from the ordinal bands dict, not from the raw context.
  const features: Record<string, string> = {}
  for (const [k, v] of Object.entries(ordinals)) {
    if (typeof v === 'string') {
      features[k] = v
    }
  }

  // ------------------------------------------------------------------
  // R1 - SEVERE_INTERVENTION
  // ------------------------------------------------------------------
  if (ordinals['drowsiness_level'] === 'severe' || d >= sevCut) {
    let reasonInputs: string[]
    let explanation: string
    if (context['drowsiness_level'] === 'severe') {
      reasonInputs = ['drowsiness_level']
      explanation = 'Drowsiness is at the severe level — immediate intervention required.'
    } else {
      reasonInputs = [
        'drowsiness_level', 'fatigue_level', 'signal_duration',
        'weight_drowsiness', 'severe_threshold',
      ]
      explanation = 'Damped fatigue/drowsiness blend reached the severe cut-point.'
    }
    const candidate = makeCandidate({
      category: 'rest_required', score: d, exists: true,
      fired: true, suppressed: false, strength: 'severe',
      reason: 'severe_cut_passed',
    })
    return {
      result_type: 'SEVERE_INTERVENTION',
      trigger_candidate: true,
      selected_category: 'rest_required',
      score: d,
      features,
      scores: {}, states: {},
      criteria,
      candidates: [candidate],
      fire_control: fireControl({ suppressed: false, reason: 'severe_cut_passed' }),
      proposal: null,
      reason_inputs: reasonInputs,
      explanation,
      next_package_runtime_state: {},
    }
  }

  // ------------------------------------------------------------------
  // Proposing band: damped >= proposalCut
  // ------------------------------------------------------------------
  if (d >= propCut) {
    // R2 - NO_PRACTICAL_ACTION_FALLBACK (proposing band, rest unreachable)
    if (!reachable) {
      const candidate = makeCandidate({
        category: 'rest_required', score: d, exists: true,
        fired: false, suppressed: true, strength: 'clear',
        reason: 'actionability_guard_rest_not_reachable',
      })
      return {
        result_type: 'NO_PRACTICAL_ACTION_FALLBACK',
        trigger_candidate: false,
        selected_category: null,
        score: d,
        features,
        scores: {}, states: {},
        criteria,
        candidates: [candidate],
        fire_control: fireControl({
          suppressed: true,
          reason: 'actionability_guard_rest_not_reachable',
        }),
        proposal: null,
        reason_inputs: [
          'drowsiness_level', 'signal_duration', 'continuous_driving_time',
          'proposal_threshold', 'require_actionable', 'rest_spot_eta',
        ],
        explanation: (
          'Damped blend passed the proposal threshold but no actionable '
          + 'rest spot is reachable.'
        ),
        next_package_runtime_state: {},
      }
    }

    // R3 - REST_PROPOSAL
    const candidate = makeCandidate({
      category: 'rest_required', score: d, exists: true,
      fired: true, suppressed: false, strength: 'clear',
      reason: 'proposal_cut_passed_rest_reachable',
    })
    const proposal: Proposal = {
      id: 'rest_guidance',
      message: {
        ja: '長時間の運転が続いています。近くの休憩施設でご休憩をお勧めします。',
        en: (
          'You have been driving for a long time. '
          + 'We recommend resting at the nearby facility.'
        ),
      },
      options: ['accept_rest', 'postpone'],
    }
    return {
      result_type: 'REST_PROPOSAL',
      trigger_candidate: true,
      selected_category: 'rest_required',
      score: d,
      features,
      scores: {}, states: {},
      criteria,
      candidates: [candidate],
      fire_control: fireControl({
        suppressed: false,
        reason: 'proposal_cut_passed_rest_reachable',
      }),
      proposal,
      reason_inputs: [
        'drowsiness_level', 'signal_duration', 'continuous_driving_time',
        'weight_drowsiness', 'persistence_requirement',
        'proposal_threshold', 'rest_spot_eta',
      ],
      explanation: (
        'Damped fatigue/drowsiness blend passed the proposal threshold '
        + 'and a rest spot is reachable.'
      ),
      next_package_runtime_state: {},
    }
  }

  // ------------------------------------------------------------------
  // R4 - SOFT_WARNING
  // ------------------------------------------------------------------
  if (d >= reaction) {
    const candidate = makeCandidate({
      category: 'rest_required', score: d, exists: true,
      fired: false, suppressed: false, strength: 'forming',
      reason: 'below_proposal_cut',
    })
    return {
      result_type: 'SOFT_WARNING',
      trigger_candidate: false,
      selected_category: null,
      score: d,
      features,
      scores: {}, states: {},
      criteria,
      candidates: [candidate],
      fire_control: { fired: false, suppressed: false, override: false, reason: 'below_proposal_cut' },
      proposal: null,
      reason_inputs: [
        'drowsiness_level', 'signal_duration',
        'trigger_sensitivity', 'proposal_threshold',
      ],
      explanation: (
        'Damped blend reached the reaction point but has not yet crossed '
        + 'the proposal threshold.'
      ),
      next_package_runtime_state: {},
    }
  }

  // ------------------------------------------------------------------
  // R5 - NO_TRIGGER (catch-all)
  // ------------------------------------------------------------------
  const candidate = makeCandidate({
    category: 'rest_required', score: d, exists: false,
    fired: false, suppressed: false, strength: null,
    reason: 'below_reaction_point',
  })
  return {
    result_type: 'NO_TRIGGER',
    trigger_candidate: false,
    selected_category: null,
    score: d,
    features,
    scores: {}, states: {},
    criteria,
    candidates: [candidate],
    fire_control: { fired: false, suppressed: false, override: false, reason: 'below_reaction_point' },
    proposal: null,
    reason_inputs: ['drowsiness_level', 'signal_duration', 'trigger_sensitivity'],
    explanation: 'Damped blend is below the reaction point — no action required.',
    next_package_runtime_state: {},
  }
}
