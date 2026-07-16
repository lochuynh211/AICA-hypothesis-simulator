# Feature Specification: Editable Synthetic World, Catalog & Contrast Clones (P3)

**Feature Branch**: `proposal-p3-editable-world`

**Created**: 2026-07-16

**Status**: Draft

**Input**: Milestone P3 (`docs/master/aica_proposal_simulator_milestones.md` §5); approved design `docs/superpowers/specs/2026-07-16-proposal-p3-editable-world-design.md`.

## Overview

The Proposal Simulator lets a reviewer study how AICA proposes an in-car service and concrete music
content. Today (after P1) the review screen runs on a hardcoded, unvalidated "world" and mock driver
profiles: the reviewer cannot build the situation they want to examine. This feature gives the reviewer a
**complete, editable synthetic world** — the control inputs, the momentary driving situation, and a driver
profile carrying the driver's preferences and history — plus the **music catalog** (the frozen, built-in
dataset) which they can inspect and edit through guarded controls, and the ability to **clone a starting
world and change one thing** to compare outcomes. Everything is backed by the built-in dataset with **no
external data and no customer catalog import**. This feature formalizes and validates the world; it does
**not** add real ranking, eligibility filtering, or journey progression (those are later milestones), so
the two selectors remain the P1 mocks.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Build and edit a complete world from a base seed (Priority: P1)

A reviewer opens the Proposal screen, picks one of the built-in **base seeds** (a complete, ready-made
world such as "Night highway, rest nearby, oshi on"), and sees every part of that world populated: the
control inputs (trigger purpose, lifecycle stage, motion state, which service-constraint matrix version,
which catalog), the momentary **situation**, and the **driver profile** (preferences + history). The
reviewer edits any field — drowsiness, road type, oshi mode, service usage levels, acceptance rates,
playback history, etc. — through controls appropriate to each field's type, with clear validation. The
catalog for that world is the built-in dataset, shown with its provenance (identity, version, content
hash). Algorithm parameters are **not** part of the world; they stay in the service/content panels. The
reviewer runs the (still mock) selectors against this real world and the run records a setup snapshot that
captures which seed, catalog, algorithm, and parameter-set versions produced it, with per-field provenance.

**Why this priority**: This is the core of the milestone — a complete, typed, validated, editable world.
Nothing else in P3 is meaningful without it, and it is the smallest slice that turns the P1 mock world into
a real one while keeping the screen runnable.

**Independent Test**: Load a base seed, confirm every feature group is populated and editable, edit a
valid field and an invalid field (invalid is rejected with a useful message), run the mock selectors, and
confirm the run's setup snapshot records the seed/catalog/algorithm/parameter versions and per-field
provenance; reload the same seed and confirm the identical complete world is restored.

**Acceptance Scenarios**:

1. **Given** the Proposal screen, **When** the reviewer selects a base seed, **Then** the world is fully
   populated — control inputs, situation, and driver profile (preferences + history) — with every approved
   feature present and editable, and algorithm parameters shown separately in the selector panels (not in
   the world).
2. **Given** a loaded world, **When** the reviewer edits a situation or profile field to a valid value,
   **Then** the change is accepted and reflected in the world.
3. **Given** a loaded world, **When** the reviewer enters an out-of-range value, an invalid enum, or a
   reference to a catalog item that does not exist, **Then** the edit is rejected with a message naming the
   field and the reason.
4. **Given** a loaded world whose catalog is the built-in dataset, **When** the reviewer views catalog
   provenance, **Then** the dataset identity, version, and content hash are shown, and no option to import
   an external catalog exists.
5. **Given** a valid world, **When** the reviewer runs the selectors, **Then** the run records a setup
   snapshot capturing the seed, catalog version + hash, algorithm ids + contract versions, and
   parameter-set versions, with per-field provenance labels.
6. **Given** a run produced from a seed, **When** the reviewer reloads that seed, **Then** the same
   complete world is restored (every field identical).
7. **Given** the `genre_affinity_v1` toggle in the driver profile, **When** it is off, **Then** the
   per-genre usage fields are carried as context only and marked as not-scored; **When** it is on, **Then**
   those fields become active driver-profile inputs (scored by the content selector only).

---

### User Story 2 - Edit the catalog into a new validated version (Priority: P2)

A reviewer wants to study how content selection changes when a song's characteristics differ. They open the
catalog, edit a song's fields (its track metadata, its audio characteristics such as energy or tempo, or
its karaoke-availability flags) through guarded, schema-aware controls, and save. Saving **re-validates**
the edited catalog and produces a **new derived catalog version with a new content hash**; the original
built-in dataset is left untouched. Invalid edits are rejected with useful messages before any new version
is created. The new version is selectable as the world's catalog. Edits never regenerate the dataset from
scratch.

**Why this priority**: Catalog editing is a required acceptance criterion and the second reviewable slice,
but it depends on the world/catalog loader from US1 and is independently valuable once that exists.

