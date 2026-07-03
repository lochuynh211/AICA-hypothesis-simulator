# Tasks: Signal-Tier Re-design & Clean Setup Screen

**Feature**: `009-signal-tier-redesign` | **Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

**TDD**: Requested — contract-surface tests are written before their implementation (Constitution
workflow gate). **Scope**: backend (`app/api`) + primary frontend (`app/frontend`); htmlapp deferred.
This is a **deliberately behavior-changing** re-design; backend baselines are regenerated on purpose.

**Legend**: `[P]` = parallelizable (different files, no incomplete deps). `[USn]` = serves user story n.

---

## Phase 1: Setup

- [ ] T001 [P] Scaffold new backend modules: create empty `app/api/aica_api/services/prng.py` and `app/api/aica_api/services/behavior/anomaly_signal.py`; `git mv app/api/aica_api/services/behavior/driver_model.py app/api/aica_api/services/behavior/driver_signals.py`; `git rm app/api/aica_api/services/behavior/vehicle_model.py`
- [ ] T002 [P] Scaffold frontend setup tree: create `app/frontend/src/components/setup/{SignalsPanel,AlgorithmFormulationPanel,InstantResultStrip,SignalInfoPopover}.tsx` as empty components and matching empty test files under `app/frontend/tests/`

---

## Phase 2: Foundational (BLOCKING — shared by all user stories)

The backend signal-tier core. No user story can be demonstrated until this phase is complete.

### Seeded PRNG (determinism spine)

- [ ] T003 [P] Contract test for the seeded PRNG (stable cross-process hash; same `(seed,tick,channel)` → same value) in `app/api/tests/test_prng.py` (per `contracts/anomaly-generator.md` determinism clause)
- [ ] T004 Implement `seeded_uniform(run_seed, tick, channel)` and `rng(...)` using a stable hash (not builtin salted `hash()`) in `app/api/aica_api/services/prng.py`

### Anomaly signal generator

- [ ] T005 [P] Contract test for `advance_anomaly` (determinism across processes, monotonic rate vs drowsiness, `is_moving=False` → no spikes, `window_min` prune) in `app/api/tests/test_anomaly_signal.py` (per `contracts/anomaly-generator.md`)
- [ ] T006 Implement `advance_anomaly` (inhomogeneous-Poisson per-tick Bernoulli + rolling window) in `app/api/aica_api/services/behavior/anomaly_signal.py`

### Driver signals (drowsiness/fatigue only)

- [ ] T007 [P] Test `driver_signals` produces `drowsiness`/`fatigue` and **no** `attention`; recovery reduces both, in `app/api/tests/test_driver_signals.py`
- [ ] T008 Refactor `driver_signals.py` (renamed): remove attention model + `attention` output; keep drowsiness/fatigue growth + recovery

### Models: profiles, scenario schema, run config

- [ ] T009 [P] Test scenario loader accepts the new shape and **rejects old-shape** (`driver_profile`/`vehicle_profile`) with a clear "incompatible — re-author" error, in `app/api/tests/test_scenario_schema.py`
- [ ] T010 Update `app/api/aica_api/models/profile.py`: rename `DriverModelProfile`→`DriverSignalParams` (drop attention model), add `AnomalySignalParams` (`lambda_base, lambda_gain, theta, window_min`), delete vehicle-profile models
- [ ] T011 Update `app/api/aica_api/models/scenario.py`: add `driver_signal_params`, `anomaly_signal_params`, `run_seed_default`; remove `driver_profile`/`vehicle_profile`/`initial_state.drowsiness_level`; reject old shape (FR-017)
- [ ] T012 Update `app/api/aica_api/models/run.py`: add `RunConfig.run_seed`; change `TickState` to carry tiered signals and drop removed keys

### Tick engine → tiered signals + anomaly

- [ ] T013 [P] Test `tick_engine` emits the three tier groups, contains **none** of the removed keys, and invokes the anomaly generator, in `app/api/tests/test_tick_engine.py` (update existing)
- [ ] T014 Update `app/api/aica_api/services/tick_engine.py`: build tiered signals, call `advance_anomaly` (thread its window state), drop all vehicle-model calls, thread `run_seed`
- [ ] T015 Update `app/api/aica_api/services/binning.py`: keep route boundary-binning for `feature_groups`; remove steering/pedal derivations and any removed-key output
- [ ] T016 Update `app/api/aica_api/services/event_plan.py`: freeze `run_seed` into the event plan at run start

### Tiered adapter context + manifest-single-source defaults

- [ ] T017 [P] Contract test: tiered context shape (`signals.{fixed,dynamic,simulated}`), removed keys absent, `hyperparameters` = manifest-defaults ⊕ overrides, in `app/api/tests/test_tiered_context.py` (per `contracts/tiered-context.md`)
- [ ] T018 Update `app/api/aica_api/services/run_manager.py` `build_adapter_context` to emit the tiered `signals` dict (+ preserved `feature_groups`)
- [ ] T019 [P] Test the adapter resolves defaults from the manifest and that a package reading an un-defaulted key fails validation (FR-009), in `app/api/tests/test_adapter_defaults.py`
- [ ] T020 Update `app/api/aica_api/algorithms/adapter.py` + `python_module.py`: merge manifest defaults with overrides, inject resolved `hyperparameters`; remove reliance on algorithm-side fallback defaults

