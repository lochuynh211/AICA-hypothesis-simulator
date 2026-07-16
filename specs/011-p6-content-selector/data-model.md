# Phase 1 Data Model — P6 Transparent Content-Selector

P6 introduces **no new frozen contract types** — the interface types (`SelectorInput`,
`CompletePlan` and nested, `Song`, `GenreAffinityV1`, disposition registry, enums) are frozen
in P0.5 (`aica_api.models.proposal`, `proposal_contracts/schema`). This document specifies
(a) the runtime `context` dict the package consumes, (b) the structured hyperparameter tables,
(c) the intermediate computed values, and (d) how they map onto the frozen `CompletePlan`.

## 1. `evaluate(context)` input — the runtime context dict

The package receives one plain dict (assembled by the test harness in P6, by the orchestrator
in later milestones). Keys:

| Key | Type | Source | Notes |
|---|---|---|---|
| `contract_version` | str | SelectorInput | must match the package's supported version |
| `opportunity_id` | str | SelectorInput | echoed into evidence |
| `simulation_time` | str/int | SelectorInput | control input, not scored |
| `trigger_purpose` | enum | SelectorInput | selects the §6.2 purpose-multiplier column |
| `lifecycle_stage` | enum | SelectorInput | control input; compatibility already validated by the model |
| `allowed_service_ids` | list | SelectorInput | non-empty |
| `selected_service_id` | enum/None | SelectorInput | **gating** (R4): None → `invalid_request`; non-music → `unsupported_recipe` |
| `feature_snapshot` | dict | SelectorInput | see §2 (includes `catalog`, driver/env, history, oshi, optional `genre_affinity_v1`) |
| `feature_provenance` | dict | SelectorInput | per-feature origin provenance, echoed into evidence |
| `enabled_feature_extensions` | list[str] | SelectorInput | `genre_affinity_v1` toggles the six genre leaves |
| `eligible_candidates` | list[{candidate_id}] | SelectorInput | Track IDs to rank; each MUST resolve in `catalog` |
| `excluded_candidates` | list[{candidate_id, platform_reason}] | SelectorInput | platform pre-exclusions, echoed as excluded_items |
| `parameters` | dict | manifest/params | structural params (recipe/eligibility policy IDs, etc.) |
| `hyperparameters` | dict | manifest ⊕ overrides | **fully resolved** (§3); read by direct `hp[key]` |
| `package_runtime_state` | dict | SelectorInput | unused in V1 content selection (stateless); passed through |
| `feature_dispositions` | list | frozen registry (harness-injected) | the `content_feature_dispositions.v1.json` entries; drives the full active/context_only/missing_neutral coverage in `algorithm_provenance` (package never opens the file) |
| `catalog_version` | str | SelectorInput | echoed into evidence |
| `run_seed` | str | SelectorInput | echoed; not used for randomness (none exists) |

## 2. `feature_snapshot` structure (numeric evidence form — R1)

```text
feature_snapshot = {
  "catalog": { "<track_id>": <Song record dict>, ... },   # R5 — injected by harness

  "situation": {
    "drowsiness_level": 0..100,       # /100 → evidence
    "fatigue_level":    0..100,       # /100
    "monotony_level":   0..100,       # /100
    "traffic_state":    "normal"|"congested",
    "road_type":        "highway"|"local"|"mountain"|"parking",
    "night_state":      "day"|"night",
    "motion_state":     "driving"|"stopped",
    "route_tags":       [str],        # genre‡ only
    "destination_tags": [str],        # genre‡ only
    "child_present":    bool,         # genre‡ + eligibility
    "multiple_passengers": bool       # context_only
  },

  "preference": {
    "oshi_registered": bool, "oshi_mode": "on"|"off", "oshi_id": str|null,
    "age_band": "teens"|"20s"|"30s"|"40s"|"50s"|"60plus",
    "hobby_interest_tags": [str],                       # genre‡
    "catalog_item_usage_level": { "<track_id>": "never"|"low"|"med"|"high" },
    "played_items":  [ {track_id, last_played_at} ],
    "skipped_items": [ {track_id, skipped_at} ],
    "changed_from_items": [ {track_id, changed_at} ],
    "usage_by_genre": {...}, "scene_genre_usage": {...}  # Tier-2 genre‡ (under extension)
    # ... plus all context_only / available_but_not_used rows carried verbatim
  },

  "history": {
    "content_proposal_acceptance_rate": { "<track_id>": 0..100 },
    "content_recovery_rate":            { "<track_id>": 0..100 },
    "scheduled_event_*": ...            # context_only
  },

  "current_scene": str,                # for scene_genre_usage lookup

  "genre_affinity_v1": { "artist_genres": {...}, "usage_by_genre": {...}, "scene_genre_usage": {...} }
}
```

