# Feature Specification: M3 Python Algorithm Support

**Feature Branch**: `004-m3-python-algorithm-support`

**Created**: 2026-06-27

**Status**: Draft

**Input**: User description: "M3 Python Algorithm Support — run Python-authored trigger algorithms as local packages, including the transparent hybrid that carries smoothing/persistence/state across ticks, normalized into the same decision shape, with Python errors surfaced as evidence."

## Overview

M3 lets a hypothesis package supply its decision logic as a local Python file
(`algorithm.py`) instead of a built-in algorithm type. The simulator evaluates that
Python code through the one decision contract, normalizes its output into the same
decision shape every other package uses, and — for the first time — carries a
package's own runtime state (smoothing, persistence counters, state-machine labels)
from one tick to the next. The flagship Python package is the **transparent hybrid**
trigger, whose decision basis (features, scores, states, candidates, fire-control,
the selected proposal, and the next runtime state) is fully reviewable. Python is
local trusted code; failures are surfaced as evidence, never disguised as a normal
decision. Authoritative design:
`docs/superpowers/specs/2026-06-27-m3-python-algorithm-support-design.md`.

## Clarifications

### Session 2026-06-27

- Q: Does a Python package's decision go through a different contract than the
  built-in algorithms? → A: No — Python packages produce the same normalized decision
  shape through the one decision contract; the simulator adjusts shape/field-names
  only and records the algorithm's own result category verbatim.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Run the transparent hybrid and review its full decision basis (Priority: P1)

A reviewer selects the transparent-hybrid Python package for a UC-01 rest scenario,
runs it, and inspects a complete decision trace — the per-tick features, category
scores, state-machine labels, candidates (including suppressed), fire-control
outcome, the selected proposal, and the package's evolving runtime state (smoothed
scores and persistence counters changing across ticks).

**Why this priority**: The headline M3 value is executing and *reviewing* a real
stateful Python algorithm. The transparent hybrid is the reason Python support
exists.

**Independent Test**: Run the hybrid package against a UC-01 rest scenario; confirm
it reaches a rest proposal and that the trace shows features, scores, states,
candidates, fire-control, the proposal, and a non-empty runtime state that changes
tick-to-tick.

**Acceptance Scenarios**:

1. **Given** the transparent-hybrid package is available, **When** the reviewer
   selects it and runs a UC-01 rest scenario, **Then** the drive reaches a rest
   proposal and the trace shows the full decision basis incl. the per-tick runtime
   state.
2. **Given** the run advances several ticks, **When** the reviewer inspects
   successive trace entries, **Then** the smoothed scores and persistence counters
   evolve across ticks (state is carried forward), and the same run repeated produces
   an identical trace.
3. **Given** a candidate is suppressed, **When** the reviewer views the trace, **Then**
   the suppressed candidate remains visible and marked suppressed.

---

### User Story 2 - Select and evaluate any Python-authored package (Priority: P1)

A reviewer chooses a package whose logic is a local Python file and runs it exactly
like a built-in package; its decisions appear in the trace in the same shape as every
other package.

**Why this priority**: Python support must work generally, not only for the hybrid.
A simple Python package proves the mechanism end-to-end and de-risks the complex one.

**Independent Test**: Run the simple Python package against a UC-01 scenario; confirm
it produces the same normalized decision shape as the equivalent built-in package on
the same inputs.

**Acceptance Scenarios**:

1. **Given** a package whose decision logic is a local Python file, **When** the
   reviewer selects and runs it, **Then** it is evaluated and its decisions appear in
   the trace.
2. **Given** the simple Python package and the equivalent built-in package on the same
   inputs, **When** both are evaluated, **Then** they produce equivalent normalized
   decisions.
3. **Given** setup values edited before the run, **When** the Python package is
   evaluated, **Then** the edited parameter/hyperparameter values are used by the
   Python logic.

---

### User Story 3 - Python failures are surfaced as evidence, never hidden (Priority: P2)

When a Python package's logic is missing the required entry point, raises an error
mid-run, or returns an unusable result, the simulator records an explicit error event
in the evidence and shows it as an error in the trace — never as a normal assistant
decision.

**Why this priority**: Honest failure is a constitutional boundary and the difference
between trustworthy and misleading evidence. It depends on the evaluation mechanism
(US2) existing.

**Independent Test**: Point the simulator at Python packages that (a) lack the entry
point, (b) raise during evaluation, and (c) return an unusable result; confirm each
produces a clear error event in the evidence and the trace, and no normal decision.

**Acceptance Scenarios**:

1. **Given** a Python package missing its required entry point, **When** it is
   evaluated, **Then** an error event is recorded and shown, and no decision is
   produced for that tick.
2. **Given** a Python package that raises during evaluation, **When** it is evaluated,
   **Then** the error is captured as an error event with a message, shown in the
   trace, and not disguised as a decision.
3. **Given** a Python package that returns an unusable result, **When** it is
   evaluated, **Then** the invalid result is rejected as an error event rather than
   recorded as a decision.

---

### Edge Cases

- **Missing entry point / raise / invalid result**: each becomes a distinct error
  event (kind of failure identified), persisted and shown; the run continues to the
  next tick without a fabricated decision.
- **Runtime state on the first tick**: the package receives an empty prior runtime
  state and returns its initial state; subsequent ticks receive the previous tick's
  returned state.
- **Required context field absent**: if a required simulation input the package needs
  is missing, the system reports a clear context error rather than silently treating
  it as zero; only optional sensor/route enhancement inputs default to absent/zero.
