# P6 — Transparent Music Content-Selector Package (Two-Axis Trait Model) — Design

**Date:** 2026-07-16
**Milestone:** P6 (from `docs/master/aica_proposal_simulator_milestones.md` §8)
**Branch:** `proposal-p6-content-selector`
**Status:** Approved design (brainstorming complete); precedes SpecKit `speckit-specify`.

---

## 1. Goal & customer-visible outcome

Build the transparent **content-selector** as a standalone `python_module` package that
takes one frozen selector input and returns one ordered **`complete_plan`** of songs
(default 5) for `music_playlist`, `humming_karaoke`, and `full_karaoke`, using the
two-axis (**arousal / valence**) song-trait model in
`docs/master/aica_transparent_content_proposal_algorithm.md`. Each ordered item shows its
`item_fit`, the four decision-time trait values, per-feature contributions
(`r_i = e_i·a_i`), and reasons. **No aggregate plan score and no plan-candidate ranking.**

Customer value: a fully reviewable, deterministic concrete-content scorer that is
independently unit-testable now and later becomes P2's contrast-direction validator.

There is **no** screen, runtime endpoint wiring, dataset generator, journey engine,
frontend, or LLM/network path in P6.

## 2. Scope

### 2.1 In scope
1. New package `packages/aica_transparent_content_selector_v1/` — `package.json` +
   `algorithm.py` (single file) + `README.md`, pure `evaluate(context: dict) -> dict`,
   **no `aica_api` imports**, deterministic (no clocks/RNG).
2. Trait derivation at decision time (Table 1, §4.4); the six audio-mood response
   coefficients `a_i = α·A_s + β·V_s` (Table 2, §5.2); every other feature's direct /
   exact-ID / genre-best-match `a_i`; hierarchical weights + purpose multipliers + mask
   normalization (§6); the `item_fit` chain (§3).
3. The 15 Spotify-only scored features + the 6 `genre‡` features gated by
   `genre_affinity_v1` (§5.3 / §5.7); every §9 / Appendix A.2 content row marked used /
   `context_only` / `available_but_not_used`, driven by the frozen P0.5 disposition
   registry.
4. Hard eligibility gates (§7): schema/identity, playability, market, restriction,
   explicit-under-child, recent-skip window, duplicate, humming/full-karaoke availability
   flags, and full-karaoke stopped-motion.
5. Plan construction (§9): deterministic sort `(item_fit desc, id asc)`; playlist /
   humming / full-karaoke mode fields; duration policy; optional lighting; typed errors
   (§13).
6. All algorithm tables externalized as structured, editable, evidence-visible
   **package.json hyperparameters** (see §5); the age/era affinity table and genre maps
   frozen as manifest defaults.
7. Hand-authored, **algorithm-blind** fixtures (trait-separated songs, numeric world
   snapshots, catalogs) and the full contrast / trait-matrix / eligibility / determinism
   test suite (§16). Output validated against the frozen `proposal_contracts` JSON-Schema
   and the `CompletePlan` Pydantic model.
8. Targeted master-doc reconciliations the freeze requires (§13 of this design).

### 2.2 Out of scope (deferred, by milestone)
Golden rankings against the real 36-song catalog (P2 — this is the single part of P6 that
closes once the frozen dataset exists); the 4-panel screen and neutral run/persistence
types (P1); the editable world and catalog editors (P3); the journey engine value
semantics + platform/motion eligibility (P4); the service selector (P5); the LLM content
package (P9); any orchestrator/adapter wiring, frontend, i18n, or network/LLM path.

## 3. Key decisions (this milestone)

### 3.1 Evidence representation — numeric 0–100 (approved)
Driver/environment magnitudes (`drowsiness_level`, `fatigue_level`, `monotony_level`) are
carried in `feature_snapshot` as **numeric 0–100** and reduced to evidence by `/100`,
exactly as content-algo §5.3 and the authoritative world schema in data-spec §13
(`drowsiness_level: 80`) specify.

