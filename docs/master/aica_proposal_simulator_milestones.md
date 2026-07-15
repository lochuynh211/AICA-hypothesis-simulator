# AICA Service And Content Proposal Simulator — Milestone Design Draft v2

**Document status:** Implementation milestone design
**Source specification:** `docs/master/aica_proposal_simulator_specification.md`
**Normative algorithm contracts:**
- `docs/master/aica_transparent_service_proposal_algorithm.md`
- `docs/master/aica_transparent_content_proposal_algorithm.md`

**Shared synthetic data and generation:** `docs/master/aica_synthetic_music_data_and_generation_specification.md`
**UI/UX reference (first-screen imagination):** `docs/master/aica_proposal_overview_en_ja.html`
**Constrained-LLM design source:** `others/aica_stage_constrained_llm_proposal_selector_spec.md`
**Design decision record (rationale, history, non-features):** `docs/master/aica_proposal_design_reference_draft.md`
**Schedule style:** Capability milestones; no calendar estimates
**Delivery strategy:** Contract-first, generate-then-consume dataset, transparent music vertical slice first, LLM comparison second, all-service breadth last

> **Document map.** The consolidated **specification** owns the product boundary, contracts, and acceptance criteria. The two **algorithm docs** are the authoritative transparent-scoring math, weights, gating, and explainability (they supersede the placeholder scoring in the design decision record). The **synthetic data and generation spec** owns the Spotify-compatible music dataset, its staged generator, validation, tiers, base worlds, and contrasts. The **overview HTML** is the approved first-screen UI/UX. The **design decision record** remains authoritative only for product/architecture rationale, the constrained-LLM package family, the full/raw feature inventory, and non-feature exclusions — it is not the implementation contract.

---

## 1. Milestone Strategy

The proposal phase is implemented inside the current application without coupling it to the current trigger run state.

Each milestone must leave a reviewable capability and preserve these boundaries:

```text
simulation world
≠ synthetic music dataset (frozen, versioned)
≠ algorithm packages
≠ journey/playback engine
≠ reviewer evidence
```

The proposed sequence is:

```text
P0    — Scope and feature-contract freeze
P0.5  — Content contract and song-schema freeze (pulled from P1)
P1    — Proposal screen (4-panel) and standalone run foundation
P2    — Synthetic music dataset generation and validation
P3    — Editable synthetic world, catalog, and contrast clones
P4    — Eligibility and discrete journey engine
P5    — Transparent service-selector package
P6    — Transparent music content-selector package (two-axis trait model)
P7    — End-to-end pre-rest/rest/post-rest vertical slice
P8    — Constrained LLM service-selector package
P9    — Constrained LLM content-selector package
P10   — Comparison, evidence, and customer review completeness
P11   — All-service breadth and stabilization
Post-V1 — Trigger-tick composition and real-data research
```

The P-numbers above are stable **capability identifiers**, not a strict build sequence. The V1 build follows a **validation-first execution order**, so the content package and the contract it needs are produced before dataset generation:

```text
Execution order (validation-first):

P0 → P0.5 → P6 (built as an independent package, fixture-tested)
   → P2 (generate dataset; the P6 package validates contrast directions)
   → P1 → P3 → P4 → P5 (wire the package into screen, world, journey, service path)
   → P7 → P8 → P9 → P10 → P11 → Post-V1
```

P0 is represented by the current specification set. Implementation starts at P0.5 only after review approval.

**Why P2 (generation) precedes P3 (editable world).** The transparent content selector scores concrete songs from Spotify-compatible `spotify_track` + `spotify_audio_features` records. Those records are produced by a staged, seed-pinned, LLM-assisted generator and then **frozen** as a validated, versioned dataset. The editable world, the catalogs the customer edits, and every contrast seed all reference that frozen dataset by ID. Generation is therefore its own reviewable capability that must exist and pass validation before any milestone consumes it. No transparent simulation run ever calls a live model; the frozen dataset is the replay boundary.

