# HTMLApp — Offline Single-HTML Distributable (Design / ADR)

**Date:** 2026-07-02
**Status:** Approved design — pre-plan
**Branch (planned):** `008-htmlapp-offline`
**Related work:** additive — does not modify `app/frontend` or `app/api`.

## Context

The AICA Hypothesis Simulator today runs as a two-service docker stack: a Python
FastAPI backend (`app/api`, ~9,300 LoC across tick engine, run manager, algorithm
adapter, evidence recorder, maps client, and file-based data under `packages/`,
`scenarios/`, `runs/`) and a React/TS frontend (`app/frontend`) that talks to it
over `/api`. It's a great daily-development shape, but it is not something we
can hand a customer as a self-contained artifact.

This spec designs a **second deliverable**: an offline, single-HTML build of the
simulator with the algorithm and tick logic ported to TypeScript so it runs
entirely in the browser. It lives in a separate directory (`htmlapp/`) alongside
`app/`, is built with its own toolchain, and is only used to cut prototype
bundles for customer review. `app/frontend` and `app/api` continue to be the
primary development targets.

## Goals

- Produce a **single self-contained `index.html`** file that runs the full
  simulator offline (double-click / `file://`), with no docker, no server, no
  install step for the customer.
- **Full feature parity with the docker app**: setup + playback + trace +
  evidence + replay + feedback + Google Maps + route presets + route analysis +
  evidence markdown export + expert override.
- Keep the customer-facing artifact **frozen and reproducible** — a build cut
  today can be shipped again tomorrow without depending on the mainline moving.
- Preserve the CLAUDE.md **key design invariants** — backend-is-source-of-truth
  becomes "the local TS engine is source of truth"; append-only evidence,
  deterministic tick engine, setup-time immutability, algorithm-errors-as-events
  all still hold.

## Non-goals

- Not a replacement for the docker stack in daily development.
- Not a multi-user or cloud-synced product.
- No Pyodide / WASM Python — algorithms are ported to TS.
- No Electron / Tauri wrapper — single HTML in the browser is the delivery
  target.
- No visual package builder — packages are still JSON manifest or JS source,
  edited as text.
- No automatic migration of existing `runs/` JSON files into IndexedDB — an
  import UI covers it.

## Approved decisions (from brainstorm)

1. **Purpose:** offline distributable for shipping prototypes to customers.
2. **Python runtime:** port packages to TypeScript. No Pyodide.
3. **Data:** ship bundled defaults (packages + scenarios), persist everything
   editable in IndexedDB.
4. **Feature scope:** full parity with the current docker app.
5. **Packaging:** single self-contained HTML file, via `vite-plugin-singlefile`.
6. **Package authoring:** manifest strategies (`declarative_rule`,
   `weighted_score`) plus a new `js_module` strategy for user-uploaded JS.
   Existing python-module packages ship as `builtin_js_module` (TS-ported,
   registered directly, no eval).
7. **Port structure:** direct function-call replacement at the `api/client.ts`
   seam. No fetch shim, no big-bang port — vertical slices, each leaving the
   app runnable.
8. **Directory:** the whole thing lives in `htmlapp/frontend/` as a standalone
   Vite project. `app/frontend` and `app/api` are untouched.
9. **Map key handling:** a build-time config placeholder (`config.ts`, git-ignored)
   seeds the map key at first launch — deliberate divergence from the main-app
   invariant, justified by the customer-prototype use case (see §5).

## Architecture

The offline app is a standalone Vite project. The seam between UI and business
logic is the file `htmlapp/frontend/src/api/client.ts`: it exposes the same
typed, promise-based functions as `app/frontend/src/api/client.ts`, but the
bodies call into a local TS engine instead of `fetch('/api/...')`. React
components, `runStore`, `i18n`, and `styles` are copied over from
`app/frontend` and do not know or care that there's no server.

