# Contract — `evaluate(context: dict) -> dict` (Transparent Content Selector)

The package exposes exactly one public entrypoint, following the repo `python_module`
convention. This is the P6 interface contract; the *data shapes* are the frozen P0.5
`SelectorInput` / `CompletePlan` (see `proposal_contracts/schema/*.json` and
`aica_api.models.proposal`).

## Signature

```python
def evaluate(context: dict) -> dict: ...
```

- **Pure**: no file/network I/O, no clock, no randomness. Same input → same output.
- **No `aica_api` import**: works on plain dicts only.
- Input `context` keys: see data-model.md §1. Output: a `CompletePlan`-shaped dict.

## Input preconditions (else typed error, never exception-as-plan)

| Condition | Outcome (`decision_type`) |
|---|---|
| `selected_service_id` is `None`/missing, or lifecycle/purpose/count invalid | `invalid_request` |
| `selected_service_id` is a valid service but not one of the three music services | `unsupported_recipe` |
| a music service with no registered recipe (should not occur in V1) | `unsupported_service` |
| catalog/song schema invalid, or a candidate ID not in `catalog`, or trait-required audio field missing | `invalid_catalog` |
| weights/matrices/formulas/versions invalid, or zero active-weight denominator | `invalid_configuration` |
| `full_karaoke` while `motion_state == "driving"` | `full_karaoke_requires_stopped` |
| every candidate excluded by eligibility | `no_proposal` |
| fewer eligible songs than `plan_item_count` | `insufficient_eligible_items` |
| otherwise | `complete_plan` |

## Output guarantees (`complete_plan`)

1. `ordered_items` length == `plan_item_count`, sorted `(item_fit desc, track_id asc)`.
2. Every `ordered_items[*].item_fit ∈ [−1, +1]`; every `trait_values` present; every scored
   feature has one `feature_contributions` row; `rationale` is bilingual.
3. Every ordered `item_id` exists in the input `catalog` and was in `eligible_candidates`.
4. **No** `plan_score` / `aggregate_score` / `plan_fit` anywhere (asserted against the frozen
   `content_output.schema.json` + a field-name scan).
5. `mode` matches `selected_service_id`; humming carries `driving_lyrics == false` +
   `fixed_segment_sec`; full-karaoke carries `stopped_only == true`.
6. `excluded_items` lists platform + hard-eligibility exclusions with reason codes.
7. `unused_available_features` + `missing_features` account for every non-scored contract row
   (context_only / available_but_not_used / missing_neutral) — none silently dropped.
8. `algorithm_provenance` carries dataset/algorithm/schema/parameter versions, active vs
   context-only feature lists, matrix versions, normalized weights, sort/tie-break, duration
   basis, and ordered Track IDs.

## Determinism contract

Identical `context` + versions → semantically identical output within `1e-12`; same-runtime
canonical serialization is byte-equivalent. Genre extension **off** ⇒ byte-identical ordering
to the Spotify-only baseline.

## Manifest (`package.json`) contract

Declares `id`, `version`, `label {ja,en}`, `algorithm.type = "python_module"`,
`algorithm.entrypoint = "algorithm.py"`, `compatible_scenario_types` (proposal/content — kept
distinct from the trigger `uc01_fatigue` so the trigger registry never loads it), and the
structured `hyperparameters` (data-model.md §3) + `parameters`. The manifest defaults are the
frozen §6 weights / Table 1 / Table 2 / §5.7 maps / §5.5 age-era table / bounds / curves.
