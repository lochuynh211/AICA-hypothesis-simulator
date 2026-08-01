# HTMLApp — Combined-Screen Export (Design / ADR)

**Date:** 2026-08-01
**Status:** Approved design — pre-plan
**Branch (planned):** `026-htmlapp-combined-export`
**Related work:** additive — does **not** modify `app/frontend` or `app/api`.
**Builds on:** `2026-07-22-htmlapp-worker-seam-refactor-design.md` (P1), whose
transport/worker seam, RPC contract and contract-parity harness are **merged into
`develop`** and are the foundation this work plugs into.
**Supersedes:** the P2 (Proposal screen) and P3 (Combined screen) phases sketched
in that document. This spec replaces both with a single Combined-only export, and
re-sequences the work bottom-up.

## Context

The `htmlapp/` deliverable is a plug-and-run-in-Chrome build of the simulator we
hand to customers to test on their own machines — no install, no server, no
docker. Today it ships the **Trigger screen only**.

The product has moved on. The Combined Simulator (feature 020, hardened by
022/023/025) is now the screen customers are asked to review: a 3-panel
parameter-rationale surface that runs a driving journey, fires the trigger,
proposes a service and content at each rest stage, and shows why. The Trigger and
Proposal screens are no longer part of what we hand over.

So the htmlapp needs to export the Combined screen — and only the Combined
screen.

### What P1 already gives us

P1 (`021-htmlapp-worker-seam`, merged) restructured the htmlapp seam so that
exactly this kind of work is additive:

- A typed RPC contract (`api/rpc.ts`) with a closed `RpcOp` union namespaced
  1:1 against `app/api/aica_api/routers/`.
- A worker router (`engine/worker/router.ts` + `handlers/*`) that is pure of
  worker globals, so the same router runs off-thread (`WorkerTransport`) or on
  the main thread (`InProcessTransport`, the `file://` fallback).
- A contract-parity harness (`tests/contract_parity.test.ts`) replaying golden
  op-transcripts captured offline from the real Python backend.
- A multi-file zip build (single-file retained as an optional target), a
  `tsc --noEmit` gate, and a guarded `sync-from-app.mjs`.

Adding the Combined screen therefore means **new ops, new handlers, new engine
modules** — not new topology.

### What it actually costs

A discovery pass established the true gap. Dropping the Trigger and Proposal
*screens* removes almost none of the *engine* work, because the Combined screen
sits on top of both engines and calls the proposal router's internals directly
(`create_proposal_run`, `select_service`, `recompute_proposal_run`,
`apply_journey_action`, `explain_from_run_log`).

| Piece | Status | Size |
|---|---|---|
| Trigger engine (tick, run_plan, event_plan, binning, recovery, evidence, route analysis, preview, feedback) | ported | — |
| RPC/worker seam + parity harness | P1, merged | — |
| Proposal engine (selector, journey, eligibility, run_manager, preset/profile/seed stores, world validation, catalog registry) | **not ported** | ~2,600 LOC Py |
| Explanation layer (`trigger_explanation`, `service_explanation`, `content_explanation`, `explanation_builder`) | **not ported** | ~2,200 LOC Py |
| Merged layer (`routers/merged_runs.py` + `merged_adapter`/`merged_painter`/`merged_quickview`/`merged_run_coordinator`) | **not ported** | ~2,160 LOC Py |
| Algorithms: hybrid trigger + NRI (**stale**), service selector + content selector (**absent**) | see below | ~3,600 LOC Py |
| Frontend: `components/{merged,review,proposal}`, `lib/review`, 5 state modules, 2 clients | excluded by `sync-from-app.mjs` | ~15,600 LOC TSX |
| Data: 6 combined cases, 35 presets, 4 profiles, 5 seeds, matrix, dispositions, service capabilities, 300-song catalog, scenarios, route presets | hand-copied subset, drifted | ~1.2 MB |

**All four algorithm ports are stale or absent.** `aica_transparent_hybrid_trigger_v1.ts`
and `nri_fatigue_score_v1.ts` were last touched in `b99da5a` (2026-07-06,
mirroring feature 009); their Python counterparts changed on 2026-07-29 and
2026-08-01 respectively, and NRI is now 721 Python lines against 461 TS lines.
The trigger and NRI ports must be **refreshed**, and the service and content
selectors **added**.

Total: roughly **10,000 LOC of Python to re-express in TypeScript**, plus a
15.6k-LOC UI sync and a data seam.

