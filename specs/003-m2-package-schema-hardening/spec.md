# Feature Specification: M2 Package & Schema Hardening

**Feature Branch**: `003-m2-package-schema-hardening`

**Created**: 2026-06-27

**Status**: Draft

**Input**: User description: "M2 Package & Schema Hardening — a second (weighted-score, multi-category) algorithm + package, a rich behavioral driver/vehicle simulation, a setup/run-plan flow with editable values, a second UC-01 scenario, and run-log completeness, so a reviewer can compare two hypotheses across two scenarios with edited setup and complete evidence."

## Overview

M2 makes the simulator support **multiple hypotheses safely**. It adds a second
built-in algorithm (multi-category weighted scoring) and package, replaces M1's
hardcoded fatigue schedule with a real deterministic driver/vehicle behavioral
simulation, introduces a setup step where the reviewer edits values and previews a
generated plan before starting, adds a second UC-01 scenario, and records complete
evidence (setup snapshot, generated plan, original + modified values). Authoritative
design: `docs/superpowers/specs/2026-06-27-m2-package-schema-hardening-design.md`.

## Clarifications

### Session 2026-06-27

- Q: Does the second algorithm change M1's single-algorithm contract? → A: No — both
  algorithms pass through the one evaluation contract and produce the same normalized
  decision shape; the second algorithm additionally populates the multi-category
  score/state/priority fields the first leaves empty.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Compare two hypothesis packages on the same drive (Priority: P1)

A reviewer selects either the rule-based package or the weighted-score package for a
UC-01 scenario, runs it, and inspects how each decides — the weighted-score package
showing per-category scores, multiple candidates (including a non-selected and a
suppressed one), and which candidate was selected by priority.

**Why this priority**: The headline M2 value is reviewing more than one hypothesis.
The second algorithm and its richer decision output are what "package hardening"
delivers.

**Independent Test**: Run each package against the same scenario; confirm both reach a
rest proposal and that the weighted-score run's trace shows category scores, multiple
candidates, and a selected category chosen by priority.

**Acceptance Scenarios**:

1. **Given** two packages are available, **When** the reviewer picks the weighted-score
   package and runs the scenario, **Then** the drive reaches a rest proposal and the
   trace shows per-category scores, candidate strengths, and the selected category.
2. **Given** a tick where a non-primary category is also active, **When** the reviewer
   views the trace, **Then** all candidates appear (selected, non-selected, and any
   suppressed), with the selected one chosen by the defined priority.
3. **Given** the same package, scenario, and choices, **When** the run is repeated,
   **Then** the decisions and trace are identical (deterministic).

---

### User Story 2 - Edit setup values and preview the plan before starting (Priority: P1)

Before starting, the reviewer edits the package's parameters and hyperparameters,
previews the generated event plan derived from the route and presets, optionally
regenerates it, and then starts the run — with the system rejecting any out-of-range
value with a clear message.

**Why this priority**: Editable setup before a run is a core M2 capability; without it
a reviewer cannot explore how tuning changes a hypothesis's behavior. The plan preview
is the architecture's setup flow.

**Independent Test**: Edit a hyperparameter to a valid value, preview and regenerate the
plan, start the run; separately, edit a value out of range and confirm a clear error and
that no run starts.

**Acceptance Scenarios**:

1. **Given** a selected package and scenario, **When** the reviewer edits a parameter to a
   valid value and requests a plan, **Then** a draft plan summary is shown and can be
   regenerated.
2. **Given** an edited value outside its allowed range or step, **When** the reviewer
   tries to proceed, **Then** the system rejects it with a clear, visible error and no run
   is created.
3. **Given** valid edited values, **When** the reviewer starts the run, **Then** the run
   uses those values and the run's evidence records both the original and the modified
   values.

---

### User Story 3 - Review a second, distinct UC-01 scenario (Priority: P2)

A reviewer runs the second scenario — a solo, late-night, post-overtime driver who is
resistant to stopping — and sees a shorter micro-intervention proposal and the option to
decline it, distinct from the first scenario's receptive driver.

**Why this priority**: A second scenario proves the simulator handles more than one drive
context; it is high value but depends on the engine (US1) and setup (US2) being in place.