**Independent Test**: Edit a song to a valid value and save → a new catalog version with a different hash
appears and the built-in dataset is byte-unchanged; edit a song to an invalid value and save → the save is
rejected with a field-level message and no new version is created; confirm the edited catalog still
satisfies the dataset's integrity rules (synthetic identity, no label/score leakage, cross-object
identity).

**Acceptance Scenarios**:

1. **Given** the built-in catalog, **When** the reviewer edits a song's field to a valid value and saves,
   **Then** a new derived catalog version is created with a new content hash and provenance linking it to
   the base dataset, and the built-in dataset files are unchanged.
2. **Given** a catalog edit, **When** the edited value is out of range, breaks synthetic identity, or would
   introduce a label/score field, **Then** the save is rejected with a message identifying the song and the
   field, and no new version is created.
3. **Given** a newly derived catalog version, **When** the reviewer selects it for a world, **Then** the
   world references that version and its provenance is displayed.
4. **Given** any catalog edit, **When** it is saved, **Then** the generator is not re-run and no external
   or network data is fetched.

---

### User Story 3 - Clone a seed and change one variable (Priority: P3)

A reviewer wants an A/B comparison. They take a base seed, **clone-and-change** it on a single variable
(for example motion state driving↔stopped, high↔low drowsiness, minutes-to-rest 8↔45, oshi mode on↔off,
upcoming event vs none), and the tool shows a **field-level diff** of exactly what differs from the base.
The clone is a complete, valid world that can be run like any other.

**Why this priority**: Contrast clones are a required acceptance criterion and the natural comparison tool,
but they build on the complete editable world (US1) and are the least foundational of the three slices.

**Independent Test**: Clone a seed changing one field, confirm the diff lists exactly that one field
(before/after) and nothing else, confirm the clone is a complete valid world, and confirm the diff is
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

### Edge Cases

- A base seed references a catalog item id that is not in the selected dataset → the world fails reference
  validation on load with a message; the seed is not silently accepted.
- The reviewer edits the world to change the trigger purpose / lifecycle stage to an incompatible
  combination → rejected with a message (purpose/stage compatibility rule).
- A catalog edit passes per-field validation but breaks cross-object identity (track/audio-feature id
  mismatch) → the save is rejected.
- Two catalog edits from the same base produce two derived versions → both are addressable and each carries
  its own hash and provenance to the base.
- `genre_affinity_v1` is toggled off but the profile still carries per-genre usage values → the values are
  retained and carried as context-only (not scored), never dropped.
- Reopening a persisted run renders its stored world/setup snapshot **without** recomputing anything.
- A reviewer selects a derived catalog version, then that version is unavailable → the world reports the
  missing dataset clearly rather than silently falling back.

## Requirements *(mandatory)*

### Functional Requirements

**World model & editing (US1)**

- **FR-001**: The system MUST represent the proposal world as a typed structure with three parts — control
  inputs, situation, and driver profile — plus a reference to the catalog it uses. Algorithm
  parameters/hyperparameters MUST NOT be part of the world.
- **FR-002**: Control inputs MUST include trigger purpose, lifecycle stage, motion state, the
  service-constraint matrix version, and the selected catalog (dataset) identity.
- **FR-003**: The driver profile MUST own the driver's preferences and history (oshi/UPro information,
  service and content usage levels, scene-specific usage, acceptance/recovery rates and their confidence,
  playback and operation history, schedule), and MUST be a loadable, editable, reusable entity.
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
  ranges, id formats, and references to catalog items — and MUST reject invalid input with a message that
  names the offending field and the reason.
