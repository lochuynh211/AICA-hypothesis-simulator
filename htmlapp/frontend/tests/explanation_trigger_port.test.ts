import { describe, it } from 'vitest'
import * as trig from '../src/engine/explanation/trigger'
import { loadFixture, expectParity } from '../src/engine/__fixtures__/parity'

/**
 * Conformance test for `src/engine/explanation/trigger.ts` — the port of the
 * target-building/template half of
 * `app/api/aica_api/services/trigger_explanation.py` (`resolve_category`,
 * `build_target`, `template`, and the display helpers `_num`,
 * `_threshold_for`, `_ranked_rows`, `_fmt_num`, `_score_display`,
 * `_signed_score_display`, `_unit_kind_for`, `_fmt_multiplier`,
 * `_row_value_display`, `_row_phrase`, `_dead_band_reason_applies`).
 *
 * Every case is pulled from
 * `src/engine/__fixtures__/parity/trigger_explanation.json`, captured by
 * running the REAL Python module (see `scripts/gen/capture_all.py`'s
 * `_capture_trigger_explanation`) against REAL `nri_fatigue_score_v1` /
 * `aica_transparent_hybrid_trigger_v1` `algorithm.evaluate()` fires (built
 * with the same signal/context recipes
 * `app/api/tests/proposal/test_trigger_explanation.py` itself uses) plus
 * hand-built edge/boundary chains in the recorded SHAPE, mirroring that
 * Python test module's own precedent for when a synthetic-but-legally-shaped
 * chain is fair game. `template()`'s output is bilingual PROSE compared
 * CHARACTER-EXACTLY (including Japanese punctuation), so `expectParity`'s
 * exact (non-tolerance) string comparison is the whole point here — see
 * task-2-report.md for the full per-branch coverage table.
 */

type Json = Record<string, unknown>

