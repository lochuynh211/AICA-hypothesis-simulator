# P7 Design — End-to-End Pre-Rest/Rest/Post-Rest Vertical Slice

**Date:** 2026-07-17
**Milestone:** P7 (`docs/master/aica_proposal_simulator_milestones.md` §9)
**Branch:** `proposal-p7-e2e-vertical-slice`
**Status:** Approved (design checkpoint)

## Document map / authorities

- Milestone contract: `docs/master/aica_proposal_simulator_milestones.md` §9 (P7), §16 (cross-milestone gates), §17 (reconciliations).
- Feature contracts: consolidated spec §5/§7/§8/§9; service + content algorithm docs (unchanged by P7).
- Constitution: `.specify/memory/constitution.md` (Backend source of truth; append-only evidence; deterministic replay; one adapter contract).
- Prerequisite features: 015 (P4 journey/eligibility), 016 (P5 service selector), 011 (P6 content selector), 014 (P3 editable world), all merged to `develop` and green (baseline 2061 passed / 3 skipped).

## 1. Goal & customer-visible outcome

Demonstrate UC-01 as a sequence of **recomputed advisory decisions** on the standalone 4-panel proposal screen, from one built-in seed. The reviewer drives the whole reference journey:

```
seed-night-highway-oshi (rest_recommended, high drowsiness/fatigue, driving, oshi on)
  → service proposal (before_rest_until_stop): humming_karaoke selected for travel to rest spot
  → rest_spot_arrived (stop) → rest_started
  → rest_completed with EXPLICIT reviewer-entered post-rest drowsiness/fatigue
  → RECOMPUTE stopped-stage service proposal (after_rest_before_restart)
  → full_karaoke concrete song + lighting selected
  → accept → complete, or motion_change back to driving → motion policy restores previous content
```

## 2. Smallest runnable vertical slice / build order

1. **Backend recompute** producing a second frozen snapshot with a changed proposal after a lifecycle-stage change — proven by an API test.
2. **Quick-check mode** (auto rank-1 service + content) on create and recompute; parity test vs interactive.
3. **Reject-all-after-recompute**, **preview-not-committed** safety tests.
4. **Frontend** 4-panel integration (mode toggle, recompute control, lifecycle/timeline display).
5. **End-to-end** API test walking the full reference journey.

## 3. Approved material decisions (Step 2 checkpoint)

| # | Decision | Choice | Rationale |
|---|---|---|---|
| D1 | Recompute model | **Same-run**: a new `POST /runs/{id}/recompute` endpoint appends a fresh `ProposalOpportunity` + `SetupSnapshot` + service `AlgorithmEvidence` to the SAME run log | Matches "the whole reference journey from one seed" + "each transition creates a new frozen snapshot"; keeps the journey as one continuous, replayable record. |
| D2 | Context edits | **Recompute takes explicit `context_overrides`** (P3 `FieldOverride` list); backend applies to base World, re-validates, re-projects, freezes a new snapshot | Reuses proven P3 clone/override + `validate_world` machinery; post-rest drowsiness/fatigue are the common override case; supports general "edit then recompute". |
| D3 | Quick-check mode | **Per-run mode**; `quick_check` auto-selects rank-1 SERVICE + CONTENT on create AND recompute; `interactive` stops at `service_selected` | The inert `CreateProposalRunBody.mode` field gets behavior; one-call full plan; rank-1 provably identical across modes (same selector, same frozen snapshot). |
| D4 | Snapshot history | **Append-only history lists + current head**: add `opportunity_history` / `setup_snapshot_history`, keep top-level `opportunity`/`setup_snapshot` as the current head | Full back-compat with every existing reader/test; replay renders each stage's snapshot without recomputation; stronger provenance for P10 side-by-side later. |

Additional design element surfaced during grounding and approved: **persist the base typed `World`** in the run log so recompute can apply overrides + re-validate (the projected `world_snapshot` alone is insufficient).

## 4. Backend — data model (all additive, back-compat)

