"""TDD: P5 Unit B T012 - per-feature normalization (FeatureNormalizer /
SceneResolver), algorithm doc §5.3/§5.7.
"""
from __future__ import annotations

import pytest

from tests.proposal.conftest import service_manifest_hyperparameters, load_service_manifest

_HP = service_manifest_hyperparameters
_PARAMS = lambda: load_service_manifest()["parameters"]  # noqa: E731


# ---------------------------------------------------------------------------
# gamma-power features: drowsiness / fatigue / monotony, incl. 0/100 boundaries
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("feature_id,gamma_key", [
    ("drowsiness_level", "gamma_drowsiness"),
    ("fatigue_level", "gamma_fatigue"),
    ("monotony_level", "gamma_monotony"),
])
@pytest.mark.parametrize("raw,expected", [(0, 0.0), (100, 1.0), (50, None)])
def test_gamma_power_boundaries(service_selector, feature_id, gamma_key, raw, expected):
    hp = _HP()
    situation = {feature_id: raw}
    result = service_selector.resolve_scalar_evidence(feature_id, situation, hp, _PARAMS())
    if expected is not None:
        assert result["e"] == pytest.approx(expected, abs=1e-12)
    else:
        gamma = hp[gamma_key]
        assert result["e"] == pytest.approx((raw / 100.0) ** gamma, abs=1e-12)
    assert result["status"] == "used"
    assert result["raw_value"] == raw


@pytest.mark.parametrize("gamma", [0.25, 0.50, 1.0, 3.00, 4.00])
def test_gamma_at_validation_bounds(service_selector, gamma):
    hp = dict(_HP())
    hp["gamma_drowsiness"] = gamma
    result = service_selector.resolve_scalar_evidence("drowsiness_level", {"drowsiness_level": 60}, hp, _PARAMS())
    assert result["e"] == pytest.approx((60 / 100.0) ** gamma, abs=1e-12)


def test_gamma_power_missing_field_is_neutral(service_selector):
    result = service_selector.resolve_scalar_evidence("drowsiness_level", {}, _HP(), _PARAMS())
    assert result["e"] == 0.0
    assert result["status"] == "missing"
    assert result["raw_value"] is None


def test_gamma_power_present_zero_is_not_missing(service_selector):
    """Present raw 0 is a valid low value, not missing (doc §8)."""
    result = service_selector.resolve_scalar_evidence("fatigue_level", {"fatigue_level": 0}, _HP(), _PARAMS())
    assert result["status"] == "used"
    assert result["e"] == 0.0


# ---------------------------------------------------------------------------
# categorical enums: traffic / road / night
# ---------------------------------------------------------------------------


def test_traffic_state_congested_normal(service_selector):
    hp, params = _HP(), _PARAMS()
    congested = service_selector.resolve_scalar_evidence("traffic_state", {"traffic_state": "congested"}, hp, params)
    normal = service_selector.resolve_scalar_evidence("traffic_state", {"traffic_state": "normal"}, hp, params)
    assert congested["e"] == 1.0
    assert normal["e"] == 0.0


def test_night_state_day_night(service_selector):
    hp, params = _HP(), _PARAMS()
    night = service_selector.resolve_scalar_evidence("night_state", {"night_state": "night"}, hp, params)
    day = service_selector.resolve_scalar_evidence("night_state", {"night_state": "day"}, hp, params)
    assert night["e"] == 1.0
    assert day["e"] == 0.0


@pytest.mark.parametrize("road", ["highway", "local", "mountain", "parking"])
def test_road_type_evidence_always_one_when_present(service_selector, road):
    result = service_selector.resolve_road_evidence({"road_type": road})
    assert result["e"] == 1.0
    assert result["status"] == "used"


def test_road_type_missing(service_selector):
    result = service_selector.resolve_road_evidence({})
    assert result["e"] == 0.0
    assert result["status"] == "missing"


# ---------------------------------------------------------------------------
# oshi: registered (one-directional) / mode (two-directional) + invalid combo
# ---------------------------------------------------------------------------