## Goals

- Export the **Combined screen** — and only the Combined screen — to the offline
  htmlapp, reproducing the current `app/api` + `app/frontend` behaviour.
- Keep the **app-mode/tab structure** of `app/frontend` intact in the ported code
  so re-enabling a screen later is a configuration change, not a refactor.
- **Separate data from source**: preset, test-case, profile, seed, matrix,
  catalog, scenario, route and package-manifest data reaches the htmlapp through
  a declarative manifest and a generated data bundle. Changing that data must
  require **no code change and no app rebuild**.
- Prove the port against the real Python with **per-module goldens and
  full-session op transcripts for all 6 combined test cases**, both regenerable
  by one command.
- Preserve every htmlapp invariant: engine is the source of truth, evidence is
  append-only, the tick engine is deterministic, setup parameters are immutable
  after run start, quantities are binned before decision logic, and the maps key
  is never persisted, logged or exported.

## Non-goals

- No Trigger or Proposal **screen** in the shipped artifact. Their code paths
  remain in the tree behind an enabled-modes list; they are not built into the
  customer bundle's navigation.
- No changes under `app/frontend/` or `app/api/` — htmlapp stays purely additive.
- No live docker/uvicorn/`uv` dependency at test time; goldens are committed.
- No Ollama. `provider: 'backend'` is removed from the ported explanation path;
  `off` (deterministic template) and `browser` (Chrome Gemini Nano) remain.
- No Pyodide/WASM, no Electron/Tauri, no multi-user/cloud — unchanged htmlapp
  non-goals.
- No adversarial sandboxing of user `js_module` packages — unchanged trust model.
- No new runtime dependencies. (See the `httpx2` supply-chain incident: backend
  deps are pinned and new dependencies are not added without verifying upstream.)

## Approved decisions (brainstorm, 2026-08-01)

1. **Port strategy — hand-port to TypeScript.** Re-express each Python module as
   a TS module behind the P1 seam, and prove equivalence with goldens captured
   from the real Python. *Rejected:* Pyodide (maximum literal fidelity, but a
   10–25 MB runtime, `pydantic-core` wheel risk, and it breaks double-click
   `file://` delivery — already an explicit non-goal in the P1 ADR); and
   pre-recorded case playback (cheap, but removes parameter editing, which is
   the entire point of a parameter-rationale review screen).
2. **Data seam — sync script plus a standalone data bundle.** A manifest-driven
   `npm run build:data` writes `htmlapp/frontend/data/` and emits a generated
   `aica-data.js` loaded by its own `<script>` tag. Changing data needs no code
   change *and* no app rebuild. *Rejected:* Vite-bundled data (simpler, but a
   data change forces a full rebuild); globbing the repo's contract dirs in place
   (zero drift, but htmlapp could only build inside the full repo and the zip has
   no visible data directory); runtime `fetch()` of a `data/` folder (best
   swappability, but Chrome blocks `fetch()` at `file://`, which would cost the
   double-click deliverable).
3. **Sequencing — layer-by-layer bottom-up**, each layer verified against Python
   before anything is built on it. *Rejected:* vertical-slice-first (visible
   sooner, but defers parity); UI-first against the live docker stack
   (mechanically efficient, but temporarily non-offline and requires docker).
4. **Parity bar — per-module goldens plus full-session transcripts for all 6
   combined cases**, both regenerated by one command. *Rejected:* an exhaustive
   preset × profile matrix (10 MB+ of fixtures and noisy diffs on every retune);
   transcripts only (a failure gives "tick 14 diverged" with no pointer);
   spot checks (silent divergence across most of a 10k-LOC port).
