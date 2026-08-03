# HTMLApp Combined Export — C2: Proposal Engine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the proposal engine to TypeScript behind the P1 worker/RPC seam — the stores, eligibility, selector dispatch, run manager and journey engine — plus the four `proposal.*` ops the Combined screen calls.

**Architecture:** New `src/engine/proposal/` modules, called by new `engine/worker/handlers/proposal.ts`. The five directory-scanning registries in Python become **thin adapters over C0's data registry** (`src/data/registry.ts`), not re-implementations — the data is already loaded and validated. Proposal runs persist to IndexedDB the way trigger runs already do. The two selector algorithms are already ported (C1) and dispatched through `BUILTIN_EVALUATORS`.

**Tech Stack:** TypeScript 5.8, Vitest 1.6, `idb`, Python 3.12 for capture. No new dependencies.

## Global Constraints

- **No new runtime or dev dependencies.**
- **The Python is the behaviour of record.** Never edit `packages/`, `app/api/`, or `app/frontend/`. If port and Python disagree, the port is wrong. If you believe the Python is wrong, stop and report.
- **Never edit a golden** to make a port pass. Goldens are captured from Python.
- No changes under `src/components/**` (synced from `app/frontend`).
- Reuse, do not rewrite: `src/data/packages/builtin/mathUtils.ts` holds `neumaierSum` and `pyFixed`. `src/data/packages/validate.ts` holds `isProposalFamilyManifest`.
- Capture rig: `PYTHONPATH=app/api app/api/.venv/bin/python htmlapp/frontend/scripts/gen/capture_all.py` from the repo root. Deterministic — a re-run leaves `git status` clean.
- `grep -rn "PINNED-TO-C1" htmlapp/frontend/tests` must keep returning nothing.
- Run npm commands from `htmlapp/frontend/`. Verify with `npm test` and `npm run typecheck`.
- **Report the single-file build size in every task.** `build:singlefile` is now the customer deliverable against a hard 3 MB cap (owner decision, 2026-08-01); it was 1.41 MB at the end of C1. A material jump is a finding.

### The seven divergence hazards — apply deliberately, per module

1. `round()` — banker's in Python, half-up in JS.
2. `sorted()` on tuples compares lexicographically — explicit comparators, never a bare `.sort()`.
3. `//` and `%` floor toward −∞ in Python, truncate toward zero in JS.
4. Dict merge/iteration order where it feeds ordered output.
5. Float→string formatting; explanation strings are compared character-exactly.
6. **`sum()` over floats is Neumaier-compensated in CPython 3.12** — use `neumaierSum` where a float list is summed then compared.
7. **`toFixed` is not `:.Nf`** — use `pyFixed` at every Python format-spec site, and only there.

Every task reports, per hazard, either the triggering Python lines and how it was handled, or "not present" with the evidence checked. **Run any grep you cite.**

### Branch coverage — mandatory

C1 found four cases where a port passed its golden and still diverged, because no fixture reached the other branch. Passing a golden is necessary, **not sufficient**.

Every task's report must contain a **per-branch coverage table** stating, for each significant Python branch, whether the golden exercises it. Where a branch is reachable by varying an input, **add a case** rather than listing it unverified. Cover raise/error paths with direct assertions in a validation test file, labelled as TS-logic tests, not parity. Where a case exercises a branch but produces output identical to a neighbour, say so explicitly — that is a legitimate "regression-protected but not eyeball-provable" state, not ordinary coverage.

---

### Task 1: Registry-backed stores and the four `proposal.*` ops

Python scans directories; htmlapp already has the same data loaded and validated by C0's registry. These are **adapters**, not ports — resist re-implementing the scanning.

**Files:**
- Create: `src/engine/proposal/stores.ts`, `src/engine/worker/handlers/proposal.ts`
- Modify: `src/api/rpc.ts` (add the four ops), `src/engine/worker/router.ts`
- Test: `tests/proposal_stores.test.ts`
- Reference (read, never edit): `services/preset_store.py`, `services/dataset_catalog_registry.py`, `services/driver_profile_store.py`, `services/world_seed_store.py`, `services/proposal_package_registry.py`

**Interfaces produced:**
- `presetStore.listSummaries()`, `presetStore.get(id)`
- `datasetCatalogRegistry.listDatasets()`, `.getCatalog(id)`, `.getProvenance(id)`
- `driverProfileStore.listProfiles()`, `.getProfile(id)`, `.saveProfile(label, profile)`, `.deleteProfile(id)`
- `worldSeedStore.listSeeds()`, `.getSeed(id)`
- `proposalPackageRegistry.listSummaries()`, `.get(id)`, `.listSlots()`
- RpcOps: `proposal.presets.list`, `proposal.presets.get`, `proposal.packages.list`, `proposal.catalog.get`

