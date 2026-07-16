# Feature Specification: P0.5 — Content Contract & Song-Schema Freeze

**Feature Branch**: `proposal-p0.5-content-schema-freeze`

**Created**: 2026-07-16

**Status**: Draft

**Input**: User description: "P0.5 — Content Contract & Song-Schema Freeze. Freeze the versioned content-selector input/output contract, the Spotify-compatible song schema, the optional genre_affinity_v1 extension shape, a feature-disposition registry, and hand-authored algorithm-blind fixtures, per docs/superpowers/specs/2026-07-16-proposal-p0.5-design.md and docs/master/aica_proposal_simulator_milestones.md §2.5."

## Overview

This feature freezes the exact, versioned contracts that the transparent content-selector proposal package (a later milestone, P6) will be authored and validated against, and that the synthetic-music-dataset generator (a later milestone, P2) will use as its validation target. It is a **contract and schema definition milestone**: it produces contract definitions, a machine-readable schema export, a feature-disposition registry, and hand-authored example/counter-example data — but **no ranking logic, no proposal screen, no runtime proposal endpoint, and no live model or network behavior**. Its value is that it lets the content-proposal package be built and tested in complete isolation from every other proposal milestone, and it removes cross-document ambiguities before any code depends on them.

The audiences ("users") are: **downstream milestone implementers** (who consume the frozen contract to build the content package and the dataset generator) and **product / algorithm / UX / simulator reviewers** (who must be able to see that every approved feature has an explicit, non-dropped disposition and that the song schema is honestly synthetic and self-consistent).

## Clarifications

### Session 2026-07-16

- Q: At what granularity does the disposition registry enumerate rows (and what does the Appendix A.2 cross-check assert)? → A: One entry per Appendix A.2 **field**; scored categorical fields carry their enum-value responses as nested sub-data; the cross-check is field-row-set equality with the A.2 table.
- Q: What is the song schema's posture toward fields not in the frozen inventory? → A: Strict at the song-namespace level (reject unknown top-level song namespaces) and strict for the flags object; lenient *inside* the Spotify track/audio-features objects (extra provider fields are allowed, not rejected).
- Q: How must a malformed-record rejection identify which rule failed? → A: Via the validation library's structured errors (offending field path + message), asserted by the negative-fixture tests; no bespoke song-schema reason-code taxonomy is added in P0.5 (the frozen content-output error categories remain the only coded error layer).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Author and validate the content package against a frozen contract, standalone (Priority: P1)

A downstream implementer building the transparent content-selector package needs a single, versioned, unambiguous definition of what the package receives (the common selector input) and what it must return (one ordered concrete plan, `complete_plan`, with per-item fit, song traits, per-feature contributions, and reasons — and no aggregate plan score). They need this without any other proposal milestone (screen, world, journey engine, service selector, dataset generator) being present.

**Why this priority**: This is the milestone's core purpose (design §1, milestone §2.5). Without a frozen input/output contract, the content package cannot be built or tested in isolation, which is the entire reason P0.5 is pulled ahead of P1/P2/P6.

**Independent Test**: Construct a well-formed selector input and a well-formed `complete_plan` from the frozen contract definitions alone; confirm both validate. Construct malformed variants (incompatible trigger-purpose/lifecycle-stage pairing, a plan that carries an aggregate score, an ordered item missing its per-feature contributions on a transparent plan) and confirm each is rejected. Confirm a machine-readable schema for both contracts exists and can be consumed by a party that does not import the simulator backend.

**Acceptance Scenarios**:

1. **Given** the frozen common selector input contract, **When** a reviewer supplies a valid content-selector input (a valid trigger purpose, a compatible lifecycle stage, a non-empty resolved allowed-service set, a selected service, and a complete content feature snapshot), **Then** it is accepted as valid.
2. **Given** the frozen input contract, **When** the trigger purpose and lifecycle stage are incompatible (for example a during-rest stage paired with a non-rest purpose), **Then** the input is rejected with a clear reason.
3. **Given** the frozen content-output contract, **When** a valid `complete_plan` is supplied with ordered items each carrying an item fit, four song trait values, per-feature contributions, and reasons, **Then** it is accepted, and **no aggregate plan-level score field exists anywhere in the output**.
4. **Given** the frozen content-output contract, **When** a plan is supplied in the shape a future LLM package would produce (per-item fit absent and per-feature contributions empty), **Then** it is accepted (the contract is shared across transparent and LLM approaches).
5. **Given** the frozen contracts, **When** a downstream party inspects the committed machine-readable schema export, **Then** the export matches the contract definitions exactly (they cannot silently drift).

