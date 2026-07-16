# Feature Specification: Transparent Music Content-Selector Package (P6)

**Feature Branch**: `proposal-p6-content-selector`

**Created**: 2026-07-16

**Status**: Draft

**Input**: User description: "P6 — Transparent Music Content-Selector Package (two-axis arousal/valence trait model). Build a standalone python_module package that consumes the frozen P0.5 SelectorInput contract and returns the frozen CompletePlan contract (no aggregate plan score). Authoritative math: docs/master/aica_transparent_content_proposal_algorithm.md. Approved decisions: numeric 0-100 driver/environment evidence (/100); all algorithm tables externalized as structured package.json hyperparameters; single-file package layout."

## Clarifications

### Session 2026-07-16

- Q: How does P6 confirm a service is accepted/active before scoring, given SelectorInput has no lifecycle_state field? → A: Presence = go-ahead. A present + supported `selected_service_id` is the go-ahead (P6 never re-opens the service decision); `None`/missing → `invalid_request`; a non-music service → `unsupported_recipe`. No extra lifecycle field is required.
- Q: Where do the full frozen Song records enter the selector, and may P6 read them from disk? → A: The song database is one JSON file on disk (a P6 fixture; the P2 frozen dataset later). A separate harness/loader reads it and injects the records as `feature_snapshot["catalog"]` (map keyed by Track ID); `eligible_candidates` names the Track IDs to rank. **The package `evaluate()` MUST NOT open any file** — it is pure (data in, plan out), so it stays deterministic and byte-replayable.
- Q: What form should per-item rationale/reasons take in the plan evidence? → A: Bilingual prose (Japanese default), matching the trigger package's evidence style, so the P1 screen needs no text backfill. Serialized per the frozen contract as a `list[str]` of JA-first combined lines (`"<ja> / <en>"`). The structured per-feature contribution numbers are always present regardless.

## User Scenarios & Testing *(mandatory)*

The user is an **algorithm reviewer / package author** for the AICA proposal simulator.
After a music *service* has been chosen (e.g. `humming_karaoke`), they need to see which
concrete **songs** the transparent algorithm places into it, why each was chosen, and that
the choice is deterministic, grounded, and safe. In P6 they exercise the selector directly
against hand-authored worlds and catalogs — there is no screen, journey, or service
selector yet.

### User Story 1 - Ranked, explained song plan for a music service (Priority: P1)

A reviewer supplies a frozen world snapshot, a selected music service, and a small frozen
song catalog. The selector returns one ordered plan of the configured number of songs
(default five), each shown with its selection score (`item_fit`), its four decision-time
song traits, a per-feature breakdown of how the world's demand met the song's response,
and short reasons. There is one plan — no aggregate plan score and no ranking of alternative
plans.

**Why this priority**: This is the core deliverable — a concrete, explained content plan.
Without it there is nothing to review, validate, or later wire into the screen and journey.

**Independent Test**: Feed a fixed world + service + catalog through the selector and assert
the returned plan has exactly the configured item count, ordered by score, with a complete
per-feature explanation for every item and no aggregate-plan-score field anywhere.

**Acceptance Scenarios**:

1. **Given** an accepted `music_playlist`/`humming_karaoke`/`full_karaoke` service and a
   catalog with more eligible songs than the plan count, **When** the selector runs, **Then**
   it returns a `complete_plan` of exactly the configured count, ordered by descending
   `item_fit` with ascending Track ID as the tie-break, each item carrying its four traits,
   per-feature contributions, and reasons.
2. **Given** any valid plan, **When** the output is inspected, **Then** it contains no
   `plan_score`, `aggregate_score`, or `plan_fit` field, and every ordered item cites a Track
   ID that exists in the supplied frozen catalog.
3. **Given** a service that is not one of the three detailed music services, **When** the
   selector runs, **Then** it returns a typed `unsupported_recipe`/`unsupported_service`
   outcome, never a substituted service or a disguised plan.

### User Story 2 - Context changes reverse the mood of the plan (Priority: P1)

A reviewer changes exactly one world field (e.g. drowsiness low→high, or road
highway→mountain) and re-runs. The plan re-orders so that calm-vs-energetic (and
bright-vs-dark) preference **reverses direction**, not merely rescales — demonstrating that
the two-axis trait model separates a drowsy driver (wants energetic) from a fatigued or
night driver (wants calming/bright).