- [ ] **Step 1: Read the five Python modules and map each public method to a C0 registry accessor.** Put the mapping table in your report before coding. `src/data/registry.ts` already exposes `getPresets/getPreset`, `getProfiles/getProfile`, `getSeeds/getSeed`, `getPackageManifests`, `getDatasetIds/getDataset`.

- [ ] **Step 2: Note the two places this is NOT a pure adapter**, and handle each deliberately:
  - `DriverProfileStore.save_profile` / `delete_profile` **write**. C0's registry is read-only. User-created profiles must persist to IndexedDB, alongside the existing package/scenario stores in `src/storage/`. Builtin profiles come from the registry and must not be deletable — mirror Python's behaviour exactly.
  - `ProposalPackageRegistry` selects the **inverse** set to the trigger registry: manifests that *do* declare `kind`/`family`. `isProposalFamilyManifest` already exists in `src/data/packages/validate.ts` — reuse it. Check whether Python validates these against a different model (`ProposalPackageManifest`) with different required fields, and mirror what it actually rejects.

- [ ] **Step 3: Write failing tests**, then implement, then confirm they pass. Assert against properties (which ids appear, which are rejected and why), not counts — the data churns by design.

- [ ] **Step 4: Wire the four ops** into `rpc.ts` and `router.ts`, following the existing handler pattern. Each op mirrors the FastAPI endpoint in `routers/proposal.py` — match its response shape exactly, including the `errors` array where Python returns one.

- [ ] **Step 5: Verify** — `npm test`, `npm run typecheck`, capture re-run clean, single-file size reported. Commit.

---

### Task 2: Eligibility, algorithm config, world overrides and validation

Four self-contained pure modules. Good candidates for tight per-module goldens.

**Files:**
- Create: `src/engine/proposal/eligibility.ts`, `src/engine/proposal/algorithm_config.ts`, `src/engine/proposal/world_overrides.ts`, `src/engine/proposal/world_validation.ts`
- Modify: `scripts/gen/capture_all.py` (add per-module captures)
- Test: `tests/proposal_eligibility_port.test.ts`, `tests/proposal_world_port.test.ts`
- Reference: `services/proposal_eligibility.py` (`resolve_eligibility`, `derive_registered_entities`), `services/algorithm_config.py` (`merge_algorithm_config`), `services/world_clone_store.py` (`apply_overrides`, `InvalidOverrideError`), `services/world_validation.py` (`validate_world`, `ValidationIssue`)

- [ ] **Step 1** — enumerate each module's contract; report before coding.
- [ ] **Step 2** — add captures driven from committed data under `proposal_contracts/`; list each case and what it is for.
- [ ] **Step 3** — write the failing conformance tests; confirm they fail because the modules do not exist.
- [ ] **Step 4** — port, mirroring the Python's decomposition.
- [ ] **Step 5** — branch-coverage pass. `resolve_eligibility` and `validate_world` are rule engines: enumerate every rule and prove each is reached, or add a case. `apply_overrides` raises `InvalidOverrideError` — cover those paths with direct assertions.
- [ ] **Step 6** — verify and commit.

---

### Task 3: Selector dispatch

Wires C1's two ported selector algorithms into the engine, and normalises their output and errors the way Python does.

**Files:**
- Create: `src/engine/proposal/selector.ts`
- Modify: `scripts/gen/capture_all.py`
- Test: `tests/proposal_selector_port.test.ts`
- Reference: `services/proposal_selector.py` — `dispatch_selector`, `_load_evaluate`, `_output_model_for_family`, `_step_for_family`, `_error_evidence`

- [ ] **Step 1** — enumerate the contract. Note especially how `_error_evidence` shapes a failed selector call: the project invariant is that **algorithm failures are events, never disguised as normal decisions**. Confirm what Python emits and mirror it exactly.
- [ ] **Step 2** — dispatch resolves a package id to an `evaluate` function. In htmlapp that is `BUILTIN_EVALUATORS`, not a filesystem import. Mirror Python's *behaviour* (which family maps to which output model and step), not its module-loading mechanism.
- [ ] **Step 3** — capture, failing test, port, verify.
- [ ] **Step 4** — branch coverage: both families (service, content), the error path, and an unknown/unported package id. The error path especially — cover it with direct assertions.
- [ ] **Step 5** — commit.

---

### Task 4: Proposal run manager and its IndexedDB store

**Files:**
- Create: `src/engine/proposal/run_manager.ts`, `src/storage/proposal_runs_store.ts`
- Modify: `src/storage/db.ts` (new object stores; bump `DB_VERSION` and add an upgrade path)
- Test: `tests/proposal_run_manager.test.ts`
- Reference: `services/proposal_run_manager.py` — `create_run`, `get_run`, `list_runs`, `delete_run`, `append_event`, `append_evidence`, `append_explanation`, `update_state`

