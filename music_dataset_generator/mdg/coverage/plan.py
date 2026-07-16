"""S0 — Coverage plan: build_coverage_plan(tier, ledger=None).

Deterministic, no network, no LLM, no randomness.

Returns a CoveragePlan with:
- 36 primary cells = energy{low,medium,high} x tempo{low,medium,high} x profile{4 families}
- band_ranges in secondary_spreads (§10.2)
- language_targets for demonstration: {ja:30, en:6, other:0}
- >=12 one-variable contrast pairs (each with variable + expected_direction)
- quotas (artists, albums, explicit, negatives, key:-1, eras, duration spread)
- era_targets with >=3 eras
- remaining (ledger-relative; with ledger=None, all 36 cells are remaining)
- enrichment_priority (empty when ledger=None)

FIREWALL: no score/rank/label/target field anywhere in the plan.
"""
from __future__ import annotations

from typing import Any

from mdg.models import CoverageCell, CoveragePlan, ContrastPairSpec

# ---------------------------------------------------------------------------
# Band ranges per §10.2
# ---------------------------------------------------------------------------

_ENERGY_BANDS: dict[str, list[float]] = {
    "low":    [0.10, 0.35],
    "medium": [0.40, 0.65],
    "high":   [0.70, 0.95],
}

_TEMPO_BANDS: dict[str, list[int]] = {
    "low":    [60,  95],
    "medium": [96,  130],
    "high":   [131, 180],
}

_PROFILE_FAMILIES = [
    "balanced_vocal",
    "danceable_vocal",
    "speech_forward",
    "instrumental_leaning",
]

# Short codes for cell_id generation
_ENERGY_CODE = {"low": "lo", "medium": "md", "high": "hi"}
_TEMPO_CODE  = {"low": "lo", "medium": "md", "high": "hi"}
_PROFILE_CODE = {
    "balanced_vocal":       "bv",
    "danceable_vocal":      "dv",
    "speech_forward":       "sf",
    "instrumental_leaning": "il",
}


def _make_cell_id(energy: str, tempo: str, profile: str) -> str:
    """Generate a stable, sortable cell_id from band names."""
    return (
        f"E-{_ENERGY_CODE[energy]}_"
        f"T-{_TEMPO_CODE[tempo]}_"
        f"P-{_PROFILE_CODE[profile]}"
    )


def _build_cells() -> list[CoverageCell]:
    """Build the 36 primary cells, sorted by cell_id for determinism."""
    cells = []
    for energy in ("low", "medium", "high"):
        for tempo in ("low", "medium", "high"):
            for profile in _PROFILE_FAMILIES:
                cells.append(CoverageCell(
                    cell_id=_make_cell_id(energy, tempo, profile),
                    energy_band=energy,
                    tempo_band=tempo,
                    profile_family=profile,
                ))
    # Sort by cell_id for stable ordering
    cells.sort(key=lambda c: c.cell_id)
    return cells


def _build_secondary_spreads() -> dict[str, Any]:
    """Build secondary_spreads including band_ranges and required spread axes."""
    return {
        "band_ranges": {
            "energy": {
                "low":    _ENERGY_BANDS["low"],
                "medium": _ENERGY_BANDS["medium"],
                "high":   _ENERGY_BANDS["high"],
            },
            "tempo": {
                "low":    _TEMPO_BANDS["low"],
                "medium": _TEMPO_BANDS["medium"],
                "high":   _TEMPO_BANDS["high"],
            },
        },
        "valence": {
            "description": "Spread low/mid/high valence across 36 cells, decorrelated from energy",
            "required_bands": ["low", "mid", "high"],
        },
        "mode": {
            "description": "Both minor (0) and major (1) at comparable valence",
            "required_values": [0, 1],
        },
        "acousticness": {
            "description": "Acoustic-leaning and electric-leaning at comparable energy/tempo",
            "required_bands": ["acoustic", "electric"],
        },
        "humming_ease": {
            "description": "Easy-to-hum and hard-to-hum songs (danceability/instrumentalness/speechiness proxy)",
            "required_bands": ["low", "high"],
        },
        "full_karaoke_ease": {
            "description": "Easy and hard full-karaoke songs (danceability/speechiness/duration/energy proxy)",
            "required_bands": ["low", "high"],
        },
        "genre": {
            "description": "All 12 genre_affinity_v1 vocabulary terms represented by >=1 artist",
            "vocabulary": [
                "j-pop", "j-rock", "city pop", "anime", "vocaloid",
                "enka", "children's music", "classical", "jazz",
                "ambient", "electronic", "japanese folk",
            ],
        },
    }