---

### User Story 2 - Validate synthetic songs against the frozen song schema (Priority: P1)

A downstream implementer building the dataset generator, and any reviewer checking a hand-authored song, needs a frozen definition of a synthetic song: the Spotify-compatible track object, the Spotify-compatible audio-features object, and the simulator availability flags — plus the per-record invariants that make a song well-formed, self-consistent, and visibly synthetic.

**Why this priority**: The content package scores concrete songs; without a frozen song schema the package has nothing to score against and the generator has no validation target. Milestone acceptance requires the schema to accept a valid smoke fixture and reject malformed records.

**Independent Test**: Validate every hand-authored valid song fixture (accepted) and every hand-authored malformed fixture (rejected, each for its specific intended rule). Confirm cross-object identity (track and audio-features agree on identifier, resource identifier, and duration) and synthetic-identity rules (identifiers visibly marked synthetic; every link on the reserved non-resolving domain).

**Acceptance Scenarios**:

1. **Given** the frozen song schema, **When** a well-formed synthetic song from the smoke set is validated, **Then** it is accepted.
2. **Given** the frozen song schema, **When** a song violates a single rule (an out-of-range audio value, an invalid mode/time-signature value, a track/audio-features duration mismatch, a link on a resolvable domain, or an identifier missing the synthetic marker), **Then** it is rejected and the failing rule is identifiable.
3. **Given** the frozen availability flags, **When** a song carries a value outside the permitted set, **Then** it is rejected; and **When** a valid instrumental-leaning song still carries both flags enabled, **Then** it is accepted (the flags are eligibility gates, never scores).

---

### User Story 3 - See every approved feature's disposition; nothing silently dropped (Priority: P1)

A product/algorithm/UX reviewer must be able to confirm that every feature in the independent content feature contract (specification §9 / Appendix A.2) has an explicit disposition — scored, context-only, or available-but-not-used — with visible provenance, and that the six genre-gated features behave as context-only unless the optional genre extension is enabled. No approved row may be silently omitted.

**Why this priority**: The constitution and milestone forbid shortening a feature category into an ambiguous aggregate or dropping rows. This is a milestone acceptance criterion and a permanent cross-milestone quality gate.

**Independent Test**: Enumerate the disposition registry and confirm every Appendix A.2 content row is present exactly once with a valid disposition and provenance; confirm the six genre-gated rows are exactly the expected set and are treated as context-only when the extension is off; confirm the registry's row set matches the Appendix A.2 table (drift guard).

**Acceptance Scenarios**:

1. **Given** the feature-disposition registry, **When** it is compared against Appendix A.2's content feature table, **Then** every row appears exactly once with a declared disposition and both feature-origin provenance and (for scored rows) response-coefficient provenance.
2. **Given** the registry, **When** the optional genre extension is absent, **Then** the six genre-gated features are marked context-only and reproduce the no-extension behavior; **When** it is present, **Then** those six become scored.
3. **Given** the registry and the Appendix A.2 table, **When** either changes, **Then** an automated cross-check detects any divergence between them.

---

### User Story 4 - Optional genre extension shape is frozen and safely off by default (Priority: P2)

A reviewer/implementer needs the optional `genre_affinity_v1` extension's data shape frozen: an artist-level genre lookup over a fixed controlled vocabulary, plus the optional per-genre usage history fixtures — and a guarantee that enabling it never overwrites the core song namespaces.

**Why this priority**: The extension is opt-in and must not perturb the Spotify-only baseline. Freezing its shape now lets P2/P6 build the extension path without re-litigating its contract, but it is secondary to the core contracts above.

