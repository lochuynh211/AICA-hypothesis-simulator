# Error / Status Taxonomy Contract (`mdg/errors.py`)

Every failure surfaces as a typed code (design §9 + data-spec §22). Codes are stable strings; the CLI prints `{"error": "<code>", "detail": …}` and exits non-zero. `judge_disagreement` is **data, not an error**.

## Run-fatal (halt)
| Code | Raised when |
|---|---|
| `catalog_generation_failed` | a record fails validation after **2** repair attempts (S5); halts the run |
| `coverage_contract_failed` | freeze attempted while a required cell/quota/language/era target is unmet |
| `synthetic_identity_violation` | a mapped record has a non-`synthetic-` ID or a non-`.invalid` URL |
| `cross_object_identity_mismatch` | track↔audio-features id/uri/duration disagree |
| `lineage_integrity_failed` | a synthetic ID has no resolvable lineage entry |
| `world_reference_failed` | a world/history references a nonexistent catalog ID |
| `invalid_genre_extension` | `genre_affinity_v1` extension malformed |
| `isrc_probe_gate_failed` | step-zero probe < 60% populated audio (Strategy B pre-flight halt) |
| `strategy_unavailable` | a live `soundcharts_search` search-by-metric call (off-subscription) |
| `soundcharts_harvest_failed` | Soundcharts call failed or quota exhausted |

## Per-candidate miss signals (logged, drive the fill loop, NOT run-fatal)
| Code | Meaning |
|---|---|
| `song_not_found_in_sources` | MusicBrainz + Deezer returned no ISRC → next name |
| `isrc_not_in_soundcharts` | all candidate ISRCs 404 on `by-isrc` → next name |
| `audio_unavailable` | Soundcharts record has null/partial audio → next candidate ISRC / next name |
| `language_mismatch` | real `languageCode` ≠ cell target → discard song (never relabel) |
| `wrong_cell` | real audio bins into a different cell → land in actual cell or discard if full |
| `cell_unfillable_from_source` | a required cell still empty after N=3 fill rounds → logged, never faked |
| `genre_unmappable_to_vocabulary` | real genre has no controlled-vocab mapping → `missing_neutral` |

## Recorded data (not errors)
- `judge_disagreement` — LLM label ≠ P6 sign → recorded as a neutral fixture or a possible algorithm finding (design §3).
