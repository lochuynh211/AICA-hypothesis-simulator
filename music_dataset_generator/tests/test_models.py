"""T009+T010 — models: test-first (TDD).

Validates all Pydantic v2 models in mdg/models.py per data-model.md.

Key validations tested:
- DatasetManifest: dataset_kind literal, synthetic_only literal False, version fields present.
- CandidateName: rejects any dict containing isrc or audio-feature keys (FR-005 firewall).
- LedgerEntry: outcome in {accepted, miss}; miss_reason optional from MissReason; keys requires normalized_name.
- CoveragePlan: 36 cells accessor, language_targets, contrast_pairs >= 12.
- Song is NOT redefined here (test_song_schema_reuse.py handles that).
"""
import pytest
from pydantic import ValidationError
from mdg.models import (
    CoverageCell,
    CoveragePlan,
    CandidateName,
    LineageEntry,
    LedgerEntry,
    DatasetManifest,
    TestCase,
    BuildReport,
    ContrastPairSpec,
)
from mdg.errors import MissReason


# ---------------------------------------------------------------------------
# CoverageCell
# ---------------------------------------------------------------------------

class TestCoverageCell:
    def _valid(self, **kwargs):
        defaults = {
            "cell_id": "E-hi_T-hi_P-balanced-vocal",
            "energy_band": "high",
            "tempo_band": "high",
            "profile_family": "balanced_vocal",
        }
        return CoverageCell(**(defaults | kwargs))

    def test_valid_cell(self):
        cell = self._valid()
        assert cell.cell_id == "E-hi_T-hi_P-balanced-vocal"
        assert cell.energy_band == "high"
        assert cell.tempo_band == "high"
        assert cell.profile_family == "balanced_vocal"

    def test_all_energy_bands(self):
        for band in ("low", "medium", "high"):
            c = self._valid(energy_band=band)
            assert c.energy_band == band

    def test_all_tempo_bands(self):
        for band in ("low", "medium", "high"):
            c = self._valid(tempo_band=band)
            assert c.tempo_band == band

    def test_all_profile_families(self):
        for pf in ("balanced_vocal", "danceable_vocal", "speech_forward", "instrumental_leaning"):
            c = self._valid(profile_family=pf)
            assert c.profile_family == pf

    def test_invalid_energy_band(self):
        with pytest.raises(ValidationError):
            self._valid(energy_band="extreme")

    def test_invalid_profile_family(self):
        with pytest.raises(ValidationError):
            self._valid(profile_family="unknown_family")


# ---------------------------------------------------------------------------
# CoveragePlan
# ---------------------------------------------------------------------------

def _make_36_cells():
    cells = []
    i = 0
    for energy in ("low", "medium", "high"):
        for tempo in ("low", "medium", "high"):
            for pf in ("balanced_vocal", "danceable_vocal", "speech_forward", "instrumental_leaning"):
                cells.append(CoverageCell(
                    cell_id=f"E-{energy[:2]}_T-{tempo[:2]}_P-{pf[:2]}-{i}",
                    energy_band=energy,
                    tempo_band=tempo,
                    profile_family=pf,
                ))
                i += 1
    return cells  # 3 * 3 * 4 = 36


def _make_12_pairs():
    return [
        ContrastPairSpec(
            pair_id=f"pair-{i:02d}",
            variable=f"variable_{i}",
            world_a_ref=f"world-a-{i}",
            world_b_ref=f"world-b-{i}",
            expected_direction="reversal",
        )
        for i in range(12)
    ]


class TestCoveragePlan:
    def _valid(self, **kwargs):
        defaults = {
            "cells": _make_36_cells(),
            "secondary_spreads": {},
            "quotas": {},
            "language_targets": {"ja": 30, "en": 6, "other": 0},
            "era_targets": {"classic": 10, "modern": 16, "recent": 10},
            "contrast_pairs": _make_12_pairs(),
            "remaining": {},
            "enrichment_priority": [],
        }
        return CoveragePlan(**(defaults | kwargs))

    def test_valid_plan(self):
        plan = self._valid()
        assert len(plan.cells) == 36

    def test_language_targets_accessible(self):
        plan = self._valid()
        assert "ja" in plan.language_targets
        assert plan.language_targets["ja"] == 30

    def test_contrast_pairs_accessible(self):
        plan = self._valid()
        assert len(plan.contrast_pairs) == 12

    def test_wrong_cell_count_raises(self):
        cells = _make_36_cells()[:20]  # only 20
        with pytest.raises(ValidationError):
            self._valid(cells=cells)

    def test_fewer_than_12_pairs_raises(self):
        pairs = _make_12_pairs()[:5]
        with pytest.raises(ValidationError):
            self._valid(contrast_pairs=pairs)


# ---------------------------------------------------------------------------
# CandidateName — FR-005 firewall
# ---------------------------------------------------------------------------