```
htmlapp/
  frontend/
    package.json
    vite.config.ts               # vite-plugin-singlefile enabled
    tsconfig.json
    index.html
    src/
      main.tsx
      App.tsx
      config.ts                  # git-ignored; buildConfig placeholder
      config.example.ts          # committed
      api/
        client.ts                # same public shape as app/frontend/api/client.ts
        types.ts                 # mirrors app/frontend/api/types.ts
      state/
        runStore.ts
      components/                # setup / playback / trace / evidence /
                                 # feedback / map / replay / runs / layout /
                                 # screens / context / common (copied)
      i18n/                      # copied
      styles/                    # copied
      engine/                    # ported Python business logic (TS)
        tick_engine.ts
        run_manager.ts
        event_plan.ts
        binning.ts
        run_plan.ts
        recovery.ts
        algorithms/
          adapter.ts
          declarative_rule.ts
          weighted_score.ts
          js_module.ts           # replaces python_module (user JS in a Worker)
        behavior/
          driver_model.ts
          vehicle_model.ts
        services/
          evidence_recorder.ts
          evidence_markdown.ts
          feedback.ts
          maps_client.ts         # direct call to Google Maps JS API (BYO-key)
          package_registry.ts    # merges bundled defaults + IndexedDB
          scenario_registry.ts   # same
          route_analysis.ts
      data/                      # bundled defaults, inlined at build time
        packages/                # JSON manifests + TS-ported built-in packages
        scenarios/               # scenario JSONs
      storage/                   # IndexedDB via idb wrapper
        db.ts                    # schema + versioning + seed-from-defaults
        packages_store.ts
        scenarios_store.ts
        runs_store.ts
    scripts/
      sync-from-app.mjs          # refresh presentation files from app/frontend
      capture-parity-fixtures.mjs
    dist/
      index.html                 # the customer-shipped artifact
```

The ~1,400 LoC of FastAPI routers (`app/api/aica_api/routers/*`) are **not**
ported. Their input validation and response shaping either already live in
`types.ts` or move into the corresponding `api/client.ts` function directly.

Engine internals are synchronous. Only the outer `api/client.ts` functions wrap
results in `Promise.resolve(...)`. For long tick sequences the engine yields to
the event loop every N ticks (`await new Promise(r => setTimeout(r, 0))`) so
playback stays responsive — the same responsiveness the docker app gets for
free from HTTP round-trips.

### Code sharing with `app/frontend`

`htmlapp/frontend/src/{components, state, i18n, styles, api/types.ts}` are
copies. The included `scripts/sync-from-app.mjs` refreshes these presentation
files from `app/frontend/src/` on demand — for example, right before cutting a
new customer bundle to pick up recent UX fixes. The script **never** overwrites
`api/client.ts`, `engine/`, `data/`, `storage/`, or `config.ts`. If a synced
component starts depending on an `api/client.ts` function the offline client
doesn't implement, TypeScript compilation fails loudly at build time — silent
runtime breakage is not possible.

## Data model & storage

Two data planes: **bundled read-only defaults** baked into the JS bundle at
build time, and a **mutable IndexedDB** database for user state.

### Bundled defaults

`htmlapp/frontend/src/data/`:
- `packages/index.ts` — imports each default `package.json` manifest as a TS
  object literal. Built-in code packages (the TS port of
  `nri_fatigue_score_v1`) are registered as `builtin_js_module` entries that
  point directly to imported TS functions — no `eval`, no worker.
- `scenarios/index.ts` — imports each default scenario JSON.
- `runs/` — none bundled; runs are always user-created.

### IndexedDB schema (`storage/db.ts`, version 1)

```
Database: aica-hypothesis-simulator
Version:  1

Object stores:
  packages         key: id (string)     value: PackageRecord
  scenarios        key: id (string)     value: ScenarioRecord
  runs             key: id (string)     value: RunHeader
  run_events       key: [runId, seq]    value: EvidenceEvent   (index: runId)
  feedback         key: [runId, seq]    value: FeedbackRecord  (index: runId)
  settings         key: string          value: any             (map key, lang, theme)
```

