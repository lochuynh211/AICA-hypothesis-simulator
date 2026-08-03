import { describe, expect, it, beforeEach } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import {
  explainFromRunLog,
  findExplainTarget,
  generateExplanation,
  type ExplainRequestBody,
} from '../src/engine/proposal/orchestrator/explain'
import { createProposalRun, ProposalHttpError, type CreateProposalRunBody } from '../src/engine/proposal/orchestrator/create_run'
import { selectService } from '../src/engine/proposal/orchestrator/select_service'
import { promptHash, type ExplanationPrompt } from '../src/engine/explanation/builder'
import { getRun, type ProposalRunLog } from '../src/engine/proposal/run_manager'
import { worldSeedStore, proposalPackageRegistry } from '../src/engine/proposal/stores'
import { ensureRegistry } from '../src/data/registry'
import { loadFixture, expectParity } from '../src/engine/__fixtures__/parity'
import { proposalRunsStore } from '../src/storage/proposal_runs_store'
import { ExplanationProviderUnsupportedError } from '../src/api/errors'
import { serializeError, unwrap } from '../src/api/rpc'

/**
 * Conformance test for `src/engine/proposal/orchestrator/explain.ts` — the
 * port of `explain_from_run_log` + `_generate_explanation` +
 * `_find_explain_target` (`app/api/aica_api/routers/proposal.py`), plus
 * `promptHash` (`src/engine/explanation/builder.ts`, ported into that file
 * by this same task) — feature 026 (htmlapp Combined export), slice C4a
 * Task 7, the LAST porting task. See `explain.ts`'s own module doc for the
 * full control-flow enumeration, the `off`/`browser`/`backend` design, the
 * `.get`/truthiness audit, and the hazard pass; this file does not repeat
 * that reasoning, only the resulting test evidence.
 *
 * Fixture: `src/engine/__fixtures__/parity/proposal_explain.json`, captured
 * by `scripts/gen/capture_all.py#_capture_proposal_explain` — every
 * `raises`/`result` case calls the REAL `explain_from_run_log` directly,
 * `provider="browser"` ONLY (the one provider value Python and this port
 * can be compared byte-for-byte on — see that capture function's own
 * module doc for why `"off"`/`"backend"` have no Python-comparable
 * behavior to capture at all). Group A cases run against a real,
 * disk-persisted run (`seed-night-highway-oshi`, chosen because it has a
 * registered oshi — exercises `_resolve_oshi_artist`'s real non-None path);
 * Group B cases hand-build a `run_log` (mirroring
 * `proposal_select_service.json`'s own Group B technique) for the
 * evidence-absent/evidence-errored/evidence-empty-output `_find_explain_
 * target` branches real committed data cannot reach.
 *
 * ── Branch coverage table (per the task brief's reporting rule) ────────────
 *
 * Three providers:
 *   `'browser'` — golden parity (`service_browser_success`/`content_
 *     browser_success`/`*_unknown_target_422`), plus a direct
 *     `generateExplanation` unit test.
 *   `'off'` — no Python equivalent to capture parity against (see
 *     `explain.ts`'s own module doc) — direct `generateExplanation` unit
 *     test PLUS an `explainFromRunLog` integration test covering both
 *     `persistRunId === null` (ephemeral, no append) and a real
 *     `persistRunId` (appends a real `Explanation`, read back via `getRun`
 *     and asserted field-by-field).
 *   `'backend'` — `ExplanationProviderUnsupportedError` thrown BEFORE
 *     `findExplainTarget` even runs (proven against a run that would
 *     OTHERWISE 422 for an unrelated reason — the capability-gap error
 *     fires first, not incidentally), plus an RPC round-trip test
 *     (`serializeError`/`unwrap`) proving `.provider` survives the wire,
 *     per the brief's own callout about `rpc.ts`'s generic `{type,
 *     message}` fallback silently dropping custom fields.
 * `_find_explain_target` outcomes, ALL reached:
 *   found+target found (`service_browser_success`/`content_browser_
 *     success`); found+target NOT found (`*_unknown_target_422`); no
 *     evidence recorded at all, real (`content_no_decision_422_before_
 *     select_service`) AND hand-built (`service_no_decision_422_empty_
 *     evidence`); evidence present but `error is not None`
 *     (`service_no_decision_422_only_errored_evidence`); evidence present,
 *     `error is None`, but `output` is Python-falsy (`{}`) —
 *     `service_no_decision_422_error_none_but_output_empty_dict`, proving
 *     the bare `pyTruthy(e.output)` guard is independently load-bearing,
 *     not merely redundant with the `error is None` check (see that
 *     golden case's own `note`, and the mutation-test describe block
 *     below).
 * Both explanation steps (`'service'`/`'content'`): both reached by every
 *   describe block above.
 * Persistence: browser NEVER persists even with `persistRunId` set
 *   (`browser_provider_never_persists_even_with_persist_run_id_set`); off
 *   DOES persist (TS-only integration test, no Python equivalent).
 * `promptHash`: 8 named byte-parity cases (ASCII, quotes+backslash,
 *   newline/tab/CR, Japanese+full-width punctuation, empty `messages`,
 *   multi-message ordering, plus 2 REAL prompts reusing the exact captured
 *   messages `service_browser_success`/`content_browser_success` produce)
 *   plus one live end-to-end cross-check (`promptHash` of an actual
 *   `explainFromRunLog` response's own `prompt` against the matching
 *   `prompt_hash_cases` entry).
 */

