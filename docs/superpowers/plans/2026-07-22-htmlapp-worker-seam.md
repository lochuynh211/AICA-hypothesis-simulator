# HTMLApp Worker-Seam Refactor — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the htmlapp seam into a typed RPC contract dispatched over a swappable transport (Web Worker with in-process `file://` fallback), stand up a contract-parity verification harness, change the build to multi-file (single-file retained), guard the sync script, and fix the trigger ID-collision bug — all without touching `app/frontend` or `app/api`.

**Architecture:** The 23 functions in `htmlapp/frontend/src/api/client.ts` (currently a 1,647-line monolith calling the TS engine directly) are refactored into thin dispatchers over a `Transport` interface. Their bodies move into `engine/worker/handlers/*` behind a `router` (op → handler) that mirrors the FastAPI routers. A shared `dispatch()` runs the router either in a Web Worker (`WorkerTransport`) or on the main thread (`InProcessTransport`, the `file://` fallback). Because both transports run the *same* router, behavior is identical; the worker is purely a threading choice. A committed capture harness records golden op-transcripts from the Python backend (via FastAPI `TestClient`, no docker) and replays them against the router to catch silent logic drift.

**Tech Stack:** TypeScript 5, Vite 5 (+ `vite-plugin-singlefile` for the optional single-file target), React 18, Vitest 1.6 (jsdom + `fake-indexeddb`), Playwright 1.48 (`@playwright/test`, already installed), `idb` 8 for IndexedDB, Python 3.12 + FastAPI `TestClient` for fixture capture (run under Anaconda with `PYTHONPATH=app/api`).

## Global Constraints

Every task's requirements implicitly include this section.

- **Purely additive:** never modify any file under `app/frontend/` or `app/api/`. All changes live under `htmlapp/`.
- **23 exported `api/client.ts` signatures stay byte-identical** — the synced UI layer imports them and must be untouched. The 23: `getHealth, listPackages, getPackage, addUserPackage, listScenarios, getScenario, listRoutePresets, loadRoutePreset, routesAnalyze, createRunPlan, regenerateRunPlan, runPreview, createRun, tickRun, actRun, getRestSpots, listRuns, getRun, getRunLog, getFeedbackSchema, getEvidence, getEvidenceMarkdown, submitFeedback`. `client.ts` must also keep re-exporting/throwing `MapsError` and `FeedbackValidationError` from `./types` where it does today.
- **Structured-cloneable payloads only:** every RPC `params` and `result` must be plain JSON-shaped data (no functions, class instances, Maps, DOM nodes) so it survives `postMessage`. `MapsError`/`FeedbackValidationError` cross the boundary as serialized `RpcError`, reconstructed client-side.
- **Determinism:** no `Math.random()` without a seeded PRNG and no `Date.now()` inside the tick loop. The new ID scheme (Task S8) uses time+random **only** in id generation, which runs once at creation, outside the tick loop.
- **Append-only evidence:** the only write path to the `run_events` store is `runsStore.appendEvent`; never `put`/`delete` outside `deleteRun`.
- **Engine is source of truth:** UI components/`runStore` import only from `../api/client`. Nothing under `components/`, `state/`, `replay/` imports `engine/`, `storage/`, or the new `worker/` directly.
- **Maps key never persisted/logged/exported:** the reviewer's runtime key stays in main-thread `runStore` state and is passed as an op param; it is never stored in the worker or IndexedDB and never appears in a committed transcript (capture uses the local-route path only).
- **No live stack at test time:** Vitest and CI never require docker/uvicorn/`uv`. Golden fixtures are committed; capture scripts run offline via Python `TestClient`.
- **Imports are relative** (no path aliases). Test files under `tests/` import `../src/...`. `npm test` = `vitest run`, run from `htmlapp/frontend/`.
- **Test isolation:** every Vitest suite touching IndexedDB or engine state must, in `beforeEach`, set `globalThis.indexedDB = new IDBFactory()` and call `clearRegistry()` (run_manager) + `clearDraftRegistry()` (run_plan). Client-surface suites also `await seedDefaults()`.

---

## Reference: current-code facts this plan relies on

- `client.ts` layout (line anchors): `ready()`=126, `getHealth`=132, helpers `makePlanId`=416 (`_planIdCounter`=415), `derivePreviewHistory`=863, `runPreview`=957, `makeRunId`=1306 (`_runIdCounter`=1305), `createRun`=1320, `tickRun`=1335 (TickOutcome→TickResponse shaping), `actRun`=1389, `getRestSpots`=1435. Engine imports at lines 67–111 (aliased `createRun as engineCreateRun`, `tick as engineTick`, `action as engineAction` from `../engine/run_manager`).
- Engine entry points (real names, `engine/run_manager.ts`): `createRun(planId, runId): Promise<RunStateM2>`, `tick(runId): Promise<TickOutcome>`, `action(runId, actionStr, opts): Promise<RunStateM2>`, plus `getRun`, `getActiveRunLog`, `resolveRunLog`, `clearRegistry`. `deriveHistory(events, tickSeconds, currentSimSec)` is **private** in run_manager.ts (lines ~387–463). `run_plan.ts`: `createDraft`, `regenerateDraft`, `getDraftEntry`, `clearDraftRegistry`.
- `TickOutcome` (run_manager.ts): `{ runState, decision, algorithmError, paused, completed, evaluatedTickIndex, tickState }`. `TickResponse` (api/types.ts) is the discriminated union `TickResponseSuccess | TickResponseError`, discriminated by presence of the `error` key (no `kind` field). `getHealth` returns `{ status: 'ok', service: 'aica-htmlapp', version: pkg.version }` synchronously.
- Errors: `run_manager` throws `RunNotFoundError`/`ActionNotAllowedError` (Error subclasses); `routesAnalyze` throws `MapsError` (carries `.body: {error_type,message,suggestion}`); `submitFeedback` throws `FeedbackValidationError` (carries `.validationErrors`). Algorithm errors are **not** thrown — `tickRun` returns the `TickResponseError` shape (`error` key present).
- Test infra: `parity.ts` exports `loadFixture(name): {input, output}` and `expectParity(actual, expected, path?)` (numbers within `1e-9`, exact elsewhere, sorted-key match). Fixtures live at `src/engine/__fixtures__/parity/*.json` (18 files incl. `tick_sequence.json`, `run_log_e2e.json`, `preview.json`). `tests/setup.ts` = `import '@testing-library/jest-dom'; import 'fake-indexeddb/auto'`.
- Build: `vite.config.ts` uses `viteSingleFile()` + `rollupOptions.output.inlineDynamicImports:true` + `cssCodeSplit:false`; `build` script = `vite build && node scripts/check-size.mjs`; dev port 5181. `sync-from-app.mjs`: `DIRS=['components','state','i18n','styles','replay']`, `FILES=['App.tsx','main.tsx','vite-env.d.ts','api/types.ts']`, `PROTECTED=['api/client.ts','engine','data','storage','config.ts']`.

---

## Task S1: RPC envelope + dispatch + router, monolith relocated into handlers (in-process)

Introduce the contract and move every client body into a handler behind a router, with `client.ts` calling `dispatch()` directly on the main thread. No worker yet. Behavior and the 23 signatures are unchanged; the existing test suite is the regression guard.

