/**
 * formulationTemplates (feature 009, FE3) — static per-package "formula-as-UI"
 * data consumed by AlgorithmFormulationPanel.tsx.
 *
 * This file is DATA, not logic: it describes how each shipped package's math
 * is laid out — which output each formula line computes, and, token by
 * token, which parts are plain text, which are editable hyperparameter
 * coefficients (rendered as inline `[value]` fields bound to the package
 * manifest's `hyperparameters[]`), and which are feature/signal cross-links
 * (rendered as clickable/hoverable names that dispatch
 * SET_HIGHLIGHTED_SIGNAL so SignalsPanel can highlight the source row).
 *
 * Sourced from `specs/009-signal-tier-redesign/data-model.md` §5 (Compact
 * Hybrid) and §6 (NRI, cross-checked against
 * `packages/nri_fatigue_score_v1/algorithm.py`'s docstring formula, which is
 * the actual implementation NRI's data-model entry defers to).
 *
 * `link` keys are cross-link targets: where a formula term corresponds
 * exactly to one of SignalsPanel's `signal-row-*` keys (see SignalsPanel.tsx)
 * the alias is spelled out here (e.g. Hybrid's `driving_anomaly` feature is
 * the same quantity SignalsPanel shows as `anomaly_rate`) so hover/click
 * highlights the right row. Terms with no corresponding SignalsPanel row
 * (e.g. internal-only runtime quantities like `jam_min`/`weatherRiskLevel`)
 * are rendered as plain, non-linking text.
 */

export type FormulaPart =
  | { text: string }
  | { coef: string }
  | { link: string; text?: string }

export type FormulaLine = {
  /** The name on the left-hand side of `=`, e.g. "base_safety_risk". */
  output: string
  parts: FormulaPart[]
}

export type ThresholdRead = {
  /** e.g. "rest_required" or "monotony_prevention". */
  scoreName: string
  /** Ordered list of (label, hyperparameter key) pairs, e.g. suggest/recommend/urgent. */
  steps: { label: string; coef: string }[]
}

export type FormulationSection = {
  id: string
  title: string
  lines?: FormulaLine[]
  thresholdReads?: ThresholdRead[]
  /** Leftover hyperparameters shown as a simple inline coefficient list (no formula context). */
  extraHyperparameters?: string[]
}

export type PackageFormulationTemplate = {
  packageId: string
  sections: FormulationSection[]
}

// ── Compact Hybrid Trigger v0.2 (aica_transparent_hybrid_trigger_v1) ───────

const HYBRID_TEMPLATE: PackageFormulationTemplate = {
  packageId: 'aica_transparent_hybrid_trigger_v1',
  sections: [
    {
      id: 'features',
      title: 'Features',
      lines: [
        { output: 'drowsiness', parts: [{ link: 'drowsiness' }, { text: ' / 100' }] },
        { output: 'fatigue', parts: [{ link: 'fatigue' }, { text: ' / 100' }] },
        {
          output: 'driving_anomaly',
          parts: [
            { text: 'clamp( ' },
            { link: 'anomaly_rate', text: 'anomaly_rate' },
            { text: ' / ' },
            { coef: 'K' },
            { text: ' )' },
          ],
        },
        {
          output: 'env_load',
          parts: [
            { text: 'clamp( 0.5·jam + 0.3·highway + 0.2·weather )' },
          ],
        },
        {
          output: 'monotony',
          parts: [
            { text: 'clamp( 0.6·mono_min/30 + 0.4·' },
            { link: 'isNight', text: 'isNight' },
            { text: ' )' },
          ],
        },
        { output: 'rest_window', parts: [{ text: 'bins( nextRestSpotMin )' }] },
        { output: 'rest_scarcity', parts: [{ text: 'clamp( (nextRestSpotMin − 10) / 50 )' }] },
        {
          output: 'familiar_route',
          parts: [{ link: 'familiarRoute', text: 'familiarRoute' }, { text: ' ? 1 : 0' }],
        },
      ],
    },
    {
      id: 'base_safety_risk',
      title: 'base_safety_risk',
      lines: [
        {
          output: 'base_safety_risk',
          parts: [
            { text: 'clamp( ' },
            { coef: 'w_drowsiness' },
            { text: '·' },
            { link: 'drowsiness' },
            { text: ' + ' },
            { coef: 'w_fatigue' },
            { text: '·' },
            { link: 'fatigue' },
            { text: ' + ' },
            { coef: 'w_driving_anomaly' },
            { text: '·' },
            { link: 'anomaly_rate', text: 'driving_anomaly' },
            { text: ' + ' },
            { coef: 'w_env' },
            { text: '·' },
            { link: 'env_load' },
            { text: ' )' },
          ],
        },
      ],
    },
    {
      id: 'rest_required',
      title: 'rest_required',
      lines: [
        {
          output: 'rest_required_score',
          parts: [
            { text: 'clamp( ' },
            { link: 'base_safety_risk' },
            { text: ' + [base_safety_risk ≥ ' },
            { coef: 'minimum_risk_for_rest_bonus' },
            { text: ']·(' },
            { coef: 'w_rest_window' },
            { text: '·' },
            { link: 'rest_window' },
            { text: ' + ' },
            { coef: 'w_rest_scarcity' },
            { text: '·' },
            { link: 'rest_scarcity' },
            { text: ') )' },
          ],
        },
      ],
      thresholdReads: [
        {
          scoreName: 'rest_required',
          steps: [
            { label: 'watch', coef: 'rest_watch_threshold' },
            { label: 'suggest', coef: 'threshold_suggest' },
            { label: 'recommend', coef: 'threshold_recommend' },
            { label: 'urgent', coef: 'threshold_urgent' },
          ],
        },
      ],
    },
    {
      id: 'monotony_prevention',
      title: 'monotony_prevention',
      lines: [
        {
          output: 'monotony_prevention_score',
          parts: [
            { text: 'clamp( ' },
            { coef: 'w_monotony' },
            { text: '·' },
            { link: 'monotony' },
            { text: ' + ' },
            { coef: 'w_env_mono' },
            { text: '·' },
            { link: 'env_load' },
            { text: ' + ' },
            { coef: 'w_familiar' },
            { text: '·' },
            { link: 'familiarRoute', text: 'familiar_route' },
            { text: ' )' },
          ],
        },
      ],
      thresholdReads: [
        {
          scoreName: 'monotony_prevention',
          steps: [
            { label: 'watch', coef: 'monotony_watch_threshold' },
            { label: 'suggest', coef: 'monotony_suggest_threshold' },
            { label: 'recommend', coef: 'monotony_recommend_threshold' },
            { label: 'urgent', coef: 'monotony_urgent_threshold' },
          ],
        },
      ],
    },
    {
      id: 'fire_control',
      title: 'fire-control',
      extraHyperparameters: [
        'smoothing_alpha',
        'rest_persistence_ticks',
        'monotony_persistence_ticks',
        'skip_if_score',
        'skip_if_velocity',
        'emergency_override_threshold',
        'rest_cooldown_sec',
        'monotony_cooldown_sec',
        'max_proposals_per_30min',
      ],
    },
  ],
}

