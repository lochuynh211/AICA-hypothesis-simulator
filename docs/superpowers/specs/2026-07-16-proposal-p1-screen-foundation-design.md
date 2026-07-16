# P1 — Proposal Screen (4-Panel) & Standalone Run Foundation — Design

**Date:** 2026-07-16
**Milestone:** P1 (per `docs/master/aica_proposal_simulator_milestones.md` §3)
**Branch:** `proposal-p1-screen-foundation` (off `develop`)
**Status:** Approved design → SpecKit chain (Step 3)

Prerequisites P0.5 (415a99b), P6 (5151ed4), P2 (5ebec22) are merged into `develop`. This
milestone is the first *screen + standalone run* foundation; it establishes neutral
contracts, a 4-slot package model, mock selector adapters, proposal-run persistence, and
the standalone 4-panel proposal screen — **before any real ranking, journey engine, or
editable world exists.**

---

## 1. Scope boundary (smallest runnable slice)

P1 delivers **contracts + a screen + a persisted mock flow**. It does **not** implement real
scoring, eligibility narrowing beyond the matrix, journey progression, or LLM packages.

**Demonstration slice:**

1. Open the app → switch to the **Proposal** app (top-level `appMode`) → 4-panel screen in
   Japanese (default).
2. **② Setup:** choose `trigger_purpose` + a compatible `lifecycle_stage`, a mock service
   package, and a mock content package. **① Input** shows the (static) synthetic-world
   summary. Allowed service IDs resolve from the frozen purpose/stage matrix.
3. **Create run** → **STEP 1**: the mock service selector returns ≤3 ranked candidates →
   **③ Service proposal** shows the ranking, rank-1 contributions, provenance badges.
4. **Choose a service** → **STEP 2**: the mock content selector returns one fixed
   `complete_plan` → **④ Content proposal** shows ordered items, mode, duration, lighting,
   policies, excluded examples.
5. The run is persisted to `proposal_runs/`. Open **Proposal Runs** → reopen (renders from the
   log, no recompute) → delete.
6. Toggle back to the **Trigger** app: Setup / Review / Runs are unchanged and functional.

**Explicitly deferred (not P1):** real transparent/LLM scoring (P5 / P6-wiring / P8 / P9),
eligibility narrowing by motion/catalog/schedule (P4), the discrete-event journey engine and
recompute-on-event behavior (P4), the editable synthetic world and catalog (P3). P1 defines
the *neutral contract shapes* for discrete-event / journey-state / algorithm-evidence but
implements **no engine**.

---

## 2. Key decisions (resolved during brainstorming)

| # | Decision | Rationale |
|---|---|---|
| D1 | **Mock both selectors.** Both service and content selectors are mock `python_module` packages returning fixed valid outputs. The real P6 content package stays registered/tested via its own harness but is **not run in the P1 flow.** | P1's acceptance criteria are about proving the boundary is *package-agnostic*. The real P6 package cannot run end-to-end without the P3 world + P4 eligibility; wiring it here would pull that scope forward. |
| D2 | **Top-level `appMode` switch** (`'trigger' \| 'proposal'`) above the existing `viewMode`. Trigger shell/store/screens untouched; Proposal is a sibling shell + isolated store. | Modifies the least *existing, tested* trigger code (a wrapper + a toggle only); produces a self-contained, isolated proposal module that later mounts into the trigger flow. Future trigger↔proposal composition happens at the neutral opportunity contract on the backend, which both FE options support equally. Enforces the "editing proposal setup does not modify trigger setup" invariant structurally. |
| D3 | **Adopt 5 post-rest services** — the `after_rest_before_restart` row includes `call_response_stopped`. | The authoritative service algorithm doc (§2.4 / §5.2.4, Slides 38/40) deliberately lists five. The matrix is the resolved-allowed-set that P5's service selector consumes, so aligning now avoids a matrix version bump at P5. The `ServiceId` enum (frozen in P0.5) already contains it. Eligibility-only under P1 mocks — no ranking risk. Resolves the §17 post-rest divergence. |
| D4 | **New isolated `ProposalPackageManifest` + `ProposalPackageRegistry`;** do not touch the trigger `PackageManifest`/`PackageRegistry`. | The trigger `PackageManifest` is trigger-shaped (hard-requires `features`/`rules`/`fire_control`/`proposals`, list-typed `parameters`) and cannot validate a proposal manifest — it silently drops the P6 content manifest with 19 validation errors today. Isolation invariant: proposal models must not couple to trigger models. |
| D5 | **Separate `proposal_runs/` namespace** + new `ProposalRunManager` reusing the atomic `file_store`. Delete is built new (no delete-run precedent exists in the trigger app). | Keeps proposal evidence isolated from trigger `runs/`; reuses proven atomic-write persistence. |
| D6 | **JA-default scoped to the proposal store** (`uiLanguage` default `'ja'`); the trigger default stays `'en'`. | The milestone introduces JA-default *as a proposal-screen UI convention*; flipping the shared trigger default is out of scope and would be a trigger regression risk. |

