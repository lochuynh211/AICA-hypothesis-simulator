# Phase 0 Research: M5 Review Feedback & Evidence Completeness

Most decisions were resolved in the ADR + spec clarifications; this records what the plan relies on.

- **R1 — Feedback schema source.** Fixed V1 baseline (master §13.2 categoricals) as a backend
  constant + optional per-package extras (manifest `feedback_schema`, already an empty field);
  effective = baseline ∪ extras; a package extra may not redefine a V1 key. (ADR D1, clarify.)

- **R2 — Field vocabulary + values.** `choice` and `text` (scale reserved for extras). Exact V1
  values per spec FR-002 table; `acceptance_reason`/`rejection_reason` = choice + optional note.

- **R3 — Traceability.** `FeedbackTarget` anchors to a specific log `event_ref` (index) so feedback
  is unique even for repeated actions; scopes run/decision/proposal/action; validated against the
  persisted log. (Master §14.4; ADR D3.)

- **R4 — Append-only + non-algorithmic.** Feedback is a new `FeedbackEvent` appended via the
  existing `EvidenceRecorder`/file store; it never mutates prior events, never alters a decision,
  never feeds an algorithm. (Constitution II/IV.)

- **R5 — Any persisted run (disk-backed append).** Active run → its in-registry recorder; inactive
  run → load `runs/<id>.json` → validate + append `FeedbackEvent` → `write_json_atomic` re-persist.
  The package for the effective schema is resolved from `RunLog.snapshot.package.id` via the
  registry. (Clarify Q3.)

- **R6 — Evidence export.** `GET /api/runs/{id}/evidence` derives the master §14.2 report from the
  persisted `RunLog`: report metadata + `simulator_facts` (route_snapshot, route_facts, event_plan,
  run_mode, evidence_status, initial+final params/hyperparams, driver/vehicle profiles, timeline,
  decision_trace, proposal_events, actions, expert_overrides-when-present, algorithm_errors,
  comparison-when-applicable) vs `human_review` (feedback_labels + free_text_comments). §14.3
  reproducibility data is present. (ADR D5; master §14.2/§14.3.)

- **R7 — RunLog profile persistence (gap to close).** `RunLog` currently lacks driver/vehicle/speed
  profiles (they live on `RunState`); the export needs them, so add them to `RunLog` and persist at
  `create_run` (the M2 carry-forward). Backward compatible (optional defaults).

- **R8 — ui_language.** No language selector exists; the export records a fixed V1 constant
  `ui_language: "bilingual"`. A real selector is deferred to M6. (Clarify Q2.)

- **R9 — Read-only timeline, no recalculation.** Upgrade the existing `RunLogViewer` (static JSON)
  into an ordered, expandable timeline rendered purely from the saved log; no algorithm re-run.
  (Master §13.9; ADR D4.) Visual scrubbable replay deferred to M6.

- **R10 — No new deps; offline tests.** Pure Python + React; Markdown export deferred (no MD lib).
  Per-package extras exercised via a test fixture package; shipped packages keep empty `feedback_schema`.