*Reconciliation:* the frozen P0.5 world fixtures used ordinal bands (`"med"`), but P0.5
validated `feature_snapshot` **structurally, not scored** — those fixtures were
algorithm-blind and remain valid contract fixtures. P6 authors its own **numeric** scoring
fixtures matching data-spec §13. This resolves the P0.5-fixture ↔ data-spec §13
divergence in favour of the numeric authoritative schema. (Categorical situation features —
`traffic_state`, `road_type`, `night_state`, `motion_state` — stay enum-valued with
per-enum evidence exactly as §5.3 tabulates.)

### 3.2 Parameter surface — full externalization to package.json (approved)
Content-algo §12 lists the large tables (Trait Composition Matrix, Context Response
Matrix, hierarchy weights, purpose multipliers, genre maps, age/era affinity) as "frozen
per run, evidence-visible." All of them are represented as **structured package.json
hyperparameters** (nested `default` values), fully editable and echoed verbatim into each
plan's `algorithm_provenance`. Editing any table bumps `parameter_set_version`. This is a
literal realization of "editable + in evidence" and needs no parameter editor (P1+).

### 3.3 Single-file package layout (approved)
`algorithm.py` holds the whole pipeline, organized into section-commented pure functions in
the same style as the trigger package's `algorithm.py` (helpers → trait derivation →
response/weights/item_fit → eligibility → genre best-match → plan/modes/duration/lighting →
evidence builder → `evaluate`). Each concern is an importable pure function, so §15's
"independently testable" requirement is met without extra modules. No package-relative or
`aica_api` imports.

## 4. Package & I/O contract

```
packages/aica_transparent_content_selector_v1/
  package.json    # manifest — structured hyperparameters (all tables) + scalar knobs
  algorithm.py    # evaluate() + internal function sections
  README.md       # provenance, contract, hyperparameter reference
```

- **Input:** the frozen `SelectorInput` (C1) dict.
  - `selected_service_id ∈ {music_playlist, humming_karaoke, full_karaoke}` — consumed as
    a **control fact only**, never a service score/rank/rationale; any other service →
    `unsupported_recipe`; missing/invalid lifecycle → `invalid_request`.
  - `feature_snapshot` carries numeric driver/env magnitudes, categorical env enums, exact-
    ID history maps (`played_items`, `skipped_items`, `changed_from_items`,
    `catalog_item_usage_level`, `content_proposal_acceptance_rate`, `content_recovery_rate`,
    oshi fields), and the optional `genre_affinity_v1` sibling namespace.
  - The eligible song catalog is supplied to the package as frozen `Song` records
    (Track + Audio Features + simulation flags) via `feature_snapshot`/`parameters`;
    `eligible_candidates` / `excluded_candidates` carry the Track-ID candidate lists and
    platform-level exclusions.
- **Output:** the frozen `CompletePlan` (C2) dict. Validated in tests against the
  `CompletePlan` Pydantic model **and** `proposal_contracts/schema/content_output.schema.json`.
  Contains no `plan_score` / `aggregate_score` / `plan_fit` field.
- **Context assembly:** a small test-support helper composes `context` =
  `{ selector-input fields, hyperparameters: <manifest defaults ⊕ overrides>, parameters,
  package_runtime_state, … }`, mirroring the run_manager convention that hyperparameters
  reach `evaluate` **fully resolved** and are read by direct `hp[key]` indexing (a missing
  key is a real configuration bug → surfaced, never a silent default). P6 is not wired into
  run_manager/adapter; the helper stands in until P4/P5/P7.

## 5. package.json hyperparameter surface

Structured (nested) hyperparameters — the manifest schema is extended with structured
`kind`s (`matrix`, `map`, `table`) alongside the existing `numeric`/`enum`:

- `trait_composition_matrix` — Table 1 (§4.2/§4.4): per-trait audio-field weights.
- `context_response_matrix` — Table 2 (§5.2): the six driver/env `(α, β)` demands,
  including the §5.6 `⚠` arousal signs.
- `hierarchy_weights` — §6.1 category → subgroup → leaf shares + masks.
- `purpose_multipliers` — §6.2 per-purpose subgroup multipliers.
- `genre_affinity_maps` — §5.7 route / destination / child / hobby `tag → {genre: weight}`
  tables, the Tier-2 `usage_level → weight` curve (`never/absent→0, low→−.5, med→+.25,
  high→+1`), and the 12-term controlled vocabulary.
