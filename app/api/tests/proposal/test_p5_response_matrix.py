"""TDD: P5 Unit B T013 - every §5.2 response-matrix cell equals the doc's
published coefficient.

Reads `package.json`'s `service_response_profiles` / `road_response_profiles`
parameters DIRECTLY (never score-derived) and asserts them against the
algorithm doc §5.2.1 (driving), §5.2.2 (road), §5.2.4 (post-rest, all 5 incl.
`call_response_stopped`). §5.2.3 (during-rest actions) is INTENTIONALLY not
covered: those actions are not `ServiceId` members and the frozen matrix
resolves `during_rest_stopped` to an empty candidate family (Unit A CRITICAL
CONTEXT #3 / this package's `README.md` documented limitation).
"""
from __future__ import annotations

import math

import pytest

from tests.proposal.conftest import build_service_context, load_service_manifest

_ANCHOR = pytest.approx


@pytest.fixture(scope="module")
def profiles():
    manifest = load_service_manifest()
    return manifest["parameters"]["service_response_profiles"]


@pytest.fixture(scope="module")
def road_profiles():
    manifest = load_service_manifest()
    return manifest["parameters"]["road_response_profiles"]


# ---------------------------------------------------------------------------
# §5.2.1 driving matrix (6 candidates x 11 columns)
# ---------------------------------------------------------------------------

_DRIVING_MATRIX = {
    "music_playlist":        {"drowsiness_level": 0.0, "fatigue_level": 0.0, "traffic_state": 0.0, "night_state": 0.0, "monotony_level": 0.0, "route_tags": 1.0, "destination_tags": 1.0, "child_present": 0.0, "multiple_passengers": 0.0, "oshi_registered": 0.5, "oshi_mode": 0.5},
    "humming_karaoke":       {"drowsiness_level": 1.0, "fatigue_level": 1.0, "traffic_state": 1.0, "night_state": 1.0, "monotony_level": 1.0, "route_tags": 1.0, "destination_tags": 1.0, "child_present": 1.0, "multiple_passengers": 1.0, "oshi_registered": 0.5, "oshi_mode": 0.5},
    "call_response_driving": {"drowsiness_level": 1.0, "fatigue_level": 1.0, "traffic_state": 1.0, "night_state": 1.0, "monotony_level": 1.0, "route_tags": 0.0, "destination_tags": 0.0, "child_present": 1.0, "multiple_passengers": 1.0, "oshi_registered": 0.5, "oshi_mode": 0.5},
    "quiz":                  {"drowsiness_level": 1.0, "fatigue_level": 1.0, "traffic_state": 1.0, "night_state": 1.0, "monotony_level": 1.0, "route_tags": 0.0, "destination_tags": 0.0, "child_present": 1.0, "multiple_passengers": 1.0, "oshi_registered": 0.5, "oshi_mode": 0.5},
    "ranking_creation":      {"drowsiness_level": 1.0, "fatigue_level": 1.0, "traffic_state": 1.0, "night_state": 1.0, "monotony_level": 1.0, "route_tags": 0.0, "destination_tags": 0.0, "child_present": 1.0, "multiple_passengers": 1.0, "oshi_registered": 0.5, "oshi_mode": 0.5},
    "radio_style":           {"drowsiness_level": 0.0, "fatigue_level": 0.0, "traffic_state": 0.0, "night_state": 0.0, "monotony_level": 0.0, "route_tags": 0.0, "destination_tags": 0.0, "child_present": 0.0, "multiple_passengers": 0.0, "oshi_registered": 1.0, "oshi_mode": 1.0},
}


@pytest.mark.parametrize("candidate_id", list(_DRIVING_MATRIX))
def test_driving_matrix_cells(profiles, candidate_id):
    for feature_id, expected in _DRIVING_MATRIX[candidate_id].items():
        cell = profiles[candidate_id][feature_id]
        assert cell["coefficient"] == _ANCHOR(expected, abs=1e-12), f"{candidate_id}/{feature_id}"
        assert cell["provenance"], f"{candidate_id}/{feature_id} missing provenance"
        assert "source_reference" in cell


def test_slide67_preferred_driving_services_get_activation_1_0(profiles):
    for candidate_id in ("humming_karaoke", "call_response_driving", "quiz", "ranking_creation"):
        for feature_id in ("drowsiness_level", "fatigue_level", "traffic_state", "night_state", "monotony_level"):
            assert profiles[candidate_id][feature_id]["coefficient"] == 1.0


def test_route_supports_music_and_humming_only(profiles):
    for candidate_id in ("music_playlist", "humming_karaoke"):
        assert profiles[candidate_id]["route_tags"]["coefficient"] == 1.0
        assert profiles[candidate_id]["destination_tags"]["coefficient"] == 1.0
    for candidate_id in ("call_response_driving", "quiz", "ranking_creation", "radio_style"):
        assert profiles[candidate_id]["route_tags"]["coefficient"] == 0.0


