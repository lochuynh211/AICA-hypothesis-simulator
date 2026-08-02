import { getDb } from './db'
import type { MergedRunHandle } from '../engine/merged/types'

/**
 * Merged-run handle persistence — TS port of
 * `app/api/aica_api/services/merged_run_coordinator.py` (feature 026,
 * htmlapp Combined export, slice C4 Task 3): `make_merged_run_id`,
 * `create_handle`, `save_handle`, `get_handle`.
 *
 * Substrate change for the offline htmlapp: Python persists one JSON file
 * per merged run under `merged_runs_dir` (`_handle_path` +
 * `write_json_atomic`/`read_json`). There is no filesystem here —
 * persistence goes through the `merged_runs` IDB object store (keyPath
 * `merged_run_id`, added at DB_VERSION 4 — see `./db.ts`), the same way
 * trigger/proposal runs already do.
 *
 * Unlike `runs_store.ts`/`proposal_runs_store.ts`, this module has NO
 * append-only child stores (events/evidence/explanations): a
 * `MergedRunHandle` is one whole record, and Python's `save_handle`
 * unconditionally overwrites the file on every call (it is called
 * repeatedly across a run's lifetime — tick advances, accept-rest,
 * proposal-action, ... — see `routers/merged_runs.py`'s six-plus
 * `save_handle(handle, ...)` call sites). The port mirrors that exactly:
 * `saveHandle` is a plain upsert (`put`, never `add`) — introducing an
 * `add()`-based "must not already exist" guard here would be STRICTER
 * than Python (which has zero id-collision protection: `make_merged_run_id`
 * mixes a second-granularity timestamp with only 24 bits of randomness,
 * and a hypothetical collision would just silently overwrite the other
 * handle, exactly like every other `save_handle` call already does by
 * design).
 *
 * ── The IDB double-rejection trap — audited, does not apply here ────────
 * `runsStore.appendEvent`/`proposalRunsStore.appendEvent` etc. hand-roll a
 * `db.transaction([...multiple stores], 'readwrite')` + sequential
 * `await`s across TWO requests (an `add()` into an append-only store, plus
 * a conditional `put()` into a header store) in ONE transaction — if the
 * `add()` rejects (duplicate key), the transaction aborts, which
 * INDEPENDENTLY rejects `tx.done` a second time; without a
 * `tx.done.catch(() => {})` guard that second rejection is never observed
 * and crashes the worker with an unhandled promise rejection.
 *
 * This module has no such multi-request manual transaction: every
 * operation here is a SINGLE request against a SINGLE store
 * (`merged_runs`), so it uses `idb`'s own shorthand methods (`db.get`/
 * `db.put`/`db.getAll`) instead of a hand-rolled transaction. Read
 * `node_modules/idb/build/index.js`'s `getMethod()` (lines ~226-241): the
 * shorthand itself already does
 * `await Promise.all([request, isWrite && tx.done])` — i.e. it AWAITS BOTH
 * promises together, which is the exact "handle both promises (no
 * unhandled rejections)" discipline (that literal phrase is the library's
 * own comment) the manual `try/catch + tx.done.catch(() => {})` pattern
 * implements by hand for the multi-request case.
 *
 * Verified empirically, with a mutation check, not just by reading the
 * source or asserting the happy path — and the two failure modes below are
 * NOT interchangeable, which the mutation check exists to prove:
 *   - A duplicate-key `add()` (what runsStore/proposalRunsStore actually
 *     guard against) is a POST-request failure: IDB creates the request,
 *     the request's `onerror` fires, and — because nothing calls
 *     `event.preventDefault()` — the transaction ABORTS, independently
 *     rejecting `tx.done` a second time. A throwaway `idb`/`fake-indexeddb`
 *     probe confirmed this rejects with ZERO unhandled rejections through
 *     the shorthand, and — when the SAME `add()` duplicate is done inside a
 *     hand-rolled `db.transaction()` with no `tx.done.catch(() => {})`
 *     guard — DOES leak a real unhandled rejection. This is the trap the
 *     sibling stores guard against.
 *   - An unclonable `put()` value (`saveHandle`'s only realistic failure
 *     mode, since it never uses `add()`) is a PRE-request failure:
 *     structured-clone validation throws synchronously before any request
 *     is ever created, so there is no second, independent `tx.done`
 *     rejection to leak — confirmed by mutating `saveHandle` to a
 *     hand-rolled `db.transaction()` + `put()` with NO guard and re-running
 *     `tests/merged_runs_store.test.ts`'s forced-write-failure test: it
 *     STILL passed 0-unhandled, because this specific failure never reaches
 *     the code path the guard exists for.
 *
 * Net effect: `saveHandle`'s forced-write-failure test in
 * `tests/merged_runs_store.test.ts` proves it fails safely (rejects, no
 * stray write, no unhandled rejection) — a real, useful property — but it
 * does NOT mutation-prove immunity to the specific double-rejection
 * mechanism, because `saveHandle`'s design (put-only, no `add()`, no
 * manual transaction) never reaches a POST-request abort in the first
 * place. The companion test asserting an explicit `tx.abort()` mid-write
 * produces no unhandled rejection when both promises are properly awaited
 * demonstrates the underlying mechanism directly, but — by necessity, since
 * `saveHandle` has no manual transaction to reuse — does so against a
 * transaction built inline in the test, not through `saveHandle` itself.
 */

