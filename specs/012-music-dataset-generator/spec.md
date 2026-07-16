# Feature Specification: P2 — Synthetic Music Dataset Generation & Validation

**Feature Branch**: `proposal-p2-soundcharts-dataset`

**Created**: 2026-07-16

**Status**: Draft

**Input**: User description: "P2 — Synthetic Music Dataset Generation & Validation. Build the offline music-dataset generator described in docs/superpowers/specs/2026-07-16-proposal-p2-design.md and docs/master/p2-soundcharts-grounded-data-generation-design.md. A separate repo-root package music_dataset_generator (import root mdg) implementing the S0–S9 Soundcharts-grounded pipeline."

## Overview

The proposal simulator's transparent content selector (P6) scores concrete songs from Spotify-compatible records. Those records must be **real, coherent, and reproducible** so reviewers trust them and so replay is deterministic. P2 delivers the **offline tooling** that produces that dataset: it grounds a catalog in **real song data harvested from the Soundcharts API** (the customer has no Spotify access), maps it into the frozen `Song` schema (keeping **real song/artist names and verbatim real audio-feature values**, while every ID is `synthetic-…` and every URL is on `.invalid`), validates and freezes a **versioned catalog artifact**, and emits a **labeled test-case set** in which an interactive LLM judges each label **blind** and the P6 score is recorded as an independent **cross-check**.

The generator is offline tooling that produces a committed, versioned artifact — **not** a runtime feature. The **committed frozen dataset (not a rerun of the harvest) is the replay boundary**: no transparent simulation run ever calls Soundcharts, the web, or an LLM.

Authoritative design: `docs/master/p2-soundcharts-grounded-data-generation-design.md` (S0–S9 pipeline, decisions D1–D14) and data spec `docs/master/aica_synthetic_music_data_and_generation_specification.md` §0. Implementation realization: `docs/superpowers/specs/2026-07-16-proposal-p2-design.md`.

## Clarifications

### Session 2026-07-16

- Q: Language split target across the 36 standard demonstration songs? → A: **~30 JA / ~6 EN / 0 other** (strong Japanese dominance, a minimal EN cohort for cross-language contrast, no other languages in the standard set).
- Q: `isrc_probe_gate_failed` threshold for the ~15-ISRC step-zero probe? → A: **≥ 60% (≥ 9 of 15)** must return complete audio + usable `languageCode`, else the `isrc_resolved` strategy halts before the run.
- Q: What does `random_seed` deterministically pin (the live harvest is non-reproducible; the transform is)? → A: **synthetic-ID allocation order + selection tie-breaks among equally-eligible songs + negative-fixture placement** — the same accumulated cache + same seed → byte-identical catalog.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Reviewer obtains a trustworthy, reproducible frozen catalog (Priority: P1)

A simulator maintainer runs the generator's deterministic transform over the accumulated harvested-response cache and gets a **byte-identical, versioned, schema-valid, coverage-complete** catalog of real-named songs with real audio values and fully synthetic identity. Every later proposal milestone consumes this frozen artifact by ID/version/hash.

**Why this priority**: Without a frozen, validated, reproducible catalog there is nothing for P3–P11 to consume and no deterministic replay boundary. This is the milestone's core deliverable (P2a).

**Independent Test**: Run the transform over a committed set of recorded harvested-response fixtures with no network and no interactive agent present; confirm the same catalog + manifest + hash is produced on repeated runs, that every record is schema/range/identity valid and visibly synthetic, and that the demonstration tier meets every coverage/quota rule.

**Acceptance Scenarios**:

1. **Given** an accumulated cache of harvested real responses and the frozen prompt/generator/validation/schema versions, **When** the transform runs twice, **Then** it produces byte-identical catalog output both times.
2. **Given** a harvested real record, **When** it is mapped and validated, **Then** its IDs all start `synthetic-`, all URLs are on `.invalid` hosts (never `api.spotify.com`/`open.spotify.com`), its real song/artist names and audio-feature values are preserved, and cross-object identity (track ↔ audio-features id/uri/duration) holds.
3. **Given** the demonstration tier, **When** coverage is checked, **Then** all 36 energy×tempo×profile cells are present, the secondary spreads (valence/mode/acousticness/humming_ease/full_karaoke_ease/genre) are covered, and the artist/album/era/explicit/negative-fixture/duration/time-signature/`key:-1` quotas are satisfied.
4. **Given** a record that fails validation, **When** repair runs, **Then** it changes only invalid fields and their direct dependents, logs each repair, and **halts the whole run with `catalog_generation_failed` after two failed repairs** on any record.
5. **Given** a frozen catalog, **When** it is inspected, **Then** it contains no `recommended` / `best_for_world` / `target_rank` (or any score/label) field anywhere.

