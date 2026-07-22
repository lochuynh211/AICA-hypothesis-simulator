# HTMLApp — Worker-Seam Refactor & Verification Harness (Design / ADR)

**Date:** 2026-07-22
**Status:** Approved design — pre-plan
**Branch (planned):** `021-htmlapp-worker-seam`
**Related work:** additive — does **not** modify `app/frontend` or `app/api`.
**Supersedes/extends:** the seam and build sections of
`2026-07-02-htmlapp-offline-distributable-design.md` (that doc remains the record
of the original single-file port; this doc changes the seam *topology*, the
*build shape*, and the *verification strategy*).

## Context

The `htmlapp/` deliverable is a plug-and-run-in-Chrome build of the simulator we
hand to customers to test on their own machines — no install, no server, no
docker. It currently ports **only the Trigger screen** (UC-01 fatigue). We want
to also port the **Proposal** screen and the **Combined/Merged** screen.

A discovery pass established the true state of the code, which differs from the
"it's just one HTML file with no script" framing:

- The htmlapp is **not** frontend-only. It already has a full "pretend backend":
  a three-layer architecture (React UI → `api/client.ts` seam → `engine/` +
  `storage/`). `htmlapp/frontend/src/api/client.ts` (~1,648 LoC) exports **23
  functions** — the same **22** as `app/frontend/src/api/client.ts` plus one
  htmlapp-only upload function (`addUserPackage`) — but each body calls a local
  TS engine instead of `fetch('/api/...')`. The engine is a TypeScript port of
  the Python backend persisting to IndexedDB.
- The single `dist/index.html` is only the **ship artifact** — `vite-plugin-
  singlefile` inlines all JS/CSS at build time. Development already runs on a
  normal multi-file Vite dev server with HMR and source maps.

So "no script" is a *packaging* property, not the dev architecture — and
restructuring the build alone would not fix what actually makes complex screens
hard to port. The real blockers are:

1. **No proposal/merged engine exists in TS** — those screens call
   `proposalClient.ts` / `mergedClient.ts` → Python endpoints with no in-browser
   equivalent. Porting them is a *greenfield engine build*, not a file copy.
2. **Verification is broken.** Parity fixtures are stale (feature 020 added
   `monotony_accrued_min` / `dynamic.monotonyLevel` to `TickState`), and the
   scripts that regenerate them are **not committed** — they survive only as
   prose in `.superpowers/sdd/task-*-report.md`. "Does my port match Python?"
   has no reliable, repeatable answer today.
3. **The seam is an opaque monolith.** The 1,648-LoC `api/client.ts` carries the
   `runPreview` tick loop, `routesAnalyze` branching, `getRestSpots` selection,
   and a hand-duplicated `derivePreviewHistory()` (a copy of `deriveHistory()`).
   Because the exported *types* match the real client even when the *logic*
   diverges, bugs are invisible at the boundary. There are no parity tests for
   the seam itself, and **zero tests over the 45 verbatim-synced `.tsx` files.**
4. **`sync-from-app.mjs` will break** the moment merged/proposal components are
   synced — they import clients that do not exist in htmlapp, so `tsc` fails.

This spec designs **Phase 1** of a three-phase effort: restructure the seam into
a transport-swappable "backend in a Web Worker," change the build output, and
build the verification harness — all on the *known-good Trigger screen* — so
that Phases 2 (Proposal) and 3 (Combined) plug in by adding ops, handlers, and
golden transcripts rather than by inventing structure.

## Decomposition (three specs)

This is too large for one spec. It splits into three sequential sub-projects;
each gets its own spec → plan → implement cycle.

| Phase | Scope | Depends on |
|---|---|---|
| **P1 — this spec** | Transport/worker seam + verification harness + multi-file build + Trigger hardening | — |
| P2 (future spec) | Proposal TS engine + screen; proposal ops/handlers/transcripts | P1 |
| P3 (future spec) | Combined/Merged coordinator + screen | P1, P2 |

