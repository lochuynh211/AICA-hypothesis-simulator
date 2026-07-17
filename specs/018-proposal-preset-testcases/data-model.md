# Data Model: Proposal Preset Test-Cases

Entities added/extended by this feature. Backend pydantic models live in `app/api/aica_api/models/proposal/preset.py`; the committed JSON is validated against `proposal_contracts/schema/p1_preset.schema.json`.

---

## Preset

The committed, read-only test-case artifact. One file per preset: `proposal_contracts/presets/preset-<slug>.json`.

| Field | Type | Req | Notes |
|---|---|---|---|
| `preset_id` | string (`preset-<slug>`) | ✅ | Unique; matches filename stem; `^preset-[a-z0-9-]+$`. |
| `label` | `{ ja: string, en: string }` | ✅ | Short bilingual name for the selector. |
| `brief` | `{ ja: string, en: string }` | ✅ | One-paragraph bilingual "what & why", shown on selection. |
| `family` | enum | ✅ | One of the 9 families (see enum below). |
| `contrast_with` | string \| null | ✅(nullable) | `preset_id` of the partner in a contrast pair, else null. Must be symmetric and reference an existing preset. |
| `world` | `SeedWorld` | ✅ | Full world: `control_inputs` + `situation` + `driver_profile` + `catalog_ref`. Every `World` field initialized (generator completes from model defaults). |
| `algorithm_config_overrides` | `AlgorithmConfigOverrides` \| null | ✅(nullable) | Isolated per-preset config deltas; null when none. |
| `expectation` | `ExpectationContract` | ✅ | Machine-checkable claim (below). |
| `schema_version` | string | ✅ | `"1.0.0"`. |

**Validation rules**
- `additionalProperties: false` at every object level.
- `world` must pass the existing `SeedWorld`/`World` validation (reused, not redefined); `control_inputs.motion_state == situation.motion_state`.
- Every catalog id referenced (`driver_profile.oshi_id`, history/rate map keys, `expectation.expected_top.track_id`) MUST resolve in the frozen catalog — enforced by the generator and re-checked by `test_preset_store.py`.
- `contrast_with`, if set, MUST name a preset whose `contrast_with` points back (symmetric pair) and which varies exactly one lens (asserted structurally in the harness where feasible, else by review note).
- Malformed/invalid preset ⇒ load rejected with a visible error (never silently skipped into a degraded proposal).

**`family` enum**: `mood_coherence` · `directional_hypothesis` · `oshi_personalization` · `genre_usage` · `route_genre` · `era_age` · `passenger_genre` · `singability_service` · `history_mechanics` · `baseline` · `combo`.
*(11 values; "9 families + baseline control + combo" per the design.)*

---

## ExpectationContract

The documented claim the verification harness asserts against the real algorithm outputs.

| Field | Type | Req | Notes |
|---|---|---|---|
| `hypothesis` | string | ✅ | Plain-language statement of what this preset demonstrates. |
| `expected_top` | `ExpectedTop` | ✅ | The intended #1 content candidate. |
| `top_fit_min` | number `[-1,1]` | ✅ | Per-preset floor for the top content raw score. Strong-fit ≥0.40; cold-start declares its low ceiling; weak-lens declares honestly. |
| `gradient` | enum | ✅ | `arousal_up_implies_fit_up` · `arousal_down_implies_fit_up` · `none`. Direction the ranked set should trend. |
| `should_rank_below` | `ExpectedTop[]` | ⬚ | Optional characteristics/tracks that must rank below the top. |
| `expected_service` | `{ top_should_be_in: ServiceId[] }` | ✅ | Allowed set for the #1 service candidate. |
| `override_required` | bool | ✅ | True if the preset needed an `algorithm_config_overrides` to make its contrast legible (disclosed in report + brief). |

**`ExpectedTop`** (a predicate on the top candidate; at least one field set):
| Field | Type | Notes |
|---|---|---|
| `track_id` | string \| null | Exact expected top track (pinned cases). |
| `genre` | string \| null | Expected top genre (e.g. `j-rock`). |
| `arousal_band` | enum \| null | `high` · `mid` · `low`. |
| `must_be_oshi` | bool | If true, the top track's artist == `driver_profile.oshi_id`. |

---

## AlgorithmConfigOverrides

Isolated per-preset deltas merged over the package defaults at dispatch (`merge_algorithm_config`). Null when unused.

| Field | Type | Notes |
|---|---|---|
| `content` | object \| null | Partial content-selector `hyperparameters`/`parameters` deltas (e.g. `directional_hypothesis`, a `hierarchy_weights.Preference.upro_oshi.age.share` bump, `norm_bounds`). Deep-merged. |
| `service` | object \| null | Partial service-selector deltas (rare; e.g. a `response_coefficient_overrides` cell). Deep-merged. |

**Validation**: keys must be recognized config keys for the target selector; values must satisfy the selector's own validation (out-of-range rejected as `invalid_configuration`, mirroring existing behavior). Overrides never mutate `package.json`; the merge operates on a fresh copy per dispatch.

---

## PresetSummary (API list shape)

Lightweight projection returned by `GET /api/proposal/presets` (avoids shipping full worlds in the list).

| Field | Type | Notes |
|---|---|---|
| `preset_id` | string | |
| `label` | `{ja,en}` | |
| `brief` | `{ja,en}` | For the on-selection blurb without a second fetch. |
| `family` | enum | For optional grouping in the selector. |
| `contrast_with` | string \| null | |
| `hypothesis` | string | From `expectation.hypothesis`, for the blurb. |

`GET /api/proposal/presets/{id}` returns the full `Preset`.

---

## Run provenance extension

The existing run setup snapshot (`SetupSnapshot.origin`, per `proposal_run.py`) gains an optional `origin_preset_id`, set when a run was launched from a preset selection (alongside the existing `origin_seed_id`/`origin_profile_id`). Backward compatible (nullable). Recorded in the append-only run log; if the user manually edited fields after selecting a preset, the snapshot still records the preset origin plus the existing edited-fields evidence (honest provenance).

---

## Frontend state (proposalStore) additions

| Addition | Notes |
|---|---|
| `presets: PresetSummary[]` | Cached list (like `seeds`/`profiles`). |
| `selectedPresetId: string \| null` | Currently selected preset. |
| `SET_PRESETS` action | Populate the cache. |
| `LOAD_PRESET` action | Atomic: set `world.situation` + `world.driver_profile` + `control_inputs`, `selectedSeedId`/`selectedProfileId`/`selectedPresetId`, and stash `algorithm_config_overrides` for dispatch. |

---

## Retune parameters (not an entity, but the changed data)

`packages/aica_transparent_content_selector_v1/package.json` → `hyperparameters[norm_bounds]`: `loudness_min`, `loudness_range` recalibrated to the frozen catalog. Global; golden-pinned by `test_norm_bounds_retune.py`. Directional `context_response_matrix` unchanged.
