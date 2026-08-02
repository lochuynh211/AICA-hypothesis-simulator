import { describe, it } from 'vitest'
import * as eb from '../src/engine/explanation/builder'
import { loadFixture, expectParity } from '../src/engine/__fixtures__/parity'

/**
 * Conformance test for `src/engine/explanation/builder.ts` — the port of the
 * NON-façade half of `app/api/aica_api/services/explanation_builder.py`
 * (label_for, feature_meaning, feature_family, situation_sentence,
 * trigger_sentence, preference_sentence, history_sentences, score_evidence,
 * category_readout, and the internal display/factor helpers). Every case is
 * pulled from `src/engine/__fixtures__/parity/explanation_builder.json`,
 * captured by running the REAL Python module (see
 * `scripts/gen/capture_all.py`'s `_capture_explanation_builder`) — this
 * compares bilingual PROSE character-exactly (including Japanese
 * punctuation), not just numbers, so `expectParity`'s exact (non-tolerance)
 * string/null comparison is the whole point here.
 *
 * Each `it` block is named for, and asserts, one function's full case set;
 * see task-1-report.md for the per-branch coverage table cross-referencing
 * every case name to the Python conditional it targets.
 */

type Json = Record<string, unknown>

describe('explanation/builder.ts parity (C3 task 1)', () => {
  const { input, output } = loadFixture('explanation_builder') as { input: Json; output: Json }

  it('labelFor reproduces label_for over every captured id', () => {
    const ids = input.label_ids as string[]
    const actual: Record<string, eb.FeatureLabel> = {}
    for (const id of ids) actual[id] = eb.labelFor(id)
    expectParity(actual, output.labels, 'labels')
  })

  it('featureMeaning reproduces feature_meaning over every captured id', () => {
    const ids = input.meaning_ids as string[]
    const actual: Record<string, string> = {}
    for (const id of ids) actual[id] = eb.featureMeaning(id)
    expectParity(actual, output.meanings, 'meanings')
  })

  it('featureFamily reproduces feature_family over situation/preference/history/unknown ids', () => {
    const ids = input.family_ids as string[]
    const actual: Record<string, string | null> = {}
    for (const id of ids) actual[id] = eb.featureFamily(id)
    expectParity(actual, output.family, 'family')
  })

  it('valueDisplay reproduces _value_display over bool/numeric-band/string/empty/null branches', () => {
    const cases = input.value_display_cases as Array<{ name: string; value: unknown }>
    const actual: Record<string, string> = {}
    for (const c of cases) actual[c.name] = eb.valueDisplay(c.value)
    expectParity(actual, output.value_display, 'value_display')
  })

  it('lvl3 reproduces _lvl3 over null/low/mid-boundary/mid/high-boundary/high', () => {
    const cases = input.lvl3_cases as Array<{ name: string; v: number | null; lo: number; hi: number }>
    const actual: Record<string, string | null> = {}
    for (const c of cases) actual[c.name] = eb.lvl3(c.v, c.lo, c.hi)
    expectParity(actual, output.lvl3, 'lvl3')
  })

  it('reasonRowValue/reasonRowContribution reproduce the feature_value/e_i/no-match/non-numeric branches', () => {
    const cases = input.reason_row_cases as Record<string, { target: eb.ExplanationTarget; feature_ids: string[] }>
    const actual: Record<string, { value: unknown; contribution: number | null }> = {}
    for (const [name, spec] of Object.entries(cases)) {
      actual[name] = {
        value: eb.reasonRowValue(spec.target, ...spec.feature_ids),
        contribution: eb.reasonRowContribution(spec.target, ...spec.feature_ids),
      }
    }
    expectParity(actual, output.reason_row, 'reason_row')
  })

  it('factorsFromTarget reproduces extraction/banding/drop/cap/stable-sort over every captured target', () => {
    const cases = input.factors_cases as Record<string, eb.ExplanationTarget>
    const actual: Record<string, eb.Factor[]> = {}
    for (const [name, target] of Object.entries(cases)) actual[name] = eb.factorsFromTarget(target)
    expectParity(actual, output.factors, 'factors')
  })

  it('situationSentence reproduces every band/gate/fallback branch', () => {
    const cases = input.situation_cases as Record<
      string,
      { target: eb.ExplanationTarget; trigger_purpose: string | null; contributing_only: boolean }
    >
    const actual: Record<string, string | null> = {}
    for (const [name, spec] of Object.entries(cases)) {
      actual[name] = eb.situationSentence(spec.target, spec.trigger_purpose, spec.contributing_only)
    }
    expectParity(actual, output.situation, 'situation')
  })

  it('triggerSentence reproduces known-purpose/unknown/falsy leads and motion/lifecycle car-state branches', () => {
    const cases = input.trigger_sentence_cases as Record<
      string,
      { trigger_purpose: string | null; target: eb.ExplanationTarget; lifecycle_stage: string | null }
    >
    const actual: Record<string, string> = {}
    for (const [name, spec] of Object.entries(cases)) {
      actual[name] = eb.triggerSentence(spec.trigger_purpose, spec.target, spec.lifecycle_stage)
    }
    expectParity(actual, output.trigger_sentence, 'trigger_sentence')
  })

  it('preferenceSentence reproduces oshi/genre/age-band branches, capitalization and join', () => {
    const cases = input.preference_cases as Record<string, eb.ExplanationContext>
    const actual: Record<string, string | null> = {}
    for (const [name, ctx] of Object.entries(cases)) actual[name] = eb.preferenceSentence(ctx)
    expectParity(actual, output.preference, 'preference')
  })

  it('historySentences reproduces every fid branch, fall-through and dedupe', () => {
    const cases = input.history_cases as Record<string, eb.ExplanationTarget>
    const actual: Record<string, string[]> = {}
    for (const [name, target] of Object.entries(cases)) actual[name] = eb.historySentences(target)
    expectParity(actual, output.history, 'history')
  })

  it('scoreStrength reproduces every positive/negative tier including the zero boundary', () => {
    const cases = input.score_strength_cases as Array<{ name: string; c: number }>
    const actual: Record<string, string> = {}
    for (const c of cases) actual[c.name] = eb.scoreStrength(c.c)
    expectParity(actual, output.score_strength, 'score_strength')
  })

  it('scoreEvidence reproduces oshi-naming, tiering, the 0.008 skip and the first-6 cap', () => {
    const cases = input.score_evidence_cases as Record<string, { factors: eb.Factor[]; oshi_artist: string | null }>
    const actual: Record<string, string[]> = {}
    for (const [name, spec] of Object.entries(cases)) {
      actual[name] = eb.scoreEvidence(spec.factors, spec.oshi_artist)
    }
    expectParity(actual, output.score_evidence, 'score_evidence')
  })

  it('categoryReadout reproduces dominant-by-magnitude, partial coverage, ties and the none case', () => {
    const cases = input.category_cases as Record<string, eb.ExplanationTarget>
    const actual: Record<string, eb.CategoryReadout | null> = {}
    for (const [name, target] of Object.entries(cases)) actual[name] = eb.categoryReadout(target)
    expectParity(actual, output.category, 'category')
  })

  it('shared kernel constants the step modules read off _k.* are byte-exact', () => {
    const actual = {
      MAX_FACTORS: eb.MAX_FACTORS,
      MIN_ABS_CONTRIBUTION: eb.MIN_ABS_CONTRIBUTION,
      CONTRIBUTING_THRESHOLD: eb.CONTRIBUTING_THRESHOLD,
      CONTENT_LANG_SEP: eb.CONTENT_LANG_SEP,
      FORMAT_REMINDER: eb.FORMAT_REMINDER,
      REASON_CLOSING: eb.REASON_CLOSING,
      CONTENT_REASON_SYSTEM: eb.CONTENT_REASON_SYSTEM,
      SERVICE_REASON_SYSTEM: eb.SERVICE_REASON_SYSTEM,
    }
    expectParity(actual, output.constants, 'constants')
  })
})