- `age_era_affinity` — §8 of this design (default below).
- normalization bounds — `tempo` (60/180), `loudness` (−60/0), `tempo_ease`
  (centre 110, span 90), `speech_ease` (0.33/0.33), `duration_ease` (180000/180000).
- history/operation curves — played (`≤30m −1 / today −.5 / ≤7d −.25 / else 0`),
  skip (older `−.5`), changed (`−.75 in window`), item-usage
  (`never 0 / low −.5 / med +.25 / high +1`), acceptance/recovery (`2·rate/100 − 1`).
- `lighting_lookup` — presentation cue map (valence → cue), presentation-only.

Scalar knobs: `plan_item_count` (5), `fixed_humming_segment_sec` (30),
`directional_hypothesis` (`soothe_destress` default per §5.6 / `keep_alert`),
`skip_exclusion_window`, `content_category_weights` (Situation .55 / Preference .30 /
History .15), `parameter_set_version`, `formula_version`.

## 6. Scoring pipeline (§3/§4/§5/§6/§9)

Per eligible song:
1. derive four traits (`arousal, valence, humming_ease, full_karaoke_ease`) → signed
   `A_s = 2·arousal − 1`, `V_s = 2·valence − 1`;
2. compute `a_i`: six driver/env features via `α·A_s + β·V_s`; the added `Song singability`
   construct via `2·ease − 1` (humming_ease / full_karaoke_ease by service, masked 0 for
   playlist); all other features direct/exact-ID (`+1` match) or genre best-match;
3. `r_i = e_i · a_i`;
4. resolve effective weights once — `base = category × subgroup × leaf`;
   `raw = base × purpose_multiplier × mask`; `w_i = raw / Σ raw`; a zero/non-finite
   denominator → `invalid_configuration`;
5. `item_fit = clamp(Σ w_i · r_i, −1, +1)`.

Sort `(item_fit desc, spotify_track.id asc)`, take `plan_item_count`. IEEE-754 binary64,
fixed feature order, full-precision ranking (round only for display), `−0 → +0`, cross-
runtime tolerance `1e-12`. The §10 worked block reproduces **+0.187** within tolerance
(explicit test); an all-neutral world → block 0.

## 7. Eligibility (§7) — before scoring, non-reversible

Schema/identity agreement (Track↔AudioFeatures id/uri/duration), `is_playable`, market,
restrictions, explicit-under-child, recent-skip window, duplicate (one Track per plan),
humming/full-karaoke availability flags, and **full-karaoke requires stopped motion**
(`full_karaoke_requires_stopped` when moving). Excluded songs are listed with reason codes;
karaoke flags are gates only and never add score; high `instrumentalness` lowers ease but
is not an exclusion. Fewer eligible songs than `plan_item_count` →
`insufficient_eligible_items` (never a silently shortened plan). A missing audio field
required by an active trait → `invalid_catalog` (never imputed).

## 8. Age/era affinity table (default — undefined in master docs, frozen here)

`age_era_affinity[band][era]`, values in `[−1, +1]`, a deliberately loose, low-weight
hypothesis rewarding the era each band was ~15–25 years old:

- `age_band ∈ { teens, 20s, 30s, 40s, 50s, 60plus }` (matches data-spec `30s` form).
- era bucketed from `album.release_date` year → `{ pre1980, 1980s, 1990s, 2000s, 2010s,
  2020s }`.
- evidence `e = 1` if `age_band` present ∧ a parseable release year, else `0`
  (`missing_neutral`).

Default matrix (peak on the band's formative era, tapering to mild negatives on distant
eras):

| band \ era | pre1980 | 1980s | 1990s | 2000s | 2010s | 2020s |
|---|---:|---:|---:|---:|---:|---:|
| teens  | −0.6 | −0.4 | −0.2 |  0.0 | +0.5 | +1.0 |
| 20s    | −0.5 | −0.3 |  0.0 | +0.6 | +1.0 | +0.6 |
| 30s    | −0.3 |  0.0 | +0.6 | +1.0 | +0.6 |  0.0 |
| 40s    |  0.0 | +0.6 | +1.0 | +0.6 |  0.0 | −0.3 |
| 50s    | +0.6 | +1.0 | +0.6 |  0.0 | −0.3 | −0.5 |
| 60plus | +1.0 | +0.6 |  0.0 | −0.3 | −0.5 | −0.6 |