- [ ] **Step 1** — enumerate the contract and the persisted shape.
- [ ] **Step 2** — **the append-only invariant is load-bearing.** Trigger runs already enforce it: `appendEvent()` is the sole write path to `run_events`, with no `put`/`delete` outside `deleteRun`. Mirror that discipline for proposal runs, and add a test that proves it — an append-only store with no test asserting append-only is not append-only.
- [ ] **Step 3** — `DB_VERSION` is currently 1. Bump it and write the upgrade path. **Add a test that an existing v1 database upgrades without data loss** — a user with an in-progress run must not lose it on update.
- [ ] **Step 4** — `_make_run_id` uses time and randomness. Follow P1's collision-resistant scheme (`run_<YYYYMMDD-HHMMSS>_<6hex>`); ids are normalised by the parity helper, so this does not disturb goldens. Keep id generation outside any tick loop — the determinism invariant.
- [ ] **Step 5** — capture, failing test, port, verify, commit.

---

### Task 5: The journey engine

The largest module in this slice (~925 LOC): twelve journey actions plus the state machine that sequences them.

**Files:**
- Create: `src/engine/proposal/journey.ts`, `src/engine/proposal/journey_preview.ts`
- Modify: `scripts/gen/capture_all.py`
- Test: `tests/proposal_journey_port.test.ts`, `tests/proposal_journey_validation.test.ts`
- Reference: `services/proposal_journey.py` (`apply_action` and its twelve handlers), `services/proposal_journey_preview.py` (`preview`)

- [ ] **Step 1: Enumerate all twelve actions and the state machine.** `_reject_service`, `_choose_another`, `_request_more`, `_postpone`, `_accept`, `_complete`, `_continue`, `_stop`, `_motion_change`, `_rest_spot_arrived`, `_rest_started`, `_rest_completed`, plus `_not_yet_implemented`. For each: what state it requires, what it transitions to, and what it rejects. **This table is the artefact the reviewer checks the port against** — write it before any code.

- [ ] **Step 2: Capture one golden per action**, driven from committed data. An action whose golden only shows the happy path leaves its rejection branch unverified — `_reject` is called throughout, so cover the rejections too.

- [ ] **Step 3: Write the failing conformance test**, then port, mirroring Python's decomposition handler-for-handler.

- [ ] **Step 4: Branch coverage is the substance here.** Twelve handlers with guards each. Your table must show, per handler, which guard branches the goldens reach. Add cases for reachable ones; use direct assertions for rejections.

- [ ] **Step 5** — verify and commit.

---

### Task 6: C2 acceptance

- [x] **Step 1: Clean-state verification.** `rm -rf data public/aica-data.js dist`, then `npm run build:data && npm test && npm run typecheck && npm run build && npm run build:singlefile`. Expect 0 failing, 0 skipped; both builds exit 0. **Report the single-file size against the 3 MB cap.**
- [x] **Step 2: Capture reproducibility** — re-run the rig, `git status` clean.
- [x] **Step 3: Port boundary** — `git diff --stat $(git merge-base develop HEAD)..HEAD -- app/ packages/` must be empty.
- [x] **Step 4: Independent spot-check** — pick one ported module, re-run its Python directly against one golden input, and compare field-by-field. This checks the *capture* is honest, not just that the TS matches it.
- [x] **Step 5: Append-only proof** — confirm the proposal-run store has no write path other than append, by reading the code and by the test from Task 4.
- [x] **Step 6** — tick the plan's checkboxes and commit, only if every check passed.

---

## Self-Review

**Spec coverage.** Against the ADR's C2 row — `engine/proposal/*` plus the four `proposal.*` ops: stores (T1), eligibility/config/overrides/validation (T2), selector dispatch (T3), run manager (T4), journey and preview (T5), acceptance (T6). Covered.

**Deliberate structure.** T1 is framed as *adapters* rather than ports because C0's registry already holds and validates the data these five Python classes scan for; re-implementing directory scanning would add a second source of truth for data the seam exists to own. The two genuine exceptions — profile writes, and the inverse family filter — are called out explicitly so they are not glossed.

**Why no embedded target code.** As in C1, the authoritative source is the Python; transcribing ~2,600 lines into the plan would create a second copy to drift. Each task names the source, the target, the golden that judges it, the hazards, and requires an enumerated contract as a report artefact before coding. Test-first discipline is preserved: every port task writes a failing conformance test before implementing.

**Type consistency.** Store accessors are camelCase mirrors of the Python method names. `dispatch_selector` → `dispatchSelector`, `apply_action` → `applyAction`, `resolve_eligibility` → `resolveEligibility`, `validate_world` → `validateWorld`, `merge_algorithm_config` → `mergeAlgorithmConfig`, `apply_overrides` → `applyOverrides`. Proposal run persistence follows the existing `src/storage/*_store.ts` naming.