5. **Shell — render the tab bar with Combined as the only tab.** `state/appMode.tsx`
   syncs over verbatim and the bar is data-driven off `ENABLED_MODES = ['merged']`.
   Nothing dead renders; adding a screen back means adding its mode to the list.
   *Rejected:* no bar at all (hides the product's shape); all three tabs with two
   greyed out (dead controls read as a broken build).
6. **LLM narration** — keep `off` and `browser`; drop `backend`/Ollama.
7. **Maps** — unchanged: keyless local-route schematic by default, BYO key still
   accepted at runtime, never persisted.
8. **Runs history and replay** — ported. `merged_runs/*.json` becomes IndexedDB,
   as the trigger port already does for `runs/`.

## Architecture

Nothing about the P1 topology changes.

```
MergedShell / ReviewColumn / MergedSetupPanel      synced verbatim from app/frontend
        │  imports only api/mergedClient, api/proposalClient
        ▼
api/client.ts · mergedClient.ts · proposalClient.ts    thin dispatchers, signatures byte-identical
        ▼
transport.call({ op, params })            WorkerTransport   ─┐ (served http://)
        │                                 InProcessTransport ─┘ (file:// fallback)
        ▼
engine/worker/router.ts                   RpcOp: 23 → 41
        ├── handlers/merged.ts             ← routers/merged_runs.py       (14 ops)
        ├── handlers/proposal.ts           ← routers/proposal.py subset   (4 ops)
        └── handlers/{runs,routes,packages,scenarios,run_plans,evidence,feedback,health}.ts   unchanged
        ▼
engine/merged/*   engine/proposal/*   engine/explanation/*        the port
engine/{tick_engine,run_manager,run_plan,route_analysis,binning,…}  already ported, reused
        ▼
storage/*  (IndexedDB)              src/data/registry.ts → window.__AICA_DATA__ (read-only)
```

Three P1 rules carry over unchanged:

- Handlers never touch `self` or `postMessage`, so the same router module runs on
  either transport with identical behaviour.
- Components import only `api/*`; nothing above the seam imports `engine/` or
  `storage/`.
- `run_events` is append-only; `appendEvent()` is the sole write path.

### Op surface: 23 → 41

The Combined screen's API surface is narrower than the full Proposal screen's,
because the merged endpoints call proposal internals rather than re-entering over
HTTP.

| Namespace | Ops | Mirrors |
|---|---|---|
| `merged.*` (14) | `plan` `quickview` `create` `get` `list` `tick` `proposalAction` `acceptRest` `decline` `afterRestProposal` `explain` `explainTrigger` `reviewFeedback.post` `reviewFeedback.get` | all of `routers/merged_runs.py` |
| `proposal.*` (4) | `presets.list` `presets.get` `packages.list` `catalog.get` | the four `routers/proposal.py` endpoints the Combined UI calls |
| existing (23) | unchanged from P1 | `routers/{health,packages,scenarios,routes,route_presets,run_plans,runs}.py` |
| `data.install` (1) | added by C0 | **htmlapp-only, parity-exempt** — seeds the data payload into the worker scope (see Data seam) |

That is 42 ops in total; 41 form the parity-covered surface, and the two
htmlapp-only ops (`packages.addUser`, `data.install`) are exempt because they
have no Python counterpart.

`RpcOp` stays a closed string union; the router table stays readable as the
FastAPI router table. All params and results remain structured-cloneable plain
data.

### Ported module inventory

| New TS directory | Ported from `app/api/aica_api/services/` (+ router bodies) | ~LOC |
|---|---|---|
| `engine/merged/` | `merged_adapter`, `merged_painter`, `merged_quickview`, `merged_run_coordinator`, and the `merged_runs.py` router body | 2,160 |
| `engine/proposal/` | `proposal_selector`, `proposal_journey`, `proposal_journey_preview`, `proposal_eligibility`, `proposal_run_manager`, `proposal_package_registry`, `preset_store`, `driver_profile_store`, `world_seed_store`, `world_validation`, `world_clone_store.apply_overrides`, `dataset_catalog_registry`, `algorithm_config` | 2,600 |
| `engine/explanation/` | `trigger_explanation`, `service_explanation`, `content_explanation`, `explanation_builder` | 2,200 |
| `data/packages/builtin/` | `aica_transparent_hybrid_trigger_v1` (refresh), `nri_fatigue_score_v1` (refresh), `aica_transparent_service_selector_v1` (new), `aica_transparent_content_selector_v1` (new) | 3,600 |

Reused unchanged: `tick_engine`, `run_manager`, `run_plan`, `event_plan`,
`route_analysis`, route presets, `binning`, `recovery`, `prng`, `preview`,
`evidence`, `evidence_markdown`, `feedback`, `package_registry`,
`scenario_registry`, `behavior/*`.

Pydantic models under `models/proposal/` do **not** get a separate TS port: their
shapes already exist as the types in `api/proposalClient.ts` and
`api/mergedClient.ts`, which sync over verbatim. Validation that Pydantic
performed at the router boundary becomes explicit guard functions in the
handlers, which is where the equivalent `HTTPException`/`ValidationError`
responses are produced.

### Frontend

**`sync-from-app.mjs` is already latently broken, independently of this work.**
Its `DIRS` array is `['components', 'state', 'i18n', 'styles', 'replay']` — it
never copies `lib/`. Since that array was written, five *Trigger-screen*
components in `app/frontend` grew imports from `lib/`
(`components/setup/situation/FixedConditionsSection.tsx`,
`components/setup/formulationTemplates.ts`, `components/map/MapSurface.tsx`,
`components/map/FallbackRouteMap.tsx`, `components/playback/ScoreTimeline.tsx`).
Running `npm run sync` today therefore leaves those imports dangling. Separately,
`components/review/` and `state/reviewStore.tsx` (added by feature 023, after P1)
are **not** in the exclusion list, so the sync copies them along with their
`mergedClient` and `lib/review` imports.

**Correction (verified during C0 Task 9):** an earlier draft of this section
claimed the sync "fails its own `tsc` gate". It does not. The gate runs
`tsc --noEmit --project tsconfig.authored.json`, and that project includes only
`api/`, `engine/`, `storage/`, `data/`, `config.ts` and `vite-env.d.ts` —
confirmed with `tsc --listFiles`. **The ~45 synced `.tsx` files and `lib/` are
not type-checked at all**, so dangling imports surface at `vite build`, not at
the gate. The gate is therefore much weaker than its name suggests, which matters
for C5: lifting the exclusions cannot rely on it to catch a broken sync. C5 must
either widen `tsconfig.authored.json` to cover the synced layer or add a build
step to the sync.

C0 repairs this: add `lib` to `DIRS`, and add `components/review` and
`state/reviewStore.tsx` to the exclusion list so the Trigger-only htmlapp syncs
cleanly again. C5 then removes those two entries along with the rest.

C5 drops the exclusions for `components/proposal`, `components/merged`,
`components/review`, `state/appMode.tsx`, `state/proposalStore.ts`,
`state/mergedCoordinator.tsx`, `state/reviewStore.tsx`,
`state/languageBridges.tsx`, `api/proposalClient.ts`, `api/mergedClient.ts` and
`replay/mergedReplaySource.ts`. Those ~15.6k LOC (plus `lib/review/*`, which
`lib` in `DIRS` now brings across) then sync verbatim, guarded by the `tsc`
gate. The exclusion list does not disappear — it shrinks to whatever remains
genuinely unported, and is still echoed to stdout on each sync.

`api/mergedClient.ts` and `api/proposalClient.ts` become htmlapp-maintained thin
dispatchers (added to `PROTECTED` alongside `api/client.ts`), with every exported
signature and type byte-identical to upstream so the synced components compile
untouched. `state/languageBridges.tsx` syncs in place of `App.tsx`'s inline
bridge, since `proposalStore` now exists.

`App.tsx` mounts `<AppModeProvider initialMode="merged">` and a tab bar driven by
`ENABLED_MODES = ['merged']`.

## Data seam

```
htmlapp/frontend/data.manifest.mjs        COMMITTED — the contract
  { key:'combinedCases',       from:'combined_contracts/test_cases',           glob:'case-*.json',    shape:'array' }
  { key:'presets',             from:'proposal_contracts/presets',              glob:'preset-*.json',  shape:'byId'  }
  { key:'profiles',            from:'proposal_contracts/profiles',             glob:'profile-*.json', shape:'byId'  }
  { key:'seeds',               from:'proposal_contracts/seeds',                glob:'seed-*.json',    shape:'byId'  }
  { key:'matrix',              from:'proposal_contracts/matrix',               glob:'*.json',         shape:'single'}
  { key:'dispositions',        from:'proposal_contracts/dispositions',         glob:'*.json',         shape:'single'}
  { key:'serviceCapabilities', from:'proposal_contracts/service_capabilities', glob:'*.json',         shape:'single'}
  { key:'datasets',            from:'proposal_contracts/dataset',              glob:'**/*.json',      shape:'nested'}
  { key:'scenarios',           from:'scenarios',                               glob:'*.json',         shape:'byId'  }
  { key:'routePresets',        from:'routes/presets',                          glob:'*.json',         shape:'byId'  }
  { key:'packageManifests',    from:'packages',                                glob:'*/package.json', shape:'byId'  }

npm run build:data          (wired as `prebuild`)
  ├─► htmlapp/frontend/data/**             GIT-IGNORED — inspectable copy of the JSON tree
  └─► htmlapp/frontend/public/aica-data.js GENERATED — window.__AICA_DATA__ = Object.freeze({…})

index.html
  <script src="./aica-data.js"></script>      ← loaded BEFORE the app bundle
  <script type="module" src="/src/main.tsx"></script>
```

A `<script>` tag rather than a `fetch()` of `data/` is the load-bearing choice:
Chrome blocks `fetch()` at `file://`, and the double-click deliverable is
non-negotiable. Classic script tags are not subject to that restriction.

> **Defect found during C0 acceptance — the multi-file build does not work at
> `file://` at all, and never did.** Vite emits the app entry as
> `<script type="module" crossorigin src="./assets/index-*.js">`. Module scripts
> are CORS-fetched, and at `file://` the origin is `null`, so the entry script
> and CSS never load: the page stays blank with an empty `<div id="root">`. This
> is **pre-existing** — it reproduces on `develop` and is unrelated to the data
> seam — but it falsifies the P1 ADR's claim (`2026-07-22-…-worker-seam-refactor-design.md`,
> "Delivery: unzip → double-click `index.html` works via the in-process
> fallback"). The repo's own `tests/e2e/build_smoke.spec.ts` already asserts the
> `file://` case and must have been failing unnoticed, because Playwright is not
> part of `npm test`.
>
> **Only `build:singlefile` satisfies double-click delivery**, because
> `vite-plugin-singlefile` inlines the module script — an *inline* module script
> executes at `file://` since nothing is fetched. This was verified end-to-end in
> headless Chromium during C0 (app renders, `window.__AICA_DATA__` populated).
>
> Consequence for this project: **the customer deliverable should be the
> single-file build**, not the multi-file zip. That inverts P1's "multi-file
> default, single-file optional" decision, and it is a product-delivery call the
> owner should confirm — it is recorded here rather than acted on. The multi-file
> build remains correct and useful when served over `http://`, which is also the
> only mode where the real Web Worker runs.
>
> C0's own claims are unaffected: the data seam, registry, decoupling and
> no-rebuild refresh all verified green.

**The worker needs its own copy.** A `<script>` tag populates the main thread
only; the backend worker is a separate global scope, and both
`engine/worker/handlers/routes.ts` and `storage/db.ts` run inside it. So
`WorkerTransport` posts a **`data.install`** op carrying the payload as its
first message, and `backend.worker.ts` gates every other op behind it (dispatch
is async, so ordering alone is not enough). `data.install` is **htmlapp-only and
parity-exempt**, like `packages.addUser` — it has no Python counterpart. That
makes the final op count **42**, of which 41 are the parity-covered surface. In
`file://` fallback mode there is no worker and the main-thread install is the
only one.

**The single-file target needs an inlining step.** `public/` assets are copied
verbatim and are never processed by the bundler, so `vite-plugin-singlefile`
leaves `<script src="./aica-data.js">` alone. `build:singlefile` therefore runs a
`scripts/inline-data.mjs` post-step that folds the bundle into `dist/index.html`
and deletes the separate file; without it that target quietly stops producing a
single file.

`src/data/registry.ts` is the only module that reads `window.__AICA_DATA__`. At
boot it validates once:

- every manifest key is present and non-empty where required;
- **referential integrity across the data** — every combined case's
  `persona.profile_ref` resolves to a preset, every `journey.scenario_ref`
  resolves to a scenario, every `journey.route_preset_ref` resolves to a route
  preset, every `algorithm_defaults.{trigger,service,content}` resolves to a
  package manifest, and every dataset reference resolves to a catalog.

Failure renders **one** screen listing *every* problem found, instead of letting
41 ops fail mysteriously downstream. The ported registries (`preset_store`,
`driver_profile_store`, `world_seed_store`, `dataset_catalog_registry`,
`scenario_registry`, `package_registry`, route presets) read from this registry
instead of a filesystem.

Two consequences, stated plainly:

- **The hand-copied JSON under `src/data/{packages,routes,scenarios}/` and its
  `index.ts` files are deleted.** That copy is the drift this seam exists to
  remove; leaving it would defeat the purpose. Five existing tests import those
  modules directly (`data.test.ts`, `route_presets.test.ts`, `nri_port.test.ts`,
  `hybrid_port.test.ts`, `client_run_loop.test.ts`) and are migrated onto the
  registry as part of C0 — `DEFAULT_SCENARIOS` / `DEFAULT_PACKAGES` become
  registry lookups.
- **The `builtin_js_module` algorithm ports stay in `src/`, not `data/`.** The
  boundary is: manifests, parameters, hyperparameters, presets, cases, profiles,
  seeds, catalog = data; executable algorithm code = source. Retuning a
  hyperparameter default is therefore a data change; changing the maths is a code
  change.

**Swapping data on a shipped zip:** `npm run build:data -- --emit-only <dir>`
regenerates `aica-data.js` alone; drop it into the unzipped folder and reload. No
app rebuild, no Node toolchain on the customer's machine.

**Size budgets:** `check-size.mjs` gains separate budgets for data and app so a
growing catalog cannot silently consume the app's headroom. Current figures: app
~450 KB, data ~1.2 MB (the 300-song `catalog.json` is 950 KB of it), cap 3 MB.

## Verification strategy

Layer 0 is the capture rig; layers 1–4 run in CI.

### Layer 0 — capture (committed, offline)

`scripts/gen/capture_modules.py` and `scripts/gen/capture_sessions.py` extend the
scripts P1 committed. They import the `app/api` Python modules **directly** — no
docker, no uvicorn, no `uv` — matching the local Anaconda 3.12 environment where
those are unavailable. `npm run capture-fixtures` regenerates every golden in one
command.

Intentional reference changes follow the P1 rule: regenerate → the PR contains
the fixture diff → review approves code and fixture together.

### Layer 1 — per-module goldens

Each ported service function gets an `{input, output}` golden table, exercised
over the real committed data. When something drifts, the failure names the
function rather than requiring a bisect.

### Layer 2 — full-session transcripts (the headline gate)

Each of the 6 combined test cases is driven through the real Python router
functions across its full arc — plan → quickview → create → N ticks → proposal
actions → accept-rest → recovery → complete → read log → read review feedback —
and emitted as an ordered `{op, params, response}` transcript. `tests/contract_parity.test.ts`
replays each transcript through `router.ts` on `InProcessTransport` +
`fake-indexeddb`.

Comparison reuses P1's `expectParity`: exact on discrete fields (decisions,
bands, event kinds, ranks, service and content ids, ordering), `1e-9` tolerance
on continuous state, and a documented allowlist normalising generated ids and
timestamps.