### Compact Hybrid package

- [ ] T021 [P] Rewrite the Hybrid contract test for the compact 8-feature form (features, `driving_anomaly=clamp(anomaly_rate/K)`, `env_load`, scores, unchanged fire-control; no removed inputs), in `app/api/tests/test_transparent_hybrid.py`
- [ ] T022 Rewrite `packages/aica_transparent_hybrid_trigger_v1/algorithm.py` to the compact form (accumulators `jam_min/hw_min/mono_min` in runtime state; read resolved hyperparameters; no `hp.get(default)`)
- [ ] T023 Rewrite `packages/aica_transparent_hybrid_trigger_v1/package.json`: declare features + all hyperparameters (curve params, weights, `K`, thresholds, smoothing) with **single-source defaults**; reference `anomaly_signal_params`

### NRI package (unchanged behavior)

- [ ] T024 [P] Update NRI test to assert unchanged behavior AND that `S_realtime` is **live** (non-zero) when drowsiness/fatigue present, in `app/api/tests/test_nri_fatigue_score.py`
- [ ] T025 Update `packages/nri_fatigue_score_v1/{algorithm.py,package.json}`: read tier-3a `drowsiness`/`fatigue`; move any remaining defaults to the manifest; drop algorithm-side fallbacks

### Scenario rewrite + baseline regeneration

- [ ] T026 [P] Rewrite every shipped scenario in `scenarios/*.json` to the new tiered/param shape (`driver_signal_params`, `anomaly_signal_params`, `run_seed_default`); remove `driver_profile`/`vehicle_profile`
- [ ] T027 Regenerate affected backend behavioral baselines/fixtures across `app/api/tests/**` to reflect the intentional behavior change; annotate the diff as deliberate (FR-018)

**Checkpoint**: backend runs a full scenario end-to-end on the new tiered signals with both packages; `pytest app/api/tests -q` green.

---

## Phase 3: User Story 1 — Instant tuning feedback (Priority: P1) 🎯 MVP

**Goal**: Edit a hyperparameter/signal → see the firing outcome on a static timeline instantly, without a full run.
**Independent test**: change one weight → the instant-result fire marker/result line updates; no run persisted.

- [ ] T028 [P] [US1] Contract test for `POST /runs/preview` — no persistence (runs/ unchanged), faithful to `POST /runs`, deterministic per `(config, seed)`, errors surfaced not faked, old-shape rejected — in `app/api/tests/test_preview_endpoint.py` (per `contracts/ephemeral-evaluate.md`)
- [ ] T029 [US1] Implement the ephemeral evaluate path in `app/api/aica_api/services/run_manager.py`: headless tick loop reusing the adapter, deterministic auto-chosen rest option, **no evidence recorder**, returns `InstantResult` (`data-model.md` §7)
- [ ] T030 [US1] Add `POST /runs/preview` route in `app/api/aica_api/routers/runs.py` (returns `InstantResult`; validation errors → 4xx)
- [ ] T031 [P] [US1] Test `InstantResultStrip` renders score curve + threshold line, fire marker(s), rest/recovery markers, and the explicit "no trigger" state, in `app/frontend/tests/InstantResultStrip.test.tsx`
- [ ] T032 [US1] Implement preview API client + debounced `runPreview()` action + seed state in `app/frontend/src/api/` and `app/frontend/src/state/runStore.ts`
- [ ] T033 [US1] Implement `InstantResultStrip.tsx` (timeline, segment bands, markers, result line, seed chip, "Open full run" → existing persisting `POST /runs`)
- [ ] T034 [US1] Assemble the setup screen container: two editor panels on top + full-width instant-result strip at the bottom, in `app/frontend/src/components/setup/`

**Checkpoint**: US1 independently demonstrable — tune a weight, watch the fire point move; nothing persisted until "Open full run".

---

## Phase 4: User Story 2 — Transparent signals & formulation (Priority: P1)

**Goal**: See all signals grouped by tier (with tier-3 explanations) and the algorithm as its formulation with inline-editable coefficients.
**Independent test**: open setup → signals grouped Fixed/Dynamic/Simulated; simulated ones have ⓘ; features link to signals.