- **FR-009**: The system MUST provide built-in **base seeds**: complete worlds in which **every** feature
  field is initialized (including fields not central to the seed's theme). The system MUST ship at least
  the five representative seeds named in milestone §5.
- **FR-010**: Loading a base seed MUST restore the identical complete world every time (deterministic,
  round-trip stable).
- **FR-011**: A run created from a world MUST record a setup snapshot capturing the seed/clone identity, the
  catalog version + hash, the selected algorithm ids + their contract versions, and the parameter-set
  versions, together with the per-field provenance map. Reopening a run MUST render its stored world/setup
  snapshot without recomputation.

**Catalog loading, provenance & editing (US1 load / US2 edit)**

- **FR-012**: The in-app catalog MUST be the built-in frozen dataset. The system MUST load it by dataset
  identity/version/hash and display its provenance (identity, version, content hash, tier). No external or
  customer catalog import MUST be offered.
- **FR-013**: The system MUST allow editing a catalog song's track metadata, audio characteristics, and
  simulation flags through guarded, schema-aware controls.
- **FR-014**: Saving a catalog edit MUST re-validate the edited catalog against the dataset integrity rules
  (schema, numeric ranges, synthetic identity, `.invalid` links, cross-object identity, and absence of
  label/score fields) and MUST produce a **new derived catalog version with a new content hash** and
  provenance linking it to the base dataset.
- **FR-015**: The built-in frozen dataset MUST be immutable — a catalog edit MUST NOT modify the frozen
  dataset files; derived versions MUST be stored separately.
- **FR-016**: A catalog edit that fails validation MUST be rejected with a field-level message and MUST NOT
  produce a new version.
- **FR-017**: Catalog editing MUST NOT re-run the dataset generator and MUST NOT perform any network or
  external-data access.

**Contrast clones (US3)**

- **FR-018**: The system MUST allow cloning a base seed while changing one variable, producing a new
  complete valid world.
- **FR-019**: A clone MUST expose a deterministic field-level diff versus its base, listing exactly the
  changed field(s) with before/after values and nothing unchanged.
- **FR-020**: The system MUST support at least the one-variable contrast changes named in milestone §5
  (motion state; high/low drowsiness; high/low fatigue; 8 vs 45 minutes to rest; oshi mode on/off; upcoming
  event vs none; recent skip/rejection vs none; same acceptance rate high vs low confidence;
  `genre_affinity_v1` off vs on).

**Boundary & compatibility**

- **FR-021**: This feature MUST NOT introduce real service/content ranking, eligibility narrowing by
  motion/catalog/schedule, or journey progression; the two selectors remain the P1 mocks operating on the
  now-real world.
- **FR-022**: The proposal world, catalog, and run state MUST remain isolated from the trigger simulator;
  editing the proposal world MUST NOT affect trigger setup or state, and the trigger simulator MUST continue
  to function unchanged.
- **FR-023**: The world/catalog/seed/clone editing surface MUST preserve the approved P1 three-panel screen
  layout (no additional Setup panel) and MUST be fully bilingual with Japanese as the default language.

### Key Entities

- **World**: A complete proposal setup = control inputs + situation + driver profile + catalog reference.
  Projects to the flat selector feature snapshot.
- **ControlInputs**: Trigger purpose, lifecycle stage, motion state, matrix version, selected dataset id.
- **Situation**: The momentary driving scene (driver state, environment, passengers, route/destination,
  rest-spot feasibility, current proposal session).
- **DriverProfile**: The driver's preferences + history, including the opt-in `genre_affinity_v1` extension;
  reusable and loadable.
- **SeedWorld**: A named, built-in, complete world with all fields initialized.
- **WorldClone**: A base-seed-derived world plus its overrides and a computed field-level diff.
- **Dataset/Catalog**: The frozen built-in music dataset (songs = track + audio features + simulation
  flags) with a manifest (identity, version, content hash, tier, provenance); derived versions link back to
  the base.
- **SetupSnapshot**: The versioned, provenance-labelled record of what produced a run (seed/clone, catalog
  version + hash, algorithm ids + contract versions, parameter-set versions).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A reviewer can load a base seed and reach a complete, populated, editable world in which
  100% of the approved service and content features are present and editable, with algorithm parameters
  shown separately from world features.
- **SC-002**: 100% of invalid world edits (bad range, bad enum, unknown catalog reference,
  incompatible purpose/stage) are rejected with a field-level message; 0% are silently accepted.
- **SC-003**: The in-app catalog is always the built-in dataset; there is no path to import an external
  catalog, and catalog provenance (identity/version/hash) is visible for every loaded catalog.
- **SC-004**: Saving a valid catalog edit always yields a new derived version whose content hash differs
  from the base, while the frozen dataset files remain byte-for-byte unchanged (verified by hash); saving
  an invalid edit never creates a version.
- **SC-005**: A cloned world's diff lists exactly the changed field(s) and nothing else, and is identical
  on repeat (deterministic).
- **SC-006**: Reloading any base seed restores a world identical to the original in every field.
- **SC-007**: The existing trigger simulator's tests continue to pass and no proposal edit changes trigger
  state.
- **SC-008**: Reopening a persisted run renders its stored world and setup snapshot with no recomputation.

## Assumptions

- The frozen P2 dataset (`soundcharts-grounded-spotify-compatible-demonstration-seed-1042`, 300 songs) is
  present and valid; it is the sole built-in catalog for V1.
- The committed generator base-seed worlds and contrast pairs exist and are promoted, at authoring time,
  into a stable app-readable location and completed to cover every approved feature field. The generator
  workspace itself is not read at runtime.
- The existing dataset validation/hash/manifest building blocks from the P2 generator are reused for
  re-validating and re-hashing edited catalogs rather than re-implemented.
- Derived catalog versions and cloned worlds are local, single-user artifacts stored alongside existing
  proposal run data; they are not committed build artifacts.
- The service and content selectors remain the P1 mock packages for this milestone; real scoring arrives in
  later milestones and MUST require no change to the world contract defined here.
- Japanese is the default presentation language; English is fully supported.