### User Story 2 — Operator harvests real songs from Soundcharts to fill coverage (Priority: P1)

An operator supplies a Soundcharts API key and runs the harvest to populate the cache. The generator plans coverage, an interactive LLM names real songs per coverage cell (web-grounded, existence-verified, never emitting an ISRC or audio number), a deterministic resolver turns each `(title, artist, year)` into an ordered candidate-ISRC list via MusicBrainz + Deezer, and the harvester fetches songs by ISRC until it obtains a populated real audio block — with the **real audio and real `languageCode` deciding the coverage cell and language, never the LLM's guess.**

**Why this priority**: This is how real data enters the pipeline and is the front-half that must exist for the catalog to be grounded. It carries the firewall that keeps generation coverage-driven, not score-driven.

**Independent Test**: With MusicBrainz/Deezer live (auth-free) and Soundcharts either live (key supplied) or replayed from recorded fixtures, run the harvest for a set of needed cells and confirm real records land in the cache with lineage, that misses are logged and drive the fill loop, and that a song whose real audio bins elsewhere lands in its actual cell (or is discarded) rather than the guessed cell.

**Acceptance Scenarios**:

1. **Given** a coverage plan needing a cell, **When** the LLM names candidate songs, **Then** each carries `(title, artist, release_year, expected_language, why_fits_cell, web_evidence)` and **no ISRC or audio number**; LLM output containing an ISRC or audio value is rejected.
2. **Given** a named `(title, artist, year)`, **When** the resolver runs, **Then** it queries both MusicBrainz and Deezer, reconciles into a deduped candidate-ISRC list ordered original-release-first, and writes all candidate ISRCs to lineage; if neither source yields an ISRC it records `song_not_found_in_sources` and moves to the next name.
3. **Given** a candidate-ISRC list, **When** the harvester fetches by ISRC, **Then** it advances past ISRCs that 404 (`isrc_not_in_soundcharts`) or return null/partial audio (`audio_unavailable`) until one returns a populated audio block, else records the name a miss.
4. **Given** a fetched record whose real `languageCode` disagrees with the cell's target language, **When** it is gated, **Then** it is discarded (`language_mismatch`) and never relabeled; language is taken from the real `languageCode`, not the LLM's `expected_language`.
5. **Given** a fetched record whose real audio bins into a different cell than guessed, **When** the selector runs, **Then** the record lands in its actual audio cell (kept if that cell needs it, discarded if full) — the guess never assigns the cell.
6. **Given** the `isrc_resolved` strategy about to run on old/regional cells, **When** the step-zero audio-coverage probe runs first, **Then** it records how many hand-picked ISRCs return complete audio + usable `languageCode`; below the minimum threshold it raises `isrc_probe_gate_failed` and the strategy does not proceed.

### User Story 3 — Loopable, resumable, additive generation (Priority: P2)

An operator runs generation as a sequence of loops: after inspecting the output they launch another loop that **continues without redoing prior work** — filling still-empty cells and optionally enriching already-covered cells with more songs — using a persistent carry-over ledger so no name is re-proposed and no ISRC/UUID is re-resolved or re-fetched.

**Why this priority**: Real harvest happens incrementally against limited quota; without resumability the operator would waste quota redoing work. Enables the "run a bit, inspect, run more" workflow.

**Independent Test**: With a populated ledger, run a second loop and confirm it re-proposes no ledgered name, re-resolves no ledgered `(title, artist)`, re-fetches no ledgered ISRC/UUID, never retries a known miss, fills remaining cells, and may add to covered cells — and that the transform over the accumulated cache stays byte-identical.

**Acceptance Scenarios**:

