---
description: "Task list for M5 Review Feedback & Evidence Completeness"
---

# Tasks: M5 Review Feedback & Evidence Completeness

**Input**: Design documents from `/specs/006-review-feedback-evidence/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: INCLUDED (TDD; the contract surfaces — feedback schema/validation, append [active +
disk-backed], the evidence export separation, the read-only timeline — tested first). Test tasks
precede implementation and MUST FAIL first.

**Organization**: by user story. US1 (record feedback) is the core; US2 (timeline review) and US3
(evidence export) build on the persisted log. MVP = Foundational + US1 + US2.

## Format: `[ID] [P?] [Story] Description`
Backend `app/api/aica_api/`, tests `app/api/tests/`; frontend `app/frontend/src/`, tests
`app/frontend/tests/`.

---

## Phase 1: Setup
- [ ] T001 Add a test fixture package under `app/api/tests/fixtures/` that declares extra
  `feedback_schema` fields (to exercise the baseline ∪ extras + collision paths); shipped packages
  keep empty `feedback_schema`.

## Phase 2: Foundational (Blocking — models)
- [ ] T002 [P] NEW `models/feedback.py` (+ `tests/test_feedback_models.py`): `FieldDef` (key,
  label{ja,en}, type choice|text|scale, options?/note?/min?/max?), `V1_FEEDBACK_SCHEMA` (the 9 master
  §13.2 labels per spec FR-002 table — choice fields with exact options; acceptance_reason/
  rejection_reason = choice + optional note), `FeedbackTarget` (scope, event_ref?, tick_index?,
  proposal_id?, action?), `FeedbackEvent` (kind:"feedback", target, labels, comment).
- [ ] T003 [P] EXTEND `models/log.py` (+ test_models): add `FeedbackEvent` to the `Event`
  discriminated union; add `driver_profile`/`vehicle_profile`/`speed_profile` (dict|None=None) to
  `RunLog`; persist them at `run_manager.create_run` (M2 carry-forward). M1–M4 logs still valid.

**Checkpoint**: the log schema carries feedback + profiles.

---

## Phase 3: User Story 1 - Record structured + free-text feedback (Priority: P1) 🎯 MVP core

**Goal**: a reviewer submits validated, traceable feedback that persists append-only and never alters facts.

**Independent Test**: POST feedback at a proposal + at end-of-run → both persisted, traceable, decisions unchanged; invalid → 400, nothing appended.

- [ ] T004 [US1] Write failing `tests/test_feedback_schema.py` then implement
  `services/feedback.py::effective_schema(package)` = V1 baseline ∪ package extras; a package extra
  redefining a V1 key → error. (Use the T001 fixture.)
- [ ] T005 [US1] Write failing `tests/test_feedback_api.py` validation matrix (valid full; valid
  comment-only; unknown label key → 400; choice value not in options → 400; non-run target with
  missing/wrong-kind `event_ref` → 400) then implement `services/feedback.py::validate(payload,
  schema, run_log)`.
- [ ] T006 [US1] Implement `services/feedback.py::append_feedback` + `run_manager.append_feedback`:
  **active** run → via its `EvidenceRecorder`; **inactive/on-disk** run → load `runs/{id}.json` →
  append `FeedbackEvent` → `write_json_atomic`. Test BOTH paths persist; the prior decision trace is
  byte-for-byte unchanged after feedback (non-algorithmic).
- [ ] T007 [US1] `routers/runs.py`: `POST /api/runs/{id}/feedback` (validate → append → 201 / 400)
  and `GET /api/runs/{id}/feedback-schema` (effective schema; package resolved from the log
  snapshot; works for active + on-disk runs). Router tests.
- [ ] T008 [US1] Frontend `components/feedback/FeedbackForm.tsx` (NEW): fetch the effective schema,
  render fields by type (choice→radio/select, choice+note→select+textarea, text→textarea) + free-text
  comment; submit with the attach-point target; surfaced after a proposal/action, at end-of-run, and
  per-decision in the trace. `api/types.ts`+`client.ts` (submitFeedback/getFeedbackSchema) +
  `state/runStore.ts` light state. `tests/feedback.test.tsx` (renders by type + submits + a fixture extra field).

**Checkpoint**: feedback is recorded, validated, traceable, append-only.

---

## Phase 4: User Story 2 - Read-only evidence timeline (Priority: P1)

**Goal**: review a persisted run as an ordered, read-only timeline with no recalculation.

**Independent Test**: open a persisted run → events render in order, feedback distinct, no algorithm re-run.

- [ ] T009 [US2] Upgrade `components/runs/RunLogViewer.tsx` into an ordered, expandable evidence
  **timeline**: tick (+ decision trace) / proposal / action / **feedback** / algorithm_error, each
  expandable, feedback visually distinct from simulator facts; rendered purely from the saved log
  (no recalculation). `tests/runlog.test.tsx` (renders events in order incl. feedback distinctly).

**Checkpoint**: persisted runs are reviewable read-only.

---

## Phase 5: User Story 3 - Evidence export separating facts from review (Priority: P2)

**Goal**: export the run as JSON with simulator facts separated from human review.

**Independent Test**: export a run with feedback → §14.2 contents present, feedback only under human_review, reproducibility data present.

- [ ] T010 [US3] Write failing `tests/test_evidence_export.py` then implement
  `services/evidence.py::build_evidence_report(run_log)` → the master §14.2 report
  `{report meta, simulator_facts, human_review}` derived from the persisted log; feedback ONLY under
  `human_review` (labels vs free_text_comments split); conditional sections present only when
  applicable; §14.3 reproducibility fields present; ui_language fixed "bilingual".
- [ ] T011 [US3] `routers/runs.py`: `GET /api/runs/{id}/evidence` (active + on-disk). Router test.
- [ ] T012 [US3] Frontend: copy-to-clipboard + download of the evidence JSON (buttons in the
  evidence view); `api/types.ts`+`client.ts` (`getEvidence`, EvidenceReport type). `tests` for copy/download.

**Checkpoint**: portable evidence with facts vs review cleanly separated.

---

## Phase 6: Polish & e2e
- [ ] T013 Backend e2e (`test_api_run_loop.py`): run → POST feedback at a proposal + end-of-run →
  GET /log shows the feedback events → GET /evidence separates simulator_facts vs human_review and
  contains the reproducibility data; decisions unchanged by feedback.
- [ ] T014 [P] Update root `README.md` with the M5 flow (record feedback, review the evidence
  timeline, export evidence) from quickstart.md.
- [ ] T015 Run `quickstart.md` validation end-to-end (controller, docker): record feedback, view the
  timeline, export evidence; confirm facts vs review separation + no key/secret; both suites green.

---

## Dependencies & Execution Order
- **Setup (T001)** → fixture. **Foundational (T002–T003)** → blocks all stories.
- **US1 (T004–T008)** → the core; feedback service is the root for the API + form.
- **US2 (T009)** → after the log carries feedback (T003); independent of US1 internals (renders any log).
- **US3 (T010–T012)** → after the log model (T003); the export derives from it (feedback under human_review).
- **Polish (T013–T015)** → after US1–US3.

### Parallel Opportunities
- T002, T003 (separate model files) parallel. T009 (timeline) ∥ US3 backend. T014 ∥ in polish.

## Implementation Strategy
**MVP** = Setup → Foundational → US1 (record feedback) + US2 (timeline). STOP & validate feedback is
recorded + reviewable. US3 (export) folds in next.

## Notes
- TDD: every test task precedes its impl and MUST fail first.
- Append-only + non-algorithmic: feedback never alters a prior event/decision or feeds an algorithm
  (assert the decision trace is unchanged after feedback). NO new deps.
- Any persisted run: feedback/schema/evidence work for active AND on-disk runs (disk-backed append).
- Separation invariant: feedback ONLY under human_review in the export; facts never contain feedback.
- Total: 15 tasks (T001–T015).
