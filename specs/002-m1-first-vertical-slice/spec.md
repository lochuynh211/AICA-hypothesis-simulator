# Feature Specification: M1 First Runnable Vertical Slice

**Feature Branch**: `002-m1-first-vertical-slice`

**Created**: 2026-06-27

**Status**: Draft

**Input**: User description: "M1 First Runnable Vertical Slice — one rule-based package + one UC-01 fatigue scenario, loaded by registries, run through a deterministic tick engine and one algorithm-adapter contract, producing a full decision trace and an auto-persisted JSON run log, reviewed in a close-to-skeleton 3-panel UI with accept/postpone actions; the same loop also works backend-only."

## Overview

M1 proves the smallest **useful** AICA review loop end-to-end. A reviewer selects
the one available hypothesis package and the one UC-01 fatigue scenario, plays
back a deterministic drive, watches the assistant evaluate at each tick, reaches a
single rest proposal, acts on it, inspects the decision trace, and finds an
automatically persisted evidence log. The same loop is exercisable through the
backend API without the frontend. Authoritative design:
`docs/superpowers/specs/2026-06-27-m1-first-vertical-slice-design.md`.

## Clarifications

### Session 2026-06-27

- Q: How does the backend advance the simulation per tick? → A: Each tick advances simulation time by a fixed step; route position is derived from elapsed time over the scenario's total duration; the run is bounded by that total duration. (Aligns with the master runtime workflow's numeric tick model; the qualitative bands the trigger consumes are derived from this state, not the raw values.)
- Q: Does the rule-based algorithm produce a numeric score? → A: Yes — it computes an ordinal blend score from the banded inputs (as the functional skeleton does) and populates the score on the decision result and the firing candidate; the decision itself remains first-match rule classification.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Review a UC-01 fatigue drive end-to-end (Priority: P1)

A reviewer opens the app, selects the rule-based rest package and the UC-01
fatigue scenario, starts playback, advances the drive until the assistant proposes
a rest, accepts (or postpones) the proposal, and confirms an evidence log was saved.

**Why this priority**: This is the MVP — the whole point of the simulator is to
review one hypothesis decision on one scenario and capture evidence. Everything
else supports or inspects this loop.

**Independent Test**: From a fresh start, run the selected package+scenario, reach
the rest proposal, act on it, and verify a run-log file now exists for that run.

**Acceptance Scenarios**:

1. **Given** the app is open with the package and scenario available, **When** the
   reviewer selects both and starts a run, **Then** a run is created and playback
   can begin.
2. **Given** a run is playing, **When** the drive advances to the fatigue decision
   point, **Then** the assistant presents exactly one rest proposal and the run
   pauses for the reviewer.
3. **Given** a rest proposal is shown, **When** the reviewer chooses accept or
   postpone, **Then** the choice is recorded and the run reflects the outcome.
4. **Given** the reviewer has completed the proposal interaction, **When** they
   look for the run's evidence, **Then** a persisted run log for that run exists
   and contains the decision and the action.

---

### User Story 2 - Inspect the decision trace and persisted evidence (Priority: P2)

A reviewer examines, for each evaluated tick, what the assistant decided and why —
the result type, the candidate(s) including any suppressed ones, the fire-control
outcome, the reasons, and the explanation — and can open the auto-saved evidence
log for the run.

**Why this priority**: A decision the reviewer cannot inspect is not reviewable.
The trace and persisted evidence are what make the loop trustworthy, but they
depend on US1's loop existing first.

**Independent Test**: After running to the proposal, open the trace and confirm it
shows per-tick decision entries (including a suppressed candidate where one
applies) and that the evidence log content is viewable.

**Acceptance Scenarios**:

1. **Given** a run has produced decisions, **When** the reviewer views the trace,
   **Then** each evaluated tick shows its result type, selected category, score,
   candidates, fire-control outcome, reason inputs, and explanation.
2. **Given** a candidate was suppressed, **When** the reviewer views the trace,
   **Then** the suppressed candidate remains visible and is marked as suppressed
   (not dropped).
3. **Given** a run exists, **When** the reviewer opens the evidence log view,
   **Then** the persisted evidence for that run is displayed.

---

### User Story 3 - Drive the same loop backend-only (Priority: P3)

An operator (or automated test) performs the full create-run → tick (evaluation
happens inside each tick) → act → read-evidence loop directly through the backend
interface, with no frontend involved, and gets the same decisions and persisted
evidence.

