# Phase 0 Research: P7 — End-to-End Pre-Rest/Rest/Post-Rest Vertical Slice

All decisions below resolve to concrete, existing seams in the codebase. No open `NEEDS CLARIFICATION` remains.

## D1 — Where recompute orchestration lives (router vs journey engine)

**Decision**: Recompute is a **router endpoint** (`routers/proposal.py`), orchestrating existing services; it is NOT a `JourneyActionType` and never enters `proposal_journey.apply_action`.

**Rationale**: The P4 journey engine's contract (`services/proposal_journey.py` module docstring) is explicitly PURE — no clock, no randomness, no filesystem, no selector dispatch. Recompute must resolve the matrix, load the catalog, dispatch a selector, and persist — all IO/side-effecting. Putting it in the engine would break that invariant (spec FR-020) and the isolation the milestone requires. The create-run flow already demonstrates the exact orchestration shape in the router (`create_proposal_run`), so recompute mirrors it.

**Alternatives considered**: (a) auto-recompute inside `rest_completed` handler — rejected at the Step 2 design checkpoint (couples engine to IO). (b) A new pure "recompute planner" service returning intent for the router to persist — viable but over-engineered for one call site; the router already owns this style of orchestration (`create_proposal_run`).

## D2 — Applying context overrides to the base World

**Decision**: Extract a pure helper `apply_overrides(base_world: World, overrides: list[FieldOverride], *, catalog) -> tuple[World, list[FieldDiff]]` from the existing `WorldCloneStore.create_clone` body, and reuse it in both `create_clone` and recompute. It uses the existing `_split_path` / `_set_at_path` / `validate_world` machinery. Unlike `create_clone`, the recompute call:
- allows an **empty** override list (FR: pure lifecycle-stage recompute), and
- does **not** persist a `WorldClone` (recompute freezes a `SetupSnapshot`, not a clone).

**Rationale**: `create_clone` already implements exactly the apply→revalidate→diff logic P7 needs (`world_clone_store.py:182-258`), including the dangling-catalog guard and `InvalidOverrideError(.issues)` → 422 mapping. Extracting the pure core avoids duplicating validation and keeps the two paths behaviorally identical (spec Assumptions: "no new override grammar"). The empty-list rejection currently in `create_clone` moves to the *clone* caller, not the shared helper.

**Effective-World construction**: before applying user overrides, the recompute sets `effective_world.control_inputs.lifecycle_stage` and `.motion_state` from the run's **current `journey_state`** (journey actions like `rest_completed`/`motion_change` already advanced these). `trigger_purpose` and `dataset_id` are carried unchanged from the base world. This is done as two internal overrides (or a `model_copy(update=...)` on `control_inputs`) applied before the reviewer's overrides.

**Alternatives considered**: mutating a persisted World via a PATCH endpoint — rejected at Step 2 (blurs the frozen-snapshot boundary).

## D3 — Freezing the new snapshot; refactor `_freeze_setup_snapshot`

**Decision**: Refactor `_freeze_setup_snapshot` (`routers/proposal.py:729`) so its origin inputs come from explicit params (`origin_seed_id`/`clone_id`/`profile_id`) instead of the whole `CreateProposalRunBody`. `create_proposal_run` passes them from `body`; recompute passes the run's existing `setup_snapshot.origin` (carried forward). Everything else (`validate_world` → `world.project()` → `SetupSnapshot`) is reused unchanged.

**Rationale**: `_freeze_setup_snapshot` only reads `body.origin_*` from the body; decoupling it makes it callable from recompute with no behavior change to the create path. The frozen snapshot is what makes each recompute a replayable decision point (Constitution III; spec FR-004/FR-007).

## D4 — Append-only history + current head (persistence)

**Decision**: `ProposalRunLog` gains `opportunity_history: list[ProposalOpportunity] = []` and `setup_snapshot_history: list[SetupSnapshot] = []` (append-only, EXCLUDING the current head), plus `world: World | None = None` and `mode: str = "interactive"`. The recompute endpoint assembles the new head + pushes the prior head into history and calls `proposal_run_manager.update_state(...)` with the new `opportunity`, `setup_snapshot`, `world_snapshot`, and the two history lists; `append_event`/`append_evidence` add the new events + service evidence.