- [ ] T035 [P] [US2] Provide simulated-signal explanation metadata (drowsiness, fatigue, anomaly_rate) via the package/scenario API surface (backend) + a signals-listing endpoint if needed
- [ ] T036 [P] [US2] Test `SignalsPanel` groups by tier, marks editable vs read-only, and shows the info popover content, in `app/frontend/tests/SignalsPanel.test.tsx`
- [ ] T037 [US2] Implement `SignalsPanel.tsx` + `SignalInfoPopover.tsx` (tier grouping, ✎/read-only affordances, ⓘ popover)
- [ ] T038 [P] [US2] Test `AlgorithmFormulationPanel` renders formulas with inline editable coefficients and feature→signal cross-links, in `app/frontend/tests/AlgorithmFormulationPanel.test.tsx`
- [ ] T039 [US2] Implement `AlgorithmFormulationPanel.tsx` (render the algorithm's formulation from the manifest; hyperparameters as inline `[coefficient]` inputs; feature names cross-link to `SignalsPanel`)

**Checkpoint**: US2 independently demonstrable — the setup screen is fully legible and editable in-formula.

---

## Phase 5: User Story 3 — Honesty & reproducibility (Priority: P2)

**Goal**: Reproducible runs, seeded anomaly, and an accurate changed-from-default overrides view.
**Independent test**: same setup+seed twice → identical result; overrides view shows only changed knobs.

- [ ] T040 [P] [US3] Integration test: identical `RunConfig`+`run_seed` → identical `InstantResult` and identical persisted trace (byte-level), in `app/api/tests/test_determinism.py`
- [ ] T041 [P] [US3] Test the overrides diff (only changed-from-default keys, correct default/value pairs) — backend resolution + frontend display
- [ ] T042 [US3] Implement overrides-diff surfacing: backend exposes resolved defaults; frontend computes + renders the overrides chip and "reset to default"
- [ ] T043 [US3] Implement seed control + 🎲 re-roll in the setup screen; assert re-roll changes the anomaly pattern deterministically under the new seed

**Checkpoint**: US3 independently verifiable — reproducibility and overrides transparency hold.

---

## Phase 6: User Story 4 — Two-algorithm comparison (Priority: P3)

**Goal**: Both algorithms consume the same shared signal set and run on the same scenario.
**Independent test**: run Hybrid and NRI on one scenario; both draw from the shared signals; NRI realtime term live.

- [ ] T044 [P] [US4] Integration test: Hybrid and NRI both complete on the same scenario reading the same tiered signals; NRI `S_realtime` non-zero, in `app/api/tests/test_algorithm_parity_contract.py`
- [ ] T045 [US4] Confirm both packages appear in the setup package selector and the preview/run path works for each; fix any registry/selector gaps

---

## Phase 7: Polish & Cross-Cutting

- [ ] T046 [P] Update master docs `docs/master/*` (architecture/spec/runtime-workflow) to describe the 3-tier signal model, simulated signals, and the seeded anomaly generator; note attention/sensors/look-ahead deferrals
- [ ] T047 [P] Update Spec Kit memory/constitution notes if any principle wording needs alignment (e.g. simulated-signal vocabulary); otherwise record no-change
- [ ] T048 Run full `pytest app/api/tests -q` and `npm test` in `app/frontend`; fix regressions; verify SC-001..SC-008
- [ ] T049 [P] Execute `specs/009-signal-tier-redesign/quickstart.md` end-to-end (preview determinism, no-persistence, both algorithms)
- [ ] T050 `docker compose up` smoke: setup screen → instant preview → Open full run → animated review works

---

## Dependencies & Execution Order

- **Phase 1 (Setup)** → **Phase 2 (Foundational, BLOCKING)** → **Phase 3 US1** → Phase 4 US2 → Phase 5 US3 → Phase 6 US4 → **Phase 7 Polish**.
- Within Phase 2, the dependency spine is: PRNG (T003–T004) → anomaly generator (T005–T006) → tick engine (T013–T016) → tiered context (T017–T018) + adapter defaults (T019–T020) → packages (T021–T025) → scenarios + baselines (T026–T027). Model changes (T009–T012) precede tick-engine/context work.
- US1 depends on Foundational (needs a working tiered run + a re-designed package to preview).
- US2/US3/US4 depend on Foundational; US3's determinism test depends on the anomaly generator; US4 depends on both packages (T021–T025).
- Tests precede their implementation within each area (TDD).

## Parallel Opportunities

- **Setup**: T001 ‖ T002.
- **Foundational tests** (independent files) can be authored in parallel before their impls: T003 ‖ T005 ‖ T007 ‖ T009 ‖ T013 ‖ T017 ‖ T019 ‖ T021 ‖ T024.
- **Frontend vs backend** within US1: T031 (frontend test) ‖ T028 (backend test).
- **US2**: T036 ‖ T038 (component tests); T035 (backend metadata) ‖ frontend tasks.
- **Polish**: T046 ‖ T047 ‖ T049.

## Implementation Strategy

- **MVP = Phase 1 + Phase 2 + Phase 3 (US1)** — the backend re-design plus the instant-result preview: the headline value (tune → observe). Ships an independently demonstrable slice.
- Then layer US2 (transparency UI), US3 (reproducibility surfacing), US4 (comparison), Polish.
- Keep the project runnable at each checkpoint (Constitution: every milestone runnable).

## Task Count

- Total: **50** (T001–T050)
- Setup: 2 · Foundational: 25 (T003–T027) · US1: 7 · US2: 5 · US3: 4 · US4: 2 · Polish: 5
