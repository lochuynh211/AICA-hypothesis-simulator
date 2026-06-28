# Feature Specification: M5 Review Feedback & Evidence Completeness

**Feature Branch**: `006-review-feedback-evidence`

**Created**: 2026-06-28

**Status**: Draft

**Input**: User description: "Complete the human-review evidence loop for V1: structured +
free-text feedback captured during a run, persisted as append-only evidence; a read-only
view of a persisted run from its saved log without recalculating decisions; and an evidence
export that clearly separates what the simulator did from what the human reviewer thought."

## Overview

Today the simulator runs a scenario, records a full decision trace, and persists an
append-only run log — but the reviewer has **no way to record their judgment** of what the
AICA assistant did, and **no consolidated way to review or export** a finished run as
evidence. M5 closes that loop.

A reviewer can attach **structured feedback** (a fixed set of V1 review labels) and
**free-text comments** to a run — at a specific decision point, a specific proposal, a
specific action they took, or for the run overall. Feedback is **append-only evidence**: it
is recorded alongside the simulator's own events, **never changes what the simulator did**,
and **never influences any algorithm**. The simulator never auto-judges the algorithm as
good or bad — judgment is the human's.

A reviewer can also open any persisted run as a **read-only evidence timeline** — the
recorded ticks, decisions, proposals, actions, feedback, and errors in order — rendered
**from the saved log without re-running the algorithm**. And they can **export the run as
evidence JSON** (copy or download) in which the **simulator-generated facts are clearly
separated from the human review** comments, suitable for later discussion and requirement
refinement.

Authoritative design:
`docs/superpowers/specs/2026-06-28-m5-review-feedback-evidence-design.md`. Master scope:
specification §13 (feedback) + §14 (evidence report), architecture §7.4 + §13.8–13.9.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Record structured + free-text feedback on a run (Priority: P1)

A reviewer, while or after running a scenario, records their judgment of the assistant's
behavior using a set of review labels (timing, safety impression, intrusiveness,
understandability, rest-spot suitability, content suitability, acceptance/rejection reason,
overall judgment) and a free-text comment — attached to a specific decision, proposal,
action, or to the whole run.

**Why this priority**: Capturing human judgment is the core purpose of M5 — without it the
evidence loop is incomplete.

**Independent Test**: Run a scenario to a proposal; submit structured + free-text feedback
attached to that proposal and again at end of run; confirm both are recorded in the persisted
log, each traceable to its target, and that nothing about the simulator's recorded decisions
changed.

**Acceptance Scenarios**:

1. **Given** a run with a fired proposal, **When** the reviewer submits review labels + a
   comment attached to that proposal, **Then** the feedback is persisted in the run log,
   traceable to that specific proposal, and the run's decisions are unchanged.
2. **Given** the run has ended, **When** the reviewer submits an overall judgment + comment
   for the run, **Then** a run-scoped feedback record is persisted.
