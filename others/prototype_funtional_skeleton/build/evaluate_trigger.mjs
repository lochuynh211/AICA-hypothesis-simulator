// evaluate_trigger.mjs — role evaluateTrigger (TP-001 v5)
//
// Pure, side-effect-free implementation of the temporary parametric trigger
// logic of behavior_model/temporary_logic.md §1/§3. It blends the weighted
// danger signals into one qualitative risk reading, damps it by the persistence
// requirement, and classifies the damped reading against the reaction point and
// the escalation cut-points — and crucially those cut-points are the **algorithm
// hyperparameters**, so moving a hyperparameter moves which result fires (the
// trigger is genuinely tunable, not frozen at default hyperparameters). All
// values are qualitative ordinals (positions in a closed catalog value set); no
// concrete thresholds, minutes, distances, or scores. No I/O, no globals.
//
// v5 carry-forward (REQ-INT-013 / DIFF-014, networked surface target): this engine
// is byte-identical to v4. On the networked map surface the SAME ordinal bands are
// sourced from the real route via the boundary-binning of surface_binning.mjs
// BEFORE the engine — no concrete route quantity reaches this decision logic, so
// Constitution Principle III is preserved. The engine is byte-identical between the
// offline (v4) and networked (v5) surfaces.
//
// evaluateTrigger(inputState) -> { result_type, rule_id, reason_inputs }

// Ordinal position of each catalog value within its closed value set. These are
// positions in an enum (qualitative bands), never magnitudes for behavior.
const ORD = {
  // drowsiness_level
  none: 0, weak: 1, moderate: 2, strong: 3, severe: 4,
  // fatigue_level / weights / thresholds / sensitivities / eagerness
  low: 0, medium: 1, high: 2,
  // signal_duration
  transient: 0, brief: 1, sustained: 2, persistent: 3,
  // continuous_driving_time
  short: 0, long: 2, // "moderate" already mapped above to 1
  // rest_spot_eta
  near: 1, far: 2, // "none" already mapped above to 0
  // assertiveness
  gentle: 0, balanced: 1, firm: 2,
  // content_safety_strictness
  lenient: 0, standard: 1, strict: 2
};

function ord(v) {
  return Object.prototype.hasOwnProperty.call(ORD, v) ? ORD[v] : 0;
}

// Stage 1 — blend the danger signals into one qualitative risk reading, each
// signal weighted by its weight hyperparameter; continuous driving time adds an
// accumulation contribution. (Ordinal arithmetic over qualitative bands.)
function blendReading(s) {
  const wD = ord(s.weight_drowsiness);     // 0..2
  const wF = ord(s.weight_fatigue);        // 0..2
  const drowsiness = ord(s.drowsiness_level); // 0..4
  const fatigue = ord(s.fatigue_level);       // 0..2
  const drive = ord(s.continuous_driving_time); // 0..2
  // Proportional contribution; weights tilt which signal leads the blend.
  return drowsiness * (0.5 + 0.25 * wD) + fatigue * (0.2 * wF) + drive * 0.4;
}

// Stage 2 — damp the blended reading by signal persistence: a brief sign under a
// higher persistence_requirement is damped; a sustained/persistent sign passes
// undamped and lifts the reading.
function dampedBand(s) {
  const blend = blendReading(s);
  const dur = ord(s.signal_duration);          // 0..3
  const req = ord(s.persistence_requirement);  // 0..2
  const shortfall = Math.max(0, (req + 1) - dur);
  const persistenceLift = Math.max(0, dur - 1) * 0.6;
  return Math.max(0, blend - shortfall + persistenceLift);
}

// Stage 3 — the qualitative cut-points, set by the algorithm hyperparameters.
// Lower dial → lower cut → AICA reacts/escalates more readily; higher dial → the
// band must be higher to cross. Default hyperparameters (sensitivity medium,
// proposal_threshold medium, severe_threshold high) place the cuts so the five
// presets reproduce. These are ordinal band positions, not committed thresholds.
function reactionPoint(s) { return 1.8 - ord(s.trigger_sensitivity) * 0.4; } // low 1.8 · med 1.4 · high 1.0
function proposalCut(s)   { return 2.0 + ord(s.proposal_threshold) * 1.0; }  // low 2.0 · med 3.0 · high 4.0
function severeCut(s)     { return 3.0 + ord(s.severe_threshold) * 1.0; }    // low 3.0 · med 4.0 · high 5.0

// Actionability: a rest action is reachable unless require_actionable is true AND
// rest_spot_eta is none (or far with low rest_spot_sensitivity).
function restReachable(s) {
  if (s.require_actionable !== true) return true;
  if (s.rest_spot_eta === 'none') return false;
  if (s.rest_spot_eta === 'far' && ord(s.rest_spot_sensitivity) === 0) return false;
  return true;
}

export function evaluateTrigger(inputState) {
  const s = inputState;
  const damped = dampedBand(s);
  const reaction = reactionPoint(s);
  const propCut = proposalCut(s);
  const sevCut = severeCut(s);

  // --- Rule R1 — SEVERE_INTERVENTION ---
  // drowsiness severe always intervenes; otherwise the damped band reaching the
  // severe cut-point (set by severe_threshold) escalates.
  if (s.drowsiness_level === 'severe') {
    return { result_type: 'SEVERE_INTERVENTION', rule_id: 'R1', reason_inputs: ['drowsiness_level'] };
  }
  if (damped >= sevCut) {
    return {
      result_type: 'SEVERE_INTERVENTION', rule_id: 'R1',
      reason_inputs: ['drowsiness_level', 'fatigue_level', 'signal_duration', 'weight_drowsiness', 'severe_threshold']
    };
  }

  // --- proposing band — the damped band reaches the proposal cut-point (set by
  // proposal_threshold) but stays below the severe cut-point. ---
  if (damped >= propCut) {
    // --- Rule R2 — NO_PRACTICAL_ACTION_FALLBACK (proposing, but no reachable rest) ---
    if (!restReachable(s)) {
      return {
        result_type: 'NO_PRACTICAL_ACTION_FALLBACK', rule_id: 'R2',
        reason_inputs: ['drowsiness_level', 'signal_duration', 'continuous_driving_time',
          'proposal_threshold', 'require_actionable', 'rest_spot_eta']
      };
    }
    // --- Rule R3 — REST_PROPOSAL ---
    return {
      result_type: 'REST_PROPOSAL', rule_id: 'R3',
      reason_inputs: ['drowsiness_level', 'signal_duration', 'continuous_driving_time',
        'weight_drowsiness', 'persistence_requirement', 'proposal_threshold', 'rest_spot_eta']
    };
  }

  // --- Rule R4 — SOFT_WARNING — reaches the reaction point but not the proposal
  // cut-point (set by trigger_sensitivity vs proposal_threshold). ---
  if (damped >= reaction) {
    return {
      result_type: 'SOFT_WARNING', rule_id: 'R4',
      reason_inputs: ['drowsiness_level', 'signal_duration', 'trigger_sensitivity', 'proposal_threshold']
    };
  }

  // --- Rule R5 — catch-all → NO_TRIGGER (below the reaction point) ---
  return {
    result_type: 'NO_TRIGGER', rule_id: 'R5',
    reason_inputs: ['drowsiness_level', 'signal_duration', 'trigger_sensitivity']
  };
}
