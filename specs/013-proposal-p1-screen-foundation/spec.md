# Feature Specification: Proposal Screen (4-Panel) & Standalone Run Foundation

**Feature Branch**: `proposal-p1-screen-foundation`

**Created**: 2026-07-16

**Status**: Draft

**Input**: Milestone P1 (`docs/master/aica_proposal_simulator_milestones.md` §3); approved design `docs/superpowers/specs/2026-07-16-proposal-p1-screen-foundation-design.md`; consolidated spec `docs/master/aica_proposal_simulator_specification.md` (§5 contracts, §7.5 matrix, §17 screen requirements).

## Overview

The simulator today lets a reviewer study *when* the in-car assistant fires a trigger. This
feature adds the foundation for studying *what it proposes next*: a separate **Proposal
Simulator** workflow with its own standalone **4-panel screen** (① Input · ② Setup ·
③ Service proposal · ④ Content proposal) and its own persisted runs, living inside the same
application and backend as the existing Trigger Simulator.

This is a **foundation** milestone. It establishes the neutral contracts, the package model,
the persistence, and the screen — but the two selectors are **mock/placeholder** implementations
returning fixed valid results. Real ranking (transparent and LLM), eligibility narrowing, the
editable synthetic world, and the discrete-event journey engine are later milestones. The point
of this milestone is to prove the **boundaries and the screen** work and are cleanly separated
from the Trigger Simulator, so later milestones can drop real algorithms behind the same
boundaries without reshaping them.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Open the standalone proposal screen and run a mock proposal (Priority: P1)

A reviewer opens the application, switches to the **Proposal** workspace, and — without creating
any trigger run — sees the 4-panel proposal screen in Japanese. In the **Setup** panel they choose
a trigger purpose (e.g. "rest recommended"), a compatible lifecycle stage, and a mock service
package and mock content package. The **Input** panel shows the synthetic-world summary. They start
a run: the **Service proposal** panel shows up to three ranked candidate services drawn only from
the purpose/stage-allowed set, with the top candidate's contributing factors and provenance labels.
They choose one service, and the **Content proposal** panel shows a single ordered concrete plan
(items, mode, duration, lighting where applicable, and policies). The whole two-step
service→content pipeline is visible and explicit.

**Why this priority**: This is the milestone's core customer-visible outcome — the 4-panel screen
and the end-to-end mock proposal flow. Without it there is no reviewable proposal experience.

**Independent Test**: Launch the app, switch to the Proposal workspace, run the mock flow end to
end, and confirm all four panels render meaningful content in Japanese, with the service and content
results coming through their respective boundaries.

**Acceptance Scenarios**:

1. **Given** the application is open and no trigger run exists, **When** the reviewer switches to the
   Proposal workspace, **Then** the 4-panel proposal screen appears in Japanese without requiring any
   trigger run to be created.
2. **Given** a trigger purpose and a compatible lifecycle stage are selected in Setup, **When** the
   reviewer starts a run, **Then** the Service proposal panel shows up to three ranked candidate
   services, every one of which belongs to the purpose/stage-allowed set, with the rank-1 candidate's
   contributing factors visible.
3. **Given** ranked service candidates are shown, **When** the reviewer chooses a service, **Then** the
   Content proposal panel shows exactly one ordered concrete plan (never multiple ranked plans and
   never an aggregate plan score) for that service.
4. **Given** the proposal screen is open, **When** the reviewer switches the language to English,
   **Then** every panel and label is presented in English, and switching back restores Japanese.

---

### User Story 2 - Persist, reopen, and delete a proposal run (Priority: P1)

After running a mock proposal, the reviewer's run is saved automatically. They can leave the screen,
return to a **Proposal Runs** list, reopen the saved run to see the same evidence exactly as recorded
(re-rendered from the saved record, not recomputed), and delete a run they no longer need. Proposal
runs are stored separately from trigger runs.

**Why this priority**: A run that cannot be saved, reopened, and removed is not reviewable evidence.
Persistence with reopen and delete is an explicit acceptance criterion of the milestone and underpins
every later evidence/comparison milestone.