AUDIO_FEATURE_KEYS = [
    "energy", "tempo", "valence", "danceability", "acousticness",
    "instrumentalness", "speechiness", "loudness", "key", "mode",
    "liveness", "time_signature", "timeSignature",
]


class TestCandidateName:
    def _valid_dict(self, **extra):
        d = {
            "title": "Night Runner",
            "artist": "Real Band",
            "release_year": 2019,
            "expected_language": "ja",
            "target_cell_id": "E-hi_T-hi_P-balanced-vocal",
            "why_fits_cell": "upbeat energetic pop",
            "web_evidence": ["https://example.invalid/evidence"],
        }
        d.update(extra)
        return d

    def test_valid_candidate(self):
        c = CandidateName(**self._valid_dict())
        assert c.title == "Night Runner"
        assert c.artist == "Real Band"

    def test_rejects_isrc_key(self):
        """FR-005: any dict containing 'isrc' must be rejected."""
        with pytest.raises(ValidationError):
            CandidateName(**self._valid_dict(isrc="JPXXX2019001"))

    def test_rejects_audio_feature_keys(self):
        """FR-005: any audio-feature key must be rejected."""
        for af_key in AUDIO_FEATURE_KEYS:
            with pytest.raises(ValidationError):
                CandidateName(**self._valid_dict(**{af_key: 0.5}))

    def test_accepts_no_forbidden_keys(self):
        """A completely clean candidate dict passes validation."""
        c = CandidateName(**self._valid_dict())
        assert c is not None

    def test_web_evidence_is_list(self):
        c = CandidateName(**self._valid_dict(web_evidence=[]))
        assert c.web_evidence == []


# ---------------------------------------------------------------------------
# LedgerEntry
# ---------------------------------------------------------------------------

class TestLedgerEntry:
    def _valid(self, **kwargs):
        defaults = {
            "keys": {"normalized_name": "real band|night runner"},
            "outcome": "accepted",
            "miss_reason": None,
            "cell": "E-hi_T-hi_P-balanced-vocal",
            "loop": 1,
        }
        return LedgerEntry(**(defaults | kwargs))

    def test_valid_accepted_entry(self):
        e = self._valid()
        assert e.outcome == "accepted"
        assert e.miss_reason is None

    def test_valid_miss_entry_with_reason(self):
        e = self._valid(outcome="miss", miss_reason=MissReason.language_mismatch)
        assert e.outcome == "miss"
        assert e.miss_reason == MissReason.language_mismatch

    def test_miss_entry_with_string_reason(self):
        e = self._valid(outcome="miss", miss_reason="audio_unavailable")
        assert e.miss_reason == MissReason.audio_unavailable

    def test_keys_requires_normalized_name(self):
        with pytest.raises(ValidationError):
            self._valid(keys={})  # no normalized_name

    def test_invalid_outcome_rejected(self):
        with pytest.raises(ValidationError):
            self._valid(outcome="pending")

    def test_invalid_miss_reason_rejected(self):
        with pytest.raises(ValidationError):
            self._valid(outcome="miss", miss_reason="not_a_real_reason")


# ---------------------------------------------------------------------------
# LineageEntry
# ---------------------------------------------------------------------------

class TestLineageEntry:
    def _valid(self, **kwargs):
        defaults = {
            "synthetic_id": "synthetic-track-0001",
            "soundcharts_uuid": "abc123",
            "real_name": "Night Runner",
            "real_genre_text": {"root": "pop", "sub": ["j-pop"]},
            "resolved_isrc": None,
            "candidate_isrcs": [],
        }
        return LineageEntry(**(defaults | kwargs))

    def test_valid_lineage(self):
        e = self._valid()
        assert e.synthetic_id == "synthetic-track-0001"

    def test_resolved_isrc_optional(self):
        e = self._valid(resolved_isrc="JPXXX2019001")
        assert e.resolved_isrc == "JPXXX2019001"


# ---------------------------------------------------------------------------
# DatasetManifest — fixed literals
# ---------------------------------------------------------------------------

