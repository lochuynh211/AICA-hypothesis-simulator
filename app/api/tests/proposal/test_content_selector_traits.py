"""P6 T007 — Trait derivation (§4.4, Table 1).

Column sums = 1; outputs in [0,1]; norm_tempo (arousal) vs tempo_ease (singability);
key/time_signature/liveness never affect any trait.
"""
from __future__ import annotations

import copy

from tests.proposal.conftest import (
    load_catalog,
    load_content_selector,
    manifest_hyperparameters,
)

CS = load_content_selector()
HP = manifest_hyperparameters()
CATALOG = load_catalog("fixtures/catalog/smoke-catalog.json")


def _af(track_id: str) -> dict:
    return CATALOG[track_id]["spotify_audio_features"]


def test_trait_columns_sum_to_one():
    matrix = HP["trait_composition_matrix"]
    for trait, weights in matrix.items():
        assert abs(sum(weights.values()) - 1.0) < 1e-12, trait


def test_trait_outputs_in_unit_interval():
    for tid in CATALOG:
        traits = CS.derive_traits(_af(tid), HP)
        for key in ("arousal", "valence", "humming_ease", "full_karaoke_ease"):
            assert 0.0 <= traits[key] <= 1.0, (tid, key, traits[key])
        assert abs(traits["arousal_signed"] - (2 * traits["arousal"] - 1)) < 1e-12
        assert abs(traits["valence_signed"] - (2 * traits["valence"] - 1)) < 1e-12


def test_norm_tempo_monotonic_but_tempo_ease_centered():
    # Song near 110 BPM has the highest tempo_ease; a 150 BPM song has higher arousal.
    fast = CS.derive_traits(_af("synthetic-track-1001"), HP)   # tempo 150
    mid = CS.derive_traits(_af("synthetic-track-1005"), HP)    # tempo 110
    # tempo_ease: 110 BPM is the ease centre, so the mid song eases higher than the fast one.
    assert mid["full_karaoke_ease"] > fast["full_karaoke_ease"]


def test_key_time_signature_liveness_do_not_affect_traits():
    af = copy.deepcopy(_af("synthetic-track-1005"))
    base = CS.derive_traits(af, HP)
    mutated = copy.deepcopy(af)
    mutated["key"] = (af["key"] + 3) % 12
    mutated["time_signature"] = 7 if af["time_signature"] != 7 else 3
    mutated["liveness"] = min(1.0, af["liveness"] + 0.5)
    after = CS.derive_traits(mutated, HP)
    assert after == base
