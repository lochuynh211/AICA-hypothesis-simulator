# Phase 1 Data Model — P0.5 Content Contract & Song-Schema Freeze

Backend Pydantic models in `app/api/aica_api/models/proposal/`. Authoritative field sources: spec §5.3/§5.4/§8/§9, transparent content algorithm doc §5/§6/§13/§14, synthetic-music-data spec §4–6/§13/§21.1. Strictness per research D3.

## Enums (`enums.py`)

| Enum | Values |
|---|---|
| `TriggerPurpose` | `rest_recommended`, `inattentive_driving_prevention_recovery`, `route_music`, `child_passenger_experience` |
| `LifecycleStage` | `before_rest_until_stop`, `during_rest_stopped`, `after_rest_before_restart`, `active_driving_content` |
| `ServiceId` | 14 catalog IDs (spec §7.1–7.2): `music_playlist`, `humming_karaoke`, `call_response_driving`, `quiz`, `ranking_creation`, `radio_style`, `conversation_audio`, `live_viewing`, `stretch_video`, `full_karaoke`, `call_response_stopped`, `oshi_reexperience`, `relaxation_multisensory`, `linked_video_recommendation` |
| `RestSpotType` | `sa_pa`, `convenience_store`, `parking`, `oshi_spot`, `other`, `unknown` |
| `ContentDecisionType` | `complete_plan`, `no_proposal`, `insufficient_eligible_items`, `unsupported_service`, `unsupported_recipe`, `invalid_request`, `invalid_catalog`, `invalid_configuration`, `full_karaoke_requires_stopped` |
| `FeatureDisposition` | `scored`, `context_only`, `available_but_not_used` |
| `FeatureOriginProvenance` | `cdc_su_baseline`, `normalized_cdc_su_concept`, `proposed_addition` |
| `ResponseCoefficientProvenance` | `cdc_su_explicit`, `service_definition`, `normalized_context_hypothesis` |
| `GenreLiteral` | 12-term vocabulary: `j-pop`, `j-rock`, `city pop`, `anime`, `vocaloid`, `enka`, `children's music`, `classical`, `jazz`, `ambient`, `electronic`, `japanese folk` |
| `UsageLevel` | `never`, `low`, `med`, `high` |

Module constants: `CONTRACT_VERSION = "1.0.0"`, `SCHEMA_VERSION = "1.0.0"`, `GENRE_EXTENSION_VERSION = "genre_affinity_v1"`.

## Common selector input (`selector_input.py`)

**`FeatureProvenanceEntry`**: `feature_origin: FeatureOriginProvenance`, `source_reference: str`.

**`CandidateRef`**: `candidate_id: ServiceId | str` (service ID for service selector; Track ID for content).

**`ExcludedCandidate`**: `candidate_id: str`, `platform_reason: str` (a platform/eligibility reason, kept distinct from algorithm rationale).

**`SelectorInput`** (spec §5.3):
| Field | Type | Notes |
|---|---|---|
| `contract_version` | `str` | equals `CONTRACT_VERSION` |
| `opportunity_id` | `str` | |
| `simulation_time` | `str \| int` | |
| `trigger_purpose` | `TriggerPurpose` | control input |
| `lifecycle_stage` | `LifecycleStage` | control input |
| `allowed_service_ids` | `list[ServiceId]` | non-empty (validator) |
| `feature_snapshot` | `dict[str, Any]` | complete independent §8 or §9 snapshot; validated structurally, not field-by-field |
| `feature_provenance` | `dict[str, FeatureProvenanceEntry]` | |
| `enabled_feature_extensions` | `list[str]` | e.g. `["genre_affinity_v1"]` |
| `selected_service_id` | `ServiceId \| None` | content selector only |
| `eligible_candidates` | `list[CandidateRef]` | |
| `excluded_candidates` | `list[ExcludedCandidate]` | |
| `parameters` | `dict` | |
| `hyperparameters` | `dict` | |
| `package_runtime_state` | `dict` | |
| `catalog_version` | `str` | |
| `run_seed` | `str` | |

**Validators**: (1) `allowed_service_ids` non-empty; (2) purpose/stage compatibility — the three rest stages (`before_rest_until_stop`/`during_rest_stopped`/`after_rest_before_restart`) only with `rest_recommended`; `active_driving_content` only with `inattentive_driving_prevention_recovery`/`route_music`/`child_passenger_experience`.

## Content-selector output (`content_output.py`)

**`SongTraitValues`**: `arousal: float`, `valence: float`, `humming_ease: float`, `full_karaoke_ease: float`, `arousal_signed: float` (`A_s`), `valence_signed: float` (`V_s`). (All decision-time values; never stored as catalog metadata.)

**`ItemFeatureContribution`** (content-algo §14): `feature_id: str`, `e_i: float`, `a_i: float`, `alpha: float | None`, `beta: float | None`, `exact_match: bool | None`, `response_provenance: ResponseCoefficientProvenance | None`, `r_i: float`, `base_weight: float`, `purpose_multiplier: float`, `mask: int`, `effective_weight: float`, `contribution: float`, `formula_version: str`.

**`OrderedItem`**: `position: int`, `item_id: str`, `item_fit: float | None` (null for LLM), `trait_values: SongTraitValues | None`, `feature_contributions: list[ItemFeatureContribution]` (empty for LLM), `rationale: list[str]`.

