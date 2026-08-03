import { describe, expect, it } from 'vitest'
import {
  mergedExplainEndpoint,
  explainTriggerEndpoint,
  type MergedExplainBody,
  type ExplainTriggerBody,
} from '../src/engine/merged/explain'
import { generateExplanation } from '../src/engine/proposal/orchestrator/explain'
import { ProposalHttpError } from '../src/engine/proposal/orchestrator/create_run'
import { ExplanationProviderUnsupportedError } from '../src/api/errors'
import { serializeError, unwrap } from '../src/api/rpc'
import { loadFixture, expectParity } from '../src/engine/__fixtures__/parity'
import { ensureRegistry } from '../src/data/registry'

/**
 * Conformance test for `src/engine/merged/explain.ts` — the port of
 * `merged_explain_endpoint` (routers/merged_runs.py:553-600) and
 * `explain_trigger_endpoint` (600-681) — feature 026 (htmlapp Combined
 * export), slice C4 Task 8. See `explain.ts`'s own module doc for the full
 * control-flow enumeration, the LLM-provider-gap design, the `.get`/
 * truthiness audit, and the hazard pass; this file does not repeat that
 * reasoning, only the resulting test evidence.
 *
 * Fixture: `src/engine/__fixtures__/parity/merged_explain.json`, captured
 * by `scripts/gen/capture_all.py#_capture_merged_explain` — every
 * `raises`/`result` case calls the REAL `merged_explain_endpoint`/
 * `explain_trigger_endpoint` directly, `provider="browser"`/`"template"`
 * ONLY (the values Python and this port can be compared byte-for-byte on).
 * The fixture's own `input` carries the REPLAYABLE `proposal_pre_select`/
 * `proposal_post_select`/`real_rest_fire`/`real_monotony_fire` payloads —
 * this test posts those SAME objects through the TS port rather than
 * reconstructing a run/fire independently, so a golden mismatch can only
 * come from the port's own logic, never from an incidentally-different
 * input.
 *
 * ── Branch coverage table (per the task brief's reporting rule) ────────────
 *
 * Three providers, both endpoints:
 *   `mergedExplainEndpoint`: `'browser'` — golden parity
 *     (`service_browser_success`/`content_browser_success`/
 *     `unknown_target_422`). `'off'` — no Python equivalent (Python's real
 *     `ExplainRequestBody.provider` literal never accepts it) — direct unit
 *     test. `'backend'` (the default when omitted, matching Python's own
 *     field default) — `ExplanationProviderUnsupportedError` thrown,
 *     BEFORE `explainFromRunLog`'s own `findExplainTarget` runs (proven
 *     against a run that would OTHERWISE 422 for an unrelated reason), plus
 *     the RPC round-trip test.
 *   `explainTriggerEndpoint`: `'browser'` — golden parity (both categories).
 *     `'template'` — golden parity (`template_provider_success`).
 *     `'backend'` (the default when omitted) — `ExplanationProviderUnsupportedError`
 *     thrown BEFORE `FirePoint` validation even runs (proven against a
 *     malformed `fire` that would OTHERWISE 422 for an unrelated reason),
 *     plus its OWN RPC round-trip test (a second, independent throw site
 *     for the SAME shared error class/serialization branch — see the brief's
 *     "test the round trip through the real worker seam, not just the
 *     throw site").
 * `mergedExplainEndpoint`'s own literal-validation gate: `step` ∉
 *   {service,content,trigger} -> 422 (`unknown_step_422`); `provider` ∉
 *   {backend,browser,off} -> 422 (`unknown_provider_422`); `step="trigger"`
 *   — a REAL, reachable Python behavior (accepted by the literal check,
 *   then ALWAYS `no_decision` 422 one level down, since no
 *   `AlgorithmEvidence.step` is ever `"trigger"`) — golden parity
 *   (`step_trigger_no_decision_422`). `body.proposal` shape: well-formed
 *   (golden success cases) and malformed-but-a-dict (golden
 *   `malformed_proposal_missing_evidence_422`) and not-a-dict-at-all (no
 *   Python-comparable capture — FastAPI's own request parsing would reject
 *   it before the endpoint function ever runs — direct unit test).
 * `explainTriggerEndpoint`'s own control flow: explicit `category` (golden,
 *   both categories); `category` omitted, resolved from the fire's own
 *   recorded `category` (golden `rest_omitted_category_resolves_from_fire_
 *   own_category` — the THIRD, both-None max-tiebreak `resolveCategory`
 *   branch is already exhaustively covered at the unit level by
 *   `trigger_explanation.json`, C3 Task 2, not re-derived here); explicit
 *   `category` absent from the fire's own chains -> 422 (golden
 *   `unknown_category_422`); malformed `fire` missing `tick`/`time_min`
 *   (golden `malformed_fire_422`); `fire` not a dict at all (no
 *   Python-comparable capture, same reasoning as `mergedExplainEndpoint`'s
 *   own not-a-dict case — direct unit test).
 *
 * "PORTED-TO-GREEN IS NOT EVIDENCE" — disclosed gaps: `validateProposalRunLogShape`'s
 * per-required-field problem accumulation is exercised only via the
 * missing-`evidence` case (one field) — the OTHER required fields
 * (`run_id`/`created_at`/`opportunity`/etc.) share the exact same
 * `problems.push` shape per field and are not each independently golden-
 * tested; a targeted unit test below drives a proposal missing THREE
 * different-typed required fields at once to prove the accumulation (not
 * just the single-field path) without needing nine separate Python
 * captures for what is structurally the same check repeated per field.
 */