Frozen as a `table`-kind hyperparameter with `parameter_set_version`; added to the content-
algo doc §12 (which currently only names the table).

## 9. Genre extension (§5.7)

With `genre_affinity_v1 ∈ enabled_feature_extensions`: the six `genre‡` leaves flip mask
`0→1`; `G_song = ⋃ over artists of artist_genres[artist.id]`;
`a_i = clamp(max_{g∈G_song} g_target[g], −1, +1)`; empty `G_song` → `a_i = 0`,
`missing_neutral`, no redistribution. Tier-1 maps are context-derived; Tier-2
(`usage_by_genre`, `scene_genre_usage`) use the usage-level curve. **With the extension off
the six leaves stay mask 0 and the ordering is bit-for-bit identical to Spotify-only V1**
(explicit equivalence test). Driver/env features are never genre-scored.

## 10. Plan construction, modes, duration, lighting (§9)

`PlanMode` discriminates playlist / humming (chorus-only, guide-vocal,
`driving_lyrics = false`, `fixed_segment_sec`) / full-karaoke (stopped-only, simulated
queue). Duration: playlist/full sum `spotify_track.duration_ms`; humming =
`plan_item_count × fixed_humming_segment_sec`, labeled `simulated_fixed_segment`. Optional
`LightingConfiguration` (cue basis `valence`, presentation-only, independently editable,
**never** affects `item_fit`/order) only for lighting-compatible services. No hidden
diversity reranker, artist cap, shuffle, or LLM reorder.

## 11. Errors (§13) & evidence (§14)

Typed outcomes from the frozen `ContentDecisionType` enum: `complete_plan`, `no_proposal`,
`insufficient_eligible_items`, `unsupported_service`/`unsupported_recipe`,
`invalid_request`, `invalid_catalog`, `invalid_configuration`,
`full_karaoke_requires_stopped`. Typed errors carry evidence and never trigger an
undeclared fallback service.

Per-item evidence: position, track id, title, artists, `item_fit`, the four trait values +
signed forms, and one `ItemFeatureContribution` row per scored feature (`feature_id, e_i,
a_i, alpha/beta or exact_match + response_provenance, r_i, base_weight, purpose_multiplier,
mask, effective_weight, contribution, formula_version`). Per-excluded: track id + reason
codes. Per-plan `algorithm_provenance`: selected service + lifecycle, purpose + stage, plan
count, catalog/world/algorithm/schema/parameter versions & hashes, active vs context-only
feature lists, Trait Composition + Context Response matrix versions, normalized effective
weights, sort/tie-break rule, expected duration + basis, and ordered Track IDs. Identical
inputs + versions reproduce a semantically identical plan (`1e-12`); same-runtime canonical
replay is byte-equivalent.

## 12. Fixtures & test strategy

New tests under `app/api/tests/proposal/` (canonical `docker compose exec api uv run
pytest`; local fallback Anaconda 3.12 `python -m pytest`), plus hand-authored
algorithm-blind fixtures (extending `proposal_contracts/fixtures/` where useful):

- **Traits (§4):** each trait column sums to 1; every trait output in `[0,1]`; `tempo` uses
  `norm_tempo` for arousal but `tempo_ease` for singability; `key/time_signature/liveness`
  never affect score.
- **Compatibility (§5):** every audio row `|α|+β ≤ 1`, `|a_i| ≤ 1`; valence coefficient
  never negative; oshi matches only exact `artists[*].id`; age uses release year only; each
  direct row uses `+1`; `⚠` signs match the configured direction.
- **Weights (§6):** effective weights sum to 1; masked leaves contribute 0 and renormalize;
  a purpose multiplier on a masked subgroup creates no active weight.
- **Math:** `r_i = e_i·a_i` for all rows; contributions sum to `item_fit ∈ [−1,+1]`; §10
  block reproduces `+0.187`; all-neutral world → block 0.