**Why this priority**: Confirms the backend is the source of truth and the loop is
not dependent on the UI — a constitutional requirement and a milestone acceptance
criterion — but it is verification of US1's mechanism rather than new user value.

**Independent Test**: Drive create-run, repeated ticking until the proposal, the
action, and evidence retrieval entirely through the backend interface; confirm the
same proposal and a persisted log.

**Acceptance Scenarios**:

1. **Given** no frontend is used, **When** the operator creates a run and repeatedly
   ticks, **Then** the same single rest proposal is reached deterministically.
2. **Given** the backend-only run reached a proposal, **When** the operator records
   an action and retrieves the evidence, **Then** the persisted log matches what a
   UI-driven run would produce.

---

### User Story 4 - Invalid package or scenario fails visibly (Priority: P3)

When a package manifest or scenario file is invalid, or a package and scenario are
incompatible, the system refuses to start a run and surfaces a clear error rather
than silently ignoring the file or producing a misleading decision.

**Why this priority**: Honest failure is a constitutional boundary, but for M1 with
curated fixtures it is an edge-protection requirement rather than a primary flow.

**Independent Test**: Point the system at an invalid manifest/scenario (or an
incompatible pairing) and confirm a visible error and that no run can start with it.

**Acceptance Scenarios**:

1. **Given** an invalid package manifest, **When** the registry loads packages,
   **Then** that package is reported as invalid with a clear error and cannot be
   selected for a run.
2. **Given** a package and scenario that are not compatible, **When** the reviewer
   attempts to start a run with them, **Then** the run is refused with a clear
   compatibility error.

---

### Edge Cases

- **Algorithm failure**: if the decision logic raises an error or returns an
  unusable result during a tick, the system records it as an explicit error event
  in the evidence and shows it as an error — never as a normal assistant decision.
- **Action with no pending proposal**: an action submitted when no proposal is
  awaiting a choice is rejected and does not corrupt run state.
- **Advancing past the end of the route**: ticking beyond the end of the drive
  stops advancing rather than producing undefined state.
- **Interruption mid-run**: because evidence is persisted after every meaningful
  event, a refresh or container stop does not lose the decisions/actions already
  recorded.
- **Re-running**: starting a new run produces a new, separate evidence log; prior
  logs are not overwritten.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST discover and load the available hypothesis package(s)
  and scenario(s) from local files and present them for selection.
- **FR-002**: The system MUST validate each package manifest and scenario file on
  load; an invalid file MUST be reported with a clear error and MUST NOT be usable
  for a run (no silent skip, no partial load).
- **FR-003**: The system MUST verify package/scenario compatibility before creating
  a run and refuse incompatible pairings with a clear error.
- **FR-004**: The system MUST create a run that freezes a snapshot of the chosen
  package, scenario, and a generated deterministic event plan at run start, and
  MUST record an initial evidence log at that moment.
- **FR-005**: The system MUST advance the drive deterministically: each tick
  advances simulation time by a fixed step, route position is derived from elapsed
  time over the scenario's total duration, and the run is bounded by that duration.
  The same scenario and choices MUST produce the same sequence of decisions and the
  same trace on every run.
- **FR-006**: The system MUST evaluate the hypothesis at each advance through a
  single common decision contract, regardless of algorithm type, and MUST produce a
  normalized decision result for each evaluation.
- **FR-007**: The decision result MUST capture, where applicable, the result type,
  whether a trigger candidate exists, the selected category, a score, the
  candidate(s) with their fire-control outcome, the overall fire-control outcome,
  the proposal (when one fires), the reasons that drove the decision, and a
  human-readable explanation. For the M1 rule-based algorithm, the score is an
  ordinal blend computed from the banded inputs, populated on the result and the
  firing candidate, while the decision remains first-match rule classification.
- **FR-008**: Suppressed candidates MUST be preserved in the decision result and
  marked as suppressed, never dropped.
- **FR-009**: For the UC-01 fatigue scenario, the drive MUST reach exactly one rest
  proposal, at which point the run MUST pause for reviewer interaction.
- **FR-010**: When a decision fires a proposal, the reviewer MUST be able to record
  an allowed action (accept rest or postpone); the system MUST validate the action
  against the run's allowed actions and apply the resulting state change.
- **FR-011**: If evaluation fails (error or unusable result), the system MUST record
  an explicit algorithm-error event in the evidence and surface it as an error,
  never as a normal assistant decision.
