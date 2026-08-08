import { describe, it, expect, beforeEach } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { openDB } from 'idb'
import {
  makeMergedRunId,
  createHandle,
  saveHandle,
  getHandle,
  listHandles,
} from '../src/storage/merged_runs_store'
import { getDb } from '../src/storage/db'
import { runsStore } from '../src/storage/runs_store'
import { proposalRunsStore } from '../src/storage/proposal_runs_store'

/**
 * TS port of `services/merged_run_coordinator.py`'s four functions
 * (feature 026, htmlapp Combined export, slice C4 Task 3) — `make_merged_
 * run_id`, `create_handle`, `save_handle`, `get_handle` — plus the
 * `merged_runs` IDB schema-upgrade path (DB_VERSION 3 -> 4).
 *
 * No capture rig / golden fixture for this file: `merged_run_coordinator.py`
 * has zero runtime hazards (verified — no isinstance/round/sort/f-string/
 * floor-division call sites in either source file), so its behavior is
 * fully pinned by hand-verified assertions against the Python source
 * directly, the same way the sibling `proposal_stores.test.ts`/
 * `storage.test.ts` migration tests are.
 */

beforeEach(() => { globalThis.indexedDB = new IDBFactory() })

function baseArgs() {
  return {
    mergedRunId: 'mrun_test_1',
    triggerRunId: 'run_trigger_1',
    worldTemplate: { situation: { drowsiness_level: 10 }, control_inputs: {} },
    servicePackageId: 'svc_pkg',
    contentPackageId: 'content_pkg',
    proposalMode: 'interactive',
    runSeed: 'seed-1',
  }
}

describe('makeMergedRunId', () => {
  it('matches the mrun_<id>_<6hex> shape (format diverges from Python\'s strftime by design — see module doc comment)', () => {
    const id = makeMergedRunId()
    expect(id).toMatch(/^mrun_[0-9a-z]+_[0-9a-f]{6}$/)
  })

  it('two consecutive calls never collide', () => {
    const ids = new Set(Array.from({ length: 50 }, () => makeMergedRunId()))
    expect(ids.size).toBe(50)
  })
})

describe('createHandle', () => {
  it('builds a MergedRunHandle with every Pydantic field default reproduced explicitly (proposal_run_ids=[], current_proposal_run_id=null, current_proposal_category=null, correlation_log=[], rest_stage_synced=null, nap_minutes=null, content_started_elapsed_sec=null)', () => {
    const handle = createHandle(baseArgs())
    expect(handle).toEqual({
      merged_run_id: 'mrun_test_1',
      trigger_run_id: 'run_trigger_1',
      world_template: { situation: { drowsiness_level: 10 }, control_inputs: {} },
      service_package_id: 'svc_pkg',
      content_package_id: 'content_pkg',
      proposal_mode: 'interactive',
      run_seed: 'seed-1',
      proposal_run_ids: [],
      current_proposal_run_id: null,
      current_proposal_category: null,
      correlation_log: [],
      rest_stage_synced: null,
      nap_minutes: null,
      service_parameters: {},
      service_hyperparameters: {},
      content_parameters: {},
      content_hyperparameters: {},
      // Recovery-semantics refactor (fixbug-0806) — see createHandle's own
      // doc comment.
      content_started_elapsed_sec: null,
    })
  })

  it('does NOT persist (create_handle is pure/in-memory in Python — no store write until saveHandle)', async () => {
    createHandle(baseArgs())
    expect(await listHandles()).toEqual([])
  })

  // Mirrors Python's `service_parameters or {}` (and the content_*/*_hyperparameters
  // equivalents) — a supplied non-empty dict passes through unchanged.
  it('a supplied override dict is used verbatim, not replaced by the {} default', () => {
    const handle = createHandle({
      ...baseArgs(),
      serviceParameters: { tempo_weight: 0.5 },
      serviceHyperparameters: { top_k: 3 },
      contentParameters: { mood: 'calm' },
      contentHyperparameters: { shrinkage: 0.1 },
    })
    expect(handle.service_parameters).toEqual({ tempo_weight: 0.5 })
    expect(handle.service_hyperparameters).toEqual({ top_k: 3 })
    expect(handle.content_parameters).toEqual({ mood: 'calm' })
    expect(handle.content_hyperparameters).toEqual({ shrinkage: 0.1 })
  })

  it('an explicit null override behaves exactly like an omitted one (both -> {})', () => {
    const handle = createHandle({ ...baseArgs(), serviceParameters: null })
    expect(handle.service_parameters).toEqual({})
  })
})