- **A package declaring its own evaluation cadence**: the run honors the package's
  declared tick cadence when set, otherwise the scenario's.
- **Suppressed / non-fired candidates**: preserved and visible, as for built-in
  algorithms.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A package MUST be able to supply its decision logic as a local code file
  with a defined entry point; the system MUST evaluate it through the same decision
  contract as built-in algorithms and normalize its output to the same decision shape.
- **FR-002**: The system MUST pass an evaluation context to the package logic
  containing the current simulation time, the simulation state, the derived feature
  views, the (edited) parameters and hyperparameters, the proposal/action history
  relevant to fire-control (cooldown/count/acceptance), and the package's prior
  runtime state.
- **FR-003**: The system MUST carry the package's returned runtime state forward —
  passing the prior value into the next evaluation and persisting the returned value
  each tick — so stateful behavior (smoothing, persistence counters, state labels)
  works across ticks. Built-in algorithms continue to return empty runtime state.
- **FR-004**: The system MUST record the package's own result category verbatim (it
  MUST accept the documented result categories incl. rest, monotony, suppressed, and
  no-proposal, plus package-defined values); it MUST normalize only shape/field-names,
  never the semantic result category.
- **FR-005**: The system MUST validate that required context fields are present (a
  missing required field is a clear error, not a silent zero); only optional
  sensor/route enhancement inputs may default to absent/zero.
- **FR-006**: If the package logic is missing its entry point, raises during
  evaluation, or returns an unusable result, the system MUST record a distinct error
  event in the evidence and show it in the trace, and MUST NOT produce a normal
  decision for that tick.
- **FR-007**: The system MUST ship two Python packages: a simple one equivalent to the
  built-in weighted-score rest proposal, and the transparent-hybrid trigger that
  carries smoothing, velocity, persistence counters, state machines, multi-category
  candidates with priority, and a populated next runtime state.
- **FR-008**: The transparent-hybrid package MUST run against a UC-01 rest scenario
  and emit a full trace: features, category scores, state labels, candidates
  (incl. suppressed), fire-control outcome, the selected proposal, the human-readable
  explanation, and the next runtime state.
- **FR-009**: The decision evaluation MUST be deterministic: the same package,
  scenario, edited values, and plan MUST produce identical per-tick decisions and an
  identical runtime-state progression on every run.
- **FR-010**: The reviewer-facing trace MUST surface, for a stateful package, the
  per-tick state labels and a compact view of the recorded runtime state (smoothed
  scores + persistence counters) drawn from the runtime state the tick produced; full
  detail remains available in the persisted evidence view.
- **FR-011**: Suppressed and non-selected candidates from a Python package MUST be
  preserved in the decision output and visible in the trace.
- **FR-012**: Python packages are local trusted code executed in-process; the system
  MUST NOT require sandboxing of untrusted uploads (out of scope).

### Key Entities

- **Python package**: a hypothesis package whose decision logic is a local code file
  with a defined entry point and its own configuration.
- **Evaluation context**: the per-tick inputs handed to the package logic (time,
  simulation state, feature views, edited values, history, prior runtime state).
- **Package runtime state**: the package's own state carried tick-to-tick (smoothed
  scores, persistence counters, state labels) and persisted in the evidence.
- **Decision result / trace entry**: the normalized outcome — features, scores,
  states, candidates (incl. suppressed), fire-control, selected proposal, explanation,
  next runtime state.
- **Algorithm error event**: a distinct evidence record for a missing entry point,
  raised error, or invalid result.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A reviewer can select a Python-authored package and run it to a decision
  exactly like a built-in package.
- **SC-002**: The transparent-hybrid package, on a UC-01 rest scenario, reaches a rest
  proposal and its trace shows features, scores, states, candidates, fire-control, the
  selected proposal, and a non-empty runtime state.
- **SC-003**: Across successive ticks of a hybrid run, the smoothed scores and
  persistence counters change (state is carried forward), and a repeated run produces
  an identical trace.
- **SC-004**: The simple Python package produces decisions equivalent to the built-in
  weighted-score package on the same inputs.
- **SC-005**: A Python package that is missing its entry point, raises, or returns an
  unusable result yields a distinct, visible error event and no normal decision for
  that tick — verified for all three failure kinds.
- **SC-006**: Suppressed candidates from a Python package are persisted and visible in
  the trace.
- **SC-007**: The trace surfaces the hybrid's per-tick state labels and recorded
  runtime-state summary.

## Assumptions

- **Stack/architecture fixed by the M3 ADR and master docs**: FastAPI/Pydantic backend
  on M1/M2, React/TypeScript/Vite frontend, file-based packages, the single decision
  contract, the §11 decision shape, and the runtime-state threading introduced (empty)
  in M2. This spec states *what*; the ADR/plan own *how* (isolated module loading, the
  context dict, the hybrid's formulas/constants).
- **The transparent hybrid is ported faithfully** from the master proposal (smoothing
  α 0.35, the feature/category formulas, the rest/monotony state machines, persistence
  2/3 ticks + skip-if, velocity, fire-control cooldown/emergency/limit, priority).
- **An existing UC-01 rest scenario is reused**; no new scenario.
- **Missing optional hybrid inputs default to zero**; the hybrid fires a rest proposal
  from the drowsiness/fatigue/rest-window path. Full monotony-prevention UX (a
  dedicated monotony scenario) is a later milestone; monotony candidates are
  structurally supported here.
- **Local trusted code only**; no untrusted-upload sandboxing. Google Maps (M4),
  structured feedback + evidence replay (M5), and expert-override remain later
  milestones.
