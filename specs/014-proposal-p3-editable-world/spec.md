# Feature Specification: Editable Synthetic World, Driver Profiles & Contrast (P3)

**Feature Branch**: `proposal-p3-editable-world`

**Created**: 2026-07-16

**Status**: Draft

**Input**: Milestone P3 (`docs/master/aica_proposal_simulator_milestones.md` §5); approved design `docs/superpowers/specs/2026-07-16-proposal-p3-editable-world-design.md`.

## Overview

The Proposal Simulator lets a reviewer study how AICA proposes an in-car service and concrete music
content. Today (after P1) the review screen runs on a hardcoded, unvalidated "world", mock driver
profiles, and **mock selectors that return a fixed answer regardless of the world** — so the reviewer can
neither build the situation they want to study nor see the algorithm react to it.

This feature makes the **world real and reactive**. It delivers: (1) a **typed, validated, editable world**
— control inputs + the momentary driving **situation** + a **driver profile** carrying the driver's
preferences and history; (2) **driver profiles as first-class, saveable, reusable entities**, so "a
customer with hobby X" versus "hobby Y" are real, named, switchable things; (3) built-in **base seeds**
(complete ready-made worlds) and **contrast clones** (change one variable, see a field-level diff); and (4)
**the real transparent content selector wired in**, so that changing the driver profile (or situation)
produces a **visibly different music content proposal** over the frozen catalog — demonstrating the
algorithm's effectiveness through contrast, which is the point of building the world in the first place.

The music **catalog is read-only** in P3: it is the frozen dataset built and validated in P2, and it is
changed only by re-running P2 — never edited in-app. The **service selector remains the P1 mock** (the real
service selector is a later milestone); only the **content** selector becomes real here. No real service
ranking, eligibility narrowing, or journey progression is added.

## Clarifications

### Session 2026-07-16

- Q: Should P3 allow in-app catalog editing (milestones §5 lists it)? → A: No — the song catalog is built
  and frozen in P2 and is **read-only** in P3; it is changed only by re-running P2. Catalog editing (and its
  "new derived version + hash" acceptance criterion) is **cut from P3** and deferred; this is a deliberate
  owner scope decision recorded in the milestone reconciliation.
- Q: How broad should the built-in base-seed / contrast set be? → A: The **5 representative** complete base
  seeds named in §5, plus the specific one-variable **contrast changes** §5 lists (offered as clone presets).
- Q: Is the driver profile part of the world, or a separately reusable entity? → A: A **first-class profile
  store** — driver profiles can be created, saved, listed, reused across worlds, and deleted.
- Q: With mock selectors the proposal cannot react to the profile. How should P3 show the contrast? → A:
  **Wire the real transparent content selector (P6 package)** so a different driver profile yields a
  different content proposal over the frozen catalog. The service selector stays mock. The content selector
  runs over the frozen catalog as candidates with **no P4 eligibility narrowing yet**.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Build a complete world and manage driver profiles (Priority: P1)

A reviewer opens the Proposal screen, picks a built-in **base seed** (a complete, ready-made world such as
"Night highway, rest nearby, oshi on"), and sees every part populated: control inputs (trigger purpose,
lifecycle stage, motion state, matrix version, catalog), the momentary **situation**, and the **driver
profile** (preferences + history). They edit any world field through type-appropriate controls with clear
validation. They can **pick a different built-in driver profile**, **edit it**, and **save it as a named
profile** for reuse across worlds; they can list and delete their saved profiles. The catalog is the frozen
built-in dataset, shown read-only with provenance (identity, version, content hash). Algorithm parameters
are **not** part of the world; they stay in the selector panels. Running the selectors records a setup
snapshot capturing which seed/profile, catalog, algorithm, and parameter-set versions produced the run,
with per-field provenance.

**Why this priority**: The typed, validated, editable world plus reusable driver profiles is the substrate
everything else depends on; it is the smallest slice that turns the P1 mock world into a real one while
keeping the screen runnable.

**Independent Test**: Load a base seed; confirm every feature group is populated and editable; switch and
edit a driver profile and save it as a new named profile, then reload it into a different world; edit a
valid field and an invalid field (invalid rejected with a useful message); run the selectors and confirm
the setup snapshot records seed/profile/catalog/algorithm/parameter versions and per-field provenance;
reload the seed and confirm the identical complete world is restored.

**Acceptance Scenarios**:

1. **Given** the Proposal screen, **When** the reviewer selects a base seed, **Then** the world is fully
   populated — control inputs, situation, and driver profile (preferences + history) — with every approved
   feature present and editable, and algorithm parameters shown separately in the selector panels.