describe('saveHandle / getHandle', () => {
  it('round-trips a handle through the merged_runs store', async () => {
    const handle = createHandle(baseArgs())
    await saveHandle(handle)
    expect(await getHandle('mrun_test_1')).toEqual(handle)
  })

  it('getHandle returns undefined for an unknown id (mirrors Python get_handle returning None when the file is absent)', async () => {
    expect(await getHandle('mrun_does_not_exist')).toBeUndefined()
  })

  it('saveHandle is an upsert, not an append-only add — repeated calls on the SAME id overwrite (mirrors save_handle being called 6+ times across a run\'s lifetime in routers/merged_runs.py)', async () => {
    const handle = createHandle(baseArgs())
    await saveHandle(handle)
    const updated = { ...handle, current_proposal_run_id: 'prun_abc', proposal_run_ids: ['prun_abc'] }
    await saveHandle(updated)
    expect(await getHandle('mrun_test_1')).toEqual(updated)
    expect(await listHandles()).toHaveLength(1)
  })

  it('listHandles returns every persisted handle (store-shape parity helper, not a ported Python function — see module doc comment)', async () => {
    await saveHandle(createHandle(baseArgs()))
    await saveHandle(createHandle({ ...baseArgs(), mergedRunId: 'mrun_test_2' }))
    const all = await listHandles()
    expect(all.map(h => h.merged_run_id).sort()).toEqual(['mrun_test_1', 'mrun_test_2'])
  })
})

// ---------------------------------------------------------------------------
// The IDB double-rejection trap — forced write failure, no unhandled rejection
// ---------------------------------------------------------------------------

describe('saveHandle — forced write failure produces no unhandled rejection', () => {
  // HONEST COVERAGE NOTE (see merged_runs_store.ts's module doc comment for
  // the full mutation-tested writeup): saveHandle uses idb's `db.put()`
  // shorthand (a single request against a single store), never `add()`, so
  // there is no natural duplicate-key scenario here the way there is for
  // runsStore/proposalRunsStore's append-only stores. The test below forces
  // a REAL failure through saveHandle's actual code path (an unclonable
  // value -> DataCloneError) and proves saveHandle fails safely — but a
  // DataCloneError is a PRE-request, synchronous failure, not the
  // POST-request async transaction-abort the double-rejection trap is
  // about. Mutation-verified: rewriting saveHandle to use a hand-rolled
  // `db.transaction()` + `put()` with NO `tx.done.catch(() => {})` guard
  // still passes THIS test 0-unhandled, because this failure mode never
  // reaches the code path the guard exists for. So this test demonstrates
  // saveHandle's real, current safety — it does NOT mutation-prove immunity
  // to the specific trap the sibling stores guard against; nothing in this
  // module reaches that trap's trigger condition (see the second test below
  // for a direct, non-saveHandle proof of the underlying mechanism).
  it('an unclonable handle value rejects saveHandle without leaking an unhandled rejection', async () => {
    const unhandled: unknown[] = []
    const onUnhandledRejection = (reason: unknown) => { unhandled.push(reason) }
    process.on('unhandledRejection', onUnhandledRejection)

    try {
      const handle = createHandle(baseArgs())
      const poisoned = { ...handle, world_template: { fn: () => {} } } as any

      await expect(saveHandle(poisoned)).rejects.toThrow()

      // Nothing was written under this id (the failed write never committed).
      expect(await getHandle(handle.merged_run_id)).toBeUndefined()

      // Flush the microtask/macrotask queue so any late second rejection
      // (the bug class this test guards against) has a chance to surface as
      // an unhandledRejection before we assert none did.
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(unhandled).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandledRejection)
    }
  })

  // A second, independent proof at a lower level: even a hand-rolled manual
  // transaction against `merged_runs` (bypassing this store's public
  // shorthand-based API entirely) that is explicitly aborted mid-write does
  // not leak an unhandled rejection AS LONG AS the caller awaits both the
  // request and tx.done together — demonstrating the underlying mechanism
  // saveHandle relies on, independent of any specific failure cause.
  it('an explicitly aborted manual transaction against merged_runs produces no unhandled rejection when both promises are awaited', async () => {
    const unhandled: unknown[] = []
    const onUnhandledRejection = (reason: unknown) => { unhandled.push(reason) }
    process.on('unhandledRejection', onUnhandledRejection)

    try {
      const db = await getDb()
      const tx = db.transaction('merged_runs', 'readwrite')
      const putPromise = tx.store.put(createHandle(baseArgs()))
      tx.abort()
      await expect(Promise.all([putPromise, tx.done])).rejects.toThrow()

      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(unhandled).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandledRejection)
    }
  })
})