1. **Given** a ledger with accepted entries, **When** a new loop's coverage plan runs, **Then** it subtracts accepted entries to compute remaining + enrichment targets (loop 1 sees an empty ledger).
2. **Given** ledgered names/ISRCs/UUIDs, **When** a loop runs, **Then** naming excludes ledgered names, the resolver reuses cached candidate ISRCs, the harvester skips already-fetched ISRCs/UUIDs, and known misses are not retried.
3. **Given** a covered cell, **When** enrichment runs, **Then** additional songs may be admitted to it purely by real-audio pigeonhole (never by score), with per-cell depth a soft priority (empty → shallow → enrich) and no hard cap.
4. **Given** any loop result, **When** it completes, **Then** every new accepted **and** miss (with reason, cell, loop number) is appended to the ledger; the ledger is append-only across loops.

### User Story 4 — Interchangeable candidate strategies behind one flag (Priority: P2)

The front-half that acquires candidates is selectable via a `candidate_source` flag with two interchangeable strategies that both terminate at the same cache + lineage boundary; everything downstream is strategy-agnostic.

**Why this priority**: The design mandates two strategies (one is the working default, one the retained fallback). Downstream determinism must not depend on which strategy ran.

**Independent Test**: Populate a fixed cache via each strategy path and confirm the transform (S3→S6) produces a byte-identical catalog regardless of `candidate_source`; confirm the fallback strategy's unavailable live endpoint raises a clear error rather than fabricating data.

**Acceptance Scenarios**:

1. **Given** `candidate_source=isrc_resolved` (default), **When** the front-half runs, **Then** it uses LLM naming → MusicBrainz/Deezer resolution → by-ISRC harvest.
2. **Given** `candidate_source=soundcharts_search`, **When** a live search-by-metric call is attempted, **Then** it raises `strategy_unavailable` (endpoint off-subscription); the strategy is otherwise fully implemented and testable against recorded search fixtures.
3. **Given** a fixed raw-response cache, **When** the transform runs, **Then** it yields the same catalog regardless of which strategy populated the cache.

### User Story 5 — Genre mapping into the frozen 12-term vocabulary (Priority: P2)

Real Soundcharts genre text `{root, sub[]}` is mapped by a deterministic **sub-first** rule into the frozen `genre_affinity_v1` 12-term controlled vocabulary that only feeds the opt-in genre-scoring extension; the real genre text is kept for display/lineage only.

**Why this priority**: The `genre_affinity_v1` extension needs a total, deterministic mapping; the vocabulary must stay frozen (no contract change).

**Independent Test**: Feed representative `{root, sub}` pairs and confirm every pair resolves to one of the 12 terms or `genre_unmappable_to_vocabulary` (→ `missing_neutral`), that sub-overrides beat root-fallback, and that with the extension off the catalog reproduces the no-extension P6 ranking exactly.

**Acceptance Scenarios**:

1. **Given** `{root: j-pop, sub: city pop}`, **When** mapped, **Then** it resolves to `city pop` (sub-override wins over root).
2. **Given** `{root: soundtrack, sub: anime}`, **When** mapped, **Then** it resolves to `anime`.
3. **Given** a `{root, sub}` with no mapping, **When** mapped, **Then** it yields `genre_unmappable_to_vocabulary` and contributes no genre for that entry (no weight redistribution).
4. **Given** the extension disabled, **When** P6 ranks the catalog, **Then** the ordering matches the no-extension result exactly; the 12-term vocabulary and `genre_affinity_v1` schema are unchanged.

### User Story 6 — Worlds, base seeds, and one-variable contrast pairs (Priority: P2)

After the catalog is frozen, the generator produces ≥15 base worlds and 12 one-variable contrast pairs with their stated expected directions, whose histories/oshi/genre-usage reference real catalog IDs and are composed coherently by the interactive LLM.

**Why this priority**: Worlds and contrast pairs are what P6 certification and the test-case set exercise; they must reference the frozen catalog (grounding gate) and be produced after freeze (ordering gate).

**Independent Test**: Load the frozen catalog and generate worlds; confirm every history/oshi/usage reference resolves to a catalog ID, each contrast pair differs in exactly one variable, and reloading a seed restores the same complete world.