3. **Given** the reviewer submits an invalid feedback value (a label value outside its
   allowed set, or a target that doesn't reference a real recorded event), **When** it is
   submitted, **Then** it is rejected with a clear error and **nothing is recorded**.
4. **Given** the same kind of action occurs more than once in a run, **When** the reviewer
   gives feedback on one specific occurrence, **Then** the feedback is traceable to that exact
   occurrence (not ambiguous across repeats).

---

### User Story 2 - Review a persisted run as a read-only evidence timeline (Priority: P1)

A reviewer opens a finished run and sees its recorded events — ticks with their decision
trace, proposals, actions, feedback, and any algorithm errors — as an ordered, expandable
timeline, rendered entirely from the saved log.

**Why this priority**: Inspecting persisted evidence in the browser is a required V1
capability and the surface the feedback and export build on.

**Independent Test**: Open a persisted run; confirm the timeline shows its recorded events in
order (including any feedback, visually distinct from simulator facts), and that opening it
performs **no** algorithm recalculation.

**Acceptance Scenarios**:

1. **Given** a persisted run log, **When** the reviewer opens its evidence view, **Then** the
   recorded events render in order as an expandable timeline, with human feedback visually
   distinguished from simulator-generated facts.
2. **Given** the evidence view is open, **When** it renders, **Then** it reproduces the
   recorded decisions exactly as saved, **without** re-running the algorithm.

---

### User Story 3 - Export a run as evidence separating facts from review (Priority: P2)

A reviewer exports a finished run as evidence — copy to clipboard or download — in a form
that clearly separates the simulator-generated facts from the human review comments, suitable
for later discussion.

**Why this priority**: Export makes the evidence portable and is a required V1 deliverable; it
depends on feedback (US1) and the persisted log (US2).

**Independent Test**: Export a run with feedback; confirm the export contains the required
report contents, that human feedback appears **only** in the human-review section (never mixed
into the facts), and that the facts section carries enough to reproduce the run.

**Acceptance Scenarios**:

1. **Given** a finished run with feedback, **When** the reviewer exports its evidence, **Then**
   the export separates a simulator-facts section (route snapshot, route facts, plan, profiles,
   setup values, timeline, decisions, proposals, actions, errors) from a human-review section
   (the review labels and free-text comments).
2. **Given** the export, **When** a stakeholder inspects it, **Then** it contains the data
   needed to reproduce the run and never claims the simulator independently judged the algorithm.
3. **Given** the reviewer chooses copy or download, **When** they trigger it, **Then** the
   evidence JSON is copied to the clipboard or downloaded as a file.

---

### Edge Cases

- **Invalid feedback** (label value not in its allowed set, unknown label key, or a target that
  doesn't reference a real recorded event) → rejected with a clear error; nothing is appended.
- **Empty feedback** (no labels, only a comment, or vice versa) → accepted; all fields optional.
- **Repeated events** (e.g. the same action twice) → feedback is anchored to the specific
  recorded occurrence so it is never ambiguous.
- **A package that defines extra review fields** → the form shows the V1 baseline plus those
  extra fields; a package that tries to redefine a V1 label is rejected.
- **Conditional report sections** (expert overrides, run comparison, changed setup values) →
  appear in the export only when they actually occurred; otherwise omitted.
- **Opening an old/partial run** → the evidence timeline renders whatever was recorded, read-only.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The reviewer MUST be able to submit structured review labels and a free-text
  comment for a run. The free-text comment MUST NOT force a single language.
- **FR-002**: The structured labels MUST include the V1 baseline set (proposal timing, safety
  impression, intrusiveness, understandability, rest-spot suitability, proposal-content
  suitability, acceptance reason, rejection reason, overall judgment), each constrained to its
  defined categorical values; all fields are optional.
- **FR-003**: A package MAY define additional review fields; the reviewer-facing form and the
  validation MUST then use the V1 baseline plus those extra fields. A package field that
  redefines a V1 label MUST be rejected.
- **FR-004**: Each feedback submission MUST be attachable to one of: the whole run, a specific
  decision point, a specific proposal, or a specific reviewer action; and MUST be uniquely
  traceable to that target even when similar events repeat.
- **FR-005**: Submitted feedback MUST be validated (label values within their allowed sets;
  target references a real recorded event of the matching kind). Invalid feedback MUST be
  rejected with a clear error and MUST NOT be recorded.
- **FR-006**: Accepted feedback MUST be persisted as an append-only record in the run's evidence
  log; it MUST NOT alter any recorded simulator decision and MUST NOT influence any algorithm.
- **FR-007**: The reviewer MUST be able to open a persisted run and see its recorded events
  (ticks + decision trace, proposals, actions, feedback, algorithm errors) as an ordered,
  read-only timeline, with human feedback visually distinguished from simulator facts.
- **FR-008**: The evidence view MUST render the persisted run **without recalculating** any
  algorithm decision — it reproduces what was recorded.
- **FR-009**: The reviewer MUST be able to export a run as evidence (copy to clipboard and
  download), structured so that simulator-generated facts are clearly separated from human
  review comments.
- **FR-010**: The evidence export MUST include the required report contents — report and run
  identity (ids, timestamp, language, simulator version, package and scenario id+version), the
  simulator facts (route snapshot, route-derived facts, generated plan, run mode and evidence
  status, initial and — when changed — final parameter and hyperparameter values, driver and
  vehicle profiles, timeline events, decision trace, proposal events, reviewer actions, expert
  overrides when any occurred, algorithm errors, run-comparison reference when applicable), and
  the human review (review labels and free-text comments) — and MUST carry enough to reproduce
  the run.
- **FR-011**: The evidence MUST NOT claim the simulator independently judged the algorithm;
  review judgment is recorded as the human reviewer's.

### Key Entities

- **Feedback record**: a reviewer's structured labels + free-text comment, attached to a target,
  recorded as append-only evidence.
- **Feedback target**: the specific thing the feedback is about — the run, a decision, a
  proposal, or a reviewer action — anchored to the exact recorded occurrence.
- **Effective feedback schema**: the V1 baseline review fields plus any package-defined extra
  fields, used to render the form and validate submissions.
- **Evidence report**: the exportable consolidation of a run, with simulator facts separated
  from human review.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A reviewer can record structured + free-text feedback attached to a decision,
  proposal, action, or the whole run, and see it persisted in the run's evidence.
- **SC-002**: Every feedback record is traceable to its exact target, unambiguously, even when
  similar events repeat in the run.
- **SC-003**: Submitting invalid feedback records nothing and returns a clear error.
- **SC-004**: Recording feedback never changes any recorded simulator decision and never alters
  the run's outcome (verifiable: the decision trace before and after feedback is identical).
- **SC-005**: A reviewer can open a persisted run and review its recorded events read-only, with
  no algorithm recalculation, and with human feedback visually distinct from simulator facts.
- **SC-006**: A reviewer can export a run as evidence JSON (copy or download) in which human
  review appears only in the human-review section and never mixed into the simulator facts.
- **SC-007**: The exported evidence contains everything needed to reproduce the run and does not
  claim the simulator judged the algorithm.

## Assumptions

- **Stack/architecture fixed by the M5 ADR and master docs**: existing FastAPI/Pydantic backend
  + React/Vite frontend, file-based append-only run logs, the existing run-log/recorder model.
  This spec states *what*; the ADR/plan own *how* (the feedback model + endpoints, the effective
  schema, the timeline viewer, the export endpoint).
- **The V1 feedback labels are the fixed master §13.2 categorical set**; packages may append extra
  fields but the V1 baseline is constant. Shipped packages keep an empty extra schema; the
  per-package-extras path is exercised by a test fixture.
- **Markdown export, a visual scrubbable replay, feedback edit/delete, cross-run analytics, the
  setup-change and run-comparison feedback scopes, expert-override events, and auth are out of
  scope** (later milestones); the export schema reserves the conditional sections for when those
  features exist.
- **Feedback is always optional and never blocks the run**; the simulator never auto-judges.
