"""T049 [US5] — genre map: real Soundcharts genres → frozen 12-vocab (design §13, SC-006).

Total over the 34 Soundcharts roots; sub-override beats root-fallback; unmapped →
`genre_unmappable_to_vocabulary` → `missing_neutral` (the artist contributes no genre).
The 12-term `genre_affinity_v1` vocabulary is unchanged.
"""
from __future__ import annotations

import json
from pathlib import Path

from mdg.genre_map import (
    GENRE_VOCABULARY,
    MISSING_NEUTRAL,
    map_genre_text,
    resolve_artist_genres,
)

_ROOTS_FILE = Path(__file__).resolve().parents[2] / "others" / "soundchart_song_genres.json"


def test_vocabulary_is_the_frozen_twelve() -> None:
    assert GENRE_VOCABULARY == (
        "j-pop", "j-rock", "city pop", "anime", "vocaloid", "enka",
        "children's music", "classical", "jazz", "ambient", "electronic", "japanese folk",
    )


def test_map_total_over_all_34_roots() -> None:
    roots = [it["root"] for it in json.loads(_ROOTS_FILE.read_text())["items"]]
    assert len(roots) == 34
    for root in roots:
        result = map_genre_text({"root": root, "sub": []})
        # Every root resolves to a vocab term or the neutral marker — never crashes.
        assert result in GENRE_VOCABULARY or result is MISSING_NEUTRAL


def test_root_fallback_mappings() -> None:
    assert map_genre_text({"root": "j-pop", "sub": []}) == "j-pop"
    assert map_genre_text({"root": "classical", "sub": []}) == "classical"
    assert map_genre_text({"root": "jazz", "sub": []}) == "jazz"
    assert map_genre_text({"root": "ambient", "sub": []}) == "ambient"
    assert map_genre_text({"root": "electro", "sub": []}) == "electronic"
    assert map_genre_text({"root": "edm", "sub": []}) == "electronic"
    assert map_genre_text({"root": "disco", "sub": []}) == "electronic"
    assert map_genre_text({"root": "kids", "sub": []}) == "children's music"


def test_sub_override_beats_root_fallback() -> None:
    assert map_genre_text({"root": "j-pop", "sub": ["city pop"]}) == "city pop"
    assert map_genre_text({"root": "soundtrack", "sub": ["anime"]}) == "anime"
    assert map_genre_text({"root": "electro", "sub": ["vocaloid"]}) == "vocaloid"
    assert map_genre_text({"root": "traditional", "sub": ["japanese folk"]}) == "japanese folk"
    assert map_genre_text({"root": "j-pop", "sub": ["j-rock"]}) == "j-rock"
    assert map_genre_text({"root": "j-pop", "sub": ["enka"]}) == "enka"


def test_sub_override_case_insensitive() -> None:
    assert map_genre_text({"root": "j-pop", "sub": ["City Pop"]}) == "city pop"
    assert map_genre_text({"root": "SOUNDTRACK", "sub": ["ANIME"]}) == "anime"


def test_unmapped_root_is_missing_neutral() -> None:
    for root in ("pop", "rock", "hip hop", "r&b", "latin", "k-pop", "metal"):
        assert map_genre_text({"root": root, "sub": []}) is MISSING_NEUTRAL


def test_idol_falls_through_to_j_pop_root() -> None:
    # idol/shibuya-kei/japanese pop carry no sub-override → j-pop root-fallback (§13.1).
    assert map_genre_text({"root": "j-pop", "sub": ["idol"]}) == "j-pop"


def test_resolve_artist_genres_union_deduped() -> None:
    genres = [
        {"root": "j-pop", "sub": ["city pop"]},  # city pop
        {"root": "j-pop", "sub": []},            # j-pop
        {"root": "pop", "sub": []},              # missing_neutral → dropped
        {"root": "j-pop", "sub": ["city pop"]},  # dup city pop
    ]
    resolved = resolve_artist_genres(genres)
    assert resolved == ["city pop", "j-pop"]  # order-stable, deduped, neutral dropped
