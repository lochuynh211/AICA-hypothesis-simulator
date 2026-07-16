# Phase 1 Data Model: P2 — Synthetic Music Dataset Generation

All models are Pydantic v2 in `mdg/models.py` unless noted. The frozen **`Song`** model is imported unchanged from `aica_api.models.proposal.song_schema` (never redefined). Committed artifacts are JSON; gitignored generation state is JSON/YAML under `generation_workspace/`.

## Frozen (reused, not redefined)

- **Song** — `spotify_track` + `spotify_audio_features` + `simulation_flags` (P0.5). The mapper (S4) emits dicts that this model validates (S5). Invariants already enforced: `synthetic-` IDs, `.invalid` URLs, cross-object identity, numeric ranges, `time_signature ∈ {3..7}`, `key ∈ {-1,0..11}`. **P2 adds no field to Song.**
- **genre_affinity_v1 extension shape** — reused from `aica_api.models.proposal.genre_extension` for `artist_genres` writing/validation.

## Coverage (S0)

### CoverageCell
| Field | Type | Notes |
|---|---|---|
| `cell_id` | str | e.g. `E-hi_T-hi_P-balanced-vocal` |
| `energy_band` | `low\|medium\|high` | §10.2 ranges |
| `tempo_band` | `low\|medium\|high` | §10.2 ranges |
| `profile_family` | `balanced_vocal\|danceable_vocal\|speech_forward\|instrumental_leaning` | §10.2 |

### CoveragePlan
| Field | Type | Notes |
|---|---|---|
| `cells` | list[CoverageCell] | the 36 primary cells |
| `secondary_spreads` | dict | required bands for valence/mode/acousticness/humming_ease/full_karaoke_ease/genre |
| `quotas` | dict | 12 artists×3, ≥12 albums, ≥3 eras, ≥6 explicit, ≥4 negatives, `key:-1`≥1, duration/time-signature spread |
| `language_targets` | dict | `{ja: ~30, en: ~6, other: 0}` (FR-002) over the 36 |
| `era_targets` | dict | ≥3 eras; reported dimension |
| `contrast_pairs` | list[ContrastPairSpec] | the 12 one-variable pairs + expected directions |
| `remaining` | dict | ledger-relative: cells/quotas still unmet this loop |
| `enrichment_priority` | list[str] | shallow/covered cell_ids to deepen |

Validation: 36 cells present; language_targets sum ≈ 36; contrast_pairs ≥ 12.

## Candidate acquisition

### CandidateName (LLM S1b output item; also Strategy A shortlist item)
| Field | Type | Notes |
|---|---|---|
| `title` | str | real song title |
| `artist` | str | real primary-artist name |
| `release_year` | int | approximate year |
| `expected_language` | str | LLM guess (advisory only; real `languageCode` decides — FR-014) |
| `target_cell_id` | str | cell the LLM proposes filling |
| `why_fits_cell` | str | seed rationale — lineage only, never in a Song |
| `web_evidence` | list[str] | URLs/snippets — lineage only |

Validation (FR-005): **rejected** if it contains any `isrc` or audio-feature key.

### RawResponseCacheEntry (gitignored)
| Field | Type | Notes |
|---|---|---|
| `soundcharts_uuid` | str | key |
| `resolving_isrc` | str \| null | Strategy B |
| `payload` | dict | verbatim Soundcharts response |
| `fetched_in_loop` | int | provenance |

### LineageEntry (gitignored)
| Field | Type | Notes |
|---|---|---|
| `synthetic_id` | str | `synthetic-track-NNNN` |
| `soundcharts_uuid` | str | source |
| `real_name` | str | real title |
| `real_genre_text` | dict | `{root, sub[]}` |
| `resolved_isrc` | str \| null | Strategy B |
| `candidate_isrcs` | list[str] | all from MusicBrainz/Deezer |

Integrity: every `synthetic_id` in the catalog resolves to a lineage entry, else `lineage_integrity_failed`.

## Ledger

