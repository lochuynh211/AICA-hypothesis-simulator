"""P6 T012 — Scoring math (§3, §5, §10).

Numeric /100 evidence; six mood a_i = α·A_s + β·V_s; r_i = e_i·a_i; the §10 worked
block originally reproduced +0.187, retuned to +0.112283 by the 2026-07-19
`context_response_matrix` retune (drowsiness/monotony alpha-beta shift, highway
alpha zeroed, motion_driving response widened -- see
`test_worked_example_block_reproduces_0187`); all-neutral world → 0 block;
|a_i|≤1; valence β≥0; direct rows use a=+1.
"""
from __future__ import annotations

from tests.proposal.conftest import (
    load_catalog,
    load_content_selector,
    manifest_hyperparameters,
)

CS = load_content_selector()
HP = manifest_hyperparameters()
WORKED = load_catalog("fixtures/catalog/worked-example.json")  # single-song map is fine


def _dummy_entry(feature_id: str) -> dict:
    return {"feature_id": feature_id}


def _mood_leaf(leaf, snap, track, traits):
    return CS._feature_e_a(leaf, _dummy_entry(leaf), snap, track, traits, HP, None, False, None, None)


def test_numeric_drowsiness_evidence_is_value_over_100():
    snap = {"_service_id": "music_playlist", "situation": {"drowsiness_level": 80}}
    track = {"id": "x", "artists": []}
    traits = {"arousal_signed": 0.0, "valence_signed": 0.0, "arousal": 0.5, "valence": 0.5,
              "humming_ease": 0.5, "full_karaoke_ease": 0.5}
    e, a, meta = _mood_leaf("drowsiness", snap, track, traits)
    assert abs(e - 0.80) < 1e-12


def test_worked_example_block_reproduces_0187():
    # NOTE (2026-07-19): the §10 doc's block was +0.187 under the ORIGINAL
    # `context_response_matrix` (drowsiness alpha 0.8/beta 0.2, monotony
    # 0.9/0.1, road.highway.alpha 1.0, motion_driving -0.3/0). The retuned
    # matrix (drowsiness 0.55/0.45, monotony 0.6/0.4, road.highway.alpha
    # 0.0, motion_driving -0.5/0.45) moves the reproduced block to
    # +0.112283 on this same worked-example snapshot -- recomputed from the
    # current `context_response_matrix`, not the (now stale) doc figure.
    song = WORKED["synthetic-track-9001"]
    af = song["spotify_audio_features"]
    traits = CS.derive_traits(af, HP)
    # §10 world: drowsiness 80, fatigue 70, monotony 90, traffic congested, road highway, night.
    snap = {
        "_service_id": "humming_karaoke",
        "situation": {
            "drowsiness_level": 80, "fatigue_level": 70, "monotony_level": 90,
            "traffic_state": "congested", "road_type": "highway", "night_state": "night",
            "motion_state": "driving",
        },
    }
    track = song["spotify_track"]
    block_weights = {"drowsiness": 0.25, "fatigue": 0.20, "monotony": 0.20,
                     "traffic": 0.12, "road": 0.11, "night": 0.12}
    block = 0.0
    for leaf, w in block_weights.items():
        e, a, meta = _mood_leaf(leaf, snap, track, traits)
        block += w * (e * a)
    assert abs(block - 0.112283) < 1e-3


def test_all_neutral_world_zero_mood_block():
    song = WORKED["synthetic-track-9001"]
    traits = CS.derive_traits(song["spotify_audio_features"], HP)
    snap = {
        "_service_id": "music_playlist",
        "situation": {
            "drowsiness_level": 0, "fatigue_level": 0, "monotony_level": 0,
            "traffic_state": "normal", "road_type": "local", "night_state": "day",
            "motion_state": "stopped",
        },
    }
    track = song["spotify_track"]
    block = 0.0
    for leaf in ("drowsiness", "fatigue", "monotony", "traffic", "road", "night", "motion"):
        e, a, meta = _mood_leaf(leaf, snap, track, traits)
        block += e * a
    assert abs(block) < 1e-12


def test_context_response_matrix_bounds():
    crm = HP["context_response_matrix"]
    for key in ("drowsiness", "fatigue", "monotony", "traffic_congested", "night", "motion_driving"):
        row = crm[key]
        assert abs(row["alpha"]) + row["beta"] <= 1.0 + 1e-12, key
        assert row["beta"] >= 0.0, key
    for rtype, row in crm["road"].items():
        assert abs(row["alpha"]) + row["beta"] <= 1.0 + 1e-12, rtype
        assert row["beta"] >= 0.0, rtype


def test_response_coefficient_never_exceeds_one():
    song = WORKED["synthetic-track-9001"]
    traits = CS.derive_traits(song["spotify_audio_features"], HP)
    snap = {"_service_id": "humming_karaoke",
            "situation": {"drowsiness_level": 100, "fatigue_level": 100, "monotony_level": 100,
                          "traffic_state": "congested", "road_type": "highway", "night_state": "night",
                          "motion_state": "driving"}}
    track = song["spotify_track"]
    for leaf in ("drowsiness", "fatigue", "monotony", "traffic", "road", "night", "motion"):
        e, a, meta = _mood_leaf(leaf, snap, track, traits)
        assert -1.0 - 1e-12 <= a <= 1.0 + 1e-12, (leaf, a)


def test_exact_id_history_rows_use_response_plus_one():
    song = WORKED["synthetic-track-9001"]
    traits = CS.derive_traits(song["spotify_audio_features"], HP)
    track = song["spotify_track"]
    tid = track["id"]
    snap = {
        "_service_id": "music_playlist",
        "preference": {"catalog_item_usage_level": {tid: "high"}},
        "history": {"content_proposal_acceptance_rate": {tid: 80},
                    "content_recovery_rate": {tid: 90}},
    }
    for leaf in ("item_usage", "acceptance", "recovery"):
        e, a, meta = _mood_leaf(leaf, snap, track, traits)
        assert a == 1.0, leaf
        assert meta["exact_match"] is True
    # item usage 'high' → evidence +1
    e, a, _ = _mood_leaf("item_usage", snap, track, traits)
    assert abs(e - 1.0) < 1e-12
    # acceptance 80 → 2*80/100 - 1 = 0.6
    e, a, _ = _mood_leaf("acceptance", snap, track, traits)
    assert abs(e - 0.6) < 1e-12