**Acceptance Scenarios**:

1. **Given** a frozen catalog, **When** worlds are generated, **Then** every referenced Track/Artist ID exists in the catalog (`world_reference_failed` otherwise), and worlds are generated only after freeze.
2. **Given** the 12 required one-variable pairs, **When** built, **Then** each pair differs in exactly one variable and carries its stated expected direction.

### User Story 7 — Blind LLM judge, cross-check, and P6 contrast certification (Priority: P3)

For each `(world, candidate song)` the interactive LLM assigns `positive/negative/neutral` **blind**; the P6 score is then revealed and agreement recorded, producing the labeled test-case set. The P6 content selector is run over the contrast worlds to assert the required reversals; a pair that fails to reverse triggers a re-harvest of that cell, never number-tuning.

**Why this priority**: This is the two-evaluator payoff and the algorithm-certification value (P2c). It depends on the catalog (US1) and worlds (US6) existing first.

**Independent Test**: With a frozen catalog and worlds, confirm each LLM label is committed before the corresponding P6 score is revealed, that agreement/disagreement is recorded per test case, and that the required contrast reversals hold when P6 scores the paired worlds.

**Acceptance Scenarios**:

1. **Given** a `(world, candidate)` pair, **When** judged, **Then** the LLM label is committed **before** the P6 score is revealed (ordering enforced), and agreement (`agree`/`disagree`) is recorded after reveal.
2. **Given** a one-variable contrast pair, **When** P6 scores both worlds, **Then** the declared arousal/valence responses **reverse** (not merely rescale) across the contrast; a non-reversing pair triggers a cell re-harvest, never a numeric tweak toward a target.
3. **Given** the judge output, **When** the test-case set is written, **Then** it is a separate labeled artifact with LLM-judge provenance and the P6 cross-check; the song catalog stays label-free.

### Edge Cases

- A required cell cannot be filled from the source after N=3 fill rounds → `cell_unfillable_from_source` is logged (never faked).
- The step-zero probe reveals old/regional (e.g. 1960s-JA) cells return null audio → the coverage plan constrains those cells up front rather than failing mid-run.
- A synthetic ID has no resolvable lineage entry → `lineage_integrity_failed`.
- LLM structured output is malformed against its schema → the next stage rejects it and the interactive agent re-runs the prompt (no API retry loop).
- Soundcharts quota is exhausted mid-harvest → `soundcharts_harvest_failed`; the ledger preserves prior work so a later loop resumes.
- LLM and P6 disagree on a label → recorded as a signal (neutral/ambiguous fixture or a possible algorithm finding), not an error.
- A credential (Soundcharts key) is missing when a live harvest is requested → the run stops with a clear message; the deterministic transform over the cache still runs with no credential.

## Requirements *(mandatory)*

### Functional Requirements

**Coverage & planning (S0)**
- **FR-001**: The generator MUST produce a deterministic coverage plan enumerating the 36 energy×tempo×profile cells, the secondary spreads (valence, mode, acousticness, humming_ease, full_karaoke_ease, genre), the quotas (12 artists × 3 tracks, ≥12 albums, ≥3 eras, ≥6 explicit, ≥4 negative fixtures outside the 36, duration/time-signature spread, ≥1 `key:-1`), and the required contrast pairs.
- **FR-002**: The coverage plan MUST treat **language** and **era** as first-class, reported coverage dimensions layered onto the 36-cell grid (not additional multiplicative axes). The 36 standard demonstration songs MUST target a language split of **~30 Japanese / ~6 English / 0 other** (Japanese-primary; a minimal EN cohort for cross-language contrast; no other languages in the standard set). Language is confirmed deterministically from the real `languageCode`, never the LLM's guess.
- **FR-003**: The coverage plan MUST be **ledger-relative**: it subtracts already-accepted ledger entries to emit remaining targets plus an enrichment priority for shallow/covered cells.

