import { describe, it, expect } from 'vitest'
import * as eb from '../src/engine/explanation/builder'
import * as trig from '../src/engine/explanation/trigger'
import type { ExplanationContext, ExplanationTarget, ExplainMessage, ExplanationPrompt } from '../src/engine/explanation/builder'
import { loadFixture, expectParity } from '../src/engine/__fixtures__/parity'

/**
 * Conformance test for the FAÇADE half of `src/engine/explanation/builder.ts`
 * (`buildExplanationPrompt`, `templateRationale`, `parseBilingual`,
 * `responseIsUsable`, `stripPlaceholderArtifacts`) — the port of
 * `app/api/aica_api/services/explanation_builder.py`'s façade functions of
 * the same names (C3 task 4) — plus `src/engine/explanation/trigger.ts`'s
 * `buildPrompt`, which was explicitly deferred out of Task 2's scope to this
 * task (see trigger.ts's own header comment / task-2-report.md /
 * progress.md).
 *
 * Dispatch/parsing/prompt-building cases are pulled from
 * `src/engine/__fixtures__/parity/explanation_facade.json` and
 * `.../trigger_explanation.json` (trigger.ts's `build_prompt` cases),
 * captured by running the REAL Python modules (see
 * `scripts/gen/capture_all.py`'s `_capture_explanation_facade` /
 * `_capture_trigger_explanation`).
 *
 * `responseIsUsable` additionally gets DIRECT unit assertions below —
 * inline data, not fixture-loaded — one `it()` per rejection reason, per
 * this task's brief ("these are pure string functions ... port them with
 * direct unit assertions covering each rejection reason, not only a
 * golden"). `parseBilingual`/`stripPlaceholderArtifacts` get a handful of
 * direct spot-checks too, supplementing (not replacing) their golden parity
 * coverage.
 */

type Json = Record<string, unknown>