---

## 3. Backend contracts (`app/api/aica_api/models/proposal/`)

All new modules live in the **isolated** `models/proposal/` subpackage, which must not import
from `aica_api.models` (the trigger namespace). Enforced by an import-guard test.

**Reused from P0.5 (unchanged):**
- `SelectorInput` — the §5.3 common selector input.
- `CompletePlan` — the §5.4 content-selector output (no aggregate plan score).
- `enums.py` — `TriggerPurpose`, `LifecycleStage`, `ServiceId` (14, incl. `call_response_stopped`),
  `FeatureOriginProvenance`, etc.

**New in P1:**

- **`opportunity.py`** — `ProposalOpportunity`: `opportunity_id`, `trigger_purpose`,
  `lifecycle_stage`, `allowed_service_ids`, `simulation_time`, `run_seed`. Validator: purpose/stage
  compatibility (rest stages only with `rest_recommended`; `active_driving_content` only with the
  three non-rest purposes). Contains **no UI state and no trigger-tick dependency.**
- **`service_output.py`** — `ServiceSelectorOutput` (§5.4 service side): `decision_type`
  (`ranked_candidates` | `no_proposal`), `ranked_candidates` (≤3; each `rank`, `candidate_id`,
  `score`, `rationale`, `supporting_feature_ids`, `opposing_feature_ids`, `uncertainty`),
  `excluded_candidates`, `unused_available_features`, `missing_features`,
  `next_package_runtime_state`, `algorithm_provenance`. Validator: at most 3 ranked candidates.
- **`matrix.py`** — `PurposeStageServiceMatrix` loader/resolver over the frozen versioned artifact
  `proposal_contracts/matrix/purpose_stage_matrix.v1.json` (the six §7.5 rows; post-rest = 5).
  `resolve(purpose, stage) -> allowed_service_ids`. A run freezes the matrix version.
- **`events.py`** — `DiscreteEvent` shape + the §16.1 event-type enum (`TRIGGER_PURPOSE_CHANGED`,
  `CONTENT_COMPLETED`, `REST_SPOT_ARRIVED`, `REST_COMPLETED`, plus the P1 evidence markers
  `OPPORTUNITY_OPENED`, `SERVICE_SELECTED`, `CONTENT_SELECTED`). **Shape only — no engine.**
- **`journey.py`** — `JourneyState`: `lifecycle_stage`, `motion_state`, `active_service_id`,
  `active_plan_id`. **Shape only.**
- **`evidence.py`** — `AlgorithmEvidence`: input snapshot, package id + contract/schema versions,
  the neutral output, `algorithm_provenance`, and used / unused / missing feature ids.
- **`proposal_run.py`** — `ProposalRun` + append-only `ProposalRunLog` (separate namespace from the
  trigger `RunLog`): run + opportunity ids, seed, frozen matrix version, selected service package id,
  selected content package id, an ordered `events` list, and per-evaluation `AlgorithmEvidence`.
- **`package_manifest.py`** — `ProposalPackageManifest`: `id`, `version`, `label` (`{ja,en}`),
  `family` (`service_selector` | `content_selector`), `approach` (`transparent` | `constrained_llm`),
  `contract_version`, `algorithm` (`python_module`, `entrypoint`, `error_mode`), and kind-specific
  fields (`supported_services` for content). `ProposalPackageFamilySlot` enumerates the four slots.

---

## 4. Package families & registry (the four slots)

- **`services/proposal_package_registry.py`** (`ProposalPackageRegistry`, isolated): scans
  `packages/*/package.json` for manifests declaring `family ∈ {service_selector, content_selector}`,
  validates each against `ProposalPackageManifest`, indexes by id, and reports invalid ones in an
  errors list (never partially used).
- **The four slots** = `{service_selector, content_selector} × {transparent, constrained_llm}`,
  enumerated as a constant. **Compatibility validation** = a package's declared `(family, approach)`
  is a known slot **and** its manifest conforms to that family's required contract. A content package
  cannot fill a service slot and vice-versa.