def test_passengers_support_named_shared_services(profiles):
    for candidate_id in ("humming_karaoke", "call_response_driving", "quiz", "ranking_creation"):
        assert profiles[candidate_id]["child_present"]["coefficient"] == 1.0
        assert profiles[candidate_id]["multiple_passengers"]["coefficient"] == 1.0
    assert profiles["music_playlist"]["child_present"]["coefficient"] == 0.0
    assert profiles["radio_style"]["child_present"]["coefficient"] == 0.0


def test_radio_style_neutral_except_oshi(profiles):
    row = profiles["radio_style"]
    for feature_id in ("drowsiness_level", "fatigue_level", "traffic_state", "night_state", "monotony_level", "route_tags", "destination_tags", "child_present", "multiple_passengers"):
        assert row[feature_id]["coefficient"] == 0.0
    assert row["oshi_registered"]["coefficient"] == 1.0
    assert row["oshi_mode"]["coefficient"] == 1.0


def test_oshi_mode_off_yields_opposing_evidence_for_radio_style(service_selector):
    """Two-directional oshi_mode: off -> e=-1; radio's coefficient +1.0 means
    off produces r=-1.0 (opposing), not neutral.

    Unit B review finding (Minor, cleared by Unit G T033-T037 polish): the
    original version of this test only did standalone arithmetic against
    hardcoded literals (`e_off * a == -1.0`) and could never fail on a real
    coefficient regression in the package itself. This version resolves
    `radio_style`'s `oshi_mode` response THROUGH the real scorer
    (`evaluate()`, exercising `resolve_scalar_evidence` + `resolve_response`
    + the scoring loop together) against a world with `oshi_mode='off'`
    (`oshi_registered=True` so the input stays valid — SS5.7 oshi
    consistency), and asserts the resulting `feature_contribution` for that
    row is strictly negative — so a coefficient-sign or evidence-sign
    regression in `service_response_profiles['radio_style']['oshi_mode']`
    or in `resolve_scalar_evidence('oshi_mode', ...)` would actually fail
    this test."""
    context = build_service_context(
        trigger_purpose="inattentive_driving_prevention_recovery",
        lifecycle_stage="active_driving_content",
        allowed_service_ids=["radio_style"],
        feature_snapshot={"preference": {"oshi_registered": True, "oshi_mode": "off"}},
    )
    out = service_selector.evaluate(context)
    candidate = out["ranked_candidates"][0]
    assert candidate["candidate_id"] == "radio_style"
    row = next(c for c in candidate["feature_contributions"] if c["feature_id"] == "oshi_mode")

    assert row["normalized_evidence"] == pytest.approx(-1.0, abs=1e-12)
    assert row["response_coefficient"] == pytest.approx(1.0, abs=1e-12)
    assert row["normalized_feature_response"] == pytest.approx(-1.0, abs=1e-12)
    assert row["contribution"] < 0.0
    # the whole score is driven negative by this single opposing row, since
    # every other feature is absent (neutral) in this minimal snapshot.
    assert candidate["score"] < 0.0


# ---------------------------------------------------------------------------
# §5.2.2 road matrix
# ---------------------------------------------------------------------------

_ROAD_MATRIX = {
    "music_playlist":        {"highway": 0.0, "local": 0.0, "mountain": 0.5, "parking": 0.0},
    "humming_karaoke":       {"highway": 1.0, "local": 0.0, "mountain": -0.5, "parking": 0.0},
    "call_response_driving": {"highway": 1.0, "local": 0.0, "mountain": -0.5, "parking": 0.0},
    "quiz":                  {"highway": 1.0, "local": 0.0, "mountain": -1.0, "parking": 0.0},
    "ranking_creation":      {"highway": 1.0, "local": 0.0, "mountain": -1.0, "parking": 0.0},
    "radio_style":           {"highway": 0.0, "local": 0.0, "mountain": 0.5, "parking": 0.0},
}


@pytest.mark.parametrize("candidate_id", list(_ROAD_MATRIX))
def test_road_matrix_cells(road_profiles, candidate_id):
    for road_type, expected in _ROAD_MATRIX[candidate_id].items():
        cell = road_profiles[candidate_id][road_type]
        assert cell["coefficient"] == _ANCHOR(expected, abs=1e-12), f"{candidate_id}/{road_type}"
        assert cell["provenance"]
        assert "source_reference" in cell


def test_mountain_opposes_high_interaction_candidates(road_profiles):
    assert road_profiles["quiz"]["mountain"]["coefficient"] == -1.0
    assert road_profiles["ranking_creation"]["mountain"]["coefficient"] == -1.0
    assert road_profiles["humming_karaoke"]["mountain"]["coefficient"] == -0.5
    assert road_profiles["call_response_driving"]["mountain"]["coefficient"] == -0.5
    # low-interaction candidates are mildly SUPPORTED on mountain roads.
    assert road_profiles["music_playlist"]["mountain"]["coefficient"] == 0.5
    assert road_profiles["radio_style"]["mountain"]["coefficient"] == 0.5


