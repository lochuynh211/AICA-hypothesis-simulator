# Feature Specification: Eligibility And Discrete Journey Engine (P4)

**Feature Branch**: `proposal-p4-eligibility-journey-engine`

**Created**: 2026-07-16

**Status**: Draft

**Input**: Milestone P4 (`docs/master/aica_proposal_simulator_milestones.md` §6), approved design `docs/superpowers/specs/2026-07-16-proposal-p4-eligibility-journey-design.md`.

## Overview

The Proposal Simulator lets a reviewer set up a synthetic driving world, pick a service and content package, and run a two-step proposal (choose a service, then a concrete content plan). Today the reviewer sees *every* purpose/stage-allowed service handed straight to the (mock) selector, and once a content plan is produced the run simply stops — there is no way to act on the proposal or advance the journey.

P4 adds the **orchestration layer that surrounds the still-mock selectors**: a deterministic **eligibility** step that narrows the allowed services by vehicle motion and platform capability *before* ranking (with visible, score-free reasons for every exclusion), and a **discrete journey engine** that lets the reviewer act on a proposal — accept, reject, postpone, choose another, request more, stop, continue — and watch a mocked accepted plan advance through start, completion, continuation, and restoration, including deterministic behavior when the vehicle's motion changes. Every step is recorded as a discrete event in the append-only run log and is replayable without recomputation.

Ranking logic itself is **not** part of P4 (that is P5 for services, P6 for content). The selectors stay mock; P4 proves the constraints and journey behavior that any real selector must later respect.

## Clarifications

### Session 2026-07-16

- Q: How should P4 handle a screen service that can degrade to audio-only background while driving (`live_viewing`, per spec §7.2 "policy-controlled background on motion"), vs. hard stopped-only services (`full_karaoke`, `stretch_video`)? → A: Model a per-service `background_on_motion` capability. A service with `background_on_motion=true` is **eligible while driving** but its screen is suppressed (audio/background only), and on a motion change to `driving` an active such plan is **backgrounded, not stopped**. Hard stopped-only / screen-dependent-without-background services remain excluded while driving and are stopped on the transition.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Eligibility narrowing with visible reasons before ranking (Priority: P1)

A reviewer starts a proposal run in a specific world. The purpose/stage matrix produces the allowed service set, but before any service is ranked the simulator removes services that cannot run given the current vehicle motion and platform capabilities — full-screen karaoke and stopped-only video while driving, an oshi service with no registered oshi entity, a disabled/absent catalog item. The reviewer sees the **eligible** set and, separately, the **excluded** set, each excluded service tagged with a plain reason code and *no* score. The mock selector only ever ranks the eligible services, and can never surface a service outside the frozen purpose/stage row.

**Why this priority**: This is the milestone's foundation and its dominant safety behavior — driving/stopped constraints enforced before ranking. Without it, nothing else in P4 is safe or meaningful.

**Independent Test**: Create a run at `before_rest_until_stop` while `driving`, and separately at `after_rest_before_restart` while `driving` and while `stopped`; assert the eligible/excluded split and reason codes exactly, and assert the ranked output never contains an excluded or out-of-row service.

**Acceptance Scenarios**:

1. **Given** a run whose stage is `after_rest_before_restart` and motion is `driving`, **When** the run opens, **Then** `full_karaoke` and any hard stopped-only / non-backgroundable screen-dependent service are in the excluded set with a reason code (e.g. `full_karaoke_requires_stopped`, `screen_dependent_while_driving`) and carry no `service_fit`/score, while a `background_on_motion` service (e.g. `live_viewing`) stays eligible with its screen suppressed; the mock selector ranks only the eligible services.
2. **Given** the same run but motion `stopped`, **When** the run opens, **Then** those services are eligible (their motion reason no longer applies).
3. **Given** a world with no registered oshi entity, **When** a run opens whose allowed row includes `oshi_reexperience`, **Then** `oshi_reexperience` is excluded with `missing_required_entity`, not ranked.
4. **Given** any run, **When** the service selector returns candidates, **Then** every candidate is a member of the frozen purpose/stage row (a candidate outside the row is impossible).
5. **Given** any excluded service, **When** its exclusion is recorded, **Then** the exclusion reason is expressed only as a reason code and is stored/shown independently of any algorithm rationale — never as a utility score.

---

### User Story 2 - Advance a mocked accepted plan through its lifecycle (Priority: P1)

After a service and content plan are selected, the reviewer accepts the proposal. The mocked accepted plan then advances on demand: it starts (becomes active content), completes, and — per the plan's own completion/continuation policy — either continues or the reviewer stops it and the previously-playing content is restored. Each transition is a discrete event in the log.

**Why this priority**: "A mocked accepted plan can advance through start, completion, continuation, and restoration" is a core P4 acceptance criterion and the heart of the journey engine.