// ── NRI Fatigue Accumulation Score v0.1 (nri_fatigue_score_v1) ─────────────
// Formula per packages/nri_fatigue_score_v1/algorithm.py's docstring
// (data-model.md §6 defers to it verbatim: "math is UNCHANGED").

const NRI_TEMPLATE: PackageFormulationTemplate = {
  packageId: 'nri_fatigue_score_v1',
  sections: [
    {
      id: 's_base',
      title: 'S_base',
      lines: [
        {
          output: 'S_base',
          parts: [
            { text: '( ' },
            { link: 'childPassenger', text: 'child_passenger' },
            { text: ' ? ' },
            { coef: 'w_child' },
            { text: ' : 0 ) + ' },
            { link: 'continuousDrivingMin', text: 'continuous_driving_min' },
            { text: '·' },
            { coef: 'w_base' },
            { text: '·( ' },
            { link: 'isNight', text: 'is_night' },
            { text: ' ? ' },
            { coef: 'm_night' },
            { text: ' : 1 )·( ' },
            { link: 'familiarRoute', text: 'familiar_route' },
            { text: ' ? ' },
            { coef: 'm_familiar' },
            { text: ' : 1 )' },
          ],
        },
      ],
    },
    {
      id: 's_env',
      title: 'S_env',
      lines: [
        {
          output: 'S_env',
          parts: [
            { link: 'traffic_jam' },
            { text: '·' },
            { coef: 'w_jam' },
            { text: ' + ' },
            { link: 'long_highway' },
            { text: '·' },
            { coef: 'w_highway' },
            { text: ' + ' },
            { link: 'monotony' },
            { text: '·' },
            { coef: 'w_monotonous' },
          ],
        },
      ],
    },
    {
      id: 's_realtime',
      title: 'S_realtime',
      lines: [
        {
          output: 'S_realtime',
          parts: [
            { text: 'max(0, ' },
            { link: 'drowsiness' },
            { text: ' − ' },
            { coef: 'theta_sleep' },
            { text: ')·' },
            { coef: 'w_sleep' },
            { text: ' + max(0, ' },
            { link: 'fatigue' },
            { text: ' − ' },
            { coef: 'theta_fatigue' },
            { text: ')·' },
            { coef: 'w_fatigue' },
          ],
        },
      ],
    },
    {
      id: 's_total',
      title: 'S_total (rest_required)',
      lines: [
        {
          output: 'S_total',
          parts: [{ link: 'S_base' }, { text: ' + ' }, { link: 'S_env' }, { text: ' + ' }, { link: 'S_realtime' }],
        },
      ],
      thresholdReads: [
        {
          scoreName: 'rest_required',
          steps: [
            { label: 'suggest', coef: 'threshold_suggest' },
            { label: 'recommend', coef: 'threshold_recommend' },
            { label: 'urgent', coef: 'threshold_urgent' },
            { label: 'fire', coef: 'threshold_fire' },
          ],
        },
      ],
    },
    {
      id: 'fire_control',
      title: 'fire-control',
      extraHyperparameters: [
        'rest_spot_eta_filter_min',
        'persistence_ticks',
        'rest_cooldown_sec',
        'max_proposals_per_30min',
        'emergency_override_threshold',
      ],
    },
  ],
}

const TEMPLATES: Record<string, PackageFormulationTemplate> = {
  [HYBRID_TEMPLATE.packageId]: HYBRID_TEMPLATE,
  [NRI_TEMPLATE.packageId]: NRI_TEMPLATE,
}

/** Returns the formulation template for a package id, or undefined if none is authored yet. */
export function getFormulationTemplate(packageId: string): PackageFormulationTemplate | undefined {
  return TEMPLATES[packageId]
}

/** Every hyperparameter key referenced anywhere in a template (coef tokens + extraHyperparameters). */
export function templateHyperparameterKeys(template: PackageFormulationTemplate): Set<string> {
  const keys = new Set<string>()
  for (const section of template.sections) {
    for (const line of section.lines ?? []) {
      for (const part of line.parts) {
        if ('coef' in part) keys.add(part.coef)
      }
    }
    for (const read of section.thresholdReads ?? []) {
      for (const step of read.steps) keys.add(step.coef)
    }
    for (const key of section.extraHyperparameters ?? []) keys.add(key)
  }
  return keys
}