**Independent Test**: Validate a well-formed extension fixture (accepted); reject an out-of-vocabulary genre, an unresolved artist reference, an invalid usage level, and any attempt to add keys inside the core song namespaces.

**Acceptance Scenarios**:

1. **Given** the frozen extension shape, **When** a valid artist-genre lookup and per-genre usage fixture over the controlled vocabulary are supplied, **Then** they are accepted.
2. **Given** the frozen extension shape, **When** a genre outside the controlled vocabulary or a usage level outside the permitted set is supplied, **Then** it is rejected.
3. **Given** the frozen extension shape, **When** the extension attempts to add a field inside the track, audio-features, or availability-flag namespaces, **Then** it is rejected (no-overwrite rule).

---

### User Story 5 - Cross-document ambiguities resolved before freeze (Priority: P2)

A reviewer must see that the known cross-document divergences touching the content contract have been resolved with written rationale before the contract is frozen: control-input naming normalized, schedule-field ownership decided, every "additional proposed" content row given a disposition, and the genre field renames aligned.

**Why this priority**: The milestone explicitly requires these §17 items resolved before the contract freezes. Leaving them ambiguous would let downstream code encode conflicting assumptions.

**Independent Test**: Confirm the master documents use the single canonical control-input naming everywhere (an automated consistency check passes); confirm the design record and milestone document record each resolution with rationale.

**Acceptance Scenarios**:

1. **Given** the master documents, **When** they are scanned for the control-input naming, **Then** only the single canonical form appears (the older dotted form is absent).
2. **Given** the milestone document, **When** the open-reconciliation items touching the content contract are reviewed, **Then** each is marked resolved with a written rationale and a pointer to the design record.

---

### Edge Cases

- A content feature snapshot is missing a scored field → the contract treats it as present-but-neutral context (the field is retained, not dropped), never as an error at the contract level.
- A raw value of zero on a 0–100 feature is a valid low value, not "missing".
- A song is purely instrumental (very high instrumentalness) → still schema-valid and still eligible by flags; instrumentalness affects a decision-time trait, not the schema or eligibility gate.
- A song's set of artist genres is empty under the extension → the extension shape still validates (emptiness is handled as neutral by the later scoring milestone, not rejected here).
- The machine-readable schema export is edited by hand and diverges from the contract definitions → the drift-guard check fails.
- An Appendix A.2 row is added or renamed without updating the registry → the cross-check fails.

## Requirements *(mandatory)*

### Functional Requirements

**Common selector input contract**

- **FR-001**: The frozen common selector input contract MUST define all fields of the shared selector input (contract version, opportunity identifier, simulation time, trigger purpose, lifecycle stage, resolved allowed-service set, feature snapshot, feature provenance, enabled feature extensions, an optional selected service for the content selector, eligible candidates, excluded candidates with a platform reason, parameters, hyperparameters, package runtime state, catalog version, run seed).
- **FR-002**: The input contract MUST enforce that the trigger purpose is one of the four approved values and the lifecycle stage is one of the four approved values, and MUST reject incompatible purpose/stage pairings (the three rest stages only with the rest purpose; the single-stage driving flow only with the non-rest purposes).
- **FR-003**: The input contract MUST require a non-empty resolved allowed-service set and MUST treat trigger purpose and lifecycle stage as control inputs, never as scored feature values.

**Content-selector output contract**

- **FR-004**: The frozen content-output contract MUST define one ordered concrete plan (`complete_plan`) with: a decision/error type, the selected service, requested and returned item counts, an ordered list of items, a plan mode, an expected duration, an optional lighting configuration, approval/completion/next-transition policies, excluded items, unused-available and missing feature lists, and algorithm provenance.
- **FR-005**: Each ordered item MUST carry position, item identifier, an item fit value that MAY be absent for a non-transparent (LLM) plan, the four song trait values (energetic/bright plus the two karaoke-ease proxies) including their signed forms, per-feature contributions that MAY be empty for a non-transparent plan, and human-readable reasons.
- **FR-006**: The content-output contract MUST NOT contain any aggregate plan-level score or any plan-candidate ranking.
- **FR-007**: The content-output contract MUST enumerate the complete set of content decision and error categories (complete plan, no proposal, insufficient eligible items, unsupported service, unsupported recipe, invalid request, invalid catalog, invalid configuration, full-karaoke-requires-stopped).
- **FR-008**: The approval, completion, and next-transition policy fields MUST be frozen as fields whose detailed value semantics are documented as owned by the later journey-engine milestone (the fields are frozen; their full value sets are not closed here).

