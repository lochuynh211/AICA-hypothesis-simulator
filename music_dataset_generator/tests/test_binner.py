"""T017 [US1] — S3 binner tests.

The binner computes each real song's *coverage coordinates* by arithmetic on the
real audio block (§4.6, worked example §7). This is coverage arithmetic, NOT an
item_fit score — no score/label/rank is produced (firewall, SC-002).

Bands per data-spec §10.2:
- energy:  low 0.10..0.35 | medium 0.40..0.65 | high 0.70..0.95
- tempo:   low 60..95      | medium 96..130    | high 131..180
- profile: balanced_vocal | danceable_vocal | speech_forward | instrumental_leaning

Plus secondary spreads: valence (low/mid/high), mode (0/1), acousticness
(acoustic/electric), humming_ease (low/high), full_karaoke_ease (low/high), and the
reported dimensions language (from languageCode) + era (from releaseDate).
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from mdg.binner import bin_song


def _load(fixtures_dir: Path, isrc: str) -> dict:
    return json.loads((fixtures_dir / "cache" / f"{isrc}.json").read_text(encoding="utf-8"))


# ---------------------------------------------------------------------------
# Worked example §7 — Night Runner lands in cell HI
# ---------------------------------------------------------------------------

def test_night_runner_worked_example(fixtures_dir: Path) -> None:
    coords = bin_song(_load(fixtures_dir, "JPXX01900123"))
    assert coords["energy_band"] == "high"        # 0.86 in 0.70..0.95
    assert coords["tempo_band"] == "high"         # 148 in 131..180
    assert coords["profile_family"] == "balanced_vocal"  # instrumentalness 0.0 <= 0.20
    assert coords["cell_id"] == "E-hi_T-hi_P-bv"
    assert coords["valence_band"] == "mid"        # 0.55
    assert coords["mode"] == 1
    assert coords["acousticness_band"] == "electric"  # 0.03
    assert coords["humming_ease_band"] == "high"  # dance 0.62, instr 0, speech 0.05
    assert coords["language"] == "ja"
    assert coords["era"] == "recent"              # 2019 -> 2016+


# ---------------------------------------------------------------------------
# Energy bands
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "isrc,expected",
    [
        ("JPXX01900124", "low"),     # 0.18
        ("JPXX02000201", "medium"),  # 0.54
        ("JPXX01900123", "high"),    # 0.86
        ("USAT22003425", "high"),    # 0.91
        ("GBUM71900001", "low"),     # 0.29
    ],
)
def test_energy_bands(fixtures_dir: Path, isrc: str, expected: str) -> None:
    assert bin_song(_load(fixtures_dir, isrc))["energy_band"] == expected


# ---------------------------------------------------------------------------
# Tempo bands
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "isrc,expected",
    [
        ("JPXX01900124", "low"),     # 72
        ("GBUM71900001", "medium"),  # 108
        ("JPXX01900123", "high"),    # 148
        ("JPXX02100401", "low"),     # 80
    ],
)
def test_tempo_bands(fixtures_dir: Path, isrc: str, expected: str) -> None:
    assert bin_song(_load(fixtures_dir, isrc))["tempo_band"] == expected


# ---------------------------------------------------------------------------
# Profile families (priority: instrumental > speech > danceable > balanced)
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "isrc,expected",
    [
        ("JPXX02200502", "instrumental_leaning"),  # instrumentalness 0.82 >= 0.65
        ("JPXX02200501", "speech_forward"),        # speechiness 0.58 >= 0.40
        ("JPXX02000201", "danceable_vocal"),       # dance 0.78 >= 0.65, instr <= 0.15
        ("JPXX01900123", "balanced_vocal"),        # dance 0.62 < 0.65, instr low
    ],
)
def test_profile_families(fixtures_dir: Path, isrc: str, expected: str) -> None:
    assert bin_song(_load(fixtures_dir, isrc))["profile_family"] == expected


def test_speech_forward_boundary_is_0_33() -> None:
    # Soundcharts-grounded threshold (Spotify's music+speech boundary): 0.33, not 0.40.
    from mdg.binner import _profile_family

    base = {"instrumentalness": 0.0, "danceability": 0.5, "speechiness": 0.33}
    assert _profile_family(base) == "speech_forward"           # at the boundary
    assert _profile_family({**base, "speechiness": 0.32}) == "balanced_vocal"  # just below
    assert _profile_family({**base, "speechiness": 0.38}) == "speech_forward"  # rap ceiling
    # instrumental still wins over speech.
    assert _profile_family({**base, "speechiness": 0.5, "instrumentalness": 0.7}) \
        == "instrumental_leaning"


# ---------------------------------------------------------------------------
# Secondary spreads: valence / acousticness (contrast fixtures)
# ---------------------------------------------------------------------------

def test_valence_bands(fixtures_dir: Path) -> None:
    assert bin_song(_load(fixtures_dir, "JPXX01800301"))["valence_band"] == "high"  # 0.88
    assert bin_song(_load(fixtures_dir, "JPXX01800302"))["valence_band"] == "low"   # 0.15
    assert bin_song(_load(fixtures_dir, "JPXX01900123"))["valence_band"] == "mid"   # 0.55


def test_acousticness_bands(fixtures_dir: Path) -> None:
    assert bin_song(_load(fixtures_dir, "JPXX02100401"))["acousticness_band"] == "acoustic"  # 0.85
    assert bin_song(_load(fixtures_dir, "JPXX02100402"))["acousticness_band"] == "electric"  # 0.02


# ---------------------------------------------------------------------------
# Era buckets from releaseDate
# ---------------------------------------------------------------------------

def test_era_bucket(fixtures_dir: Path) -> None:
    # All fixtures are 2018+ (recent). Verify the bucketing function directly.
    from mdg.binner import era_bucket

    assert era_bucket("1998-01-01") == "classic"
    assert era_bucket("2008-06-01") == "modern"
    assert era_bucket("2019-06-01") == "recent"
    assert era_bucket("2015-12-31") == "modern"
    assert era_bucket("2016-01-01") == "recent"


# ---------------------------------------------------------------------------
# Firewall: binner emits no score/label/rank
# ---------------------------------------------------------------------------

def test_binner_emits_no_score_or_label(fixtures_dir: Path) -> None:
    coords = bin_song(_load(fixtures_dir, "JPXX01900123"))
    forbidden = {"score", "item_fit", "rank", "label", "recommended",
                 "best_for_world", "target_rank"}
    assert forbidden.isdisjoint(coords.keys())