// ---------------------------------------------------------------------------
// Id minting — merged_run_coordinator.py:46-54
// ---------------------------------------------------------------------------

/** Collision-resistant id; mirrors Python's `mrun_<ts>_<hex>` scheme
 * (`mrun_<YYYYMMDD-HHMMSS>_<6hex>`) but NOT its literal format — same
 * deliberate, documented divergence already used by this port's other id
 * minters (`../proposal/run_manager.ts#makeProposalRunId` ->
 * `prun_<base36 timestamp>_<6hex>`, `../worker/handlers/runs.ts#makeRunId`,
 * `../proposal/stores.ts#makeProfileId`). Verified nothing in the Python
 * app functionally depends on the exact `mrun_` format: a repo-wide grep
 * for `startswith("mrun`/`split("mrun`/a `merged_run_id[...]` slice, and
 * for any `strptime` that would parse the embedded timestamp back out,
 * found zero call sites — only ONE Python test
 * (`test_merged_run_coordinator.py::…`) regex-asserts the literal
 * `mrun_\d{8}-\d{6}_[0-9a-f]{6}` shape, and that test is not part of this
 * port's obligations (it never crosses the RPC boundary or reaches a
 * golden fixture). Runs ONCE at creation, outside any loop. */
function randHex(n: number): string {
  let s = ''
  for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 16).toString(16)
  return s
}

export function makeMergedRunId(): string {
  return `mrun_${Date.now().toString(36)}_${randHex(6)}`
}

// ---------------------------------------------------------------------------
// createHandle — merged_run_coordinator.py:71-112
// ---------------------------------------------------------------------------

/** Mirrors `create_handle`'s keyword-only parameters. Python also accepts
 * `merged_dir: pathlib.Path` (required, but UNUSED in the function body —
 * its own docstring says it is "accepted (unused here) to keep this
 * function's signature symmetric with save_handle/get_handle and to leave
 * room for future validation against the registry"). There is no
 * filesystem-path concept on this side (persistence is a fixed IDB store,
 * not a caller-chosen directory), so `mergedDir` is omitted here rather
 * than ported as a dead parameter — a structural simplification, not a
 * behavior change (the Python parameter is never read). */
export type CreateHandleArgs = {
  mergedRunId: string
  triggerRunId: string
  worldTemplate: Record<string, unknown>
  servicePackageId: string
  contentPackageId: string
  proposalMode: string
  runSeed: string
  serviceParameters?: Record<string, unknown> | null
  serviceHyperparameters?: Record<string, unknown> | null
  contentParameters?: Record<string, unknown> | null
  contentHyperparameters?: Record<string, unknown> | null
}

/**
 * Build a `MergedRunHandle` in memory. Does NOT persist — call
 * `saveHandle` to write it to the store.
 *
 * `serviceParameters`/`serviceHyperparameters`/`contentParameters`/
 * `contentHyperparameters` default to `undefined`/`null` here and are
 * normalized to `{}` — mirrors Python's `service_parameters or {}` etc.
 * `or` (not `is None`): for a dict-typed field this is observably
 * IDENTICAL to `??`, because Python's `or` only substitutes the default
 * when the argument is falsy, and an empty dict `{}` is ALSO falsy in
 * Python — so both `None` and `{}` already collapse to the same `{}`
 * result before `??`'s null/undefined-only check would even matter; a
 * non-empty dict is truthy either way and passes through unchanged under
 * both operators. Every other field not listed as a parameter here
 * (`proposal_run_ids`, `current_proposal_run_id`,
 * `current_proposal_category`, `correlation_log`, `rest_stage_synced`,
 * `nap_minutes`) falls back to `MergedRunHandle`'s own Pydantic field
 * default in Python (`[]`/`None`/`[]`/`None`/`None`) — reproduced
 * explicitly below since TS has no implicit per-field defaulting. Fields
 * are assigned in the SAME order as the Python class body (see
 * `../../engine/merged/types.ts`'s hazard-4 note) purely for
 * side-by-side diffability.
 */
