# Phase 1 Data Model: M5 Review Feedback & Evidence Completeness

M5 adds a feedback event + the feedback schema, extends `RunLog`, and defines the derived
evidence-report shape. No algorithm-facing model changes.

## Feedback schema (`models/feedback.py`) — NEW
```
FieldDef = { key: str, label: {ja, en}, type: "choice"|"text"|"scale",
             options?: list[str], note?: bool (choice may allow an optional free-text note),
             min?/max?: float (scale, for extras) }
V1_FEEDBACK_SCHEMA: list[FieldDef]   # the 9 master §13.2 labels (see spec FR-002 table)
```
- `proposal_timing`/`safety_impression`/`intrusiveness`/`understandability`/`rest_spot_suitability`/
  `proposal_content_suitability`/`overall_judgment` → `choice` with the spec FR-002 options.
- `acceptance_reason`/`rejection_reason` → `choice` (with options) + `note: true` (optional free text).

## FeedbackTarget (`models/feedback.py`) — NEW
```
FeedbackTarget = { scope: "run"|"decision"|"proposal"|"action",
                   event_ref?: int,          # index into RunLog.events (unique anchor)
                   tick_index?: int, proposal_id?: str, action?: str }   # display metadata
```
- `run` needs no event_ref; `decision`/`proposal`/`action` require `event_ref` pointing to an
  event of the matching kind (tick / tick-with-proposal / action). Reserved future scopes
  `setup_change`/`comparison` are not implemented in M5.

## FeedbackEvent (`models/feedback.py`, added to the log Event union)
```
FeedbackEvent = { kind: "feedback", target: FeedbackTarget,
                  labels: dict[str, Any],      # {field_key: value | {choice, note}}
                  comment: str | None }        # free-text, no forced language
```
Appended to `RunLog.events` (the discriminated union gains `FeedbackEvent`).

## RunLog (`models/log.py`) — EXTENDED
- Add `FeedbackEvent` to the `Event` union.
- Add `driver_profile: dict|None = None`, `vehicle_profile: dict|None = None`,
  `speed_profile: dict|None = None` (persisted at `create_run`; optional defaults keep M1–M4 logs
  valid) — needed for the §14.2 export.

## Package (`models/package.py`) — feedback_schema
- `feedback_schema: list[dict]` already exists (empty for shipped packages). The feedback service
  parses it into `FieldDef`s and appends to the V1 baseline; a key colliding with a V1 key → error.

## Evidence report (derived; `services/evidence.py`) — NEW, not persisted
```
EvidenceReport = {
  report_id, run_id, timestamp, ui_language: "bilingual", simulator_version,
  package: {id, version}, scenario: {id, version},
  simulator_facts: { route_snapshot (display_route), route_facts, event_plan, run_mode,
    evidence_status, initial_parameters, final_parameters?, initial_hyperparameters,
    final_hyperparameters?, driver_profile, vehicle_profile, timeline_events, decision_trace,
    proposal_events, actions, expert_override_events?, algorithm_errors, run_comparison_reference? },
  human_review: { feedback_labels: [FeedbackEvent…], free_text_comments: [{target, comment}…] } }
```
- Derived from the persisted `RunLog`: `decision_trace`/`proposal_events`/`timeline_events` from the
  TickEvents (proposal_events = ticks whose decision fired a proposal); `actions` from ActionEvents;
  `algorithm_errors` from AlgorithmErrors; `human_review` from FeedbackEvents (labels vs comments split).
- `final_*` included only when different from `initial_*`; `expert_override_events` /
  `run_comparison_reference` only when present (none in V1).

## Frontend (`api/types.ts`) — mirrors the above
`FieldDef`, `FeedbackTarget`, `FeedbackEvent`, `EvidenceReport`; client `submitFeedback`,
`getFeedbackSchema`, `getEvidence`.
