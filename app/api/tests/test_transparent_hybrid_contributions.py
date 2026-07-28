"""B1 — the hybrid trigger records the per-feature terms it computes.

Without these the review screen has no numeric trigger evidence at all and
would have to reconstruct contributions from a hardcoded weight table, which
the design forbids (acceptance criterion 9).
"""
from __future__ import annotations

import importlib.util
import json
import pathlib

_REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
_PKG_DIR = _REPO_ROOT / "packages" / "aica_transparent_hybrid_trigger_v1"


def _load_module():
    spec = importlib.util.spec_from_file_location(
        "hybrid_alg_contrib", _PKG_DIR / "algorithm.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


mod = _load_module()
HP = {
    hp["key"]: hp["default"]
    for hp in json.loads((_PKG_DIR / "package.json").read_text(encoding="utf-8"))["hyperparameters"]
}

# A feature vector well above the rest-bonus gate.
HIGH = {
    "drowsiness": 0.9, "fatigue": 0.8, "driving_anomaly": 0.4, "driving_time": 0.7,
    "env_load": 0.5, "monotony": 0.6, "rest_window": 0.5, "rest_scarcity": 0.3,
    "familiar_route": 1.0,
}
# A vector below the gate (base_safety_risk stays under minimum_risk_for_rest_bonus).
LOW = dict.fromkeys(HIGH, 0.0) | {"monotony": 0.4, "env_load": 0.1}


def _rows(result, category):
    return {r["feature_id"]: r for r in result["feature_contributions"][category]["rows"]}


def test_both_categories_are_recorded():
    out = mod.category_scores(HIGH, HP)
    assert set(out["feature_contributions"]) == {"rest_required", "monotony_prevention"}


def test_each_row_is_weight_times_value():
    out = mod.category_scores(HIGH, HP)
    for category in ("rest_required", "monotony_prevention"):
        for row in out["feature_contributions"][category]["rows"]:
            assert row["contribution"] == row["weight"] * row["value"], row["feature_id"]


def test_monotony_rows_are_exactly_its_three_terms():
    rows = _rows(mod.category_scores(HIGH, HP), "monotony_prevention")
    assert set(rows) == {"monotony", "env_load", "familiar_route"}
    assert rows["monotony"]["weight"] == HP["w_monotony"]
    assert rows["env_load"]["weight"] == HP["w_env_mono"]


def test_child_passenger_is_a_visible_pseudo_feature():
    rows = _rows(mod.category_scores(HIGH, HP, child_passenger=True), "rest_required")
    assert rows["child_passenger"]["value"] == 1.0
    assert rows["child_passenger"]["weight"] == HP["w_child_bonus"]
    assert rows["child_passenger"]["contribution"] == HP["w_child_bonus"]

    off = _rows(mod.category_scores(HIGH, HP, child_passenger=False), "rest_required")
    assert off["child_passenger"]["value"] == 0.0
    assert off["child_passenger"]["contribution"] == 0.0


def test_rest_bonus_gate_is_recorded_when_it_passes():
    out = mod.category_scores(HIGH, HP)
    gates = out["feature_contributions"]["rest_required"]["gates"]
    gate = next(g for g in gates if g["gate_id"] == "minimum_risk_for_rest_bonus")
    assert gate["passed"] is True
    assert gate["threshold"] == HP["minimum_risk_for_rest_bonus"]
    assert gate["effect"] == "allow"
    assert set(gate["evaluated_inputs"]) == {"base_safety_risk"}


def test_rest_bonus_gate_zeroes_its_terms_when_it_blocks():
    out = mod.category_scores(LOW, HP)
    gate = next(
        g for g in out["feature_contributions"]["rest_required"]["gates"]
        if g["gate_id"] == "minimum_risk_for_rest_bonus"
    )
    assert gate["passed"] is False
    assert gate["effect"] == "exclude"

    rows = _rows(out, "rest_required")
    # The features stay VISIBLE with their declared weight — a reviewer must be
    # able to see they were admitted-but-zeroed, not simply absent.
    assert rows["rest_window"]["contribution"] == 0.0
    assert rows["rest_scarcity"]["contribution"] == 0.0
    assert rows["rest_window"]["weight"] == HP["w_rest_window"]


def test_clamp_is_flagged_when_it_binds():
    saturated = dict.fromkeys(HIGH, 1.0)
    out = mod.category_scores(saturated, HP)
    block = out["feature_contributions"]["rest_required"]
    total = sum(r["contribution"] for r in block["rows"])
    assert total > block["score"]      # the clamp bit
    assert block["clamped"] is True


def test_clamp_flag_is_false_when_it_does_not_bind():
    out = mod.category_scores(LOW, HP)
    assert out["feature_contributions"]["monotony_prevention"]["clamped"] is False


def test_recorded_score_matches_the_reported_category_score():
    out = mod.category_scores(HIGH, HP)
    fc = out["feature_contributions"]
    assert fc["rest_required"]["score"] == out["rest_required_score"]
    assert fc["monotony_prevention"]["score"] == out["monotony_prevention_score"]


def test_evaluate_emits_contributions_with_bands():
    from tests.test_transparent_hybrid import _EMPTY_PH

    result = mod.evaluate({
        "simulation_time_sec": 3600.0,
        "signals": {
            "fixed": {"isNight": True, "familiarRoute": False, "weatherRiskLevel": 0.2},
            "dynamic": {"isTrafficJam": False, "nextRestSpotMin": 12.0,
                        "continuousDrivingMin": 120.0, "roadType": "highway", "speedKph": 90.0},
            "simulated": {"drowsiness": 78.0, "fatigue": 65.0, "anomaly_rate": 2.0},
        },
        "feature_groups": {"ordinal": {"drowsiness": "very_high", "fatigue": "high"}},
        "parameters": {}, "hyperparameters": HP,
        "proposal_history": _EMPTY_PH, "user_action_history": [],
        "package_runtime_state": {}, "recovery_active": False,
    })

    fc = result["feature_contributions"]
    assert set(fc) == {"rest_required", "monotony_prevention"}
    rows = {r["feature_id"]: r for r in fc["rest_required"]["rows"]}
    assert rows["drowsiness"]["band"] == "very_high"
    # A feature with no ordinal entry stays None — never a guessed band.
    assert rows["rest_window"]["band"] is None


def test_decision_result_model_preserves_the_field():
    from aica_api.models.decision import DecisionResult

    parsed = DecisionResult(
        result_type="NO_TRIGGER", trigger_candidate=False, selected_category=None,
        score=None, features={}, criteria={}, candidates=[],
        fire_control={"fired": False, "suppressed": False, "override": False, "reason": None},
        proposal=None, reason_inputs=[], explanation="",
        feature_contributions={"rest_required": {"score": 0.4, "clamped": False, "rows": [], "gates": []}},
    )
    assert parsed.feature_contributions["rest_required"]["score"] == 0.4


def test_field_defaults_empty_for_packages_that_do_not_emit_it():
    from aica_api.models.decision import DecisionResult

    parsed = DecisionResult(
        result_type="NO_TRIGGER", trigger_candidate=False, selected_category=None,
        score=None, features={}, criteria={}, candidates=[],
        fire_control={"fired": False, "suppressed": False, "override": False, "reason": None},
        proposal=None, reason_inputs=[], explanation="",
    )
    assert parsed.feature_contributions == {}