**Rationale**: Additive optional fields keep every existing reader/test working (Story constraints; the existing `list_runs`/`get_run`/`select_service` all read the top-level `opportunity`/`setup_snapshot` head). `update_state` already exists for exactly this "small additive counterpart" role; P7 widens it with `opportunity`, `world_snapshot`, `opportunity_history`, `setup_snapshot_history` kwargs (all `None`-default = unchanged). Deep-copy freezing mirrors the existing `parameters` discipline.

**Alternatives considered**: rely on `evidence[*].input_snapshot` only (no history fields) — rejected at Step 2 (loses per-stage `SetupSnapshot` provenance for P10; weaker replay of the opportunity sequence).

## D5 — Quick-check content dispatch (shared helper)

**Decision**: Extract the STEP-2 content-dispatch body of `select_service` into `_dispatch_content_for_service(run_log, selected_service_id, content_parameters, content_hyperparameters) -> tuple[AlgorithmEvidence, dict | None]` (evidence + redacted persisted input snapshot). It encapsulates: real-vs-mock context builder choice (`_build_real_content_context` / `_build_content_context`), the `_REAL_CONTENT_PACKAGE_ID` gate, catalog redaction (`_redact_catalog_for_evidence`), and `dispatch_selector`. Reused by: `select_service` (unchanged behavior), quick-check create, and quick-check recompute.

**Rationale**: Guarantees quick-check content == interactive content (spec FR-014 parity; SC-006) because they call the identical code path. Pure refactor guarded by existing STEP-2 tests; the eligibility/`supported_services` gate that currently lives in `select_service` stays in `select_service` (it validates a *user-supplied* service id), while the helper handles only the dispatch given an already-validated eligible service — for quick-check the service is the selector's own rank-1, already eligible by construction.

## D6 — Post-rest feature flow

**Decision**: `rest_completed` already advances the stage to `after_rest_before_restart` and records the explicit `post_rest.drowsiness_level`/`fatigue_level` in its event payload (`proposal_journey.py:794`). P7 does NOT change the engine; instead the reviewer (or the frontend RecomputePanel) sends those same two values to `POST /recompute` as `overrides` on `situation.drowsiness_level` / `situation.fatigue_level`. The recompute applies them into the effective World, so they flow through `world.project()` into the `feature_snapshot` the P5/P6 selectors score.

**Rationale**: Keeps post-rest state an explicit input (FR-009, no probabilistic generation) and needs no engine change. The two values are `Situation` fields already editable via the P3 world model, so an override on `situation.drowsiness_level` is a first-class, validated edit.

**Playback precondition (clarification 2026-07-17)**: recompute rejects (422) when `journey_state.playback_state` is `active` or `backgrounded` (FR-006a) — it never silently ends a playing plan. In the reference journey the pre-rest content is `completed`/`stopped` by the time of the post-rest recompute, so this never blocks the demo.

## D7 — Determinism & grounding (gate confirmation)

**Decision**: Recompute performs no live model/network call — the P5/P6 packages are local trusted Python scoring the frozen catalog. Identical `(run state, overrides)` → byte-identical `feature_snapshot` (pure `world.project()`), identical `SetupSnapshot` (versions from frozen artifacts), and identical `ServiceSelectorOutput` (deterministic scorer). Reopen renders history without recomputation (`get_run` never dispatches). Confirms Constitution III/IV/V and gates §16.4/§16.5.

## D8 — `no overrides` and error paths

**Decision**: Empty `overrides` is valid (records no `CONTEXT_EDITED` event, still recomputes for the current stage/motion). A selector `ALGORITHM_ERROR` on recompute is recorded on the new decision point (status `error`), never disguised (FR-019). A recompute that resolves zero eligible services records `NO_ELIGIBLE_CANDIDATE` on the new opportunity, no fabricated candidate (edge case). Legacy run (no `world`) → 422 (FR-006). These mirror the existing create-run branches exactly.