`ProposalRunLog` (`models/proposal/proposal_run.py`) gains:

- `world: World | None = None` — base typed World for the run (typed-world path only; `None` for legacy `world_snapshot`-only runs).
- `opportunity_history: list[ProposalOpportunity] = []` (append-only; excludes current head).
- `setup_snapshot_history: list[SetupSnapshot] = []` (append-only; excludes current head).
- `mode: str = "interactive"` — frozen per run (`interactive` | `quick_check`).

`ProposalRun` summary gains `mode` (optional, defaults `interactive`) for listings.

New `DiscreteEventType` members: `RECOMPUTED`, `CONTEXT_EDITED`.

Run-manager (`services/proposal_run_manager.py`):
- `create_run(...)` accepts `world` and `mode` (deep-copied / stored).
- `update_state(...)` gains `opportunity`, `setup_snapshot` head replacement plus `opportunity_history`/`setup_snapshot_history` append support (additive kwargs; omitted = unchanged). History append is done by the router assembling the new lists and passing them; the manager only persists.

## 5. Backend — recompute endpoint

`POST /api/proposal/runs/{run_id}/recompute`, body:

```json
{ "overrides": [ {"path": "situation.drowsiness_level", "value": 20},
                 {"path": "situation.fatigue_level",  "value": 30} ] }
```

Algorithm (router, reusing existing helpers):
1. Load run. **422** if `run_log.world is None` — recompute requires a typed-world run; a legacy run is never fabricated into one.
2. Build the **effective World** = base `run_log.world` with `control_inputs.lifecycle_stage` and `control_inputs.motion_state` overwritten from the **current `journey_state`** (journey actions such as `rest_completed`/`motion_change` already advanced these), then apply `overrides` to `situation`/`driver_profile` via the P3 override applier.
3. `validate_world(effective_world, catalog)` → **422** with field issues on failure (no snapshot fabricated). Then `effective_world.project()` + `_freeze_setup_snapshot(...)` → new `world_snapshot` dict + new `SetupSnapshot`.
4. Resolve matrix for the current `(trigger_purpose, lifecycle_stage)` → new `allowed_service_ids` → new `ProposalOpportunity` (fresh `opportunity_id`, same `run_seed`). Run `resolve_eligibility` against current motion → dispatch the SERVICE selector via `dispatch_selector` (identical to `create_proposal_run`).
5. Push prior head opportunity/snapshot into their history lists; install the new head. Reset `journey_state.active_service_id` and `rejected_service_ids` for the new opportunity (carry `motion_state`, `lifecycle_stage`). Append events in order: `CONTEXT_EDITED` (only if overrides non-empty) → `OPPORTUNITY_OPENED` → `RECOMPUTED` → `SERVICE_SELECTED` (or `ALGORITHM_ERROR`/`NO_ELIGIBLE_CANDIDATE`). Append the new service `AlgorithmEvidence`.
6. If `mode == "quick_check"` and a rank-1 candidate exists, immediately run the shared content-dispatch helper (§7) for that service → `content_selected` in the same response.
7. **Determinism**: identical `overrides` on identical run state → byte-identical snapshot + ranking (frozen dataset is the replay boundary; no live model/network).

Post-rest wiring: `rest_completed {post_rest:{drowsiness_level, fatigue_level}}` (already advances stage) → then `recompute {overrides:[drowsiness_level, fatigue_level]}`. Changing those two values changes the ranking (AC-3), because they flow into the projected `feature_snapshot` the P5 selector scores.

## 6. Backend — quick-check mode

Stored per run (`mode`). In `create_proposal_run` and `recompute`, after the service selector yields a rank-1 candidate, `quick_check` immediately dispatches the CONTENT selector for that rank-1 service (real-catalog context, identical to `select_service`) and reaches `content_selected` in one response. `interactive` stops at `service_selected`.