def test_oshi_registered_bool(service_selector):
    hp, params = _HP(), _PARAMS()
    t = service_selector.resolve_scalar_evidence("oshi_registered", {"oshi_registered": True}, hp, params)
    f = service_selector.resolve_scalar_evidence("oshi_registered", {"oshi_registered": False}, hp, params)
    assert t["e"] == 1.0
    assert f["e"] == 0.0


def test_oshi_mode_signed(service_selector):
    hp, params = _HP(), _PARAMS()
    on = service_selector.resolve_scalar_evidence("oshi_mode", {"oshi_mode": "on"}, hp, params)
    off = service_selector.resolve_scalar_evidence("oshi_mode", {"oshi_mode": "off"}, hp, params)
    assert on["e"] == 1.0
    assert off["e"] == -1.0


def test_oshi_invalid_state_rejected(service_selector):
    context = _minimal_context(service_selector, oshi_registered=False, oshi_mode="on")
    with pytest.raises(Exception):
        service_selector.evaluate(context)


# ---------------------------------------------------------------------------
# route / destination tag saturation, unknown tags
# ---------------------------------------------------------------------------


def test_route_tags_saturation_and_unknown(service_selector):
    hp, params = _HP(), _PARAMS()
    situation = {"route_tags": ["highway", "mountain", "not-a-real-tag"]}
    result = service_selector.resolve_scalar_evidence("route_tags", situation, hp, params)
    assert result["e"] == pytest.approx(1.0, abs=1e-12)  # 2 recognized / saturation(2) -> capped at 1
    assert result["unknown_tags"] == ["not-a-real-tag"]


def test_route_tags_empty_is_neutral(service_selector):
    hp, params = _HP(), _PARAMS()
    result = service_selector.resolve_scalar_evidence("route_tags", {"route_tags": []}, hp, params)
    assert result["e"] == 0.0


def test_destination_tags_all_unknown_is_neutral(service_selector):
    hp, params = _HP(), _PARAMS()
    result = service_selector.resolve_scalar_evidence(
        "destination_tags", {"destination_tags": ["nowhere-real"]}, hp, params
    )
    assert result["e"] == 0.0
    assert result["unknown_tags"] == ["nowhere-real"]


def test_route_tags_single_recognized_half_saturated(service_selector):
    hp, params = _HP(), _PARAMS()
    result = service_selector.resolve_scalar_evidence("route_tags", {"route_tags": ["highway"]}, hp, params)
    assert result["e"] == pytest.approx(0.5, abs=1e-12)


# ---------------------------------------------------------------------------
# usage / recency / acceptance / recovery ordinal & rate maps
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("level,expected", [("never", -1.0), ("low", -0.5), ("med", 0.25), ("high", 1.0)])
def test_usage_ordinal_map(service_selector, level, expected):
    hp, params = _HP(), _PARAMS()
    snapshot = {"preference": {"service_usage_level": {"music_playlist": level}}}
    result = service_selector.resolve_direct_evidence(
        "service_usage_level", "music_playlist", snapshot, hp, {}, params
    )
    assert result["e"] == pytest.approx(expected, abs=1e-12)


@pytest.mark.parametrize("state,expected", [("recent", 0.0), ("long_unused", 0.5), ("never", 1.0)])
def test_recency_ordinal_map(service_selector, state, expected):
    hp, params = _HP(), _PARAMS()
    snapshot = {"preference": {"service_recency_state": {"music_playlist": state}}}
    result = service_selector.resolve_direct_evidence(
        "service_recency_state", "music_playlist", snapshot, hp, {}, params
    )
    assert result["e"] == pytest.approx(expected, abs=1e-12)


@pytest.mark.parametrize("feature_id", ["service_proposal_acceptance_rate", "service_recovery_rate"])
@pytest.mark.parametrize("rate,expected", [(0, -1.0), (50, 0.0), (100, 1.0)])
def test_rate_maps_zero_fifty_hundred(service_selector, feature_id, rate, expected):
    hp, params = _HP(), _PARAMS()
    snapshot = {"history": {feature_id: {"music_playlist": rate}}}
    result = service_selector.resolve_direct_evidence(feature_id, "music_playlist", snapshot, hp, {}, params)
    assert result["e"] == pytest.approx(expected, abs=1e-12)


