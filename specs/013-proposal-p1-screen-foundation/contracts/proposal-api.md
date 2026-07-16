# Phase 1 Contracts — Proposal API (`/api/proposal/*`)

Backend router `app/api/aica_api/routers/proposal.py`, mounted additively in `main.py`. All request/
response bodies are the Pydantic models from `data-model.md`. Timestamps/randomness are confined to the
router entry (run-id minting), matching the trigger convention. Every endpoint is proposal-namespaced and
never reads or writes trigger state.

## GET `/api/proposal/matrix`

Return the frozen versioned purpose/stage service matrix.

- **200** → `{ matrix_version: str, rows: [ { trigger_purpose, lifecycle_stage, allowed_service_ids[] } ] }`
- Guarantees: 6 rows; the `after_rest_before_restart` row lists 5 services incl. `call_response_stopped`.

## GET `/api/proposal/packages`

List the four proposal package slots, the loaded packages, and load errors.

- **200** →
  ```json
  {
    "slots": [
      { "family": "service_selector", "approach": "transparent", "package_id": "mock_service_selector_v1" },
      { "family": "service_selector", "approach": "constrained_llm", "package_id": null },
      { "family": "content_selector", "approach": "transparent", "package_id": "mock_content_selector_v1" },
      { "family": "content_selector", "approach": "constrained_llm", "package_id": null }
    ],
    "packages": [ { "id": "...", "family": "...", "approach": "...", "label": {"ja":"…","en":"…"},
                   "supported_services": ["..."], "parameters": {…}, "hyperparameters": [ … ] } ],
    "errors":   [ { "package_dir": "...", "error": "..." } ]
  }
  ```
- Compatibility: a content package cannot occupy a service slot (and vice-versa); an invalid manifest
  appears in `errors`, never in `packages`.

## POST `/api/proposal/runs`  — create run + STEP 1 (service)

Freeze setup → resolve the opportunity → run the mock **service** selector → persist → return.

- **Request**:
  ```json
  {
    "trigger_purpose": "rest_recommended",
    "lifecycle_stage": "after_rest_before_restart",
    "motion_state": "stopped",
    "world_snapshot": { "feature_snapshot": {…}, "feature_provenance": {…}, "profile_id": "…" },
    "service_package_id": "mock_service_selector_v1",
    "content_package_id": "mock_content_selector_v1",
    "mode": "interactive",
    "enabled_feature_extensions": [],
    "parameters": {…},          // edited param overrides (setup-time only)
    "hyperparameters": {…},     // edited hyperparameter overrides
    "run_seed": "…", "simulation_time": "…"
  }
  ```
- **201** → `ProposalRunLog` with `status: "service_selected"`, the resolved `opportunity`
  (`allowed_service_ids` from the matrix), one `SERVICE_SELECTED` (or `ALGORITHM_ERROR`) event, and the
  `ServiceSelectorOutput` in `evidence[0].output` (default selected = rank-1).
- **422** → invalid request: incompatible purpose/stage; unknown/mis-slotted package; empty request.
- **Failure semantics**: a selector raise/invalid return ⇒ `status: "error"`, an `ALGORITHM_ERROR` event,
  and `evidence[0].error` set — **never** a fabricated `ranked_candidates`. Empty allowed set ⇒
  `decision_type: "no_proposal"`.

## POST `/api/proposal/runs/{run_id}/select-service` — STEP 2 (content)

Run the mock **content** selector for the chosen service and append its evidence.

- **Request**: `{ "selected_service_id": "music_playlist" }` (must be in `opportunity.allowed_service_ids`).
- **200** → updated `ProposalRunLog` with `status: "content_selected"`, a `CONTENT_SELECTED` (or
  `ALGORITHM_ERROR`) event, and the `CompletePlan` in the appended `evidence` entry.
- **422** → `selected_service_id` not in the allowed set, or the content package does not support it
  (`unsupported_service`); **not found** if the run does not exist.
- Content items reference real frozen-P2 track IDs. Failure semantics identical to create.

## GET `/api/proposal/runs`

- **200** → `[ ProposalRun … ]` (summaries) sourced from `proposal_runs/*.json` (+ in-memory active).

## GET `/api/proposal/runs/{run_id}`

- **200** → the full `ProposalRunLog` (rendered from disk on reopen; no recomputation).
- **404** → unknown run.

## DELETE `/api/proposal/runs/{run_id}`

- **204** → the run's `proposal_runs/<run_id>.json` is removed; no trigger run is affected.
- **404** → unknown run.

## Cross-cutting guarantees (asserted by contract tests)

- No proposal endpoint reads/writes `runs/` or any trigger state.
- Every persisted decision records inputs, package/contract/matrix versions, output, and the user action.
- Deterministic: identical create+select requests reproduce identical mock outputs; reopen == recorded.
- Bilingual: all human-facing labels are `{ja,en}`; resolved client-side via `t()`.
