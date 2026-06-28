# Feature Specification: M6 V1 Stabilization & UI/UX Polish

**Feature Branch**: `007-stabilization-uiux`

**Created**: 2026-06-28

**Status**: Draft

**Input**: User description: "The V1 release candidate — make the UC-01 simulator stable
enough for real review sessions: fix the UI blocker, separate setup onto its own screen,
add language switching, run management (reset/restart + a run list), a setup-time profile
editor, a visual scrubbable replay, Markdown evidence export, and a stabilization sweep —
so a reviewer can run UC-01 end-to-end without developer help."

## Overview

M0–M5 delivered the full UC-01 feature set (deterministic trigger evaluation, the Maps route
surface, and the human-review feedback + evidence loop). M6 is the **V1 release candidate**: it
makes the simulator *usable by a reviewer on their own* and folds in the requested UI/UX polish.

Concretely: fix the outstanding UI freeze that blocks interaction; move the dense setup
configuration onto a **dedicated Setup screen** (the review experience stays the accepted 3-panel
layout); let the reviewer **switch the UI language** (Japanese/English); **reset, restart, and
browse past runs**; **edit the driver/vehicle/speed behavior profiles** before a run; **visually
replay** a finished run from its saved log; and **export evidence as Markdown** in addition to
JSON. None of this changes the deterministic decision pipeline or the append-only evidence: profile
edits are frozen at run start, replay only renders recorded values, and the Maps key is still never
persisted (now explicitly verified).

Authoritative design:
`docs/superpowers/specs/2026-06-28-m6-stabilization-uiux-design.md`. Master scope: milestones §8 (M6
V1 stabilization).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Run UC-01 end-to-end without developer help (Priority: P1)

A reviewer opens the app, configures a run on the Setup screen (pick a package + scenario, optionally
tune values and behavior profiles, optionally enter a Maps route), starts the run, reviews the
playback + decision trace + proposal, records feedback, and finds/exports the evidence — all without
the UI freezing and without developer assistance.

**Why this priority**: This is the entire point of the V1 release candidate; if a reviewer can't run
the loop unaided, M6 has not met its goal.

**Independent Test**: From a fresh app load, complete the full loop (configure → run → review →
feedback → evidence) for each package type, with every control responsive and the playback animating.

**Acceptance Scenarios**:

1. **Given** a freshly loaded app, **When** the reviewer interacts with the setup and playback
   controls, **Then** every control is responsive (the prior "buttons unresponsive / no animation"
   freeze does not occur).
2. **Given** the Setup screen, **When** the reviewer picks a package + scenario and starts a run,
   **Then** the app switches to the review screen and the playback animates through the run.
3. **Given** a completed loop, **When** the reviewer reviews the run, **Then** the rule-based,
   weighted-score, Python, and transparent-hybrid packages all work end-to-end.

---

### User Story 2 - Configure a run on a dedicated Setup screen (Priority: P1)

A reviewer does all pre-run configuration — package, scenario, parameters, hyperparameters, behavior
profiles, and (optionally) a Maps route — on a roomy **Setup screen**, then starts the run, which
switches to the review screen. A clear affordance returns from review to a new setup.

**Why this priority**: The current single-panel setup is too cramped for the full configuration
(especially the profile editor); separating it is the core UX restructuring that makes the rest usable.

**Independent Test**: Configure a run entirely on the Setup screen, start it (lands on the review
screen), then return to Setup for a new run.

**Acceptance Scenarios**:

1. **Given** the app on the Setup screen, **When** the reviewer configures and starts a run, **Then**
   the app switches to the review screen (the accepted 3-panel layout) and the setup controls are not
   in the way.
2. **Given** the review screen, **When** the reviewer chooses "new run", **Then** the app returns to
   the Setup screen with the current run cleared.

---

### User Story 3 - Switch the UI language (Priority: P2)

A reviewer toggles the UI between Japanese and English; all bilingual labels (package/scenario names,
proposals, explanations, feedback labels, notices) render cleanly in the chosen language, and the
exported evidence records the language that was used.

**Why this priority**: Master-required for V1; affects readability for the intended reviewers, but the
loop works without it.

**Independent Test**: Toggle the language; confirm all labels switch and never show raw data or both
languages at once; confirm the evidence export records the selected language.

**Acceptance Scenarios**:

1. **Given** any screen, **When** the reviewer switches language, **Then** every bilingual label
   renders in that single language (never both, never raw data).
2. **Given** a chosen language, **When** the reviewer exports evidence, **Then** the export records the
   selected language (not a fixed placeholder).