**Files:**
- Create: `htmlapp/frontend/src/api/rpc.ts`
- Create: `htmlapp/frontend/src/engine/worker/dispatch.ts`
- Create: `htmlapp/frontend/src/engine/worker/router.ts`
- Create: `htmlapp/frontend/src/engine/worker/handlers/health.ts`, `packages.ts`, `scenarios.ts`, `routes.ts`, `run_plans.ts`, `runs.ts`, `evidence.ts`, `feedback.ts`
- Modify: `htmlapp/frontend/src/api/client.ts` (rewrite bodies to dispatch calls; keep signatures)
- Test: `htmlapp/frontend/tests/rpc.test.ts` (new), and the whole existing suite as regression.

**Interfaces:**
- Produces (consumed by S2–S8):
  - `rpc.ts`: `type RpcOp` (23-member string union, below); `type RpcRequest = { op: RpcOp; params?: unknown }`; `type RpcResponse<T=unknown> = { ok: true; result: T } | { ok: false; error: RpcError }`; `type RpcError = { type: string; message: string; body?: unknown; validationErrors?: {field:string;message:string}[] }`; `serializeError(e: unknown): RpcError`; `function unwrap<T>(r: RpcResponse<T>): T` (rethrows reconstructed error).
  - `dispatch.ts`: `async function dispatch(req: RpcRequest): Promise<RpcResponse>`; `function resetDispatchState(): void` (test-only: resets the seed latch).
  - `router.ts`: `const router: Record<RpcOp, (params: any) => Promise<unknown>>`.
  - Handlers export one async function per op (names below).

- [ ] **Step 1: Write the failing test for the RPC envelope + error round-trip**

Create `htmlapp/frontend/tests/rpc.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { unwrap, serializeError } from '../src/api/rpc'
import { MapsError, FeedbackValidationError } from '../src/api/types'

describe('rpc envelope', () => {
  it('unwrap returns result on ok', () => {
    expect(unwrap({ ok: true, result: 42 })).toBe(42)
  })

  it('unwrap rethrows a plain Error preserving name+message', () => {
    expect(() => unwrap({ ok: false, error: { type: 'RunNotFoundError', message: 'no run x' } }))
      .toThrowError('no run x')
  })

  it('serialize→unwrap round-trips a MapsError with its body', () => {
    const original = new MapsError({ error_type: 'quota', message: 'over limit', suggestion: 'retry' })
    const wire = serializeError(original)
    expect(wire.type).toBe('MapsError')
    let caught: unknown
    try { unwrap({ ok: false, error: wire }) } catch (e) { caught = e }
    expect(caught).toBeInstanceOf(MapsError)
    expect((caught as MapsError).body.suggestion).toBe('retry')
  })

  it('serialize→unwrap round-trips a FeedbackValidationError with its list', () => {
    const original = new FeedbackValidationError({ validation_errors: [{ field: 'x', message: 'bad' }] })
    let caught: unknown
    try { unwrap({ ok: false, error: serializeError(original) }) } catch (e) { caught = e }
    expect(caught).toBeInstanceOf(FeedbackValidationError)
    expect((caught as FeedbackValidationError).validationErrors[0].field).toBe('x')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd htmlapp/frontend && npx vitest run tests/rpc.test.ts`
Expected: FAIL — cannot resolve `../src/api/rpc`.

- [ ] **Step 3: Create `src/api/rpc.ts`**

```ts
import { MapsError, FeedbackValidationError } from './types'

export type RpcOp =
  | 'health.get'
  | 'packages.list' | 'packages.get' | 'packages.addUser'
  | 'scenarios.list' | 'scenarios.get'
  | 'routes.analyze' | 'routes.presets.list' | 'routes.presets.load'
  | 'runPlans.create' | 'runPlans.regenerate'
  | 'runs.create' | 'runs.tick' | 'runs.act' | 'runs.restSpots'
  | 'runs.log' | 'runs.list' | 'runs.state' | 'runs.preview'
  | 'evidence.get' | 'evidence.md'
  | 'feedback.submit' | 'feedback.schema'

export type RpcRequest = { op: RpcOp; params?: unknown }

export type RpcError = {
  type: string
  message: string
  body?: unknown
  validationErrors?: { field: string; message: string }[]
}

export type RpcResponse<T = unknown> = { ok: true; result: T } | { ok: false; error: RpcError }

/** Convert a thrown error into a structured-cloneable RpcError. */
export function serializeError(e: unknown): RpcError {
  if (e instanceof MapsError) {
    return { type: 'MapsError', message: e.message, body: e.body }
  }
  if (e instanceof FeedbackValidationError) {
    return { type: 'FeedbackValidationError', message: e.message, validationErrors: e.validationErrors }
  }
  if (e instanceof Error) {
    return { type: e.name || 'Error', message: e.message }
  }
  return { type: 'Error', message: String(e) }
}

/** Rebuild and throw the original error class on the client side, else return the result. */
export function unwrap<T>(r: RpcResponse<T>): T {
  if (r.ok) return r.result
  const { error } = r
  if (error.type === 'MapsError') {
    throw new MapsError(error.body as { error_type: string; message: string; suggestion: string })
  }
  if (error.type === 'FeedbackValidationError') {
    throw new FeedbackValidationError({ validation_errors: error.validationErrors ?? [] })
  }
  const rebuilt = new Error(error.message)
  rebuilt.name = error.type
  throw rebuilt
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd htmlapp/frontend && npx vitest run tests/rpc.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Relocate client bodies into handlers**

For each op, create a handler whose body is the **current `client.ts` function body** (verbatim, minus the per-function `await ready()` — seeding centralizes in `dispatch`). Move the private helpers each handler needs into (or beside) its handler file. Concretely:

- `handlers/health.ts` → `export async function healthGet() { return { status: 'ok', service: 'aica-htmlapp', version: pkg.version } }` (import `pkg` as client.ts does).
- `handlers/packages.ts` → `packagesList`, `packagesGet(params:{id})`, `packagesAddUser(params:{source})` (move `isWellFormedUserManifest`, `isEvaluateOutputShape`, and the upload smoke logic from client.ts:210–303).
- `handlers/scenarios.ts` → `scenariosList`, `scenariosGet(params:{id})`.
- `handlers/routes.ts` → `routesAnalyze(params)`, `routesPresetsList`, `routesPresetsLoad(params:{presetId})` (move `resolvePersistedMapsKey`, `deriveMapsContext`, `scaleScenarioRestPositions` from client.ts:487–508).
- `handlers/run_plans.ts` → `runPlansCreate(params)`, `runPlansRegenerate(params:{planId, patch})` (move `pyReprValue`, `validateInitialStateBody`, `validateContextOverridesBody`, and `makePlanId`/`_planIdCounter` from client.ts:404–486). *ID generation now lives server-side here.*
- `handlers/runs.ts` → `runsCreate(params:{planId})`, `runsTick(params:{runId})` (the TickOutcome→TickResponse shaping, client.ts:1335–1387), `runsAct(params:{runId,action,opts})`, `runsRestSpots(params)`, `runsList`, `runsState(params:{runId})` (= current `getRun`), `runsPreview(params:{config,restOptionId})` (move `pyPreviewRepr`, `validatePreviewContextOverrides`, `pickPreviewRestSpot`, `derivePreviewHistory`, `round1`, `buildRestSpotCandidates`, `REST_SPOTS_MAX`, `REST_SPOTS_DEFAULT_MIN_DISTANCE_KM`, and `makeRunId`/`_runIdCounter`). *ID generation now server-side here.*
- `handlers/evidence.ts` → `evidenceGet(params:{runId,uiLanguage})`, `evidenceMd(params:{runId,uiLanguage})`.
- `handlers/feedback.ts` → `feedbackSchema(params:{runId})`, `feedbackSubmit(params:{runId,body})` (move `resolveFeedbackPackage`).

Each handler keeps the engine/storage imports it needs (copy the relevant import lines from client.ts:67–111). Example — `handlers/runs.ts` for the three run-lifecycle ops (bodies are the current client.ts bodies with the seam wrapper removed):

```ts
import { createRun as engineCreateRun, tick as engineTick, action as engineAction } from '../../run_manager'
import type { RunState, TickResponse, RestSpot } from '../../../api/types'
// ...other imports as in client.ts (getRun, resolveRunLog, runsStore, etc.)