Phase 1 ships value on its own (a more robust, verifiable, correctly-built
Trigger distributable) and de-risks everything downstream.

## Goals (Phase 1)

- Refactor the seam into a **typed RPC contract** dispatched over a swappable
  `Transport`, with a **Web Worker** backend that structurally mirrors the
  FastAPI routers, and an **in-process fallback** that preserves double-click
  `file://` delivery.
- Stand up a **contract-parity harness**: golden op-transcripts captured offline
  from the Python backend, replayed against the worker router in CI — catching
  silent seam/engine logic drift that today is invisible.
- Fix the **existing verification debt**: commit fixture-capture scripts, refresh
  stale post-020 fixtures, upgrade the trigger end-to-end test to tick-by-tick
  parity.
- Change the **build output** to multi-file (shipped as a zip) to escape the
  ~2–3 MB inline ceiling and give the worker a normal same-origin URL, while
  **retaining single-file** as an optional target.
- **Guard `sync-from-app.mjs`** so future proposal/merged component syncs cannot
  silently break `tsc`.
- Fix known Trigger **correctness bugs** surfaced by discovery (ID collision on
  reload).
- Keep all exported `api/client.ts` signatures byte-identical so the synced UI
  layer is untouched.

## Non-goals (Phase 1)

- No proposal or merged engine/screen (P2/P3). P1 only prepares the ground.
- No changes under `app/frontend/` or `app/api/` — htmlapp stays purely additive.
- No dependency on a live docker/uvicorn stack at test time — goldens are
  committed; CI never hits the stack (matches the existing fixture pattern and
  the local Anaconda test environment where docker/uv are unavailable).
- No Pyodide/WASM, no Electron/Tauri, no multi-user/cloud — unchanged from the
  original htmlapp non-goals.
- No SharedArrayBuffer / cross-thread shared memory (unavailable at `file://`;
  the worker uses message passing only).

## Approved decisions (from brainstorm, 2026-07-22)

1. **Goals in scope:** all three — verification hardening, Web Worker seam, and
   build-output change.
2. **Sequencing:** harden Trigger first, then Proposal (P2), then Combined (P3).
3. **Seam architecture:** Approach A — transport-swappable backend-in-worker with
   an RPC envelope and a worker router, plus contract-parity golden transcripts.
   (Rejected: Approach B — relocating the monolith into a worker with a thin
   forwarding proxy; it keeps the opaque monolith, gains no contract, no
   fallback, no verification leverage.)
4. **Single-file build:** retained as an optional secondary target, not deleted.
5. **Trigger correctness fixes** (ID scheme, fixture refresh) folded into P1.
6. **Language toggle:** bring htmlapp to the `GlobalLanguageToggle` pattern
   (retire per-shell `LanguageToggle`) to match `app/frontend` after commit
   c849058.

## Architecture

### The contract (`src/api/rpc.ts`, new)

One serializable envelope, mirroring HTTP semantics:

```ts
type RpcRequest  = { op: RpcOp; params: unknown };
type RpcResponse<T> = { ok: true; result: T } | { ok: false; error: RpcError };
type RpcError    = { type: string; message: string; [k: string]: unknown };
```

`RpcError` mirrors the backend's HTTP error bodies so the UI's existing error
handling keeps working unchanged — e.g. the routes 502 shape
`{ error_type, message, suggestion }` is carried as
`{ type: 'maps_error', error_type, message, suggestion }`.

`RpcOp` is a closed string union namespaced to match
`app/api/aica_api/routers/` **one-to-one**, so the worker router reads like the
FastAPI router table:

```
health.get
packages.list        packages.get        packages.addUser   # addUser: htmlapp-only
scenarios.list       scenarios.get
routes.analyze       routes.presets.list      routes.presets.load
runPlans.create      runPlans.regenerate
runs.create  runs.tick  runs.act  runs.restSpots
runs.log     runs.list  runs.state  runs.preview
evidence.get  evidence.md
feedback.submit  feedback.schema
```