Records mirror the docker-app JSON file format one-to-one. `PackageRecord` and
`ScenarioRecord` carry an `origin: "builtin" | "user"` field. Builtins are
re-seeded on schema migration or via a "Reset to defaults" action; user
records are preserved. First launch seeds the DB from bundled defaults.

### Append-only evidence

`services/evidence_recorder.ts` appends events to `run_events` in the same
IndexedDB transaction as the `runs` header update. No `put` or `delete` on
`run_events` outside of an explicit `deleteRun` admin action. This preserves
the master invariant that a run log is append-only. Replay reads events by
`runId` index, ordered by `seq`.

### Import / export

Every store gets a JSON export (single run, all runs, a package, a scenario)
and matching import. Import validates against `types.ts` and refuses on
mismatch. The formats **round-trip** with the docker app's file layout: a run
JSON exported from the offline app can be dropped into `runs/` and read by the
docker app, and vice versa.

### Google Maps API key

Persisted in `settings.googleMapsApiKey` — necessary in a single-HTML offline
app since there's no other place to keep the key across sessions. **Excluded**
from every JSON export via an explicit filter in the export function (not
convention). A "Reset map key" button clears the setting.

### Build-time config placeholder

`htmlapp/frontend/src/config.ts` (git-ignored) exports a `buildConfig` object
with `googleMapsApiKey: ""` by default. A committed `config.example.ts` is the
template. When the customer bundle is being cut, the developer fills in the
key; on the customer's first launch the app seeds `settings.googleMapsApiKey`
from `buildConfig.googleMapsApiKey` if the DB has none.

**Note on the invariant.** CLAUDE.md says the map key is "never shipped,
persisted, logged, or exported." Baking a key into a customer bundle
intentionally breaks the "never shipped" part for this artifact — a scope
decision for the prototype use case, not an oversight. The persisted-in-
IndexedDB behavior is a mechanical necessity of an offline single-HTML app.
Excluded-from-export is a real hard rule that the export function enforces.

## Engine port strategy

Ported vertical-slice-by-slice. Each slice ends with the offline app runnable
for its scope. Slices 1–5 must complete before the first customer bundle can
ship; 6–11 can layer on afterwards without breaking earlier surfaces.

| # | Slice | Modules ported |
|---|---|---|
| 1 | Registries + setup screen | `package_registry`, `scenario_registry`, `storage/db.ts` + seeding |
| 2 | Algorithm adapter (dry) | `algorithms/adapter`, `declarative_rule`, `weighted_score`, `binning` |
| 3 | Run creation + event plan | `run_plan`, `event_plan` |
| 4 | Tick engine + behavior models | `tick_engine`, `driver_model`, `vehicle_model`, `recovery` |
| 5 | Run manager + evidence recorder | `run_manager`, `evidence_recorder` — full setup→play→trace→evidence loop; **first shippable bundle** |
| 6 | Feedback | `feedback` + wiring |
| 7 | Replay | reads `run_events`, no algorithm re-execution |
| 8 | Route analysis + Google Maps | `route_analysis`, `maps_client`, route presets |
| 9 | Markdown export + expert override | `evidence_markdown` + expert-override setup mode |
| 10 | `js_module` package strategy | `algorithms/js_module` + Web Worker sandbox |
| 11 | Built-in TS port of `nri_fatigue_score_v1` | packaged as `builtin_js_module`, validated by fixture |

### Determinism

The tick engine is deterministic given `(scenario, params, seed)`. The TS port
preserves this: no `Math.random()` without a seeded PRNG, no `Date.now()` in
the tick loop. Where the Python original uses `random.Random(seed)`, the TS
port uses a small seedable PRNG (e.g. `mulberry32`) with an equivalent draw
sequence — verified by a parity fixture.