export async function runsCreate(params: { planId: string }): Promise<RunState> {
  const runId = makeRunId()                 // makeRunId moved into this module (see S8 for the new scheme)
  return engineCreateRun(params.planId, runId)
}

export async function runsTick(params: { runId: string }): Promise<TickResponse> {
  const outcome = await engineTick(params.runId)
  // ... the exact TickOutcome→TickResponse shaping block from client.ts:1338–1386, verbatim ...
}

export async function runsAct(
  params: { runId: string; action: string; opts?: { recovery_option_id?: string; rest_spot?: RestSpot } },
): Promise<RunState> {
  const opts = params.opts ?? {}
  return engineAction(params.runId, params.action, {
    recoveryOptionId: opts.recovery_option_id ?? null,
    restSpot: opts.rest_spot ?? null,
  })
}
```

- [ ] **Step 6: Create `src/engine/worker/router.ts`**

```ts
import type { RpcOp } from '../../api/rpc'
import { healthGet } from './handlers/health'
import { packagesList, packagesGet, packagesAddUser } from './handlers/packages'
import { scenariosList, scenariosGet } from './handlers/scenarios'
import { routesAnalyze, routesPresetsList, routesPresetsLoad } from './handlers/routes'
import { runPlansCreate, runPlansRegenerate } from './handlers/run_plans'
import {
  runsCreate, runsTick, runsAct, runsRestSpots, runsList, runsState, runsPreview,
} from './handlers/runs'
import { evidenceGet, evidenceMd } from './handlers/evidence'
import { feedbackSchema, feedbackSubmit } from './handlers/feedback'

export const router: Record<RpcOp, (params: any) => Promise<unknown>> = {
  'health.get': healthGet,
  'packages.list': packagesList,
  'packages.get': packagesGet,
  'packages.addUser': packagesAddUser,
  'scenarios.list': scenariosList,
  'scenarios.get': scenariosGet,
  'routes.analyze': routesAnalyze,
  'routes.presets.list': routesPresetsList,
  'routes.presets.load': routesPresetsLoad,
  'runPlans.create': runPlansCreate,
  'runPlans.regenerate': runPlansRegenerate,
  'runs.create': runsCreate,
  'runs.tick': runsTick,
  'runs.act': runsAct,
  'runs.restSpots': runsRestSpots,
  'runs.log': runsLog,          // = current getRunLog handler in runs.ts
  'runs.list': runsList,
  'runs.state': runsState,
  'runs.preview': runsPreview,
  'evidence.get': evidenceGet,
  'evidence.md': evidenceMd,
  'feedback.submit': feedbackSubmit,
  'feedback.schema': feedbackSchema,
}
```

(Include `runsLog` in `handlers/runs.ts` as the port of current `getRunLog`.)

- [ ] **Step 7: Create `src/engine/worker/dispatch.ts`**

```ts
import type { RpcRequest, RpcResponse } from '../../api/rpc'
import { serializeError } from '../../api/rpc'
import { seedDefaults } from '../../storage/db'
import { router } from './router'

let _seeded: Promise<void> | null = null
function ready(): Promise<void> {
  return (_seeded ??= seedDefaults())
}

/** Test-only: drop the seed latch so a fresh IDBFactory re-seeds. */
export function resetDispatchState(): void {
  _seeded = null
}

export async function dispatch(req: RpcRequest): Promise<RpcResponse> {
  try {
    await ready()
    const handler = router[req.op]
    if (!handler) return { ok: false, error: { type: 'UnknownOp', message: `unknown op: ${req.op}` } }
    const result = await handler(req.params)
    return { ok: true, result }
  } catch (e) {
    return { ok: false, error: serializeError(e) }
  }
}
```

- [ ] **Step 8: Rewrite `src/api/client.ts` bodies as in-process dispatch calls (signatures unchanged)**

Replace each function body with a `dispatch` + `unwrap` call; delete the relocated helpers and the `ready()` latch (now in dispatch). Keep the type imports and `import { MapsError, FeedbackValidationError } from './types'`. Pattern:

```ts
import { dispatch } from '../engine/worker/dispatch'
import { unwrap, type RpcRequest } from './rpc'
// ...type-only imports unchanged...

async function call<T>(op: RpcRequest['op'], params?: unknown): Promise<T> {
  return unwrap<T>(await dispatch({ op, params }) as import('./rpc').RpcResponse<T>)
}

