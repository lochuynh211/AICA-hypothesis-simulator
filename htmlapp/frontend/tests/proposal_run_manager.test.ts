import { describe, it, expect, beforeEach } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { openDB } from 'idb'
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
} from '../src/engine/proposal/run_manager'
import { proposalRunsStore } from '../src/storage/proposal_runs_store'
import { getDb } from '../src/storage/db'

/**
 * Parity + TS-logic tests — reproduces `proposal_run_manager.py`'s 8 public
 * functions + `ProposalRunNotFoundError` (C2 Task 4) over a scripted
 * scenario captured from the real Python module (see
 * `scripts/gen/capture_all.py#_capture_proposal_run_manager`).
 *
 * `run_id`/`created_at` are volatile (timestamp+hex / wall-clock — the ONLY
 * randomness/clock in this module) and are stripped from BOTH sides via
 * `normalizeForParity` (../src/engine/__fixtures__/transcript.ts) before
 * comparison, exactly as that module's own VOLATILE-key doc explains.
 *
 * Per-branch coverage table and hazard verdicts are in the task report.
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

// ---------------------------------------------------------------------------
// Parity — the full captured scenario
// ---------------------------------------------------------------------------

describe('run_manager parity (captured from proposal_run_manager.py)', () => {
  it('reproduces create -> append(event/evidence/explanation) -> update_state -> get_run over one run', async () => {
    const { input, output } = loadFixture('proposal_run_manager')

    const logMin = await createRun(toCreateArgs(input.create_minimal))
    expect(normalizeForParity(logMin)).toEqual(normalizeForParity(output.create_minimal))

    const afterEvent1 = await appendEvent(logMin.run_id, input.event_1)
    expect(normalizeForParity(afterEvent1)).toEqual(normalizeForParity(output.after_event_1))

    const afterEvent2 = await appendEvent(logMin.run_id, input.event_2)
    expect(normalizeForParity(afterEvent2)).toEqual(normalizeForParity(output.after_event_2))

    const afterEvidence1 = await appendEvidence(logMin.run_id, input.evidence_1)
    expect(normalizeForParity(afterEvidence1)).toEqual(normalizeForParity(output.after_evidence_1))

    const afterEvidence2 = await appendEvidence(logMin.run_id, input.evidence_2)
    expect(normalizeForParity(afterEvidence2)).toEqual(normalizeForParity(output.after_evidence_2))

    const afterExplanation1 = await appendExplanation(logMin.run_id, input.explanation_1)
    expect(normalizeForParity(afterExplanation1)).toEqual(normalizeForParity(output.after_explanation_1))

    const afterExplanation2 = await appendExplanation(logMin.run_id, input.explanation_2)
    expect(normalizeForParity(afterExplanation2)).toEqual(normalizeForParity(output.after_explanation_2))

    const afterUpdateFull = await updateState(logMin.run_id, toUpdateArgs(input.update_full))
    expect(normalizeForParity(afterUpdateFull)).toEqual(normalizeForParity(output.after_update_full))

    const afterUpdatePartial = await updateState(logMin.run_id, toUpdateArgs(input.update_partial))
    expect(normalizeForParity(afterUpdatePartial)).toEqual(normalizeForParity(output.after_update_partial))

    const found = await getRun(logMin.run_id)
    expect(normalizeForParity(found)).toEqual(normalizeForParity(output.get_found))

    const missing = await getRun('prun_does_not_exist_at_all')
    expect(missing).toEqual(output.get_missing) // both null
  })

  it('reproduces create_run with every optional field populated (world/setup_snapshot/events/evidence/status/mode)', async () => {
    const { input, output } = loadFixture('proposal_run_manager')
    const logFull = await createRun(toCreateArgs(input.create_full))
    expect(normalizeForParity(logFull)).toEqual(normalizeForParity(output.create_full))
  })

  it('reproduces list_runs (single-run store) and delete_run (found, then not-found)', async () => {
    const { input, output } = loadFixture('proposal_run_manager')

    const log = await createRun(toCreateArgs(input.create_minimal))
    const listed = await listRuns()
    expect(listed).toHaveLength(1)
    expect(normalizeForParity(listed)).toEqual(normalizeForParity(output.list_single))

    const deletedTrue = await deleteRun(log.run_id)
    expect(deletedTrue).toBe(output.deleted_true)

    const deletedFalse = await deleteRun(log.run_id)
    expect(deletedFalse).toBe(output.deleted_false)

    const afterDelete = await getRun(log.run_id)
    expect(afterDelete).toEqual(output.get_after_delete) // null
  })

  it('reproduces list_runs on an empty store (output.list_empty)', async () => {
    const { output } = loadFixture('proposal_run_manager')
    expect(await listRuns()).toEqual(output.list_empty)
  })
})

// ---------------------------------------------------------------------------
// TS-logic — ProposalRunNotFoundError on every function that can raise it
// ---------------------------------------------------------------------------

describe('ProposalRunNotFoundError (TS-logic, not parity — Python raises the equivalent on every one of these)', () => {
  const unknown = 'prun_totally-unknown-run-id'

  it('appendEvent throws for an unknown run_id', async () => {
    await expect(appendEvent(unknown, { event_type: 'OPPORTUNITY_OPENED', at: 0, payload: {} }))
      .rejects.toThrow(ProposalRunNotFoundError)
  })

  it('appendEvidence throws for an unknown run_id', async () => {
    await expect(appendEvidence(unknown, {
      step: 'service', package_id: 'x', contract_version: '1.0.0', schema_version: '1.0.0',
      matrix_version: 'v1', input_snapshot: {}, output: null, error: null,
      used_feature_ids: [], unused_available_features: [], missing_features: [],
    })).rejects.toThrow(ProposalRunNotFoundError)
  })

  it('appendExplanation throws for an unknown run_id', async () => {
    await expect(appendExplanation(unknown, {
      step: 'service', target_id: 'x', requested_provider: 'backend', provider_used: 'backend',
      model: 'x', rationale: ['a', 'b'], fell_back: false, prompt_hash: 'x', generated_at: 'x',
    })).rejects.toThrow(ProposalRunNotFoundError)
  })

  it('updateState throws for an unknown run_id', async () => {
    await expect(updateState(unknown, { status: 'error' })).rejects.toThrow(ProposalRunNotFoundError)
  })

  it('getRun (does NOT raise) returns null for an unknown run_id', async () => {
    expect(await getRun(unknown)).toBeNull()
  })

  it('deleteRun (does NOT raise) returns false for an unknown run_id', async () => {
    expect(await deleteRun(unknown)).toBe(false)
  })

  it('the error message mirrors Python\'s f"Unknown proposal run_id: {run_id!r}" shape', async () => {
    let caught: ProposalRunNotFoundError | undefined
    try {
      await updateState(unknown, {})
    } catch (e) {
      caught = e as ProposalRunNotFoundError
    }
    expect(caught).toBeInstanceOf(ProposalRunNotFoundError)
    expect(caught!.message).toBe(`Unknown proposal run_id: '${unknown}'`)
  })
})

// ---------------------------------------------------------------------------
// TS-logic — branch coverage not reachable via the captured scenario
// ---------------------------------------------------------------------------

describe('run_manager — additional branch coverage (TS-logic)', () => {
  it('createRun generates distinct run_ids on two calls, both matching the prun_<...>_<6hex> shape', async () => {
    const { input } = loadFixture('proposal_run_manager')
    const a = await createRun(toCreateArgs(input.create_minimal))
    const b = await createRun(toCreateArgs(input.create_minimal))
    expect(a.run_id).not.toBe(b.run_id)
    expect(a.run_id).toMatch(/^prun_[0-9a-z]+_[0-9a-f]{6}$/)
    expect(b.run_id).toMatch(/^prun_[0-9a-z]+_[0-9a-f]{6}$/)
  })

  it('createRun freezes parameters/hyperparameters/opportunity/worldSnapshot — a later mutation of the caller\'s object never changes the persisted log', async () => {
    const { input } = loadFixture('proposal_run_manager')
    const args = toCreateArgs(input.create_minimal)
    // Save the ORIGINAL values before mutating: toCreateArgs (deliberately, a
    // thin adapter) does not deep-copy, so args.parameters/opportunity/
    // worldSnapshot are the SAME objects as input.create_minimal's — mutating
    // one mutates the fixture too. The freeze guarantee under test lives in
    // createRun itself (it deep-copies before persisting), not in the test's
    // own fixture handling.
    const originalTopK = (args.parameters as any).top_k
    const originalOpportunityId = args.opportunity.opportunity_id
    const originalWorldSnapshot = JSON.parse(JSON.stringify(args.worldSnapshot))

    const log = await createRun(args)

    ;(args.parameters as any).top_k = 999
    ;(args.opportunity as any).opportunity_id = 'MUTATED'
    ;(args.worldSnapshot as any).feature_snapshot = { mutated: true }

    const reopened = await getRun(log.run_id)
    expect((reopened!.parameters as any).top_k).toBe(originalTopK)
    expect(reopened!.opportunity.opportunity_id).toBe(originalOpportunityId)
    expect(reopened!.world_snapshot).toEqual(originalWorldSnapshot)
  })

  it('createRun with world set deep-copies it — mutating the caller\'s world object afterward does not change the persisted log', async () => {
    const { input } = loadFixture('proposal_run_manager')
    const args = toCreateArgs(input.create_full)
    const log = await createRun(args)

    ;(args.world as any).situation.drowsiness_level = 999

    const reopened = await getRun(log.run_id)
    expect((reopened!.world as any).situation.drowsiness_level).not.toBe(999)
  })

  it('updateState deep-copies opportunityHistory — mutating the caller\'s array afterward does not change the persisted log', async () => {
    const { input } = loadFixture('proposal_run_manager')
    const log = await createRun(toCreateArgs(input.create_minimal))
    const history = [{ ...input.update_full.opportunity_history[0] }]

    await updateState(log.run_id, { opportunityHistory: history })
    history[0].opportunity_id = 'MUTATED-AFTER-CALL'

    const reopened = await getRun(log.run_id)
    expect(reopened!.opportunity_history[0].opportunity_id).not.toBe('MUTATED-AFTER-CALL')
  })

  it('updateState with no fields set (all omitted) is a no-op on every field', async () => {
    const { input } = loadFixture('proposal_run_manager')
    const log = await createRun(toCreateArgs(input.create_full))

    const updated = await updateState(log.run_id, {})

    expect(normalizeForParity(updated)).toEqual(normalizeForParity(log))
  })

  it('listRuns sorts by run_id ascending (hazard #2: Python sorted(runs_dir.glob("*.json")) is a run_id string sort)', async () => {
    // Fabricated headers via a direct store write (bypassing real id
    // generation) so ordering is asserted independent of clock/hex — proves
    // the SORT COMPARATOR, not just "creation order happens to already be
    // sorted".
    const fabricated = (runId: string) => ({
      run_id: runId,
      status: 'created',
      created_at: '2026-01-01T00:00:00Z',
      opportunity: { opportunity_id: 'op-x' },
      service_package_id: 'pkg',
      content_package_id: null,
      mode: 'interactive',
    })
    await proposalRunsStore.putHeader(fabricated('prun_20260101-000000_zzzzzz') as any)
    await proposalRunsStore.putHeader(fabricated('prun_20260101-000000_000001') as any)
    await proposalRunsStore.putHeader(fabricated('prun_20260101-000000_aaaaaa') as any)

    const ids = (await listRuns()).map((r) => r.run_id)
    expect(ids).toEqual([
      'prun_20260101-000000_000001',
      'prun_20260101-000000_aaaaaa',
      'prun_20260101-000000_zzzzzz',
    ])
  })
})

// ---------------------------------------------------------------------------
// Append-only invariant (TS-logic — this project's own storage discipline,
// not something Python's file-per-run persistence needs to prove the same
// way). "An append-only store with no test asserting append-only is not
// append-only; it is a comment."
// ---------------------------------------------------------------------------

describe('proposalRunsStore — append-only invariant', () => {
  it('exposes no put/delete for events, evidence, or explanations — appendX and deleteRun are the only write paths that can add/remove them', () => {
    expect(Object.keys(proposalRunsStore).sort()).toEqual([
      'appendEvent', 'appendEvidence', 'appendExplanation',
      'deleteRun', 'getEvents', 'getEvidence', 'getExplanations',
      'getHeader', 'listHeaders', 'putHeader',
    ])
  })

  it('appending an event at a seq that already exists for the run throws (IDB `add` rejects the duplicate key — no silent overwrite)', async () => {
    await proposalRunsStore.appendEvent('run-x', 0, { event_type: 'OPPORTUNITY_OPENED', at: 0, payload: {} })
    await expect(
      proposalRunsStore.appendEvent('run-x', 0, { event_type: 'SERVICE_SELECTED', at: 1, payload: {} }),
    ).rejects.toThrow()

    const events = await proposalRunsStore.getEvents('run-x')
    expect(events).toHaveLength(1)
    expect(events[0].event_type).toBe('OPPORTUNITY_OPENED') // the original survives untouched
  })

  it('the same duplicate-seq rejection applies to appendEvidence and appendExplanation', async () => {
    await proposalRunsStore.appendEvidence('run-y', 0, { step: 'service' })
    await expect(proposalRunsStore.appendEvidence('run-y', 0, { step: 'content' })).rejects.toThrow()

    await proposalRunsStore.appendExplanation('run-z', 0, { target_id: 'a' })
    await expect(proposalRunsStore.appendExplanation('run-z', 0, { target_id: 'b' })).rejects.toThrow()
  })

  it('prior events/evidence/explanations are never mutated by later appends on the same run', async () => {
    const { input } = loadFixture('proposal_run_manager')
    const log = await createRun(toCreateArgs(input.create_minimal))

    const e1 = await appendEvent(log.run_id, input.event_1)
    const firstEventSnapshot = { ...e1.events[0] }

    const e2 = await appendEvent(log.run_id, input.event_2)
    expect(e2.events[0]).toEqual(firstEventSnapshot)
    expect(e2.events).toHaveLength(2)
  })

  it('deleteRun is the only path that removes appended rows (events/evidence/explanations all gone after delete)', async () => {
    const { input } = loadFixture('proposal_run_manager')
    const log = await createRun(toCreateArgs(input.create_minimal))
    await appendEvent(log.run_id, input.event_1)
    await appendEvidence(log.run_id, input.evidence_1)
    await appendExplanation(log.run_id, input.explanation_1)

    await deleteRun(log.run_id)

    expect(await proposalRunsStore.getEvents(log.run_id)).toEqual([])
    expect(await proposalRunsStore.getEvidence(log.run_id)).toEqual([])
    expect(await proposalRunsStore.getExplanations(log.run_id)).toEqual([])
    expect(await proposalRunsStore.getHeader(log.run_id)).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// IndexedDB migration — DB_VERSION 1 -> 3 and 2 -> 3 (proposal_runs* stores)
// ---------------------------------------------------------------------------

describe('storage/db.ts — v1 -> v3 upgrade adds proposal_runs* without losing v1 data', () => {
  it('an existing v1 database (packages seeded) upgrades cleanly through v2 and v3, gaining driver_profiles + proposal_runs*', async () => {
    // A real returning user on the OLDEST shipped schema: open a bare v1
    // database directly (bypassing db.ts, which only ever opens the CURRENT
    // DB_VERSION) and write a v1-shaped record.
    const v1 = await openDB('aica-hypothesis-simulator', 1, {
      upgrade(db) {
        db.createObjectStore('packages', { keyPath: 'id' })
        db.createObjectStore('scenarios', { keyPath: 'id' })
        db.createObjectStore('runs', { keyPath: 'id' })
        const ev = db.createObjectStore('run_events', { keyPath: ['runId', 'seq'] })
        ev.createIndex('runId', 'runId')
        const fb = db.createObjectStore('feedback', { keyPath: ['runId', 'seq'] })
        fb.createIndex('runId', 'runId')
        db.createObjectStore('settings')
      },
    })
    await v1.put('packages', { id: 'preexisting_pkg_v1', manifest: { id: 'preexisting_pkg_v1' }, origin: 'user' } as any)
    v1.close()

    // db.ts now opens at DB_VERSION 3 — both upgrade paths (oldVersion<2,
    // oldVersion<3) must run in sequence and must not touch (let alone drop)
    // the v1 data already on disk.
    const v3 = await getDb()
    const preexisting = await v3.get('packages', 'preexisting_pkg_v1')
    expect(preexisting).toBeTruthy()
    expect(v3.objectStoreNames.contains('driver_profiles')).toBe(true)
    expect(v3.objectStoreNames.contains('proposal_runs')).toBe(true)
    expect(v3.objectStoreNames.contains('proposal_run_events')).toBe(true)
    expect(v3.objectStoreNames.contains('proposal_run_evidence')).toBe(true)
    expect(v3.objectStoreNames.contains('proposal_run_explanations')).toBe(true)

    // The new stores are usable end-to-end through the public run_manager API.
    const { input } = loadFixture('proposal_run_manager')
    const log = await createRun(toCreateArgs(input.create_minimal))
    const withEvent = await appendEvent(log.run_id, input.event_1)
    expect(withEvent.events).toHaveLength(1)
    expect(await getRun(log.run_id)).toEqual(withEvent)
  })
})

describe('storage/db.ts — v2 -> v3 upgrade adds proposal_runs* without losing v2 data (driver_profiles)', () => {
  it('an existing v2 database (driver_profiles populated) upgrades to v3 cleanly, gaining proposal_runs*', async () => {
    // A returning user on the PREVIOUS shipped schema (v2 — task 1's
    // driver_profiles store already exists and has data): open a bare v2
    // database directly and write a v2-shaped record into driver_profiles.
    const v2 = await openDB('aica-hypothesis-simulator', 2, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          db.createObjectStore('packages', { keyPath: 'id' })
          db.createObjectStore('scenarios', { keyPath: 'id' })
          db.createObjectStore('runs', { keyPath: 'id' })
          const ev = db.createObjectStore('run_events', { keyPath: ['runId', 'seq'] })
          ev.createIndex('runId', 'runId')
          const fb = db.createObjectStore('feedback', { keyPath: ['runId', 'seq'] })
          fb.createIndex('runId', 'runId')
          db.createObjectStore('settings')
        }
        if (oldVersion < 2) {
          db.createObjectStore('driver_profiles', { keyPath: 'profile_id' })
        }
      },
    })
    await v2.put('driver_profiles', {
      profile_id: 'preexisting_profile_v2',
      label: { ja: 'x', en: 'x' },
      builtin: false,
      profile: { oshi_registered: false, oshi_mode: 'off', age_band: '20s', gender: 'unspecified' },
    } as any)
    v2.close()

    // db.ts now opens at DB_VERSION 3 — only the oldVersion<3 branch should
    // run (oldVersion<1/oldVersion<2 must be skipped, not re-run/reset).
    const v3 = await getDb()
    const preexisting = await v3.get('driver_profiles', 'preexisting_profile_v2')
    expect(preexisting).toBeTruthy()
    expect(v3.objectStoreNames.contains('proposal_runs')).toBe(true)
    expect(v3.objectStoreNames.contains('proposal_run_events')).toBe(true)
    expect(v3.objectStoreNames.contains('proposal_run_evidence')).toBe(true)
    expect(v3.objectStoreNames.contains('proposal_run_explanations')).toBe(true)

    // The new stores are usable end-to-end.
    const { input } = loadFixture('proposal_run_manager')
    const log = await createRun(toCreateArgs(input.create_minimal))
    expect(await getRun(log.run_id)).toEqual(log)
  })
})