**Why the content package and its contract now precede dataset generation.** The transparent content selector is a self-contained `python_module` package whose whole boundary is `evaluate(input) → complete_plan` (the repo's existing single dispatch path). Its logic depends only on a frozen input/output contract and the song schema — not on the screen (P1), editable world (P3), journey engine (P4), or service selector (P5), which are producers and consumers of its I/O. Building it first (P0.5 freeze → P6 package, unit-tested on hand-authored, **algorithm-blind** fixtures) yields an executable scorer that P2 then uses as its deterministic contrast-direction validator. **Firewall:** the generator stays conditioned only on coverage cells (energy/tempo/profile + the §10.2 valence/mode/acousticness spread); the package validates the frozen catalog *after* generation and never feeds a score, rank, or target back into generation input. Recommendation independence (data spec §11/§17.6) is preserved — the scorer proves the *algorithm's* response matrix on trait-separated fixtures, generation proves *coverage*, and neither depends on the other. Golden replay against the real 36-song catalog is the single part of P6 that closes only once P2's frozen dataset exists.

---

## 2. P0 — Scope And Feature-Contract Freeze

### Goal

Turn the design discussion into an agreed implementation baseline.

### Deliverables

- Approve the consolidated specification.
- Approve service and content feature inventories.
- Confirm two independent feature contracts: one complete service-proposal table (Spec §8 / Appendix A.1) and one complete concrete-content table (Spec §9 / Appendix A.2), with the same category order and visible provenance.
- Approve the feature/non-feature/constraint boundaries and the prohibited-field list (`child_state`, unexplained `service_preferences`, `current_candidate_page`).
- Approve the four-value `trigger_purpose` contract, the four-value `lifecycle_stage` contract, and the Slides 64–65 purpose/stage service matrix.
- Approve the four independent package families (transparent service, transparent content, constrained-LLM service, constrained-LLM content).
- Approve the transparent scoring model: service `service_fit = clamp(Σ wᵢ·rᵢ, −1, +1)` and content `item_fit = clamp(Σ wᵢ·eᵢ·aᵢ, −1, +1)` with the two-axis (arousal/valence) song-trait model.
- Approve the Spotify-compatible synthetic dataset model and its staged generator.
- Approve the 4-panel standalone screen (① Input · ② Setup · ③ Service proposal · ④ Content proposal) as the V1 UI shape.
- Record source-slide discrepancies for service applicability (see §17 open reconciliations).
- Agree on naming and versioning rules.

### Acceptance criteria

- Product, algorithm, UX, and simulator reviewers can identify every V1 input and its owner.
- No unexplained composite field such as `service_preferences` or `upro_information` remains.
- `trigger_purpose` and `lifecycle_stage` are documented as required control inputs, not ranking features.
- The documents explicitly prohibit package score/ranking sharing.
- Open numerical values (default weights, multipliers, response curves) are identified as tunable expert hypotheses, not missing hidden requirements.

### Output (approved artifact set)

- `aica_proposal_simulator_specification.md`
- `aica_transparent_service_proposal_algorithm.md`
- `aica_transparent_content_proposal_algorithm.md`
- `aica_synthetic_music_data_and_generation_specification.md`
- `aica_proposal_design_reference_draft.md`
- `aica_proposal_simulator_milestones.md`
- `aica_proposal_overview_en_ja.html`

---

## 2.5 P0.5 — Content Contract And Song-Schema Freeze

### Goal

Freeze the exact contracts the content-selector package validates against, so it can be built and tested independently (P6) and then used to validate dataset generation (P2). This milestone pulls the contract-definition work forward from P1.

### Scope

- Pin the **common selector input contract** (`feature_snapshot`, `feature_provenance`, `enabled_feature_extensions`, `eligible_candidates`, `excluded_candidates`, `parameters`, `hyperparameters`, `package_runtime_state`, `catalog_version`) and `selected_service_id` as versioned Pydantic models.
- Pin the **content-selector output contract** (`complete_plan`: `ordered_items` with per-item `item_fit`, trait values, per-feature contributions, and reasons; `mode`, `expected_duration_sec`, `lighting_configuration`, `approval_policy`, `completion_rule`, `next_transition_policy` — **no aggregate plan score**).
- Pin the **song schema** (`spotify_track`, `spotify_audio_features`, `simulation_flags`) from data spec §4–6, plus the optional `genre_affinity_v1` extension shape (§21.1).
- Declare the **eligibility split**: content hard-eligibility (playability, market, restriction, explicit/child, recent-skip, duplicate, karaoke gates) is owned by the package; platform/motion eligibility is P4's.
- Resolve the §17 items that touch the content contract **before freezing**: control-input naming, `Additional proposed` content-row dispositions, and schedule-field ownership.
- Version the contract (`schema_version`) and record it in the setup snapshot.

### Acceptance criteria

- The content package can be authored and validated against the frozen contract with no other milestone present.
- The song schema validates a hand-authored smoke fixture and rejects malformed records.
- Every Appendix A.2 row has a declared disposition (`scored` / `context_only` / `available_but_not_used`).
- Control-input naming is normalized to `trigger_purpose` / `lifecycle_stage` across all documents.

### Output

Versioned contract + schema modules and a hand-authored fixtures directory (smoke songs; calm/active, bright/dark, and acoustic/electric pairs; world/feature snapshots) — all **algorithm-blind**.

### Verification focus

- Contract and song-schema validation tests (valid fixture accepted, malformed rejected).
- Appendix A.2 disposition-completeness check.
- Control-input naming consistency check across docs.

---

## 3. P1 — Proposal Screen (4-Panel) And Standalone Run Foundation

### Goal

Create a separate proposal-simulation workflow and its standalone 4-panel screen inside the current application and backend, with neutral contracts and mock adapters, before any real data or ranking exists.

### Scope

- Add a Proposal Simulator navigation entry and the standalone **4-panel screen** described in the overview:
  - **① Input (入力・世界)** — synthetic-world summary/edit surface;
  - **② Setup (設定・パラメータ)** — purpose/stage, package + mode, category weights, multipliers, safety dominance readout;
  - **③ Service proposal (サービス提案)** — eligible-after-exclusion chips, `service_fit` ranking, rank-1 contributions, selected-service hand-off;
  - **④ Content proposal (コンテンツ提案)** — recipe/plan, ordered playlist with per-item fit and reasons, excluded examples, actions/evidence.
- Render the two-step decision pipeline explicitly: **STEP 1 service → STEP 2 concrete content → show/choose/recompute**.
- Add an independent proposal setup store/context, separate from the trigger setup.
- Add a proposal run type and persistence namespace.
- Define versioned neutral contracts (Spec §5.3–§5.4):
  - proposal opportunity (`opportunity_id`, `trigger_purpose`, `lifecycle_stage`, `allowed_service_ids`, `simulation_time`, `run_seed`);
  - `trigger_purpose` and `lifecycle_stage` enums;
  - purpose/stage allowed-service matrix (versioned, frozen per run);
  - common selector input schema (`feature_snapshot`, `feature_provenance`, `enabled_feature_extensions`, `eligible_candidates`, `excluded_candidates`, `parameters`, `hyperparameters`, `package_runtime_state`, `catalog_version`);
  - service-selector output (`ranked_candidates` up to 3, `no_proposal`, error categories);
  - content-selector output (`complete_plan` with `ordered_items`, `mode`, `expected_duration_sec`, `lighting_configuration`, `approval_policy`, `completion_rule`, `next_transition_policy`, error categories — **no aggregate plan score**);
  - discrete event; journey state; algorithm evidence.
- Add package-family registration and compatibility validation for four package slots.
- Add placeholder/mock selector adapters returning fixed valid candidates and a fixed valid plan.
- Add setup/run/review route skeletons.
- Establish JA-default bilingual (JA/EN) presentation and per-field provenance labeling (`cdc_su_baseline` / `normalized_cdc_su_concept` / `proposed_addition`) as UI conventions.
- Keep trigger simulation behavior unchanged.

### Acceptance criteria

- The customer can open the 4-panel proposal screen without creating a trigger run.
- Editing proposal setup does not modify the trigger setup.
- A standalone proposal run can be created, persisted, reopened, and deleted per existing application policy.
- The backend can validate a mock service package and mock content package independently against the four package slots.
- A mock proposal opportunity flows through both selector boundaries and both display panels.
- The opportunity carries one valid trigger purpose, a compatible lifecycle stage, and resolved allowed-service IDs.
- Contracts contain no UI-specific state and no dependency on trigger tick objects.
- Every panel and label exists in both Japanese (default) and English.

### Verification focus

- Contract schema tests.
- Package-slot compatibility tests.
- Persistence round-trip tests.
- 4-panel render + language-toggle tests.
- Regression tests for current trigger screens/runs.

---

## 4. P2 — Synthetic Music Dataset Generation And Validation

### Goal

Produce the shared, Spotify-compatible synthetic music dataset — a **staged, seed-pinned generator plus a deterministic validator/repair loop that freezes a versioned dataset artifact** — so every later milestone consumes real, grounded, reproducible catalog data. This is the "generate synthetic data" capability; it is offline tooling, not a runtime feature.

### Scope

**Validator and firewall.** Contrast-direction validation is performed by the P6 content package built in the prior step; generation input itself stays **score-free** — no score, rank, or target enters the generator (see the firewall in §1). The package is only a post-generation validator.

- Implement the **offline generator tool** (a repository-defined command producing committed, versioned JSON) with the three staged passes from the data spec:
  - **PASS 1 — Fictional Track objects:** allocate stable synthetic Artist/Album/Track IDs (all prefixed `synthetic-`), fictional names/releases, consistent artist references, exact `spotify_track` field names/types, `.invalid` URLs, `is_playable: true` / `is_local: false` for standard records. Free-form prose rejected.
  - **PASS 2 — Audio Features objects:** one `spotify_audio_features` per Track, conditioned on an assigned audio-profile coverage cell (not a target rank), copying Track `id`/`uri`/`duration_ms` exactly.
  - **PASS 3 — Worlds and histories:** generated only after the catalog is frozen; reference existing Track/Artist IDs and never mutate catalog metadata; include driver/environment/passenger/oshi state, playback/operation histories, acceptance/recovery evidence, and service lifecycle state; unsupported semantic inputs are marked `context_only`.
- Implement the **`dataset_manifest` envelope**: `dataset_id`, `dataset_kind`, `schema_version`, `spotify_track_reference_version`, `spotify_audio_features_reference_version`, `generator_version`, `prompt_template_version`, `validation_rules_version`, `random_seed`, `generated_at`, `synthetic_only`, plus `dataset_hash` and build-report provenance (`generator_pass`, `validator_version`, `reviewed`).
- Implement the **deterministic validator** covering the data spec's rule families: schema/types; cross-object identity (Track↔Audio Features id/uri/duration; consistent artist refs); synthetic-identity and `.invalid` URL rules (no `api.spotify.com`/`open.spotify.com`, no real ISRC lookup); Spotify numeric ranges; simulation flags/policy; coverage/balance/recommendation-independence; and `genre_affinity_v1` extension validation when present.
- Implement the **deterministic repair loop**: on validation failure, feed only the invalid record + machine-readable errors + original schema/cell back to the generator; repair may change only invalid fields and their direct dependents; **stop with `catalog_generation_failed` after two failed repairs**; record every repair in the build report (no silent manual edits).
- Produce the **three dataset tiers**: `smoke` (5 valid songs + negative fixtures), `demonstration` (36 balanced songs + approved worlds), `stress` (configurable size, same distributions).
- Meet the **demonstration-catalog contract**: 36 songs across a 3 energy × 3 tempo × 4 audio-profile coverage cross; 12 fictional artists × 3 tracks each; ≥12 albums; ≥3 eras; ≥6 `explicit: true`; ≥4 negative fixtures (`is_playable: false`/restricted) outside the standard 36; duration/time-signature spread; ≥1 `key: -1` fixture.
- Generate the **≥15 base worlds** and the **12 one-variable contrast pairs** with their stated expected directions, plus the versioned **audio-feature fixture A/B comparisons** used to isolate arousal/valence/ease-proxy formula effects.
- Implement the opt-in **`genre_affinity_v1` extension** (`artist_genres` over a 12-genre controlled vocabulary; song genre = union over artist IDs; no overwrite of `spotify_track`/`spotify_audio_features`/`simulation_flags`), including its validation and its off/on contrast pair.
- Emit typed generation error codes (`cross_object_identity_mismatch`, `world_reference_failed`, `synthetic_identity_violation`, `invalid_genre_extension`, `coverage_contract_failed`, `catalog_generation_failed`, …).

### Acceptance criteria

- The generator, given the same `random_seed` and the same generator/prompt/validation/schema versions, produces **byte-identical frozen output**; the committed dataset — not a model rerun — is the replay boundary.
- Every synthetic record is visibly synthetic (IDs prefixed `synthetic-`, links on `.invalid`), schema-valid, range-valid, identity-consistent, coverage-complete, versioned, and hash-stamped before it can be used by any run.
- No recommendation score, target rank, or `best_for_world` field appears anywhere in generator input or output; generation completes before any world is scored; the P6 package validates contrast directions only after the dataset is frozen.
- The demonstration tier satisfies every coverage/quota rule; the deliberate contrastive song pairs exist and expose the arousal/valence trade-offs.
- Two failed repairs on any record halt generation with `catalog_generation_failed` and a readable build report.
- With `genre_affinity_v1` absent, the six genre-scored features are `context_only` and reproduce the no-extension result exactly.
- No live LLM/network call occurs during a deterministic transparent simulation run.

### Verification focus

- Track-schema, Audio-Features-schema, and simulation-flag tests.
- Generation determinism test (same seed/versions → byte-identical output).
- Validator/repair unit tests including the two-failed-repair hard stop.
- Coverage-cell, artist/era/explicit/negative-fixture quota tests.
- Base-world and one-variable-contrast direction tests **via the P6 package**; audio-feature fixture A/B tests.
- `genre_affinity_v1` on/off equivalence and validation tests.

---

## 5. P3 — Editable Synthetic World, Catalog, And Contrast Clones

### Goal

Give customers a complete, editable world that can drive every approved feature, backed by the frozen P2 dataset, with no external data.

### Scope

- Load the frozen P2 dataset (by `dataset_id`/version/hash) as the in-app catalog; show catalog provenance and version.
- Implement editable control inputs outside the feature groups: `trigger_purpose`, starting `lifecycle_stage`, and the service-constraint matrix version.
- Implement editable feature groups (Panel ① surface):
  - driver state; driving environment; passengers; route/destination features;
  - current proposal session (active service, recent rejections);
  - personal service-use preference; service proposal performance and confidence;
  - schedule; UPro setup; detailed oshi setup;
  - content-use preference and recency; playback/user-operation history; content proposal performance and confidence.
- Implement in-app catalog editing (`spotify_track` / `spotify_audio_features` / `simulation_flags`) through schema-aware controls; **saving re-validates and produces a new dataset version and hash** (edits never re-run the generator).
- Implement world/history editing (`direct_item_history`, exact `oshi_id`, service lifecycle state) referencing catalog IDs.
- Implement the opt-in `genre_affinity_v1` world fields (`usage_by_genre`, `scene_genre_usage`) as an extension toggle.
- Implement parameters/hyperparameters as separate setup panels (Panel ②), distinct from features.
- Load the P2 base seeds; add clone-and-change contrast clones with a field-level diff.
- Validate enums, ranges, IDs, references, and histories on edit and on load.
- Record seed, catalog, algorithm, and parameter-set versions in the setup snapshot, with per-field provenance labels (`cdc_su_baseline` / `normalized_cdc_su_concept` / `proposed_addition`).

### Representative complete base seeds (from the data spec's 15)

1. **Night highway, rest nearby, oshi on** — safety, humming on the way, nap, post-rest full karaoke.
2. **Ordinary daytime route, low risk** — non-safety preference and novelty without a strong rest context.
3. **Characteristic route and event destination** — route/destination relevance (and the Spotify-only limitation vs. `genre_affinity_v1` on).
4. **Multiple passengers with child present** — passenger-friendly ordering without child-state inference.
5. **Upcoming synthetic live/oshi event** — schedule effects.

Each seed initializes all fields, even those irrelevant to the seed's title.

### Required contrast clones (subset of the 12 one-variable pairs)

- `motion_state=driving` vs `stopped`.
- High vs low drowsiness; high vs low fatigue.
- 8 vs 45 minutes to rest spot.
- `oshi_mode` on vs off.
- Upcoming event vs none.
- Recent skip/rejection vs none.
- Same observed acceptance rate: high vs low confidence.
- `genre_affinity_v1` off vs on (route/destination effect).

### Acceptance criteria

- Every approved feature is editable from the proposal setup; non-features are displayed separately.
- The in-app catalog is the frozen P2 dataset; no customer catalog import exists.
- Invalid catalog/history references are rejected with useful messages; saving an edit produces a new validated dataset version + hash.
- A cloned setup shows exactly which fields differ.
- Reloading the same seed restores the same complete world.

### Verification focus

- Seed snapshot/golden tests against the frozen dataset.
- Catalog referential-integrity and edit-revalidation/versioning tests.
- Editor validation tests.
- Clone/diff determinism tests.

---

## 6. P4 — Eligibility And Discrete Journey Engine

### Goal

Implement deterministic motion/service constraints and lifecycle transitions before adding real ranking logic.

### Scope

- Implement the default Slides 64–65 purpose/stage allowed-service matrix (see Appendix A.0 and §17 open reconciliations).
- Resolve `allowed_service_ids` before motion/readiness eligibility:
  `catalog services ∩ purpose/stage allowed services ∩ motion/capability/readiness availability`.
- Implement the platform hard-eligibility validator (non-reversible), including: screen-dependence, `simulation_flags.humming_karaoke_available` / `full_karaoke_available`, stopped-motion requirement for full karaoke, playability/market/restriction, explicit-vs-child, recent-skip window, and duplicate rules.
- Encode driving/stopped and screen-dependence rules; synthetic availability/readiness; schedule availability; lighting compatibility (presentation modifier, not a ranked service).
- Implement journey runtime states and discrete events; current/previous content tracking.
- Implement accept, reject, postpone, request-more, choose-another, stop, and continue actions.
- Implement completion and return-to-previous-content policy; movement transition behavior for stopped content.
- Implement non-binding journey preview separate from committed action (rolling-horizon preview-then-commit).

### Acceptance criteria

- Full-screen karaoke and stopped video cannot be activated as driving experiences.
- Lighting can attach only to compatible services and is never a ranked candidate.
- Eligibility explanations are produced without assigning utility scores.
- A mocked accepted plan can advance through start, completion, continuation, and restoration.
- A motion change applies background/stop behavior deterministically.
- Trigger purpose and journey stage are passed as required control inputs and are never converted into preference/utility feature scores.
- A package cannot return a service outside the frozen purpose/stage row.
- User rejection does not dead-end the run when another eligible candidate exists.

### Verification focus

- State-transition table tests.
- Eligibility matrix tests.
- Motion-change tests.
- Completion/restoration tests.
- Advisory user-action tests.

---

## 7. P5 — Transparent Service-Selector Package

### Goal

Rank all eligible service candidates using the fully inspectable expert scorecard defined in `aica_transparent_service_proposal_algorithm.md`.

### Scope

- Create the first transparent service-selector package implementing the documented **symbol chain**:
  `xᵢ (raw) → eᵢ (normalized_evidence) → aᵢ (response_coefficient ∈ [−1,+1]) → rᵢ = clamp(eᵢ·aᵢ, −1,+1) → wᵢ (hierarchical effective weight) → kᵢ = wᵢ·rᵢ → service_fit = clamp(Σ kᵢ, −1,+1)`.
- Validate `trigger_purpose`, `lifecycle_stage`, and the frozen allowed-service set before scoring.
- Implement documented feature normalization for the **17 CDC-SU baseline service features** (Situation 10, Preference 5, History 2) plus the direct candidate-specific features (motion/rest-route/session/confidence/schedule additions).
- Implement hierarchical weights: `base_weight = category × subgroup × leaf`, `raw_weight = base × purpose_multiplier[purpose][subgroup]`, normalized to `Σw = 1`; default category weights **Situation .80 / Preference .12 / History .08**.
- Implement the **continuous dominance invariant**: `D = driver state + environment + recovery`; require `W_D · material_safety_gap(1.00) > 2·W_L` for every built-in profile; record `default_dominance_preserved` / `dominance_not_guaranteed`.
- Implement service-use preference factors; separate acceptance/recovery performance factors; confidence shrinkage; recent-rejection and weak-novelty policies.
- Implement schedule relevance and `Additional proposed` provenance distinct from CDC-SU rows.
- Return up to three ranked services (order by `service_fit` desc, `candidate_id` asc tiebreak).
- Add editable package parameters/hyperparameters and factor-level evidence.

### Required explainability (per candidate × feature)

`feature_id`, `source_reference`, `raw_value`, `normalization_function`, `normalized_evidence` (eᵢ), response class/coefficient (aᵢ) + `response_provenance`, `normalized_feature_response` (rᵢ), `hierarchy_path`, `base_weight`, `purpose_multiplier`, `effective_weight` (wᵢ), `feature_contribution` (kᵢ), `status`. Per candidate: `service_fit`, Situation/Preference/History subtotals, strongest support/oppose, missing/unknown, provenance, config versions; `uncertainty = null`, `next_package_runtime_state = {}` (deterministic).

### Acceptance criteria

- The package receives the explicit trigger purpose and lifecycle stage and returns candidates only from `allowed_service_ids`.
- The package consumes its independent Spec §8 / Appendix A.1 table and distinguishes CDC-SU rows from enabled `Additional proposed` rows by provenance; every available feature is marked used or `available_but_not_used`.
- Accumulated lower-priority factors cannot overturn the material safety/dominance separation (the dominance invariant holds and is inspectable, e.g. the ~79% dominance readout).
- Acceptance and recovery are separate from service-use preference.
- Low-confidence rates have less effect than identical high-confidence rates.
- Identical snapshots produce identical results.
- The customer can modify weights/multipliers/response curves and see the changed explanation.

### Verification focus

- Per-factor unit tests; response-matrix tests.
- Dominance-invariant property tests.
- Confidence-shrinkage tests.
- Contrast-seed golden rankings.
- Deterministic replay tests.

---

## 8. P6 — Transparent Music Content-Selector Package (Two-Axis Trait Model)

### Goal

Generate and rank the ordered concrete plan for `music_playlist`, `humming_karaoke`, and `full_karaoke` using the two-axis (arousal/valence) song-trait model in `aica_transparent_content_proposal_algorithm.md`.

### Scope

**Independence and build order.** P6 is implemented as a standalone `python_module` package (`evaluate(input) → complete_plan`) against the frozen P0.5 contract and hand-authored, algorithm-blind fixtures — before P2 and without P1/P3/P4/P5. Content hard-eligibility is owned here; platform/motion eligibility is P4's. Only the contrast-seed **golden** rankings against the real frozen catalog defer until P2 exists; at that point the same package becomes P2's contrast-direction validator (§4).

- Create versioned service recipes and applicability handling; validate that the selected service is permitted for the explicit purpose and lifecycle stage; consume `selected_service_id` as a control fact only (never a service score/rank/rationale).
- Derive the four **song traits at decision time** from `spotify_audio_features` — **arousal**, **valence**, plus **humming_ease** and **full_karaoke_ease** — and never persist them as song metadata.
- Score each song with the shared chain, where the six driver/environment features use `aᵢ(song) = αᵢ·A_s + βᵢ·V_s` (row-normalized `|α|+|β| ≤ 1`) and all other features set `aᵢ` directly (`+1` on exact-ID match; genre best-match under `genre_affinity_v1`); `item_fit = clamp(Σ wᵢ·eᵢ·aᵢ, −1, +1)`.
- Apply default content category weights **Situation .55 / Preference .30 / History .15**.
- Implement the §9 / Appendix A.2 content contract: **15 features scored in Spotify-only V1**, with the six `genre‡` features scored **only when `genre_affinity_v1` is enabled** (otherwise `context_only`/masked). Mark every contract row used, `context_only`, or `available_but_not_used`.
- Implement hard eligibility: playability, market, restrictions, explicit/child, recent-skip window, duplicate, and karaoke gates (`*_available`, stopped-motion for full karaoke).
- Implement plan construction: the **default plan is five ordered songs**; playlist item ordering; repetition/skip/rejection policies; plan duration/journey feasibility.
- Implement humming mode fields (chorus-only, guide vocal, no driving lyrics — no claimed chorus/karaoke asset); full-karaoke stopped-only fields and simulated queue; compatible lighting plan fields.
- Return one ordered `complete_plan` (**no aggregate plan score, no plan-candidate ranking**) with per-item `item_fit`, trait values, per-feature contributions, and reasons.

### Acceptance criteria

- The package receives the complete independent Spec §9 / Appendix A.2 contract and does not depend on the Section 8 contract; CDC-SU and `Additional proposed` provenance remain visible per row.
- Traits are computed at decision time from Audio Features; no AICA/LLM-enriched song traits participate in Spotify-only V1 scoring.
- The declared arousal/valence responses **reverse** (not merely rescale) across the low/high drowsiness, low/high fatigue, normal/congested, highway/mountain, day/night, and low/high monotony contrasts.
- No plan references a nonexistent/disabled catalog item; every ordered item cites Track IDs from the frozen dataset.
- CDC-SU skips/cancellations and any enabled granular-history extensions visibly affect their own factors, not an opaque preference scalar.
- Oshi mode off prevents oshi personalization without deleting the synthetic oshi profile.
- Humming driving plans contain no lyrics-screen requirement; full-karaoke active plans require stopped motion.
- Lighting is present only for compatible services and is independently editable.
- With `genre_affinity_v1` off, the six genre features are `context_only` and the ordering matches the no-extension result.
- Identical snapshots produce identical plans and evidence.

### Verification focus

- Trait-derivation and Trait/Context matrix tests; audio-feature fixture A/B tests (fixture-based first; golden replay against the frozen 36-song catalog runs once P2 exists).
- Recipe applicability tests; catalog grounding tests.
- Playlist composition/order tests; motion/mode tests.
- Oshi, schedule, history, and confidence contrast tests.
- `genre_affinity_v1` on/off equivalence tests.

---

## 9. P7 — End-To-End Pre-Rest/Rest/Post-Rest Vertical Slice

### Goal

Demonstrate the central use case as multiple recomputed advisory decisions on the 4-panel screen.

### Reference journey

```text
high drowsiness/fatigue while driving with `trigger_purpose=rest_recommended`
→ orchestrator activates rest guidance/journey
→ humming karaoke is selected for travel to rest spot
→ arrive and stop
→ select nap/rest method and duration
→ explicit rest-completed event applies post-rest feature values (reviewer-entered)
→ recompute stopped service proposal
→ select full karaoke concrete song and lighting
→ content completes or driver returns to driving
→ enforce motion policy and restore previous content
```

### Scope

- Integrate the transparent service and content selectors with the journey engine across the three lifecycle stages.
- Show the explicit trigger purpose, lifecycle stage, motion state, and currently allowed service set (Panel ②/③).
- Show current committed action and non-binding future preview separately.
- Add interactive mode (choose/reject/edit/request-alternatives/step-events) and quick-check mode (auto-take rank 1).
- Allow context edits followed by explicit recompute; add rejection/alternate-candidate flow.
- Add event timeline and lifecycle display.

### Acceptance criteria

- The whole reference journey can be completed from one built-in seed on the 4-panel screen.
- Each transition creates a new frozen snapshot when recomputation is required.
- Changing reviewer-entered post-rest drowsiness/fatigue can change the next proposal.
- Previewed future content is not automatically committed.
- The driver/customer can reject every proposal and still progress/exit safely.
- Quick-check mode selects the same rank-1 result shown in interactive evidence.
- No probabilistic acceptance or recovery is generated; post-rest outcomes are explicit inputs.

### Verification focus

- End-to-end browser/API test on the 4-panel screen.
- Event order and persisted-state tests.
- Snapshot-boundary tests.
- Reject-all and motion-transition tests.

---

## 10. P8 — Constrained LLM Service-Selector Package

### Goal

Add an independent LLM approach for service ranking using the common contract (design source: `aica_proposal_design_reference_draft.md` §6 and `others/aica_stage_constrained_llm_proposal_selector_spec.md`).

### Scope

- Define strict request and response schemas; define package-local prompt/policy.
- Supply the explicit trigger purpose, lifecycle stage, and only the stage-allowed eligible services and approved feature fields (grouped by CDC-SU baseline vs. enabled additions; disabled additions omitted).
- Require feature-ID citations and concise rationale; do not request or show private chain-of-thought.
- Validate candidate IDs and hard exclusions; add no-proposal, retry, timeout, and failure behavior.
- Persist model/prompt/schema/configuration/request-hash/response provenance.
- Add a deterministic recorded-response fixture mode for tests and demos.

### Acceptance criteria

- The package never reads the transparent package's scores/ranks/state.
- The package cannot return a service outside the frozen purpose/stage constraint row, and hard exclusions cannot be reversed by the model.
- Output validates against the same neutral service-selector result schema.
- Invented service IDs or features are rejected; missing data and uncertainty are visible.
- Recorded fixture replay is stable; a live-model failure does not corrupt the simulation world.

### Verification focus

- Schema/grounding adversarial tests.
- Prompt fixture tests; retry/fallback tests.
- Provenance persistence tests; package-independence tests.

---

## 11. P9 — Constrained LLM Content-Selector Package

### Goal

Add an independent, catalog-grounded LLM approach for concrete music plans.

### Scope

- Supply trigger purpose, lifecycle stage, selected stage-allowed service, approved features, recipe, and the eligible synthetic catalog subset.
- Require catalog Track IDs for every plan item; require duration/mode/lighting/end-policy fields.
- Validate humming/full-karaoke motion policy; require used/unused and supporting/opposing feature citations.
- Add recorded-response demo fixtures for major contrast seeds; persist full provenance and validation results.

### Acceptance criteria

- No song, artist, oshi, event, or route fact can be invented outside the request.
- All returned modes are valid for the selected service and motion state.
- The package does not consume transparent content scores/ranks.
- Output uses the common content-selector result contract; validation errors are visible and never silently become valid plans.
- The same journey engine can execute validated transparent and LLM plans.

### Verification focus

- Catalog grounding/adversarial tests.
- Motion and service-policy tests.
- Structured-output retry tests.
- Recorded fixture replay tests.

---

## 12. P10 — Comparison, Evidence, And Customer Review Completeness

### Goal

Make differences between data, parameters, and algorithms easy for customers to understand and evaluate.

### Scope

- Add clone-and-compare workflow (clone a seed, change one field, compare).
- Add side-by-side transparent vs LLM runs from a single frozen snapshot (run each package, compare two evidence logs — never blend scores).
- Add field-level setup diff; eligibility, rank, score/reason, and journey delta views.
- Add immutable decision snapshots and evidence export.
- Add structured human feedback categoricals: **appropriate/inappropriate**, **understandable**, **safe (safety impression)**, **useful/not useful**, **intrusive/not intrusive**, and free comments.
- Keep human review a separate evidence stream from simulator and algorithm facts.

### Acceptance criteria

- Customers can tell exactly which input or configuration changed.
- The app never labels one algorithm correct automatically.
- Transparent and LLM evidence use method-appropriate explanations in a comparable frame.
- Excluded, unused, and missing fields are visible.
- Export is sufficient to reproduce a transparent decision and replay a recorded LLM decision.
- Feedback does not mutate an algorithm package during the run.

### Verification focus

- Comparison correctness tests.
- Evidence schema and export tests.
- Language/label consistency tests.
- Human-feedback separation tests.

---

## 13. P11 — All-Service Breadth And Stabilization

### Goal

Complete service-selector breadth and provide review-level content plans for the remaining source services.

### Scope

- Validate ranking support for: call-and-response practice; quiz; ranking creation; radio-style playback; conversation; live viewing; stretch video; oshi reexperience; multisensory relaxation; connected video recommendation; and rest-support journey / rest proposal types.
- Add lower-fidelity editable plan templates for these services (Slide-26-only services remain non-default, returning `unsupported_service`/`unsupported_recipe` until a versioned recipe exists).
- Complete source traceability and recipe documentation.
- Accessibility, JA/EN bilingual labels, responsive layout (4-panel → single column at narrow widths), and error states.
- Performance and run-data size review; regression and migration checks for the current trigger simulation.
- Customer pilot checklist and known-limitations display.

### Acceptance criteria

- Every Slide 38–40 service and every additional Slide-26 service can be returned, excluded, selected, and executed at an explicitly documented review fidelity.
- Music playlist, humming, and full karaoke retain detailed content generation.
- Lighting matrix is complete and correct; no service bypasses motion eligibility.
- Source applicability choices are visible by recipe version.
- Existing trigger simulator remains operational; all V1 specification acceptance criteria pass.

---

## 14. Post-V1 — Trigger-Tick Composition

### Goal

Connect the proposal simulator to the current trigger simulation without changing selector contracts.

### Scope

- Implement `TriggerTickState → ProposalOpportunity` adapter so both `StandaloneProposalWorld` and `TriggerTickAdapter` emit the identical `ProposalOpportunity`.
- Carry the trigger algorithm's selected `trigger_purpose` into the proposal opportunity and map journey progression to `lifecycle_stage`.
- Map current trigger signals/features to approved proposal features; define behavior when proposal-required data is unavailable (surface, never invent).
- Emit a proposal opportunity only when trigger fire control authorizes it; add tick-driven cooldown/reproposal orchestration.
- Share route/motion time progression while preserving separate package runtime states; support a combined run evidence timeline; retain standalone proposal-screen mode.

### Acceptance criteria

- Existing standalone snapshots still run unchanged.
- Selector packages cannot tell whether input came from standalone or tick simulation.
- Trigger algorithm and proposal algorithms share no scores or internal state.
- Combined evidence distinguishes trigger decision, service decision, content decision, and journey effect.
- Proposal context missing from the trigger world is surfaced, not invented.

---

## 15. Post-V1 Research Tracks

These are not prerequisites for the simulation V1:

- Real data-source availability and privacy analysis (including whether Spotify Audio Features remains available; the V1 pinned schema is a fixture).
- Empirical weight/threshold calibration.
- User study design for acceptance and intrusiveness.
- Safety review and regulatory analysis.
- Recovery-effect measurement methodology.
- Customer media-catalog import policy; karaoke/lyrics licensing and asset sourcing (`karaoke_provider_v1`, `licensed_lyrics_analysis_v1` extensions are undefined stubs today).
- Learning/update pipeline from reviewed evidence.
- Production LLM reliability, cost, latency, and governance.

None should be represented as solved by synthetic simulation.

---

## 16. Cross-Milestone Quality Gates

Every milestone after P1 must satisfy:

1. **Boundary gate:** world, dataset, selectors, eligibility, journey, and evidence remain separated.
2. **Feature gate:** no unapproved/unavailable feature enters ranking; every contract row is marked used, `context_only`, or `available_but_not_used`.
3. **Safety gate:** hard constraints precede ranking; the continuous dominance invariant holds and remains advisory.
4. **Determinism gate:** transparent identical-input replay is exact; the frozen dataset (not a model rerun) is the replay boundary; no live LLM/network call occurs in a transparent run.
5. **Grounding gate:** every selected record exists in the frozen, validated synthetic dataset; synthetic identity (`synthetic-` IDs, `.invalid` links) is preserved.
6. **Evidence gate:** every decision records inputs, configuration (dataset/algorithm/parameter-set versions), output, and user action.
7. **Regression gate:** the current trigger simulator continues to pass its relevant tests.
8. **Human-judgment gate:** simulator results never become automatic correctness claims; human review stays a separate stream.

---

## 17. Open Source-Reconciliation Items (carry into Step 2/3 of each affected milestone)

These are known cross-document divergences discovered during v2 refinement. They do not block sequencing but must be resolved (with written rationale) before the affected milestone freezes its contract:

- **Post-rest candidate count (4 vs 5).** The spec §7.5 matrix and Appendix A.0 list four `after_rest_before_restart` services (`live_viewing`, `stretch_video`, `full_karaoke`, `oshi_reexperience`). The **service algorithm doc (§2.4/§5.2.4) deliberately adds a fifth**, `call_response_stopped`, citing Slides 38 and 40. Reconcile the matrix (adopt 5 with rationale, or record the exclusion) before **P4/P5** freeze.
- **Schedule-field ownership.** *(RESOLVED — P0.5, see `docs/superpowers/specs/2026-07-16-proposal-p0.5-design.md` §6.2.)* The service doc delegates `scheduled_event_*` to the content selector, but the content doc marks all three schedule fields not-scored. **Resolution:** in the content contract all three schedule fields are `context_only` (carried in the snapshot, mask 0, never scored) — no Spotify song field supports an event relation and schedule→content affinity is deferred (content algorithm doc §19). The delegation is satisfied by carrying them as visible context.
- **Content `Additional proposed` coverage.** *(RESOLVED — P0.5, design §6.1.)* Appendix A.2 lists ~14 `Additional proposed` fields the content package must consume or mark; the content algorithm doc's scored subset omits the category (only `oshi_id` survives, relocated to Preference). **Resolution:** the P0.5 feature-disposition registry marks every A.2 content row with an explicit disposition (`scored`/`context_only`/`available_but_not_used`); `oshi_id` is `scored`, all other `Additional proposed` rows are `context_only`. None dropped; a completeness + A.2 cross-check test enforces this.
- **Content-doc field renames.** *(RESOLVED — P0.5, design §6.2.)* Under `genre_affinity_v1`, the content doc wires `content_tag_usage_level`/`scene_content_tag_usage_level` to `usage_by_genre`/`scene_genre_usage`. **Resolution:** the disposition registry and genre-extension contract use the renamed fields; a cross-check keeps Appendix A.2 and the data spec's world fields aligned.
- **Control-input naming.** *(RESOLVED — P0.5, design §6.2.)* Older content-doc drafts used a dotted control-input form; every other doc uses `trigger_purpose`/`lifecycle_stage`. **Resolution:** normalized to `trigger_purpose`/`lifecycle_stage` everywhere (content algorithm doc §2.4 updated); the Pydantic enums and a docs naming-consistency test enforce the single canonical form.
- **Missing spec cross-reference.** The consolidated spec cross-references the content algorithm doc but not the service algorithm doc; add the reference so §11 points to its normative source.

---

## 18. Suggested Release Boundaries

Mapped to the overview's five-stage delivery path (Screen & contracts → Synthetic world → Transparent music slice → Independent LLM → Compare & integrate):

| Release | Included milestones | Overview stage | Review value |
|---|---|---|---|
| Internal contract preview | P1–P4 | 1–2 | Validate the 4-panel architecture, the frozen dataset, editable data, constraints, and journey states. |
| Transparent music vertical slice | P5–P7 | 3 | Customer evaluates the full central proposal idea and tunes explicit scores end to end. |
| Algorithm comparison beta | P8–P10 | 4–5a | Customer compares transparent and LLM approaches on identical frozen worlds. |
| Proposal Simulator V1 | P11 | 5b | All services represented; music content detailed; evidence and UX stabilized. |
| Combined Simulator | Post-V1 composition | — | Trigger timing and proposal selection operate in one run through an adapter. |

The transparent music vertical slice is the first meaningful customer demonstration. It should not wait for the LLM packages, because it establishes the contracts, the frozen dataset, the features, the journey behavior, and the evidence that the LLM approach must also respect.

> **Build vs. release order.** Build/execution order is **validation-first** (§1) and differs from the release grouping above; the release table is unchanged. The content contract (P0.5), the content package (P6), and the validated dataset (P2) are produced first as an internal capability, ahead of the screen and journey wiring.

---

## Appendix A — Feature Implementation Checklist

This checklist prevents milestone implementation from shortening a category into an ambiguous aggregate field. P3 must make every item editable; P5/P6 must consume it or explicitly mark it `context_only` / `available_but_not_used`; P10 must show it in evidence. Field names and enums track the consolidated specification §8–§9 and the two algorithm docs; known divergences are noted in §17.

### A.0 Required control inputs and default flow matrix

- `trigger_purpose`: `rest_recommended`, `inattentive_driving_prevention_recovery`, `route_music`, or `child_passenger_experience`.
- `lifecycle_stage`: `before_rest_until_stop`, `during_rest_stopped`, `after_rest_before_restart`, or `active_driving_content`.
- `allowed_service_ids`: resolved from the frozen Slides 64–65 matrix before motion/readiness filtering and ranking.

| Trigger purpose | Lifecycle stage | Default allowed proposal types |
|---|---|---|
| `rest_recommended` | `before_rest_until_stop` | `music_playlist`, `humming_karaoke`, `quiz`, `ranking_creation`, `radio_style`, `call_response_driving` |
| `rest_recommended` | `during_rest_stopped` | `rest_duration_suggestion`, `rest_method_suggestion`, `seat_adjustment`, `nap_guidance`, `rest_extension_check` |
| `rest_recommended` | `after_rest_before_restart` | `live_viewing`, `stretch_video`, `full_karaoke`, `oshi_reexperience` *(the service algorithm doc adds `call_response_stopped` as a fifth candidate — see §17)* |
| `inattentive_driving_prevention_recovery` | `active_driving_content` | `music_playlist`, `humming_karaoke`, `quiz`, `ranking_creation`, `radio_style`, `call_response_driving` |
| `route_music` | `active_driving_content` | Same Slide-65 driving-content set |
| `child_passenger_experience` | `active_driving_content` | Same Slide-65 driving-content set |

### A.1 Service-proposal independent feature contract

P3 must expose every row below in the service editor and request. P5 must consume it or mark it `available_but_not_used`; P10 must display it in evidence. The category order and provenance must remain unchanged. (The service algorithm doc scores the 17 CDC-SU baseline rows plus the direct candidate-specific rows below.)

| Category | Subcategory | Feature name | Field and value type | Reason to use | Priority | Source |
|---|---|---|---|---|---:|---|
| Situation | Current driver state | Drowsiness level | `drowsiness_level` — number 0–100 | Rank services appropriate to current drowsiness and safety need. | P0 | Slides 66–67 |
| Situation | Current driver state | Fatigue level | `fatigue_level` — number 0–100 | Rank services appropriate to fatigue and recovery need. | P0 | Slides 66–67 |
| Situation | Driving environment | Traffic state | `traffic_state` — enum: `normal`, `congested` | Adjust service fit and interaction load in congestion. | P1 | Slides 66–67 |
| Situation | Driving environment | Road type | `road_type` — enum: `highway`, `local`, `mountain`, `parking` | Represent the specified highway context and normalized simulator road contexts. | P1 | Slides 66–67; normalized enum |
| Situation | Driving environment | Day/night state | `night_state` — enum: `day`, `night` | Adjust service fit for night driving. | P1 | Slides 66–67 |
| Situation | Driving environment | Road monotony | `monotony_level` — number 0–100 | Increase fit of engaging services on monotonous roads. | P1 | Slides 66–67 |
| Situation | Route and destination | Route characteristics | `route_tags` — string array | Match services to characteristic scenery, roads, or themes. | P1/P2 | Slides 66–67 |
| Situation | Route and destination | Destination characteristics | `destination_tags` — string array | Match services to home, leisure, event, or oshi destinations. | P1/P2 | Slides 66–67 |
| Situation | Passenger composition | Child present | `child_present` — boolean | Favor services suitable for a child passenger without inferring child state. | P2 | Slides 66–67 |
| Situation | Passenger composition | Multiple passengers | `multiple_passengers` — boolean | Favor services suitable for shared participation. | P2 | Slides 66–67 |
| Preference | Oshi information | Oshi registered | `oshi_registered` — boolean | Determine whether oshi-related services can be considered. | P2/P3 | Slides 66–67 |
| Preference | Oshi information | Oshi mode | `oshi_mode` — enum: `on`, `off` | Apply the user’s explicit oshi personalization setting. | P2/P3 | Slides 66–67 |
| Preference | Unused function | Service recency | `service_recency_state[service]` — map to `never`, `long_unused`, `recent` | Add a weak novelty signal for unused or long-unused services. | P4 | Slides 66–67 |
| Preference | Overall usage frequency | Service usage level | `service_usage_level[service]` — map to `never`, `low`, `medium`, `high` | Represent how often the user chooses each in-car service. | P3 | Slides 66–67 |
| Preference | Scene-specific tendency | Scene/service usage level | `scene_service_usage_level[scene][service]` — nested usage-level map | Represent service preference in comparable situations. | P3 | Slides 66–67 |
| History | Proposal result | Service proposal acceptance rate | `service_proposal_acceptance_rate[service]` — map to number 0–100 | Favor service proposals previously accepted more often. | P3 | Slides 66–67 |
| History | Recovery result | Service recovery rate | `service_recovery_rate[service]` — map to number 0–100 | Favor services associated with stronger synthetic recovery. | P3 | Slides 66–67 |
| Additional proposed | Motion safety | Driving/stopped state | `motion_state` — enum: `driving`, `stopped` | Apply content presentation eligibility before service ranking. | P0 | Simulator proposal; concept from Slides 68–69 |
| Additional proposed | Rest-route feasibility | Minutes until rest spot | `estimated_min_until_rest_spot` — nullable non-negative integer | Check whether a pre-rest service fits the remaining drive. | P0/P1 | Simulator proposal |
| Additional proposed | Rest-route feasibility | Rest spot type | `rest_spot_type` — enum: `sa_pa`, `convenience_store`, `parking`, `oshi_spot`, `other`, `unknown` | Adapt the proposed rest journey to the available location. | P1/P2 | Simulator proposal |
| Additional proposed | Current proposal session | Active service | `active_service` — nullable service ID | Avoid conflicts and support continuation or switching. | P2/P3 | Simulator proposal |
| Additional proposed | Current proposal session | Recent service rejections | `recent_service_rejections` — timestamped service-ID array | Avoid immediately repeating a rejected proposal. | P3 | Simulator proposal |
| Additional proposed | Evidence reliability | Service acceptance confidence | `service_proposal_acceptance_confidence[service]` — map to number 0–1 | Limit the influence of sparse synthetic acceptance history. | P3 | Simulator proposal |
| Additional proposed | Evidence reliability | Service recovery confidence | `service_recovery_confidence[service]` — map to number 0–1 | Limit the influence of sparse synthetic recovery history. | P3 | Simulator proposal |
| Additional proposed | Schedule promotion | Scheduled event type | `scheduled_event_type` — enum: `none`, `live_show`, `radio_program`, `concert`, `oshi_event`, `other` | Optionally let an event affect service choice (owner under review — §17). | P2 | Simulator proposal; concept from Slides 68–69 |
| Additional proposed | Schedule promotion | Scheduled event timing | `scheduled_event_timing` — enum: `now`, `soon`, `later`, `unknown` | Represent whether event-relevant services are timely. | P2 | Simulator proposal; concept from Slides 68–69 |
| Additional proposed | Schedule promotion | Scheduled event tags | `scheduled_event_tags` — string array | Match the event to live, radio, music, or oshi services. | P2 | Simulator proposal; concept from Slides 68–69 |

### A.2 Concrete-content independent feature contract

P3 must expose every row below in the content editor and request. P6 must consume it or mark it `context_only` / `available_but_not_used`; P10 must display it in evidence. This contract is complete by itself and must not be assembled from the service contract. In Spotify-only V1, the content algorithm scores 15 of these rows; the six `genre‡`-marked rows are scored **only when `genre_affinity_v1` is enabled** and are otherwise `context_only` (see §17 for the field-name reconciliation).

| Category | Subcategory | Feature name | Field and value type | Reason to use | Priority | Source |
|---|---|---|---|---|---:|---|
| Situation | Current driver state | Drowsiness level | `drowsiness_level` — number 0–100 | Select genre, tempo, and intensity via the arousal axis. | P0 | Slides 68–69 |
| Situation | Current driver state | Fatigue level | `fatigue_level` — number 0–100 | Select appropriate content intensity and duration. | P0 | Slides 68–69 |
| Situation | Driving environment | Traffic state | `traffic_state` — enum: `normal`, `congested` | Adjust content energy and expected duration. | P1 | Slides 68–69 |
| Situation | Driving environment | Road type | `road_type` — enum: `highway`, `local`, `mountain`, `parking` | Choose road-appropriate content while preserving the highway case. | P1 | Slides 68–69; normalized enum |
| Situation | Driving environment | Day/night state | `night_state` — enum: `day`, `night` | Choose appropriate stimulation for night driving. | P1 | Slides 68–69 |
| Situation | Driving environment | Road monotony | `monotony_level` — number 0–100 | Prefer engaging content as monotony increases. | P1 | Slides 68–69 |
| Situation | Route and destination `genre‡` | Route characteristics | `route_tags` — string array | Match songs to the route (scored only under `genre_affinity_v1`). | P1/P2 | Slides 68–69 |
| Situation | Route and destination `genre‡` | Destination characteristics | `destination_tags` — string array | Match songs to the destination (scored only under `genre_affinity_v1`). | P1/P2 | Slides 68–69 |
| Situation | Passenger composition `genre‡` | Child present | `child_present` — boolean | Favor child-compatible genres (scored only under `genre_affinity_v1`). | P2 | Slides 68–69 |
| Situation | Passenger composition | Multiple passengers | `multiple_passengers` — boolean | Favor content suitable for shared participation. | P2 | Slides 68–69 |
| Situation | Driving state | Driving/stopped state | `motion_state` — enum: `driving`, `stopped` | Apply content-mode and presentation restrictions. | P0 | Slides 68–70 |
| Preference | Oshi information | Oshi registered | `oshi_registered` — boolean | Determine whether oshi-related content can be considered. | P2/P3 | Slides 68–69 |
| Preference | Oshi information | Oshi mode | `oshi_mode` — enum: `on`, `off` | Apply the explicit oshi personalization setting. | P2/P3 | Slides 68–69 |
| Preference | Oshi identity | Oshi ID | `oshi_id` — nullable Spotify-compatible Artist ID | Match the selected synthetic favorite to concrete catalog items (exact-ID → `a=+1`). | P2/P3 | Slides 68–69 / algorithm doc §5.3 |
| Preference | Unused function | Service recency | `service_recency_state[service]` — map to `never`, `long_unused`, `recent` | Retain the service-level novelty context for the selected service. | P4 | Slides 68–69 |
| Preference | Overall usage frequency | Service usage level | `service_usage_level[service]` — usage-level map | Retain the user’s overall service-use tendency. | P3 | Slides 68–69 |
| Preference | Scene-specific tendency | Scene/service usage level | `scene_service_usage_level[scene][service]` — nested usage-level map | Retain service preference in a comparable situation. | P3 | Slides 68–69 |
| Preference | UPro information | Age band | `age_band` — enum configured by simulator | Support era and genre matching without exact age. | P3 | Slides 68–69 |
| Preference | UPro information | Gender | `gender` — enum plus `unknown` | Preserve the CDC-SU input; default transparent weight is zero. | P4/default 0 | Slides 68–69 |
| Preference | UPro information `genre‡` | Hobbies and interests | `hobby_interest_tags` — string array | Match genres to interests (scored only under `genre_affinity_v1`). | P3 | Slides 68–69 |
| Preference | Unused content | Catalog item recency | `catalog_item_recency_state[item]` — map to `never`, `long_unused`, `recent` | Add weak item-level novelty. | P4 | Slides 68–70 |
| Preference | Overall usage frequency `genre‡` | Genre usage level | `usage_by_genre[genre]` — usage-level map *(was `content_tag_usage_level[tag]`; §17)* | Represent genre preference (scored only under `genre_affinity_v1`). | P3 | Slides 68–70 |
| Preference | Overall usage frequency | Catalog item usage level | `catalog_item_usage_level[item]` — usage-level map | Represent song or item preference. | P3 | Slides 68–70 |
| Preference | Scene-specific tendency `genre‡` | Scene/genre usage level | `scene_genre_usage[scene][genre]` — nested usage-level map *(was `scene_content_tag_usage_level`; §17)* | Represent genre preference in comparable situations (scored only under `genre_affinity_v1`). | P3 | Slides 68–70 |
| Preference | Playback and user operations | Played items | `played_items` — timestamped item-ID array | Use recent playback while controlling repetition. | P3 | Slides 69, 71, 72, 79 |
| Preference | Playback and user operations | Skipped items | `skipped_items` — timestamped item-ID array | Avoid recently skipped or disliked items. | P2/P3 | Slides 69, 71, 72, 79 |
| Preference | Playback and user operations | Cancelled content plans | `cancelled_content_plans` — timestamped plan record array | Avoid repeating cancelled plans. | P2/P3 | Slides 68–69 |
| Preference | Playback and user operations | Changed-from items | `changed_from_items` — timestamped item-ID array | Learn from items the user replaced. | P2/P3 | Slides 69, 71, 72, 79 |
| History | Proposal result | Service proposal acceptance rate | `service_proposal_acceptance_rate[service]` — map to number 0–100 | Keep service-level acceptance context visible to content selection. | P3 | Slides 68–69 |
| History | Recovery result | Service recovery rate | `service_recovery_rate[service]` — map to number 0–100 | Keep service-level recovery context visible to content selection. | P3 | Slides 68–69 |
| History | Schedule | Scheduled event type | `scheduled_event_type` — enum: `none`, `live_show`, `radio_program`, `concert`, `oshi_event`, `other` | Match concrete content to an upcoming event type (ownership under review — §17). | P2 | Slides 68–70 |
| History | Schedule | Scheduled event timing | `scheduled_event_timing` — enum: `now`, `soon`, `later`, `unknown` | Represent proximity of the event. | P2 | Slides 68–70 |
| History | Schedule | Scheduled event tags | `scheduled_event_tags` — string array | Match content to the event, artist, theme, or franchise. | P2 | Slides 68–70 |
| History | Proposal result | Content proposal acceptance rate | `content_proposal_acceptance_rate[key]` — map to number 0–100 | Favor item, tag, genre, or plan proposals accepted more often. | P3 | Slides 68–70 |
| History | Recovery result | Content recovery rate | `content_recovery_rate[key]` — map to number 0–100 | Favor content associated with stronger synthetic recovery. | P3 | Slides 68–70 |
| Additional proposed | Rest-route feasibility | Minutes until rest spot | `estimated_min_until_rest_spot` — nullable non-negative integer | Ensure the concrete plan fits before arrival. | P0/P1 | Simulator proposal |
| Additional proposed | Rest-route feasibility | Rest spot type | `rest_spot_type` — rest-spot enum | Adapt concrete content to the upcoming stopped context. | P1/P2 | Simulator proposal |
| Additional proposed | Current proposal session | Active service | `active_service` — nullable service ID | Keep the content plan compatible with the active service. | P2/P3 | Simulator proposal |
| Additional proposed | Current proposal session | Recent service rejections | `recent_service_rejections` — timestamped service-ID array | Avoid content plans attached to a just-rejected service. | P3 | Simulator proposal |
| Additional proposed | Evidence reliability | Service acceptance confidence | `service_proposal_acceptance_confidence[service]` — map to number 0–1 | Limit sparse service-level acceptance evidence. | P3 | Simulator proposal |
| Additional proposed | Evidence reliability | Service recovery confidence | `service_recovery_confidence[service]` — map to number 0–1 | Limit sparse service-level recovery evidence. | P3 | Simulator proposal |
| Additional proposed | Detailed oshi identity | Oshi type | `oshi_type` — enum: `artist`, `artist_member`, `group`, `character`, `voice_actor`, `franchise`, `creator`, `other` | Distinguish different favorite-entity relationships. | P2/P3 | Simulator proposal |
| Additional proposed | Detailed oshi identity | Oshi tags | `oshi_tags` — string array | Match works, themes, genres, routes, and events. | P2/P3 | Simulator proposal |
| Additional proposed | Granular operations | Completed items | `completed_items` — timestamped item-ID array | Distinguish completion from playback start. | P3 | Simulator proposal |
| Additional proposed | Granular operations | Manually selected items | `manually_selected_items` — timestamped item-ID array | Treat explicit choice as stronger evidence than passive playback. | P3 | Simulator proposal |
| Additional proposed | Granular operations | Repeated items | `repeated_items` — timestamped item-ID array | Capture deliberate repeats while respecting repetition caps. | P3 | Simulator proposal |
| Additional proposed | Evidence reliability | Content acceptance confidence | `content_proposal_acceptance_confidence[key]` — map to number 0–1 | Limit sparse content-level acceptance evidence. | P3 | Simulator proposal |
| Additional proposed | Evidence reliability | Content recovery confidence | `content_recovery_confidence[key]` — map to number 0–1 | Limit sparse content-level recovery evidence. | P3 | Simulator proposal |

> **Note on the `Additional proposed` content rows.** The transparent content algorithm doc scores a smaller Spotify-only subset and does not yet enumerate every `Additional proposed` field above. Until §17 is resolved, P6 must still mark each row `context_only` or `available_but_not_used` in evidence rather than silently dropping it.

### A.3 Boundary checklist

- `trigger_purpose` remains an explicit required routing/control input from the trigger side.
- `lifecycle_stage` remains an explicit required journey/runtime input.
- Purpose/stage service constraints are resolved before feature-based ranking.
- Service capability and content readiness remain constraint/catalog metadata, not features.
- The synthetic music dataset, its `simulation_flags`, and algorithm parameters/hyperparameters remain non-feature inputs.
- Each feature row carries **feature-origin provenance** (`cdc_su_baseline`, `normalized_cdc_su_concept`, or `proposed_addition`). This is distinct from the algorithm docs' **response-coefficient provenance** (`cdc_su_explicit`, `service_definition`, `normalized_context_hypothesis`, …); evidence must not conflate the two.
- The service and content package requests are independently valid and independently reviewable.
- UI state never enters an algorithm request; song traits (arousal/valence/ease) are derived at decision time and never stored as catalog metadata.
- `child_state` is not introduced; the explicit `trigger_purpose` field is required.