**Why this priority**: The reversing arousal/valence response is the headline hypothesis of
the two-axis model and the milestone's central acceptance criterion.

**Independent Test**: For each of six single-field contrasts (drowsiness, fatigue, monotony,
traffic, road, day/night), freeze everything else and assert the calm/active ordering
reverses between the low and high worlds.

**Acceptance Scenarios**:

1. **Given** two worlds differing only in drowsiness (low vs high) over one catalog, **When**
   the selector runs on each, **Then** a high-arousal song that ranks low in the low-drowsiness
   world ranks high in the high-drowsiness world, and vice versa.
2. **Given** two worlds differing only in road type (highway vs mountain), **When** the
   selector runs on each, **Then** the arousal preference direction flips sign.
3. **Given** two worlds differing only in route characteristics with no other change, **When**
   the selector runs, **Then** the ranking does **not** change (V1 manufactures no
   route-to-song relation without the genre extension).

### User Story 3 - Hard eligibility and safety cannot be overridden by score (Priority: P1)

A reviewer confirms that unplayable, out-of-market, restricted, explicit-under-child,
recently-skipped, duplicate, or motion-ineligible songs are excluded **before** scoring and
can never be reinstated by a high score; and that full karaoke is refused while the vehicle
is moving.

**Why this priority**: Safety and grounding dominate ranking; a soft score must never
resurrect an ineligible or unsafe item. This is a non-negotiable project invariant.

**Independent Test**: Insert an ineligible song that would otherwise score highest and assert
it is absent from the plan and listed as excluded with a reason code; run full karaoke while
moving and assert a typed stopped-required refusal.

**Acceptance Scenarios**:

1. **Given** a catalog where the top-scoring song is explicit and a child is present, **When**
   the selector runs, **Then** that song is excluded with a child-policy reason and never
   appears in the plan.
2. **Given** `full_karaoke` selected while motion state is "driving", **When** the selector
   runs, **Then** it returns `full_karaoke_requires_stopped` and no plan of songs.
3. **Given** fewer eligible songs than the configured plan count, **When** the selector runs,
   **Then** it returns `insufficient_eligible_items` rather than a silently shortened plan.

### User Story 4 - Complete, provenance-marked feature contract (Priority: P2)

A reviewer verifies that the selector consumes the complete independent content feature
contract (Spec §9 / Appendix A.2), that every contract row is visibly marked used /
context-only / available-but-not-used, that CDC-SU and "Additional proposed" provenance is
preserved per row, and that history factors (skips, cancellations, acceptance/recovery)
affect their own contribution rather than an opaque preference scalar.

**Why this priority**: Contract completeness and transparent provenance are what make the
algorithm reviewable and distinguish it from an opaque recommender.

**Independent Test**: Assert every registry row appears in the plan's active or context-only
feature lists with its provenance, and that changing a single history input moves only its
own feature contribution.

**Acceptance Scenarios**:

1. **Given** the frozen disposition registry, **When** the selector runs, **Then** the plan's
   evidence lists every content feature as scored, context-only, or available-but-not-used —
   none silently dropped — with its feature-origin and (for scored rows) response-coefficient
   provenance.
2. **Given** a world with a recent skip of a specific track, **When** the selector runs,
   **Then** only that track's skip-related contribution changes (and, within the exclusion
   window, the track is excluded by eligibility), not a blended preference number.

### User Story 5 - Genre extension is opt-in and off-equivalent (Priority: P2)

A reviewer runs the same world with the `genre_affinity_v1` extension off and on. With it
off, the six genre-scored features are context-only and the ordering is identical to the
Spotify-only result. With it on, those six features contribute via the artist-genre
best-match, without affecting child safety (still enforced by eligibility).

**Why this priority**: The extension must be a clean, reversible opt-in so the Spotify-only
baseline stays exactly reproducible.

**Independent Test**: Run one world with the extension absent and again with it present but
neutral, and assert the extension-off ordering matches the pre-extension baseline exactly.

**Acceptance Scenarios**:

1. **Given** a world without `genre_affinity_v1`, **When** the selector runs, **Then** the six
   genre features are reported context-only (mask 0) and the plan ordering equals the
   Spotify-only baseline.
2. **Given** the same world with `genre_affinity_v1` enabled, **When** the selector runs,
   **Then** the six genre features carry mask 1 and contribute via best-match genre affinity,
   while explicit-content child safety is unchanged.