**Independent Test**: From a `content_selected` run, apply `accept → complete → continue → stop` and assert the sequence of emitted events, the resulting journey state (playback state, active vs previous content), and that reopening the run renders the same log without recomputation.

**Acceptance Scenarios**:

1. **Given** a `content_selected` run, **When** the reviewer accepts, **Then** a `CONTENT_STARTED` event is recorded and playback becomes active with the plan as current content.
2. **Given** active content, **When** the reviewer marks it complete, **Then** a `CONTENT_COMPLETED` event is recorded and the completion policy is applied.
3. **Given** completed content, **When** the reviewer continues, **Then** a `CONTINUE_REQUESTED` event is recorded following the plan's next-transition policy.
4. **Given** active content and a previously-playing content, **When** the reviewer stops, **Then** a `RETURN_TO_PREVIOUS_CONTENT` event is recorded, the previous content is restored, and playback is stopped.
5. **Given** any completed sequence of journey actions, **When** the run is reopened, **Then** it renders exactly as recorded with no selector re-invoked.

---

### User Story 3 - Advisory service actions never dead-end the run (Priority: P2)

Faced with a proposed service the reviewer doesn't want, they can reject it, choose another eligible candidate, request the remaining candidates, or postpone. Rejecting a service does not end the run while another eligible candidate exists — the next eligible candidate remains offerable, and a rejected service is not re-offered.

**Why this priority**: "User rejection does not dead-end the run when another eligible candidate exists" is a P4 acceptance criterion; advisory behavior is required by the product's non-forcing stance.

**Independent Test**: From a `service_selected` run with ≥2 eligible candidates, reject the top one and assert the run can still proceed with the next eligible candidate and that the rejected one is excluded from re-offer; separately assert postpone and request-more behavior.

**Acceptance Scenarios**:

1. **Given** a `service_selected` run with at least two eligible candidates, **When** the reviewer rejects the offered service, **Then** a `SERVICE_REJECTED` event is recorded, the rejected service is not re-offered, and the run is not dead-ended.
2. **Given** the same run after a rejection, **When** the reviewer chooses another candidate, **Then** the next eligible candidate (not previously rejected) becomes the selected service.
3. **Given** a `service_selected` run, **When** the reviewer requests more, **Then** the remaining eligible candidates are surfaced without producing any new score.
4. **Given** a proposal, **When** the reviewer postpones, **Then** a postpone event is recorded and the opportunity returns to an open state.
5. **Given** a run where the only eligible candidate is rejected, **When** the reviewer rejects it, **Then** the run reports that no further eligible candidate exists (an explicit end-state, not a crash).

---

### User Story 4 - Motion change and rest-stage transitions apply deterministically (Priority: P2)

The reviewer changes the vehicle's motion (e.g. driving → stopped) or advances the rest journey (arrive at a rest spot, start rest, complete rest). Each transition deterministically updates motion, lifecycle stage, and content presentation — a stopped-only/screen-dependent active plan is stopped or backgrounded when motion becomes driving, eligibility is re-evaluated, and rest completion applies explicit post-rest driver-state values and opens a fresh opportunity.

**Why this priority**: "A motion change applies background/stop behavior deterministically" is a P4 acceptance criterion, and the rest-stage transitions are the journey lifecycle P4 owns (the full seeded rest slice is P7).

**Independent Test**: With an active stopped-only plan, apply a motion change to `driving` and assert the plan is stopped/backgrounded and eligibility recomputed; apply `rest_spot_arrived`/`rest_completed` and assert the motion, stage, and post-rest values change as specified and a new opportunity opens.

**Acceptance Scenarios**:

1. **Given** an active plan and motion `stopped`, **When** motion changes to `driving`, **Then** a `MOTION_CHANGED` event is recorded and the plan is **backgrounded** if its service is `background_on_motion` (e.g. `live_viewing`) or **stopped** if it is hard stopped-only / non-backgroundable screen-dependent (e.g. `full_karaoke`, `stretch_video`), and eligibility is re-evaluated.
2. **Given** identical run state, **When** the same motion change is applied, **Then** the resulting events and journey state are identical every time (deterministic).
3. **Given** a `rest_recommended` run, **When** the vehicle arrives at a rest spot, **Then** a `REST_SPOT_ARRIVED` event sets motion `stopped` and lifecycle stage `during_rest_stopped`.
4. **Given** a `during_rest_stopped` run, **When** rest completes, **Then** a `REST_COMPLETED` event applies the supplied explicit post-rest driver-state values, sets lifecycle stage `after_rest_before_restart`, and opens a new proposal opportunity.
5. **Given** any rest-stage transition, **When** it is applied, **Then** the five named during-rest actions (nap guidance, etc.) appear only as journey events and are never ranked as service/content candidates.

---

### User Story 5 - Non-binding preview and run-area visibility (Priority: P3)

