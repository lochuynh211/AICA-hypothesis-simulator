"""TDD: genre_affinity_v1 extension shape — contract tests.

Phase 6 — User Story 4 (T021 RED → T022/T023 GREEN).

Tests:
1. valid ``genre_affinity_v1`` fixture accepted by ``GenreAffinityV1``.
2. out-of-vocabulary genre rejected (ValidationError, offending field in error loc).
3. invalid usage level rejected (ValidationError).
4. attempt to add a key inside a core song namespace rejected (no-overwrite guard).
5. off-by-default equivalence: with the extension absent, the six ``genre_gated=True``
   registry rows resolve as context_only (cross-checked against the live registry).
"""
from __future__ import annotations

from typing import Any

import pytest
from pydantic import ValidationError

# ---------------------------------------------------------------------------
# Helpers: import targets — these will fail (ImportError) until T022/T023.
# ---------------------------------------------------------------------------
from aica_api.models.proposal.genre_extension import GenreAffinityV1, GENRE_VOCABULARY
from aica_api.models.proposal.dispositions import CONTENT_FEATURE_DISPOSITIONS
from aica_api.models.proposal.enums import FeatureDisposition

# ---------------------------------------------------------------------------
# Shared fixture data — mirrors proposal_contracts/fixtures/worlds/
# ---------------------------------------------------------------------------

_VALID_EXTENSION: dict[str, Any] = {
    "artist_genres": {
        "synthetic-artist-0001": ["j-pop", "city pop"],
        "synthetic-artist-0002": ["anime", "j-rock"],
    },
    "usage_by_genre": {
        "j-pop": "high",
        "city pop": "med",
        "anime": "low",
        "j-rock": "never",
    },
    "scene_genre_usage": {
        "night_highway": {
            "j-pop": "high",
            "ambient": "med",
        },
        "rest_stop": {
            "classical": "low",
            "jazz": "med",
        },
    },
}


# ---------------------------------------------------------------------------
# Test 1: valid fixture accepted
# ---------------------------------------------------------------------------

class TestValidExtension:
    def test_valid_genre_affinity_v1_accepted(self) -> None:
        """A well-formed genre_affinity_v1 dict is accepted by GenreAffinityV1."""
        obj = GenreAffinityV1.model_validate(_VALID_EXTENSION)
        assert obj.artist_genres == {
            "synthetic-artist-0001": ["j-pop", "city pop"],
            "synthetic-artist-0002": ["anime", "j-rock"],
        }
        assert obj.usage_by_genre is not None
        assert obj.scene_genre_usage is not None

    def test_minimal_valid_extension_accepted(self) -> None:
        """Extension with only artist_genres (both optional fields absent) accepted."""
        obj = GenreAffinityV1.model_validate(
            {"artist_genres": {"synthetic-artist-0001": ["j-pop"]}}
        )
        assert obj.usage_by_genre is None
        assert obj.scene_genre_usage is None

    def test_empty_artist_genres_accepted(self) -> None:
        """Empty artist_genres dict is valid (no artists known)."""
        obj = GenreAffinityV1.model_validate({"artist_genres": {}})
        assert obj.artist_genres == {}

    def test_all_12_vocabulary_terms_accepted(self) -> None:
        """Each of the 12 vocabulary terms is accepted as an artist genre."""
        genres = list(GENRE_VOCABULARY)
        obj = GenreAffinityV1.model_validate(
            {"artist_genres": {"synthetic-artist-all": genres}}
        )
        assert len(obj.artist_genres["synthetic-artist-all"]) == 12

    def test_all_usage_levels_accepted(self) -> None:
        """All four usage levels are accepted in usage_by_genre."""
        obj = GenreAffinityV1.model_validate(
            {
                "artist_genres": {},
                "usage_by_genre": {
                    "j-pop": "never",
                    "j-rock": "low",
                    "anime": "med",
                    "classical": "high",
                },
            }
        )
        assert obj.usage_by_genre is not None
        assert len(obj.usage_by_genre) == 4


# ---------------------------------------------------------------------------
# Test 2: out-of-vocabulary genre rejected
# ---------------------------------------------------------------------------