2. **Given** a loaded world, **When** the reviewer edits a situation or profile field to a valid value,
   **Then** the change is accepted and reflected in the world.
3. **Given** a loaded world, **When** the reviewer enters an out-of-range value, an invalid enum, an
   incompatible purpose/stage, or a reference to a catalog item that does not exist, **Then** the edit is
   rejected with a message naming the field and the reason.
4. **Given** an edited driver profile, **When** the reviewer saves it as a named profile, **Then** it is
   stored and appears in the profile list, can be loaded into another world, and can be deleted.
5. **Given** a loaded world whose catalog is the built-in dataset, **When** the reviewer views the catalog,
   **Then** its identity, version, and content hash are shown read-only, and no option to edit or import a
   catalog exists.
6. **Given** a valid world, **When** the reviewer runs the selectors, **Then** the run records a setup
   snapshot capturing the seed/profile, catalog version + hash, algorithm ids + contract versions, and
   parameter-set versions, with per-field provenance labels.
7. **Given** a run produced from a seed, **When** the reviewer reloads that seed, **Then** the same
   complete world is restored (every field identical).
8. **Given** the `genre_affinity_v1` toggle in the driver profile, **When** it is off, **Then** the
   per-genre usage fields are carried as context only and marked not-scored; **When** it is on, **Then**
   those fields become active driver-profile inputs used by the content selector.

---

### User Story 2 - Clone a world and change one variable (Priority: P2)

A reviewer wants an A/B comparison. They take a base seed, **clone-and-change** it on a single variable
(motion state driving↔stopped, high↔low drowsiness, minutes-to-rest 8↔45, oshi mode on↔off, upcoming event
vs none, different hobby, etc.), and the tool shows a **field-level diff** of exactly what differs. The
clone is a complete, valid world runnable like any other.

**Why this priority**: Contrast clones are the comparison mechanism the demonstration relies on, but they
build on the complete editable world (US1).

**Independent Test**: Clone a seed changing one field; confirm the diff lists exactly that field
(before/after) and nothing else; confirm the clone is a complete valid world; confirm the diff is
deterministic (same clone → same diff).

**Acceptance Scenarios**:

1. **Given** a base seed, **When** the reviewer clones it changing one variable, **Then** a new complete
   world is created and a field-level diff shows exactly the changed field's before/after and no other
   differences.
2. **Given** a clone, **When** the reviewer opens it, **Then** it is a complete valid world runnable like a
   seed, with references validated against the catalog.
3. **Given** the same base seed and the same single change, **When** the clone is produced twice, **Then**
   the resulting diff is identical (deterministic).

---

### User Story 3 - See the content proposal react to the world (Priority: P3)

A reviewer builds two worlds that differ in a driver-profile dimension the content algorithm scores (for
example a different hobby/genre usage, oshi setting, or driver state), runs the content proposal on each,
and sees a **different, explained music content proposal** — the real transparent content selector scoring
concrete songs from the frozen catalog. The service selector is still mock; the content proposal is real
and its per-item reasoning reflects the world. Identical worlds always produce the identical proposal
(deterministic, frozen catalog, no network). If the content selector raises or returns an invalid shape, it
is recorded as an algorithm error, never disguised as a normal proposal.

**Why this priority**: This is the payoff — the visible demonstration of algorithmic effectiveness through
profile contrast — but it depends on the real world (US1) and is the least foundational slice.

**Independent Test**: Run the content proposal on two worlds differing only in a scored profile dimension
and confirm the proposals differ and the reasoning cites the differing feature; run the same world twice and
confirm identical output; force a selector error and confirm it surfaces as an algorithm error, not a fake
proposal.

**Acceptance Scenarios**:

1. **Given** two worlds that differ only in a driver-profile dimension the content algorithm scores, **When**
   the reviewer runs the content proposal on each, **Then** the two content proposals differ and the
   per-item reasoning reflects the differing feature.
2. **Given** a chosen (mock) service and a world, **When** the reviewer runs STEP 2, **Then** the real
   transparent content selector produces the content plan by scoring concrete songs from the frozen catalog
   (no eligibility narrowing yet; candidates are the frozen catalog).
3. **Given** the same world and catalog, **When** the content proposal is run twice, **Then** the output is
   identical (deterministic; no live model or network call).
4. **Given** a content selector that raises or returns an invalid shape, **When** STEP 2 runs, **Then** the
   run records an algorithm-error event and the reviewer sees the failure, not a normal proposal.
5. **Given** a chosen service the content package does not support, **When** STEP 2 runs, **Then** the
   reviewer sees a clear unsupported-service message rather than an incorrect proposal.