// ---------------------------------------------------------------------------
// IndexedDB migration — DB_VERSION 3 -> 4 (merged_runs added)
// ---------------------------------------------------------------------------

describe('storage/db.ts — v3 -> v4 upgrade adds merged_runs without losing v1/v2/v3 data', () => {
  it('an existing v3 database (runs + proposal_runs populated) upgrades cleanly to v4, gaining merged_runs', async () => {
    // A real returning user on the PREVIOUS shipped schema (v3 — every
    // store through C2 Task 4 already exists and has data): open a bare v3
    // database directly (bypassing db.ts, which only ever opens the
    // CURRENT DB_VERSION) and write v3-shaped records into both an
    // old-generation store (runs/run_events — present since v1) and the
    // newest-at-the-time store (proposal_runs).
    const v3 = await openDB('aica-hypothesis-simulator', 3, {
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
        if (oldVersion < 3) {
          db.createObjectStore('proposal_runs', { keyPath: 'run_id' })
          const pe = db.createObjectStore('proposal_run_events', { keyPath: ['runId', 'seq'] })
          pe.createIndex('runId', 'runId')
          const pv = db.createObjectStore('proposal_run_evidence', { keyPath: ['runId', 'seq'] })
          pv.createIndex('runId', 'runId')
          const px = db.createObjectStore('proposal_run_explanations', { keyPath: ['runId', 'seq'] })
          px.createIndex('runId', 'runId')
        }
      },
    })
    await v3.put('runs', { id: 'preexisting_run_v3', status: 'completed' } as any)
    await v3.put('run_events', { runId: 'preexisting_run_v3', seq: 0, type: 'run_created' } as any)
    await v3.put('proposal_runs', { run_id: 'preexisting_prun_v3', status: 'created' } as any)
    v3.close()

    // db.ts now opens at DB_VERSION 4 — only the oldVersion<4 branch should
    // run (oldVersion<1/oldVersion<2/oldVersion<3 must be skipped, not
    // re-run/reset), and the v3 data must survive untouched.
    const v4 = await getDb()
    expect(await v4.get('runs', 'preexisting_run_v3')).toBeTruthy()
    expect(await v4.get('proposal_runs', 'preexisting_prun_v3')).toBeTruthy()
    expect(v4.objectStoreNames.contains('merged_runs')).toBe(true)

    // The pre-existing data is still readable through the PUBLIC stores
    // (not just a raw v4.get), and the new store is usable end-to-end
    // through this module's own public API.
    expect(await runsStore.getHeader('preexisting_run_v3')).toEqual({ id: 'preexisting_run_v3', status: 'completed' })
    expect(await runsStore.getEvents('preexisting_run_v3')).toEqual([
      { runId: 'preexisting_run_v3', seq: 0, type: 'run_created' },
    ])
    expect(await proposalRunsStore.getHeader('preexisting_prun_v3')).toEqual({ run_id: 'preexisting_prun_v3', status: 'created' })

    const handle = createHandle(baseArgs())
    await saveHandle(handle)
    expect(await getHandle(handle.merged_run_id)).toEqual(handle)
  })
})