**Candidate acquisition (S0.5–S2)**
- **FR-004**: The system MUST support two candidate strategies behind a `candidate_source` flag (`isrc_resolved` default, `soundcharts_search` fallback), both terminating at the same raw-response cache + lineage boundary.
- **FR-005**: In `isrc_resolved`, an interactive LLM MUST name real songs per cell emitting `(title, artist, release_year, expected_language, why_fits_cell, web_evidence[])` and MUST NOT emit an ISRC or any audio number; output violating this MUST be rejected.
- **FR-006**: A deterministic resolver MUST query MusicBrainz and Deezer, reconcile into a deduped candidate-ISRC list ordered original-release-first, and record all candidate ISRCs in lineage.
- **FR-007**: The harvester MUST fetch songs by ISRC, advancing past 404 / null-or-partial-audio candidates until a populated real audio block is obtained, and MUST record per-candidate miss signals (`song_not_found_in_sources`, `isrc_not_in_soundcharts`, `audio_unavailable`, `language_mismatch`).
- **FR-008**: Before `isrc_resolved` commits to old/regional cells, the system MUST run a step-zero audio-coverage probe (~15 hand-picked ISRCs) and raise `isrc_probe_gate_failed` if fewer than **60% (< 9 of 15)** return a complete audio block plus usable `languageCode`.
- **FR-009**: `soundcharts_search` MUST be fully implemented but MUST raise `strategy_unavailable` on a live search-by-metric call (endpoint off-subscription).
- **FR-010**: The harvester MUST record real Soundcharts payloads in a raw-response cache and a lineage file (`synthetic-id → source UUID + real name + real genre text`; `isrc_resolved` also records the resolved ISRC and all candidate ISRCs), and MUST track Soundcharts calls against a quota budget in the build report.
- **FR-011**: Soundcharts credentials MUST come only from the environment and MUST NEVER be committed, logged, echoed, or written into any artifact, manifest, lineage, or build report.

**Firewall & selection (S3)**
- **FR-012**: Coverage-cell assignment MUST derive only from arithmetic binning of the **real** audio values; no score, rank, label, or target may enter the coverage plan, selection, or any generation input.
- **FR-013**: The selector MUST admit songs by pigeonhole (cell empty or being enriched), allow multiple songs per cell, and skip only ledger-known identities (never discard by score).
- **FR-014**: The real `languageCode` MUST decide language and the real audio MUST decide the cell; a mismatched-language record is discarded (never relabeled) and a wrongly-guessed cell record lands in its actual cell or is discarded.

**Mapping, validation, freeze (S4–S6)**
- **FR-015**: The mapper MUST produce records conforming to the frozen `Song` schema (P0.5), keeping **real names, verbatim audio values** (`timeSignature`→`time_signature`), and the **real ISRC**, allocating `synthetic-` IDs and `.invalid` URLs, normalizing duration to milliseconds, and synthesizing fields Soundcharts lacks (album, disc/track number, popularity, available_markets, playability/negative-fixture restrictions).
- **FR-016**: The validator MUST enforce the data-spec §17 rule families: schema/types; cross-object identity; synthetic-identity + `.invalid` URL rules; Spotify numeric ranges; simulation flags/policy; coverage/balance/recommendation-independence; and `genre_affinity_v1` validation when present.
- **FR-017**: The repair loop MUST apply only deterministic §18 repairs to invalid fields and their direct dependents, log every repair, and **halt the run with `catalog_generation_failed` after two failed repairs** on any record (no silent manual edits).
- **FR-018**: The freeze step MUST write a `dataset_manifest` envelope (`dataset_id`, `dataset_kind: soundcharts_grounded_spotify_compatible`, `schema_version`, reference versions, `generator_version`, `prompt_template_version`, `validation_rules_version`, `random_seed`, `generated_at`, `synthetic_only: false`, provenance/licensing note, `dataset_hash`, and build-report provenance) and produce an immutable catalog snapshot.
- **FR-019**: The frozen catalog MUST NOT contain any `recommended`, `best_for_world`, `target_rank`, score, or label field.
- **FR-020**: The system MUST produce three tiers: `smoke` (5 valid + negative fixtures), `demonstration` (36 balanced songs + approved worlds), and `stress` (configurable size, same distributions).