export async function getHealth(): Promise<HealthStatus> { return call('health.get') }
export async function listPackages() { return call('packages.list') }
export async function getPackage(id: string): Promise<PackageManifest> { return call('packages.get', { id }) }
export async function addUserPackage(source: string): Promise<PackageSummary> { return call('packages.addUser', { source }) }
export async function listScenarios() { return call('scenarios.list') }
export async function getScenario(id: string): Promise<ScenarioDef> { return call('scenarios.get', { id }) }
export async function listRoutePresets() { return call('routes.presets.list') }
export async function loadRoutePreset(presetId: string): Promise<RouteEnvelope> { return call('routes.presets.load', { presetId }) }
export async function routesAnalyze(args: { scenarioId?: string; mapsKey?: string; start?: string; end?: string }): Promise<RouteEnvelope> { return call('routes.analyze', args) }
export async function createRunPlan(args: { /* full arg type unchanged */ }): Promise<RunPlanResponse> { return call('runPlans.create', args) }
export async function regenerateRunPlan(planId: string, patch: { parameters?: Record<string, SetupValue>; hyperparameters?: Record<string, SetupValue>; presets?: Record<string, unknown> }): Promise<RunPlanResponse> { return call('runPlans.regenerate', { planId, patch }) }
export async function runPreview(config: RunConfig, restOptionId?: string | null): Promise<InstantResult> { return call('runs.preview', { config, restOptionId }) }
export async function createRun(planId: string): Promise<RunState> { return call('runs.create', { planId }) }
export async function tickRun(runId: string): Promise<TickResponse> { return call('runs.tick', { runId }) }
export async function actRun(runId: string, action: string, opts: { recovery_option_id?: string; rest_spot?: RestSpot } = {}): Promise<RunState> { return call('runs.act', { runId, action, opts }) }
export async function getRestSpots(runId: string, mapsKey?: string, drowsinessCeiling?: number, minDistanceKm?: number): Promise<{ rest_spots: RestSpot[]; notice?: string | null }> { return call('runs.restSpots', { runId, mapsKey, drowsinessCeiling, minDistanceKm }) }
export async function listRuns() { return call('runs.list') }
export async function getRun(runId: string): Promise<RunState> { return call('runs.state', { runId }) }
export async function getRunLog(runId: string): Promise<RunLog> { return call('runs.log', { runId }) }
export async function getFeedbackSchema(runId: string): Promise<FeedbackSchema> { return call('feedback.schema', { runId }) }
export async function getEvidence(runId: string, uiLanguage?: string): Promise<EvidenceReport> { return call('evidence.get', { runId, uiLanguage }) }
export async function getEvidenceMarkdown(runId: string, uiLanguage?: string): Promise<string> { return call('evidence.md', { runId, uiLanguage }) }
export async function submitFeedback(runId: string, body: FeedbackSubmitBody): Promise<FeedbackEvent> { return call('feedback.submit', { runId, body }) }
export { MapsError, FeedbackValidationError } from './types'
```

Keep the exact original argument object types for `createRunPlan` (copy from the current signature). `HealthStatus` stays defined locally in `client.ts` (or move to `handlers/health.ts` and import — either is fine as long as `getHealth`'s return type is unchanged).

- [ ] **Step 9: Update in-suite `beforeEach` reset for the new dispatch seed latch**

In `tests/client_run_loop.test.ts` `beforeEach`, add `resetDispatchState()` (import from `../src/engine/worker/dispatch`) after replacing the IDBFactory so the centralized seed latch re-seeds against the fresh DB:

```ts
import { resetDispatchState } from '../src/engine/worker/dispatch'
// ...
beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory()
  resetDispatchState()
  await seedDefaults()
  clearDraftRegistry()
  clearRegistry()
})
```

- [ ] **Step 10: Run the full suite to verify no regressions**

Run: `cd htmlapp/frontend && npx vitest run`
Expected: PASS — all pre-existing tests green (esp. `client_run_loop.test.ts`, `tick_engine.test.ts`, `run_manager.test.ts`) plus the new `rpc.test.ts`. The 23 client signatures are unchanged, so no synced component breaks. If a suite that drives the client surface fails to seed, confirm `resetDispatchState()` is in its `beforeEach`.

- [ ] **Step 11: Commit**

```bash
git add htmlapp/frontend/src/api/rpc.ts htmlapp/frontend/src/engine/worker htmlapp/frontend/src/api/client.ts htmlapp/frontend/tests/rpc.test.ts htmlapp/frontend/tests/client_run_loop.test.ts
git commit -m "refactor(htmlapp): dissolve client.ts monolith into RPC router + handlers (in-process)"
```

---

## Task S2: Collapse `derivePreviewHistory` into one shared history function

`derivePreviewHistory` (relocated into `handlers/runs.ts` in S1) duplicates `run_manager.ts`'s private `deriveHistory`. Unify them so a fix to proposal-history logic can't drift between the real-run and preview paths.

**Files:**
- Create: `htmlapp/frontend/src/engine/proposal_history.ts`
- Modify: `htmlapp/frontend/src/engine/run_manager.ts` (use the shared fn; delete the private copy)
- Modify: `htmlapp/frontend/src/engine/worker/handlers/runs.ts` (use the shared fn; delete `derivePreviewHistory`)
- Test: `htmlapp/frontend/tests/preview.test.ts` and `tests/run_manager.test.ts` (regression via `preview.json` + `run_log_e2e.json`)

**Interfaces:**
- Produces: `export function deriveProposalHistory(events: {kind:string; tick_index:number; action?:string; trace?:any}[], tickSeconds: number, currentSimSec: number): [ProposalHistory, { tick_index: number; action: string }[]]` — accepts the common `{kind, tick_index, action?, trace?}` shape both callers already have.

- [ ] **Step 1: Confirm the two functions are behaviorally identical on the shared inputs**

Read `run_manager.ts` `deriveHistory` (~387–463) and the relocated `derivePreviewHistory` in `handlers/runs.ts`. Both walk events collecting fired-proposal ticks/categories and actions, then compute `lastProposal*`, `proposalCountLast30Min` (1800s window), and `acceptanceRateRecent`. The only difference is the event source type. Confirm the field access (`event.kind`, `event.tick_index`, `event.action`, `event.trace.decision_result.{fire_control.fired,proposal,selected_category}`) is the same in both.

- [ ] **Step 2: Write the failing test asserting the shared fn matches the preview fixture path**

Add to `htmlapp/frontend/tests/preview.test.ts` (create if absent; mirror `run_manager.test.ts` setup with `seedDefaults()` + `resetDispatchState()`):

```ts
import { describe, it, beforeEach, expect } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { loadFixture, expectParity } from '../src/engine/__fixtures__/parity'
import { seedDefaults } from '../src/storage/db'
import { runPreview } from '../src/api/client'
import { resetDispatchState } from '../src/engine/worker/dispatch'
import { clearDraftRegistry } from '../src/engine/run_plan'
import { clearRegistry } from '../src/engine/run_manager'

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory()
  resetDispatchState(); await seedDefaults(); clearDraftRegistry(); clearRegistry()
})

describe('runPreview parity (guards deriveProposalHistory unification)', () => {
  it('matches the committed preview golden', async () => {
    const fx = loadFixture('preview')
    const actual = await runPreview(fx.input.config, fx.input.restOptionId ?? undefined)
    expectParity(actual, fx.output)
  })
})
```

- [ ] **Step 3: Run to verify it passes on current code (baseline), then perform the refactor**

Run: `cd htmlapp/frontend && npx vitest run tests/preview.test.ts`
Expected: PASS (this is a characterization test — it locks current behavior before the refactor). If the `preview.json` fixture's `input` shape differs from `{config, restOptionId}`, adapt the call to the fixture's actual `input` keys (inspect the JSON first).

- [ ] **Step 4: Create `src/engine/proposal_history.ts` with the shared function**

Move the body of `run_manager.ts`'s `deriveHistory` here verbatim, widening the parameter type to the common event shape:

```ts
import type { ProposalHistory } from './run_manager'   // or wherever ProposalHistory is declared; re-export if needed

type HistoryEvent = { kind: string; tick_index: number; action?: string; trace?: any }

export function deriveProposalHistory(
  events: HistoryEvent[], tickSeconds: number, currentSimSec: number,
): [ProposalHistory, { tick_index: number; action: string }[]] {
  // ... exact body of the current deriveHistory ...
}
```

If `ProposalHistory` is not exported, export it from `run_manager.ts`.

- [ ] **Step 5: Point both callers at the shared function; delete the duplicates**

- In `run_manager.ts`: delete private `deriveHistory`; `import { deriveProposalHistory } from './proposal_history'` and call it.
- In `handlers/runs.ts`: delete `derivePreviewHistory`; import and call `deriveProposalHistory`. If the preview path builds a distinct in-memory `PreviewEvent[]`, map it to `{kind, tick_index, action?, trace?}` at the call site (the fields already exist on those objects).

- [ ] **Step 6: Run preview + run_manager suites to verify parity holds**

Run: `cd htmlapp/frontend && npx vitest run tests/preview.test.ts tests/run_manager.test.ts`
Expected: PASS — both fixtures still match, proving the unified function is behavior-preserving.

- [ ] **Step 7: Commit**

```bash
git add htmlapp/frontend/src/engine/proposal_history.ts htmlapp/frontend/src/engine/run_manager.ts htmlapp/frontend/src/engine/worker/handlers/runs.ts htmlapp/frontend/tests/preview.test.ts
git commit -m "refactor(htmlapp): unify preview/real-run proposal-history into deriveProposalHistory"
```

---

## Task S3: Transport layer + Web Worker backend with in-process fallback

Introduce `Transport`, wrap `dispatch` in `InProcessTransport`, add a `WorkerTransport` and the worker entry, and route `client.ts` through a `transport` chosen at runtime with silent fallback.

**Files:**
- Create: `htmlapp/frontend/src/api/transport.ts`
- Create: `htmlapp/frontend/src/engine/worker/backend.worker.ts`
- Modify: `htmlapp/frontend/src/api/client.ts` (route `call()` through `transport` instead of `dispatch`)
- Test: `htmlapp/frontend/tests/transport.test.ts`

**Interfaces:**
- Produces: `interface Transport { call(req: RpcRequest): Promise<RpcResponse> }`; `class InProcessTransport implements Transport`; `class WorkerTransport implements Transport`; `function createTransport(): Transport` (worker if constructible, else in-process); `let transport: Transport` singleton export.

- [ ] **Step 1: Write the failing test for InProcessTransport parity with dispatch**

Create `htmlapp/frontend/tests/transport.test.ts`:

```ts
import { describe, it, beforeEach, expect } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { seedDefaults } from '../src/storage/db'
import { InProcessTransport } from '../src/api/transport'
import { dispatch, resetDispatchState } from '../src/engine/worker/dispatch'
import { clearDraftRegistry } from '../src/engine/run_plan'
import { clearRegistry } from '../src/engine/run_manager'

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory()
  resetDispatchState(); await seedDefaults(); clearDraftRegistry(); clearRegistry()
})

