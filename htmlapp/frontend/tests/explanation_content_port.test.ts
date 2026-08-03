import { describe, it } from 'vitest'
import * as ce from '../src/engine/explanation/content'
import type { ExplanationContext, ExplanationTarget } from '../src/engine/explanation/builder'
import { loadFixture, expectParity } from '../src/engine/__fixtures__/parity'

/**
 * Conformance test for `src/engine/explanation/content.ts` — the port of
 * `app/api/aica_api/services/content_explanation.py`: the causal-bridge
 * machinery (`_effective_alpha_beta`, `demand_phrase`, `_arousal_band`,
 * `_axis_satisfaction`, `_axis_trait_words`, `_axis_choice`, `_axis_bridge`,
 * `causal_bridge_lines`), `_song_facts_lines`, `build_prompt`,
 * `_legacy_join`, `_family_of`, `_dominant_family_sentence1`,
 * `_situation_led_sentence1`, and `template`.
 *
 * Every case is pulled from
 * `src/engine/__fixtures__/parity/content_explanation.json`, captured by
 * running the REAL Python module (see `scripts/gen/capture_all.py`'s
 * `_capture_content_explanation`) against REAL `OrderedItem` output already
 * committed in `content_selector.json` (C1 Task 5) and one REAL
 * `mock_content_selector_v1.evaluate()` call, plus a hand-built matrix for
 * the causal-bridge machinery's dense conditionals (verified directly
 * against a live Python interpreter before capture — see
 * task-3-report.md's branch-coverage table for which case is real vs.
 * synthetic and why).
 *
 * `template()`/`causalBridgeLines()`/`buildPrompt()`'s output is bilingual
 * PROSE compared CHARACTER-EXACTLY (including Japanese punctuation and the
 * `:+.3f` signed-contribution format), so `expectParity`'s exact
 * (non-tolerance) string comparison is the whole point here.
 */

type Json = Record<string, unknown>