**Independent Test**: Create a mock proposal run, confirm it appears in the Proposal Runs list, reopen
it and confirm the displayed evidence matches what was recorded, then delete it and confirm it is gone —
all without touching any trigger run.

**Acceptance Scenarios**:

1. **Given** a mock proposal run has completed, **When** the reviewer opens the Proposal Runs list,
   **Then** the run is listed and is stored in the proposal-run store, separate from trigger runs.
2. **Given** a saved proposal run, **When** the reviewer reopens it, **Then** the recorded opportunity,
   service result, and content plan are shown from the saved record without recomputing the selectors.
3. **Given** a saved proposal run, **When** the reviewer deletes it, **Then** it is removed from the
   list and from storage, and no trigger run is affected.

---

### User Story 3 - Reviewer trust: isolation, safety framing, and package independence (Priority: P2)

A reviewer needs confidence that the proposal workspace does not disturb the trigger workspace, that
each proposal is honestly framed as a mock, and that the platform — not a selector — decides which
services are even eligible. Editing proposal setup never changes trigger setup. The allowed-service
set is resolved from a visible, versioned purpose/stage matrix before any ranking. The service package
and the content package are chosen independently, and the platform can confirm each is a valid package
for its slot without one package depending on the other. Any selector failure is shown as an explicit
error record, never disguised as a normal proposal.

**Why this priority**: These invariants are what make the eventual real algorithms trustworthy and
comparable. Getting them wrong in the foundation would silently corrupt every later milestone, but they
are supporting guarantees around the primary flow rather than the flow itself.

**Independent Test**: Edit proposal setup and confirm trigger setup is unchanged; confirm the
allowed-service set matches the versioned matrix row for the chosen purpose/stage; confirm the service
and content packages validate independently against their slots; and confirm a deliberately failing
mock selector surfaces an explicit error record rather than a fabricated proposal.

**Acceptance Scenarios**:

1. **Given** the reviewer edits proposal setup, **When** they return to the Trigger workspace, **Then**
   the trigger setup is unchanged.
2. **Given** a chosen trigger purpose and lifecycle stage, **When** the allowed services are resolved,
   **Then** they exactly match the frozen versioned purpose/stage matrix row, and the post-rest row lists
   five services including the participatory call-and-response option.
3. **Given** a mock service package and a mock content package, **When** the platform validates them,
   **Then** each is confirmed valid for its own slot independently, and neither consumes the other's
   result.
4. **Given** a selector that returns an invalid or failing result, **When** a run is executed, **Then**
   the run records an explicit selector-error entry and does not present a fabricated proposal.
5. **Given** a purpose/stage whose allowed-and-eligible service set is empty, **When** the service
   selector runs, **Then** the result is an explicit "no proposal" outcome.

---

### Edge Cases

- **Incompatible purpose/stage**: choosing a rest-only lifecycle stage with a non-rest purpose (or an
  active-driving stage with the rest purpose) is rejected before a run can start.
- **Empty allowed/eligible set**: a service or content evaluation over an empty candidate set yields an
  explicit "no proposal" result, not an empty-looking success.
- **Selector failure**: a mock selector that raises or returns a malformed result produces an explicit
  error record in the run, never a normal-looking proposal.
- **Reopen after restart**: a saved proposal run reopened in a fresh session renders from its stored
  record without recomputation.
- **Language fallback**: if a label is missing in the active language, the other language is shown rather
  than an empty or placeholder string.
- **Content plan requested for an unsupported service**: the content selector returns an explicit
  unsupported-service/recipe outcome rather than an empty plan.
- **Invalid or unloadable package**: a malformed proposal package manifest is reported as an error and is
  never partially used.

## Requirements *(mandatory)*

### Functional Requirements

**Workspace & screen**

- **FR-001**: The system MUST provide a Proposal workspace that is selectable from the application without
  creating or affecting any trigger run, presented by default in Japanese.
