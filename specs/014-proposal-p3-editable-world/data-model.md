# Phase 1 Data Model — P3 Editable World, Driver Profiles & Contrast

All new models live in the isolated `app/api/aica_api/models/proposal/` subpackage (no import of the
trigger `aica_api.models`; enforced by the import-guard test). Enums reuse `models/proposal/enums.py`.
Generated JSON schemas are exported to `proposal_contracts/schema/` via `export_schema` (never hand-edited).

## Editing/UI grouping vs projection grouping

- **Editing/UI grouping** (owner's model, what the ① World panel shows): `ControlInputs` + `Situation` +
  `DriverProfile`. `DriverProfile` carries preference + history + the profile-side "additional proposed"
  fields + the opt-in genre extension.
- **Projection grouping** (what the selector consumes): the P0.5 fixture shape —
  `situation` / `preference` / `history` / `additional_proposed` (+ `genre_affinity_v1`) + `catalog` +
  `_service_id`. `World.project()` is the deterministic mapping between the two.

## Entities

### ControlInputs
| Field | Type | Rules |
|---|---|---|
| `trigger_purpose` | `TriggerPurpose` enum | required |
| `lifecycle_stage` | `LifecycleStage` enum | required; purpose/stage compatible (shared rule) |
| `motion_state` | `MotionState` enum | required |
| `matrix_version` | str | required; resolvable matrix version |
| `dataset_id` | str | required; must resolve in the dataset registry |

### Situation (the momentary scene)
`drowsiness_level` (int 0–100), `fatigue_level` (0–100), `traffic_state` (enum), `road_type` (enum),
`night_state` (enum), `monotony_level` (0–100), `route_tags` (list[str]), `destination_tags` (list[str]),
`child_present` (bool), `multiple_passengers` (bool), `motion_state` (enum, mirrors control),
`estimated_min_until_rest_spot` (int ≥0 | None), `rest_spot_type` (enum), `active_service` (ServiceId|None),
`recent_service_rejections` (list of timestamped service-id).
*Provenance*: each field tagged from the disposition registry; the "additional proposed" scene fields carry
the `proposed_addition` label.

### DriverProfile
Owns preference + history + profile-side additional-proposed fields + genre extension.
- **Preference**: `oshi_registered` (bool), `oshi_mode` (enum on/off), `oshi_id` (catalog artist id|None),
  `oshi_type` (enum|None), `oshi_tags` (list[str]), `age_band` (enum), `gender` (enum), `hobby_interest_tags`
  (list[str]), `service_usage_level` (map svc→UsageLevel), `service_recency_state` (map svc→recency),
  `scene_service_usage_level` (nested map), `catalog_item_usage_level` (map item→UsageLevel),
  `catalog_item_recency_state` (map), `content_tag_usage_level` (map), `content_tag_recency_state` (map),
  `scene_content_tag_usage_level` (nested map), `played_items`/`skipped_items`/`changed_from_items`/
  `completed_items`/`manually_selected_items`/`repeated_items` (timestamped item-id lists),
  `cancelled_content_plans` (list).
- **History**: `service_proposal_acceptance_rate` (map svc→0–100), `service_recovery_rate` (map),
  `service_proposal_acceptance_confidence`/`service_recovery_confidence` (map→0–1),
  `content_proposal_acceptance_rate`/`content_recovery_rate` (map key→0–100),
  `content_proposal_acceptance_confidence`/`content_recovery_confidence` (map→0–1),
  `scheduled_event_type`/`scheduled_event_timing` (enum), `scheduled_event_tags` (list[str]).
- **Genre extension**: `genre_affinity_v1_enabled` (bool, default False); when enabled,
  `usage_by_genre` (map GenreLiteral→UsageLevel), `scene_genre_usage` (nested). Toggling off retains values
  (carried context-only).
*Validation*: enums/ranges structural (Pydantic); catalog references (`oshi_id`, item-history keys)
validated against the world's catalog on load via `mdg.worlds.validate_world_references`.

### DriverProfileRecord (store entity)
| Field | Type | Rules |
|---|---|---|
| `profile_id` | str | required, unique |
| `label` | `{ja,en}` | required |
| `builtin` | bool | built-in vs user-saved |
| `profile` | `DriverProfile` | required, validated |

### CatalogRef / DatasetProvenance (read-only)
`dataset_id`, `dataset_version` (schema/track/audio-feature versions), `dataset_hash`, `tier`,
`synthetic_only`, `provenance_note`. Loaded from the committed `dataset_manifest.json`. **Immutable**.

### World
`control_inputs: ControlInputs`, `situation: Situation`, `driver_profile: DriverProfile`,
`catalog_ref: CatalogRef`.
- **`project() -> (feature_snapshot: dict, feature_provenance: dict[str, FeatureProvenanceEntry])`** —
  emits `{situation, preference, history, additional_proposed, genre_affinity_v1?, catalog, _service_id?}`
  matching the P0.5 fixture/selector shape; provenance per field from the disposition registry.
  Deterministic (golden-tested; cross-checked against the real selector).

### SeedWorld
`seed_id`, `label {ja,en}`, `description {ja,en}`, `world: World`. Complete (every field initialized).
Loaded from `proposal_contracts/seeds/`. Round-trip stable (golden test).

### WorldClone
`clone_id`, `base_seed_id`, `overrides: list[FieldOverride{path,value}]`, `world: World` (base + overrides),
`diff: list[FieldDiff{path,before,after}]` (computed deterministically). References validated.

### SetupSnapshot
`origin` (`seed_id` | `clone_id` | `profile_id` refs), `matrix_version`, `dataset_id`, `dataset_hash`,
`service_package_id` + `service_contract_version`, `content_package_id` + `content_contract_version`,
`service_parameter_set_version`, `content_parameter_set_version`, `feature_provenance` map. Embedded into
`ProposalRunLog` replacing the opaque `world_snapshot`.

## Relationships

```
SeedWorld ─embeds→ World ─{control_inputs, situation, driver_profile, catalog_ref}
WorldClone ─base_seed_id→ SeedWorld ; ─embeds→ World ; ─computes→ diff
DriverProfileRecord ─embeds→ DriverProfile  (loadable into any World)
World.catalog_ref ─dataset_id→ Dataset(frozen, read-only)
World.project() → feature_snapshot → (mock service selector | REAL content selector)
Run ─freezes→ SetupSnapshot ─references→ {seed/clone/profile, dataset, algorithms, param-sets}
```

## Validation rules (surfaced with field-level messages)

1. Enum membership + numeric ranges (Pydantic) on every world/profile field.
2. Purpose/stage compatibility (shared rule) on ControlInputs.
3. Catalog reference existence (`dataset_id`, `oshi_id`, item-history/played/skipped keys, `active_service`)
   against the loaded catalog — `mdg.worlds.validate_world_references`.
4. Dataset load: every song validates against `Song`; else the dataset is quarantined (errors list).
5. Clone diff: exactly the overridden path(s) differ; deterministic.

## State / lifecycle

Worlds and profiles are edited only at setup time (Constitution: setup-time mutation only). A run freezes
the world + SetupSnapshot; reopening renders from the log without recompute. Catalog is immutable at
runtime.
