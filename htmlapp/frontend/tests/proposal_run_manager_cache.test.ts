import { describe, it, expect, beforeEach, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { loadFixture } from '../src/engine/__fixtures__/parity'
import { normalizeForParity } from '../src/engine/__fixtures__/transcript'
import {
  createRun,
  getRun,
  listRuns,
  deleteRun,
  appendEvent,
  appendEvidence,
  appendExplanation,
  updateState,
  ProposalRunNotFoundError,
  type CreateRunArgs,
  type UpdateStateArgs,
  type ProposalRunCache,
} from '../src/engine/proposal/run_manager'
import { proposalRunsStore } from '../src/storage/proposal_runs_store'

/**
 * Task 1 (feature 026 C4) — the `cache` seam.
 *
 * Mirrors `proposal_run_manager.py`'s keyword-only `cache: dict[str,
 * ProposalRunLog] | None = None` parameter, present on exactly FIVE of the
 * module's eight public functions in Python: `create_run`, `get_run`,
 * `append_event`, `append_evidence`, `update_state`. Verified directly
 * against the Python source (services/proposal_run_manager.py — `grep -n
 * "^def "` plus a repo-wide `grep -rn "cache="` over app/api/) and the
 * module's own docstring "Public API" list (lines 22-34), which independently
 * omits `append_explanation` and gives no `cache=` line for `list_runs`/
 * `delete_run`. `list_runs`, `delete_run`, `append_explanation` are plain
 * positional Python functions with NO cache parameter at all — they always
 * operate on `runs_dir`/the store, cache or no cache, and are never called
 * from any cache-building code path (`merged_quickview.py`,
 * `merged_runs.py`). This file therefore does not add a cache option to
 * those three; it tests that they remain untouched (still store-only).
 *
 * The load-bearing assertion throughout is NEGATIVE: with a cache supplied,
 * `proposalRunsStore` must never be written. Proven two ways per Step 2 of
 * the task brief — (a) a `vi.spyOn` on every store write method asserting
 * zero calls, and (b) reading the store back afterward and asserting it is
 * empty. Either alone could be fooled by a refactor; together they cover a
 * port that writes to both cache and store (spy catches it) and a port that
 * writes to the store INSTEAD of the cache while never touching the spied
 * method some other way (post-hoc read catches it).
 */

beforeEach(() => { globalThis.indexedDB = new IDBFactory() })

function toCreateArgs(raw: any): CreateRunArgs {
  return {
    opportunity: raw.opportunity,
    matrixVersion: raw.matrix_version,
    worldSnapshot: raw.world_snapshot,
    servicePackageId: raw.service_package_id,
    contentPackageId: raw.content_package_id,
    parameters: raw.parameters,
    hyperparameters: raw.hyperparameters,
    journeyState: raw.journey_state,
    events: raw.events,
    evidence: raw.evidence,
    status: raw.status,
    setupSnapshot: raw.setup_snapshot,
    world: raw.world,
    mode: raw.mode,
  }
}

function toUpdateArgs(raw: any): UpdateStateArgs {
  return {
    status: raw.status,
    journeyState: raw.journey_state,
    contentParameters: raw.content_parameters,
    contentHyperparameters: raw.content_hyperparameters,
    setupSnapshot: raw.setup_snapshot,
    opportunity: raw.opportunity,
    worldSnapshot: raw.world_snapshot,
    opportunityHistory: raw.opportunity_history,
    setupSnapshotHistory: raw.setup_snapshot_history,
  }
}

async function assertStoreEmpty() {
  expect(await proposalRunsStore.listHeaders()).toEqual([])
}

// ---------------------------------------------------------------------------
// The load-bearing negative assertion — cache mode never touches the store
// ---------------------------------------------------------------------------

describe('cache mode never writes proposalRunsStore (the defect this task exists to prevent)', () => {
  it('createRun(cache) never calls any proposalRunsStore write method, and the store stays empty', async () => {
    const putHeaderSpy = vi.spyOn(proposalRunsStore, 'putHeader')
    const appendEventSpy = vi.spyOn(proposalRunsStore, 'appendEvent')
    const appendEvidenceSpy = vi.spyOn(proposalRunsStore, 'appendEvidence')
    const { input } = loadFixture('proposal_run_manager')

    const cache: ProposalRunCache = new Map()
    const log = await createRun({ ...toCreateArgs(input.create_full), cache })

    expect(putHeaderSpy).not.toHaveBeenCalled()
    expect(appendEventSpy).not.toHaveBeenCalled()
    expect(appendEvidenceSpy).not.toHaveBeenCalled()
    await assertStoreEmpty()
    // and the run really was built — it just lives in the cache, not the store
    expect(cache.get(log.run_id)).toEqual(log)
  })

  it('getRun(cache) never calls proposalRunsStore.getHeader', async () => {
    const getHeaderSpy = vi.spyOn(proposalRunsStore, 'getHeader')
    const { input } = loadFixture('proposal_run_manager')
    const cache: ProposalRunCache = new Map()
    const created = await createRun({ ...toCreateArgs(input.create_minimal), cache })

    getHeaderSpy.mockClear()
    const found = await getRun(created.run_id, { cache })

    expect(getHeaderSpy).not.toHaveBeenCalled()
    expect(found).toEqual(created)
    await assertStoreEmpty()
  })

  it('appendEvent(cache)/appendEvidence(cache)/updateState(cache) never write the store across a full sequence', async () => {
    const putHeaderSpy = vi.spyOn(proposalRunsStore, 'putHeader')
    const appendEventSpy = vi.spyOn(proposalRunsStore, 'appendEvent')
    const appendEvidenceSpy = vi.spyOn(proposalRunsStore, 'appendEvidence')
    const { input } = loadFixture('proposal_run_manager')

    const cache: ProposalRunCache = new Map()
    const created = await createRun({ ...toCreateArgs(input.create_minimal), cache })
    await appendEvent(created.run_id, input.event_1, { cache })
    await appendEvent(created.run_id, input.event_2, { cache })
    await appendEvidence(created.run_id, input.evidence_1, { cache })
    await appendEvidence(created.run_id, input.evidence_2, { cache })
    const updated = await updateState(created.run_id, { ...toUpdateArgs(input.update_full), cache })

    expect(putHeaderSpy).not.toHaveBeenCalled()
    expect(appendEventSpy).not.toHaveBeenCalled()
    expect(appendEvidenceSpy).not.toHaveBeenCalled()
    await assertStoreEmpty()

    // and the cache genuinely accumulated the mutations
    expect(updated.events).toHaveLength(2)
    expect(updated.evidence).toHaveLength(2)
    expect(cache.get(created.run_id)).toEqual(updated)
  })

  it('an empty Map (mirrors Python\'s cache={}) still counts as "supplied" — not the same as omitted', async () => {
    // Python: `if cache is not None` — an empty dict is not None, so cache={}
    // routes to cache mode even though it is falsy-by-size. A JS Map is a
    // truthy object regardless of size, so this is a non-issue in JS, but the
    // case is worth pinning explicitly since it is the literal call pattern
    // `merged_quickview.py` uses (`create_proposal_run(proposal_body, cache={})`).
    const putHeaderSpy = vi.spyOn(proposalRunsStore, 'putHeader')
    const { input } = loadFixture('proposal_run_manager')
    const cache: ProposalRunCache = new Map() // empty, like Python's {}

    await createRun({ ...toCreateArgs(input.create_minimal), cache })

    expect(putHeaderSpy).not.toHaveBeenCalled()
    expect(cache.size).toBe(1)
    await assertStoreEmpty()
  })
})

// ---------------------------------------------------------------------------
// The converse — cache absent leaves behaviour unchanged; the store IS written
// ---------------------------------------------------------------------------

describe('cache absent — behaviour is unchanged, the store IS written (the converse of the negative assertion)', () => {
  it('createRun with no cache persists to proposalRunsStore as before', async () => {
    const { input } = loadFixture('proposal_run_manager')
    const log = await createRun(toCreateArgs(input.create_minimal))

    const header = await proposalRunsStore.getHeader(log.run_id)
    expect(header).toBeTruthy()
    expect(header!.run_id).toBe(log.run_id)
  })

  it('appendEvent/appendEvidence/updateState with no cache option persist to the store as before', async () => {
    const { input } = loadFixture('proposal_run_manager')
    const log = await createRun(toCreateArgs(input.create_minimal))

    await appendEvent(log.run_id, input.event_1)
    await appendEvidence(log.run_id, input.evidence_1)
    const updated = await updateState(log.run_id, toUpdateArgs(input.update_full))

    const events = await proposalRunsStore.getEvents(log.run_id)
    const evidence = await proposalRunsStore.getEvidence(log.run_id)
    expect(events).toHaveLength(1)
    expect(evidence).toHaveLength(1)
    expect(updated.status).toBe(input.update_full.status)

    // re-fetch through the normal (store-backed) getRun to prove it is really durable
    const reopened = await getRun(log.run_id)
    expect(reopened).toEqual(updated)
  })

  it('an explicit options object with cache omitted behaves identically to no options object at all', async () => {
    const { input } = loadFixture('proposal_run_manager')
    const log = await createRun(toCreateArgs(input.create_minimal))

    const a = await appendEvent(log.run_id, input.event_1)
    const b = await getRun(log.run_id, {})

    expect(normalizeForParity(a)).toEqual(normalizeForParity(b))
    await proposalRunsStore.getHeader(log.run_id).then((h) => expect(h).toBeTruthy())
  })
})

// ---------------------------------------------------------------------------
// Cache-mode correctness — same shape/values a store-backed run would produce
// ---------------------------------------------------------------------------

describe('cache-mode correctness — parity with the store-backed path, cache substituted for storage', () => {
  it('createRun(cache) produces the same logical document as createRun() would (run_id/created_at excluded)', async () => {
    const { input } = loadFixture('proposal_run_manager')
    const stored = await createRun(toCreateArgs(input.create_full))
    const cache: ProposalRunCache = new Map()
    const cached = await createRun({ ...toCreateArgs(input.create_full), cache })

    expect(normalizeForParity(cached)).toEqual(normalizeForParity(stored))
  })

  it('appendEvent(cache) then appendEvidence(cache) then updateState(cache) matches the store-backed sequence', async () => {
    const { input } = loadFixture('proposal_run_manager')

    const storedLog = await createRun(toCreateArgs(input.create_minimal))
    const storedAfterEvent = await appendEvent(storedLog.run_id, input.event_1)
    const storedAfterEvidence = await appendEvidence(storedLog.run_id, input.evidence_1)
    const storedAfterUpdate = await updateState(storedLog.run_id, toUpdateArgs(input.update_full))

    const cache: ProposalRunCache = new Map()
    const cachedLog = await createRun({ ...toCreateArgs(input.create_minimal), cache })
    const cachedAfterEvent = await appendEvent(cachedLog.run_id, input.event_1, { cache })
    const cachedAfterEvidence = await appendEvidence(cachedLog.run_id, input.evidence_1, { cache })
    const cachedAfterUpdate = await updateState(cachedLog.run_id, { ...toUpdateArgs(input.update_full), cache })

    expect(normalizeForParity(cachedAfterEvent)).toEqual(normalizeForParity(storedAfterEvent))
    expect(normalizeForParity(cachedAfterEvidence)).toEqual(normalizeForParity(storedAfterEvidence))
    expect(normalizeForParity(cachedAfterUpdate)).toEqual(normalizeForParity(storedAfterUpdate))
  })

  it('createRun(cache) deep-copies parameters/opportunity/worldSnapshot — a later caller mutation does not retroactively change the cached log', async () => {
    const { input } = loadFixture('proposal_run_manager')
    const args = { ...toCreateArgs(input.create_minimal), cache: new Map<string, any>() as ProposalRunCache }
    const originalTopK = (args.parameters as any).top_k

    const log = await createRun(args)
    ;(args.parameters as any).top_k = 999
    ;(args.opportunity as any).opportunity_id = 'MUTATED'

    const reopened = await getRun(log.run_id, { cache: args.cache })
    expect((reopened!.parameters as any).top_k).toBe(originalTopK)
    expect(reopened!.opportunity.opportunity_id).not.toBe('MUTATED')
  })

  it('updateState(cache) deep-copies opportunityHistory — a later caller mutation does not retroactively change the cached log', async () => {
    const { input } = loadFixture('proposal_run_manager')
    const cache: ProposalRunCache = new Map()
    const log = await createRun({ ...toCreateArgs(input.create_minimal), cache })
    const history = [{ ...input.update_full.opportunity_history[0] }]

    await updateState(log.run_id, { opportunityHistory: history, cache })
    history[0].opportunity_id = 'MUTATED-AFTER-CALL'

    const reopened = await getRun(log.run_id, { cache })
    expect(reopened!.opportunity_history[0].opportunity_id).not.toBe('MUTATED-AFTER-CALL')
  })

  it('getRun(cache) returns null for a run_id not present in that cache (mirrors dict.get default)', async () => {
    const cache: ProposalRunCache = new Map()
    expect(await getRun('prun_not_in_cache', { cache })).toBeNull()
  })

  it('appendEvent/appendEvidence/updateState(cache) throw ProposalRunNotFoundError for a run_id not present in that cache', async () => {
    const cache: ProposalRunCache = new Map()
    await expect(appendEvent('prun_missing', { event_type: 'X', at: 0, payload: {} }, { cache }))
      .rejects.toThrow(ProposalRunNotFoundError)
    await expect(appendEvidence('prun_missing', {
      step: 'service', package_id: 'x', contract_version: '1.0.0', schema_version: '1.0.0',
      matrix_version: 'v1', input_snapshot: {}, output: null, error: null,
      used_feature_ids: [], unused_available_features: [], missing_features: [],
    } as any, { cache })).rejects.toThrow(ProposalRunNotFoundError)
    await expect(updateState('prun_missing', { status: 'error', cache })).rejects.toThrow(ProposalRunNotFoundError)
  })

  it('two independent cache Maps are fully isolated from each other and from the store', async () => {
    const { input } = loadFixture('proposal_run_manager')
    const cacheA: ProposalRunCache = new Map()
    const cacheB: ProposalRunCache = new Map()

    const logA = await createRun({ ...toCreateArgs(input.create_minimal), cache: cacheA })

    expect(await getRun(logA.run_id, { cache: cacheB })).toBeNull()
    expect(await getRun(logA.run_id)).toBeNull() // store-backed getRun sees nothing either
    await assertStoreEmpty()
  })
})

// ---------------------------------------------------------------------------
// listRuns / deleteRun / appendExplanation — confirmed NOT to accept a cache
// (Python has no cache parameter on any of these three; see the module-level
// comment above). They must keep operating on the store exactly as before,
// completely blind to any cache-resident run.
// ---------------------------------------------------------------------------

describe('listRuns / deleteRun / appendExplanation — no cache parameter, per Python (asymmetric by design)', () => {
  it('listRuns never sees a run that only exists in a cache', async () => {
    const { input } = loadFixture('proposal_run_manager')
    const cache: ProposalRunCache = new Map()
    await createRun({ ...toCreateArgs(input.create_minimal), cache })

    expect(await listRuns()).toEqual([])
  })

  it('deleteRun returns false for a run_id that only exists in a cache — it cannot delete out of a cache', async () => {
    const { input } = loadFixture('proposal_run_manager')
    const cache: ProposalRunCache = new Map()
    const log = await createRun({ ...toCreateArgs(input.create_minimal), cache })

    expect(await deleteRun(log.run_id)).toBe(false)
    // the cache entry is untouched — deleteRun has no visibility into it at all
    expect(cache.get(log.run_id)).toEqual(log)
  })

  it('appendExplanation has no cache option in its signature — TypeScript rejects a 3rd argument (compile-time; exercised here at runtime via a plain 2-arg call that still requires store persistence)', async () => {
    const { input } = loadFixture('proposal_run_manager')
    const log = await createRun(toCreateArgs(input.create_minimal))

    const updated = await appendExplanation(log.run_id, input.explanation_1)
    const header = await proposalRunsStore.getHeader(log.run_id)
    expect(header).toBeTruthy()
    expect(updated.explanations).toHaveLength(1)
  })
})
