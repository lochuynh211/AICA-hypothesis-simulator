# Contract — Journey & Eligibility API (P4)

All routes are additive to the existing `routers/proposal.py` (prefix `/api/proposal`). No
existing route's response shape is broken; the two selector responses gain reason-coded
`excluded_candidates` content that was previously empty.

## Eligibility (folded into existing STEP-1)

`POST /api/proposal/runs` (existing) — unchanged request. **Behavior change**: the service
context's `eligible_candidates` is now the motion/capability-narrowed set, and the STEP-1
`AlgorithmEvidence.excluded_candidates` carries reason-coded exclusions:

```json
{
  "excluded_candidates": [
    {"candidate_id": "full_karaoke", "reason_codes": ["full_karaoke_requires_stopped"]},
    {"candidate_id": "stretch_video", "reason_codes": ["stopped_only_while_driving"]},
    {"candidate_id": "oshi_reexperience", "reason_codes": ["missing_required_entity"]}
  ]
}
```

Invariant: no exclusion carries a score/fit/weight. A `background_on_motion` service (e.g.
`live_viewing`) is **not** excluded while driving — it appears in `eligible_candidates`.

## POST /api/proposal/runs/{run_id}/journey/action

Apply one journey action. Body:

```json
{ "action_type": "accept", "payload": {} }
```

`action_type` ∈ {accept, reject, postpone, choose_another, request_more, complete, continue,
stop, motion_change, rest_spot_arrived, rest_started, rest_completed}.

Payloads:
- `motion_change`: `{"motion_state": "driving" | "stopped"}`
- `choose_another` / `reject` (optional): `{"selected_service_id": "<ServiceId>"}` (defaults to the
  currently offered service)
- `rest_completed`: `{"post_rest": {"drowsiness_level": <0-100>, "fatigue_level": <0-100>}}`

**Response `200`**: the full updated `ProposalRunLog` (same shape returned by
`select-service`/`get_run`), reflecting the appended event(s), new `journey_state`, and `status`.

**Errors**:
- `404` run not found.
- `422` invalid precondition — structured `{ "detail": {"code": "...", "message": "EN / JA"} }`
  (e.g. `continue` before content completed; `accept` with nothing selected). Never a silent no-op.
- A `no_eligible_candidate` end-state (e.g. rejecting the last eligible service) is a **success**
  response whose log carries a `NO_ELIGIBLE_CANDIDATE` event — not a 4xx/5xx.

**Determinism**: identical `(run_log state, action)` → identical events + journey_state (SC-006).
Timestamps are minted by the router, not the engine.

**Persistence**: events append to the log via `proposal_run_manager.append_event`; state via
`update_state`. Failures inside the engine/selector surface as an `ALGORITHM_ERROR` event.

## GET /api/proposal/runs/{run_id}/journey/preview

Return a non-binding rolling-horizon preview. **Response `200`**:

```json
{
  "binding": false,
  "steps": [
    {"label": "Now — guide to rest spot / いま — 休憩スポットへ案内", "lifecycle_stage": "before_rest_until_stop", "note": null},
    {"label": "At rest — nap / 休憩中 — 仮眠", "lifecycle_stage": "during_rest_stopped", "note": null},
    {"label": "After rest — stopped full karaoke / 休憩後 — 停車中フルカラオケ", "lifecycle_stage": "after_rest_before_restart", "note": null}
  ]
}
```

**Guarantees**: invokes no selector; appends no event/evidence; mutates no run state (SC-007).
`404` if run not found. Reopening the run afterward yields a byte-identical log.

## Isolation

Every route reads/writes only `settings.proposal_runs_dir`, `settings.packages_dir`, and
`settings.proposal_contracts_dir`. None touch the trigger `settings.runs_dir` or import
`aica_api.algorithms`.