# ---------------------------------------------------------------------------
# §5.2.4 post-rest matrix (5 candidates incl. call_response_stopped)
# ---------------------------------------------------------------------------

_POST_REST_MATRIX = {
    "live_viewing":          {"drowsiness_level": 0.5, "fatigue_level": 0.5, "route_tags": 0.0, "destination_tags": 0.0, "child_present": 1.0, "multiple_passengers": 1.0, "oshi_registered": 1.0, "oshi_mode": 1.0},
    "stretch_video":         {"drowsiness_level": 1.0, "fatigue_level": 1.0, "route_tags": 0.0, "destination_tags": 0.0, "child_present": 0.0, "multiple_passengers": 0.0, "oshi_registered": 0.0, "oshi_mode": 0.0},
    "full_karaoke":          {"drowsiness_level": 0.5, "fatigue_level": 0.5, "route_tags": 0.0, "destination_tags": 0.0, "child_present": 1.0, "multiple_passengers": 1.0, "oshi_registered": 1.0, "oshi_mode": 1.0},
    "call_response_stopped": {"drowsiness_level": 0.5, "fatigue_level": 0.5, "route_tags": 0.0, "destination_tags": 0.0, "child_present": 0.5, "multiple_passengers": 0.5, "oshi_registered": 0.0, "oshi_mode": 0.0},
    "oshi_reexperience":     {"drowsiness_level": 0.5, "fatigue_level": 0.5, "route_tags": 1.0, "destination_tags": 1.0, "child_present": 0.0, "multiple_passengers": 0.0, "oshi_registered": 1.0, "oshi_mode": 1.0},
}


@pytest.mark.parametrize("candidate_id", list(_POST_REST_MATRIX))
def test_post_rest_matrix_cells(profiles, candidate_id):
    for feature_id, expected in _POST_REST_MATRIX[candidate_id].items():
        cell = profiles[candidate_id][feature_id]
        assert cell["coefficient"] == _ANCHOR(expected, abs=1e-12), f"{candidate_id}/{feature_id}"
        assert cell["provenance"]
        assert "source_reference" in cell
    # night is explicitly 0 for every post-rest candidate (doc §5.2.4).
    assert profiles[candidate_id]["night_state"]["coefficient"] == 0.0


def test_call_response_stopped_is_a_supported_post_rest_candidate(profiles):
    assert "call_response_stopped" in profiles


def test_post_rest_route_supports_only_oshi_reexperience(profiles):
    for candidate_id in ("live_viewing", "stretch_video", "full_karaoke", "call_response_stopped"):
        assert profiles[candidate_id]["route_tags"]["coefficient"] == 0.0
        assert profiles[candidate_id]["destination_tags"]["coefficient"] == 0.0
    assert profiles["oshi_reexperience"]["route_tags"]["coefficient"] == 1.0
    assert profiles["oshi_reexperience"]["destination_tags"]["coefficient"] == 1.0


# ---------------------------------------------------------------------------
# direct features (§5.4): always +1.0, every candidate.
# ---------------------------------------------------------------------------

_DIRECT_FEATURES = [
    "service_recency_state", "service_usage_level", "scene_service_usage_level",
    "service_proposal_acceptance_rate", "service_recovery_rate",
]


def test_direct_features_are_always_1_0(profiles):
    for candidate_id, row in profiles.items():
        for feature_id in _DIRECT_FEATURES:
            cell = row[feature_id]
            assert cell["coefficient"] == 1.0, f"{candidate_id}/{feature_id}"
            assert cell["provenance"] == "cdc_su_direct_candidate_feature"


# ---------------------------------------------------------------------------
# completeness: every supported candidate has all 16 service_response_profiles
# cells + all 4 road_response_profiles cells; coefficients finite in [-1,1].
# ---------------------------------------------------------------------------


def test_every_candidate_has_full_16_cell_row(profiles):
    manifest = load_service_manifest()
    for candidate_id in manifest["supported_services"]:
        row = profiles[candidate_id]
        expected_keys = set(_DRIVING_MATRIX.get(candidate_id, _POST_REST_MATRIX.get(candidate_id, {}))) | set(_DIRECT_FEATURES)
        assert expected_keys.issubset(set(row)), candidate_id


def test_every_coefficient_finite_and_bounded(profiles, road_profiles):
    for candidate_id, row in profiles.items():
        for feature_id, cell in row.items():
            coef = cell["coefficient"]
            assert math.isfinite(coef), f"{candidate_id}/{feature_id}"
            assert -1.0 <= coef <= 1.0, f"{candidate_id}/{feature_id}"
    for candidate_id, row in road_profiles.items():
        for road_type, cell in row.items():
            coef = cell["coefficient"]
            assert math.isfinite(coef), f"{candidate_id}/{road_type}"
            assert -1.0 <= coef <= 1.0, f"{candidate_id}/{road_type}"
