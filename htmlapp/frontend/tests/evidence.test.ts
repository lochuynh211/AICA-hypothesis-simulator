import { describe, it, expect, beforeEach } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { loadFixture, expectParity } from '../src/engine/__fixtures__/parity'
import { renderEvidenceMarkdown } from '../src/engine/services/evidence_markdown'
import { buildEvidenceReport } from '../src/engine/services/evidence'
import { createDraft, clearDraftRegistry } from '../src/engine/run_plan'
import {
  createRun,
  tick,
  action,
  appendFeedback,
  clearRegistry,
} from '../src/engine/run_manager'

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
  clearDraftRegistry()
  clearRegistry()
})

// evidence_markdown.json was captured by driving the REAL Python services
// end to end (the same reconstructed declarative_rule package
// `rest_rule_based_v0_1` + scenario `uc01_fatigue_recovery_v0_1` used by
// run_log_e2e.json — see task-S4.2-report.md for provenance) through
// build_evidence_report(...) then render_evidence_markdown(...). The run was
// additionally given a decision-scoped feedback event (labels + comment) and
// a run-scoped feedback event (labels only, no comment) via
// run_manager.append_feedback, so BOTH `## Human Review` subsections
// (Feedback Labels + Free-Text Comments) are non-trivially exercised. See
// task-S8.1-report.md for the exact capture script.
describe('evidence markdown parity', () => {
  it('renders identical markdown for the same report (byte-for-byte)', () => {
    const fx = loadFixture('evidence_markdown')
    expect(renderEvidenceMarkdown(fx.input)).toBe(fx.output)
  })

  it('keeps the §14.2 facts/review separation', () => {
    const md = renderEvidenceMarkdown(loadFixture('evidence_markdown').input)
    expect(md).toMatch(/## .*(Simulator Facts|Facts)/)
    expect(md).toMatch(/## .*(Human Review|Review)/)
    // Facts section must precede the Review section (deterministic ordering).
    const factsIdx = md.indexOf('## Simulator Facts')
    const reviewIdx = md.indexOf('## Human Review')
    expect(factsIdx).toBeGreaterThanOrEqual(0)
    expect(reviewIdx).toBeGreaterThan(factsIdx)
  })

  // MAP KEY EXCLUSION guard (master invariant + plan Global Constraint): the
  // evidence export must NEVER contain the Google Maps key. This fixture's
  // run has no key (local/deterministic route), so this asserts the negative
  // — no key field, no key-shaped content — as a regression guard, not a
  // proof the redaction logic itself was exercised.
  it('never contains Google Maps key material', () => {
    const fx = loadFixture('evidence_markdown')
    const reportJson = JSON.stringify(fx.input)
    expect(reportJson).not.toContain('googleMapsApiKey')
    expect(reportJson).not.toContain('google_maps_api_key')
    expect(reportJson).not.toMatch(/AIza[0-9A-Za-z_-]{10,}/) // Google API key shape
    const md = renderEvidenceMarkdown(fx.input)
    expect(md).not.toContain('googleMapsApiKey')
    expect(md).not.toMatch(/AIza[0-9A-Za-z_-]{10,}/)
  })
})

// Drives a TS run to completion with the SAME package/scenario/plan/run ids
// the Python fixture-capture script used (see task-S8.1-report.md), so the
// resulting RunLog's deterministic content (events, parameters,
// hyperparameters, profiles, route_facts) — and hence the report's
// `simulator_facts`/`human_review` — matches the fixture exactly. report_id
// and timestamp are excluded from the comparison: they are generated fresh
// (outside the deterministic decision path) by buildEvidenceReport on every
// call, exactly like Python's router-boundary `_make_report_id()`/
// `datetime.now()` — never asserted byte-for-byte anywhere in this port
// (mirrors run_log_e2e's `created_at` exclusion — see run_manager.test.ts).
describe('buildEvidenceReport parity (report builder, not just the renderer)', () => {
  it('derives a report matching build_evidence_report byte-for-byte (excluding report_id/timestamp)', async () => {
    const fx = loadFixture('evidence_report')
    const { package: pkg, scenario, presets, parameters, hyperparameters, runMode, recoveryOptionId, restSpot, uiLanguage, feedback } =
      fx.input

    const planId = 'plan_evidence_fixture'
    const { draft } = createDraft({ planId, package: pkg, scenario, presets, parameters, hyperparameters, runMode })
    expect(draft.validation_errors).toEqual([])

    const runId = 'run_evidence_fixture'
    await createRun(planId, runId)

    let acceptedOnce = false
    let outcome
    let guard = 0
    do {
      guard += 1
      if (guard > 1000) throw new Error('run did not complete within 1000 ticks — REST_PROPOSAL likely never fired')
      outcome = await tick(runId)
      if (outcome.completed) break
      if (outcome.paused) {
        if (!acceptedOnce) {
          expect(outcome.decision?.result_type).toBe('REST_PROPOSAL')
          await action(runId, 'accept_rest', { recoveryOptionId, restSpot })
          acceptedOnce = true
        } else {
          await action(runId, 'decline')
        }
      }
    } while (!outcome.completed)

    expect(acceptedOnce).toBe(true)

    // Replay the same two feedback events the fixture-capture script
    // appended, so human_review has non-trivial content on both sides.
    await appendFeedback(runId, feedback.decision)
    await appendFeedback(runId, feedback.run)

    const actual = await buildEvidenceReport(runId, uiLanguage)

    // report_id/timestamp are non-deterministic by design — overwrite with
    // the fixture's values before the deep-parity check (the ONLY excluded
    // fields; run_id matches because this test reuses the fixture's exact
    // run_id, and every other field is fully deterministic simulation
    // output).
    const normalized = { ...actual, report_id: fx.output.report_id, timestamp: fx.output.timestamp }
    expectParity(normalized, fx.output)

    // Separation invariant, asserted directly on the BUILT report (not just
    // the pre-baked markdown fixture): simulator_facts must never carry a
    // feedback value.
    const simulatorFactsStr = JSON.stringify(actual.simulator_facts)
    expect(simulatorFactsStr).not.toContain('proposal_timing')
    expect(simulatorFactsStr).not.toContain('good_trigger')
    expect(actual.human_review.feedback_labels.length).toBeGreaterThan(0)
    expect(actual.human_review.free_text_comments.length).toBeGreaterThan(0)

    // MAP KEY EXCLUSION guard on the BUILT report too.
    const reportStr = JSON.stringify(actual)
    expect(reportStr).not.toContain('googleMapsApiKey')
    expect(reportStr).not.toMatch(/AIza[0-9A-Za-z_-]{10,}/)

    // Rendering the BUILT (not fixture) report through the ported markdown
    // formatter must also match the fixture's markdown byte-for-byte, once
    // report_id/timestamp are normalized — proving builder + renderer
    // compose correctly end to end (the actual getEvidenceMarkdown seam).
    const mdFixture = loadFixture('evidence_markdown')
    expect(renderEvidenceMarkdown(normalized)).toBe(mdFixture.output)
  })
})