---

### Edge Cases

- A base seed references a catalog item id not in the frozen dataset → the world fails reference validation
  on load with a message; the seed is not silently accepted.
- The reviewer edits control inputs to an incompatible purpose/stage combination → rejected with a message.
- A saved driver profile references catalog items (oshi id, item histories) that are valid at save but the
  world's catalog is the frozen dataset → references are validated when the profile is loaded into a world.
- `genre_affinity_v1` is toggled off but the profile still carries per-genre usage values → the values are
  retained and carried as context-only (not scored), never dropped.
- Reopening a persisted run renders its stored world/setup snapshot and recorded proposals **without**
  recomputing the algorithm.
- The content selector produces no eligible plan for a world → an explicit "no proposal", not an empty or
  faked one.

## Requirements *(mandatory)*

### Functional Requirements

**World model & editing (US1)**

- **FR-001**: The system MUST represent the proposal world as a typed structure with three parts — control
  inputs, situation, and driver profile — plus a read-only reference to the catalog it uses. Algorithm
  parameters/hyperparameters MUST NOT be part of the world.
- **FR-002**: Control inputs MUST include trigger purpose, lifecycle stage, motion state, the
  service-constraint matrix version, and the selected catalog (dataset) identity.
- **FR-003**: The driver profile MUST own the driver's preferences and history (oshi/UPro information,
  service and content usage levels, scene-specific usage, acceptance/recovery rates and their confidence,
  playback and operation history, schedule).
- **FR-004**: Every feature in the approved service feature contract (Appendix A.1) and content feature
  contract (Appendix A.2) MUST be editable from the world editor, each placed in exactly one world group
  (control input, situation, or driver profile) and never silently omitted.
- **FR-005**: Each editable feature MUST display a per-field provenance label distinguishing baseline,
  normalized-concept, and simulator-proposed origins. "Additional proposed" MUST be represented as this
  provenance label, not as a separate world category or an algorithm concept.
- **FR-006**: The `genre_affinity_v1` fields MUST be an opt-in driver-profile extension; when disabled they
  are carried as context-only and marked not-scored; when enabled they become active inputs used by the
  content selector only. Toggling MUST NOT discard previously entered values.
- **FR-007**: The world MUST project deterministically to the flat selector feature snapshot the existing
  selector contract consumes, with per-field provenance, without changing that selector contract.
- **FR-008**: The system MUST validate world edits on entry and worlds on load — enum membership, numeric
  ranges, id formats, purpose/stage compatibility, and references to catalog items — and MUST reject
  invalid input with a message that names the offending field and the reason.
- **FR-009**: The system MUST provide built-in **base seeds**: complete worlds in which **every** feature
  field is initialized. The system MUST ship the five representative seeds named in milestone §5.
- **FR-010**: Loading a base seed MUST restore the identical complete world every time (deterministic,
  round-trip stable).
- **FR-011**: A run created from a world MUST record a setup snapshot capturing the seed/clone/profile
  identity, the catalog version + hash, the selected algorithm ids + their contract versions, and the
  parameter-set versions, together with the per-field provenance map. Reopening a run MUST render its stored
  world/setup snapshot and recorded proposals without recomputation.

**Driver-profile store (US1)**

- **FR-012**: Driver profiles MUST be first-class entities the reviewer can create, save under a name, list,
  load into any world, and delete. The system MUST ship a small set of built-in named profiles.