**Genre mapping (§13)**
- **FR-021**: A deterministic, total sub-first `real → 12-vocab` map MUST resolve each `{root, sub[]}` to one of the frozen 12 vocabulary terms or `genre_unmappable_to_vocabulary` (→ `missing_neutral`), with sub-overrides winning over root-fallback; the 12-term vocabulary and `genre_affinity_v1` schema MUST remain unchanged.
- **FR-022**: With `genre_affinity_v1` absent, the six genre-scored features MUST be `context_only` and the catalog MUST reproduce the no-extension P6 result exactly.

**Loop & carry-over (S…)**
- **FR-023**: A persistent, gitignored carry-over ledger MUST record every touched song identity (by ISRC, source UUID, and normalized `title|artist`) with outcome, miss reason, cell, and loop number; it MUST be append-only across loops.
- **FR-024**: Loops MUST be additive (never remove), MUST NOT re-propose ledgered names, re-resolve ledgered `(title, artist)`, or re-fetch ledgered ISRCs/UUIDs, and MUST NOT retry a known miss.

**Worlds & test cases (S7–S9)**
- **FR-025**: World generation MUST occur only after the catalog is frozen, MUST reference existing catalog IDs (`world_reference_failed` otherwise), and MUST produce ≥15 base worlds and 12 one-variable contrast pairs with stated expected directions.
- **FR-026**: The interactive LLM MUST assign each test-case label **blind**, committed **before** the P6 score is revealed; agreement MUST be recorded after reveal; the labeled test-case set MUST be a separate artifact with judge provenance, and the catalog MUST stay label-free.
- **FR-027**: The P6 content selector MUST be run (by loading its package `evaluate` entrypoint by file path) over the contrast worlds to assert the required arousal/valence **reversals**; a non-reversing pair MUST trigger a cell re-harvest, never a numeric tweak toward a target.

**Execution model & reproducibility**
- **FR-028**: Deterministic stages MUST be standalone commands that run with **no LLM and no interactive agent present** and MUST NOT use any LLM API or key; LLM stages MUST be performed by the interactive agent via a **file handoff** (schema-checked input-context → prompt template → schema-checked structured-output), all committed for audit and resumability.
- **FR-029**: The deterministic transform (accumulated raw cache + frozen LLM outputs → catalog) MUST be **byte-identical and re-runnable** regardless of how many loops built the cache and regardless of which `candidate_source` populated it. `random_seed` MUST deterministically pin synthetic-ID allocation order, selection tie-breaks among equally-eligible songs, and negative-fixture placement, so the same accumulated cache + same seed yields byte-identical output.
- **FR-030**: The generator MUST be a **separate repo-root package** (not part of the runtime API package); it MUST reuse the frozen `Song` schema without duplicating it, and the runtime API MUST NOT depend on the generator.
- **FR-031**: The system MUST emit the typed error/status codes of design §9 and data-spec §22 (`soundcharts_harvest_failed`, `cell_unfillable_from_source`, `genre_unmappable_to_vocabulary`, `lineage_integrity_failed`, `song_not_found_in_sources`, `isrc_not_in_soundcharts`, `audio_unavailable`, `language_mismatch`, `isrc_probe_gate_failed`, `catalog_generation_failed`, `cross_object_identity_mismatch`, `synthetic_identity_violation`, `coverage_contract_failed`, `world_reference_failed`, `invalid_genre_extension`, …); `judge_disagreement` MUST be recorded as data, not an error.

**Regression & boundary**
- **FR-032**: No transparent simulation run may make a live LLM/network call; the committed frozen dataset is the replay boundary.
- **FR-033**: The existing trigger simulator and the P0.5/P6 proposal contracts MUST remain unchanged and their tests MUST continue to pass.

### Key Entities

