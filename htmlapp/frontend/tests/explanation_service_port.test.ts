import { describe, it } from 'vitest'
import * as se from '../src/engine/explanation/service'
import type { ExplanationContext, ExplanationTarget, FeatureLabel } from '../src/engine/explanation/builder'
import { loadFixture, expectParity } from '../src/engine/__fixtures__/parity'

/**
 * Conformance test for `src/engine/explanation/service.ts` — the port of
 * `app/api/aica_api/services/service_explanation.py` (`_service_label`,
 * `build_prompt`, `_passthrough`, `template`).
 *
 * Every case is pulled from
 * `src/engine/__fixtures__/parity/service_explanation.json`, captured by
 * running the REAL Python module (see `scripts/gen/capture_all.py`'s
 * `_capture_service_explanation`) against REAL `RankedCandidate` output
 * already committed in `service_selector.json` (C1 Task 4), plus one REAL
 * `mock_service_selector_v1.evaluate()` call (proves `_passthrough`'s
 * fallback is reachable from a real package, not merely synthetic), plus
 * hand-built edge cases labelled synthetic in the branch-coverage table —
 * see task-3-report.md.
 *
 * `template()`'s output is bilingual PROSE compared CHARACTER-EXACTLY
 * (including Japanese punctuation), so `expectParity`'s exact (non-
 * tolerance) string comparison is the whole point here.
 */

type Json = Record<string, unknown>

describe('explanation/service.ts parity (C3 task 3)', () => {
  const { input, output } = loadFixture('service_explanation') as { input: Json; output: Json }

  it('serviceLabel reproduces _service_label over known ids + the unknown-id fallback', () => {
    const ids = input.service_label_ids as string[]
    const actual: Record<string, FeatureLabel> = {}
    for (const id of ids) actual[id] = se.serviceLabel(id)
    expectParity(actual, output.service_label, 'service_label')
  })

  it('buildPrompt reproduces build_prompt over every _TRIGGER_SENTENCES lead, the stopped/moving distinction, and situation-gated-in/out/history-present/absent', () => {
    const cases = input.build_prompt_cases as Record<string, { target: ExplanationTarget; context: ExplanationContext }>
    const actual: Record<string, unknown> = {}
    for (const [name, spec] of Object.entries(cases)) {
      actual[name] = se.buildPrompt(spec.target, spec.context)
    }
    expectParity(actual, output.build_prompt, 'build_prompt')
  })

  it('template reproduces every dominant-category/oppose combination, the real-mock-package passthrough, and every passthrough degrade branch', () => {
    const cases = input.template_cases as Record<string, ExplanationTarget>
    const actual: Record<string, [string, string]> = {}
    for (const [name, target] of Object.entries(cases)) actual[name] = se.template(target)
    expectParity(actual, output.template, 'template')
  })
})
