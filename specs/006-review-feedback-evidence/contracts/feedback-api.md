# Contract: feedback API (schema + submit)

## GET /api/runs/{run_id}/feedback-schema
Returns the **effective schema** for the run's package = `V1_FEEDBACK_SCHEMA` ∪ the package's
manifest `feedback_schema` extras (package resolved from `RunLog.snapshot.package.id`). A package
extra that redefines a V1 key → the package is invalid (surfaced as an error). Works for any
persisted run (active or on-disk). Response: `{ fields: [FieldDef…] }`.

## POST /api/runs/{run_id}/feedback
Request: `{ target: FeedbackTarget, labels: dict, comment?: str }`.
- **Validate** against the effective schema + the persisted log:
  - every `labels` key ∈ effective schema; choice values ∈ that field's `options`; text values are
    strings; a choice field's optional note is a string when present.
  - `target.scope` ∈ {run, decision, proposal, action}; for non-run scopes, `target.event_ref`
    MUST index an event of the matching kind in `RunLog.events` (decision/proposal → a TickEvent;
    proposal additionally a tick whose decision fired a proposal; action → an ActionEvent).
  - All fields optional (empty labels + only a comment is valid; empty everything is valid).
- **Invalid** → structured 400 `{validation_errors: [...]}`, **nothing appended**.
- **Valid** → append ONE `FeedbackEvent`:
  - active run (in the in-memory registry) → via its `EvidenceRecorder`.
  - inactive run → **disk-backed**: load `runs/{run_id}.json` → `RunLog` → append → `write_json_atomic`.
  - 201 with the appended event (or the updated run state). The feedback NEVER alters prior events,
    a decision, or any algorithm.

## Contract tests
- effective schema = baseline ∪ extras (fixture package); collision (extra redefines a V1 key) → error.
- validation matrix: valid full; valid comment-only; unknown label key → 400; choice value not in
  options → 400; non-run target missing/!matching `event_ref` → 400.
- POST appends a persisted `FeedbackEvent` (active run); POST on an inactive/on-disk run appends +
  re-persists (no in-memory registry entry needed).
- after feedback, the run's decision trace is byte-for-byte unchanged (non-algorithmic).
- GET feedback-schema works for active + on-disk runs.