The reviewer inspects a non-binding rolling-horizon preview of the upcoming journey (the explanatory future chain) and sees, in the run area, the eligible/excluded service lists with reasons, the available actions, the current journey state, and the discrete-event timeline. The preview never commits a decision, never invokes a selector, and never changes the run.

**Why this priority**: Preview separates non-binding foresight from committed action (design §3.2/§17.4), and the minimal run-area UI makes the milestone demonstrable end-to-end; both are supporting, not core-safety.

**Independent Test**: Request the preview for a run and assert it returns a chain marked non-binding, that no event/evidence is appended and no selector runs; load the run screen and assert the eligible/excluded lists, action controls, and event timeline render bilingually with Japanese as the default.

**Acceptance Scenarios**:

1. **Given** any run, **When** the reviewer requests the preview, **Then** a non-binding future chain is returned, and the run's events, evidence, and state are unchanged (no hidden partial decision).
2. **Given** the preview, **When** it is produced, **Then** no selector is invoked and nothing is persisted.
3. **Given** a run open in the screen, **When** the run area renders, **Then** it shows the eligible services and the excluded services with their reason codes, the available journey actions, the current journey state, and the discrete-event timeline, with Japanese as the default presentation language and English available.

---

### Edge Cases

- A run created from a legacy opaque world snapshot (no typed world / dataset) still resolves eligibility using motion + capabilities; capability facts that require catalog data degrade gracefully (a service needing an unresolvable entity is excluded, never a crash).
- An action applied from an invalid precondition (e.g. `continue` before anything is active, `accept` when nothing is selected) returns an explicit, structured rejection — never a silent no-op and never a fabricated transition.
- Motion changes to a state where the active plan is no longer eligible: the plan is invalidated/stopped and the invalidation is an event, not a silent removal.
- The eligible set is empty after narrowing: the run records an explicit "no eligible candidate" outcome rather than fabricating a candidate.
- A selector or engine failure is recorded as an `ALGORITHM_ERROR` event and never disguised as a normal proposal or transition.
- Rejecting the last remaining eligible service: explicit end-state, run not dead-ended into an error.

## Requirements *(mandatory)*

### Functional Requirements

**Eligibility (before ranking)**

- **FR-001**: The system MUST resolve the visible candidate set as `catalog services ∩ purpose/stage allowed services ∩ motion/capability/readiness availability`, computed **before** any ranking, for every proposal opportunity.
- **FR-002**: The system MUST exclude, while motion is `driving`: hard stopped-only services, screen-dependent services that cannot background, and full-screen karaoke; and MUST exclude any service whose required catalog entity (e.g. a registered oshi) is absent, and any service whose catalog item is disabled or unavailable. A screen-dependent service marked `background_on_motion` MUST instead remain **eligible** while driving with its screen suppressed (audio/background only) — it is not a hard exclusion.
- **FR-003**: Each excluded service MUST carry one or more plain reason codes and MUST NOT carry any utility/fit score; eligibility reasons MUST be recorded and shown independently of algorithm rationale.
- **FR-004**: Excluded services MUST be retained in the run record as excluded (never silently dropped) and MUST NOT be reinstated by any score or weight.
- **FR-005**: The service selector MUST only ever rank services in the eligible set; it MUST be impossible for a returned candidate to fall outside the frozen purpose/stage row.
- **FR-006**: The per-service platform capability facts (screen-dependence, stopped-only, `background_on_motion`, driving-capability, lighting compatibility, required entity) MUST come from a frozen, versioned capability contract; lighting MUST be treated as a presentation modifier and MUST NEVER appear as a ranked candidate.
- **FR-007**: `trigger_purpose` and `lifecycle_stage` MUST be consumed as control/routing inputs to gate eligibility and journey transitions and MUST NOT be converted into preference or utility feature scores.

**Journey engine — lifecycle & actions**

- **FR-008**: The system MUST let the reviewer act on a proposal via: accept, reject, postpone, choose-another, request-more, stop, continue, and complete.
- **FR-009**: Accepting a selected content plan MUST start it (active content) and record a start event; completing MUST record a completion event and apply the plan's completion policy; continuing MUST follow the plan's next-transition policy; stopping MUST restore the previously-playing content and record a restoration event.
- **FR-010**: The journey MUST track current content and previously-playing content so restoration returns the pre-proposal content.
- **FR-011**: Rejecting a service MUST record a rejection, MUST NOT re-offer that service, and MUST NOT dead-end the run while another eligible candidate exists; choosing-another MUST advance to the next eligible non-rejected candidate; requesting-more MUST surface remaining eligible candidates without producing a new score.
- **FR-012**: Applying an action from an invalid precondition MUST return an explicit structured rejection (not a silent no-op, not a fabricated transition).
- **FR-013**: When no eligible candidate remains (e.g. all rejected, or an empty eligible set), the system MUST report an explicit "no eligible candidate" outcome rather than fabricate one.