**Independent Test**: Run the second scenario; confirm it deterministically reaches a
micro-rest proposal and that a decline action is available and recorded.

**Acceptance Scenarios**:

1. **Given** the second scenario is available, **When** the reviewer selects and runs it,
   **Then** the drive deterministically reaches a single rest proposal appropriate to a
   resistant late-night driver (a short intervention, not a full rest).
2. **Given** the proposal is shown, **When** the reviewer declines it, **Then** the decline
   is recorded and the run continues without a rest.

---

### User Story 4 - Behavioral realism drives the decision (Priority: P2)

The driver's drowsiness/fatigue and the vehicle's instability signals evolve over the
drive from the driver/vehicle profiles and the route — deterministically — and these
evolving values are what lead to the proposal, replacing M1's fixed schedule.

**Why this priority**: The behavioral engine is the foundation the algorithms consume;
its realism is what makes the comparison in US1 meaningful. It is verification-heavy and
underpins the other stories.

**Independent Test**: Run a scenario twice and confirm the per-tick driver/vehicle state
progression is identical; confirm the proposal timing follows from the evolving state, not
a hardcoded schedule.

**Acceptance Scenarios**:

1. **Given** a scenario with a driver/vehicle profile, **When** the run advances, **Then**
   driver drowsiness/fatigue and vehicle signals change each tick according to the profile
   and route, deterministically.
2. **Given** the same profile and plan, **When** the run is repeated, **Then** the state
   progression is identical tick-for-tick.

---

### Edge Cases

- **Out-of-range edited value**: rejected with a clear message before any run starts; no
  partial run.
- **Incompatible package/scenario**: refused with a clear error (carried over from prior
  behavior).
- **Algorithm failure mid-run**: recorded as an explicit error event and shown as an
  error, never a normal decision (carried over).
- **Regenerating the plan after edits**: produces an updated draft; the previous draft is
  replaced, not mutated mid-run.
- **Multi-category tie / suppression**: when more than one category is active, exactly one
  is selected by the defined priority and the others remain visible (including suppressed).
- **Decline on the resistant scenario**: the run continues without a rest and the decline
  is part of the evidence.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST offer at least two selectable hypothesis packages (a
  rule-based one and a weighted-score one) and at least two selectable UC-01 scenarios,
  with compatibility filtering.
- **FR-002**: Both algorithms MUST pass through the single evaluation contract and
  produce the same normalized decision shape; the weighted-score algorithm MUST
  additionally populate per-category scores, multiple trigger candidates, candidate
  strengths, state labels, and a selected category resolved by a defined priority order.
- **FR-003**: Suppressed and non-selected candidates MUST remain in the decision output;
  exactly one candidate is selected when any fire.
- **FR-004**: The system MUST simulate driver state (drowsiness, fatigue, attention) and
  vehicle signals (instability, lane-departure/ADAS counts) deterministically per tick
  from driver/vehicle profiles, the speed profile, and the route — replacing any
  hardcoded progression schedule. Position MUST advance from the numeric speed profile.
- **FR-005**: The simulation MUST be deterministic: the same profiles, scenario, plan, and
  choices MUST produce identical per-tick state and identical decisions on every run.
- **FR-006**: The evaluation context MUST expose both the numeric internal driver/vehicle/
  route state and normalized/ordinal feature views; an algorithm consumes whichever fits
  its type. (No raw value from an external service exists yet; when one is introduced it
  must be bounded before reaching decision logic.)
- **FR-007**: The system MUST provide a setup step that derives route facts from the
  scenario, generates a draft event plan from those facts and the reviewer's presets,
  allows regenerating the draft, and freezes the chosen draft when the run starts.
- **FR-008**: The reviewer MUST be able to edit the selected package's parameters and
  hyperparameters before the run starts; the system MUST validate each value against its
  definition (allowed values / range / step) and reject invalid values with a clear,
  visible error and no run.
- **FR-009**: Setup values MUST be frozen at run start (standard run mode); changing a
  value after start requires a new run rather than mutating the active run.