### LedgerEntry (gitignored, persistent, append-only)
| Field | Type | Notes |
|---|---|---|
| `keys` | dict | `{isrc?, soundcharts_uuid?, normalized_name}` (`nfkc(lower(strip(title)))|nfkc(lower(strip(artist)))`) |
| `outcome` | `accepted\|miss` | |
| `miss_reason` | enum \| null | `audio_unavailable\|isrc_not_in_soundcharts\|language_mismatch\|song_not_found_in_sources\|wrong_cell` |
| `cell` | str \| null | filled/targeted (accepted) |
| `loop` | int | which loop produced it |

Rules (FR-023/024): append-only; a known identity is never re-proposed/re-resolved/re-fetched; a known miss is never retried.

## Freeze

### DatasetManifest (committed)
| Field | Type | Notes |
|---|---|---|
| `dataset_id` | str | |
| `dataset_kind` | const `soundcharts_grounded_spotify_compatible` | (D3) |
| `schema_version` | str | matches P0.5 |
| `spotify_track_reference_version` | str | |
| `spotify_audio_features_reference_version` | str | |
| `generator_version` | str | `mdg.GENERATOR_VERSION` |
| `prompt_template_version` | str | |
| `validation_rules_version` | str | |
| `random_seed` | int | pins ID alloc + tie-breaks + fixture placement (FR-029) |
| `generated_at` | str | supplied externally (deterministic core forbids wall-clock) |
| `synthetic_only` | const `false` | (D3) |
| `dataset_hash` | str | hash over the frozen catalog |
| `provenance_note` | str | Soundcharts-grounded; real names + verbatim audio; licensing note |
| `candidate_source` | `isrc_resolved\|soundcharts_search` | provenance |
| `tier` | `smoke\|demonstration\|stress` | |
| `build_report_ref` | str | |

Validation (FR-019): the frozen catalog (Song list) contains no `recommended`/`best_for_world`/`target_rank`/score/label key anywhere.

## Worlds (S7)

### World
Driver/environment/passenger/oshi/history/service-lifecycle state per data-spec §13; all item/artist references are catalog IDs (`world_reference_failed` otherwise). Includes `genre_affinity_v1` world fields (`usage_by_genre`, `scene_genre_usage`) when the extension is toggled.

### ContrastPairSpec / ContrastPair
| Field | Type | Notes |
|---|---|---|
| `pair_id` | str | |
| `variable` | str | the single differing variable (e.g. `motion_state`, `drowsiness_level`) |
| `world_a_ref` / `world_b_ref` | str | |
| `expected_direction` | str | e.g. `reversal` (§15) |

Validation (FR-025): ≥15 base worlds; exactly the 12 required one-variable pairs differ in one variable each; produced only after freeze.

## Test cases (S8/S9)

### TestCase (committed)
| Field | Type | Notes |
|---|---|---|
| `test_case_id` | str | |
| `world_ref` | str | |
| `candidate_song_ref` | str | catalog `synthetic-track-NNNN` |
| `expected_label` | `positive\|negative\|neutral` | LLM, assigned **blind** |
| `judge_folds` | dict | context_need/mood_genre_fit/era_cultural_fit/coherence/web_evidence |
| `algorithm_score` | float | P6 cross-check, revealed **after** label (FR-026) |
| `agreement` | `agree\|disagree` | |
| `contrast_partner` | str \| null | |
| `expected_direction` | str \| null | |

Blind-first (SC-009): label timestamp/order precedes score reveal.

## Build report (committed)

### BuildReport
| Field | Type | Notes |
|---|---|---|
| `candidate_source` | str | |
| `loop` | int | |
| `new_vs_skipped` | dict | per-loop counts |
| `soundcharts_calls` | int | quota usage |
| `probe_result` | dict | `{fetched, populated_audio, threshold, passed}` |
| `repairs` | list | per-record repair log |
| `coverage_checklist` | dict | cells/quotas/language/era pass state |
| `agreement_stats` | dict | agree/disagree counts, disagreements list |
| `errors` | list | typed codes raised |

## Relationships

`CoveragePlan` → drives → `CandidateName` (LLM) → `resolver` → `candidate_isrcs` → `harvest` → `RawResponseCacheEntry` + `LineageEntry` → `binner/selector` → `mapper` → **`Song`** → `validator/repair` → `freeze` → `DatasetManifest` (+ catalog). `LedgerEntry` spans all acquisition stages. `World`/`ContrastPair` reference catalog `Song` IDs. `TestCase` references `World` + `Song` + P6 score. `BuildReport` records the whole run.