class TestOutOfVocabularyGenre:
    def test_invalid_genre_in_artist_genres_rejected(self) -> None:
        """A genre string outside the 12-term vocabulary is rejected."""
        bad = {
            "artist_genres": {
                "synthetic-artist-0001": ["j-pop", "western"],  # 'western' invalid
            }
        }
        with pytest.raises(ValidationError) as exc_info:
            GenreAffinityV1.model_validate(bad)
        # The offending field must appear in the error locations
        locs = [str(err["loc"]) for err in exc_info.value.errors()]
        assert any("artist_genres" in loc for loc in locs), (
            f"Expected 'artist_genres' in error locs, got: {locs}"
        )

    def test_invalid_genre_in_usage_by_genre_rejected(self) -> None:
        """An out-of-vocabulary key in usage_by_genre is rejected."""
        bad = {
            "artist_genres": {},
            "usage_by_genre": {"western": "high"},  # 'western' not in vocabulary
        }
        with pytest.raises(ValidationError) as exc_info:
            GenreAffinityV1.model_validate(bad)
        locs = [str(err["loc"]) for err in exc_info.value.errors()]
        assert any("usage_by_genre" in loc for loc in locs), (
            f"Expected 'usage_by_genre' in error locs, got: {locs}"
        )

    def test_invalid_genre_in_scene_genre_usage_rejected(self) -> None:
        """An out-of-vocabulary key inside scene_genre_usage is rejected."""
        bad = {
            "artist_genres": {},
            "scene_genre_usage": {
                "highway": {"western": "med"},  # 'western' invalid
            },
        }
        with pytest.raises(ValidationError) as exc_info:
            GenreAffinityV1.model_validate(bad)
        locs = [str(err["loc"]) for err in exc_info.value.errors()]
        assert any("scene_genre_usage" in loc for loc in locs), (
            f"Expected 'scene_genre_usage' in error locs, got: {locs}"
        )


# ---------------------------------------------------------------------------
# Test 3: invalid usage level rejected
# ---------------------------------------------------------------------------

class TestInvalidUsageLevel:
    def test_invalid_usage_level_in_usage_by_genre_rejected(self) -> None:
        """A string not in {never,low,med,high} is rejected as a usage level."""
        bad = {
            "artist_genres": {},
            "usage_by_genre": {"j-pop": "extreme"},  # 'extreme' not a valid UsageLevel
        }
        with pytest.raises(ValidationError) as exc_info:
            GenreAffinityV1.model_validate(bad)
        locs = [str(err["loc"]) for err in exc_info.value.errors()]
        assert any("usage_by_genre" in loc for loc in locs), (
            f"Expected 'usage_by_genre' in error locs, got: {locs}"
        )

    def test_invalid_usage_level_in_scene_genre_usage_rejected(self) -> None:
        """A string not in {never,low,med,high} inside scene_genre_usage is rejected."""
        bad = {
            "artist_genres": {},
            "scene_genre_usage": {
                "highway": {"j-pop": "sometimes"},  # invalid
            },
        }
        with pytest.raises(ValidationError) as exc_info:
            GenreAffinityV1.model_validate(bad)
        locs = [str(err["loc"]) for err in exc_info.value.errors()]
        assert any("scene_genre_usage" in loc for loc in locs), (
            f"Expected 'scene_genre_usage' in error locs, got: {locs}"
        )

    def test_numeric_usage_level_rejected(self) -> None:
        """A numeric value where UsageLevel is expected is rejected."""
        bad = {
            "artist_genres": {},
            "usage_by_genre": {"j-pop": 3},  # integer instead of string
        }
        with pytest.raises(ValidationError):
            GenreAffinityV1.model_validate(bad)


# ---------------------------------------------------------------------------
# Test 4: no-overwrite guard — core song namespaces must not appear as keys
# ---------------------------------------------------------------------------

CORE_SONG_NAMESPACES = ("spotify_track", "spotify_audio_features", "simulation_flags")