**Song schema**

- **FR-009**: The frozen song schema MUST define the Spotify-compatible track object over its full approved field inventory, the Spotify-compatible audio-features object over its full approved field set, and the simulator availability flags. The schema MUST be **strict at the song-namespace level** (a song carries only the `spotify_track`, `spotify_audio_features`, and `simulation_flags` namespaces; an unknown top-level namespace is rejected) and strict for the flags object, but **lenient inside** the Spotify track/audio-features objects (unenumerated provider fields are permitted, not rejected), faithful to real Spotify object shapes.
- **FR-010**: The song schema MUST enforce per-record invariants: correct type discriminators; normalized audio values within range; permitted values for coarse fields (mode, time signature, key); positive duration and tempo; finite loudness; and agreement between the track and audio-features objects on identifier, resource identifier, and duration.
- **FR-011**: The song schema MUST enforce synthetic identity: every synthetic identifier visibly marked as synthetic, and every link on the reserved non-resolving domain, with no link resembling a live provider endpoint.
- **FR-012**: The availability flags MUST accept only the two permitted values, default to enabled, act as eligibility gates only, and never contribute to a score. A song MUST remain valid and flag-eligible regardless of how instrumental it is.
- **FR-013**: Dataset-level checks (identifier uniqueness across the whole dataset, coverage quotas, balance) are explicitly out of scope for this milestone and are owned by the dataset-generation milestone; the song schema here validates a single record and cross-object identity within that record.

**Optional genre extension**

- **FR-014**: The frozen optional genre extension shape MUST define an artist-level genre lookup keyed by artist identifier over a fixed controlled vocabulary, plus the optional per-genre and per-scene-per-genre usage-history fixtures whose levels come from a fixed set.
- **FR-015**: The genre extension MUST reject any genre outside the controlled vocabulary and any usage level outside the permitted set, and MUST NOT add any field inside the track, audio-features, or availability-flag namespaces (no-overwrite rule).
- **FR-016**: When the extension is absent, the six genre-gated content features MUST be treated as context-only, reproducing the no-extension behavior; when present, those six MUST be eligible to be scored.

**Feature-disposition registry**

- **FR-017**: The system MUST provide a versioned feature-disposition registry that lists **one entry per Appendix A.2 field**, each with a disposition (scored, context-only, or available-but-not-used), feature-origin provenance, response-coefficient provenance for scored rows, a genre-gated flag, a source reference, and a rationale. Scored categorical fields MUST carry their per-enum-value response detail as nested sub-data on the field's entry (rather than as separate top-level rows), so the registry's row set stays 1:1 with the Appendix A.2 field table.
- **FR-018**: The registry MUST mark every Appendix A.2 content row — including all "additional proposed" simulator rows and the schedule fields — with an explicit disposition; no approved row may be silently omitted.
- **FR-019**: An automated check MUST confirm the registry's field-row set matches the Appendix A.2 content field table (row-set equality) so the two cannot drift apart.
- **FR-020**: The registry MUST distinguish feature-origin provenance from response-coefficient provenance and never conflate the two.

**Versioning, export, and artifacts**

- **FR-021**: The contracts and schema MUST carry explicit versions (a contract version for the selector input/output and a schema version for the song schema; the genre extension carries its own version), recorded so a later setup snapshot can reference them.
- **FR-022**: The system MUST export a machine-readable schema for the input contract, the content-output contract, the song schema, and the genre extension, plus a machine-readable serialization of the disposition registry, as committed frozen artifacts consumable by a party that does not import the simulator backend.
- **FR-023**: An automated drift-guard check MUST confirm the committed machine-readable schema and registry serialization match a fresh export from the contract definitions.
- **FR-024**: The milestone MUST provide hand-authored, algorithm-blind fixtures: valid smoke songs; calm/active, bright/dark, and acoustic/electric contrast song pairs; at least one high-instrumentalness song; malformed songs each isolating one rejection rule; and world/feature snapshots including one with the genre extension enabled. Fixtures MUST NOT be tuned to any scoring outcome.

