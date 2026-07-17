# Feature Specification: P7 — End-to-End Pre-Rest/Rest/Post-Rest Vertical Slice

**Feature Branch**: `proposal-p7-e2e-vertical-slice`

**Created**: 2026-07-17

**Status**: Draft

**Input**: Milestone P7 (`docs/master/aica_proposal_simulator_milestones.md` §9); approved design `docs/superpowers/specs/2026-07-17-proposal-p7-e2e-vertical-slice-design.md`.

## Overview

P7 turns the previously-separate pieces of the Proposal Simulator — the transparent service selector (P5), the transparent music content selector (P6), and the eligibility/journey engine (P4) — into a single, reviewable **end-to-end journey** on the standalone 4-panel proposal screen. A reviewer starts from one built-in world seed (a night-highway rest-recommended situation with high drowsiness/fatigue) and drives the whole central use case as a sequence of **advisory, recomputed decisions**: a pre-rest service and its concrete content, arrival and rest, an explicit reviewer-entered post-rest driver state, a **recomputed** stopped-stage proposal, a concrete full-karaoke plan, and a return to driving that restores the previous content. Every decision remains advisory (the simulator proposes, never forces), every recomputation is a newly frozen, replayable snapshot, and post-rest outcomes are explicit reviewer inputs — never probabilistically generated.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Recompute a proposal after a lifecycle-stage change or context edit (Priority: P1)

A reviewer has an in-progress proposal run. The journey has advanced to a new lifecycle stage (for example, rest has completed and the run is now in the after-rest stage), or the reviewer wants to change one or more world facts (for example, the post-rest drowsiness and fatigue the driver actually feels). The reviewer supplies the changed facts as explicit overrides and asks the simulator to recompute. The simulator applies the overrides to the run's world, re-checks which services are allowed and eligible for the current stage and motion, produces a fresh ranked service proposal, and records it as a new frozen decision point within the same run — without discarding the earlier decisions.

**Why this priority**: This is the single capability P7 adds that none of P4/P5/P6 provides on its own. Without it the journey cannot progress from one stage's proposal to the next, so it is the MVP: everything else in P7 either feeds it or displays it.

**Independent Test**: Create a run from the built-in seed, advance it to the after-rest stage, submit a recompute with changed drowsiness/fatigue overrides, and confirm a new frozen decision point with a service proposal appears in the same run and that changing the override values changes the resulting proposal.

**Acceptance Scenarios**:

1. **Given** a run in the after-rest stage created from a typed world, **When** the reviewer recomputes with post-rest drowsiness/fatigue overrides, **Then** the run gains a new frozen decision point (a new opportunity and a new frozen setup snapshot appended to the run's history, with the newest becoming the current one) carrying a fresh ranked service proposal, and the earlier decision points are preserved unchanged.
2. **Given** the same run and the same overrides, **When** the reviewer recomputes twice, **Then** both recomputations produce an identical frozen snapshot and identical ranking (deterministic replay).
3. **Given** a run in the after-rest stage, **When** the reviewer recomputes with a high post-rest drowsiness/fatigue versus a low one, **Then** the resulting service proposal can differ between the two (post-rest state demonstrably influences the next proposal).
4. **Given** a recompute request whose overrides would make the world invalid (out-of-range value, dangling catalog reference, unknown field path), **When** it is submitted, **Then** it is rejected with a field-level explanation and no new snapshot is created.
5. **Given** a legacy run that has no stored typed world, **When** a recompute is requested, **Then** it is rejected with a clear message rather than fabricating a world.

---

### User Story 2 - Complete the full reference journey from one built-in seed (Priority: P1)

A reviewer opens the built-in night-highway rest-recommended seed and walks the entire central use case on the 4-panel screen: a pre-rest service (humming karaoke) is proposed and its concrete content chosen for the drive to the rest spot; the vehicle arrives and stops; the reviewer records rest starting and then completing with explicit post-rest driver state; the stopped-stage proposal is recomputed; a concrete full-karaoke plan with lighting is chosen; and finally the driver returns to driving, at which point the motion policy restores the previously-playing content. The reviewer can inspect the ordered event timeline and the current lifecycle stage, motion state, and currently-allowed services throughout.

**Why this priority**: This is the milestone's headline demonstration (AC-1). It is what makes P7 a *vertical slice* rather than an isolated endpoint, and it exercises every other story end to end.

**Independent Test**: Drive the whole reference journey (create → pre-rest service+content → arrive → rest start → rest complete with post-rest state → recompute → full-karaoke content → accept → complete/return-to-driving) against the built-in seed and confirm each transition is recorded in order and the final state restores the previous content on the return to driving.

**Acceptance Scenarios**:

1. **Given** the built-in night-highway seed, **When** the reviewer performs the full reference sequence, **Then** the run completes the journey end to end with an ordered event timeline covering opportunity-open, service selection, content selection, rest arrival/start/completion, recomputation, the post-rest service and content decisions, and the return-to-previous-content transition.
2. **Given** the pre-rest content is playing and the reviewer returns the vehicle to driving during an after-rest full-karaoke plan, **When** the motion changes to driving, **Then** the stopped-only content is not left active as a driving experience and the motion policy is applied deterministically.
3. **Given** the completed journey, **When** the reviewer reopens the run, **Then** it renders exactly as recorded without re-running any algorithm.

---

### User Story 3 - Quick-check versus interactive mode (Priority: P2)

A reviewer wants a fast, hands-off look at what the algorithm would do without clicking through each choice. They set the run to quick-check mode, and at both the initial proposal and every recompute the simulator automatically takes the top-ranked service and produces its concrete content plan in one step. A second reviewer, using interactive mode, sees the same top-ranked service and chooses it themselves. The two reviewers can confirm they were shown the same rank-1 result.

**Why this priority**: Quick-check is an explicit P7 scope item and acceptance criterion (AC-6), but it is a convenience layer over Story 1/2 rather than a prerequisite for them.

**Independent Test**: Run the same seed and snapshot in quick-check and in interactive mode and confirm the auto-selected rank-1 service equals the rank-1 service presented interactively, and that quick-check reaches a concrete content plan without a separate manual selection step.

**Acceptance Scenarios**:

1. **Given** a quick-check run, **When** the initial proposal is produced and a top-ranked service exists, **Then** the simulator automatically selects that service and produces its concrete content plan in the same step, reaching the content-selected state.
2. **Given** a quick-check run in the after-rest stage, **When** the reviewer recomputes, **Then** the simulator again auto-selects the recomputed rank-1 service and produces its content plan in the same step.
3. **Given** identical world, snapshot, and configuration, **When** the same proposal is produced in quick-check and in interactive mode, **Then** the rank-1 service is identical in both.
4. **Given** any proposal, **When** it is produced, **Then** no probabilistic acceptance or recovery outcome is generated anywhere in the run; post-rest driver state is only ever an explicit reviewer input.

---

### User Story 4 - Advisory safety: reject-all and non-binding preview (Priority: P2)

A reviewer must always be able to decline what the simulator proposes, at any stage, without the run dead-ending, and must be able to look ahead at what would come next without that look-ahead being treated as a committed choice. After a recompute, the reviewer rejects every proposed service in turn; the run reaches an explicit "no eligible candidate remaining" end-state safely rather than crashing. Separately, the reviewer previews the likely next content; the preview does not start or commit that content.

**Why this priority**: These are safety/advisory-invariant guarantees (AC-4, AC-5). The underlying mechanisms exist from P4; P7 must prove they still hold across a recomputed stage.

**Independent Test**: After a recompute, reject each eligible service until none remain and confirm the run ends safely; separately request a preview and confirm the run's committed state and persisted record are unchanged by it.

**Acceptance Scenarios**:

1. **Given** a recomputed after-rest proposal with several eligible services, **When** the reviewer rejects each one in turn, **Then** the run reaches an explicit no-eligible-candidate end-state without error and remains reopenable.
2. **Given** any in-progress run, **When** the reviewer requests a non-binding preview of the next content, **Then** the run's committed action, status, and persisted record are byte-identical before and after the preview.

---

### User Story 5 - Inspect the multi-decision journey on the 4-panel screen (Priority: P3)

A reviewer uses the standalone 4-panel screen to run and inspect the journey: they choose the mode, edit post-rest context and trigger a recompute, and read the current lifecycle stage, motion state, and currently-allowed services. The event timeline shows the full ordered sequence including recomputations and context edits, and the currently committed action is visually separated from any non-binding preview. Every label is available in Japanese (default) and English.

**Why this priority**: The reviewer-facing surface is required for the milestone demonstration, but the backend decisions are the source of truth; the screen is display-and-drive only, so it depends on Stories 1–4.

**Independent Test**: On the 4-panel screen, toggle the mode, submit a post-rest context edit + recompute, and confirm the timeline, lifecycle/motion/allowed-service readouts, and committed-vs-preview separation update from the backend response, in both languages.

**Acceptance Scenarios**:

1. **Given** the proposal screen, **When** the reviewer selects quick-check versus interactive before creating the run, **Then** the chosen mode is applied to the created run.
2. **Given** an after-rest run on the screen, **When** the reviewer edits post-rest drowsiness/fatigue and clicks recompute, **Then** the screen displays the recomputed proposal and the updated timeline from the backend without computing any decision itself.
3. **Given** any run on the screen, **When** the language is toggled, **Then** every P7-added label and control renders in the selected language, with Japanese as the default.

---

### Edge Cases

- **Recompute with no overrides**: allowed (e.g. a pure lifecycle-stage change already applied by a journey action); it recomputes against the current world and stage and records the new snapshot, with no context-edit recorded.
- **Recompute when every allowed service is excluded by eligibility**: produces the new frozen snapshot and an explicit no-eligible-candidate outcome, never a fabricated ranked candidate.
- **Recompute when the service algorithm errors**: recorded as an algorithm-error event on the new decision point; not disguised as a normal proposal; the run remains reopenable.
- **Quick-check when no service is eligible / no rank-1 exists**: stops at the service stage with the no-eligible-candidate outcome; no content plan is fabricated.
- **Quick-check when the content selector errors**: the service selection stands; the content error is recorded as an algorithm-error event, not a silent success.
- **Reopen after any recompute**: renders every historical decision point from the log without recomputation.
- **Motion change back to driving with a stopped-only plan active**: the plan is not left playing as a driving experience; motion policy applies deterministically.

## Requirements *(mandatory)*

### Functional Requirements

**Recompute (core)**

- **FR-001**: The system MUST provide a way to recompute a proposal within an existing run, taking an explicit, possibly empty list of context overrides.
- **FR-002**: A recompute MUST apply the overrides to the run's stored base world, using the current journey lifecycle stage and motion state, then re-validate the resulting world before producing any proposal.
- **FR-003**: A recompute MUST re-resolve the allowed-service set for the current stage, re-apply eligibility for the current motion, and re-run the service selector, producing a fresh ranked service proposal (or an explicit no-eligible / algorithm-error outcome).
- **FR-004**: Each recompute MUST append a new frozen decision point to the same run: a new opportunity and a new frozen setup snapshot added to append-only history, with the newest becoming the current one, plus the new service decision evidence; earlier decision points MUST remain unchanged.
- **FR-005**: A recompute with overrides that make the world invalid (out-of-range, dangling catalog reference, unknown/malformed override path) MUST be rejected with a field-level explanation and MUST NOT create a new snapshot or decision point.
- **FR-006**: A recompute requested on a run that has no stored base typed world MUST be rejected with a clear message and MUST NOT fabricate a world.
- **FR-007**: Given identical run state and identical overrides, a recompute MUST produce an identical frozen snapshot and identical ranking (deterministic; no live model or network call in a transparent run).
- **FR-008**: Changing the post-rest drowsiness/fatigue overrides between two recomputes MUST be able to change the resulting service proposal.

**Post-rest driver state**

- **FR-009**: Post-rest driver state (drowsiness, fatigue) MUST be an explicit reviewer input carried into the recompute; the system MUST NOT generate post-rest outcomes probabilistically.
- **FR-010**: Recording rest completion MUST advance the run to the after-rest stage and preserve the explicit post-rest values so a subsequent recompute can apply them.

**Modes**

- **FR-011**: A run MUST carry a mode (interactive or quick-check), chosen at creation and frozen for the run.
- **FR-012**: In quick-check mode, whenever a top-ranked service exists, the system MUST automatically select that service and produce its concrete content plan in the same step — at initial proposal and at every recompute.
- **FR-013**: In interactive mode, the system MUST stop at the service-proposed state and let the reviewer choose the service.
- **FR-014**: For the same world, snapshot, and configuration, the rank-1 service auto-selected in quick-check mode MUST equal the rank-1 service presented in interactive mode.

**Journey integration & advisory safety**

- **FR-015**: The whole reference journey (pre-rest service+content → arrive → rest start → rest complete with explicit post-rest state → recompute → after-rest service+content → accept/complete → return to driving) MUST be completable from the built-in night-highway seed in one run.
- **FR-016**: The reviewer MUST be able to reject every proposed service after a recompute and reach an explicit no-eligible-candidate end-state without the run dead-ending or erroring.
- **FR-017**: A non-binding preview of future content MUST NOT start or commit that content and MUST leave the run's committed state and persisted record unchanged.
- **FR-018**: On a return to driving, a stopped-only or non-backgroundable content plan MUST NOT remain active as a driving experience; motion policy MUST be applied deterministically and restore the previous content per the existing journey rules.

**Evidence, isolation & failures**

- **FR-019**: Every recompute decision point MUST record its inputs, configuration versions (dataset, algorithm, parameter-set), output, and the triggering reviewer action; algorithm failures MUST be recorded as algorithm-error events, never disguised as normal proposals.
- **FR-020**: Recompute and mode behavior MUST keep the journey engine free of algorithm dispatch and I/O (recomputation is orchestrated outside the pure journey-transition logic).
- **FR-021**: P7 MUST NOT change trigger-simulator behavior, MUST keep proposal state isolated from trigger state, and MUST NOT require the offline single-file app to be modified.

**Presentation**

- **FR-022**: The 4-panel proposal screen MUST let the reviewer choose the mode, edit post-rest context and trigger a recompute, and read the current lifecycle stage, motion state, and currently-allowed services, sourced from the backend.
- **FR-023**: The event timeline MUST display the full ordered sequence including recomputations and context edits across multiple decision points, and MUST visually separate the currently committed action from any non-binding preview.
- **FR-024**: Every P7-added label and control MUST be available in Japanese (default) and English.

### Key Entities *(include if feature involves data)*

- **Proposal run log**: the append-only record of one proposal journey. Gains a stored base typed world (to enable recompute overrides), append-only histories of opportunities and frozen setup snapshots (with the newest as the current one), and a frozen mode. Existing readers of the single current opportunity/snapshot continue to work unchanged.
- **Context override**: an explicit reviewer-supplied change to one world field (path + value), reusing the existing world-clone override shape; the common case is post-rest drowsiness/fatigue.
- **Decision point (opportunity + frozen setup snapshot + decision evidence)**: one recomputed proposal within a run, frozen for replay.
- **Discrete event**: the ordered journey record; extended with a recomputation event and a context-edited event.
- **Run mode**: interactive or quick-check, frozen per run.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A reviewer can complete the entire reference journey from the one built-in seed on the 4-panel screen, and the run records every transition in order (AC-1, FR-015).
- **SC-002**: Every recompute that requires recomputation produces a new frozen snapshot appended to history while preserving all earlier decision points (AC-2, FR-004).
- **SC-003**: Changing the reviewer-entered post-rest drowsiness/fatigue can change the next proposal, demonstrated by at least one high-versus-low pair whose rank-1 service differs (AC-3, FR-008).
- **SC-004**: A previewed future content is never automatically committed: the run's committed state and persisted record are identical before and after a preview (AC-4, FR-017).
- **SC-005**: The reviewer can reject every proposal after a recompute and still exit safely to an explicit no-eligible-candidate end-state (AC-5, FR-016).
- **SC-006**: In quick-check mode the auto-selected rank-1 result equals the rank-1 result shown in interactive mode for the same snapshot, in 100% of compared cases (AC-6, FR-014).
- **SC-007**: No probabilistic acceptance or recovery is generated in any run; post-rest outcomes are explicit inputs only (AC-7, FR-009).
- **SC-008**: The full backend test suite (including all trigger-simulator tests) continues to pass, confirming no regression and no trigger-behavior change (FR-021).
- **SC-009**: Reopening any run after recomputes renders it exactly as recorded without re-running any algorithm (FR-019, deterministic replay).

## Assumptions

- The built-in `seed-night-highway-oshi` seed (rest-recommended, before-rest, driving, oshi on) is the demonstration seed for the reference journey; it already exists and initializes all feature fields.
- Recompute is supported only for typed-world runs (runs created with a stored base world); legacy opaque-world runs are explicitly out of scope for recompute and are rejected rather than migrated.
- Context overrides reuse the existing world-clone override shape and the existing world-validation rules; no new override grammar is introduced.
- The real transparent service selector (P5) and content selector (P6) packages, the frozen purpose/stage matrix, service-capability artifact, and frozen datasets are present and passing on the current baseline.
- Recompute reuses the existing content-dispatch path used by the manual service-selection step (extracted into a shared helper) so quick-check content selection and manual content selection remain identical in behavior.
- The offline single-file app carries only the trigger simulator and is not part of this milestone; no synchronization to it is required.
- Trigger-tick composition, LLM packages, side-by-side comparison UI, and new dataset generation are out of scope (later milestones).