### Layer 3 — algorithm conformance

All four builtin algorithms get tick-by-tick / candidate-by-candidate goldens
regenerated from the current Python, extending the pattern already established by
`hybrid_port.test.ts` and `nri_port.test.ts`.

### Layer 4 — Playwright smoke

The built artifact is opened in **both** modes — served over `http://` (true
worker) and `file://` (in-process fallback) — asserting: the Combined tab
renders, case C-01 runs to completion, the service and content proposal cards
appear, the review column populates, and the evidence log has the expected event
count. This protects the ~15.6k LOC of verbatim-synced `.tsx`.

### Named divergence hazards

These are where hand-ports break silently and inspection does not catch them.
Each becomes an explicit rule in the implementation plan and a checklist item in
review:

1. Python `round()` is banker's rounding; JS `Math.round()` is half-up. Use an
   explicit `roundHalfEven` helper everywhere Python `round()` appears.
2. Python `sorted()` on tuples compares lexicographically. Use explicit tuple
   comparators, never a bare `.sort()`.
3. Python `//` and `%` floor toward −∞; JS `/` with `Math.trunc` and `%`
   truncate toward zero. Negative operands diverge.
4. Dict merge and iteration order must be preserved deliberately wherever a
   `**merge` feeds ordered output.
5. Float-to-string formatting differs between the languages. Parity compares
   **parsed numbers**, never serialized JSON strings.