def _build_quotas() -> dict[str, Any]:
    """Build quota targets per §10.3 and §10.4."""
    return {
        "artists_count":            12,
        "tracks_per_artist":        3,
        "min_albums":               12,
        "min_eras":                 3,
        "min_explicit":             6,
        "min_negatives_outside_36": 4,
        "min_key_minus_one":        1,
        "duration_spread": {
            "description": "Short (<180s), medium (180-300s), long (>300s) tracks",
            "required_bands": ["short", "medium", "long"],
        },
        "time_signature_spread": {
            "description": "At least time signatures 3, 4, and one other value",
            "required_values": [3, 4],
            "min_others": 1,
        },
    }


def _build_language_targets(tier: str) -> dict[str, int]:
    """Return language targets per tier.

    Demonstration: {ja:30, en:6, other:0} per FR-002 and spec clarification.
    Smoke: small subset
    Stress: scaled proportionally
    """
    if tier == "demonstration":
        return {"ja": 30, "en": 6, "other": 0}
    elif tier == "smoke":
        return {"ja": 4, "en": 1, "other": 0}
    elif tier == "stress":
        # Scaled proportionally to 36 cells but configurable; default like demonstration
        return {"ja": 30, "en": 6, "other": 0}
    else:
        return {"ja": 30, "en": 6, "other": 0}


def _build_era_targets() -> dict[str, Any]:
    """Build era_targets with >=3 eras for age-affinity tests."""
    return {
        "classic":  {"description": "Pre-2000 releases", "min_tracks": 3},
        "modern":   {"description": "2000-2015 releases", "min_tracks": 6},
        "recent":   {"description": "2016+ releases",    "min_tracks": 6},
    }