23 ops, one per exported client function. 22 mirror `app/frontend/src/api/
client.ts` (and the FastAPI routers) one-to-one; `packages.addUser` is
**htmlapp-only** — the docker app has no upload endpoint (packages are files on
disk), so it has no Python counterpart and is exempt from contract-parity (see
Verification). All params and results must be **structured-cloneable** (plain
JSON-shaped data) so they cross the worker boundary unchanged.

### The worker backend (`src/engine/worker/`, new)

```
src/engine/worker/
  router.ts          # Map<RpcOp, handler(params, ctx) => Promise<result>>
                     #   mirrors app/api/aica_api/routers/*; calls existing engine/ + storage/
  handlers/          # one file per router domain (runs.ts, routes.ts, ...)
  backend.worker.ts  # worker entry: onmessage -> router.dispatch -> postMessage
  dispatch.ts        # shared request->response driver used by BOTH transports
```

- `router.ts` + `handlers/*` are **pure of worker globals** — they never touch
  `self` or `postMessage`. They call the **existing, already-tested** engine
  modules (`run_manager.ts`, `tick_engine.ts`, `algorithms/adapter.ts`,
  `services/evidence_recorder.ts`) and storage stores. This purity is what lets
  the *same* router run off-thread or on the main thread with identical behavior.
- `backend.worker.ts` is the **only** worker-specific file: it wires
  `onmessage`/`postMessage` to `dispatch.ts`. IndexedDB is available in worker
  scope, so engine state and evidence persistence live in the worker when the
  worker is active.
- **The monolith dissolves into handlers.** The logic currently inlined in
  `api/client.ts` — the `runPreview` tick loop, `routesAnalyze`, `getRestSpots`,
  validation helpers — moves into the corresponding handlers. The duplicated
  `derivePreviewHistory()` is deleted and its one caller uses the single
  `deriveHistory()` in `run_manager.ts` (removing a standing "fix two copies"
  hazard).

### Transport + fallback (`src/api/transport.ts`, `src/api/client.ts`)

```ts
interface Transport { call<T>(req: RpcRequest): Promise<RpcResponse<T>>; }
```

- `WorkerTransport` — owns the `Worker`, correlates requests/responses by a
  monotonic id, resolves the matching promise on each `message`.
- `InProcessTransport` — imports `dispatch.ts` + `router.ts` and runs them on
  the main thread. **Same router module ⇒ guaranteed behavioral identity.**
- `createTransport()` (in `transport.ts`) attempts to construct the worker; on
  failure (worker blocked at `file://`, CSP, or unsupported) it **silently falls
  back** to `InProcessTransport`, logging the downgrade **once**. Selection is a
  runtime detail invisible above the seam.

`api/client.ts` collapses from ~1,648 LoC to thin, uniform wrappers:

```ts
export const tickRun = (runId: string) =>
  unwrap(transport.call<TickResponse>({ op: 'runs.tick', params: { runId } }));
```

Every one of the **23 exported signatures stays byte-identical**, so the synced
UI layer and `runStore.ts` are untouched.

### Data flow (a tick, worker mode)

```
PlaybackControls
  -> api/client.tickRun(runId)
  -> transport.call({op:'runs.tick', params:{runId}})           [main thread]
  -> postMessage --------------------------------------------->  [worker]
       dispatch -> router['runs.tick'] -> engine.tick(runId)
         -> tick_engine.advanceTick -> adapter.evaluate
         -> evidence_recorder.append (IndexedDB, append-only)
       <- { ok:true, result: TickResponse }
  <- postMessage <---------------------------------------------
  -> unwrap -> TickResponse
  -> runStore dispatch (TICK_APPENDED | ALGORITHM_ERROR_APPENDED | RUN_COMPLETED)
```

In `file://` fallback mode the two `postMessage` hops are replaced by a direct
`dispatch()` call; every other step is identical.

### Directory delta (Phase 1)