6. **`sum()` over floats is compensated in CPython 3.12+, and naive in JS.**
   Added during C1 after the hybrid-trigger port hit it. CPython's `sum()` uses
   Neumaier compensated summation for floats; a left-to-right JS `reduce` or
   `+=` loop does not, and the two disagree in the last bits. That is not
   cosmetic: in `aica_transparent_hybrid_trigger_v1`, summing eight contribution
   rows gave `0.21983749999999996` naively versus `0.2198375` compensated,
   which flipped a `> score` comparison and with it the `clamped` flag in the
   output. Any TS port summing a list of floats that later feeds a comparison
   must use a `neumaierSum` helper, not `reduce`. Expect this in C2's selector
   scoring and C3's explanation builders, which sum contribution rows the same
   way.

The parity goldens catch these only where the fixture happens to exercise the
divergent value — hazard 6 was caught because one tick landed near a threshold.
Treat the list as a checklist to apply deliberately, not as something the tests
will find for you.

### Ported-to-green is not evidence: the unexercised-branch pattern

C1 found the same defect shape three times, in code that was fully green:
`runsRestSpots` shipped without Python's `reachable_fallback`; and both
`runsRestSpots` and `pickPreviewRestSpot` implemented only the second stage of
Python's two-stage `_REST_SPOTS_MIN_AHEAD_KM` selection. In every case the port
implemented the **simple branch** of a two-branch Python behaviour, and no
fixture discriminated — because the captured routes and scenarios had too little
variety to reach the other branch. The suite was green and the offline build was
offering a fatigued driver a different rest stop than the real product.

