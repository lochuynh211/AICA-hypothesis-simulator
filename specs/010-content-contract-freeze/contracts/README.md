# Contracts — P0.5 Content Contract & Song-Schema Freeze

This milestone's "interfaces" are frozen **data contracts** consumed by later milestones (P6 content package, P2 dataset generator) and by reviewers — not HTTP endpoints. Each contract is defined by a backend Pydantic model and exported to language-neutral JSON-Schema under `proposal_contracts/schema/`. The authoritative field detail is in [`../data-model.md`](../data-model.md); this file states the surface, its consumers, and accept/reject expectations that the contract tests encode.

## C1 — Common selector input (`selector_input.schema.json`)
- **Producer**: proposal orchestrator (later, P1). **Consumers**: service + content selector packages.
- **Accept**: valid trigger purpose + compatible lifecycle stage + non-empty `allowed_service_ids` + a `feature_snapshot`; content variant additionally carries `selected_service_id`.
- **Reject**: incompatible purpose/stage pairing; empty `allowed_service_ids`; wrong enum values.
- Purpose/stage are control inputs, never scored.

## C2 — Content-selector output `complete_plan` (`content_output.schema.json`)
- **Producer**: content selector package (later, P6/P9). **Consumers**: journey engine + evidence + comparison.
- **Accept (transparent)**: `ordered_items` each with `item_fit`, `trait_values`, `feature_contributions`, `rationale`; a `mode`, `expected_duration_sec`, policies, excluded/unused/missing lists.
- **Accept (LLM-shaped)**: same shape with `item_fit=null` and empty `feature_contributions`.
- **Reject**: presence of any aggregate plan-level score field; unknown decision/error type.
- Enumerated decision/error categories: `complete_plan`, `no_proposal`, `insufficient_eligible_items`, `unsupported_service`, `unsupported_recipe`, `invalid_request`, `invalid_catalog`, `invalid_configuration`, `full_karaoke_requires_stopped`.

## C3 — Song schema (`song.schema.json`)
- **Producer**: dataset generator (later, P2) + hand-authored fixtures. **Consumers**: content package scoring/eligibility.
- **Accept**: a song with exactly the three namespaces (`spotify_track`, `spotify_audio_features`, `simulation_flags`), consistent cross-object identity, in-range audio values, synthetic IDs + `.invalid` links; extra provider fields *inside* the Spotify objects are tolerated; both flags default to `1`; instrumental-leaning songs still valid & flag-eligible.
- **Reject**: unknown top-level namespace; flag object with a key outside the two flags or a value ∉ {0,1}; out-of-range audio value; `mode`∉{0,1}; `time_signature`∉{3..7}; track/audio-features identity or duration mismatch; a URL not on `.invalid`; an ID missing the `synthetic-` marker.
- Rejections surface as structured validation errors with the offending field path (research D7).

## C4 — Genre extension `genre_affinity_v1` (`genre_affinity_v1.schema.json`)
- **Producer**: dataset generator (later, P2, opt-in). **Consumers**: content package genre-gated features.
- **Accept**: `artist_genres` over the 12-term vocabulary; optional `usage_by_genre` / `scene_genre_usage` with levels ∈ {never,low,med,high}.
- **Reject**: out-of-vocabulary genre; invalid usage level; any key added inside a core song namespace (no-overwrite).
- **Off by default**: absent extension ⇒ the six genre-gated content features behave `context_only`.

## C5 — Feature-disposition registry (`dispositions/content_feature_dispositions.v1.json`)
- **Producer**: this milestone. **Consumers**: content package (which rows to score/mask), evidence/comparison (which rows to display), reviewers.
- **Guarantee**: one entry per Appendix A.2 content field; each with a disposition + provenance; the six genre-gated fields flagged; row-set equal to the A.2 table (drift-guarded); scored categoricals carry nested per-enum responses.

## Example payloads

Concrete valid/invalid example payloads for C1–C5 live as committed fixtures under `proposal_contracts/fixtures/` (songs, worlds, negative cases) and are exercised by `app/api/tests/proposal/`. The exported JSON-Schema files under `proposal_contracts/schema/` are generated from the Pydantic models and pinned by the drift-guard test (`test_schema_export.py`); they are the canonical machine-readable contract for backend-independent consumers.