Parity guarantee: quick-check's rank-1 service is the same object the interactive reviewer would see, because both read the same `ServiceSelectorOutput` from the same frozen snapshot — asserted by a mode-parity test (AC-6). No probabilistic acceptance/recovery is ever generated (AC-7).

## 7. Backend — shared content-dispatch helper

Extract the STEP-2 content-dispatch body of `select_service` into `_dispatch_content_for_service(run_log, selected_service_id, content_parameters, content_hyperparameters) -> (AlgorithmEvidence, evidence_input_snapshot)`, reused by: `select_service`, quick-check create, and quick-check recompute. Pure refactor of existing behavior (real-catalog context builder, catalog redaction, eligibility gate). No behavior change on the existing `select_service` path — guarded by the existing STEP-2 tests.

## 8. Backend — reject-all & preview safety (mostly existing)

- Reject-all is already safe via P4 `_reject_service`/`_choose_another` (`NO_ELIGIBLE_CANDIDATE` success end-state). P7 adds a test proving reject-all **after a recompute** still exits safely (AC-5).
- `/journey/preview` already exists and is non-binding (pure read). P7 adds a test that a previewed next content is not auto-committed (AC-4).

## 9. Frontend — 4-panel integration (display-only)

- **Mode toggle** (interactive / quick-check) in Panel ② setup; value frozen into create-run.
- **Recompute control**: post-rest context-edit surface (drowsiness/fatigue, plus general feature edits) in Panel ②/③; "Recompute" button → `POST /recompute`; store refreshes from the returned log.
- **Lifecycle stage + motion + currently-allowed service set** display in Panel ②/③ (from `journey_state` + head `opportunity`).
- **EventTimeline** (existing) extended for `RECOMPUTED`/`CONTEXT_EDITED` and the multi-opportunity sequence; committed action vs non-binding preview shown as distinct regions.
- JA-default + EN for every new label. Backend remains the sole source of truth; the frontend never decides a proposal.

New client fn `recompute(runId, overrides)` in `api/proposalClient.ts`; store actions `RECOMPUTED`/`MODE_SET`.

## 10. Isolation, gates, and test strategy

- **Journey engine purity preserved**: recompute lives in the router (D1 chose "not option C"), never in `proposal_journey.apply_action`. The engine keeps its no-IO/no-selector contract.
- **Trigger isolation/regression**: no trigger model/router/algorithm touched; full backend suite stays green (regression gate §16.7).
- **Determinism/grounding gates**: frozen dataset is the replay boundary; every recomputed plan cites frozen catalog Track IDs; no live model/network in a transparent run.
- **Evidence gate**: each recompute records inputs, config versions (new `SetupSnapshot`), output, and user action; failures are `ALGORITHM_ERROR` events, never disguised as normal proposals.

Tests:
- Recompute: contract (shape), determinism (identical overrides → identical snapshot+ranking), snapshot-boundary (history push + head install), invalid-override 422, legacy-run 422, post-rest-changes-ranking (AC-3).
- Quick-check: create + recompute reach `content_selected`; mode-parity rank-1 (AC-6); no probabilistic fields (AC-7).
- Safety: reject-all-after-recompute exits safely (AC-5); preview-not-committed (AC-4).
- Frontend: recompute control, mode toggle, timeline render, language toggle.
- **End-to-end** API test: full reference journey (AC-1) with event-order + persisted-state assertions.

## 11. Out of scope

Trigger-tick composition (Post-V1), LLM packages (P8/P9), P10 comparison UI, new dataset generation, probabilistic acceptance/recovery, `htmlapp/` sync (proposal path is FastAPI/React only).

## 12. Master-document reconciliation

P7 introduces no new feature-contract rows and no algorithm-math changes, so the two algorithm docs, the data spec, the design reference, and the overview HTML need **no edits**. The milestone doc §9 already scopes recompute/quick-check/preview; no §17 item is newly opened or resolved by P7. This design records the four D1–D4 decisions as the P7-local contract; if the SpecKit clarify step surfaces a contract-affecting answer, the relevant master doc is updated in Step 3 before freezing.