The rest-spot examples are safety-adjacent, which makes them easy to care about;
the pattern itself is not confined to rest spots, and C2's selectors, C3's
explanation builders and C4's merged coordinator all contain the same kind of
conditional structure.

**Requirement for C2 onward.** Passing the golden is necessary, not sufficient.
Every ported module gets a deliberate read against its Python asking *"is there a
branch here my fixture never reaches?"* — and where the answer is yes, a
discriminating capture must be authored before the port is considered done. The
port task's report must state, per module, which Python branches the golden
actually exercises and which it does not.

## Error handling

- `algorithm_error` remains an **event, never a faked decision**. The handler
  returns the error-shaped response with `paused` set, exactly as the Python
  router does, and the engine records the event.
- Proposal and merged `HTTPException` bodies are carried as
  `RpcError { type, message, … }`, preserving each endpoint's error shape so the
  synced UI's existing error paths work unchanged.
- Data-registry validation failure at boot renders one screen listing every
  problem — a deliberate fail-fast rather than 41 ops failing obscurely.
- A Gemini Nano failure resolves to `status:'error'` and the panel falls back to
  the deterministic template, exactly as `useExplanation` already does.
- A worker crash or unhandled rejection rejects the pending `transport.call` as a
  structured `RpcError`; transport downgrade to in-process is logged once.

