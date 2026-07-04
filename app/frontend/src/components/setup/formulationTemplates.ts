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

import type { BilingualLabel } from '../../i18n/t'

export type FormulaPart =
  | { text: string }
  | { coef: string }
  | { link: string; text?: string }

/** One row of a binning table: the input range and the value it maps to. */
export type BinBand = { when: string; value: string }

/** Reveals what a `bins(...)` term actually computes (shown behind an ⓘ). */
export type BinInfo = {
  /** What quantity is being binned. */
  input: BilingualLabel
  /** Ordered band table (range → output value). */
  bands: BinBand[]
}

export type FormulaLine = {
  /** The name on the left-hand side of `=`, e.g. "base_safety_risk". */
  output: string
  parts: FormulaPart[]
  /** Present when the line uses `bins(...)`: the band table shown behind an ⓘ. */
  binInfo?: BinInfo
}

export type ThresholdRead = {
  /** e.g. "rest_required" or "monotony_prevention". */
  scoreName: string
  /** The score/feature key being compared — rendered as a cross-link header so
   *  the reader sees exactly which quantity each threshold is checked against. */
  scoreKey?: string
  /** Ordered list of threshold steps; `meaning` says what crossing it does. */
  steps: { label: string; coef: string; meaning?: BilingualLabel }[]
}

/**
 * One explicit comparison a fire-control stage makes: which measured value is
 * checked, the operator, the threshold hyperparameter it's compared against, and
 * what happens when the condition holds. Renders as
 *   `{operand} {op} [coef] → {outcome}`
 * so it's unambiguous what each threshold is tested against.
 */
export type StepCheck = {
  /** The measured value being compared (e.g. "Rest/Monotony score"). */
  operand: BilingualLabel
  /** Comparison operator shown between operand and threshold, e.g. "≥" or "<". */
  op: string
  /** The threshold hyperparameter (rendered inline as an editable coefficient). */
  coef: string
  /** What happens when the condition holds. */
  outcome: BilingualLabel
}

/**
 * One stage of a step-by-step pipeline explanation (used for fire-control),
 * rendered as a numbered item: prose describing what the stage does, plus either
 * explicit `checks` (measured-value vs threshold comparisons) or bare `coefs`
 * shown inline as editable coefficients.
 */
export type ExplainedStep = {
  /** What this stage does, in words. */
  text: string
  /** Hyperparameters this stage uses when it has no explicit `checks`. */
  coefs?: string[]
  /** Explicit comparisons this stage makes (preferred over `coefs`). */
  checks?: StepCheck[]
}