**`PlanMode`**: `service_id: ServiceId`, `mode_kind: Literal["playlist","humming","full_karaoke"]`, `chorus_only: bool | None`, `guide_vocal: bool | None`, `driving_lyrics: bool | None`, `fixed_segment_sec: int | None`, `stopped_only: bool | None`, `simulated_queue: bool | None`. (Humming: chorus-only, guide-vocal, no driving lyrics, fixed segment; full karaoke: stopped-only, simulated queue.)

**`LightingConfiguration`**: `enabled: bool`, `cue_basis: str | None` (e.g. `valence`), `notes: str | None`. Present only for lighting-compatible services; never affects `item_fit`.

**`ExcludedItem`**: `item_id: str`, `reason_codes: list[str]`.

**`CompletePlan`** (spec §5.4 + content-algo §14):
| Field | Type | Notes |
|---|---|---|
| `decision_type` | `ContentDecisionType` | |
| `selected_service_id` | `ServiceId` | |
| `requested_item_count` | `int` | default 5 |
| `returned_item_count` | `int` | |
| `ordered_items` | `list[OrderedItem]` | |
| `mode` | `PlanMode` | |
| `expected_duration_sec` | `int` | |
| `lighting_configuration` | `LightingConfiguration \| None` | |
| `approval_policy` | `str` | value semantics owned by P4 journey engine |
| `completion_rule` | `str` | value semantics owned by P4 |
| `next_transition_policy` | `str` | value semantics owned by P4 |
| `excluded_items` | `list[ExcludedItem]` | |
| `unused_available_features` | `list[str]` | |
| `missing_features` | `list[str]` | |
| `algorithm_provenance` | `dict` | catalog/algorithm/schema/parameter versions |

**Invariant (test-enforced)**: no field named `plan_score`/`aggregate_score`/`plan_fit` anywhere in `CompletePlan` or its nested models.

## Song schema (`song_schema.py`)

**`SpotifyTrack`** (data-spec §4.1 full inventory) with sub-objects `Album`, `ArtistRef`, `ExternalIds`, `ExternalUrls`, `Image`, `Restrictions`, `LinkedFrom`. `model_config`: `extra="ignore"` (lenient inside). Field-level per §4.1/§4.3.

**`SpotifyAudioFeatures`** (data-spec §5.1, 18 fields). `extra="ignore"`. Ranges per §5.3: `[0,1]` fields finite & in range; `key ∈ {-1,0..11}`; `mode ∈ {0,1}`; `tempo>0`; finite `loudness`; `time_signature ∈ 3..7`; `type == "audio_features"`.

**`SimulationFlags`**: `humming_karaoke_available: Literal[0,1] = 1`, `full_karaoke_available: Literal[0,1] = 1`. `model_config`: `extra="forbid"`.

**`Song`** (wrapper): `spotify_track: SpotifyTrack`, `spotify_audio_features: SpotifyAudioFeatures`, `simulation_flags: SimulationFlags`. `model_config`: `extra="forbid"` (namespace-strict). **Cross-object validator**: `track.id == audio_features.id`, `track.uri == audio_features.uri`, `track.duration_ms == audio_features.duration_ms`. **Synthetic-identity validator**: every ID field starts with `synthetic-`; every URL host ends with `.invalid`; no URL host is `api.spotify.com`/`open.spotify.com`.

## Genre extension (`genre_extension.py`)

**`GenreAffinityV1`**: `artist_genres: dict[str, list[GenreLiteral]]`, `usage_by_genre: dict[GenreLiteral, UsageLevel] | None`, `scene_genre_usage: dict[str, dict[GenreLiteral, UsageLevel]] | None`. `model_config`: `extra="forbid"`. Validators: vocabulary membership (enforced by `GenreLiteral`); no key overwrites the `spotify_track`/`spotify_audio_features`/`simulation_flags` namespaces (the extension is a sibling namespace — a validator/test asserts it introduces none of those keys).

## Feature-disposition registry (`dispositions.py`)

**`DispositionEntry`**: `feature_id: str`, `category: str`, `subcategory: str`, `feature_name: str`, `disposition: FeatureDisposition`, `feature_origin: FeatureOriginProvenance`, `response_provenance: ResponseCoefficientProvenance | None`, `genre_gated: bool`, `enum_responses: dict[str, str] | None` (nested per-enum response detail for scored categoricals), `source_reference: str`, `rationale: str`.

**`CONTENT_FEATURE_DISPOSITIONS: list[DispositionEntry]`** — one entry per Appendix A.2 content field. Population rules (design §6.1):
- 15 `scored` (Situation 7, Preference 6, History 2); 6 `genre_gated=True` (route, destination, child, hobbies, content-tag/genre usage, scene/genre usage) — `scored` when the extension is on, treated `context_only` when off.
- Oshi registered / oshi mode → `context_only` (gates).
- Schedule fields, novelty/unused-content, cancelled plans, multiple-passengers, oshi type/tags, and all `Additional proposed` rows → `context_only` or `available_but_not_used`. `oshi_id` → `scored`.
- Every A.2 field present exactly once; none dropped.
- `registry_version: str = "1"`.

## State transitions

None. All entities are immutable frozen contract shapes; no lifecycle/state machine in this milestone (journey state is P4).