describe('explanation/trigger.ts parity (C3 task 2)', () => {
  const { input, output } = loadFixture('trigger_explanation') as { input: Json; output: Json }

  it('resolveCategory reproduces resolve_category over explicit/own/fallback/empty/tiebreak branches', () => {
    const cases = input.resolve_category_cases as Record<
      string,
      { fire: trig.TriggerFire; category: string | null }
    >
    const actual: Record<string, string | null> = {}
    for (const [name, spec] of Object.entries(cases)) {
      actual[name] = trig.resolveCategory(spec.fire, spec.category)
    }
    expectParity(actual, output.resolve_category, 'resolve_category')
  })

  it('buildTarget reproduces build_target flatten/degrade/pass-through branches', () => {
    const cases = input.build_target_cases as Record<
      string,
      { fire: trig.TriggerFire; category: string | null }
    >
    const actual: Record<string, trig.TriggerTarget> = {}
    for (const [name, spec] of Object.entries(cases)) {
      actual[name] = trig.buildTarget(spec.fire, spec.category)
    }
    expectParity(actual, output.build_target, 'build_target')
  })

  it('num reproduces _num over numeric/bool-excluded/string-excluded/none-excluded branches', () => {
    const cases = input.num_cases as Array<{ name: string; v: unknown }>
    const actual: Record<string, number> = {}
    for (const c of cases) actual[c.name] = trig.num(c.v)
    expectParity(actual, output.num, 'num')
  })

  it('thresholdFor reproduces _threshold_for priority/fallback/bool-excluded/unknown-category branches', () => {
    const cases = input.threshold_for_cases as Record<
      string,
      { category: string | null; criteria: Record<string, unknown> }
    >
    const actual: Record<string, number | null> = {}
    for (const [name, spec] of Object.entries(cases)) {
      actual[name] = trig.thresholdFor(spec.category, spec.criteria)
    }
    expectParity(actual, output.threshold_for, 'threshold_for')
  })

  it('rankedRows reproduces _ranked_rows sort/stability/malformed-drop/empty branches', () => {
    const cases = input.ranked_rows_cases as Record<string, unknown>
    const actual: Record<string, trig.TriggerRow[]> = {}
    for (const [name, rows] of Object.entries(cases)) actual[name] = trig.rankedRows(rows)
    expectParity(actual, output.ranked_rows, 'ranked_rows')
  })

  it('fmtNum reproduces _fmt_num over the .0f/.2f scale branches, including banker’s-rounding ties (hazard 7)', () => {
    const cases = input.fmt_num_cases as Array<{ name: string; v: number }>
    const actual: Record<string, string> = {}
    for (const c of cases) actual[c.name] = trig.fmtNum(c.v)
    expectParity(actual, output.fmt_num, 'fmt_num')
  })

  it('scoreDisplay reproduces _score_display over the points/plain-fraction branches', () => {
    const cases = input.score_display_cases as Array<{ name: string; v: number }>
    const actual: Record<string, [string, string]> = {}
    for (const c of cases) actual[c.name] = trig.scoreDisplay(c.v)
    expectParity(actual, output.score_display, 'score_display')
  })

  it('signedScoreDisplay reproduces _signed_score_display over positive/negative/zero sign branches', () => {
    const cases = input.signed_score_display_cases as Array<{ name: string; v: number }>
    const actual: Record<string, [string, string]> = {}
    for (const c of cases) actual[c.name] = trig.signedScoreDisplay(c.v)
    expectParity(actual, output.signed_score_display, 'signed_score_display')
  })

  it('unitKindFor reproduces _unit_kind_for over every table kind + the monotony disambiguation floor', () => {
    const cases = input.unit_kind_for_cases as Array<{ name: string; feature_id: string; value: unknown }>
    const actual: Record<string, string | null> = {}
    for (const c of cases) actual[c.name] = trig.unitKindFor(c.feature_id, c.value)
    expectParity(actual, output.unit_kind_for, 'unit_kind_for')
  })

  it('fmtMultiplier reproduces _fmt_multiplier trailing-zero-trim + tie-rounding (hazard 7)', () => {
    const cases = input.fmt_multiplier_cases as Array<{ name: string; v: number }>
    const actual: Record<string, string> = {}
    for (const c of cases) actual[c.name] = trig.fmtMultiplier(c.v)
    expectParity(actual, output.fmt_multiplier, 'fmt_multiplier')
  })

  it('rowValueDisplay reproduces _row_value_display over band/boolean/dash/minutes/multiplier/level branches', () => {
    const cases = input.row_value_display_cases as Record<string, trig.TriggerRow>
    const actual: Record<string, [string, string]> = {}
    for (const [name, row] of Object.entries(cases)) actual[name] = trig.rowValueDisplay(row)
    expectParity(actual, output.row_value_display, 'row_value_display')
  })

  it('rowPhrase reproduces _row_phrase composition, including the label fallback for an unrecognized/None feature_id', () => {
    const cases = input.row_phrase_cases as Record<string, trig.TriggerRow>
    const actual: Record<string, [string, string]> = {}
    for (const [name, row] of Object.entries(cases)) actual[name] = trig.rowPhrase(row)
    expectParity(actual, output.row_phrase, 'row_phrase')
  })

  it('deadBandReasonApplies reproduces _dead_band_reason_applies both ways, plus the epsilon boundary', () => {
    const cases = input.dead_band_reason_applies_cases as Record<string, trig.TriggerRow>
    const actual: Record<string, boolean> = {}
    for (const [name, row] of Object.entries(cases)) actual[name] = trig.deadBandReasonApplies(row)
    expectParity(actual, output.dead_band_reason_applies, 'dead_band_reason_applies')
  })

  it('template reproduces every sentence branch character-exactly, including Japanese punctuation', () => {
    const cases = input.template_cases as Record<string, trig.TriggerTarget>
    const actual: Record<string, [string, string]> = {}
    for (const [name, target] of Object.entries(cases)) actual[name] = trig.template(target)
    expectParity(actual, output.template, 'template')
  })
})