export function createHandle(args: CreateHandleArgs): MergedRunHandle {
  return {
    merged_run_id: args.mergedRunId,
    trigger_run_id: args.triggerRunId,
    world_template: args.worldTemplate,
    service_package_id: args.servicePackageId,
    content_package_id: args.contentPackageId,
    proposal_mode: args.proposalMode,
    run_seed: args.runSeed,
    proposal_run_ids: [],
    current_proposal_run_id: null,
    current_proposal_category: null,
    correlation_log: [],
    rest_stage_synced: null,
    nap_minutes: null,
    service_parameters: args.serviceParameters ?? {},
    service_hyperparameters: args.serviceHyperparameters ?? {},
    content_parameters: args.contentParameters ?? {},
    content_hyperparameters: args.contentHyperparameters ?? {},
  }
}

// ---------------------------------------------------------------------------
// Persistence — merged_run_coordinator.py:115-126
// ---------------------------------------------------------------------------

/** Persist `handle` to the `merged_runs` store, keyed by `merged_run_id`.
 * Mirrors `save_handle`'s atomic-overwrite semantics: IDB `put` is an
 * upsert inside a single, inherently-atomic transaction (no partial write
 * is ever observable), the same guarantee `write_json_atomic`'s
 * temp-file-then-`os.replace` gives on the Python side. */
export async function saveHandle(handle: MergedRunHandle): Promise<void> {
  await (await getDb()).put('merged_runs', handle)
}

/** Load the `MergedRunHandle` for `mergedRunId`, or `undefined` when
 * absent (mirrors Python's `get_handle` returning `None` for a missing
 * file — `undefined` is this port's established convention for "absent",
 * matching `runsStore.getHeader`/`proposalRunsStore.getHeader`/
 * `driverProfilesStore.get`, none of which use `null` for this case
 * either). */
export async function getHandle(mergedRunId: string): Promise<MergedRunHandle | undefined> {
  return (await getDb()).get('merged_runs', mergedRunId)
}

// ---------------------------------------------------------------------------
// listHandles — NOT a Python coordinator function
// ---------------------------------------------------------------------------

/**
 * List every persisted merged-run handle. NOT a port of anything in
 * `merged_run_coordinator.py` (whose `__all__` is exactly the four
 * functions above) — Python's `list_merged_runs_endpoint`
 * (`routers/merged_runs.py:757`) instead globs `merged_runs_dir` directly
 * at the ROUTER layer (skip-corrupt-file semantics, summarized fields
 * only), which is a later C4 task's job (Task 5, `run_setup.ts`), not this
 * one's. Added here only for store-shape parity with every sibling store
 * in this codebase (`runsStore.listHeaders`,
 * `proposalRunsStore.listHeaders`, `driverProfilesStore.list`), all of
 * which expose a raw `getAll`-style listing at the storage layer — a
 * later task can call this instead of re-deriving the same `getAll`
 * itself, but it still owns the summarize/skip-corrupt behavior Python's
 * router has (there is no "corrupt row" concept in IDB the way there is
 * for a hand-edited JSON file on disk).
 */
export async function listHandles(): Promise<MergedRunHandle[]> {
  return (await getDb()).getAll('merged_runs')
}

// ---------------------------------------------------------------------------
// listHandleEntries — NOT a Python coordinator function either
// ---------------------------------------------------------------------------

/**
 * Pairs every persisted handle with its own STORAGE KEY (feature 026,
 * htmlapp Combined export, slice C4 Task 5). `listHandles()` above discards
 * the key, keeping only `getAll()`'s values — insufficient for
 * `../engine/merged/run_setup.ts#listMergedRuns` to port
 * `list_merged_runs_endpoint`'s `data.get("merged_run_id", path.stem)`
 * fallback: `path.stem` is Python's on-disk filename (minus `.json`), which
 * for a `<merged_run_id>.json`-per-run store is the substrate's OWN
 * independent source of truth for "what id was this actually filed under" —
 * the IDB equivalent is the store's own KEY, not the record's `merged_run_id`
 * property (which, for THIS store, are the same value in every real case
 * anyway, since the store's `keyPath: 'merged_run_id'` derives the key FROM
 * that field — `put()` throws `DataError` for an object lacking it. The
 * fallback is therefore dead-by-construction here exactly the way several
 * other disclosed branches in this port are, ported and tested directly
 * regardless — see `run_setup.ts`'s own module doc).
 *
 * `idb`'s `getAllKeys()`/`getAll()` both walk the store in the SAME
 * ascending-key order (the store's natural cursor order), so zipping them by
 * index pairs each value with its own key correctly.
 *
 * NOT a port of anything in `merged_run_coordinator.py` (matches
 * `listHandles`'s own precedent, same reasoning: a storage-substrate
 * necessity with no Python equivalent, not a missing Python function).
 */
export async function listHandleEntries(): Promise<Array<{ key: string; value: unknown }>> {
  const db = await getDb()
  const [keys, values] = await Promise.all([db.getAllKeys('merged_runs'), db.getAll('merged_runs')])
  return keys.map((key, i) => ({ key, value: values[i] }))
}