## Invariants preserved

- **Engine is source of truth** — now including the proposal, explanation and
  merged engines. Components import only `api/*`.
- **Append-only evidence** — `appendEvent()` remains the sole write path to
  `run_events`; merged runs, proposal runs and review feedback follow the same
  discipline in their new stores.
- **Deterministic tick engine** — seeded PRNG only, no `Date.now()` in the tick
  loop. Id generation (time + random) stays outside it, using P1's
  collision-resistant scheme.
- **Setup-time immutability** — parameters and hyperparameters cannot be mutated
  after a run starts, except the fields `expert_override` allows.
- **Binning before decision logic** — no concrete numeric drives a trigger.
- **Maps key** — passed as an op param, never stored in the worker or IndexedDB,
  excluded from every export. Goldens are captured on the local-route path only,
  so a key cannot leak into a committed fixture. The pre-seeded build-config key
  (git-ignored `config.ts`) is unchanged and remains the one documented,
  deliberate divergence.

## Slices

Strictly linear, as bottom-up sequencing requires. Each slice leaves the repo
green and is merged before the next begins.

| Slice | Content | Gate |
|---|---|---|
| **C0 — Data seam + sync repair** | `data.manifest.mjs`, `build:data`, `src/data/registry.ts` with shape + referential validation, delete hand-copied `src/data` JSON, `prebuild` wiring, split size budgets; **repair `sync-from-app.mjs`** (add `lib` to `DIRS`; exclude `components/review` + `state/reviewStore.tsx`); **migrate the five tests that import `src/data/*`** — `data.test.ts`, `route_presets.test.ts`, `nri_port.test.ts`, `hybrid_port.test.ts`, `client_run_loop.test.ts` — onto the registry | existing trigger suite still green; `npm run sync` passes `tsc` again; new registry tests |
| **C1 — Algorithms** | **first: re-enable the three parity tests C0 pinned (see below)**; refresh `aica_transparent_hybrid_trigger_v1` and `nri_fatigue_score_v1`; add `aica_transparent_service_selector_v1` and `aica_transparent_content_selector_v1` | layer-3 conformance goldens, **and the three pinned tests green** |
| **C2 — Proposal engine** | `engine/proposal/*`; 4 `proposal.*` ops + handler | layer-1 goldens |
| **C3 — Explanation layer** | `engine/explanation/*`; `provider:'backend'` removed | layer-1 goldens |
| **C4 — Merged layer** | `engine/merged/*`; 14 `merged.*` ops + handler; IndexedDB stores for merged runs, proposal runs and review feedback | **layer-2 transcripts, all 6 cases** |
| **C5 — UI + shell** | lift sync exclusions; `mergedClient`/`proposalClient` dispatchers; `ENABLED_MODES=['merged']` tab bar; language bridges | `tsc` gate, component tests, layer-4 Playwright |
| **C6 — Packaging** | data/app size budgets, zip, `build:customer` guard, customer README | build gates |