def _build_contrast_pairs() -> list[ContrastPairSpec]:
    """Build the 12 required one-variable contrast pairs per §11 and §15.

    Each pair:
    - variable: the single variable that differs
    - expected_direction: what the reversal test expects
    - No score/rank/label in any field (firewall).

    Required variables from the brief:
    calm/active, bright/dark, acoustic/electric, easy-hum/hard-hum,
    short-mod/long-high-energy, and driver-context reversals.
    """
    pairs = [
        # 1. Drowsiness level — calm/active reversal (data spec §15)
        ContrastPairSpec(
            pair_id="pair-01-drowsiness",
            variable="drowsiness_level",
            world_a_ref="world-low-drowsiness",
            world_b_ref="world-high-drowsiness",
            expected_direction="reversal_calm_active",
        ),
        # 2. Fatigue level — calm/active reversal
        ContrastPairSpec(
            pair_id="pair-02-fatigue",
            variable="fatigue_level",
            world_a_ref="world-low-fatigue",
            world_b_ref="world-high-fatigue",
            expected_direction="reversal_calm_active",
        ),
        # 3. Traffic state — normal vs congested, calm/active reversal
        ContrastPairSpec(
            pair_id="pair-03-traffic",
            variable="traffic_state",
            world_a_ref="world-normal-traffic",
            world_b_ref="world-congested-traffic",
            expected_direction="reversal_calm_active",
        ),
        # 4. Road type — highway vs mountain, active/calm reversal
        ContrastPairSpec(
            pair_id="pair-04-road-type",
            variable="road_type",
            world_a_ref="world-highway",
            world_b_ref="world-mountain-road",
            expected_direction="reversal_active_calm",
        ),
        # 5. Valence + mode (bright vs dark at matched arousal)
        ContrastPairSpec(
            pair_id="pair-05-valence-mode",
            variable="valence_mode",
            world_a_ref="world-fatigue-stress",
            world_b_ref="world-fatigue-stress",
            expected_direction="bright_preferred_over_dark",
        ),
        # 6. Acousticness (acoustic vs electric at matched energy/tempo)
        ContrastPairSpec(
            pair_id="pair-06-acousticness",
            variable="acousticness",
            world_a_ref="world-high-arousal",
            world_b_ref="world-high-arousal",
            expected_direction="electric_higher_arousal_contribution",
        ),
        # 7. Humming ease (easy-hum vs hard-hum at matched arousal)
        ContrastPairSpec(
            pair_id="pair-07-humming-ease",
            variable="humming_ease",
            world_a_ref="world-humming-karaoke",
            world_b_ref="world-humming-karaoke",
            expected_direction="easy_hum_preferred",
        ),
        # 8. Full karaoke ease / duration (short-moderate vs long-high-energy)
        ContrastPairSpec(
            pair_id="pair-08-full-karaoke-ease-duration",
            variable="full_karaoke_ease_duration",
            world_a_ref="world-full-karaoke-stopped",
            world_b_ref="world-full-karaoke-stopped",
            expected_direction="short_moderate_vs_long_high_energy",
        ),
        # 9. Motion state (moving vs stopped — full karaoke eligibility)
        ContrastPairSpec(
            pair_id="pair-09-motion-state",
            variable="motion_state",
            world_a_ref="world-driving",
            world_b_ref="world-stopped",
            expected_direction="full_karaoke_eligibility_change",
        ),
        # 10. Child present (explicit exclusion)
        ContrastPairSpec(
            pair_id="pair-10-child-present",
            variable="child_present",
            world_a_ref="world-no-child",
            world_b_ref="world-child-present",
            expected_direction="explicit_excluded_when_child_present",
        ),
        # 11. Oshi mode (oshi artist enabled vs disabled)
        ContrastPairSpec(
            pair_id="pair-11-oshi-mode",
            variable="oshi_mode",
            world_a_ref="world-oshi-enabled",
            world_b_ref="world-oshi-disabled",
            expected_direction="oshi_boost_removed",
        ),
        # 12. Recent play history (absent vs present)
        ContrastPairSpec(
            pair_id="pair-12-recent-play",
            variable="recent_play",
            world_a_ref="world-no-recent-play",
            world_b_ref="world-recent-play-present",
            expected_direction="recency_suppression",
        ),
    ]
    return pairs


def _build_remaining_for_null_ledger(cells: list[CoverageCell]) -> dict[str, Any]:
    """With ledger=None, all cells are remaining (loop-1 behavior)."""
    return {
        "cells": [c.cell_id for c in cells],
        "quotas_met": {},
    }


def build_coverage_plan(
    tier: str,
    ledger: Any | None = None,
) -> CoveragePlan:
    """Build a deterministic coverage plan for the given tier.

    Parameters
    ----------
    tier:
        One of 'smoke', 'demonstration', 'stress'.
    ledger:
        Optional carry-over ledger (FR-003). With None (loop-1), everything is
        remaining. Full ledger-relative logic is a later slice.

    Returns
    -------
    CoveragePlan
        Deterministic, sorted, firewall-clean plan instance.
    """
    cells = _build_cells()  # sorted, deterministic
    secondary_spreads = _build_secondary_spreads()
    quotas = _build_quotas()
    language_targets = _build_language_targets(tier)
    era_targets = _build_era_targets()
    contrast_pairs = _build_contrast_pairs()  # deterministic list

    if ledger is None:
        remaining = _build_remaining_for_null_ledger(cells)
        enrichment_priority: list[str] = []
    else:
        # Ledger-relative logic (design §4.1/§4.13): subtract cells already filled by
        # accepted ledger entries → remaining; already-covered cells → enrichment.
        from mdg.ledger import accepted_cells as _accepted_cells

        covered = set(_accepted_cells(ledger))
        remaining = {
            "cells": sorted(c.cell_id for c in cells if c.cell_id not in covered),
            "quotas_met": {},
        }
        enrichment_priority = sorted(
            c.cell_id for c in cells if c.cell_id in covered
        )

    return CoveragePlan(
        cells=cells,
        secondary_spreads=secondary_spreads,
        quotas=quotas,
        language_targets=language_targets,
        era_targets=era_targets,
        contrast_pairs=contrast_pairs,
        remaining=remaining,
        enrichment_priority=enrichment_priority,
    )