ensureRegistry()
beforeEach(() => { globalThis.indexedDB = new IDBFactory() })

const { output } = loadFixture('proposal_explain')
const CASES: Record<string, any> = Object.fromEntries(
  output.explain_cases.map((c: any) => [c.name, c]),
)
const PROMPT_HASH_CASES: Record<string, { messages: { role: string; content: string }[]; hash: string }> =
  output.prompt_hash_cases

const SERVICE_PKG_ID = 'aica_transparent_service_selector_v1'
const CONTENT_PKG_ID = 'aica_transparent_content_selector_v1'
const SEED_ID = 'seed-night-highway-oshi'

function deepCopy<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => deepCopy(v)) as unknown as T
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = deepCopy(v)
    return out as unknown as T
  }
  return value
}

function baseWorld(): Record<string, unknown> {
  const seed = worldSeedStore.getSeed(SEED_ID)
  if (!seed) throw new Error(`fixture seed not found: ${SEED_ID}`)
  return deepCopy(seed.world as Record<string, unknown>)
}

/** Mirrors the capture script's own `_capture_proposal_explain` setup —
 * same seed/run_seed/simulation_time/mode, so the resulting run's real
 * service evidence (candidate ids, ranking) is byte-identical to what the
 * golden itself was captured against. */
async function makeRun(): Promise<ProposalRunLog> {
  const body: CreateProposalRunBody = {
    world: baseWorld(),
    service_package_id: SERVICE_PKG_ID,
    content_package_id: CONTENT_PKG_ID,
    run_seed: 'seed-explain-test',
    simulation_time: '2026-08-02T09:00:00Z',
    mode: 'interactive',
  }
  return await createProposalRun(body)
}

function realServiceCandidateId(run: ProposalRunLog): string {
  const ev = [...run.evidence].reverse().find((e) => e.step === 'service' && e.error === null)
  if (!ev) throw new Error('no service evidence on run')
  const output = ev.output as any
  return output.ranked_candidates[0].candidate_id
}

function realContentItemId(run: ProposalRunLog): string {
  const ev = [...run.evidence].reverse().find((e) => e.step === 'content' && e.error === null)
  if (!ev) throw new Error('no content evidence on run')
  const output = ev.output as any
  return output.ordered_items[0].item_id
}

// ---------------------------------------------------------------------------
// explainFromRunLog — provider="browser", success-path parity against real
// Python explain_from_run_log()
// ---------------------------------------------------------------------------