### User Story 6 - Deterministic, replayable plan (Priority: P2)

A reviewer runs the identical world, service, catalog, and configuration versions twice and
gets the identical plan and evidence, so a later replay can be trusted without recomputation.

**Why this priority**: Determinism is the replay boundary for the whole simulator and a
stated invariant.

**Independent Test**: Run the same frozen inputs twice and assert byte-equivalent plans and
evidence.

**Acceptance Scenarios**:

1. **Given** identical frozen inputs and versions, **When** the selector runs twice, **Then**
   the two plans and their evidence are identical (within a `1e-12` cross-runtime tolerance,
   byte-equivalent same-runtime).

### Edge Cases

- **Missing scored field** → the feature contributes zero (evidence 0, response 0), keeps its
  weight, and is listed `missing_neutral`; absence never redistributes weight.
- **Present raw 0** on a 0–100 field is a valid low value, not missing.
- **Missing audio field required by an active trait** → the song is excluded as
  `invalid_catalog`; provider values are never imputed.
- **Empty song genre set under the extension** → the genre features respond 0
  (`missing_neutral`), no redistribution.
- **Out-of-range field / identity mismatch / bad flag / unknown service / bad version /
  zero active-weight denominator** → typed rejection, never silent coercion to neutral.
- **Oshi mode off** → oshi personalization is suppressed without deleting the oshi profile.
- **Humming service** → the plan carries no lyrics-screen requirement; a hard-to-hum song is
  penalized (not merely un-bonused) on the singability feature.
- **Lighting** appears only for compatible services, is independently editable, and never
  changes score or order.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The selector MUST accept the frozen common `SelectorInput` contract and MUST
  treat `selected_service_id`, `trigger_purpose`, `lifecycle_stage`, motion state, market,
  time, versions, and item count as control inputs that constrain evaluation and are never
  scored.
- **FR-002**: The selector MUST return the frozen `CompletePlan` contract and MUST NOT emit
  any aggregate plan score or any ranking of alternative plans.
- **FR-003**: The selector MUST support exactly the three detailed music services
  `music_playlist`, `humming_karaoke`, `full_karaoke`, and MUST return a typed
  unsupported-recipe/service outcome for any other service without substitution.
- **FR-003a**: The selector MUST treat a present, supported `selected_service_id` as the
  authorization to score (it never re-opens the service decision); a `None`/missing
  `selected_service_id` MUST yield `invalid_request`, and a valid non-music service MUST yield
  `unsupported_recipe`. No separate service `lifecycle_state` input is required.
- **FR-003b**: The selector's `evaluate()` MUST be a pure function that receives the eligible
  song records already loaded in its input (as `feature_snapshot["catalog"]`, a map keyed by
  Track ID) and MUST NOT open, read, or resolve any file, catalog path, network, or external
  resource itself; `eligible_candidates` names the Track IDs to rank and each MUST resolve to
  a record in that catalog map.
- **FR-004**: The selector MUST derive four song traits — arousal, valence, humming_ease,
  full_karaoke_ease — at decision time from Spotify Audio Features, and MUST NOT read or
  persist any stored/enriched song trait.
- **FR-005**: For the six driver/environment features (drowsiness, fatigue, monotony,
  traffic, road type, day/night), the selector MUST compute the song response as
  `α·A_s + β·V_s` from the signed traits, with arousal two-sided and valence one-sided
  (β ≥ 0), and every other feature MUST set its response directly (exact-ID `+1` match,
  age-era affinity, or genre best-match).
- **FR-006**: The selector MUST reduce numeric 0–100 driver/environment magnitudes to
  evidence by dividing by 100, and MUST map categorical environment enums to the per-enum
  evidence and response defined by the authoritative algorithm.
- **FR-007**: The selector MUST compute each item's score as
  `item_fit = clamp(Σ wᵢ·eᵢ·aᵢ, −1, +1)` using effective weights obtained by
  `base × purpose_multiplier × mask` then normalization to sum 1, and MUST keep all scores
  in range by construction.
- **FR-008**: The selector MUST implement the complete independent content feature contract
  (Spec §9 / Appendix A.2): 15 features scored in Spotify-only V1, plus six genre features
  scored only when `genre_affinity_v1` is enabled, and MUST mark every contract row used,
  context-only, or available-but-not-used — none silently dropped — preserving CDC-SU and
  "Additional proposed" provenance per row.
