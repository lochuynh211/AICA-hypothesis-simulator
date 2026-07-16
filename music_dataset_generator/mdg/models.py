"""Pydantic v2 models for the music-dataset generator (Phase 1).

All models per specs/012-music-dataset-generator/data-model.md.

The frozen Song model is imported from aica_api.models.proposal.song_schema
and NEVER redefined here.  Any code that needs Song uses that import directly.
"""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from mdg.errors import MissReason


# ---------------------------------------------------------------------------
# Audio-feature key firewall (FR-005)
# ---------------------------------------------------------------------------

_AUDIO_FEATURE_KEYS: frozenset[str] = frozenset({
    "energy", "tempo", "valence", "danceability", "acousticness",
    "instrumentalness", "speechiness", "loudness", "key", "mode",
    "liveness", "time_signature", "timeSignature",
})


# ---------------------------------------------------------------------------
# Coverage (S0)
# ---------------------------------------------------------------------------

class CoverageCell(BaseModel):
    """One coverage cell — a unique (energy_band, tempo_band, profile_family) triple."""

    model_config = ConfigDict(extra="forbid")

    cell_id: str
    energy_band: Literal["low", "medium", "high"]
    tempo_band: Literal["low", "medium", "high"]
    profile_family: Literal[
        "balanced_vocal",
        "danceable_vocal",
        "speech_forward",
        "instrumental_leaning",
    ]


class ContrastPairSpec(BaseModel):
    """Specification for a one-variable contrast pair (§15)."""

    model_config = ConfigDict(extra="forbid")

    pair_id: str
    variable: str
    world_a_ref: str
    world_b_ref: str
    expected_direction: str


class CoveragePlan(BaseModel):
    """Coverage plan: 36 primary cells + secondary spreads + quotas + targets.

    Validation:
    - exactly 36 cells
    - contrast_pairs >= 12
    - language_targets present
    """

    model_config = ConfigDict(extra="forbid")

    cells: list[CoverageCell]
    secondary_spreads: dict[str, Any] = Field(default_factory=dict)
    quotas: dict[str, Any] = Field(default_factory=dict)
    language_targets: dict[str, Any]
    era_targets: dict[str, Any] = Field(default_factory=dict)
    contrast_pairs: list[ContrastPairSpec]
    remaining: dict[str, Any] = Field(default_factory=dict)
    enrichment_priority: list[str] = Field(default_factory=list)

    @field_validator("cells", mode="after")
    @classmethod
    def _must_have_36_cells(cls, v: list[CoverageCell]) -> list[CoverageCell]:
        if len(v) != 36:
            raise ValueError(f"CoveragePlan must have exactly 36 cells, got {len(v)}")
        return v

    @field_validator("contrast_pairs", mode="after")
    @classmethod
    def _must_have_at_least_12_pairs(cls, v: list[ContrastPairSpec]) -> list[ContrastPairSpec]:
        if len(v) < 12:
            raise ValueError(
                f"CoveragePlan must have at least 12 contrast_pairs, got {len(v)}"
            )
        return v


# ---------------------------------------------------------------------------
# CandidateName (LLM S1b output item) — FR-005 firewall
# ---------------------------------------------------------------------------

class CandidateName(BaseModel):
    """LLM-proposed candidate song name for a coverage cell.

    FR-005: Any incoming dict that carries an 'isrc' key or ANY audio-feature
    key is REJECTED by the model_validator over the raw input dict.
    """

    model_config = ConfigDict(extra="forbid")

    title: str
    artist: str
    release_year: int
    expected_language: str
    target_cell_id: str
    why_fits_cell: str
    web_evidence: list[str] = Field(default_factory=list)

    @model_validator(mode="before")
    @classmethod
    def _reject_forbidden_keys(cls, values: Any) -> Any:
        """Reject any input that includes 'isrc' or audio-feature keys (FR-005)."""
        if not isinstance(values, dict):
            return values
        forbidden = {"isrc"} | _AUDIO_FEATURE_KEYS
        found = forbidden & values.keys()
        if found:
            raise ValueError(
                f"CandidateName input contains forbidden key(s): {sorted(found)}. "
                "The LLM must never emit ISRC or audio-feature values (FR-005)."
            )
        return values