ensureRegistry()

const { input, output } = loadFixture('merged_explain')
const EXPLAIN_CASES: Record<string, any> = output.merged_explain
const TRIGGER_CASES: Record<string, any> = output.explain_trigger
const PROPOSAL_PRE_SELECT: Record<string, unknown> = input.proposal_pre_select
const PROPOSAL_POST_SELECT: Record<string, unknown> = input.proposal_post_select
const REAL_REST_FIRE: Record<string, unknown> = input.real_rest_fire
const REAL_MONOTONY_FIRE: Record<string, unknown> = input.real_monotony_fire

function deepCopy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

// ---------------------------------------------------------------------------
// mergedExplainEndpoint — golden parity (provider="browser")
// ---------------------------------------------------------------------------

describe('mergedExplainEndpoint — success paths, byte-exact against real Python', () => {
  it('service_browser_success', async () => {
    const golden = EXPLAIN_CASES.service_browser_success
    const body: MergedExplainBody = {
      proposal: deepCopy(PROPOSAL_PRE_SELECT),
      step: 'service',
      target_id: golden.result.target_id,
      provider: 'browser',
    }
    const result = await mergedExplainEndpoint(body)
    expectParity(result, golden.result)
  })

  it('content_browser_success', async () => {
    const golden = EXPLAIN_CASES.content_browser_success
    const body: MergedExplainBody = {
      proposal: deepCopy(PROPOSAL_POST_SELECT),
      step: 'content',
      target_id: golden.result.target_id,
      provider: 'browser',
    }
    const result = await mergedExplainEndpoint(body)
    expectParity(result, golden.result)
  })
})