- **FR-013**: Saving or loading a driver profile MUST validate it (enums, ranges, and — when loaded into a
  world — references against that world's catalog), rejecting invalid profiles with useful messages.

**Catalog (read-only)**

- **FR-014**: The in-app catalog MUST be the built-in frozen P2 dataset, loaded by dataset
  identity/version/hash and displayed **read-only** with its provenance (identity, version, content hash,
  tier). The catalog MUST NOT be editable in-app, and no external/customer catalog import MUST be offered.
  Changing the catalog is done only by re-running P2.

**Content selector wiring (US3)**

- **FR-015**: STEP 2 MUST invoke the **real transparent content selector package** (not a mock) over the
  world projected from US1, producing a content plan by scoring concrete songs from the frozen catalog. The
  service selector (STEP 1) MAY remain the P1 mock.
- **FR-016**: The content selector's candidate set MUST be the frozen catalog; P3 MUST NOT add motion /
  catalog / schedule eligibility narrowing (that is a later milestone).
- **FR-017**: Content proposals MUST be deterministic for identical world + catalog inputs, with no live
  model or network call (the frozen catalog is the replay boundary).
- **FR-018**: A content selector that raises or returns an invalid shape MUST be recorded as an
  algorithm-error event and surfaced to the reviewer, never replaced by a normal proposal. A world with no
  eligible plan MUST yield an explicit "no proposal".

**Contrast clones (US2)**

- **FR-019**: The system MUST allow cloning a base seed while changing one variable, producing a new
  complete valid world, and MUST expose a deterministic field-level diff versus its base listing exactly the
  changed field(s) with before/after values and nothing unchanged.
- **FR-020**: The system MUST support at least the one-variable contrast changes named in milestone §5
  (motion state; high/low drowsiness; high/low fatigue; 8 vs 45 minutes to rest; oshi mode on/off; upcoming
  event vs none; recent skip/rejection vs none; same acceptance rate high vs low confidence;
  `genre_affinity_v1` off vs on).

**Boundary & compatibility**

- **FR-021**: This feature MUST NOT introduce real **service** ranking, eligibility narrowing by
  motion/catalog/schedule, or journey progression; only the **content** selector becomes real.
- **FR-022**: The proposal world, profiles, catalog, and run state MUST remain isolated from the trigger
  simulator; editing the proposal world MUST NOT affect trigger setup or state, and the trigger simulator
  MUST continue to function unchanged.
- **FR-023**: The world/profile/seed/clone editing surface MUST preserve the approved P1 three-panel screen
  layout (no additional Setup panel) and MUST be fully bilingual with Japanese as the default language.

### Key Entities

- **World**: A complete proposal setup = control inputs + situation + driver profile + read-only catalog
  reference. Projects to the flat selector feature snapshot.
- **ControlInputs**: Trigger purpose, lifecycle stage, motion state, matrix version, selected dataset id.
- **Situation**: The momentary driving scene (driver state, environment, passengers, route/destination,
  rest-spot feasibility, current proposal session).
- **DriverProfile**: The driver's preferences + history, including the opt-in `genre_affinity_v1` extension;
  a first-class, named, saveable, reusable entity.
- **SeedWorld**: A named, built-in, complete world with all fields initialized.
- **WorldClone**: A base-seed-derived world plus its overrides and a computed field-level diff.
- **Dataset/Catalog**: The frozen built-in P2 music dataset (songs = track + audio features + simulation
  flags) with a manifest (identity, version, content hash, tier, provenance); read-only.
- **SetupSnapshot**: The versioned, provenance-labelled record of what produced a run (seed/clone/profile,
  catalog version + hash, algorithm ids + contract versions, parameter-set versions).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A reviewer can load a base seed and reach a complete, populated, editable world in which
  100% of the approved service and content features are present and editable, with algorithm parameters
  shown separately from world features.
- **SC-002**: 100% of invalid world edits (bad range, bad enum, unknown catalog reference, incompatible
  purpose/stage) are rejected with a field-level message; 0% are silently accepted.
- **SC-003**: A reviewer can save a named driver profile and reuse it across worlds; the built-in dataset
  and catalog remain read-only with visible provenance and no edit/import path.
- **SC-004**: Two worlds differing only in a driver-profile dimension the content algorithm scores produce
  **different** content proposals, and the difference is explained in the per-item reasoning.
- **SC-005**: A cloned world's diff lists exactly the changed field(s) and nothing else, and is identical on
  repeat (deterministic).
- **SC-006**: Reloading any base seed restores a world identical to the original in every field; running the
  same world twice produces the identical content proposal (deterministic).
- **SC-007**: The existing trigger simulator's tests continue to pass and no proposal edit changes trigger
  state.
- **SC-008**: Reopening a persisted run renders its stored world, setup snapshot, and recorded proposals with
  no recomputation; a content-selector failure is shown as an algorithm error, never a normal proposal.

## Assumptions

- The frozen P2 dataset (`soundcharts-grounded-spotify-compatible-demonstration-seed-1042`, 300 songs) is
  present and valid; it is the sole, read-only, built-in catalog for V1.
- The committed generator base-seed worlds and contrast pairs exist and are promoted, at authoring time,
  into a stable app-readable location and completed to cover every approved feature field. The generator
  workspace itself is not read at runtime.
- The real transparent content selector package (`aica_transparent_content_selector_v1`, built and tested
  in P6) is reused as-is; P3 wires it into STEP 2 and MUST NOT re-implement its scoring.
- Saved driver profiles and cloned worlds are local, single-user artifacts stored alongside existing
  proposal run data; they are not committed build artifacts.
- The service selector remains the P1 mock package for this milestone; the real service selector arrives in
  a later milestone and MUST require no change to the world contract defined here.
- Japanese is the default presentation language; English is fully supported.