describe('explainFromRunLog — provider="browser" success paths, byte-exact against real Python', () => {
  it('service_browser_success', async () => {
    const golden = CASES.service_browser_success
    const run = await makeRun()
    const candidateId = realServiceCandidateId(run)
    const result = await explainFromRunLog(run, { step: 'service', target_id: candidateId, provider: 'browser' }, null)
    expectParity(result, golden.result)
  })

  it('content_browser_success (real oshi seed -- exercises song_name/song_artist/oshi_artist all non-null)', async () => {
    const golden = CASES.content_browser_success
    const run = await makeRun()
    const run2 = await selectService(run.run_id, { selected_service_id: 'music_playlist' })
    const itemId = realContentItemId(run2)
    const result = await explainFromRunLog(run2, { step: 'content', target_id: itemId, provider: 'browser' }, null)
    expectParity(result, golden.result)
    // oshi grounding really made it into the prompt -- not merely null-safe.
    expect((result.prompt.grounding as any).song_facts.join('\n')).toContain("driver's oshi")
  })

  it('browser_provider_never_persists_even_with_persist_run_id_set', async () => {
    const golden = CASES.browser_provider_never_persists_even_with_persist_run_id_set
    const run = await makeRun()
    const candidateId = realServiceCandidateId(run)
    const result = await explainFromRunLog(
      run, { step: 'service', target_id: candidateId, provider: 'browser' }, run.run_id,
    )
    expectParity(result, golden.result)
    const reloaded = await getRun(run.run_id)
    expect(reloaded?.explanations).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// explainFromRunLog — raising paths, byte-exact against real Python detail
// ---------------------------------------------------------------------------

describe('explainFromRunLog — raising paths, byte-exact against real Python HTTPException detail', () => {
  it('service_unknown_target_422', async () => {
    const golden = CASES.service_unknown_target_422
    const run = await makeRun()
    await expect(
      explainFromRunLog(run, { step: 'service', target_id: 'not-a-real-candidate-id', provider: 'browser' }, null),
    ).rejects.toMatchObject({ status: golden.status_code, detail: golden.detail })
  })

  it('content_unknown_target_422', async () => {
    const golden = CASES.content_unknown_target_422
    const run = await makeRun()
    const run2 = await selectService(run.run_id, { selected_service_id: 'music_playlist' })
    await expect(
      explainFromRunLog(run2, { step: 'content', target_id: 'not-a-real-item-id', provider: 'browser' }, null),
    ).rejects.toMatchObject({ status: golden.status_code, detail: golden.detail })
  })

  it('content_no_decision_422_before_select_service', async () => {
    const golden = CASES.content_no_decision_422_before_select_service
    const run = await makeRun()
    await expect(
      explainFromRunLog(run, { step: 'content', target_id: 'anything', provider: 'browser' }, null),
    ).rejects.toMatchObject({ status: golden.status_code, detail: golden.detail })
  })

  it('every raising case is a real ProposalHttpError(422) instance carrying the exact golden detail', async () => {
    const run = await makeRun()
    try {
      await explainFromRunLog(
        run, { step: 'service', target_id: 'not-a-real-candidate-id', provider: 'browser' }, null,
      )
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(ProposalHttpError)
      expect((err as ProposalHttpError).status).toBe(422)
      expect((err as ProposalHttpError).detail).toEqual(CASES.service_unknown_target_422.detail)
    }
  })
})

// ---------------------------------------------------------------------------
// _find_explain_target -- the two "no evidence at all"/"errored"/"empty
// output" branches real committed data cannot reach through create_run
// ---------------------------------------------------------------------------

describe('_find_explain_target — evidence-absent / evidence-errored / evidence-empty-output (hand-built run_logs, mirrors proposal_select_service.json Group B)', () => {
  function toCreateArgs(): CreateProposalRunBody {
    return {
      world: baseWorld(),
      service_package_id: SERVICE_PKG_ID,
      content_package_id: CONTENT_PKG_ID,
      run_seed: 'seed-hand-built', simulation_time: '2026-08-02T09:00:00Z', mode: 'interactive',
    }
  }

  it('service_no_decision_422_empty_evidence: findExplainTarget returns {ev: null, target: null} when evidence is []', () => {
    const runLog = {
      run_id: 'r', created_at: '', opportunity: {} as any, matrix_version: 'v1',
      world_snapshot: {}, setup_snapshot: null, service_package_id: SERVICE_PKG_ID,
      content_package_id: CONTENT_PKG_ID, parameters: {}, hyperparameters: {},
      content_parameters: {}, content_hyperparameters: {},
      journey_state: {} as any, events: [], evidence: [], status: 'created' as any,
      world: null, opportunity_history: [], setup_snapshot_history: [], mode: 'interactive' as any,
      explanations: [],
    }
    const found = findExplainTarget(runLog, 'service', 'anything')
    expect(found).toEqual({ ev: null, target: null })
  })

  it('service_no_decision_422_only_errored_evidence: one errored evidence entry (error != null) is skipped', () => {
    const runLog = {
      run_id: 'r', created_at: '', opportunity: {} as any, matrix_version: 'v1',
      world_snapshot: {}, setup_snapshot: null, service_package_id: SERVICE_PKG_ID,
      content_package_id: CONTENT_PKG_ID, parameters: {}, hyperparameters: {},
      content_parameters: {}, content_hyperparameters: {},
      journey_state: {} as any, events: [], status: 'error' as any,
      evidence: [{
        step: 'service' as const, package_id: SERVICE_PKG_ID, contract_version: '1.0.0',
        schema_version: '1.0.0', matrix_version: 'v1', input_snapshot: {}, output: null,
        error: { category: 'algorithm_exception', message: 'boom' },
        used_feature_ids: [], unused_available_features: [], missing_features: [],
      }],
      world: null, opportunity_history: [], setup_snapshot_history: [], mode: 'interactive' as any,
      explanations: [],
    }
    const found = findExplainTarget(runLog, 'service', 'anything')
    expect(found).toEqual({ ev: null, target: null })
  })

  it("service_no_decision_422_error_set_even_though_output_present: error IS set AND output is ALSO non-empty (even containing a candidate matching target_id) -- proves e.error === null is independently load-bearing, not masked by pyTruthy(e.output)", async () => {
    const golden = CASES.service_no_decision_422_error_set_even_though_output_present
    const runLog = {
      run_id: 'r', created_at: '', opportunity: {} as any, matrix_version: 'v1',
      world_snapshot: {}, setup_snapshot: null, service_package_id: SERVICE_PKG_ID,
      content_package_id: CONTENT_PKG_ID, parameters: {}, hyperparameters: {},
      content_parameters: {}, content_hyperparameters: {},
      journey_state: {} as any, events: [], status: 'error' as any,
      evidence: [{
        step: 'service' as const, package_id: SERVICE_PKG_ID, contract_version: '1.0.0',
        schema_version: '1.0.0', matrix_version: 'v1', input_snapshot: {},
        output: { ranked_candidates: [{ candidate_id: 'anything', rank: 1 }] },
        error: { category: 'algorithm_exception', message: 'boom' },
        used_feature_ids: [], unused_available_features: [], missing_features: [],
      }],
      world: null, opportunity_history: [], setup_snapshot_history: [], mode: 'interactive' as any,
      explanations: [],
    }
    // findExplainTarget in isolation:
    const found = findExplainTarget(runLog, 'service', 'anything')
    expect(found).toEqual({ ev: null, target: null })
    // ...and the full explainFromRunLog path, byte-exact against the real
    // captured Python detail (not just "some 422").
    await expect(
      explainFromRunLog(runLog, { step: 'service', target_id: 'anything', provider: 'browser' }, null),
    ).rejects.toMatchObject({ status: golden.status_code, detail: golden.detail })
  })

  it('service_no_decision_422_error_none_but_output_empty_dict: error is None but output is {} (Python-falsy) -- the SEPARATE pyTruthy(e.output) guard, not the error check', () => {
    const golden = CASES.service_no_decision_422_error_none_but_output_empty_dict
    const runLog = {
      run_id: 'r', created_at: '', opportunity: {} as any, matrix_version: 'v1',
      world_snapshot: {}, setup_snapshot: null, service_package_id: SERVICE_PKG_ID,
      content_package_id: CONTENT_PKG_ID, parameters: {}, hyperparameters: {},
      content_parameters: {}, content_hyperparameters: {},
      journey_state: {} as any, events: [], status: 'created' as any,
      evidence: [{
        step: 'service' as const, package_id: SERVICE_PKG_ID, contract_version: '1.0.0',
        schema_version: '1.0.0', matrix_version: 'v1', input_snapshot: {}, output: {},
        error: null,
        used_feature_ids: [], unused_available_features: [], missing_features: [],
      }],
      world: null, opportunity_history: [], setup_snapshot_history: [], mode: 'interactive' as any,
      explanations: [],
    }
    const found = findExplainTarget(runLog, 'service', 'anything')
    expect(found).toEqual({ ev: null, target: null })

    // Cross-checked against the real captured Python detail via the full
    // explainFromRunLog path too, not just findExplainTarget in isolation.
    return expect(
      explainFromRunLog(runLog, { step: 'service', target_id: 'anything', provider: 'browser' }, null),
    ).rejects.toMatchObject({ status: golden.status_code, detail: golden.detail })
  })

  // MUTATION CHECK (documented, actually performed, not automated -- this
  // repo has no mutation-testing tool wired in): both guards in
  // findExplainTarget's condition (`e.step === step && e.error === null &&
  // pyTruthy(e.output)`) were verified INDEPENDENTLY discriminating, each
  // by hand-editing the source to `true`, rerunning this whole file, and
  // reverting:
  //   - `e.error === null` -> `true`: the 4th test in THIS describe block
  //     (`service_no_decision_422_error_set_even_though_output_present`)
  //     flips from a 422 `no_decision` to a WRONG SUCCESSFUL match (the
  //     errored evidence's own non-empty `output` gets returned as a real
  //     decision). This is the case that matters: the FIRST attempt at
  //     this test (`service_no_decision_422_only_errored_evidence`, whose
  //     errored entry ALSO happens to have `output: null`) did NOT catch
  //     this mutation at all -- `pyTruthy(null)` is already false, so that
  //     case passes for the wrong reason regardless of the error guard.
  //     Caught during development, exactly the "test that passes for the
  //     wrong reason" trap the brief warns about -- fixed by adding the
  //     malformed-but-valid error+output-both-present golden case above.
  //   - `pyTruthy(e.output)` -> `true`: the 3rd test in this describe
  //     block (`service_no_decision_422_error_none_but_output_empty_dict`)
  //     flips from a 422 `no_decision` to a WRONG SUCCESSFUL match against
  //     `{}` as if it were a real decision (`target` still ends up `null`
  //     since `{}` has no `candidate_id` key, but `ev` is wrongly non-null
  //     -- `expect(found).toEqual({ev: null, target: null})` fails on the
  //     `ev` field specifically).
})

// ---------------------------------------------------------------------------
// generateExplanation — direct unit tests for all three requestable
// providers (off/browser/backend is enforced one layer up, see below)
// ---------------------------------------------------------------------------

describe('generateExplanation — direct unit tests', () => {
  const dummyPrompt: ExplanationPrompt = { messages: [{ role: 'system', content: 'x' }], grounding: {} }

  it("provider='browser' returns immediately, no template invoked", () => {
    let called = false
    const result = generateExplanation(dummyPrompt, 'browser', () => { called = true; return ['ja', 'en'] })
    expect(result).toEqual([[], 'browser', 'gemini-nano', false, null])
    expect(called).toBe(false)
  })

  it("provider='off' calls templateFn and returns fell_back=false, error=null (a deliberate choice, not a failure)", () => {
    let called = false
    const result = generateExplanation(dummyPrompt, 'off', () => { called = true; return ['ja-text', 'en-text'] })
    expect(result).toEqual([['ja-text', 'en-text'], 'template', 'template', false, null])
    expect(called).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// The off/browser/backend provider decision — explainFromRunLog level
// ---------------------------------------------------------------------------

describe('explainFromRunLog — the three providers', () => {
  it("provider='backend' throws ExplanationProviderUnsupportedError BEFORE findExplainTarget runs (proven against a run that would otherwise 422 for an unrelated reason)", async () => {
    const run = await makeRun()
    // This exact (step, target_id) pair would 422 unknown_target under
    // provider='browser' (proven by the golden-backed test above) -- if the
    // backend gate ran AFTER findExplainTarget, this call would throw
    // ProposalHttpError(422), not ExplanationProviderUnsupportedError.
    // MUTATION CHECK (documented, actually performed): moving the
    // `if (body.provider === 'backend')` guard to AFTER the
    // findExplainTarget/ev/target checks in explain.ts was verified by hand
    // to flip this exact assertion to a `ProposalHttpError` (422,
    // unknown_target) instead -- confirmed, then reverted.
    await expect(
      explainFromRunLog(run, { step: 'service', target_id: 'not-a-real-candidate-id', provider: 'backend' }, null),
    ).rejects.toBeInstanceOf(ExplanationProviderUnsupportedError)
    try {
      await explainFromRunLog(run, { step: 'service', target_id: 'not-a-real-candidate-id', provider: 'backend' }, null)
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(ExplanationProviderUnsupportedError)
      expect((err as ExplanationProviderUnsupportedError).provider).toBe('backend')
      expect((err as Error).message).toContain('not available in the offline build')
    }
  })

  it("provider='off', persistRunId=null (ephemeral): no persistence, honest template response", async () => {
    const run = await makeRun()
    const candidateId = realServiceCandidateId(run)
    const result = await explainFromRunLog(run, { step: 'service', target_id: candidateId, provider: 'off' }, null)
    expect(result.requested_provider).toBe('off')
    expect(result.provider_used).toBe('template')
    expect(result.model).toBe('template')
    expect(result.fell_back).toBe(false)
    expect(result.error).toBeNull()
    expect(result.rationale.length).toBeGreaterThan(0)
    const reloaded = await getRun(run.run_id)
    expect(reloaded?.explanations).toEqual([])
  })

  it("provider='off', persistRunId set: appends a real Explanation with requested_provider='off', prompt_hash matching promptHash(prompt)", async () => {
    const run = await makeRun()
    const candidateId = realServiceCandidateId(run)
    const result = await explainFromRunLog(run, { step: 'service', target_id: candidateId, provider: 'off' }, run.run_id)
    const reloaded = await getRun(run.run_id)
    expect(reloaded?.explanations).toHaveLength(1)
    const persisted = reloaded!.explanations[0]
    expect(persisted.step).toBe('service')
    expect(persisted.target_id).toBe(candidateId)
    expect(persisted.requested_provider).toBe('off')
    expect(persisted.provider_used).toBe('template')
    expect(persisted.model).toBe('template')
    expect(persisted.fell_back).toBe(false)
    expect(persisted.error).toBeNull()
    expect(persisted.rationale).toEqual(result.rationale)
    expect(persisted.prompt_hash).toBe(promptHash(result.prompt))
    expect(typeof persisted.generated_at).toBe('string')
  })
})

// ---------------------------------------------------------------------------
// ExplanationProviderUnsupportedError — RPC round-trip (per the brief's own
// callout: rpc.ts's generic {type, message} fallback silently drops a
// custom field unless a dedicated branch exists, as RunPlanError/MapsError
// already have)
// ---------------------------------------------------------------------------

describe('ExplanationProviderUnsupportedError — RPC round trip', () => {
  it('serializeError puts .provider on the wire (not silently dropped by the generic fallback)', () => {
    const original = new ExplanationProviderUnsupportedError()
    const wire = serializeError(original)
    expect(wire.type).toBe('ExplanationProviderUnsupportedError')
    expect(wire.provider).toBe('backend')
    expect(wire.message).toBe(original.message)
  })

  it('the wire payload survives structuredClone (the real postMessage boundary), .provider intact', () => {
    const wire = serializeError(new ExplanationProviderUnsupportedError())
    const cloned = structuredClone(wire)
    expect(cloned.provider).toBe('backend')
    expect(cloned.type).toBe('ExplanationProviderUnsupportedError')
  })

  it('unwrap rethrows a real ExplanationProviderUnsupportedError with .provider intact', () => {
    const wire = serializeError(new ExplanationProviderUnsupportedError())
    expect(() => unwrap({ ok: false, error: wire })).toThrow(ExplanationProviderUnsupportedError)
    try {
      unwrap({ ok: false, error: wire })
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(ExplanationProviderUnsupportedError)
      expect((err as ExplanationProviderUnsupportedError).provider).toBe('backend')
    }
  })

  it('MUTATION CHECK (documented): the generic instanceof-Error fallback branch, if it fired instead of the dedicated branch, would produce {type, message} with NO .provider field -- verified by hand-calling the fallback shape directly, not by editing rpc.ts', () => {
    // Reproduces exactly what the generic fallback in serializeError would
    // have produced for this same error, to prove the dedicated branch is
    // the thing preventing data loss (not merely present but redundant).
    const e = new ExplanationProviderUnsupportedError()
    const genericFallbackShape = { type: e.name || 'Error', message: e.message }
    expect((genericFallbackShape as any).provider).toBeUndefined()
    // ...whereas the REAL serializeError (dedicated branch) does carry it:
    expect(serializeError(e).provider).toBe('backend')
  })
})

// ---------------------------------------------------------------------------
// promptHash — byte-parity against real Python hashlib.sha256(...).hexdigest()
// ---------------------------------------------------------------------------

describe('promptHash — byte-parity against real Python explanation_builder.prompt_hash', () => {
  for (const [name, c] of Object.entries(PROMPT_HASH_CASES)) {
    it(`${name}: matches the golden hash`, () => {
      const prompt: ExplanationPrompt = { messages: c.messages as any, grounding: {} }
      expect(promptHash(prompt)).toBe(c.hash)
    })
  }

  it('end-to-end: promptHash of a REAL explainFromRunLog response.prompt matches the matching golden prompt_hash_cases entry', async () => {
    const run = await makeRun()
    const candidateId = realServiceCandidateId(run)
    const result = await explainFromRunLog(run, { step: 'service', target_id: candidateId, provider: 'browser' }, null)
    expect(promptHash(result.prompt)).toBe(PROMPT_HASH_CASES.real_service_prompt.hash)
  })

  it('order matters: swapping two messages changes the hash (proves message array order is preserved verbatim, never sorted)', () => {
    const c = PROMPT_HASH_CASES.multiple_messages_ordering_matters
    const forward: ExplanationPrompt = { messages: c.messages as any, grounding: {} }
    const reversed: ExplanationPrompt = { messages: [...c.messages].reverse() as any, grounding: {} }
    expect(promptHash(forward)).toBe(c.hash)
    expect(promptHash(reversed)).not.toBe(c.hash)
  })
})

// ---------------------------------------------------------------------------
// Sanity: the whole IndexedDB-backed persistence store round-trips a
// persisted Explanation with no data loss (belt-and-suspenders on top of
// the golden-free 'off' persistence tests above).
// ---------------------------------------------------------------------------

describe('appendExplanation wiring sanity', () => {
  it('proposalRunsStore actually has an explanation row (not just an in-memory field) after explainFromRunLog(provider="off", persistRunId=run.run_id)', async () => {
    const run = await makeRun()
    const candidateId = realServiceCandidateId(run)
    await explainFromRunLog(run, { step: 'service', target_id: candidateId, provider: 'off' }, run.run_id)
    const rows = await proposalRunsStore.getExplanations(run.run_id)
    expect(rows).toHaveLength(1)
    expect((rows[0] as any).requested_provider).toBe('off')
  })
})
