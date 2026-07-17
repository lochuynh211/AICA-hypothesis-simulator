# API Contract: P7 Recompute + Quick-Check

Extends the proposal API (`app/api/aica_api/routers/proposal.py`). All routes live under `/api/proposal`. Backend is the source of truth; the frontend only submits and renders.

## POST /api/proposal/runs/{run_id}/recompute

Recompute the proposal for an existing run at its **current** lifecycle stage and motion, applying explicit context overrides. Appends a new frozen decision point to the same run.

### Request body (`RecomputeRequest`)

```json
{
  "overrides": [
    { "path": "situation.drowsiness_level", "value": 20 },
    { "path": "situation.fatigue_level", "value": 30 }
  ],
  "parameters": {},
  "hyperparameters": {},
  "content_parameters": {},
  "content_hyperparameters": {}
}
```

- `overrides` — list of `FieldOverride` (`{path, value}`), the same shape as `POST /worlds/clone`. **Empty list allowed** (pure stage recompute). Paths address the run's base `World` (`situation.*`, `driver_profile.*`, …).
- `parameters`/`hyperparameters` — optional SERVICE package setup overrides for this recompute; empty falls back to the current head's frozen service params.
- `content_parameters`/`content_hyperparameters` — used only when `mode == quick_check` to dispatch content; empty falls back to the content package defaults.

### Success — 200, body `ProposalRunLog`

The returned log has: a new current-head `opportunity` (fresh `opportunity_id`, resolved `allowed_service_ids` for the current stage) and `setup_snapshot`; the prior head pushed into `opportunity_history`/`setup_snapshot_history`; new events appended in order; the new service `AlgorithmEvidence` (and, in quick_check, the content evidence) appended.

Event order appended by one recompute:
1. `CONTEXT_EDITED` — only if `overrides` non-empty; payload = applied field diffs.
2. `OPPORTUNITY_OPENED` — payload `{opportunity_id, trigger_purpose, lifecycle_stage}`.
3. `RECOMPUTED` — payload `{from_opportunity_id, to_opportunity_id}`.
4. `SERVICE_SELECTED` (rank-1) **or** `NO_ELIGIBLE_CANDIDATE` **or** `ALGORITHM_ERROR`.
5. quick_check only, on rank-1 success: `CONTENT_SELECTED` (or `ALGORITHM_ERROR` for content).

Resulting `status`: see data-model "Run status after recompute".

### Errors

| Status | Condition | Body |
|---|---|---|
| 404 | Unknown `run_id` | `{detail}` |
| 422 | Run has no base typed `world` (legacy run) | `{detail: "recompute requires a typed-world run"}` (FR-006) |
| 422 | `playback_state` is `active`/`backgrounded` | `{code: "recompute_requires_idle_playback", message}` (FR-006a) |
| 422 | Override invalid (malformed/unknown path, out-of-range value, dangling catalog ref) | `[{path, code, message}, …]` from `InvalidOverrideError.issues` (FR-005) |
| 422 | Unknown/unresolvable dataset for the world | `[{path, code, message}]` |

A selector **algorithm error** is NOT an HTTP error: it is recorded as an `ALGORITHM_ERROR` event + `status: error` and returned 200 (failures visible, not hidden — Constitution II; FR-019).

### Determinism (FR-007)

Given identical persisted run state and identical `overrides`, two recomputes MUST yield byte-identical `setup_snapshot`, `feature_snapshot`, and `ranked_candidates`. No live model/network call occurs.

## Behavior change: POST /api/proposal/runs (create) — mode

`CreateProposalRunBody.mode` becomes behavioral:

- `interactive` (default): unchanged from P1–P5 — the run stops at `service_selected` after STEP 1; the reviewer calls `select-service` to reach `content_selected`.
- `quick_check`: when STEP 1 yields a rank-1 service, the backend immediately dispatches the content selector for that rank-1 service (same path as `select-service`) and returns a `content_selected` run in one response. If STEP 1 yields no eligible/ranked candidate, the run stays at `service_selected` with `NO_ELIGIBLE_CANDIDATE`; no content is fabricated.

The run's `world` (typed-world path) and `mode` are persisted on create.

## Behavior change: POST /api/proposal/runs/{run_id}/select-service

Unchanged externally. Internally its content-dispatch body is extracted into the shared `_dispatch_content_for_service` helper (also used by quick-check create + recompute), guaranteeing identical content behavior across modes (FR-014). The user-supplied-service eligibility + `supported_services` gates remain in `select-service`.

## Unchanged contracts (regression)

`GET /matrix`, `GET /packages`, `GET/POST /runs`, `GET/DELETE /runs/{id}`, `POST /runs/{id}/journey/action`, `GET /runs/{id}/journey/preview`, all `/seeds`, `/profiles`, `/worlds`, `/datasets` routes keep their P1–P5 contracts. The preview route stays a pure read (FR-017): a run's on-disk file and `GET /runs/{id}` are byte-identical before and after a preview.