describe('InProcessTransport', () => {
  it('produces the same response as calling dispatch directly', async () => {
    const viaTransport = await new InProcessTransport().call({ op: 'packages.list' })
    resetDispatchState(); globalThis.indexedDB = new IDBFactory(); await seedDefaults()
    const viaDispatch = await dispatch({ op: 'packages.list' })
    expect(viaTransport).toEqual(viaDispatch)
    expect(viaTransport.ok).toBe(true)
  })

  it('surfaces a structured error response for an unknown run', async () => {
    const r = await new InProcessTransport().call({ op: 'runs.state', params: { runId: 'nope' } })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(typeof r.error.type).toBe('string')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd htmlapp/frontend && npx vitest run tests/transport.test.ts`
Expected: FAIL — cannot resolve `../src/api/transport`.

- [ ] **Step 3: Create `src/api/transport.ts`**

```ts
import type { RpcRequest, RpcResponse } from './rpc'
import { dispatch } from '../engine/worker/dispatch'

export interface Transport {
  call(req: RpcRequest): Promise<RpcResponse>
}

/** Runs the router on the calling thread. The file:// fallback and the Node test transport. */
export class InProcessTransport implements Transport {
  call(req: RpcRequest): Promise<RpcResponse> {
    return dispatch(req)
  }
}

/** Posts requests to the backend worker and correlates responses by id. */
export class WorkerTransport implements Transport {
  private worker: Worker
  private seq = 0
  private pending = new Map<number, (r: RpcResponse) => void>()

  constructor(worker: Worker) {
    this.worker = worker
    this.worker.onmessage = (ev: MessageEvent) => {
      const { id, response } = ev.data as { id: number; response: RpcResponse }
      const resolve = this.pending.get(id)
      if (resolve) { this.pending.delete(id); resolve(response) }
    }
    this.worker.onerror = () => {
      // A worker-level crash rejects all in-flight calls as a structured error.
      for (const [id, resolve] of this.pending) resolve({ ok: false, error: { type: 'WorkerError', message: 'backend worker crashed' } })
      this.pending.clear()
    }
  }

  call(req: RpcRequest): Promise<RpcResponse> {
    const id = ++this.seq
    return new Promise<RpcResponse>((resolve) => {
      this.pending.set(id, resolve)
      this.worker.postMessage({ id, req })
    })
  }
}

/** Try the worker; fall back to in-process (file://, CSP, or unsupported). Logs the downgrade once. */
export function createTransport(): Transport {
  try {
    if (typeof Worker === 'undefined') throw new Error('no Worker')
    const worker = new Worker(new URL('../engine/worker/backend.worker.ts', import.meta.url), { type: 'module' })
    return new WorkerTransport(worker)
  } catch (e) {
    console.info('[htmlapp] backend worker unavailable; running engine in-process.', e)
    return new InProcessTransport()
  }
}

export const transport: Transport = createTransport()
```

- [ ] **Step 4: Create `src/engine/worker/backend.worker.ts`**

```ts
/// <reference lib="webworker" />
import type { RpcRequest, RpcResponse } from '../../api/rpc'
import { dispatch } from './dispatch'

self.onmessage = async (ev: MessageEvent) => {
  const { id, req } = ev.data as { id: number; req: RpcRequest }
  let response: RpcResponse
  try {
    response = await dispatch(req)
  } catch (e) {
    response = { ok: false, error: { type: 'DispatchError', message: String(e) } }
  }
  ;(self as unknown as Worker).postMessage({ id, response })
}
```

- [ ] **Step 5: Route `client.ts` through the transport**

In `client.ts`, change the `call` helper to use the transport singleton instead of `dispatch`:

```ts
import { transport } from './transport'
import { unwrap, type RpcRequest, type RpcResponse } from './rpc'

async function call<T>(op: RpcRequest['op'], params?: unknown): Promise<T> {
  return unwrap<T>(await transport.call({ op, params }) as RpcResponse<T>)
}
```

(Vitest runs `createTransport()` in jsdom where `Worker` construction from a module URL is unavailable, so tests automatically use `InProcessTransport` — the fallback path is exercised by the whole existing suite.)

- [ ] **Step 6: Run transport test + full suite**

Run: `cd htmlapp/frontend && npx vitest run tests/transport.test.ts && npx vitest run`
Expected: PASS — transport test green; full suite still green (client surface now goes client → transport(InProcess) → dispatch → router → handler, behavior identical).

- [ ] **Step 7: Commit**

```bash
git add htmlapp/frontend/src/api/transport.ts htmlapp/frontend/src/engine/worker/backend.worker.ts htmlapp/frontend/src/api/client.ts htmlapp/frontend/tests/transport.test.ts
git commit -m "feat(htmlapp): swappable Transport with Web Worker backend + in-process file:// fallback"
```

---

## Task S4: Contract-parity harness (golden op-transcripts from Python)

Commit a capture script that drives the Python backend via FastAPI `TestClient` and records an op-transcript, plus a Vitest test that replays it through the router and asserts response parity.

**Files:**
- Create: `htmlapp/frontend/scripts/gen/capture_transcript.py`
- Create: `htmlapp/frontend/src/engine/__fixtures__/transcripts/trigger_nri_session.json` (generated, committed)
- Create: `htmlapp/frontend/tests/contract_parity.test.ts`
- Create: `htmlapp/frontend/src/engine/__fixtures__/transcript.ts` (loader + id/timestamp normalizer)

**Interfaces:**
- Produces: transcript shape `{ meta: {...}, steps: [{ op: RpcOp, params: object, response: object }] }`; `loadTranscript(name): Transcript`; `normalizeForParity(value): value` (nulls out generated ids/timestamps by key allowlist).

- [ ] **Step 1: Write `scripts/gen/capture_transcript.py`**

Drives the real FastAPI app in-process (no docker) and records a create-plan → create-run → tick-loop → accept_rest → complete → log → evidence session. Run under Anaconda with `PYTHONPATH=app/api`.

```python
"""Capture a golden RPC op-transcript from the Python backend via FastAPI TestClient.

Run from repo root:
  PYTHONPATH=app/api python htmlapp/frontend/scripts/gen/capture_transcript.py
No docker required; uses the in-process ASGI app.
"""
import json, pathlib
from fastapi.testclient import TestClient
from aica_api.main import app   # adjust if the app object lives elsewhere

OUT = pathlib.Path(__file__).resolve().parents[2] / "src/engine/__fixtures__/transcripts/trigger_nri_session.json"
PKG, SCN = "nri_fatigue_score_v1", "uc01_fatigue_recovery_v0_1"

def main() -> None:
    c = TestClient(app)
    steps = []
    def rec(op, params, resp):
        steps.append({"op": op, "params": params, "response": resp.json()})

    plan = c.post("/api/run-plans", json={"package_id": PKG, "scenario_id": SCN})
    rec("runPlans.create", {"package_id": PKG, "scenario_id": SCN}, plan)
    plan_id = plan.json()["plan_id"]

    run = c.post("/api/runs", json={"plan_id": plan_id})
    rec("runs.create", {"plan_id": plan_id}, run)
    run_id = run.json()["run_id"]

    accepted = False
    for _ in range(400):
        t = c.post(f"/api/runs/{run_id}/tick")
        rec("runs.tick", {"run_id": run_id}, t)
        body = t.json()
        if body.get("completed"):
            break
        if body.get("paused") and not accepted:
            a = c.post(f"/api/runs/{run_id}/actions",
                       json={"action": "accept_rest", "recovery_option_id": "nap_karaoke",
                             "rest_spot": {"id": "p1", "label": {"ja": "SA", "en": "SA"}, "route_fraction": 0.5}})
            rec("runs.act", {"run_id": run_id, "action": "accept_rest"}, a)
            accepted = True
        elif body.get("paused"):
            a = c.post(f"/api/runs/{run_id}/actions", json={"action": "decline"})
            rec("runs.act", {"run_id": run_id, "action": "decline"}, a)

    log = c.get(f"/api/runs/{run_id}/log"); rec("runs.log", {"run_id": run_id}, log)
    ev = c.get(f"/api/runs/{run_id}/evidence"); rec("evidence.get", {"run_id": run_id}, ev)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"meta": {"package": PKG, "scenario": SCN}, "steps": steps}, indent=2) + "\n")
    print(f"wrote {OUT} ({len(steps)} steps)")

if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Generate and commit the golden transcript**

Run: `cd <repo-root> && PYTHONPATH=app/api python htmlapp/frontend/scripts/gen/capture_transcript.py`
Expected: writes `trigger_nri_session.json` with 100+ steps. Inspect it: the last `runs.tick` step has `completed: true`; at least one `runs.act` with `accept_rest`. (If `aica_api.main` isn't the app path, locate it with `grep -rn "FastAPI(" app/api/aica_api`.)

- [ ] **Step 3: Create the transcript loader + normalizer `src/engine/__fixtures__/transcript.ts`**

```ts
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
export type TranscriptStep = { op: string; params: Record<string, unknown>; response: unknown }
export type Transcript = { meta: Record<string, unknown>; steps: TranscriptStep[] }

export function loadTranscript(name: string): Transcript {
  return JSON.parse(readFileSync(resolve(here, 'transcripts', `${name}.json`), 'utf8'))
}

/** Null out fields the JS engine legitimately generates differently (ids/timestamps). */
const VOLATILE = new Set(['run_id', 'plan_id', 'report_id', 'created_at', 'generated_at'])
export function normalizeForParity(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(normalizeForParity)
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {}
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      o[k] = VOLATILE.has(k) ? null : normalizeForParity(val)
    }
    return o
  }
  return v
}
```

- [ ] **Step 4: Write the failing contract-parity test**

Create `htmlapp/frontend/tests/contract_parity.test.ts`:

```ts
import { describe, it, beforeEach, expect } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { seedDefaults } from '../src/storage/db'
import { loadTranscript, normalizeForParity } from '../src/engine/__fixtures__/transcript'
import { expectParity } from '../src/engine/__fixtures__/parity'
import { InProcessTransport } from '../src/api/transport'
import { resetDispatchState } from '../src/engine/worker/dispatch'
import { clearDraftRegistry } from '../src/engine/run_plan'
import { clearRegistry } from '../src/engine/run_manager'
import type { RpcOp } from '../src/api/rpc'

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory()
  resetDispatchState(); await seedDefaults(); clearDraftRegistry(); clearRegistry()
})

describe('contract parity: JS router vs Python transcript', () => {
  it('replays trigger_nri_session and matches Python responses (ids normalized)', async () => {
    const tx = loadTranscript('trigger_nri_session')
    const transport = new InProcessTransport()
    let planId: string | null = null
    let runId: string | null = null

    for (const step of tx.steps) {
      // Rewrite recorded ids to the ones this JS session generated.
      const params: Record<string, unknown> = { ...step.params }
      if (params.plan_id != null && planId) params.plan_id = planId
      if (params.run_id != null && runId) params.run_id = runId
      const mapped = mapParams(step.op as RpcOp, params)

      const r = await transport.call({ op: step.op as RpcOp, params: mapped })
      expect(r.ok, `op ${step.op} errored: ${JSON.stringify(!r.ok && r.error)}`).toBe(true)
      if (!r.ok) continue

      if (step.op === 'runPlans.create') planId = (r.result as any).plan_id
      if (step.op === 'runs.create') runId = (r.result as any).run_id

      expectParity(normalizeForParity(r.result), normalizeForParity(step.response))
    }
  })
})

// Transcript params use the Python HTTP body key names; map them to the RPC param shape.
function mapParams(op: RpcOp, p: Record<string, unknown>): Record<string, unknown> {
  switch (op) {
    case 'runPlans.create': return { packageId: p.package_id, scenarioId: p.scenario_id }
    case 'runs.create': return { planId: p.plan_id }
    case 'runs.tick': return { runId: p.run_id }
    case 'runs.act': return { runId: p.run_id, action: p.action, opts: { recovery_option_id: p.recovery_option_id, rest_spot: p.rest_spot } }
    case 'runs.log': return { runId: p.run_id }
    case 'evidence.get': return { runId: p.run_id, uiLanguage: p.ui_language }
    default: return p
  }
}
```

- [ ] **Step 5: Run it; reconcile any real divergences**

Run: `cd htmlapp/frontend && npx vitest run tests/contract_parity.test.ts`
Expected: PASS. A parity failure here is a genuine finding — it means the JS engine diverges from Python. Fix the JS engine to match (or, if the divergence is an intentional, documented offline difference — e.g. a field the offline build cannot produce — add that key to the `VOLATILE`/normalizer allowlist with a comment). Do **not** loosen `expectParity`. `packages.addUser` is intentionally absent from the transcript (no Python counterpart).

- [ ] **Step 6: Commit**

```bash
git add htmlapp/frontend/scripts/gen htmlapp/frontend/src/engine/__fixtures__/transcript.ts htmlapp/frontend/src/engine/__fixtures__/transcripts htmlapp/frontend/tests/contract_parity.test.ts
git commit -m "test(htmlapp): contract-parity harness — replay Python op-transcript against the router"
```

---

## Task S5: Make fixtures regenerable + tick-by-tick nri parity

Turn the stub capture script into a real, runnable one; regenerate the module goldens and commit any diff; upgrade the trigger end-to-end test from completion-only to tick-by-tick decision parity.

**Files:**
- Modify: `htmlapp/frontend/scripts/capture-parity-fixtures.mjs` (or add `scripts/gen/*.py` capture blocks)
- Modify: `htmlapp/frontend/src/engine/__fixtures__/parity/*.json` (regenerated; commit diffs)
- Modify: `htmlapp/frontend/tests/client_run_loop.test.ts` (add tick-by-tick parity)
- Create: `htmlapp/frontend/src/engine/__fixtures__/parity/nri_tick_by_tick.json` (generated)

- [ ] **Step 1: Add an `npm run capture-fixtures` script + real capture**

Add to `package.json` scripts: `"capture-fixtures": "echo 'run: PYTHONPATH=app/api python ../../<repo>/htmlapp/frontend/scripts/gen/capture_all.py'"` — and implement `scripts/gen/capture_all.py` that regenerates the existing 18 module fixtures the same way `capture_transcript.py` drives the app (TestClient for endpoint-backed fixtures; direct `aica_api` module imports for internal-only ones like binning/driver_signals). Reuse the documentation block already at the top of `capture-parity-fixtures.mjs` as the source of which fixture came from which Python entry point.

- [ ] **Step 2: Regenerate all fixtures; commit only real diffs**

Run: `cd <repo-root> && PYTHONPATH=app/api python htmlapp/frontend/scripts/gen/capture_all.py`
Then: `cd htmlapp/frontend && git status --short src/engine/__fixtures__/parity`
Expected: some fixtures update (e.g. `tick_sequence.json` picks up current Python output). Run `npx vitest run` — the TS engine (which implements monotony) must still match. If a regenerated fixture makes a parity test fail, that is a real JS-vs-Python divergence to fix in the engine, not the fixture.

- [ ] **Step 3: Capture the nri tick-by-tick golden**

Add a capture block that records, for a full `nri_fatigue_score_v1` run, the ordered list of per-tick `decision_result` objects from the Python backend into `nri_tick_by_tick.json` (`{input:{package,scenario,acceptAt}, output:{decisions:[...]}}`).

- [ ] **Step 4: Write the failing tick-by-tick parity assertion in `client_run_loop.test.ts`**

Extend the existing nri test: collect each `resp.decision` into an array during the loop and, after completion, `expectParity(collected, loadFixture('nri_tick_by_tick').output.decisions)`. This replaces the "no algorithm_error + completed" smoke with a real decision-sequence comparison.

- [ ] **Step 5: Run to verify parity**

Run: `cd htmlapp/frontend && npx vitest run tests/client_run_loop.test.ts`
Expected: PASS — the JS nri decisions match Python tick-for-tick. Retire the `rest_rule_based_v0_1` dependency in `run_log_e2e` only if it is no longer referenced (grep first: `grep -rn rest_rule_based src/ tests/`).

- [ ] **Step 6: Commit**

```bash
git add htmlapp/frontend/scripts htmlapp/frontend/src/engine/__fixtures__/parity htmlapp/frontend/tests/client_run_loop.test.ts htmlapp/frontend/package.json
git commit -m "test(htmlapp): regenerable fixtures + tick-by-tick nri parity"
```

---

## Task S6: Multi-file build (single-file retained) + tsc gate

Make the default build emit a normal multi-file `dist/`, ship it as a zip, keep `build:singlefile` for the one-file target, and add a `tsc --noEmit` gate.

**Files:**
- Modify: `htmlapp/frontend/vite.config.ts`
- Modify: `htmlapp/frontend/package.json` (scripts)
- Create: `htmlapp/frontend/scripts/zip-dist.mjs`
- Modify: `htmlapp/frontend/scripts/check-size.mjs` (measure a dir for multi-file; keep single-file path)

- [ ] **Step 1: Split the Vite config into multi-file default + single-file mode**

Gate `viteSingleFile()` and `inlineDynamicImports` on an env flag so the default is standard multi-file output:

```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

const SINGLE = process.env.HTMLAPP_SINGLEFILE === '1'

export default defineConfig({
  base: './',
  plugins: [react(), ...(SINGLE ? [viteSingleFile()] : [])],
  build: {
    target: 'es2020',
    assetsInlineLimit: 100 * 1024,
    cssCodeSplit: !SINGLE,
    rollupOptions: SINGLE ? { output: { inlineDynamicImports: true } } : {},
  },
  worker: { format: 'es' },
  server: { port: 5181, host: true },
  test: {
    environment: 'jsdom', globals: true, setupFiles: ['tests/setup.ts'],
    exclude: ['node_modules/**', 'tests/e2e/**'],
  },
})
```

- [ ] **Step 2: Update `package.json` scripts**

```json
"typecheck": "tsc --noEmit",
"build": "npm run typecheck && vite build && node scripts/check-size.mjs && node scripts/zip-dist.mjs",
"build:singlefile": "npm run typecheck && cross-env HTMLAPP_SINGLEFILE=1 vite build && node scripts/check-size.mjs --single",
"build:customer": "node scripts/check-customer-config.mjs && npm run build",
```

(If `cross-env` isn't installed, set the var inline for bash: `HTMLAPP_SINGLEFILE=1 vite build`; note the Windows caveat in the plan and prefer `cross-env` — add it as a devDependency in this step if missing.)

- [ ] **Step 3: `scripts/zip-dist.mjs` — package `dist/` for delivery**

```js
import { createWriteStream } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
const here = dirname(fileURLToPath(import.meta.url))
const dist = resolve(here, '..', 'dist')
const out = resolve(here, '..', 'dist-htmlapp.zip')
// Use the platform zip; on Windows use PowerShell Compress-Archive.
try {
  if (process.platform === 'win32') {
    execFileSync('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path '${dist}/*' -DestinationPath '${out}' -Force`], { stdio: 'inherit' })
  } else {
    execFileSync('zip', ['-r', out, '.'], { cwd: dist, stdio: 'inherit' })
  }
  console.log(`✓ packaged ${out}`)
} catch (e) { console.error('zip failed:', e.message); process.exit(1) }
```

- [ ] **Step 4: Update `check-size.mjs` to size the multi-file dir (default) or the single file (`--single`)**

Sum the byte size of all files under `dist/` when not `--single`; keep the existing single-`index.html` measurement when `--single`. Keep the 2 MB warn / 3 MB fail thresholds against the total.

- [ ] **Step 5: Build both ways and verify artifacts**

Run: `cd htmlapp/frontend && npm run build`
Expected: `dist/index.html` + `dist/assets/*.js` (incl. a worker chunk) + `dist-htmlapp.zip`; typecheck passes; size check passes.
Run: `npm run build:singlefile`
Expected: single `dist/index.html`; size check (`--single`) passes.

- [ ] **Step 6: Commit**

```bash
git add htmlapp/frontend/vite.config.ts htmlapp/frontend/package.json htmlapp/frontend/scripts/zip-dist.mjs htmlapp/frontend/scripts/check-size.mjs
git commit -m "build(htmlapp): multi-file zip default build; retain single-file target; tsc gate"
```

---

## Task S7: Guard `sync-from-app.mjs` + reconcile the language toggle

Prevent future proposal/merged component syncs from breaking `tsc`, and bring the trigger UI to the current `GlobalLanguageToggle` pattern.

**Files:**
- Modify: `htmlapp/frontend/scripts/sync-from-app.mjs`
- Modify: htmlapp layout/components as needed for `GlobalLanguageToggle`

- [ ] **Step 1: Add an exclusion list + post-sync tsc gate to `sync-from-app.mjs`**

After the existing copy loops, delete excluded paths from `OUT` and run `tsc --noEmit`, failing on non-zero:

```js
import { execFileSync } from 'node:child_process'
// ...existing DIRS/FILES/PROTECTED copy loops...

// Not-yet-ported surfaces (P2 proposal, P3 merged): copied by cpSync above, removed here
// so tsc cannot break on clients that don't exist in htmlapp yet.
const EXCLUDE = [
  'components/proposal', 'components/merged',
  'state/appMode.tsx', 'state/proposalStore.ts', 'state/mergedCoordinator.tsx',
  'state/language.tsx', 'state/languageBridges.tsx',
  'api/proposalClient.ts', 'api/mergedClient.ts', 'replay/mergedReplaySource.ts',
]
for (const p of EXCLUDE) {
  rmSync(resolve(OUT, p), { recursive: true, force: true })
  console.log(`excluded    ${p}`)
}
console.log('\nrunning tsc --noEmit to verify the synced tree compiles...')
execFileSync('npx', ['tsc', '--noEmit'], { cwd: resolve(here, '..'), stdio: 'inherit' })
console.log('✓ synced tree typechecks')
```

- [ ] **Step 2: Verify a sync run leaves a compiling tree**

Run: `cd htmlapp/frontend && npm run sync`
Expected: prints synced dirs/files, the excluded paths, then `✓ synced tree typechecks`. If `state/language.tsx` is excluded but a synced component imports it, that surfaces here — see Step 3.

- [ ] **Step 3: Reconcile `LanguageToggle` → `GlobalLanguageToggle`**

If the synced `App.tsx`/layout now references `GlobalLanguageToggle` and `state/language.tsx` (excluded), provide the htmlapp equivalent: either (a) include `state/language.tsx` in the sync if it has no proposal/merged dependency, or (b) keep the htmlapp-local language provider and ensure `GlobalLanguageToggle` resolves against it. Choose whichever makes `tsc --noEmit` pass with the trigger-only tree. Run `npm run sync` again to confirm green, then `npx vitest run`.

- [ ] **Step 4: Commit**

```bash
git add htmlapp/frontend/scripts/sync-from-app.mjs htmlapp/frontend/src
git commit -m "chore(htmlapp): guard sync exclusions + tsc gate; reconcile global language toggle"
```

---

## Task S8: Trigger ID-collision fix + Playwright smoke over both build modes

Replace the reset-on-reload monotonic ID counters with a collision-resistant scheme, and add a browser smoke that opens the built artifact in served (worker) and `file://` (in-process) modes.

**Files:**
- Modify: `htmlapp/frontend/src/engine/worker/handlers/run_plans.ts` (plan id) and `handlers/runs.ts` (run id) — the `makePlanId`/`makeRunId` relocated in S1
- Create: `htmlapp/frontend/tests/id_uniqueness.test.ts`
- Create: `htmlapp/frontend/tests/e2e/build_smoke.spec.ts`

- [ ] **Step 1: Write the failing test for reload-safe unique ids**

Create `htmlapp/frontend/tests/id_uniqueness.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { makeRunId } from '../src/engine/worker/handlers/runs'
import { makePlanId } from '../src/engine/worker/handlers/run_plans'

describe('id generation', () => {
  it('run ids are unique across a simulated reload (fresh module counter state)', () => {
    const a = makeRunId()
    const b = makeRunId()
    expect(a).not.toBe(b)
    // Reload safety: ids must not be a pure 1-based counter that resets to run_000001.
    expect(a).not.toMatch(/_0*1$/)
  })
  it('plan ids and run ids do not collide', () => {
    const ids = new Set<string>()
    for (let i = 0; i < 50; i++) { ids.add(makeRunId()); ids.add(makePlanId()) }
    expect(ids.size).toBe(100)
  })
})
```

(Export `makeRunId`/`makePlanId` from their handler modules so the test can import them.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd htmlapp/frontend && npx vitest run tests/id_uniqueness.test.ts`
Expected: FAIL — current `run_000001`/`plan_000001` matches `/_0*1$/` and resets on reload.

- [ ] **Step 3: Replace the counters with a time+random scheme (outside the tick loop)**

In `handlers/runs.ts` and `handlers/run_plans.ts`:

```ts
// Collision-resistant id; mirrors Python's run_<ts>_<hex>. Runs ONCE at creation,
// outside the deterministic tick loop, so determinism of ticks is unaffected.
function randHex(n: number): string {
  let s = ''
  for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 16).toString(16)
  return s
}
export function makeRunId(): string {
  return `run_${Date.now().toString(36)}_${randHex(6)}`
}
```

(Same for `makePlanId` with the `plan_` prefix.) Remove `_runIdCounter`/`_planIdCounter`.

- [ ] **Step 4: Run id test + full suite**

Run: `cd htmlapp/frontend && npx vitest run tests/id_uniqueness.test.ts && npx vitest run`
Expected: PASS. Contract-parity still passes because `run_id`/`plan_id` are in the `VOLATILE` normalizer allowlist.

- [ ] **Step 5: Write the Playwright build smoke**

Create `htmlapp/frontend/tests/e2e/build_smoke.spec.ts` — serve `dist/` over http (worker mode) and open `dist/index.html` via `file://` (fallback mode); in each, assert the setup screen renders and a bundled scenario can start a run.

```ts
import { test, expect } from '@playwright/test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, resolve } from 'node:path'

const dist = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist')

test('served build renders setup screen (worker mode)', async ({ page }) => {
  // playwright.config webServer serves dist/; see config change below.
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
})

test('file:// build renders setup screen (in-process fallback)', async ({ page }) => {
  await page.goto(pathToFileURL(resolve(dist, 'index.html')).href)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
})
```

Add a `webServer` (e.g. `vite preview --port 4174`) + `use.baseURL` to `playwright.config.ts` for the served case. Adjust the assertion selector to a stable element actually present on the setup screen (inspect `SetupScreen.tsx`).

- [ ] **Step 6: Build then run the smoke**

Run: `cd htmlapp/frontend && npm run build && npx playwright test tests/e2e/build_smoke.spec.ts`
Expected: PASS in chromium. If Playwright browsers aren't installed, run `npx playwright install chromium` first. If `file://` worker construction is blocked, the app must still render via the in-process fallback — that is the behavior under test.

- [ ] **Step 7: Commit**

```bash
git add htmlapp/frontend/src/engine/worker/handlers htmlapp/frontend/tests/id_uniqueness.test.ts htmlapp/frontend/tests/e2e/build_smoke.spec.ts htmlapp/frontend/playwright.config.ts
git commit -m "fix(htmlapp): collision-resistant run/plan ids; Playwright smoke over worker + file:// builds"
```

---

## Self-Review

**1. Spec coverage** — every Phase 1 spec element maps to a task:
- RPC contract (`rpc.ts`) → S1. Worker router mirroring FastAPI routers + handlers → S1. `dispatch` + centralized seed → S1. Monolith dissolve → S1. `derivePreviewHistory` dedup → S2. Transport + Worker + in-process fallback → S3. Contract-parity golden transcripts (offline Python capture) → S4. Regenerable module goldens + tick-by-tick nri parity → S5. Multi-file zip build + single-file retained + tsc gate → S6. Sync guard + language reconcile → S7. ID-collision fix → S8. Playwright smoke over both modes → S8.
- Invariants (engine-source-of-truth, append-only, determinism, maps-key-never-leaks, 23 signatures, structured-cloneable, no live stack) → Global Constraints, enforced per task.
- `packages.addUser` htmlapp-only, exempt from contract-parity → S1 (op present) + S4 (excluded from transcript).

**2. Placeholder scan** — no "TBD/TODO/implement later"; every code step shows code or an exact source line range to relocate. Two tasks (S2 dedup event-shape reconciliation; S7 language-toggle reconciliation) contain a bounded decision with an explicit test gate (`preview.json` parity; `tsc --noEmit` green) rather than open-ended instructions.

**3. Type consistency** — `RpcOp`/`RpcRequest`/`RpcResponse`/`unwrap`/`serializeError` defined in S1 and used verbatim in S3/S4. `Transport.call` signature consistent S3→S4. `dispatch`/`resetDispatchState` defined S1, imported unchanged in S2/S3/S4/S5. `makeRunId`/`makePlanId` relocate in S1 (handlers), exported for tests and rewritten in S8. Handler names in `router.ts` match the handler exports listed in S1 Step 5 (note: `runsLog` must be exported from `handlers/runs.ts`).

---

## Execution Handoff

Two execution options:
1. **Subagent-Driven (recommended)** — a fresh subagent per task with two-stage review between tasks.
2. **Inline Execution** — batch execution in this session with checkpoints.