- P1 fills the two **transparent** slots with the mock packages; the two `constrained_llm` slots are
  declared-but-empty (P8/P9 populate them).
- The trigger `PackageRegistry` / `PackageManifest` are **untouched**. The real
  `aica_transparent_content_selector_v1` package remains registered and tested through its own
  direct-import harness; it is not invoked by the P1 flow.

---

## 5. Mock selectors & the selector-invocation boundary

- **`packages/mock_service_selector_v1/`** — `package.json` (`family: service_selector`,
  `approach: transparent`, `python_module`) + `algorithm.py` with `def evaluate(context: dict) -> dict`
  returning a **fixed valid** `ServiceSelectorOutput` (≤3 ranked candidates drawn from
  `allowed_service_ids`, with placeholder rationale/contributions).
- **`packages/mock_content_selector_v1/`** — `package.json` (`family: content_selector`,
  `approach: transparent`, `supported_services`) + `algorithm.py` returning a **fixed valid**
  `CompletePlan` (ordered items, mode, duration, lighting, policies) with **no `plan_score`.**
- **`services/proposal_selector.py`** — loads the package's `algorithm.py` (reusing the existing
  file-load mechanism), calls `evaluate(selector_input_dict)`, and **validates the returned dict into
  the neutral contract** (`ServiceSelectorOutput` / `CompletePlan`). A raise or invalid shape becomes
  an **`algorithm_error` evidence event — never a faked result** (Constitution Principle V). An empty
  `allowed_service_ids` / eligible set yields an explicit `no_proposal`.
- This path **deliberately does not route through the trigger `adapter.py`** (which normalizes to a
  trigger `DecisionResult`), preserving proposal isolation.

---

## 6. Persistence & routers (setup / run / review skeletons)

- New config `proposal_runs_dir` → `<repo-root>/proposal_runs/` (env `AICA_PROPOSAL_RUNS_DIR`),
  separate from `runs/`.
- **`services/proposal_run_manager.py`** — creates runs, threads the append-only `ProposalRunLog`,
  persists via the atomic `file_store` after every meaningful event. `run_id =
  prun_<YYYYMMDD-HHMMSS>_<6-hex>` (timestamp/randomness confined to the router entry, matching the
  trigger convention).
- **`routers/proposal.py`** (registered additively in `main.py`):
  - `GET /api/proposal/matrix` — the versioned purpose/stage matrix.
  - `GET /api/proposal/packages` — the four slots + loaded packages + errors.
  - `POST /api/proposal/runs` — freeze setup → resolve `ProposalOpportunity` → **STEP 1** mock
    service selector → persist opportunity + service evidence → return the run + ranked candidates
    (default `selected_service` = rank-1).
  - `POST /api/proposal/runs/{id}/select-service` — **STEP 2** mock content selector for the chosen
    service → persist content evidence → return the plan. (The explicit *choose → recompute STEP 2*
    step.)
  - `GET /api/proposal/runs` · `GET /api/proposal/runs/{id}` · `DELETE /api/proposal/runs/{id}`
    (**delete built new**, scoped to proposal runs).

---

## 7. Frontend (Option A — top-level `appMode`)

- `App.tsx` wrapped in an `AppModeProvider` (`'trigger' | 'proposal'`) + a header toggle. The trigger
  shell, `runStore`, and all trigger screens are **untouched.**
- **`state/proposalStore.ts`** — Context + `useReducer` (same pattern as `runStore`), **isolated**
  from `runStore`. `uiLanguage` default `'ja'`. Holds: setup edits (purpose, stage, matrix version,
  selected service/content packages, params/hyperparams stubs, world summary), current opportunity,
  service output, selected service, content plan, current run id, error.
- **`components/proposal/`**:
  - `ProposalShell` — sub-nav **[ 4-Panel | Runs ]**.
  - `ProposalScreen` — the four panels: **① InputPanel** (synthetic-world summary),
    **② SetupPanel** (purpose/stage, package + mode selection, category-weight/multiplier readouts,
    safety-dominance readout — display stubs in P1), **③ ServiceProposalPanel** (eligible-after-matrix
    chips, ranked candidates, rank-1 contributions, selected-service hand-off),
    **④ ContentProposalPanel** (recipe/plan, ordered items with per-item fit + reasons, excluded
    examples, actions).
  - `ProposalRunsScreen` — list / reopen / delete.
  - A **provenance badge** component (`cdc_su_baseline` / `normalized_cdc_su_concept` /
    `proposed_addition`, mapping the `FeatureOriginProvenance` enum).