### Parity vs the docker app

Golden fixtures live at
`htmlapp/frontend/src/engine/__fixtures__/parity/`. For each ported service
plus a full end-to-end run, we capture the docker app's output as JSON via
`scripts/capture-parity-fixtures.mjs` (which drives the running API on the
developer's machine) and check the JSON into git. TS tests then run the same
input through the port and assert equality — exact match on discrete fields
(decisions, bands, event types, ordering); tolerance of `1e-9` on continuous
state. The **checked-in fixtures are the contract**; CI reads them, not the
docker stack. Intentional reference changes go through: regenerate the
fixture locally → PR includes the diff → review approves both the code and
the fixture change together.

## `js_module` package strategy

User-uploaded packages implement:

```ts
export const manifest = { /* same shape as package.json */ };
export function evaluate(input: EvaluateInput): EvaluateOutput;
```

The `EvaluateInput` / `EvaluateOutput` shapes are identical to what
`declarative_rule` and `weighted_score` use — one contract across all three
strategies.

**Storage:** `packages` object store keeps the source as a string with
`strategy: "js_module"`. Source is opaque text — no normalization, no import
rewriting.

**Execution: Web Worker per package.** Each `js_module` package gets a
dedicated worker at registry-load time. The worker loads the source as a
blob URL, holds `manifest` + `evaluate`, and answers
`postMessage({ type: "evaluate", input })` with the result. The adapter for
`js_module` returns a `Promise<EvaluateOutput>` that resolves on the response.

Chosen over `new Function()` in the main thread because:
- No DOM, no `window`, no direct IndexedDB access from user code — a real
  boundary against buggy or hostile packages. Not a full sandbox (workers can
  still `fetch()`); this is trust-the-package-source, not adversarial
  isolation.
- Errors surface as `algorithm_error` events per the existing invariant
  without tearing down the app.
- Doesn't block the UI thread.

**Worker inlining for single-HTML.** Vite's `?worker&inline` import syntax
inlines worker code as a base64 blob URL, which `vite-plugin-singlefile`
folds into the HTML. Verified pattern; keeps the single-file constraint.

**Upload UX.** The setup screen's "Add package" flow accepts pasted JS or a
`.js` file, spins up a worker, calls `evaluate()` once with a canned smoke
input, and only commits to IndexedDB if the response matches
`EvaluateOutput`. Failing uploads show a validation error and are not saved.

**Failure model.** A worker crash or a thrown `evaluate()` becomes an
`algorithm_error` event in the run log; the package is flagged unhealthy for
the rest of the run; the tick engine continues.

## Build & bundling

- **Toolchain:** Vite 5 + `vite-plugin-singlefile` + TypeScript 5 + React 18 —
  same stack as `app/frontend`, so copied components need no changes.
- **Vite config:** `base: './'` for `file://` compatibility, `viteSingleFile()`
  plugin, assets ≤ 100 KB inlined as base64, workers via `?worker&inline`, no
  code splitting, no dynamic imports of external chunks.
- **Bundled defaults:** `data/packages/*.json` and `data/scenarios/*.json`
  imported directly — Vite inlines them into the JS bundle.
- **Build output:** `htmlapp/frontend/dist/index.html`. Single file. That's the
  whole deliverable.
- **Size budget:** ≤ 3 MB uncompressed (target ≤ 2 MB). A CI-style size check
  fails the build over budget.
- **Commands:**
  - `npm run dev` — Vite dev server with HMR; used for daily development. No
    build step.
  - `npm test` / `npm run test:e2e` — Vitest + Playwright. No build step for
    Vitest; Playwright runs against dev or built file per `--target=` flag.
  - `npm run build` — produces `dist/index.html`.
  - `npm run preview` — serve `dist/` locally to eyeball the built version.
  - `npm run build:customer` — build + fail loudly if
    `buildConfig.googleMapsApiKey` is the empty placeholder, so the developer
    can't accidentally ship a keyless bundle.
- **No docker changes:** the repo-root `docker-compose.yml` is untouched. The
  offline app doesn't participate in the compose stack.

### `file://` smoke test

The build task ends by loading `dist/index.html` via `file://` in headless
Chromium (Playwright) and running a canned smoke: setup screen renders, one
bundled scenario runs to completion, evidence log has the expected event
count. This catches file-protocol-specific breakage (accidental absolute
URLs, service worker attempts, unexpected external fetches) before the
bundle ships.

## Testing

- **Unit** (Vitest): every engine module, every algorithm strategy, IndexedDB
  adapters via `fake-indexeddb`, `api/client.ts` local implementation.
- **Parity** (Vitest): fixture-driven; see engine port strategy §.
- **Component** (Vitest + RTL): the small number of high-value component tests
  from `app/frontend` where they exist.
- **E2E** (Playwright): one smoke test per major surface — run authoring,
  playback, replay, feedback capture, export/import round-trip, `js_module`
  upload. Runs against `npm run dev` in CI and against the built
  `dist/index.html` via `file://` for shippable-artifact verification.

## Slices for the build-out (informal — mapped to the port table above)

Each slice is a small PR under a `008-htmlapp-*` branch, merged into `develop`
in order, with parity fixtures green at each step:

- **S1** — Vite project scaffold, `htmlapp/frontend/` directory, tsconfig,
  Vite config with `viteSingleFile`, initial `sync-from-app.mjs` running once
  to seed presentation layer, `config.example.ts`, size-budget check.
- **S2** — Engine port slices 1–2 (registries, algorithm adapter dry).
- **S3** — Engine port slices 3–4 (run creation, tick engine + behavior).
- **S4** — Engine port slice 5 (run manager + evidence recorder). **First
  shippable customer bundle** cut here.
- **S5** — Engine port slice 6 (feedback).
- **S6** — Engine port slice 7 (replay).
- **S7** — Engine port slice 8 (route analysis + Google Maps).
- **S8** — Engine port slice 9 (markdown export + expert override).
- **S9** — Engine port slices 10–11 (`js_module` strategy +
  `nri_fatigue_score_v1` TS port).

## Risks & mitigations

- **Port drift from the Python reference.** Parity fixtures per module + a
  full end-to-end fixture catch drift; slice-scoped PRs keep the surface small.
- **IEEE-754 numeric differences.** Rare in this codebase (mostly linear
  arithmetic). Where transcendentals appear, we pin the TS implementation and
  widen tolerance only where a fixture justifies it.
- **IndexedDB quirks (Safari).** Handled by the `idb` wrapper; Playwright
  cross-browser smoke covers Chromium + WebKit.
- **Bundle bloat.** Build-time size check at 3 MB blocks over-budget bundles.
- **Divergence between `htmlapp/` and `app/frontend`.** `sync-from-app.mjs`
  refreshes presentation files on demand; TypeScript compilation catches
  breakage against the offline client interface loudly at build time.
- **`nri_fatigue_score_v1` TS port drifting from the Python original.**
  Scheduled as the final port slice, gated on a dedicated parity fixture.
- **`js_module` worker misbehavior.** Smoke-test-on-upload catches obvious
  failures; runtime `algorithm_error` events catch the rest without crashing
  the run. Not adversarially sandboxed.

## Out of scope

- Multi-user sync, cloud persistence, remote backend calls (beyond Google
  Maps for map tiles).
- Visual package builder — packages are JSON manifest or JS source, edited
  as text.
- Automatic migration of existing `runs/` JSON files — the import UI covers
  it.
- Pyodide / WASM Python runtime.
- Electron / Tauri wrapper.
- Modifications to `app/frontend` or `app/api` — the offline app is purely
  additive.
