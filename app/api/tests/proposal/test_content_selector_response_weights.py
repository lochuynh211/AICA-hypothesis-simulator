"""P6 T009 — Effective-weight resolution (§6).

Σ effective_weight = 1; masked leaves contribute 0 and renormalize; a purpose
multiplier on a masked subgroup creates no active weight; zero denominator invalid.
"""
from __future__ import annotations

import copy

import pytest

from tests.proposal.conftest import (
    build_content_context,
    load_catalog,
    load_content_selector,
    manifest_hyperparameters,
)

CS = load_content_selector()
HP = manifest_hyperparameters()
CATALOG = load_catalog("fixtures/catalog/smoke-catalog.json")


def test_effective_weights_sum_to_one_playlist():
    weights = CS.resolve_weights(HP, "music_playlist", "rest_recommended", False)
    active = [e["effective_weight"] for e in weights.values() if e["mask"] == 1]
    assert abs(sum(active) - 1.0) < 1e-12


def test_effective_weights_sum_to_one_karaoke():
    weights = CS.resolve_weights(HP, "humming_karaoke", "rest_recommended", False)
    active = [e["effective_weight"] for e in weights.values() if e["mask"] == 1]
    assert abs(sum(active) - 1.0) < 1e-12


def test_masked_leaves_contribute_zero_and_renormalize():
    playlist = CS.resolve_weights(HP, "music_playlist", "rest_recommended", False)
    # service_ease is karaoke-only => mask 0 for playlist, effective weight 0.
    assert playlist["service_ease"]["mask"] == 0
    assert playlist["service_ease"]["effective_weight"] == 0.0
    karaoke = CS.resolve_weights(HP, "humming_karaoke", "rest_recommended", False)
    assert karaoke["service_ease"]["mask"] == 1
    assert karaoke["service_ease"]["effective_weight"] > 0.0
    # active set still sums to 1 in both cases (renormalized)
    assert abs(sum(e["effective_weight"] for e in karaoke.values()) - 1.0) < 1e-12


def test_genre_leaves_masked_off_when_extension_disabled():
    off = CS.resolve_weights(HP, "music_playlist", "rest_recommended", False)
    on = CS.resolve_weights(HP, "music_playlist", "rest_recommended", True)
    assert off["route"]["mask"] == 0 and off["route"]["effective_weight"] == 0.0
    assert on["route"]["mask"] == 1 and on["route"]["effective_weight"] > 0.0


def test_purpose_multiplier_on_masked_subgroup_creates_no_weight():
    # novelty subgroup is entirely masked (mask 0); its purpose multiplier must not
    # produce any active weight.
    weights = CS.resolve_weights(HP, "music_playlist", "route_music", False)
    for leaf in ("item_recency", "tag_recency"):
        assert weights[leaf]["effective_weight"] == 0.0


def test_zero_denominator_is_invalid_configuration():
    hp = copy.deepcopy(HP)
    hp["content_category_weights"] = {"Situation": 0.0, "Preference": 0.0, "History": 0.0}
    ctx = build_content_context(
        selected_service_id="music_playlist",
        feature_snapshot={"catalog": CATALOG, "situation": {"motion_state": "stopped"}},
        hyperparameters=hp,
    )
    result = CS.evaluate(ctx)
    assert result["decision_type"] == "invalid_configuration"