- All labels via the existing `t()` helper over `{ja, en}` pairs. Every panel and label exists in both
  languages, JA default.
- **`api/proposalClient.ts`** — the proposal endpoints above.

---

## 8. Test strategy (TDD, per layer)

- **Contract-schema tests:** every new model (opportunity purpose/stage validator, `ServiceSelectorOutput`
  ≤3 ranked, `CompletePlan` no-`plan_score`, event/journey/evidence, `ProposalPackageManifest`,
  `ProposalRunLog`).
- **Matrix-resolver tests:** all six rows resolve the correct `allowed_service_ids`; post-rest returns
  five including `call_response_stopped`; incompatible purpose/stage combos are rejected.
- **Registry 4-slot compatibility tests:** loads the two mocks; a content package cannot fill a service
  slot; an invalid manifest lands in the errors list (never partially used).
- **Mock-dispatch tests:** the mocks return valid neutral outputs; a package that raises →
  `algorithm_error` evidence (not a faked result); empty allowed set → `no_proposal`.
- **Persistence round-trip + isolation:** create → file in `proposal_runs/` → reopen matches → delete
  removes; a proposal-run create writes only `proposal_runs/` and never touches `runs/` or trigger state.
- **Import-guard test:** `models/proposal/*` does not import `aica_api.models` (trigger).
- **Frontend (Vitest):** `appMode` toggle renders `ProposalShell`; the 4-panel screen renders all four
  panels; language toggle shows JA default and switches to EN; the mock flow renders the service ranking
  and the plan; proposal-store edits do not mutate `runStore`.
- **Regression:** the full trigger backend + frontend suites still pass.

Verification commands:

```bash
cd app/api && uv run pytest
cd app/frontend && npm test
cd app/frontend && npm run build
docker compose config
docker compose up      # end-to-end demonstration slice (§1)
```

---

## 9. §17 source-reconciliation records

- **Post-rest candidate count (4 → 5) — RESOLVED (P1).** Adopt `call_response_stopped` in the
  `after_rest_before_restart` row (authoritative service algorithm doc §2.4/§5.2.4; Slides 38/40; enum
  already frozen with it; matrix is the resolved-allowed-set P5 consumes). Reconcile `docs/master`:
  add the service to spec §7.5 + Appendix A.0 (with a source note) and mark the §17 post-rest item
  resolved.
- **Missing spec cross-reference — already satisfied.** The consolidated spec §11 (line 506) already
  points to `aica_transparent_service_proposal_algorithm.md` as its normative source; no edit needed.
  Verified during P1 doc reconciliation.
- Other §17 items (schedule ownership, content Additional-proposed coverage, field renames,
  control-input naming) are already RESOLVED in P0.5 — inherited unchanged.

---

## 10. Files

**Additive edits (3):** `app/frontend/src/App.tsx` (wrap + toggle), `app/api/aica_api/main.py`
(include the proposal router), `app/api/aica_api/config.py` (add `proposal_runs_dir`).

**New (backend):** `models/proposal/{opportunity,service_output,matrix,events,journey,evidence,proposal_run,package_manifest}.py`;
`services/{proposal_package_registry,proposal_selector,proposal_run_manager}.py`;
`routers/proposal.py`; `proposal_contracts/matrix/purpose_stage_matrix.v1.json` (+ loader/export);
`packages/mock_service_selector_v1/`, `packages/mock_content_selector_v1/`.

**New (frontend):** `state/proposalStore.ts`, `state/appMode.tsx`;
`components/proposal/{ProposalShell,ProposalScreen,ProposalRunsScreen,ProvenanceBadge}.tsx` +
`components/proposal/panels/{InputPanel,SetupPanel,ServiceProposalPanel,ContentProposalPanel}.tsx`;
`api/proposalClient.ts`.

**Master-doc reconciliation:** `docs/master/aica_proposal_simulator_specification.md` (§7.5 post-rest
row → 5), `docs/master/aica_proposal_simulator_milestones.md` (§17 post-rest marked resolved;
Appendix A.0 post-rest row → 5).

---

## 11. Cross-milestone quality gates (P1 posture)

P1 predates most gates (they apply "after P1"), but it must not violate them going forward:
**Boundary** — world/dataset/selectors/eligibility/journey/evidence kept separated (P1 introduces the
selector + evidence boundaries cleanly). **Determinism** — mock outputs are fixed; no live LLM/network.
**Evidence** — every mock evaluation records inputs, package/contract/matrix versions, output, and user
action. **Regression** — the trigger simulator continues to pass. **Human-judgment** — no simulator
result is presented as objective correctness.