---

### User Story 4 - Manage and revisit runs (Priority: P2)

A reviewer resets to start over, restarts the same configured run from the beginning, and browses a
list of past runs to reopen any one's evidence read-only.

**Why this priority**: Real review sessions need to redo and revisit runs; master-required for V1.

**Independent Test**: Reset (back to a clean Setup); restart a run from the same plan; open the run
list and reopen a past run's evidence.

**Acceptance Scenarios**:

1. **Given** an active or finished run, **When** the reviewer resets, **Then** the run is cleared and
   the app is ready for a new setup.
2. **Given** a configured run, **When** the reviewer restarts, **Then** a fresh run begins from the
   start using the same configuration (no re-setup needed).
3. **Given** past runs exist, **When** the reviewer opens the run list and selects one, **Then** that
   run's evidence (timeline + export + visual replay) opens read-only.

---

### User Story 5 - Edit behavior profiles before a run (Priority: P2)

A reviewer edits the driver, vehicle, and speed behavior profiles (pre-filled from the scenario) on the
Setup screen before starting a run; the edited profiles drive that run, are frozen for its duration,
and appear in the run's evidence. "Reset to scenario default" restores the originals.

**Why this priority**: Requested enhancement enabling behavior experimentation; the loop works with the
scenario defaults if skipped.