Dependencies are C0 → C1 → C2 → C3 → C4 → C5 → C6. C1 depends on C0 because
algorithm manifests come from data; C2 depends on C1 for selector dispatch.

### Known temporary state: three parity tests pinned from C0 to C1

C0's cutover to live data exposed a drift that had been concealing itself. The
htmlapp's hand-copied `nri_fatigue_score_v1` manifest carried
`threshold_fire: 80.0` and no `threshold_monotony`; the real manifest carries
`100.0` and `threshold_monotony: 60.0` after feature 025. The golden fixtures had
been captured against the same stale values, so both sides agreed and the drift
was invisible. Reading live data made them disagree.

Regenerating the fixtures does **not** resolve it: `nri_fatigue_score_v1.ts` has
no `threshold_monotony` logic at all, while the Python implements a three-band
ladder (`rest_required` / `monotony_prevention` / neither), so the port would
diverge behaviourally instead of numerically. The fix is the C1 port refresh.

Three tests are therefore skipped at the end of C0, each carrying a
`PINNED-TO-C1` comment pointing at this section:

- `tests/client_run_loop.test.ts` — tick-by-tick NRI parity (42 ticks vs 36)
- `tests/preview.test.ts` — `runPreview` parity (fire at tick 17 vs 15)
- `tests/contract_parity.test.ts` — transcript replay (12 hyperparameter keys vs 11)

**C1's first task is to re-enable all three.** They are the acceptance signal for
the NRI refresh, not incidental cleanup:
`grep -rn "PINNED-TO-C1" htmlapp/frontend/tests` must return nothing when C1 completes.

This is also the first hard evidence for this ADR's staleness claim — the offline
build was computing trigger decisions from a manifest a feature behind the docker
app, and nothing in the repo could have told us.

## Risks & mitigations

- **Hand-port drift across 10k LOC.** The whole verification strategy exists for
  this. The named divergence hazards above are the specific failure modes;
  layer-1 goldens localise them and layer-2 transcripts catch composition bugs.
- **Algorithm ports going stale again.** This already happened — the current
  ports are three features behind. Mitigation: layer-3 conformance goldens are
  regenerated by the same one-command capture as everything else, so staleness
  fails a test instead of shipping silently.
- **Preset/case data churn.** Data changes retune outputs, so goldens move. The
  data seam means no code changes; the capture rig means one command; the review
  rule means code and fixture are approved together.
- **`sync-from-app.mjs` breaking on newly-synced components.** The `tsc --noEmit`
  gate P1 added already fails the sync loudly. The shrunken exclusion list is
  still echoed on every run.
- **Bundle size.** Data (~1.2 MB) now dominates the app (~450 KB). Split budgets
  make which one grew visible; the multi-file default build has headroom under
  the 3 MB cap, and the single-file target stays viable.
- **Structured-clone violations** across the worker boundary as richer proposal
  payloads cross it. Contract parity runs the router in-process; the existing
  worker round-trip smoke asserts payloads clone cleanly, so a non-cloneable
  value fails fast.
- **Scope creep back into the Proposal screen.** Bounded by the 4-op
  `proposal.*` surface: anything the Combined UI does not call is not ported.

## Out of scope

- The Trigger and Proposal screens as shipped surfaces.
- Any modification to `app/frontend/` or `app/api/`.
- Ollama / `provider:'backend'` narration.
- Live-stack (docker/uvicorn/`uv`) dependency at test time.
- Pyodide/WASM, Electron/Tauri, multi-user/cloud sync.
- SharedArrayBuffer / cross-thread shared memory (unavailable at `file://`).
- Adversarial sandboxing of user `js_module` packages.
