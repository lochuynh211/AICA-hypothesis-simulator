# Phase 0 Research — P1 Proposal Screen & Standalone Run Foundation

All material unknowns were resolved during the brainstorming design step and the SpecKit clarify step;
no `NEEDS CLARIFICATION` markers remain. This file consolidates the decisions.

## D1 — Selector implementation: mock both

- **Decision**: Both selectors are mock `python_module` packages returning fixed valid results. The real
  P6 content package stays registered/tested via its own harness but is **not** run in the P1 flow.
- **Rationale**: P1's acceptance criteria are about proving the boundary is package-agnostic; the real
  P6 package cannot run end-to-end without the P3 world + P4 eligibility. Mocking keeps P1 a true
  foundation.
- **Alternatives**: (a) wire real P6 content now — rejected: pulls P3/P4 scope forward. (b) in-process
  mock functions (no package files) — rejected: wouldn't exercise the real package→evaluate→validate
  boundary, which is the point of P1.

## D2 — Frontend integration: top-level `appMode` switch

- **Decision**: `appMode: 'trigger' | 'proposal'` above the existing `viewMode`; trigger shell/store
  untouched; Proposal is a sibling shell with an isolated store.
- **Rationale**: Modifies the least existing/tested trigger code; produces a self-contained, isolated
  proposal module that later mounts into the trigger flow. Future composition happens at the neutral
  opportunity contract on the backend, which this supports equally. Enforces the "editing proposal setup
  does not modify trigger setup" invariant structurally.
- **Alternatives**: add a 4th `viewMode` to the shared nav — rejected: edits the shared `viewMode`/nav/
  shell (higher regression surface) and risks coupling the proposal store into the trigger tree.

## D3 — Post-rest service count: adopt 5

- **Decision**: The `after_rest_before_restart` matrix row includes `call_response_stopped` (5 services).
- **Rationale**: The authoritative service algorithm doc §2.4/§5.2.4 (Slides 38/40) lists five; the
  matrix is the resolved-allowed-set P5 consumes; the `ServiceId` enum (frozen in P0.5) already contains
  it; eligibility-only under P1 mocks. Resolves the §17 divergence. Master docs reconciled.
- **Alternatives**: keep 4 per spec §7.5 literal — rejected: P5 would need a matrix v2 bump.

## D4 — Proposal package model: new isolated manifest + registry

- **Decision**: New `ProposalPackageManifest` (`family` × `approach`) + `ProposalPackageRegistry`; the
  trigger `PackageManifest`/`PackageRegistry` are untouched.
- **Rationale**: The trigger `PackageManifest` is trigger-shaped (hard-requires `features`/`rules`/
  `fire_control`/`proposals`, list-typed `parameters`) and cannot validate a proposal manifest — it drops
  the real P6 content manifest today with 19 validation errors. The isolation invariant forbids coupling
  proposal models to trigger models.
- **Alternatives**: generalize the trigger `PackageManifest` into a discriminated union — rejected:
  touches the trigger path and violates isolation.

## D5 — Persistence: separate `proposal_runs/` namespace; delete built new

- **Decision**: New `proposal_runs/` dir + `ProposalRunManager` reusing the atomic `file_store`; new
  create/get/list/delete endpoints.
- **Rationale**: Isolates proposal evidence from trigger `runs/`; reuses proven atomic-write persistence.
  No delete-run precedent exists in the trigger app, so delete is built fresh (scoped to proposal runs).
- **Alternatives**: `runs/proposal/` subdir — rejected: risks trigger run listing globbing it.

## D6 — JA-default scoped to the proposal store

- **Decision**: The proposal store's `uiLanguage` defaults to `'ja'`; the trigger default stays `'en'`.
- **Rationale**: JA-default is a proposal-screen UI convention; flipping the shared trigger default is
  out of scope and a trigger-regression risk.

## D7 — Three panels, per-panel setup (approved via `ui-mockup.html`)

- **Decision**: 3 panels (① World · ② Service · ③ Content); setup merged into each selector panel;
  3-column layout at ~16/42/42, full-bleed, collapsing to a stack below ~1180 px.
- **Rationale**: A dedicated Setup panel duplicated context the selector panels need anyway; per-panel
  setup mirrors the existing trigger algorithm setup view and keeps STEP 1 / STEP 2 self-contained.
- **Alternatives**: 4 panels with a shared Setup — rejected by the reviewer.

## D8 — Editable parameters/hyperparameters (reverses clarify Q1)

- **Decision**: Params/hyperparameters are editable in P1, rendered from the package manifest; matrix/
  table hyperparameters render in a collapsed disclosure. Mock manifests carry a representative full set
  (content mirrors the real P6 manifest; service derived from the service algorithm doc §5–§6).
- **Rationale**: The reviewer wants to see and tune the real algorithm surface (matrices, weights,
  multipliers). Editing has no effect on the fixed mock results, but building the editable-setup +
  explanation UI now against the real manifest means P5/P6-wiring swaps in real math with zero UI change.
- **Alternatives**: selection-only (original Q1 answer) — superseded by the approved UI restructure.

## D9 — "Reason" = transparent contribution breakdown

- **Decision**: Each candidate/item exposes `feature → value → response(a) → weight(w) → signed
  contribution`, plus supporting/opposing features and a bilingual rationale. Same grammar for service
  (`service_fit`) and content (`item_fit`).
- **Rationale**: Grounds "why this candidate" in the neutral contract fields (`rationale`,
  `supporting`/`opposing_feature_ids`, `feature_contributions`) and the approved overview's transparent-
  score model. The mock supplies well-formed illustrative values, clearly badged as mock.

## Reused foundations (no research needed — already merged)

- P0.5 contracts: `SelectorInput`, `CompletePlan`, enums (`TriggerPurpose`, `LifecycleStage`, `ServiceId`
  incl. `call_response_stopped`, `FeatureOriginProvenance`), frozen JSON schemas + drift guard.
- P6 real content package `aica_transparent_content_selector_v1` (manifest = source for the mock content
  param set) — kept registered/tested, not run in P1.
- P2 frozen dataset `…demonstration-seed-1042` (source of real track names for the mock content plan).
- Frontend `t()` bilingual helper + `LanguageToggle`; store-driven `viewMode` shell pattern; atomic
  `file_store`; the `python_module` file-load mechanism (reused by `proposal_selector.py`).