class TestDatasetManifest:
    def _valid(self, **kwargs):
        defaults = {
            "dataset_id": "mdg-smoke-001",
            "dataset_kind": "soundcharts_grounded_spotify_compatible",
            "schema_version": "1.0.0",
            "spotify_track_reference_version": "v1",
            "spotify_audio_features_reference_version": "v1",
            "generator_version": "1.0.0",
            "prompt_template_version": "1.0.0",
            "validation_rules_version": "1.0.0",
            "random_seed": 42,
            "generated_at": "2026-01-01T00:00:00Z",
            "synthetic_only": False,
            "dataset_hash": "deadbeef",
            "provenance_note": "Soundcharts-grounded; real names + verbatim audio.",
            "candidate_source": "isrc_resolved",
            "tier": "smoke",
            "build_report_ref": "builds/smoke-001.json",
        }
        return DatasetManifest(**(defaults | kwargs))

    def test_valid_manifest(self):
        m = self._valid()
        assert m.dataset_kind == "soundcharts_grounded_spotify_compatible"
        assert m.synthetic_only is False

    def test_dataset_kind_must_be_literal(self):
        with pytest.raises(ValidationError):
            self._valid(dataset_kind="some_other_kind")

    def test_synthetic_only_must_be_false(self):
        with pytest.raises(ValidationError):
            self._valid(synthetic_only=True)

    def test_synthetic_only_true_string_rejected(self):
        with pytest.raises(ValidationError):
            self._valid(synthetic_only="true")

    def test_candidate_source_values(self):
        for v in ("isrc_resolved", "soundcharts_search"):
            m = self._valid(candidate_source=v)
            assert m.candidate_source == v

    def test_candidate_source_invalid_rejected(self):
        with pytest.raises(ValidationError):
            self._valid(candidate_source="unknown_source")

    def test_tier_values(self):
        for tier in ("smoke", "demonstration", "stress"):
            m = self._valid(tier=tier)
            assert m.tier == tier

    def test_tier_invalid_rejected(self):
        with pytest.raises(ValidationError):
            self._valid(tier="production")

    def test_version_fields_required(self):
        # schema_version is required — drop it and expect failure
        d = {
            "dataset_id": "x",
            "dataset_kind": "soundcharts_grounded_spotify_compatible",
            # schema_version missing
            "spotify_track_reference_version": "v1",
            "spotify_audio_features_reference_version": "v1",
            "generator_version": "1.0.0",
            "prompt_template_version": "1.0.0",
            "validation_rules_version": "1.0.0",
            "random_seed": 42,
            "generated_at": "2026-01-01T00:00:00Z",
            "synthetic_only": False,
            "dataset_hash": "x",
            "provenance_note": "note",
            "candidate_source": "isrc_resolved",
            "tier": "smoke",
            "build_report_ref": "x",
        }
        with pytest.raises(ValidationError):
            DatasetManifest(**d)


# ---------------------------------------------------------------------------
# ContrastPairSpec
# ---------------------------------------------------------------------------

class TestContrastPairSpec:
    def test_valid_pair(self):
        p = ContrastPairSpec(
            pair_id="pair-01",
            variable="motion_state",
            world_a_ref="world-a",
            world_b_ref="world-b",
            expected_direction="reversal",
        )
        assert p.pair_id == "pair-01"
        assert p.variable == "motion_state"


# ---------------------------------------------------------------------------
# TestCase
# ---------------------------------------------------------------------------

class TestTestCase:
    def _valid(self, **kwargs):
        defaults = {
            "test_case_id": "tc-001",
            "world_ref": "world-01",
            "candidate_song_ref": "synthetic-track-0001",
            "expected_label": "positive",
            "judge_folds": {
                "context_need": "high",
                "mood_genre_fit": "good",
                "era_cultural_fit": "fit",
                "coherence": "coherent",
                "web_evidence": "strong",
            },
            "algorithm_score": 0.75,
            "agreement": "agree",
            "contrast_partner": None,
            "expected_direction": None,
        }
        return TestCase(**(defaults | kwargs))

    def test_valid_test_case(self):
        tc = self._valid()
        assert tc.expected_label == "positive"
        assert tc.agreement == "agree"

    def test_valid_labels(self):
        for label in ("positive", "negative", "neutral"):
            tc = self._valid(expected_label=label)
            assert tc.expected_label == label

    def test_invalid_label_rejected(self):
        with pytest.raises(ValidationError):
            self._valid(expected_label="unknown")

    def test_valid_agreement_values(self):
        for v in ("agree", "disagree"):
            tc = self._valid(agreement=v)
            assert tc.agreement == v

    def test_invalid_agreement_rejected(self):
        with pytest.raises(ValidationError):
            self._valid(agreement="partial")


# ---------------------------------------------------------------------------
# BuildReport
# ---------------------------------------------------------------------------

class TestBuildReport:
    def _valid(self, **kwargs):
        defaults = {
            "candidate_source": "isrc_resolved",
            "loop": 1,
            "new_vs_skipped": {"new": 10, "skipped": 2},
            "soundcharts_calls": 12,
            "probe_result": {
                "fetched": 10,
                "populated_audio": 8,
                "threshold": 0.6,
                "passed": True,
            },
            "repairs": [],
            "coverage_checklist": {"cells": True, "quotas": True},
            "agreement_stats": {"agree": 10, "disagree": 2, "disagreements": []},
            "errors": [],
        }
        return BuildReport(**(defaults | kwargs))

    def test_valid_report(self):
        r = self._valid()
        assert r.loop == 1
        assert r.soundcharts_calls == 12