- **FR-002**: The system MUST present a standalone 4-panel proposal screen — ① Input (synthetic-world
  summary), ② Setup (purpose/stage, package and mode selection, and setup readouts), ③ Service proposal
  (allowed-service chips, ranked candidates, rank-1 contributions, selected-service hand-off), and
  ④ Content proposal (ordered plan with per-item fit and reasons, excluded examples, actions).
- **FR-003**: The system MUST render the decision as an explicit two-step pipeline: STEP 1 selects a
  service, then STEP 2 selects concrete content for the chosen service, with a visible choose-then-recompute
  step between them.
- **FR-004**: Every panel and every label MUST exist in both Japanese (default) and English, and the reviewer
  MUST be able to switch the proposal-screen language without affecting the trigger workspace.
- **FR-005**: The system MUST label each displayed feature field with its provenance (baseline concept,
  normalized concept, or proposed addition).

**Contracts**

- **FR-006**: The system MUST define a neutral proposal-opportunity record carrying an opportunity identifier,
  one trigger purpose, one compatible lifecycle stage, the resolved allowed-service identifiers, a simulation
  time, and a run seed — containing no screen/UI state and no dependency on trigger tick objects.
- **FR-007**: The system MUST validate that a proposal opportunity's trigger purpose and lifecycle stage are
  compatible (rest lifecycle stages only with the rest purpose; the active-driving stage only with the three
  non-rest purposes).
- **FR-008**: The system MUST define a neutral service-selector result carrying up to three ranked candidates
  (each with rank, candidate identifier, optional score, rationale, supporting and opposing feature identifiers,
  and uncertainty), an explicit "no proposal" alternative, excluded candidates, used/unused/missing feature
  lists, next runtime state, and algorithm provenance.
- **FR-009**: The system MUST reuse the existing frozen content-selector result contract (one ordered plan with
  per-item fit and contributions, mode, duration, lighting, policies, and error categories) and MUST NOT
  introduce any aggregate plan score or ranked plan candidates.
- **FR-010**: The system MUST define neutral contract shapes for discrete events, journey state, and per-evaluation
  algorithm evidence, sufficient to record the mock flow, without implementing any event-progression engine.

**Purpose/stage matrix**

- **FR-011**: The system MUST resolve the allowed-service set for an opportunity from a versioned purpose/stage
  service matrix before any ranking, and MUST freeze the matrix version used by each run.
- **FR-012**: The versioned matrix MUST contain the six purpose/stage rows of the consolidated spec, and the
  post-rest (after-rest-before-restart) row MUST list five services, including `call_response_stopped`.
- **FR-013**: A selector MUST NOT be able to introduce a service outside the frozen allowed set for the run.

**Package model**

- **FR-014**: The system MUST support proposal package families across four slots formed by the two selector
  kinds (service selector, content selector) and the two approaches (transparent, constrained LLM), and MUST
  validate a candidate package's declared slot and its contract conformance for that slot.
- **FR-015**: The system MUST allow a service package and a content package to be selected independently, and a
  package of one kind MUST NOT be accepted into the other kind's slot.
- **FR-016**: The proposal package model MUST be independent of the trigger package model, so that adding proposal
  packages does not change how trigger packages are registered or validated.
- **FR-017**: A malformed proposal package MUST be reported as an error and never partially used.

**Mock selectors & evaluation boundary**

- **FR-018**: The system MUST provide a mock service-selector package and a mock content-selector package that
  return fixed valid results conforming to their neutral contracts.
- **FR-019**: The system MUST route each selector evaluation through a boundary that validates the returned result
  against the neutral contract; a selector failure or invalid result MUST be recorded as an explicit selector-error
  entry and MUST NOT be presented as a normal proposal.
- **FR-020**: An evaluation over an empty allowed/eligible candidate set MUST yield an explicit "no proposal"
  result.
- **FR-021**: The mock content selector MUST run only for a service it supports, returning an explicit
  unsupported outcome otherwise.

**Persistence & runs**

- **FR-022**: The system MUST support a standalone proposal run that can be created, automatically persisted,
  reopened, and deleted, stored in a proposal-run namespace separate from trigger runs.