- **FR-012**: The system MUST append to an evidence log and persist it after every
  meaningful event (run creation, each evaluation, each action, each error) so
  nothing is lost on interruption; prior entries MUST NOT be rewritten.
- **FR-013**: The evidence log MUST contain the run identifier, the package and
  scenario snapshots, the frozen event plan, the per-tick decision trace, action
  events, and any error events.
- **FR-014**: The system MUST expose the full loop — list/select package and
  scenario, create run, evaluate, act, list runs, read a run, and read a run's
  evidence — through a programmatic interface usable without the frontend.
- **FR-015**: The reviewer-facing experience MUST present three regions: drive
  context (package/scenario, route segments, live readouts), playback and the
  in-cockpit proposal, and the decision trace plus the persisted evidence view.
  The persisted evidence view is a **static display** of the saved log JSON;
  read-only evidence **replay playback** is out of scope for M1 (M5).
- **FR-016**: The reviewer-facing experience MUST display decisions and evidence
  produced by the backend and MUST NOT itself originate or alter any decision or
  recorded evidence (it may compute display-only animation/progress).
- **FR-017**: No raw value originating outside the simulator may drive a trigger
  decision directly; route quantities MUST be reduced to ordinal bands before they
  reach the decision logic. (For M1's local scenario these bands are authored
  directly; the reduction seam still exists server-side.)

### Key Entities

- **Package**: a hypothesis definition — metadata, the inputs it consumes, its
  configurable values, its decision/algorithm type, its trigger categories,
  fire-control, and proposal definitions.
- **Scenario**: a UC-01 drive definition — persona, route (ordinal segments and
  rest opportunity), initial state, and deterministic event presets.
- **Event Plan**: the concrete, frozen-at-run-start schedule derived from the
  scenario that makes the run deterministic.
- **Run**: an instance of a package evaluated against a scenario, with its frozen
  snapshots and evolving state.
- **Decision Result / Trace Entry**: the normalized outcome of one evaluation —
  result type, category, score, candidates (incl. suppressed), fire-control,
  proposal, reasons, explanation.
- **Action**: a reviewer choice on a proposal (accept rest / postpone).
- **Run Log (Evidence)**: the append-only persisted record of a run.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A reviewer can go from app open to a saved evidence log for a UC-01
  run — selecting the package and scenario, reaching the rest proposal, and acting —
  without developer assistance.
- **SC-002**: Running the UC-01 scenario reaches exactly one rest proposal, every
  time, with no other proposal firing.
- **SC-003**: Running the same scenario and making the same choices twice produces
  identical decision traces.
- **SC-004**: After the proposal interaction, a persisted evidence log for the run
  exists and contains the decision trace and the recorded action.
- **SC-005**: The decision trace for the run shows, for the firing tick, the result
  type, the candidate(s) including any suppressed candidate, the fire-control
  outcome, the reasons, and an explanation.
- **SC-006**: The full create-run → tick (evaluation inside the tick) → act →
  read-evidence loop can be completed through the backend interface alone, producing
  the same proposal and a persisted log as the UI-driven loop.
- **SC-007**: An invalid package or scenario, or an incompatible pairing, is
  reported as an error and cannot be used to start a run.
- **SC-008**: An evaluation failure appears in the evidence as an explicit error
  event and is never shown or recorded as a normal assistant decision.

## Assumptions

- **Stack and architecture are fixed by the M1 ADR and the master architecture
  doc**: FastAPI/Pydantic backend building on M0, React/TypeScript/Vite frontend,
  file-based packages/scenarios/runs, the §11 decision-result contract, and the
  single algorithm-adapter pattern. This spec states *what* the loop must do; the
  ADR/plan own *how*.
- **One package, one scenario, one algorithm type** in M1: a built-in rule-based
  rest package and a UC-01 fatigue scenario. Weighted-score and Python algorithms,
  a second scenario, and the editable setup/run-plan flow are later milestones.
- **Deterministic local route**; no external mapping service in M1 (Google Maps is
  M4). The route is expressed as ordinal segments/fractions.
- **Minimal proposal actions only** (accept rest / postpone). Structured feedback
  capture and read-only evidence replay are M5.
- **Local, single-user, no authentication** (constitution: local-first).
- **Close-to-skeleton but rough-acceptable UI**: layout and functionality mirror
  the accepted/functional reference skeletons; visual polish and full
  bilingual/UX tightening are M6.