**Documentation reconciliation**

- **FR-025**: The control-input naming MUST be normalized to the single canonical form across all master documents, and an automated consistency check MUST confirm the older dotted form no longer appears.
- **FR-026**: The §17 open-reconciliation items touching the content contract (control-input naming, schedule-field ownership, "additional proposed" content-row dispositions, and genre field renames) MUST each be recorded as resolved with written rationale before the contract is considered frozen.

**Isolation and regression**

- **FR-027**: The frozen proposal contracts MUST be isolated from the existing trigger-simulator contracts (no shared or cross-imported definitions), and the existing trigger simulator MUST continue to pass its existing tests unchanged.

### Key Entities *(include if feature involves data)*

- **Common selector input**: The neutral snapshot both selector types receive — controls (trigger purpose, lifecycle stage, allowed services, selected service), the feature snapshot with provenance, candidate lists, parameters/hyperparameters, package runtime state, and version/seed fields.
- **Complete plan (content output)**: One ordered concrete plan — ordered items (each with fit, traits, per-feature contributions, reasons), plan mode, duration, optional lighting, policies, excluded items, unused/missing feature lists, provenance. No aggregate score.
- **Song**: A synthetic catalog record composed of a Spotify-compatible track object, a Spotify-compatible audio-features object, and simulator availability flags, joined by a shared identifier.
- **Genre extension (`genre_affinity_v1`)**: An optional artist-level genre lookup over a controlled vocabulary plus optional per-genre usage fixtures; never overwrites core song namespaces.
- **Feature-disposition registry**: The authoritative per-row disposition and provenance list for every content feature in specification §9 / Appendix A.2.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A reviewer can construct and validate a complete content-selector input and a complete `complete_plan` using only the frozen contract definitions and the exported schema — with no other proposal milestone present.
- **SC-002**: 100% of the hand-authored valid song fixtures are accepted, and 100% of the malformed song fixtures are rejected; for each malformed fixture a test asserts the rejection points at the specific offending field/rule (via the validation error's field path/message), so rejections are attributable rather than generic.
- **SC-003**: 100% of Appendix A.2 content rows appear exactly once in the disposition registry with a valid disposition and provenance, and the registry-vs-Appendix cross-check passes.
- **SC-004**: With the genre extension off, the six genre-gated features are context-only and reproduce the no-extension behavior; with it on, they are eligible to be scored — and the extension can never overwrite a core song namespace.
- **SC-005**: The exported machine-readable schema and registry serialization match the contract definitions (drift-guard passes), and the older dotted control-input naming appears nowhere in the master documents.
- **SC-006**: The content-output contract contains no aggregate plan score anywhere, verified by an automated check.
- **SC-007**: The existing trigger simulator's test suite continues to pass unchanged (no regression).

## Assumptions

- The audiences are downstream milestone implementers and internal reviewers; there is no end-user-facing UI, endpoint, or bilingual presentation in this milestone (those arrive with the proposal screen milestone, P1).
- The authoritative sources for field lists, math roles, dispositions, and the song schema are the master documents (specification §5/§8/§9, the transparent content algorithm document, and the synthetic-music-data specification §4–6/§13/§21); where the design record resolved a §17 divergence, the resolution in the approved design record governs.
- The service-selector output contract is deferred to the proposal-screen milestone (P1); this milestone freezes only the shared input contract, the content-output contract, the song schema, the genre extension shape, and the disposition registry.
- The content feature snapshot is validated structurally (keys and provenance), not field-by-field, because the full editable-world field models belong to the editable-world milestone (P3); the disposition registry is the authoritative content-field list until then.
- Verification runs against the repository's Python backend test suite; the canonical containerized command is preferred where available, with a documented equivalent local Python environment as a deterministic fallback when the container is not reachable.
- No live model call or network access occurs in this milestone or in any transparent run that later consumes these contracts.