```
htmlapp/frontend/src/
  api/
    rpc.ts             # NEW  envelope + RpcOp union + RpcError
    transport.ts       # NEW  Transport iface + Worker/InProcess impls + factory
    client.ts          # REWRITTEN thin dispatchers (same 23 signatures)
    types.ts           # unchanged (synced)
  engine/
    worker/            # NEW  router + handlers + worker entry + dispatch
    ...                # existing engine modules unchanged in behavior
  # components/, state/, i18n/, styles/, replay/  -> unchanged (synced)
scripts/
  sync-from-app.mjs    # EDIT  add exclusion list + tsc gate
  gen/                 # NEW  committed Python capture scripts (transcripts + fixtures)
  capture-parity-fixtures.mjs  # EDIT  invoke scripts/gen/* for real (no longer a stub)
vite.config.ts         # EDIT  default multi-file; single-file behind a flag
package.json           # EDIT  build / build:singlefile / build:customer / capture scripts
tests/
  contract_parity.test.ts   # NEW  replay golden transcripts vs router
  ...                        # existing tests kept; client_run_loop upgraded
```

## Verification strategy

Three layers, weakest-to-strongest coverage of the failure surface.

### Layer 1 — Contract-parity (new; the headline)

- A **golden transcript** is an ordered list of `{ op, params, response }` for a
  representative session (e.g. create-plan → create-run → N ticks →
  accept_rest → complete → read log → read evidence), captured from the **real
  Python backend**.
- Capture runs offline via committed `scripts/gen/*.py` that **import the
  `app/api` Python modules directly** (the same technique the existing internal
  fixtures used) — no docker, no uvicorn, no `uv` required. This matches the
  local Anaconda Python 3.12 test environment where docker and the `uv` proxy
  are unavailable.
- `tests/contract_parity.test.ts` loads each transcript, replays its ops through
  `router.ts` via `InProcessTransport` (Node + `fake-indexeddb`), and asserts
  response parity using the existing `expectParity` (exact match on discrete
  fields — decisions, bands, event kinds, ordering, ids-modulo-generation;
  `1e-9` tolerance on continuous state).
- **This is the black-box seam test** that today does not exist: it catches the
  "types match but logic silently diverged" class of bug across the whole
  seam+engine, not just engine internals.
- Non-deterministic fields (generated run/plan ids, timestamps) are normalized
  before comparison by a documented allowlist in the parity helper.
- **`packages.addUser` is exempt** — it has no Python counterpart (htmlapp-only
  upload). It stays covered by the existing upload smoke test (spin up the
  worker, call `evaluate()` once with a canned input, commit only on a valid
  `EvaluateOutput`), not by contract-parity.

### Layer 2 — Module goldens (fix the existing debt)

- **Commit** the fixture-capture scripts under `scripts/gen/` (they exist today
  only as prose in task reports). `npm run capture-fixtures` regenerates every
  fixture with one command.
- **Refresh** the stale `src/engine/__fixtures__/parity/tick_sequence.json`
  (and any dependent fixtures) against the current Python output including the
  feature-020 `monotony_accrued_min` / `dynamic.monotonyLevel` fields.
- **Upgrade** `tests/client_run_loop.test.ts` from a completion-only check to a
  **tick-by-tick parity** test on `nri_fatigue_score_v1` (now a
  `builtin_js_module`), retiring the reconstructed-deleted-package
  `rest_rule_based_v0_1` fixture used by `run_log_e2e`.

### Layer 3 — Playwright smoke (close the UI-layer gap)

- Build the artifact and open it (both served-`http://` worker mode and
  `file://` fallback mode), asserting: setup screen renders, one bundled
  scenario runs to `completed`, evidence log has the expected event count, and
  the review/runs views mount. This protects the **45 verbatim-synced `.tsx`
  files** that currently have zero tests, so a shape change in a synced
  component fails loudly instead of silently.

## Build & packaging