describe('explanation/content.ts parity (C3 task 3)', () => {
  const { input, output } = loadFixture('content_explanation') as { input: Json; output: Json }

  it('effectiveAlphaBeta reproduces _effective_alpha_beta over the directional-unsafe/static-demand/absent/near-zero/normal/bool-hazard-8 branches', () => {
    const cases = input.effective_alpha_beta_cases as Record<string, { alpha: unknown; beta: unknown; feature_id: string }>
    const actual: Record<string, [number, number] | null> = {}
    for (const [name, c] of Object.entries(cases)) actual[name] = ce.effectiveAlphaBeta(c.alpha, c.beta, c.feature_id)
    expectParity(actual, output.effective_alpha_beta, 'effective_alpha_beta')
  })

  it('demandPhrase reproduces demand_phrase over the a>0/a<0/a==0 lead branches and the b>0 "and a bit brighter" append', () => {
    const cases = input.demand_phrase_cases as Record<string, { alpha: unknown; beta: unknown; feature_id: string }>
    const actual: Record<string, { ja: string; en: string } | null> = {}
    for (const [name, c] of Object.entries(cases)) actual[name] = ce.demandPhrase(c.alpha, c.beta, c.feature_id)
    expectParity(actual, output.demand_phrase, 'demand_phrase')
  })

  it('arousalBand reproduces _arousal_band over high/medium/low + both boundaries', () => {
    const cases = input.arousal_band_cases as Array<{ name: string; v: number }>
    const actual: Record<string, string> = {}
    for (const c of cases) actual[c.name] = ce.arousalBand(c.v)
    expectParity(actual, output.arousal_band, 'arousal_band')
  })

  it('axisSatisfaction reproduces _axis_satisfaction over every axis/direction/satisfied combination, incl. valence=null', () => {
    const cases = input.axis_satisfaction_cases as Record<
      string,
      { axis: 'arousal' | 'valence'; direction: 'energize' | 'soothe' | 'bright' | 'darker'; arousal_band: 'high' | 'medium' | 'low' | null; valence: number | null }
    >
    const actual: Record<string, boolean> = {}
    for (const [name, c] of Object.entries(cases)) {
      actual[name] = ce.axisSatisfaction(c.axis, c.direction, c.arousal_band, c.valence)
    }
    expectParity(actual, output.axis_satisfaction, 'axis_satisfaction')
  })

  it('axisTraitWords reproduces _axis_trait_words over arousal high/medium/low/band-null-default and valence null/bright/darker/neutral', () => {
    const cases = input.axis_trait_words_cases as Record<
      string,
      { axis: 'arousal' | 'valence'; arousal_band: 'high' | 'medium' | 'low' | null; valence: number | null }
    >
    const actual: Record<string, [string, string]> = {}
    for (const [name, c] of Object.entries(cases)) actual[name] = ce.axisTraitWords(c.axis, c.arousal_band, c.valence)
    expectParity(actual, output.axis_trait_words, 'axis_trait_words')
  })

  it('axisChoice reproduces _axis_choice over only-a/only-b, both-satisfied/neither-satisfied, and every tie/coeff-magnitude branch', () => {
    const cases = input.axis_choice_cases as Record<
      string,
      { a: number; b: number; arousal_band: 'high' | 'medium' | 'low' | null; valence: number | null }
    >
    const actual: Record<string, [string, string, boolean] | null> = {}
    for (const [name, c] of Object.entries(cases)) actual[name] = ce.axisChoice(c.a, c.b, c.arousal_band, c.valence)
    expectParity(actual, output.axis_choice, 'axis_choice')
  })

  it('axisBridge reproduces _axis_bridge, including the provably-unreachable-via-effectiveAlphaBeta choice=null guard exercised directly', () => {
    const cases = input.axis_bridge_cases as Record<
      string,
      { a: number; b: number; arousal_band: 'high' | 'medium' | 'low' | null; valence: number | null }
    >
    const actual: Record<string, ce.AxisBridgeInfo | null> = {}
    for (const [name, c] of Object.entries(cases)) actual[name] = ce.axisBridge(c.a, c.b, c.arousal_band, c.valence)
    expectParity(actual, output.axis_bridge, 'axis_bridge')
  })

  it('songFactsLines reproduces _song_facts_lines, including the e_i-bool-True hazard-8 oshi match', () => {
    const cases = input.song_facts_cases as Record<string, { target: ExplanationTarget; context: ExplanationContext }>
    const actual: Record<string, string[]> = {}
    for (const [name, spec] of Object.entries(cases)) actual[name] = ce.songFactsLines(spec.target, spec.context)
    expectParity(actual, output.song_facts, 'song_facts')
  })

  it('causalBridgeLines reproduces causal_bridge_lines on real items, incl. NON_BRIDGE_FEATURES skip and satisfied/unsatisfied verdicts', () => {
    const cases = input.causal_bridge_cases as Record<string, ExplanationTarget>
    const actual: Record<string, string[]> = {}
    for (const [name, target] of Object.entries(cases)) actual[name] = ce.causalBridgeLines(target)
    expectParity(actual, output.causal_bridge, 'causal_bridge')
  })

  it('buildPrompt reproduces build_prompt on real content items, incl. the song_name fallback to target_id', () => {
    const cases = input.build_prompt_cases as Record<string, { target: ExplanationTarget; context: ExplanationContext }>
    const actual: Record<string, unknown> = {}
    for (const [name, spec] of Object.entries(cases)) actual[name] = ce.buildPrompt(spec.target, spec.context)
    expectParity(actual, output.build_prompt, 'build_prompt')
  })

  it('familyOf reproduces _family_of over situation/preference/history/unknown ids', () => {
    const ids = input.family_of_ids as string[]
    const actual: Record<string, string | null> = {}
    for (const id of ids) actual[id] = ce.familyOf(id)
    expectParity(actual, output.family_of, 'family_of')
  })

  it('dominantFamilySentence1 reproduces _dominant_family_sentence1, incl. the real negative-history-falls-through case and the synthetic positive-history case', () => {
    const cases = input.dominant_family_cases as Record<string, { target: ExplanationTarget; dom: 'preference' | 'history' }>
    const actual: Record<string, [string, string] | null> = {}
    for (const [name, spec] of Object.entries(cases)) actual[name] = ce.dominantFamilySentence1(spec.target, spec.dom)
    expectParity(actual, output.dominant_family, 'dominant_family')
  })

  it('situationLedSentence1 reproduces _situation_led_sentence1, incl. best=null/arousal_band=null/non-numeric-value and the bool-value hazard-8 case', () => {
    const cases = input.situation_led_cases as Record<
      string,
      { target: ExplanationTarget; arousal_band: 'high' | 'medium' | 'low' | null; valence: number | null }
    >
    const actual: Record<string, [string, string] | null> = {}
    for (const [name, spec] of Object.entries(cases)) {
      actual[name] = ce.situationLedSentence1(spec.target, spec.arousal_band, spec.valence)
    }
    expectParity(actual, output.situation_led, 'situation_led')
  })

  it('template reproduces the full opening-sentence + reinforcement matrix, incl. the real mock-package readout=null path and every legacy_join degrade branch', () => {
    const cases = input.template_cases as Record<string, ExplanationTarget>
    const actual: Record<string, [string, string]> = {}
    for (const [name, target] of Object.entries(cases)) actual[name] = ce.template(target)
    expectParity(actual, output.template, 'template')
  })

  it('legacyJoin (direct) reproduces _legacy_join, including str(None) == "None" coercion of non-string entries', () => {
    const cases = input.legacy_join_direct_cases as Record<string, ExplanationTarget>
    const actual: Record<string, [string, string]> = {}
    for (const [name, target] of Object.entries(cases)) actual[name] = ce.legacyJoin(target)
    expectParity(actual, output.legacy_join_direct, 'legacy_join_direct')
  })
})