**Journey engine — motion & rest transitions**

- **FR-014**: A motion change MUST record a motion-changed event and deterministically apply screen/background/stop behavior to the active plan and MUST re-evaluate eligibility. Specifically, when motion becomes `driving`: an active plan whose service is `background_on_motion` MUST be **backgrounded** (screen suppressed, playback continues); an active plan whose service is hard stopped-only or screen-dependent-without-background MUST be **stopped**.
- **FR-015**: The rest-stage transitions MUST be supported as journey events: arriving at a rest spot sets motion `stopped` and stage `during_rest_stopped`; rest completion applies supplied explicit post-rest driver-state values, sets stage `after_rest_before_restart`, and opens a new opportunity.
- **FR-016**: The five named during-rest actions MUST remain journey-orchestration events and MUST NOT be ranked as service or content candidates.

**Preview, persistence, evidence, isolation**

- **FR-017**: The system MUST provide a non-binding rolling-horizon preview that returns the explanatory future chain, invokes no selector, and persists nothing / changes no run state.
- **FR-018**: Every eligibility decision, journey action, and transition MUST be recorded in the append-only run log; reopening/replaying a run MUST render from the log without recomputing any selector and without collecting new actions.
- **FR-019**: Identical inputs MUST produce identical eligibility results and identical journey transitions (deterministic).
- **FR-020**: Selector or engine failures MUST be recorded as `ALGORITHM_ERROR` events and never disguised as a normal proposal or transition.
- **FR-021**: All P4 behavior MUST remain isolated from the trigger simulator (no trigger run state read/written, no dependence on trigger algorithm code); the existing trigger simulator MUST continue to pass its tests.

**Reviewer surface**

- **FR-022**: The run area MUST show the eligible services, the excluded services with reason codes, the available journey actions, the current journey state, and the discrete-event timeline; presentation MUST support Japanese (default) and English.

### Key Entities

- **Service capability record**: per-service platform facts — whether the service is screen-dependent, stopped-only, `background_on_motion` (screen suppresses to audio/background while driving rather than being excluded), driving-capable, lighting-compatible, and any required catalog entity. Frozen and versioned; the source of the motion/capability narrowing step.
- **Eligibility result**: the eligible service set plus the excluded set, each excluded entry carrying reason codes and no score.
- **Journey state**: the current lifecycle stage and motion, current content, previously-playing content, playback state, and the session's rejected services.
- **Discrete event**: a single append-only record of an opportunity, selection, action, motion change, rest transition, or error, with its effect on journey state.
- **Journey preview**: a non-binding projection of the upcoming journey chain, produced without committing any decision.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For every (trigger purpose, lifecycle stage, motion) combination, the reviewer can see the exact eligible and excluded service sets, with a reason code on every excluded service and no score anywhere in the exclusion.
- **SC-002**: A full-screen karaoke or stopped-only video service is never offered as an active driving experience in any run.
- **SC-003**: 100% of ranked service candidates are members of the frozen purpose/stage row; zero out-of-row candidates are ever produced.
- **SC-004**: A reviewer can drive a mocked accepted plan through start → completion → continuation → restoration, seeing each as a distinct event, and reopen the run to the identical recorded sequence with no recomputation.
- **SC-005**: After rejecting a proposed service, the reviewer can still complete the run using another eligible candidate whenever one exists; the rejected service is never re-offered.
- **SC-006**: Applying the same motion change to the same run state yields identical journey state and events every time.
- **SC-007**: Requesting the preview never alters the run — its events, evidence, and state are byte-for-byte unchanged and no selector runs.
- **SC-008**: The existing trigger simulator and the prior proposal test suite continue to pass unchanged.

## Assumptions

- Selectors remain **mock** in P4; the "accepted plan" that the journey advances is the content plan produced by whichever content package ran at step 2 (mock or the real P3-wired content selector) — no new mock is introduced. Real ranking is P5/P6.
- The frozen `during_rest_stopped` matrix row is empty because the during-rest actions are journey-engine-owned, not `ServiceId` catalog services (per spec §7.3); P4 does not change the matrix.
- Explicit post-rest driver-state values are supplied by the reviewer/action payload at rest completion (the seeded automatic supply is P7).
- The capability contract is authored from the service catalog (spec §7.1/§7.2) and covers all 14 services; a golden test keeps it aligned with the catalog.
- "Catalog readiness" for the required-entity check uses the world/catalog data already available to the run; a legacy world snapshot without resolvable catalog data degrades to excluding entity-dependent services, never crashing.
- The full seeded pre-rest → rest → post-rest vertical slice, ranked during-rest actions, catalog editing, tick-engine composition, and htmlapp synchronization are **out of scope** for P4.