- **FR-009**: The selector MUST apply hard eligibility before scoring — schema/identity,
  playability, market, restriction, explicit-under-child, recent-skip window, duplicate,
  humming/full-karaoke availability flags, and full-karaoke stopped-motion — and MUST NOT
  allow any score to reinstate an excluded song.
- **FR-010**: The selector MUST refuse full karaoke while the vehicle is moving with a typed
  `full_karaoke_requires_stopped` outcome, and MUST return `insufficient_eligible_items` when
  fewer eligible songs than the plan count exist, never a silently shortened plan.
- **FR-011**: The selector MUST construct the plan by sorting eligible songs by
  `(item_fit desc, Track ID asc)` and taking the first `plan_item_count` (default 5), with no
  hidden diversity reranker, artist cap, shuffle, or reorder.
- **FR-012**: The selector MUST produce mode-specific plan fields — playlist; humming
  (chorus-only, guide vocal, no driving lyrics, fixed segment); full karaoke (stopped-only,
  simulated queue) — and MUST compute expected duration per mode (summed track durations for
  playlist/full karaoke; count × fixed segment for humming, labeled simulated).
- **FR-013**: The selector MUST attach an optional lighting configuration only for
  lighting-compatible services, independently editable, that never affects score or order.
- **FR-014**: When `genre_affinity_v1` is enabled, the selector MUST score the six genre
  features via the artist-genre best-match over the controlled vocabulary; when it is
  disabled, those six features MUST be context-only (mask 0) and the ordering MUST be
  identical to the Spotify-only baseline.
- **FR-015**: The selector MUST hold every algorithm table (trait composition matrix, context
  response matrix, hierarchy weights, purpose multipliers, genre maps, age/era affinity,
  normalization bounds, history/operation curves, lighting lookup) as editable, versioned
  configuration that is echoed verbatim into the plan's evidence; editing any table MUST bump
  the parameter-set version.
- **FR-016**: The selector MUST record per selected song: position, Track ID, title, artists,
  `item_fit`, the four trait values and signed forms, and one row per scored feature with its
  evidence, response coefficient (with α/β or exact-match provenance), feature response, base
  weight, purpose multiplier, mask, effective weight, contribution, and formula version; and
  per excluded song: Track ID plus reason codes. Per-item human-readable reasons/rationale
  MUST be bilingual (Japanese default), serialized per the frozen contract as a `list[str]`
  of JA-first combined lines (`"<ja> / <en>"`), consistent with the existing package evidence
  style; the structured per-feature numbers above are always present regardless of language.
- **FR-017**: The selector MUST record per plan: selected service and lifecycle, purpose and
  stage, plan count, catalog/world/algorithm/schema/parameter versions, active vs context-only
  feature lists, matrix versions, normalized effective weights, sort/tie-break rule, expected
  duration and basis, and the ordered Track IDs.
- **FR-018**: The selector MUST return one of the frozen typed decision/error categories for
  every outcome (`complete_plan`, `no_proposal`, `insufficient_eligible_items`,
  `unsupported_service`/`unsupported_recipe`, `invalid_request`, `invalid_catalog`,
  `invalid_configuration`, `full_karaoke_requires_stopped`) and MUST NOT convert a failure into
  a normal plan or an undeclared fallback.
- **FR-019**: The selector MUST be deterministic: identical frozen inputs and versions MUST
  reproduce a semantically identical plan and evidence (`1e-12` tolerance; byte-equivalent
  same-runtime), with no clock or randomness.
- **FR-020**: The selector MUST remain isolated from the trigger simulator — it MUST NOT
  import trigger/backend runtime modules, MUST NOT change trigger code, tests, or the trigger
  package, and MUST leave the existing simulator operational.
- **FR-021**: Missing, unknown, and invalid data MUST be handled per the authoritative rules:
  missing scored field → neutral with weight retained; present raw 0 → valid; missing
  trait-required audio field → excluded as invalid catalog; invalid values → typed rejection,
  never silent coercion.

### Key Entities *(include if feature involves data)*

- **Selector input**: the frozen common contract carrying control inputs, the complete
  content feature snapshot (numeric driver/environment magnitudes, categorical environment
  enums, exact-ID history maps, oshi fields), candidate/excluded lists, the optional
  `genre_affinity_v1` namespace, configuration/versions, and the selected music service.