- **Default `npm run build` → multi-file `dist/`**: `index.html` +
  `assets/*.js` (+ CSS + a real worker chunk), shipped to customers as a **zip**.
  - Removes `inlineDynamicImports: true` and drops `vite-plugin-singlefile` from
    the default pipeline; keeps `base: './'` for `file://` compatibility.
  - Escapes the 2–3 MB inline ceiling (needed once proposal data lands in P2)
    and gives the worker a normal same-origin URL when served over `http://`.
  - Delivery: unzip → double-click `index.html` works via the **in-process
    fallback**; serving over `http://` (an optional bundled static launcher,
    e.g. `start.bat`) activates the true worker. Double-click delivery is
    preserved either way.
- **`npm run build:singlefile` (optional secondary target)**: re-enables
  `vite-plugin-singlefile` for customers who insist on one file. It forces
  `InProcessTransport` (there is no separate worker chunk to load), and is
  subject to the existing ≤3 MB (target ≤2 MB) size check.
- **`npm run build:customer`**: unchanged guard — fails if
  `buildConfig.googleMapsApiKey` is the empty placeholder — layered on top of
  the default multi-file build.
- **`tsc --noEmit` gate**: `build` runs it first so any contract break between a
  synced component and the seam fails the build loudly.
- **No docker changes**: repo-root `docker-compose.yml` is untouched; the htmlapp
  remains outside the compose stack.

## Sync guard & UI reconciliation

- `scripts/sync-from-app.mjs` gains an explicit **exclusion list** so a sync can
  never copy code that references not-yet-ported clients:
  `components/proposal/`, `components/merged/`, `state/appMode.tsx`,
  `state/proposalStore.ts`, `state/mergedCoordinator.tsx`, `state/language.tsx`,
  `state/languageBridges.tsx`, `api/proposalClient.ts`, `api/mergedClient.ts`,
  `replay/mergedReplaySource.ts`. The list is defined in one place and echoed to
  stdout on each sync so the exclusions are visible, not silent.
- After sync, the script runs `tsc --noEmit`; a non-zero exit fails the sync.
- Bring htmlapp to the **`GlobalLanguageToggle`** pattern (retire per-shell
  `LanguageToggle`) so the Trigger UI matches `app/frontend` post-c849058. This
  is a synced-layer reconciliation, not new behavior.

## Trigger correctness fixes (folded into P1)

- **ID-collision bug.** `engine/run_plan.ts` and `engine/run_manager.ts` use
  monotonic in-memory counters (`plan_000001`, `run_000001`) that **reset to 1
  on page reload**, so a run created before a reload and one created after
  collide on the IndexedDB `[run_id, seq]` key and corrupt `run_events`. Replace
  with a collision-resistant scheme mirroring Python's
  `run_<YYYYMMDD-HHMMSS>_<6hex>` (and `plan_<...>`). The only contractual
  requirement is uniqueness; the parity helper already normalizes ids, so this
  does not disturb golden comparisons.

## Error handling

- `algorithm_error` remains an **event, never a faked decision**: the relevant
  handler returns the error-shaped `TickResponse` (`error` key present, `paused`
  set) exactly as the Python router does, and the engine records an
  `algorithm_error` event.
- A worker crash or unhandled rejection rejects the pending `transport.call`,
  which surfaces as a structured `RpcError` at the seam; the UI's existing
  error paths handle it.
- Transport downgrade (worker → in-process) is logged exactly once and is
  otherwise invisible.

## Invariants preserved

Carried forward without modification (from CLAUDE.md / the original htmlapp ADR):

- **Engine is source of truth** — now the engine *in the worker* (or in-process
  fallback). Components still import only `api/client`; nothing imports `engine/`
  or `storage/` directly.
- **Append-only evidence** — the only write path to `run_events` is
  `appendEvent()`; no `put`/`delete` outside `deleteRun`. Holds in worker scope.
- **Deterministic tick engine** — seeded PRNG only, no `Date.now()` in the tick
  loop. (The new ID scheme uses time+random **outside** the tick loop, in id
  generation only.)
- **Setup-time immutability**, **binning before decision logic**, **maps key
  never persisted/logged/exported**.