**Independent Test**: Edit a profile field, start a run, confirm the run used the edited value (visible
in the run's evidence) and that it could not change mid-run; reset-to-default restores the scenario value.

**Acceptance Scenarios**:

1. **Given** the Setup screen with a scenario selected, **When** the reviewer edits a profile field and
   starts a run, **Then** the run uses the edited value and the run's evidence records it.
2. **Given** an edited profile, **When** the run is underway, **Then** the profile cannot be changed
   mid-run (frozen at run start); changing it requires a new run.
3. **Given** edited profiles, **When** the reviewer chooses "reset to scenario default", **Then** the
   scenario's original profile values are restored.
4. **Given** an invalid profile value, **When** the reviewer tries to start the run, **Then** it is
   rejected with a clear error and no run starts.

---

### User Story 6 - Visually replay a finished run (Priority: P2)

A reviewer opens a past run and **replays it visually** — scrubbing/stepping through the recorded ticks
in the full playback view (cockpit, route/map, decision trace) — entirely from the saved log, with no
re-running of the algorithm.

**Why this priority**: Requested enhancement; the structured evidence timeline (M5) already satisfies
the master's read-only review requirement, so visual replay is additive.

**Independent Test**: Open a finished run, scrub to several ticks, confirm the playback view shows each
recorded tick's state/decision/markers, and confirm no algorithm recalculation occurs.

**Acceptance Scenarios**:

1. **Given** a finished run, **When** the reviewer opens its visual replay and scrubs to a tick, **Then**
   the playback view shows that tick's recorded state, decision, and markers.
2. **Given** the visual replay, **When** it renders, **Then** it reproduces recorded values only, with no
   algorithm recalculation.

---

### User Story 7 - Export evidence as Markdown (Priority: P3)

A reviewer exports a run's evidence as a human-readable **Markdown** document (in addition to JSON), with
simulator facts and human review clearly separated.

**Why this priority**: Convenience/readability enhancement; JSON export (M5) already meets the required
evidence-export criterion.

**Independent Test**: Export a run's evidence as Markdown; confirm it has a simulator-facts section and a
separate human-review section, and never claims the simulator judged the algorithm.

**Acceptance Scenarios**:

1. **Given** a finished run, **When** the reviewer exports Markdown, **Then** the document separates a
   simulator-facts section from a human-review section and is human-readable.
2. **Given** the Markdown export, **When** read, **Then** it does not claim the simulator independently
   judged the algorithm.

---

### Edge Cases

- **The UI freeze must not recur** — a regression guard covers the prior "unresponsive / no animation"
  condition.
- **No package/scenario selected** → start is unavailable with a clear prompt, not a broken state.
- **Invalid profile override** → rejected with a clear error; no run starts; evidence unaffected.
- **Opening an old/partial run** → its timeline and visual replay render whatever was recorded, read-only.
- **A reviewer with no Maps key** → the local-route path works unchanged; no key is ever stored.
- **Language toggle mid-session** → all labels switch immediately; recorded decisions/values are unchanged.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The app MUST be fully interactive — every control responsive and the playback animating —
  with a regression guard against the prior "buttons unresponsive / no animation" freeze.
- **FR-002**: Pre-run configuration (package, scenario, parameters, hyperparameters, behavior profiles,
  optional Maps route) MUST be presented on a dedicated **Setup screen**; starting a run switches to the
  **review screen** (the existing accepted 3-panel layout), and a clear affordance returns to a new setup.
- **FR-003**: The reviewer MUST be able to switch the UI language (Japanese/English); all bilingual labels
  MUST render in the single chosen language (never both, never raw data); the selection is session-only
  (not persisted to disk).
- **FR-004**: The exported evidence MUST record the actually-selected UI language (not a fixed placeholder).
- **FR-005**: The reviewer MUST be able to **reset** (clear the run, return to Setup), **restart** (begin a
  fresh run from the same configuration without re-setup), and browse a **list of past runs** (from the
  persisted logs) and reopen any run's evidence read-only.
- **FR-006**: The reviewer MUST be able to edit every driver/vehicle/speed behavior-profile field on the
  Setup screen (pre-filled from the selected scenario), with "reset to scenario default". Edits are
  setup-time-only overrides, validated, **frozen at run start**, used by the run, and recorded in the run's
  evidence; they MUST NOT be changeable mid-run.
- **FR-007**: An invalid profile value MUST be rejected with a clear error and MUST NOT start a run.
- **FR-008**: The reviewer MUST be able to **visually replay** a finished run — scrub/step through the
  recorded ticks in the full playback view — rendered entirely from the saved log with **no algorithm
  recalculation**.
- **FR-009**: The reviewer MUST be able to export a run's evidence as **Markdown** (in addition to JSON),
  separating simulator facts from human review, and never claiming the simulator judged the algorithm.
- **FR-010**: Errors and notices across the app (setup, validation, run, Maps, feedback) MUST be surfaced
  to the reviewer legibly and consistently.
- **FR-011**: The Maps key MUST be provably never persisted — absent from any saved run log and from any
  browser storage — verified explicitly.
- **FR-012**: The full UC-01 loop MUST work end-to-end for all package types (rule-based, weighted-score,
  Python, transparent-hybrid) and with the Maps route surface, and the setup instructions MUST let a
  reviewer do this without developer help.

### Key Entities

- **App view mode**: which screen is shown — Setup or Review.
- **UI language**: the reviewer's chosen display language (Japanese/English), session-only.
- **Profile override**: a reviewer-edited driver/vehicle/speed behavior profile, frozen at run start.
- **Run list entry**: a summary of a persisted run (identity, package, scenario, status, created time).
- **Replay state**: the current tick position when visually replaying a persisted run, read-only.
- **Markdown evidence**: the human-readable rendering of the evidence report, facts separated from review.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A reviewer can complete the full UC-01 loop (configure → run → review → feedback → evidence)
  unaided, for every package type, with all controls responsive and the playback animating.
- **SC-002**: The prior "buttons unresponsive / no animation" freeze does not recur (guarded).
- **SC-003**: Setup configuration is on a dedicated Setup screen; starting a run lands on the review screen;
  returning to setup clears the run.
- **SC-004**: Switching language renders every label in one language (never both/raw); the evidence export
  records the selected language.
- **SC-005**: Reset, restart-from-same-configuration, and the run list (reopening a past run's evidence
  read-only) all work.
- **SC-006**: An edited profile drives its run, is visible in that run's evidence, cannot change mid-run, and
  reset-to-default restores the scenario value; an invalid value blocks the run with a clear error.
- **SC-007**: A finished run can be visually replayed by scrubbing the recorded ticks with no algorithm
  recalculation.
- **SC-008**: Evidence exports as Markdown with facts separated from human review.
- **SC-009**: The Maps key is provably absent from every saved log and from browser storage.

## Assumptions

- **Stack/architecture fixed by the M6 ADR and master docs**: existing FastAPI/Pydantic backend +
  React/Vite frontend, file-based runs, the existing run-plan/run/evidence model. This spec states *what*;
  the ADR/plan own *how* (the view-mode toggle, the language helper, the profile-override threading, the
  replay source, the Markdown formatter).
- **One large milestone built as internal slices**, ordered so the V1 release candidate is shippable; the
  bug fix lands first.
- **No new dependencies** (no router, i18n, or Markdown library); the language selection and Maps key are
  not persisted to disk.
- **Out of scope** (later/never for V1): run comparison, expert-override mode, accounts/auth/multi-user/cloud.
- **The deterministic decision pipeline and append-only evidence are unchanged**: profile overrides are
  frozen at run start; replay only renders recorded values; feedback/evidence remain append-only and
  facts/review-separated.