# ---------------------------------------------------------------------------
# LineageEntry (gitignored — provenance chain)
# ---------------------------------------------------------------------------

class LineageEntry(BaseModel):
    """Per-track lineage record linking synthetic ID → Soundcharts source."""

    model_config = ConfigDict(extra="forbid")

    synthetic_id: str
    soundcharts_uuid: str
    real_name: str
    real_genre_text: dict[str, Any]
    resolved_isrc: str | None = None
    candidate_isrcs: list[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# LedgerEntry (append-only dedup ledger)
# ---------------------------------------------------------------------------

class LedgerEntry(BaseModel):
    """Append-only ledger record for a processed candidate.

    Rules (FR-023/024):
    - outcome: 'accepted' | 'miss'
    - miss_reason: optional, only valid MissReason values
    - keys: must contain 'normalized_name'
    """

    model_config = ConfigDict(extra="forbid")

    keys: dict[str, Any]
    outcome: Literal["accepted", "miss"]
    miss_reason: MissReason | None = None
    cell: str | None = None
    loop: int

    @field_validator("keys", mode="after")
    @classmethod
    def _keys_must_have_normalized_name(cls, v: dict[str, Any]) -> dict[str, Any]:
        if "normalized_name" not in v:
            raise ValueError(
                "LedgerEntry.keys must contain 'normalized_name' "
                "(nfkc(lower(strip(title)))|nfkc(lower(strip(artist))))"
            )
        return v


# ---------------------------------------------------------------------------
# DatasetManifest (frozen catalog metadata)
# ---------------------------------------------------------------------------

class DatasetManifest(BaseModel):
    """Committed manifest for the frozen synthetic dataset.

    Fixed invariants (D3):
    - dataset_kind = 'soundcharts_grounded_spotify_compatible'
    - synthetic_only = False  (real audio, real names)
    """

    model_config = ConfigDict(extra="forbid")

    dataset_id: str
    dataset_kind: Literal["soundcharts_grounded_spotify_compatible"]
    schema_version: str
    spotify_track_reference_version: str
    spotify_audio_features_reference_version: str
    generator_version: str
    prompt_template_version: str
    validation_rules_version: str
    random_seed: int
    generated_at: str
    synthetic_only: Literal[False]
    dataset_hash: str
    provenance_note: str
    candidate_source: Literal["isrc_resolved", "soundcharts_search"]
    tier: Literal["smoke", "demonstration", "stress"]
    build_report_ref: str


# ---------------------------------------------------------------------------
# TestCase (S8/S9 — blind judge output)
# ---------------------------------------------------------------------------

class TestCase(BaseModel):
    """A single test case produced by the blind judge (S8) and certify step (S9)."""

    model_config = ConfigDict(extra="forbid")

    test_case_id: str
    world_ref: str
    candidate_song_ref: str
    expected_label: Literal["positive", "negative", "neutral"]
    judge_folds: dict[str, Any]
    algorithm_score: float
    agreement: Literal["agree", "disagree"]
    contrast_partner: str | None = None
    expected_direction: str | None = None


# ---------------------------------------------------------------------------
# BuildReport
# ---------------------------------------------------------------------------

class BuildReport(BaseModel):
    """Per-run build report summarising the generation process."""

    model_config = ConfigDict(extra="forbid")

    candidate_source: str
    loop: int
    new_vs_skipped: dict[str, Any]
    soundcharts_calls: int
    probe_result: dict[str, Any]
    repairs: list[Any] = Field(default_factory=list)
    coverage_checklist: dict[str, Any]
    agreement_stats: dict[str, Any]
    errors: list[Any] = Field(default_factory=list)