describe('mergedExplainEndpoint — raising paths', () => {
  it('unknown_target_422 — byte-exact structured detail', async () => {
    const golden = EXPLAIN_CASES.unknown_target_422
    const body: MergedExplainBody = {
      proposal: deepCopy(PROPOSAL_PRE_SELECT),
      step: 'service',
      target_id: 'not-a-real-candidate-id',
      provider: 'browser',
    }
    await expect(mergedExplainEndpoint(body)).rejects.toMatchObject({
      status: golden.status_code,
      detail: golden.detail,
    })
  })

  it('step_trigger_no_decision_422 — REAL Python behavior: "trigger" step always misses evidence, byte-exact', async () => {
    const golden = EXPLAIN_CASES.step_trigger_no_decision_422
    const body: MergedExplainBody = {
      proposal: deepCopy(PROPOSAL_PRE_SELECT),
      step: 'trigger',
      target_id: 'anything',
      provider: 'browser',
    }
    await expect(mergedExplainEndpoint(body)).rejects.toMatchObject({
      status: golden.status_code,
      detail: golden.detail,
    })
  })

  it('unknown_step_422 — semantic (bare-string pydantic message not byte-reproduced, per this port\'s ACCEPTED DIVERGENCE precedent)', async () => {
    const golden = EXPLAIN_CASES.unknown_step_422
    const body: MergedExplainBody = {
      proposal: deepCopy(PROPOSAL_PRE_SELECT),
      step: 'bogus_step',
      target_id: 'anything',
      provider: 'browser',
    }
    let thrown: unknown
    try {
      await mergedExplainEndpoint(body)
      expect.unreachable()
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(ProposalHttpError)
    expect((thrown as ProposalHttpError).status).toBe(golden.status_code)
    expect(typeof (thrown as ProposalHttpError).detail).toBe('string')
    expect((thrown as ProposalHttpError).detail as string).toContain('step')
  })

  it('unknown_provider_422 — semantic', async () => {
    const golden = EXPLAIN_CASES.unknown_provider_422
    const body: MergedExplainBody = {
      proposal: deepCopy(PROPOSAL_PRE_SELECT),
      step: 'service',
      target_id: 'anything',
      provider: 'nonsense_provider',
    }
    let thrown: unknown
    try {
      await mergedExplainEndpoint(body)
      expect.unreachable()
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(ProposalHttpError)
    expect((thrown as ProposalHttpError).status).toBe(golden.status_code)
    expect((thrown as ProposalHttpError).detail as string).toContain('provider')
  })

  it('malformed_proposal_missing_evidence_422 — semantic: real ProposalRunLog.model_validate failure, real Python-comparable 422', async () => {
    const golden = EXPLAIN_CASES.malformed_proposal_missing_evidence_422
    const malformed = deepCopy(PROPOSAL_PRE_SELECT)
    delete (malformed as Record<string, unknown>)['evidence']
    const body: MergedExplainBody = {
      proposal: malformed,
      step: 'service',
      target_id: 'anything',
      provider: 'browser',
    }
    let thrown: unknown
    try {
      await mergedExplainEndpoint(body)
      expect.unreachable()
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(ProposalHttpError)
    expect((thrown as ProposalHttpError).status).toBe(golden.status_code)
    expect((thrown as ProposalHttpError).detail as string).toContain('evidence')
  })
})

// ---------------------------------------------------------------------------
// mergedExplainEndpoint — offline-only branches, no Python-comparable
// capture (see explain.ts's own module doc + _capture_merged_explain's own
// docstring for why)
// ---------------------------------------------------------------------------

describe('mergedExplainEndpoint — offline-only provider branches (unit, no golden)', () => {
  it('provider="off" — the offline-only deterministic-template value; no Python equivalent exists to compare against', async () => {
    const body: MergedExplainBody = {
      proposal: deepCopy(PROPOSAL_PRE_SELECT),
      step: 'service',
      target_id: EXPLAIN_CASES.service_browser_success.result.target_id,
      provider: 'off',
    }
    const result = await mergedExplainEndpoint(body)
    expect(result.requested_provider).toBe('off')
    expect(result.provider_used).toBe('template')
    expect(result.fell_back).toBe(false)
    expect(result.error).toBeNull()
    expect(result.rationale.length).toBeGreaterThan(0)
  })

  it('provider omitted defaults to "backend" (mirrors Python\'s own field default) -> ExplanationProviderUnsupportedError', async () => {
    const body: MergedExplainBody = {
      proposal: deepCopy(PROPOSAL_PRE_SELECT),
      step: 'service',
      target_id: 'anything',
    }
    await expect(mergedExplainEndpoint(body)).rejects.toBeInstanceOf(ExplanationProviderUnsupportedError)
  })

  it('provider="backend" explicit -> ExplanationProviderUnsupportedError, thrown BEFORE findExplainTarget runs (proven against a target_id that would otherwise 422 for an unrelated reason)', async () => {
    const body: MergedExplainBody = {
      proposal: deepCopy(PROPOSAL_PRE_SELECT),
      step: 'service',
      // A target_id guaranteed absent from the real evidence -- if the
      // backend gate did NOT fire first, this would instead reject with a
      // ProposalHttpError(422, UnknownTargetDetail), not
      // ExplanationProviderUnsupportedError.
      target_id: 'definitely-not-a-real-candidate-id',
      provider: 'backend',
    }
    await expect(mergedExplainEndpoint(body)).rejects.toBeInstanceOf(ExplanationProviderUnsupportedError)
  })

  it('proposal not a dict at all -> 422 (no Python-comparable capture: FastAPI request parsing would reject this before merged_explain_endpoint ever runs)', async () => {
    const body = {
      proposal: 'not-a-dict' as unknown as Record<string, unknown>,
      step: 'service',
      target_id: 'anything',
      provider: 'browser',
    } as MergedExplainBody
    let thrown: unknown
    try {
      await mergedExplainEndpoint(body)
      expect.unreachable()
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(ProposalHttpError)
    expect((thrown as ProposalHttpError).status).toBe(422)
  })

  it('validateProposalRunLogShape accumulates MULTIPLE problems, not just the first (three differently-typed required fields missing at once)', async () => {
    const malformed = deepCopy(PROPOSAL_PRE_SELECT) as Record<string, unknown>
    delete malformed['run_id'] // required string
    delete malformed['opportunity'] // required object
    delete malformed['events'] // required array
    const body: MergedExplainBody = { proposal: malformed, step: 'service', target_id: 'anything', provider: 'browser' }
    let thrown: unknown
    try {
      await mergedExplainEndpoint(body)
      expect.unreachable()
    } catch (e) {
      thrown = e
    }
    const detail = (thrown as ProposalHttpError).detail as string
    expect(detail).toContain('run_id')
    expect(detail).toContain('opportunity')
    expect(detail).toContain('events')
    expect(detail.startsWith('3 validation error')).toBe(true)
  })

  it('the ExplanationProviderUnsupportedError round trip survives the real worker seam (serializeError -> structuredClone -> unwrap), mergedExplainEndpoint throw site', async () => {
    let thrown: unknown
    try {
      await mergedExplainEndpoint({
        proposal: deepCopy(PROPOSAL_PRE_SELECT), step: 'service', target_id: 'x', provider: 'backend',
      })
      expect.unreachable()
    } catch (e) {
      thrown = e
    }
    const wire = serializeError(thrown)
    expect(wire.type).toBe('ExplanationProviderUnsupportedError')
    expect(wire.provider).toBe('backend')
    const cloned = structuredClone(wire)
    expect(cloned.provider).toBe('backend')
    expect(() => unwrap({ ok: false, error: cloned })).toThrow(ExplanationProviderUnsupportedError)
  })
})

// ---------------------------------------------------------------------------
// explainTriggerEndpoint — golden parity
// ---------------------------------------------------------------------------

describe('explainTriggerEndpoint — success paths, byte-exact against real Python', () => {
  it('rest_explicit_category_browser_success', () => {
    const golden = TRIGGER_CASES.rest_explicit_category_browser_success
    const body: ExplainTriggerBody = { fire: deepCopy(REAL_REST_FIRE), category: 'rest_required', provider: 'browser' }
    const result = explainTriggerEndpoint(body)
    expectParity(result, golden.result)
  })

  it('rest_omitted_category_resolves_from_fire_own_category — SECOND resolveCategory priority branch (explicit None -> fire.category)', () => {
    const golden = TRIGGER_CASES.rest_omitted_category_resolves_from_fire_own_category
    const body: ExplainTriggerBody = { fire: deepCopy(REAL_REST_FIRE), category: null, provider: 'browser' }
    const result = explainTriggerEndpoint(body)
    expectParity(result, golden.result)
    expect(result.target_id).toBe('rest_required')
  })

  it('monotony_explicit_category_browser_success — the sibling category, proving the wiring is not rest-only', () => {
    const golden = TRIGGER_CASES.monotony_explicit_category_browser_success
    const body: ExplainTriggerBody = { fire: deepCopy(REAL_MONOTONY_FIRE), category: 'monotony_prevention', provider: 'browser' }
    const result = explainTriggerEndpoint(body)
    expectParity(result, golden.result)
  })

  it('template_provider_success — feature 025 S11, deterministic, no Ollama call', () => {
    const golden = TRIGGER_CASES.template_provider_success
    const body: ExplainTriggerBody = { fire: deepCopy(REAL_REST_FIRE), category: 'rest_required', provider: 'template' }
    const result = explainTriggerEndpoint(body)
    expectParity(result, golden.result)
    expect(result.provider_used).toBe('template')
    expect(result.fell_back).toBe(false)
    expect(result.error).toBeNull()
  })
})

describe('explainTriggerEndpoint — raising paths', () => {
  it('unknown_category_422 — byte-exact structured detail', () => {
    const golden = TRIGGER_CASES.unknown_category_422
    const body: ExplainTriggerBody = { fire: deepCopy(REAL_REST_FIRE), category: 'not_a_real_category', provider: 'browser' }
    expect(() => explainTriggerEndpoint(body)).toThrowError()
    try {
      explainTriggerEndpoint(body)
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(ProposalHttpError)
      expect((e as ProposalHttpError).status).toBe(golden.status_code)
      expect((e as ProposalHttpError).detail).toEqual(golden.detail)
    }
  })

  it('malformed_fire_422 — semantic: real FirePoint.model_validate failure (missing tick/time_min), real Python-comparable 422', () => {
    const golden = TRIGGER_CASES.malformed_fire_422
    const body: ExplainTriggerBody = { fire: { category: 'rest_required' }, provider: 'browser' }
    let thrown: unknown
    try {
      explainTriggerEndpoint(body)
      expect.unreachable()
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(ProposalHttpError)
    expect((thrown as ProposalHttpError).status).toBe(golden.status_code)
    const detail = (thrown as ProposalHttpError).detail as string
    expect(detail).toContain('tick')
    expect(detail).toContain('time_min')
  })
})

// ---------------------------------------------------------------------------
// explainTriggerEndpoint — offline-only provider branches, no Python-
// comparable capture (see explain.ts's own module doc)
// ---------------------------------------------------------------------------

describe('explainTriggerEndpoint — offline-only provider branches (unit, no golden)', () => {
  it('provider omitted defaults to "backend" (mirrors Python\'s own field default) -> ExplanationProviderUnsupportedError', () => {
    expect(() => explainTriggerEndpoint({ fire: deepCopy(REAL_REST_FIRE) })).toThrow(ExplanationProviderUnsupportedError)
  })

  it('provider="backend" explicit -> ExplanationProviderUnsupportedError, thrown BEFORE FirePoint validation runs (proven against a malformed fire that would otherwise 422 for an unrelated reason)', () => {
    const body: ExplainTriggerBody = { fire: { category: 'rest_required' }, provider: 'backend' }
    expect(() => explainTriggerEndpoint(body)).toThrow(ExplanationProviderUnsupportedError)
  })

  it('fire not a dict at all -> 422 (no Python-comparable capture, same reasoning as mergedExplainEndpoint\'s own not-a-dict case)', () => {
    const body = { fire: 'not-a-dict' as unknown as Record<string, unknown>, provider: 'browser' } as ExplainTriggerBody
    expect(() => explainTriggerEndpoint(body)).toThrow(ProposalHttpError)
  })

  it('the ExplanationProviderUnsupportedError round trip survives the real worker seam (serializeError -> structuredClone -> unwrap), explainTriggerEndpoint\'s OWN throw site (a second, independent throw site for the shared error class/serialization branch)', () => {
    let thrown: unknown
    try {
      explainTriggerEndpoint({ fire: deepCopy(REAL_REST_FIRE), provider: 'backend' })
      expect.unreachable()
    } catch (e) {
      thrown = e
    }
    const wire = serializeError(thrown)
    expect(wire.type).toBe('ExplanationProviderUnsupportedError')
    expect(wire.provider).toBe('backend')
    const cloned = structuredClone(wire)
    expect(cloned.provider).toBe('backend')
    expect(() => unwrap({ ok: false, error: cloned })).toThrow(ExplanationProviderUnsupportedError)
  })
})

// ---------------------------------------------------------------------------
// generateExplanation — direct check that this file's own 'browser' calls
// reuse the ALREADY-tested shared machinery verbatim (not a re-derivation
// of proposal_explain_port.test.ts's own generateExplanation unit tests).
// ---------------------------------------------------------------------------

describe('generateExplanation — reused verbatim, sanity only', () => {
  it("provider='browser' returns immediately with empty rationale (no template call)", () => {
    const templateFn = () => ['ja', 'en'] as [string, string]
    const [rationale, providerUsed, model, fellBack, error] = generateExplanation(
      { messages: [], grounding: {} },
      'browser',
      templateFn,
    )
    expect(rationale).toEqual([])
    expect(providerUsed).toBe('browser')
    expect(model).toBe('gemini-nano')
    expect(fellBack).toBe(false)
    expect(error).toBeNull()
  })
})

