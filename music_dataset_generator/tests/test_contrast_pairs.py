"""T054 [US6] — the 12 one-variable contrast pairs (data-spec §15).

Exactly 12 required pairs; each pair's two worlds differ in exactly ONE controlled input
(the catalog, seed, trigger, and all other fields frozen), with a stated expected
direction.
"""
from __future__ import annotations

import pytest

from mdg.worlds import build_contrast_pairs


def _diff_fields(a: dict, b: dict, prefix: str = "") -> list[str]:
    """Return the leaf paths where two world dicts differ, ignoring world_id."""
    diffs: list[str] = []
    keys = set(a) | set(b)
    for key in keys:
        if key == "world_id":
            continue
        path = f"{prefix}{key}"
        va, vb = a.get(key), b.get(key)
        if isinstance(va, dict) and isinstance(vb, dict):
            diffs.extend(_diff_fields(va, vb, prefix=path + "."))
        elif va != vb:
            diffs.append(path)
    return diffs


@pytest.fixture
def bundle():
    return build_contrast_pairs(
        track_ids=[f"synthetic-track-{i:04d}" for i in range(1, 20)],
        artist_ids=[f"synthetic-artist-{i:04d}" for i in range(1, 13)],
    )


def test_exactly_12_pairs(bundle) -> None:
    assert len(bundle["pairs"]) == 12


def test_unique_pair_ids_and_directions(bundle) -> None:
    pairs = bundle["pairs"]
    assert len({p["pair_id"] for p in pairs}) == 12
    for p in pairs:
        assert p["expected_direction"]
        assert p["variable"]


def test_each_pair_differs_in_exactly_one_variable(bundle) -> None:
    worlds = {w["world_id"]: w for w in bundle["worlds"]}
    for pair in bundle["pairs"]:
        a = worlds[pair["world_a_ref"]]
        b = worlds[pair["world_b_ref"]]
        diffs = _diff_fields(a, b)
        assert len(diffs) == 1, f"pair {pair['pair_id']} differs in {diffs}, expected 1"


def test_required_variables_present(bundle) -> None:
    variables = {p["variable"] for p in bundle["pairs"]}
    for required in ("drowsiness_level", "fatigue_level", "traffic_state", "road_type",
                     "night_state", "monotony_level", "motion_state", "child_present",
                     "oshi_mode"):
        assert required in variables
