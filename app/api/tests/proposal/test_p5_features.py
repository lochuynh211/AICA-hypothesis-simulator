"""TDD: P5 Unit B T012 - per-feature normalization (FeatureNormalizer /
SceneResolver), algorithm doc §5.3/§5.7.
"""
from __future__ import annotations

import pytest

from tests.proposal.conftest import (
    build_service_context,
    load_service_manifest,
    load_worked_example_context,
    service_manifest_hyperparameters,
)

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
# SIGNED activation-need evidence: e = 2*(x/100)^gamma - 1  (alert -> -1, drowsy -> +1)
@pytest.mark.parametrize("raw,expected", [(0, -1.0), (100, 1.0), (50, None)])
def test_gamma_power_boundaries(service_selector, feature_id, gamma_key, raw, expected):
    hp = _HP()
    situation = {feature_id: raw}
    result = service_selector.resolve_scalar_evidence(feature_id, situation, hp, _PARAMS())
    if expected is not None:
        assert result["e"] == pytest.approx(expected, abs=1e-12)
    else:
        gamma = hp[gamma_key]
        assert result["e"] == pytest.approx(2.0 * (raw / 100.0) ** gamma - 1.0, abs=1e-12)
    assert result["status"] == "used"
    assert result["raw_value"] == raw


@pytest.mark.parametrize("gamma", [0.25, 0.50, 1.0, 3.00, 4.00])
def test_gamma_at_validation_bounds(service_selector, gamma):
    hp = dict(_HP())
    hp["gamma_drowsiness"] = gamma
    result = service_selector.resolve_scalar_evidence("drowsiness_level", {"drowsiness_level": 60}, hp, _PARAMS())
    assert result["e"] == pytest.approx(2.0 * (60 / 100.0) ** gamma - 1.0, abs=1e-12)


def test_gamma_power_missing_field_is_neutral(service_selector):
    result = service_selector.resolve_scalar_evidence("drowsiness_level", {}, _HP(), _PARAMS())
    assert result["e"] == 0.0
    assert result["status"] == "missing"
    assert result["raw_value"] is None


def test_gamma_power_present_zero_is_not_missing(service_selector):
    """Present raw 0 is a valid low value, not missing (doc §8). Under signed
    activation-need evidence, an alert (0) driver maps to e=-1.0 (prefers passive),
    distinct from a MISSING field (e=0.0, neutral)."""
    result = service_selector.resolve_scalar_evidence("fatigue_level", {"fatigue_level": 0}, _HP(), _PARAMS())
    assert result["status"] == "used"
    assert result["e"] == -1.0


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
# T022 (US2) - feature-gate completeness: every A.1 contract row is
# accounted for (used OR in unused_available_features), CDC-SU vs
# Additional-proposed provenance is distinguished, and the two confidence
# fields are reported unused while confidence_shrinkage_v1 is off.
# ---------------------------------------------------------------------------


def test_all_17_baseline_features_present_in_evidence_with_a_status(service_selector):
    """Every FEATURE_ORDER row appears in EVERY scored candidate's
    feature_contributions with a status in the SS14 enum - 0 rows silently
    dropped (doc SS17 acceptance criterion 7 / SS16 required test)."""
    context = load_worked_example_context()
    out = service_selector.evaluate(context)
    assert out["decision_type"] == "ranked_candidates"
    valid_statuses = {"used", "neutral", "zero_weight", "missing", "invalid"}
    for candidate in out["ranked_candidates"]:
        ids = {c["feature_id"] for c in candidate["feature_contributions"]}
        assert ids == set(service_selector.FEATURE_ORDER), candidate["candidate_id"]
        for c in candidate["feature_contributions"]:
            assert c["status"] in valid_statuses, (candidate["candidate_id"], c["feature_id"], c["status"])


def test_two_confidence_fields_are_unused_while_shrinkage_off(service_selector):
    """`service_proposal_acceptance_confidence`/`service_recovery_confidence`
    are present in the worked-example's `additional_proposed` group but are
    NOT among the 17 scored features -> reported in
    `unused_available_features` while `confidence_shrinkage_v1` is off (doc
    SS5.4 note / data-model.md, T022)."""
    context = load_worked_example_context()
    assert context["hyperparameters"]["confidence_shrinkage_v1"] is False
    out = service_selector.evaluate(context)
    assert "service_proposal_acceptance_confidence" in out["unused_available_features"]
    assert "service_recovery_confidence" in out["unused_available_features"]


def test_additional_simulator_features_reported_unused_not_dropped(service_selector):
    """Motion state, minutes-to-a-rest-spot, currently-active-service,
    recent rejections, and schedule (doc SS5.6 'additional-simulator'
    table) - when present in the world snapshot, none of these silently
    disappear; every one surfaces in `unused_available_features`."""
    situation = {
        "drowsiness_level": 40, "fatigue_level": 30, "traffic_state": "normal",
        "road_type": "local", "night_state": "day", "monotony_level": 20,
        "route_tags": [], "destination_tags": [], "child_present": False,
        "multiple_passengers": False,
        "motion_state": "driving",  # SS5.6 "Driving/stopped state" - platform eligibility fact
    }
    feature_snapshot = {
        "situation": situation,
        "preference": {"oshi_registered": False, "oshi_mode": "off"},
        "history": {
            "scheduled_event_type": "oshi_live",  # SS5.6 "Schedule (推しイベント等)"
        },
        "additional_proposed": {
            "estimated_min_until_rest_spot": 8,  # SS5.6 "Minutes until a rest spot"
            "active_service": None,  # SS5.6 "Currently active service"
            "recent_service_rejections": [],  # SS5.6 "Recent rejection / confidence"
            "service_proposal_acceptance_confidence": {},
            "service_recovery_confidence": {},
        },
    }
    context = build_service_context(
        allowed_service_ids=["music_playlist"],
        feature_snapshot=feature_snapshot,
    )
    out = service_selector.evaluate(context)
    for expected in (
        "motion_state",
        "scheduled_event_type",
        "estimated_min_until_rest_spot",
        "active_service",
        "recent_service_rejections",
        "service_proposal_acceptance_confidence",
        "service_recovery_confidence",
    ):
        assert expected in out["unused_available_features"], expected


def test_cdc_su_vs_additional_proposed_provenance_distinguished(service_selector):
    """The 17-row trace distinguishes CDC-SU-sourced response coefficients
    (e.g. `cdc_su_explicit` for drowsiness) from the Additional-proposed /
    direct-candidate-feature provenance (`cdc_su_direct_candidate_feature`
    for service recency/usage/scene-usage/acceptance/recovery, doc SS5.4) -
    both provenance families are present and distinct, never collapsed into
    one undifferentiated label."""
    context = load_worked_example_context()
    out = service_selector.evaluate(context)
    humming = next(c for c in out["ranked_candidates"] if c["candidate_id"] == "humming_karaoke")
    provenance_by_feature = {c["feature_id"]: c["response_provenance"] for c in humming["feature_contributions"]}

    assert provenance_by_feature["drowsiness_level"] == "cdc_su_explicit"
    for direct_feature in (
        "service_recency_state", "service_usage_level", "scene_service_usage_level",
        "service_proposal_acceptance_rate", "service_recovery_rate",
    ):
        assert provenance_by_feature[direct_feature] == "cdc_su_direct_candidate_feature"

    assert provenance_by_feature["drowsiness_level"] != provenance_by_feature["service_recency_state"]


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
