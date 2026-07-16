# Transparent Music Content-Selector (`aica_transparent_content_selector_v1`)

A standalone `python_module` package that turns a driving/mood context and an eligible
song catalog into a **transparent, ranked music plan**. Every ranked item carries the
two-axis (arousal / valence) traits, per-feature contributions, and bilingual reasons that
produced its score — there is **no opaque aggregate plan score**.

- **Kind**: `python_module` (single `algorithm.py` + `package.json` + this README).
- **Entrypoint**: `evaluate(context: dict) -> dict`.
- **Pure**: no file/network I/O, no clock, no randomness, **no `aica_api` import**. Same
  input → same output.
- **Contracts**: consumes the frozen P0.5 `SelectorInput`; returns the frozen `CompletePlan`
  (`proposal_contracts/schema/*.json`, `aica_api.models.proposal`).

## Provenance

The scoring math is authoritative in **`docs/master/aica_transparent_content_proposal_algorithm.md`**:

| Area | Section |
|---|---|
| Trait composition (arousal/valence/humming/full-karaoke ease) | §4 (Table 1) |
| Context response matrix (α/β, directional signs) | §5.2 (Table 2) |
| Directional hypothesis (`soothe_destress` / `keep_alert`) | §5.6 |
| Age/era affinity default table | §5.5 |
| Genre affinity (`genre_affinity_v1` opt-in) | §5.7 |
| Hierarchy weights, purpose multipliers, normalization | §6 |
| Eligibility & typed rejection | §7 |
| Missing-field `missing_neutral` rule | §8 |
| Feature disposition contract (§9 / Appendix A.2) | §9 |
| Worked example (`item_fit = +0.187`) | §10 |

Design record: `docs/superpowers/specs/2026-07-16-proposal-p6-content-selector-design.md`.
Spec / plan / tasks: `specs/011-p6-content-selector/`.

## `evaluate(context)` contract

`context` is a `SelectorInput`-shaped dict (see `specs/011-p6-content-selector/data-model.md §1`).
Notable keys: `selected_service_id`, `trigger_purpose`, `lifecycle_stage`,
`feature_snapshot` (`catalog`, `situation`, `preference`, `history`, `current_scene`,
`genre_affinity_v1`), `eligible_candidates`, `excluded_candidates`,
`enabled_feature_extensions`, `hyperparameters`, `parameters`, `feature_dispositions`,
`simulation_time`, `catalog_version`.

The harness (and the future runtime adapter) inject file-sourced inputs — the catalog, the
resolved hyperparameters (manifest defaults ⊕ overrides), and the frozen disposition
registry. **The package itself never opens a file.**

### Outcomes (`decision_type`)

| Condition | `decision_type` |
|---|---|
| `selected_service_id` missing / invalid control fields | `invalid_request` |
| service is not one of the three music services | `unsupported_recipe` |
| catalog/song schema invalid, unknown candidate ID, or trait-required audio field missing | `invalid_catalog` |
| weights/matrices/versions invalid, or zero active-weight denominator | `invalid_configuration` |
| `full_karaoke` while `motion_state == "driving"` | `full_karaoke_requires_stopped` |
| every candidate excluded by eligibility | `no_proposal` |
| fewer eligible songs than `plan_item_count` | `insufficient_eligible_items` |
| otherwise | `complete_plan` |

### `complete_plan` guarantees

1. `ordered_items` length == `plan_item_count`, sorted `(item_fit desc, track_id asc)`.
2. `item_fit ∈ [−1, +1]`; `trait_values` + one `feature_contributions` row per scored feature;
   bilingual `rationale` (JA-first `"<ja> / <en>"` strings).
3. Every ordered `item_id` exists in the input `catalog`.
4. **No** `plan_score` / `aggregate_score` / `plan_fit` anywhere.
5. `mode` matches the service (humming → `fixed_segment_sec`; full-karaoke → `stopped_only`).
6. `excluded_items` lists platform + hard-eligibility exclusions with reason codes.
7. `algorithm_provenance.feature_dispositions` + `active_features` / `context_only_features`
   / `missing_features` account for **every** row of `content_feature_dispositions.v1.json`
   (active / context_only / missing_neutral) — none silently dropped.
8. `algorithm_provenance` carries versions, active vs context-only lists, normalized weights,
   sort/tie-break rule, duration basis, and ordered Track IDs.

## Hyperparameter reference (`package.json → hyperparameters`)

Each is declared with a structured `kind` and a fully-resolved default; a missing key is a
configuration bug (`invalid_configuration`), never a silent default.

| Key | kind | Source |
|---|---|---|
| `trait_composition_matrix` | matrix | Table 1 (§4) — per-trait audio-field weights |
| `context_response_matrix` | matrix | Table 2 (§5.2) — six features → `{alpha, beta, directional}` |
| `content_category_weights` | table | Situation .55 / Preference .30 / History .15 |
| `hierarchy_weights` | table | §6.1 category→subgroup→leaf `{share, mask, feature_id, …}` |
| `purpose_multipliers` | table | §6.2 subgroup × purpose |
| `genre_affinity_maps` | map | §5.7 tag→genre maps + Tier-2 usage curve + vocabulary |
| `age_era_affinity` | table | §5.5 `[age_band][era] → weight` |
| `norm_bounds` | table | tempo / loudness / ease normalization bounds |
| `history_curves` | table | played / skip / changed / usage / acceptance / recovery curves |
| `lighting_lookup` | map | valence → lighting cue (presentation only) |
| `plan_item_count` | numeric | `5` |
| `fixed_humming_segment_sec` | numeric | `30` |
| `directional_hypothesis` | enum | `soothe_destress` (default) / `keep_alert` |
| `skip_exclusion_window_sec` | numeric | recent-skip exclusion window |
| `parameter_set_version` | string | bumped on any table edit |
| `formula_version` | string | trait/response formula version |

`parameters` carries the `recipe_registry` (service → `mode_kind` + lighting flag) and
`lighting_compatible_services`.

## Running the tests

The package is exercised through the proposal contract suite (the harness supplies the
catalog, manifest, and disposition registry):

```bash
# from repo root, via the container venv
docker compose exec api uv run pytest tests/proposal/ -k content_selector

# or locally
cd app/api && uv run pytest tests/proposal/ -k content_selector
```

Test coverage: traits, response weights, scoring (§10 worked block `+0.187`), CompletePlan
contract, context reversals, eligibility/safety, disposition provenance, genre extension,
and determinism.