- **FR-010**: The run evidence MUST record the setup snapshot, the route-derived facts, the
  frozen generated plan, the selected driver/vehicle/speed profiles, the run mode and
  evidence status, and both the original (default) and modified setup values.
- **FR-011**: The decision output and package definitions MUST support localized
  (Japanese/English) proposal messages and explanations, with a plain-text fallback.
- **FR-012**: The system MUST carry a per-package runtime-state value through evaluation —
  passing the current value into each evaluation and storing the returned next value for the
  following tick — and persist it in the evidence. (M2's built-in algorithms leave it
  empty; the mechanism must work and be recorded.)
- **FR-013**: The second scenario MUST represent a solo, late-night, post-overtime,
  rest-resistant driver, deterministically reach a short micro-intervention proposal, and
  offer a decline action that is recorded and continues the run without a rest.
- **FR-014**: Both package/scenario pairings MUST be runnable end-to-end (setup → plan →
  run → proposal → action → evidence) from the frontend and via the programmatic interface.
- **FR-015**: The weighted-score algorithm MUST be able to emit a secondary (monotony-
  prevention) category candidate, demonstrated by an automated check, even though a
  dedicated monotony review scenario is out of scope for this milestone.

### Key Entities

- **Driver/Vehicle/Speed profile**: the behavioral parameters that deterministically drive
  per-tick driver state, vehicle signals, and position.
- **Route facts**: the route-derived summary (distance, duration, typed segments, rest-spot
  positions, checkpoints) the plan is generated from.
- **Draft event plan**: the regenerable, pre-run schedule (tick cadence, traffic/weather
  events, rest opportunities) frozen at run start.
- **Setup values**: the editable parameters and hyperparameters, with original and modified
  values recorded.
- **Category score / candidate / selected candidate**: the weighted-score decision detail —
  per-category score, candidate (with strength, state, fire-control, suppression), and the
  priority-selected category.
- **Package runtime state**: a per-package value threaded across ticks and persisted (empty
  for M2 built-ins).
- **Run evidence**: the append-only run log, now complete with setup snapshot, plan,
  profiles, and original/modified values.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A reviewer can choose between the rule-based and weighted-score packages and
  run either against a chosen UC-01 scenario to a rest proposal.
- **SC-002**: The weighted-score run's trace shows, for the firing tick, per-category
  scores, at least two candidates (with one selected by priority and at least one
  non-selected or suppressed), and a selected category.
- **SC-003**: A reviewer can edit a value before starting; an out-of-range value is rejected
  with a clear message and starts no run, and a valid edit is used by the run.
- **SC-004**: The run evidence contains the setup snapshot, route facts, frozen plan, selected
  profiles, run mode/evidence status, and both original and modified values.
- **SC-005**: Running the same package, scenario, profiles, plan, and choices twice produces
  identical per-tick state and identical decision traces.
- **SC-006**: A reviewer can choose between two UC-01 scenarios; the second reaches a short
  micro-intervention proposal and supports a recorded decline action.
- **SC-007**: An automated check demonstrates the weighted-score algorithm emitting a
  monotony-prevention candidate from appropriate state.
- **SC-008**: Both package/scenario pairings complete the full loop both from the frontend and
  via the programmatic interface, producing equivalent evidence.

## Assumptions

- **Stack/architecture fixed by the M2 ADR and master docs**: FastAPI/Pydantic backend on
  M1, React/TypeScript/Vite frontend, file-based packages/scenarios/runs, the single
  algorithm-adapter contract, the §11 decision shape, and the architecture's setup/run-plan
  sequence. This spec states *what*; the ADR/plan own *how*.
- **Two packages, two scenarios, two built-in algorithm types** (rule-based + weighted-score).
  Python algorithms and the transparent-hybrid *logic* (smoothing/persistence/state machines
  that fill the package runtime state) are M3; Google Maps is M4; structured feedback and
  evidence replay are M5; `expert_override` mode and run comparison are later.
- **Standard run mode only**; deterministic local route (no external mapping service).
- **The behavioral model follows the master runtime workflow's additive rate model**; same
  profile + frozen plan → identical progression.
- **Close-to-skeleton but rough-acceptable UI**; full polish and bilingual UX tightening are
  a later milestone.