export type FormulationSection = {
  id: string
  title: string
  lines?: FormulaLine[]
  thresholdReads?: ThresholdRead[]
  /** Step-by-step pipeline explanation (each stage names the hyperparameter it uses). */
  steps?: ExplainedStep[]
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
      title: 'Features (per-signal)',
      lines: [
        { output: 'drowsiness', parts: [{ link: 'drowsiness' }, { text: ' ÷ 100' }] },
        { output: 'fatigue', parts: [{ link: 'fatigue' }, { text: ' ÷ 100' }] },
        {
          output: 'driving_anomaly',
          parts: [
            { text: 'clamp( ' },
            { link: 'anomaly_rate' },
            { text: ' ÷ ' },
            { coef: 'K' },
            { text: ' )' },
          ],
        },
        {
          output: 'driving_time',
          parts: [
            { text: 'bins( ' },
            { link: 'continuousDrivingMin' },
            { text: ' since last rest )' },
          ],
          binInfo: {
            input: { en: 'Minutes driven since the last rest', ja: '前回の休憩からの運転分数' },
            bands: [
              { when: '< 60 min', value: '0.0' },
              { when: '60–120 min', value: '0.4' },
              { when: '120–180 min', value: '0.7' },
              { when: '≥ 180 min', value: '1.0' },
            ],
          },
        },
        {
          output: 'rest_window',
          parts: [{ text: 'bins( ' }, { link: 'nextRestSpotMin' }, { text: ' )' }],
          binInfo: {
            input: { en: 'Minutes to the next rest spot', ja: '次の休憩地点までの分数' },
            bands: [
              { when: '≤ 3 min', value: '0.6' },
              { when: '3–10 min', value: '1.0' },
              { when: '10–20 min', value: '0.6' },
              { when: '> 20 min', value: '0.2' },
              { when: 'none ahead', value: '0.0' },
            ],
          },
        },
        {
          output: 'rest_scarcity',
          parts: [{ text: 'clamp( ( ' }, { link: 'nextRestSpotMin' }, { text: ' − 10 ) ÷ 50 )' }],
        },
        {
          output: 'familiar_route',
          parts: [{ link: 'familiarRoute' }, { text: ' ? 1 : 0' }],
        },
      ],
    },
    {
      id: 'combined',
      title: 'Combined features (multi-signal)',
      lines: [
        {
          output: 'env_load',
          parts: [
            { text: 'clamp( 0.5·' },
            { link: 'isTrafficJam' },
            { text: ' + 0.3·' },
            { link: 'segmentType', text: 'highway' },
            { text: '-min + 0.2·' },
            { link: 'weatherRisk' },
            { text: ' )' },
          ],
        },
        {
          output: 'monotony',
          parts: [
            { text: 'clamp( 0.6·' },
            { link: 'segmentType', text: 'monotonous' },
            { text: '-min/30 + 0.4·' },
            { link: 'isNight' },
            { text: ' )' },
          ],
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
            { link: 'driving_anomaly' },
            { text: ' + ' },
            { coef: 'w_driving_time' },
            { text: '·' },
            { link: 'driving_time' },
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
            { text: ') + [' },
            { link: 'childPassenger', text: 'childPassenger' },
            { text: ']·' },
            { coef: 'w_child_bonus' },
            { text: ' )' },
          ],
        },
      ],
      thresholdReads: [
        {
          scoreName: 'rest_required',
          scoreKey: 'rest_required_score',
          steps: [
            { label: 'watch', coef: 'rest_watch_threshold', meaning: { en: 'enters WATCH — monitoring, no proposal yet', ja: 'WATCH（監視）に入る。まだ提案しない' } },
            { label: 'suggest', coef: 'threshold_suggest', meaning: { en: 'a gentle rest proposal becomes possible', ja: '穏やかな休憩提案が可能になる' } },
            { label: 'recommend', coef: 'threshold_recommend', meaning: { en: 'escalates to a clear recommendation', ja: '明確な推奨に格上げ' } },
            { label: 'urgent', coef: 'threshold_urgent', meaning: { en: 'urgent — a strong proposal', ja: '緊急 — 強い提案' } },
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
            { link: 'familiar_route' },
            { text: ' )' },
          ],
        },
      ],
      thresholdReads: [
        {
          scoreName: 'monotony_prevention',
          scoreKey: 'monotony_prevention_score',
          steps: [
            { label: 'watch', coef: 'monotony_watch_threshold', meaning: { en: 'enters WATCH — monitoring only', ja: 'WATCH（監視）に入る' } },
            { label: 'suggest', coef: 'monotony_suggest_threshold', meaning: { en: 'a content/break suggestion becomes possible', ja: 'コンテンツ・休憩の提案が可能になる' } },
            { label: 'recommend', coef: 'monotony_recommend_threshold', meaning: { en: 'escalates to a clear suggestion', ja: '明確な提案に格上げ' } },
            { label: 'urgent', coef: 'monotony_urgent_threshold', meaning: { en: 'strongest attention-drop alert', ja: '最も強い注意力低下の警告' } },
          ],
        },
      ],
    },
    {
      id: 'fire_control',
      title: 'fire-control',
      steps: [
        {
          text: '1. Smoothing — each feature and category score is eased toward its new value every tick (EWMA) before any decision. Higher α reacts faster, lower α is steadier. (Not a threshold.)',
          coefs: ['smoothing_alpha'],
        },
        {
          text: '2. Persistence gate — a score must hold above its suggest threshold for several ticks before it may fire, filtering one-tick spikes:',
          checks: [
            { operand: { en: 'Rest-Required Score consecutive ticks above suggest', ja: '休憩必要度が提案しきい値を超えた連続ティック数' }, op: '≥', coef: 'rest_persistence_ticks', outcome: { en: 'rest may fire', ja: '休憩提案が発火可能に' } },
            { operand: { en: 'Monotony Score consecutive ticks above suggest', ja: '単調性抑止度が提案しきい値を超えた連続ティック数' }, op: '≥', coef: 'monotony_persistence_ticks', outcome: { en: 'monotony may fire', ja: '単調性提案が発火可能に' } },
          ],
        },
        {
          text: '3. Skip-if — a fast, genuine escalation skips the persistence wait:',
          checks: [
            { operand: { en: 'Rest-Required or Monotony Score (each checked on its own)', ja: '休憩必要度／単調性抑止度スコア（各々を個別に判定）' }, op: '≥', coef: 'skip_if_score', outcome: { en: 'skip the persistence wait, fire now', ja: '持続待ちをスキップして即発火' } },
            { operand: { en: 'Per-tick change in that score (rest or monotony)', ja: 'そのスコア（休憩／単調性）のティックあたりの変化量' }, op: '≥', coef: 'skip_if_velocity', outcome: { en: 'skip the persistence wait, fire now', ja: '持続待ちをスキップして即発火' } },
          ],
        },
        {
          text: '4. Emergency override — extreme urgency fires even while rate-limited:',
          checks: [
            { operand: { en: 'Rest-Required or Monotony Score (each checked on its own)', ja: '休憩必要度／単調性抑止度スコア（各々を個別に判定）' }, op: '≥', coef: 'emergency_override_threshold', outcome: { en: 'fire even during cooldown or after the 30-min cap', ja: 'クールダウン中でも30分上限後でも発火' } },
          ],
        },
        {
          text: '5. Cooldown — a proposal too soon after the previous one of the same category is suppressed:',
          checks: [
            { operand: { en: 'Seconds since last rest proposal', ja: '前回の休憩提案からの秒数' }, op: '<', coef: 'rest_cooldown_sec', outcome: { en: 'suppress', ja: '抑制' } },
            { operand: { en: 'Seconds since last monotony proposal', ja: '前回の単調性提案からの秒数' }, op: '<', coef: 'monotony_cooldown_sec', outcome: { en: 'suppress', ja: '抑制' } },
          ],
        },
        {
          text: '6. Rate cap — never fire too many proposals in a rolling 30-minute window:',
          checks: [
            { operand: { en: 'Proposals in the last 30 minutes', ja: '直近30分の提案数' }, op: '≥', coef: 'max_proposals_per_30min', outcome: { en: 'suppress', ja: '抑制' } },
          ],
        },
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
          scoreKey: 'S_total',
          steps: [
            { label: 'suggest', coef: 'threshold_suggest', meaning: { en: 'a rest proposal becomes possible', ja: '休憩提案が可能になる' } },
            { label: 'recommend', coef: 'threshold_recommend', meaning: { en: 'escalates to a clear recommendation', ja: '明確な推奨に格上げ' } },
            { label: 'urgent', coef: 'threshold_urgent', meaning: { en: 'urgent — a strong proposal', ja: '緊急 — 強い提案' } },
            { label: 'fire', coef: 'threshold_fire', meaning: { en: 'the proposal actually fires', ja: '提案が実際に発火する' } },
          ],
        },
      ],
    },
    {
      id: 'fire_control',
      title: 'fire-control',
      steps: [
        {
          text: '1. Actionability guard — only propose a rest when a rest spot is close enough to act on:',
          checks: [
            { operand: { en: 'Minutes to the next rest spot', ja: '次の休憩地点までの分数' }, op: '≤', coef: 'rest_spot_eta_filter_min', outcome: { en: 'eligible to propose', ja: '提案の対象になる' } },
          ],
        },
        {
          text: '2. Persistence gate — Total Score must hold above the fire threshold for several ticks first:',
          checks: [
            { operand: { en: 'Total Score consecutive ticks above fire', ja: '合計スコアが発火しきい値を超えた連続ティック数' }, op: '≥', coef: 'persistence_ticks', outcome: { en: 'may fire', ja: '発火可能に' } },
          ],
        },
        {
          text: '3. Emergency override — extreme urgency fires even while rate-limited:',
          checks: [
            { operand: { en: 'Total Score', ja: '合計スコア' }, op: '≥', coef: 'emergency_override_threshold', outcome: { en: 'fire regardless of cooldown or cap', ja: 'クールダウン・上限に関わらず発火' } },
          ],
        },
        {
          text: '4. Cooldown — a proposal too soon after the previous one is suppressed:',
          checks: [
            { operand: { en: 'Seconds since last proposal', ja: '前回の提案からの秒数' }, op: '<', coef: 'rest_cooldown_sec', outcome: { en: 'suppress', ja: '抑制' } },
          ],
        },
        {
          text: '5. Rate cap — never fire too many proposals in a rolling 30-minute window:',
          checks: [
            { operand: { en: 'Proposals in the last 30 minutes', ja: '直近30分の提案数' }, op: '≥', coef: 'max_proposals_per_30min', outcome: { en: 'suppress', ja: '抑制' } },
          ],
        },
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
    for (const step of section.steps ?? []) {
      for (const coef of step.coefs ?? []) keys.add(coef)
      for (const check of step.checks ?? []) keys.add(check.coef)
    }
    for (const key of section.extraHyperparameters ?? []) keys.add(key)
  }
  return keys
}