- **Eligibility (§7):** playability/market/restriction/explicit-child/recent-skip; karaoke
  flags 0 vs 1; full-karaoke moving vs stopped; flags never change score.
- **Contrasts (§11):** the six low↔high **drowsiness/fatigue/monotony** and
  **normal↔congested / highway↔mountain / day↔night** reorderings **reverse** (not merely
  rescale); child absent↔present; oshi off↔on; no-play↔recent-play; low↔high item usage;
  low↔high exact-item recovery; driving↔stopped for full karaoke; route A↔B → **no rank
  change**.
- **Genre on/off equivalence:** extension off ⇒ ordering identical to Spotify-only.
- **Determinism:** same inputs/versions/seed → byte-equivalent plan + evidence.
- **Contract:** output validates against the frozen `content_output.schema.json` and
  `CompletePlan`; no `plan_score`.

Golden rankings against the real frozen **36-song catalog defer to P2**; P6 exits on
hand-authored, trait-separated fixtures.

## 13. Master-doc reconciliations (Step 2.2)

- **Content-algo §5.3 / §12 — evidence:** confirm numeric `/100` and add a note that
  P0.5's ordinal world fixtures were structural-only; P6 scoring fixtures use numeric §13
  values.
- **Content-algo §12 — age/era table:** add the §8 default matrix (bands, era buckets,
  values) so the "structural parameter" is defined, not merely named.
- **Milestones §17 / spec §11:** add the missing spec → service-algo-doc cross-reference
  (bookkeeping; does not affect P6 code). Post-rest 4-vs-5 is a P4/P5 service-side item and
  is **not** touched here.
- No change to the frozen P0.5 contracts, the disposition registry, the two settled §5.6
  directional defaults, or the data-spec §18 note (already flags valence/mode/acousticness
  scored; the catalog itself is P2).

## 14. Compatibility & isolation

Zero changes to trigger code, the trigger package, or `models/__init__.py`. P6 does not
wire into run_manager/adapter/routers/frontend. The existing full backend suite stays green
(regression gate). Proposal contracts are imported only via `aica_api.models.proposal`.

## 15. Acceptance-criterion → verification map

| P6 acceptance criterion (§8) | Verification |
|---|---|
| Independent §9/A.2 contract consumed; CDC-SU/`Additional proposed` provenance visible per row | disposition-driven feature loop test + provenance-in-evidence test |
| Traits computed at decision time from Audio Features; no stored/enriched traits | trait-derivation test; no-trait-metadata assertion |
| Arousal/valence responses **reverse** across the six contrasts | six reversal contrast tests |
| No plan references a nonexistent/disabled item; every item cites frozen Track IDs | catalog-grounding test |
| History skips/cancellations affect their own factors, not an opaque scalar | per-feature contribution tests (played/skip/changed/recovery) |
| Oshi mode off prevents oshi personalization without deleting the profile | oshi off↔on test |
| Humming plans need no lyrics screen; full-karaoke active requires stopped | mode/motion tests |
| Lighting only for compatible services and independently editable | lighting presence/edit test |
| `genre_affinity_v1` off ⇒ six features context-only, ordering unchanged | genre on/off equivalence test |
| Identical snapshots ⇒ identical plans and evidence | determinism/byte-replay test |

## 16. Risks / notes

- **No orchestrator yet:** the context-assembly helper is test-support scaffolding, not a
  shipped adapter; P4/P5/P7 own real wiring. Keeping it in tests avoids leaking a
  half-built adapter into the backend.
- **Manifest schema extension:** structured hyperparameter `kind`s are new for this package
  family; P6 owns them and the package is not loaded by the trigger `package_registry`
  (different `compatible_scenario_types`), so no trigger-side validation conflict.
- **Local tooling:** Docker/uv are unreachable in the authoring shell; tests run on
  Anaconda 3.12 + pydantic 2.8.2. A container `uv run pytest` remains the authoritative gate
  when available.
- **Age/era + genre maps are loose, low-weight hypotheses** by design; child *safety* is
  enforced by the explicit-content eligibility gate, never by a soft genre score.