**Maps-key vigilance under the new topology.** The reviewer's runtime key stays
in main-thread `runStore` state and is passed as an **op param** to
`routes.analyze` / `runs.restSpots` — it is never stored in the worker or
IndexedDB, and it is excluded from every JSON export by the existing explicit
filter. Golden transcripts are captured on the **local-route path only** (no
key), so a key can never leak into a committed fixture. The pre-seeded
build-config key behavior (git-ignored `config.ts`) is unchanged and remains the
one deliberate, documented divergence from the main-app invariant.

## Slices for the build-out

Each slice is a small PR under `021-htmlapp-worker-seam`, merged to `develop` in
order, with all tests green at each step.

- **S1 — Contract skeleton.** Add `api/rpc.ts` (envelope + `RpcOp` union) and
  `engine/worker/dispatch.ts` + `router.ts` shell. No behavior change yet;
  router handlers delegate to the current `api/client.ts` internals.
- **S2 — Handlers + monolith dissolve.** Move `runPreview`, `routesAnalyze`,
  `getRestSpots`, and validation into `engine/worker/handlers/*`; delete
  `derivePreviewHistory()` in favor of `deriveHistory()`. `api/client.ts` still
  calls the router directly (in-process), signatures unchanged.
- **S3 — Transport layer.** Add `Transport` iface, `InProcessTransport`,
  `WorkerTransport`, `backend.worker.ts`, and `createTransport()` with silent
  fallback. `api/client.ts` becomes thin dispatchers. App runs identically in
  both modes.
- **S4 — Contract-parity harness.** Commit `scripts/gen/*.py`; capture the first
  golden transcript(s); add `tests/contract_parity.test.ts`.
- **S5 — Fixture debt.** Refresh `tick_sequence.json` (+ dependents) for post-020
  fields; upgrade `client_run_loop.test.ts` to tick-by-tick parity; retire the
  `rest_rule_based_v0_1` fixture.
- **S6 — Build change.** Default multi-file `dist/` + zip packaging; retain
  `build:singlefile`; add `tsc --noEmit` gate.
- **S7 — Sync guard + language reconcile.** Exclusion list + `tsc` gate in
  `sync-from-app.mjs`; move htmlapp to `GlobalLanguageToggle`.
- **S8 — Trigger correctness + Playwright smoke.** New ID scheme; Playwright
  smoke over both build modes.

## Risks & mitigations

- **Worker unavailable at `file://`.** Primary mitigation is the
  `InProcessTransport` fallback — the app is fully functional single-threaded.
  Served-`http://` mode (bundled launcher) is offered for true worker execution.
- **Structured-clone violations across the worker boundary.** Params/results
  must be plain data. Mitigation: contract-parity runs the router through
  `InProcessTransport`, and a dedicated worker-round-trip smoke asserts payloads
  clone cleanly; any non-cloneable value (function, class instance) fails fast.
- **Transcript capture drift from Python.** Committed `scripts/gen/*.py` make
  re-capture a single command; intentional reference changes go through
  "regenerate → PR includes the diff → review approves code + fixture together."
- **Async ordering regressions.** All ops are already async at the seam; the
  worker adds real message latency. Mitigation: `runStore` already treats every
  client call as a promise; contract-parity replays enforce response ordering.
- **Bundle/worker chunking under single-file target.** `build:singlefile` forces
  in-process (no separate worker chunk), so the single-file path is unaffected by
  worker chunking.
- **Scope creep into P2/P3.** Enforced by the exclusion list and by keeping this
  spec's ops limited to the existing 23 client functions; proposal/merged ops are
  explicitly out of scope until their engines exist.

## Out of scope

- Proposal engine/screen (P2) and Combined/Merged coordinator/screen (P3).
- Any modification to `app/frontend/` or `app/api/`.
- Live-stack (docker/uvicorn/`uv`) dependency at test time.
- SharedArrayBuffer / cross-thread shared memory.
- Pyodide/WASM, Electron/Tauri, multi-user/cloud sync.
- Adversarial sandboxing of user `js_module` packages (unchanged trust model
  from the original ADR).