def test_missing_candidate_history_entry_is_neutral_disclosed(service_selector):
    hp, params = _HP(), _PARAMS()
    snapshot = {"history": {"service_recovery_rate": {}}}
    result = service_selector.resolve_direct_evidence(
        "service_recovery_rate", "music_playlist", snapshot, hp, {}, params
    )
    assert result["e"] == 0.0
    assert result["status"] == "missing_neutral"


# ---------------------------------------------------------------------------
# scene resolution + multi-scene mean
# ---------------------------------------------------------------------------


def test_scene_ids_derivation(service_selector):
    hp, params = _HP(), _PARAMS()
    situation = {
        "traffic_state": "congested", "road_type": "highway", "night_state": "night",
        "monotony_level": 75, "child_present": True, "multiple_passengers": True,
        "route_tags": ["highway"], "destination_tags": ["coast"],
    }
    scenes = service_selector.derive_scene_ids(situation, hp, params)
    assert scenes == [
        "traffic:congested", "road:highway", "time:night", "monotony:high",
        "passenger:child", "passenger:group", "route:highway", "destination:coast",
    ]


def test_scene_monotony_medium_vs_high_boundary(service_selector):
    hp, params = _HP(), _PARAMS()
    med = service_selector.derive_scene_ids({"monotony_level": 34}, hp, params)
    high = service_selector.derive_scene_ids({"monotony_level": 67}, hp, params)
    low = service_selector.derive_scene_ids({"monotony_level": 33}, hp, params)
    assert "monotony:medium" in med
    assert "monotony:high" in high
    assert low == []


def test_scene_usage_multi_scene_mean(service_selector):
    hp, params = _HP(), _PARAMS()
    usage_map = params["usage_ordinal_map"]
    scene_map = {
        "traffic:congested": {"music_playlist": "high"},   # +1.0
        "road:highway": {"music_playlist": "never"},        # -1.0
    }
    snapshot = {"preference": {"scene_service_usage_level": scene_map}}
    situation = {"traffic_state": "congested", "road_type": "highway"}
    result = service_selector.resolve_direct_evidence(
        "scene_service_usage_level", "music_playlist", snapshot, hp, situation, params
    )
    assert result["e"] == pytest.approx((usage_map["high"] + usage_map["never"]) / 2.0, abs=1e-12)
    assert result["status"] == "used"


def test_scene_usage_no_matching_record_is_missing(service_selector):
    hp, params = _HP(), _PARAMS()
    snapshot = {"preference": {"scene_service_usage_level": {}}}
    situation = {"traffic_state": "congested"}
    result = service_selector.resolve_direct_evidence(
        "scene_service_usage_level", "music_playlist", snapshot, hp, situation, params
    )
    assert result["e"] == 0.0
    assert result["status"] == "missing_neutral"


# ---------------------------------------------------------------------------
# helper
# ---------------------------------------------------------------------------


def _minimal_context(service_selector, *, oshi_registered: bool, oshi_mode: str) -> dict:
    manifest_hp = service_manifest_hyperparameters()
    manifest_params = load_service_manifest()["parameters"]
    return {
        "contract_version": "1.0.0",
        "opportunity_id": "op-test",
        "simulation_time": "2026-07-16T22:00:00Z",
        "trigger_purpose": "inattentive_driving_prevention_recovery",
        "lifecycle_stage": "active_driving_content",
        "allowed_service_ids": ["music_playlist"],
        "selected_service_id": None,
        "feature_snapshot": {
            "situation": {
                "drowsiness_level": 10, "fatigue_level": 10, "traffic_state": "normal",
                "road_type": "local", "night_state": "day", "monotony_level": 10,
                "route_tags": [], "destination_tags": [], "child_present": False,
                "multiple_passengers": False,
            },
            "preference": {"oshi_registered": oshi_registered, "oshi_mode": oshi_mode},
            "history": {},
            "additional_proposed": {},
        },
        "feature_provenance": {},
        "enabled_feature_extensions": [],
        "eligible_candidates": [{"candidate_id": "music_playlist"}],
        "excluded_candidates": [],
        "parameters": manifest_params,
        "hyperparameters": manifest_hp,
        "package_runtime_state": {},
        "catalog_version": "n/a",
        "run_seed": "seed-test",
    }