- **Coverage plan / cell**: the deterministic targets (cells, spreads, quotas, contrast pairs, language & era dimensions) driving what to harvest; ledger-relative per loop.
- **Raw-response cache entry**: a real Soundcharts payload keyed by UUID (and, for `isrc_resolved`, resolving ISRC); gitignored generation state.
- **Lineage entry**: maps `synthetic-id → source UUID + real name + real genre text` (+ resolved/candidate ISRCs); gitignored.
- **Carry-over ledger entry**: one per touched identity — keys (ISRC / UUID / normalized name), outcome (accepted | miss), miss reason, cell, loop number; persistent, append-only, gitignored.
- **Song record**: the frozen `Song` (spotify_track + spotify_audio_features + simulation_flags) — real names + verbatim audio, synthetic identity, label-free.
- **Dataset manifest**: the versioned envelope + `dataset_hash` + provenance/licensing note that makes the frozen catalog identifiable and the replay boundary.
- **World / contrast pair**: driver/environment/passenger/oshi/history state referencing catalog IDs; contrast pairs differ in one variable with a stated expected direction.
- **Test case**: `(world, candidate song, expected label)` with LLM blind-judge folds, P6 cross-check score, agreement, and contrast partner/direction; separate labeled artifact.
- **Build report**: repairs, quota usage, coverage checklist, agreement stats, `candidate_source`, loop number, per-loop new-vs-skipped counts, probe result; committed evidence.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Running the deterministic transform over the same accumulated cache twice produces byte-identical catalog output (100% reproducible), with no network or interactive agent present.
- **SC-002**: 100% of frozen catalog records are visibly synthetic (all IDs `synthetic-`, all URLs `.invalid`), schema/range/identity-valid, and label-free; 0 records carry a score/rank/label field.
- **SC-003**: The demonstration tier satisfies 100% of the coverage/quota rules (all 36 cells, all secondary spreads, the ~30 JA / ~6 EN / 0 other language split, and all artist/era/explicit/negative/duration/signature/`key:-1` quotas).
- **SC-004**: All 12 required one-variable contrast pairs exhibit the declared arousal/valence **reversal** when scored by the P6 selector (0 non-reversing pairs at freeze).
- **SC-005**: With `genre_affinity_v1` disabled, the catalog reproduces the no-extension P6 ranking exactly (0 ordering differences).
- **SC-006**: The genre map is total — 100% of `{root, sub}` inputs resolve to a vocabulary term or `genre_unmappable_to_vocabulary`, with sub-overrides always beating root-fallback.
- **SC-007**: A second generation loop with a populated ledger re-proposes 0 ledgered names, re-resolves 0 ledgered `(title, artist)`, re-fetches 0 ledgered ISRCs/UUIDs, and retries 0 known misses.
- **SC-008**: A fixed raw-response cache yields a byte-identical catalog regardless of which `candidate_source` populated it.
- **SC-009**: 100% of test-case labels are committed before their P6 cross-check score is revealed (blind-first ordering verified).
- **SC-010**: Two failed repairs on any record halt the run with `catalog_generation_failed` and a readable build report (0 silent hand-edits).
- **SC-011**: A live run (step-zero probe + full 36-song demonstration harvest) completes with the real 36-song catalog frozen into the committed dataset and its quota usage recorded in the build report.
- **SC-012**: The existing trigger simulator and P0.5/P6 proposal test suites remain 100% green (no regression) and the runtime API package has 0 imports of the generator.

## Assumptions

- The operator supplies a valid Soundcharts API key at runtime for the live harvest; MusicBrainz and Deezer are auth-free public APIs usable without credentials.
- Soundcharts quota is limited, so live Soundcharts calls are minimized (probe + demonstration harvest); popularity is synthesized rather than fetched; the deterministic transform and all gates are proven on committed recorded fixtures.
- The interactive-LLM stages (naming, web-research, narrowing, profile composition, blind judging) are performed by the interactive agent in-session with its own web tools — there is no LLM API and no LLM API key anywhere.
- The `soundcharts_search` strategy's search-by-metric endpoint is unavailable on the current subscription; it is implemented and fixture-tested but not exercised live.
- The P0.5 frozen `Song` schema (`app/api/aica_api/models/proposal/song_schema.py`) and the P6 content selector package (`packages/aica_transparent_content_selector_v1/`) are present and unchanged (merged on `develop`).
- The frozen `genre_affinity_v1` vocabulary stays at its 12 terms; the sub-first genre map is a generation artifact only and changes no contract, enum, or schema.
- A packaged Claude Code orchestration skill is out of scope for this milestone; a committed runbook documents the CLI + LLM-handoff sequence, and the deterministic CLIs run standalone.
- Master-document amendments enumerated in the P2 design §8 are applied at freeze during implementation so the docs and the actual frozen manifest/validator move together.