History recency windows (played/skip/changed) and the skip-exclusion window are evaluated
against `simulation_time`. The exact per-row world field names track the frozen disposition
registry (`content_feature_dispositions.v1.json`).

## 3. Structured hyperparameters (package.json → `context["hyperparameters"]`) — R2

Fully-resolved nested structures (manifest defaults ⊕ overrides). Manifest declares each with
a structured `kind`:

| Key | kind | Shape / default source |
|---|---|---|
| `trait_composition_matrix` | matrix | content-algo Table 1 (§4.2) — per-trait audio-field weights (columns sum to 1) |
| `context_response_matrix` | matrix | Table 2 (§5.2) — six features → `{alpha, beta}` incl. the ⚠ signs |
| `hierarchy_weights` | table | §6.1 category→subgroup→leaf shares + masks |
| `purpose_multipliers` | table | §6.2 subgroup × purpose |
| `genre_affinity_maps` | map | §5.7 route/destination/child/hobby `tag→{genre:weight}` + Tier-2 usage curve + vocabulary |
| `age_era_affinity` | table | §5.5 default `[band][era] → weight` |
| `norm_bounds` | table | tempo(60,180), loudness(−60,0), tempo_ease(center 110, span 90), speech_ease(0.33,0.33), duration_ease(180000,180000) |
| `history_curves` | table | played/skip/changed/item-usage/acceptance/recovery mapping curves (§5.3) |
| `lighting_lookup` | map | valence→cue, presentation only |
| `plan_item_count` | numeric | 5 |
| `fixed_humming_segment_sec` | numeric | 30 |
| `directional_hypothesis` | enum | `soothe_destress` (default) / `keep_alert` |
| `skip_exclusion_window` | numeric | recent-skip exclusion window (seconds) |
| `content_category_weights` | table | Situation .55 / Preference .30 / History .15 |
| `parameter_set_version` | str | bumped on any table edit |
| `formula_version` | str | trait/response formula version |

A missing hyperparameter key is a configuration bug → surfaced (KeyError → `invalid_configuration`),
never a silent default.

## 4. Intermediate computed values (not persisted as catalog metadata)

- **Traits** per song: `arousal, valence, humming_ease, full_karaoke_ease ∈ [0,1]`; signed
  `A_s = 2·arousal − 1`, `V_s = 2·valence − 1`. Derived from Audio Features via
  `trait_composition_matrix` + `norm_bounds` (§4.4). Never read from stored fields.
- **Per feature**: `e_i` (evidence), `a_i` (response ∈ [−1,+1]), `r_i = e_i·a_i`,
  `base_weight`, `purpose_multiplier`, `mask ∈ {0,1}`, `effective_weight` (Σ=1), `contribution
  = effective_weight·r_i`.
- **item_fit** = `clamp(Σ contribution, −1, +1)`.

## 5. Output mapping → frozen `CompletePlan`

| CompletePlan field | Produced from |
|---|---|
| `decision_type` | outcome (`complete_plan` / typed error) |
| `selected_service_id` | echoed control input |
| `requested_item_count` / `returned_item_count` | `plan_item_count` / actual |
| `ordered_items[]` | sorted `(item_fit desc, track_id asc)`, first N |
| `ordered_items[].trait_values` | `SongTraitValues` (4 traits + signed) |
| `ordered_items[].feature_contributions[]` | one `ItemFeatureContribution` per scored feature |
| `ordered_items[].rationale` | bilingual reason lines (R6) — frozen contract `list[str]`, JA-first `"<ja> / <en>"` |
| `mode` | `PlanMode` (playlist / humming / full_karaoke fields) |
| `expected_duration_sec` | summed durations (playlist/full) or `count × fixed_segment` (humming) |
| `lighting_configuration` | present only for lighting-compatible services |
| `excluded_items[]` | platform excludes + §7 hard-eligibility excludes, with reason codes |
| `unused_available_features` / `missing_features` | disposition-driven context-only + missing_neutral lists |
| `algorithm_provenance` | versions/hashes, active vs context-only lists, matrix versions, normalized weights, sort/tie-break, duration basis, ordered Track IDs |

## 6. Validation rules (from FRs / content-algo §7–§8)

- Eligibility precedes scoring; excluded songs never reinstated by score.
- Missing scored field → `e=0, a=0`, weight retained, `missing_neutral`; present raw 0 valid.
- Missing trait-required audio field → song excluded `invalid_catalog`.
- Invalid value / identity mismatch / bad flag / unknown service / bad version / zero
  active-weight denominator → typed rejection, never neutral coercion.
- `|α|+β ≤ 1`, `β ≥ 0`, `|a_i| ≤ 1`, `Σ effective_weight = 1` — hold by construction.
- Determinism: identical inputs+versions → identical output (`1e-12`).