- **Song**: a frozen Spotify-compatible record (Track + Audio Features + simulation flags)
  from which the four traits are derived at decision time; identified by a synthetic Track ID.
- **Song catalog**: the one JSON song database on disk (a hand-authored P6 fixture; the P2
  frozen dataset later). A harness/loader reads it and injects it into the selector input as
  a Track-ID-keyed map; the package itself never reads the file.
- **Eligible candidates**: the list of Track IDs the orchestrator asks the algorithm to rank
  (already past platform pre-filtering); its sibling excluded-candidates list carries items
  the platform dropped with a platform reason. Distinct from the algorithm's own §7 hard
  eligibility, which may further exclude candidates into the plan's excluded-items list.
- **Song traits**: arousal, valence, humming_ease, full_karaoke_ease (each in [0,1]) plus
  their signed forms; computed, never stored.
- **Complete plan**: the ordered output — decision type, selected service and mode, requested
  and returned item counts, ordered items with per-item explanation, excluded items with
  reasons, context-only/missing feature lists, lighting, and algorithm provenance. No
  aggregate plan score.
- **Feature-disposition registry**: the frozen per-row disposition and provenance list that
  drives which features are scored, context-only, or available-but-not-used.
- **Algorithm configuration**: the versioned set of tables (matrices, weights, multipliers,
  maps, curves, bounds) plus scalar knobs (item count, humming segment, directional
  hypothesis, category weights), editable and evidence-visible.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For every supported music service and a catalog with enough eligible songs, the
  selector returns a plan of exactly the configured item count, fully ordered and explained,
  with no aggregate plan score — verified on 100% of contract fixtures.
- **SC-002**: Across all six single-field driver/environment contrasts, the calm/active
  ordering **reverses** direction (not merely rescales) in 6 of 6 cases; a route-only change
  produces zero rank change.
- **SC-003**: 100% of ordered plan items cite a Track ID present in the supplied frozen
  catalog; no plan ever references a nonexistent or ineligible item.
- **SC-004**: No score ever reinstates an ineligible or unsafe song, and full karaoke never
  runs while moving — verified across the full eligibility and motion test matrix.
- **SC-005**: With `genre_affinity_v1` disabled, the plan ordering is byte-identical to the
  Spotify-only baseline for every genre-extension fixture (100% equivalence).
- **SC-006**: Identical frozen inputs and versions reproduce identical plans and evidence in
  100% of determinism runs (`1e-12` tolerance).
- **SC-007**: Every content-contract row appears in the plan's evidence marked scored,
  context-only, or available-but-not-used with its provenance — 0 rows silently dropped.
- **SC-008**: The published worked example reproduces its documented block score (+0.187)
  within `1e-12`, and an all-neutral world produces a zero mood block.
- **SC-009**: The existing trigger simulator's relevant tests continue to pass unchanged
  (regression gate), and no trigger code or package is modified.

## Assumptions

- The frozen P0.5 contracts (common `SelectorInput`, `CompletePlan`, song schema, genre
  extension shape, feature-disposition registry) and their exported schemas are the
  authoritative interface and are not modified by this feature.
- The authoritative scoring math, weights, matrices, gating, and explainability are those in
  `docs/master/aica_transparent_content_proposal_algorithm.md` (as reconciled by the P6
  design), which supersede any placeholder scoring elsewhere.
- Driver/environment magnitudes are supplied as numeric 0–100 (per data-spec §13); the
  ordinal P0.5 world fixtures were structural-only and are not the scoring input form.
- The eligible song catalog and world snapshot are supplied to the selector as frozen data;
  there is no live provider, network, or LLM call during a run.
- Golden rankings against the real 36-song demonstration catalog are out of scope until the
  P2 dataset exists; P6 is validated on hand-authored, trait-separated fixtures.
- There is no proposal screen, journey engine, service selector, or orchestrator wiring in
  P6; the selector is exercised directly and remains composable with those later milestones.
- The default directional hypothesis for the marked (⚠) fatigue/traffic/night rows is
  soothe/de-stress (a versioned hyperparameter), per the authoritative algorithm.
- The age/era affinity default table (bands, era buckets, values) is the one frozen in the P6
  design and added to the algorithm doc §5.5.
- Japanese and English presentation strings, where surfaced in reasons, follow the project's
  bilingual default; P6 introduces no UI.