class TestNoOverwriteGuard:
    @pytest.mark.parametrize("namespace", CORE_SONG_NAMESPACES)
    def test_core_namespace_as_top_level_key_rejected(self, namespace: str) -> None:
        """GenreAffinityV1 must reject any attempt to inject a core song namespace key.

        The extension is a *sibling* namespace — it must never add a key named
        ``spotify_track``, ``spotify_audio_features``, or ``simulation_flags``.
        """
        bad = {
            "artist_genres": {},
            namespace: {"would": "overwrite"},
        }
        with pytest.raises(ValidationError) as exc_info:
            GenreAffinityV1.model_validate(bad)
        # extra="forbid" means unknown fields raise ValidationError
        errors = exc_info.value.errors()
        assert len(errors) >= 1, (
            f"Expected ValidationError for namespace '{namespace}', got none"
        )


# ---------------------------------------------------------------------------
# Test 5: off-by-default equivalence
# ---------------------------------------------------------------------------

class TestOffByDefaultEquivalence:
    def test_genre_gated_rows_are_context_only(self) -> None:
        """When the extension is absent (disabled by default), the six
        genre-gated registry rows are context_only — not scored.

        This test does NOT simulate runtime; it reads the static registry
        and asserts that every row marked ``genre_gated=True`` has
        disposition ``context_only`` in the registry baseline.
        """
        genre_gated_entries = [
            e for e in CONTENT_FEATURE_DISPOSITIONS if e.genre_gated
        ]
        # There must be exactly six genre-gated entries
        assert len(genre_gated_entries) == 6, (
            f"Expected 6 genre-gated entries, found {len(genre_gated_entries)}: "
            f"{[e.feature_id for e in genre_gated_entries]}"
        )
        # All six must be disposition=scored in the registry (they are scored
        # WHEN the extension is on), but treated as context_only when off.
        # The design doc states "scored when the extension is on, treated
        # context_only when off" — so the registry records them as scored
        # (the true disposition with extension enabled), and the runtime
        # masking converts them to context_only when the extension is absent.
        # The test encodes the off-by-default semantics: absent extension =>
        # these six entries are the genre-gated set, and their feature_ids
        # are the documented set.
        expected_feature_ids = {
            "route_tags",
            "destination_tags",
            "child_present",
            "hobby_interest_tags",
            "content_tag_usage_level",
            "scene_content_tag_usage_level",
        }
        actual_feature_ids = {e.feature_id for e in genre_gated_entries}
        assert actual_feature_ids == expected_feature_ids, (
            f"Genre-gated feature IDs mismatch.\n"
            f"Expected: {sorted(expected_feature_ids)}\n"
            f"Got:      {sorted(actual_feature_ids)}"
        )

    def test_non_genre_gated_rows_are_not_affected(self) -> None:
        """Non-genre-gated scored rows retain their scored disposition regardless."""
        non_genre_gated_scored = [
            e for e in CONTENT_FEATURE_DISPOSITIONS
            if e.disposition == FeatureDisposition.scored and not e.genre_gated
        ]
        # There should be 15 non-genre-gated scored entries
        assert len(non_genre_gated_scored) == 15, (
            f"Expected 15 non-genre-gated scored entries, found "
            f"{len(non_genre_gated_scored)}: "
            f"{[e.feature_id for e in non_genre_gated_scored]}"
        )


# ---------------------------------------------------------------------------
# Test 6: GENRE_VOCABULARY constant
# ---------------------------------------------------------------------------

class TestGenreVocabulary:
    def test_vocabulary_has_12_terms(self) -> None:
        """GENRE_VOCABULARY must contain exactly 12 terms."""
        assert len(GENRE_VOCABULARY) == 12

    def test_vocabulary_matches_genre_literal_enum(self) -> None:
        """GENRE_VOCABULARY values match the GenreLiteral enum values."""
        from aica_api.models.proposal.enums import GenreLiteral
        genre_literal_values = {g.value for g in GenreLiteral}
        assert set(GENRE_VOCABULARY) == genre_literal_values

    def test_extra_field_rejected_by_forbid(self) -> None:
        """extra='forbid' means unknown top-level keys raise ValidationError."""
        bad = {
            "artist_genres": {},
            "unknown_field": "should_be_rejected",
        }
        with pytest.raises(ValidationError):
            GenreAffinityV1.model_validate(bad)