- **FR-023**: A persisted proposal run MUST record its opportunity, the frozen matrix version, the selected service
  and content packages, an ordered list of events, and the per-evaluation algorithm evidence, and MUST be
  re-rendered on reopen from the stored record without recomputing the selectors.
- **FR-024**: Creating or editing a proposal run MUST NOT read from or write to the trigger run store or otherwise
  alter trigger state.

**Isolation & compatibility**

- **FR-025**: Editing proposal setup MUST NOT modify trigger setup, and the trigger workspace (setup, review, runs)
  MUST continue to function unchanged.

### Key Entities *(include if feature involves data)*

- **Proposal opportunity**: the neutral starting record for a proposal — its identifier, trigger purpose, lifecycle
  stage, resolved allowed services, simulation time, and run seed.
- **Purpose/stage service matrix (versioned)**: the mapping from (trigger purpose, lifecycle stage) to the allowed
  service set; versioned and frozen per run.
- **Service-selector result**: up to three ranked candidate services with contributions and provenance, or an
  explicit "no proposal".
- **Content plan**: one ordered concrete plan with per-item fit, mode, duration, lighting, and policies (existing
  frozen contract).
- **Proposal package (four slots)**: a selector package identified by kind (service/content) and approach
  (transparent/constrained LLM), validated against its slot's contract.
- **Proposal run**: the standalone, append-only record of one proposal — opportunity, matrix version, selected
  packages, events, and algorithm evidence.
- **Algorithm evidence**: the per-evaluation record of the input snapshot, package/contract/matrix versions, the
  neutral result, provenance, and used/unused/missing features.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A reviewer can open the Proposal workspace and run a complete mock proposal — from choosing a purpose
  through seeing an ordered content plan — without creating any trigger run.
- **SC-002**: 100% of ranked service candidates shown belong to the frozen purpose/stage-allowed set for the run,
  and no run shows more than three ranked service candidates.
- **SC-003**: A content result is always a single ordered plan; no run ever shows multiple ranked plans or an
  aggregate plan score.
- **SC-004**: A proposal run can be created, reopened with identical recorded evidence, and deleted, with zero
  proposal-run files written outside the proposal-run namespace and zero changes to any trigger run.
- **SC-005**: Editing proposal setup produces no change to trigger setup, and the trigger workspace's existing
  behavior and tests continue to pass unchanged.
- **SC-006**: The platform validates a mock service package and a mock content package independently against their
  four-slot model, accepting each only into its own slot.
- **SC-007**: Every panel and label is available in both Japanese and English, with Japanese shown by default.
- **SC-008**: A selector failure or an empty candidate set always produces an explicit error or "no proposal"
  record and never a fabricated proposal.
- **SC-009**: The post-rest allowed-service row resolves to exactly five services including
  `call_response_stopped`.

## Assumptions

- The real transparent content selector (delivered in a prior milestone) remains registered and independently
  tested, but is intentionally **not executed** in the P1 flow; both selectors used on-screen are mocks.
- Real ranking math, eligibility narrowing beyond the matrix, the editable synthetic world/catalog, and the
  discrete-event journey engine are **out of scope** for P1 and handled by later milestones (P3–P9). The Input
  panel shows a static synthetic-world summary; setup readouts (category weights, multipliers, safety-dominance)
  are display stubs.
- The frozen music dataset and content contracts from prior milestones are available and are referenced by
  version; P1 introduces no new dataset.
- Proposal runs reuse the existing atomic file-persistence approach used by trigger runs, but in a separate
  storage namespace; the same delete affordance does not exist for trigger runs and is introduced only for
  proposal runs.
- Japanese-default applies to the proposal workspace; the existing trigger workspace's default language is left
  unchanged.
- The purpose/stage matrix is editable/versioned for later hypothesis comparison, but P1 ships and freezes a
  single v1 version.
- "Mode" (interactive vs quick) is carried as a setup selection; both modes present the same mock result in P1.