describe('explanation façade (C3 task 4)', () => {
  const { input, output } = loadFixture('explanation_facade') as { input: Json; output: Json }
  const trigFixture = loadFixture('trigger_explanation') as { input: Json; output: Json }

  // -------------------------------------------------------------------------
  // trigger.ts buildPrompt (deferred from Task 2 to this task)
  // -------------------------------------------------------------------------

  it('trigger.buildPrompt reproduces build_prompt over margin/threshold/score/absent-fact/cap/band/category branches', () => {
    const cases = trigFixture.input.build_prompt_cases as Record<string, trig.TriggerTarget>
    const actual: Record<string, ExplanationPrompt> = {}
    for (const [name, target] of Object.entries(cases)) {
      actual[name] = trig.buildPrompt(target, {})
    }
    expectParity(actual, trigFixture.output.build_prompt, 'trigger.build_prompt')
  })

  // -------------------------------------------------------------------------
  // buildExplanationPrompt / templateRationale — step dispatch
  // -------------------------------------------------------------------------

  it('buildExplanationPrompt dispatches service/trigger explicitly and falls through to content for anything else', () => {
    const cases = input.build_explanation_prompt_cases as Record<
      string,
      { step: string; target: ExplanationTarget | trig.TriggerTarget; context: ExplanationContext }
    >
    const actual: Record<string, ExplanationPrompt> = {}
    for (const [name, spec] of Object.entries(cases)) {
      actual[name] = eb.buildExplanationPrompt(spec.step, spec.target, spec.context)
    }
    expectParity(actual, output.build_explanation_prompt, 'build_explanation_prompt')
  })

  it('templateRationale dispatches the same way (service/trigger explicit, else falls through to content)', () => {
    const cases = input.template_rationale_cases as Record<string, { step: string; target: ExplanationTarget | trig.TriggerTarget }>
    const actual: Record<string, [string, string]> = {}
    for (const [name, spec] of Object.entries(cases)) {
      actual[name] = eb.templateRationale(spec.step, spec.target)
    }
    expectParity(actual, output.template_rationale, 'template_rationale')
  })

  // -------------------------------------------------------------------------
  // parseBilingual
  // -------------------------------------------------------------------------

  it('parseBilingual reproduces every parsing branch (inline/cross-line JA:/EN:, case-insensitivity, code fences, JA-only/EN-only fallback, plain lines, empty input, DOTALL swallow behavior)', () => {
    const cases = input.parse_bilingual_cases as Record<string, string>
    const actual: Record<string, [string, string]> = {}
    for (const [name, text] of Object.entries(cases)) actual[name] = eb.parseBilingual(text)
    expectParity(actual, output.parse_bilingual, 'parse_bilingual')
  })

  it('parseBilingual — direct spot checks', () => {
    expect(eb.parseBilingual('')).toEqual(['', ''])
    expect(eb.parseBilingual(null)).toEqual(['', ''])
    expect(eb.parseBilingual(undefined)).toEqual(['', ''])
    expect(eb.parseBilingual('JA: こんにちは\nEN: hello')).toEqual(['こんにちは', 'hello'])
    expect(eb.parseBilingual('ja: こんにちは\nen: hello')).toEqual(['こんにちは', 'hello'])
    expect(eb.parseBilingual('just one line')).toEqual(['just one line', 'just one line'])
    expect(eb.parseBilingual('line1\nline2')).toEqual(['line1', 'line2'])
  })

  // -------------------------------------------------------------------------
  // stripPlaceholderArtifacts
  // -------------------------------------------------------------------------

  it('stripPlaceholderArtifacts reproduces every removal branch (placeholders half/full-width, brackets, whitespace, punctuation, dangling conjunctions, falsy passthrough)', () => {
    const cases = input.strip_placeholder_artifacts_cases as Record<string, string>
    const actual: Record<string, string> = {}
    for (const [name, text] of Object.entries(cases)) actual[name] = eb.stripPlaceholderArtifacts(text)
    expectParity(actual, output.strip_placeholder_artifacts, 'strip_placeholder_artifacts')
  })

  it('stripPlaceholderArtifacts — direct spot checks', () => {
    expect(eb.stripPlaceholderArtifacts('')).toBe('')
    expect(eb.stripPlaceholderArtifacts('This was driven by (factor B) mostly.')).toBe('This was driven by mostly.')
    expect(eb.stripPlaceholderArtifacts('これは要因Aによる判断です。')).toBe('これはによる判断です。')
    expect(eb.stripPlaceholderArtifacts('See the factor above for context.')).toBe('See the factor above for context.')
    expect(eb.stripPlaceholderArtifacts('And this is why it was chosen.')).toBe('this is why it was chosen.')
    expect(eb.stripPlaceholderArtifacts('This is why it was chosen and')).toBe('This is why it was chosen')
  })

  // -------------------------------------------------------------------------
  // responseIsUsable — DIRECT assertions, one per rejection reason (brief
  // Step 3/5: "direct unit assertions covering every rejection reason
  // individually", not only a golden). The docstring names three reasons —
  // empty; every line echoes a user fact line; the JA slot is not Japanese
  // script — and the EXAMPLE_JA/EXAMPLE_EN verbatim-parrot check is a
  // fourth, DISTINCT reason (the example text is never embedded in a real
  // prompt, so the echo check alone can never catch it).
  // -------------------------------------------------------------------------

  const userPrompt: ExplanationPrompt = {
    messages: [
      { role: 'system', content: 'irrelevant system text' } as ExplainMessage,
      {
        role: 'user',
        content: '- drowsiness: high\n- fatigue: medium\nTHE SITUATION RIGHT NOW: the driver is drowsy.',
      } as ExplainMessage,
    ],
    grounding: {},
  }

  it('rejection reason 1: empty rationale list is unusable', () => {
    expect(eb.responseIsUsable([], userPrompt)).toBe(false)
  })

  it('rejection reason 1b: whitespace-only / empty-string entries read as empty and are unusable', () => {
    expect(eb.responseIsUsable(['   ', ''], userPrompt)).toBe(false)
  })

  it('rejection reason 2: a JA-slot verbatim EXAMPLE_JA parrot is unusable', () => {
    // Literal EXAMPLE_JA text, byte-verified against a live Python capture
    // (see task-4-report.md) — not exported from builder.ts (module-private,
    // matching Python's own `_EXAMPLE_JA`), so this is a direct literal, not
    // an import.
    expect(
      eb.responseIsUsable(
        ['「状況A」は「〜」を必要とし、この選択はそれに合致します。さらに「要因B」が後押ししました。', 'a genuine english reason'],
        userPrompt,
      ),
    ).toBe(false)
  })

  it('rejection reason 2b: an EN-slot verbatim EXAMPLE_EN parrot is unusable', () => {
    expect(
      eb.responseIsUsable(
        ['本物の日本語の理由です', 'Situation A calls for a certain kind of choice, and this one matches it; factor B further reinforced it.'],
        userPrompt,
      ),
    ).toBe(false)
  })

  it('rejection reason 3: a JA slot containing no Japanese script (Hangul) is unusable', () => {
    expect(eb.responseIsUsable(['이것은 한국어입니다', 'this is korean'], userPrompt)).toBe(false)
  })

  it('rejection reason 3b: a JA slot containing no Japanese script (pure English) is unusable', () => {
    expect(eb.responseIsUsable(['this is english not japanese', 'this is english'], userPrompt)).toBe(false)
  })

  it('rejection reason 4: every non-empty line echoing a user fact line verbatim is unusable', () => {
    expect(eb.responseIsUsable(['drowsiness: high', 'fatigue: medium'], userPrompt)).toBe(false)
  })

  it('rejection reason 4b: every line echoing a user fact line after stripping a leading dash is unusable', () => {
    expect(eb.responseIsUsable(['- drowsiness: high', '- fatigue: medium'], userPrompt)).toBe(false)
  })

  it('positive case: an empty JA slot skips the script check but the EN slot still needs non-echoing text', () => {
    expect(eb.responseIsUsable(['', 'the driver is drowsy so a rest stop makes sense'], userPrompt)).toBe(true)
  })

  it('positive case: a genuine non-echoing bilingual pair with real Japanese script is usable', () => {
    expect(
      eb.responseIsUsable(
        ['眠気が強いため休憩を提案しました。', 'drowsiness was high, so a rest stop was suggested.'],
        userPrompt,
      ),
    ).toBe(true)
  })

  it('positive case: usable when only ONE of two lines echoes, as long as the JA slot passes the script check', () => {
    expect(eb.responseIsUsable(['眠気が強い状態が続いていました。', 'drowsiness: high'], userPrompt)).toBe(true)
  })

  it('responseIsUsable reproduces every captured case against the golden (dispatch/echo/script/parrot matrix)', () => {
    const cases = input.response_is_usable_cases as Record<string, { rationale: string[]; prompt: ExplanationPrompt }>
    const actual: Record<string, boolean> = {}
    for (const [name, spec] of Object.entries(cases)) actual[name] = eb.responseIsUsable(spec.rationale, spec.prompt)
    expectParity(actual, output.response_is_usable, 'response_is_usable')
  })
})
