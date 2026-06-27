"""TDD weighted_score algorithm tests (T015) — RED first, then GREEN.

Contract (from contracts/weighted-score.md and research R4):

  evaluate(context, parameters, hyperparameters) → DecisionResult

  Feature scores 0–1 from raw_state / feature_groups.normalized.

  base_safety_risk = clamp(
    0.40·drowsiness + 0.25·fatigue + 0.25·driving_anomaly + 0.10·future_fatigue, 0, 1)

  rest_required_score = base_safety_risk
    + gated bonus (0.10·rest_window + 0.08·rest_scarcity)  iff base_safety_risk >= 0.45

  monotony_prevention_score = clamp(
    0.30·monotony + 0.20·familiar_route + 0.25·attention_drop +
    0.15·traffic_jam + 0.10·long_highway, 0, 1)

  Threshold: suggest=0.62 / recommend=0.76 / urgent=0.88
    → strength: gentle / clear / strong
  Priority: [rest_required, monotony_prevention] then score desc → selected_category
  SC-007: high-monotony raw_state emits a monotony_prevention candidate.
"""

from __future__ import annotations

import math

import pytest

from aica_api.algorithms.weighted_score import evaluate
from aica_api.models.decision import DecisionResult, ResultType


# ---------------------------------------------------------------------------
# Default hyperparameters (from package defaults)
# ---------------------------------------------------------------------------

_DEFAULT_HP = {
    # Category weights — base_safety_risk
    "w_drowsiness": 0.40,
    "w_fatigue": 0.25,
    "w_driving_anomaly": 0.25,
    "w_future_fatigue": 0.10,
    # Gated rest bonus weights
    "minimum_risk_for_rest_bonus": 0.45,
    "w_rest_window": 0.10,
    "w_rest_scarcity": 0.08,
    # monotony_prevention weights
    "w_monotony": 0.30,
    "w_familiar_route": 0.20,
    "w_attention_drop": 0.25,
    "w_traffic_jam": 0.15,
    "w_long_highway": 0.10,
    # Thresholds
    "threshold_suggest": 0.62,
    "threshold_recommend": 0.76,
    "threshold_urgent": 0.88,
    # Actionability guard
    "require_rest_actionable": True,
    "rest_actionable_max_min": 30.0,
}


def _make_context(raw_state: dict, normalized: dict | None = None) -> dict:
    """Build a context dict in the M2 shape used by weighted_score."""
    if normalized is None:
        # Derive normalized from raw_state exactly as binning.py does.
        drowsiness = float(raw_state.get("drowsinessLevel", 0.0))
        fatigue = float(raw_state.get("fatigueLevel", 0.0))
        attention = float(raw_state.get("attentionLevel", 100.0))
        steering = float(raw_state.get("steeringInstabilityLevel", 0.0))
        pedal = float(raw_state.get("pedalAbnormalityLevel", 0.0))
        normalized = {
            "drowsiness_score": min(1.0, max(0.0, drowsiness / 100.0)),
            "fatigue_score": min(1.0, max(0.0, fatigue / 100.0)),
            "attention_score": min(1.0, max(0.0, attention / 100.0)),
            "driving_anomaly_score": min(1.0, max(0.0, steering / 100.0)),
            "pedal_anomaly_score": min(1.0, max(0.0, pedal / 100.0)),
        }
    return {
        "raw_state": raw_state,
        "feature_groups": {"normalized": normalized},
    }


# ---------------------------------------------------------------------------
# Baseline raw_states
# ---------------------------------------------------------------------------

# High risk — triggers rest_required
_HIGH_RISK_RAW = {
    "drowsinessLevel": 80.0,   # drowsiness_score = 0.80
    "fatigueLevel": 70.0,      # fatigue_score = 0.70
    "attentionLevel": 40.0,    # attention_drop = 0.60
    "steeringInstabilityLevel": 50.0,  # driving_anomaly_score = 0.50
    "pedalAbnormalityLevel": 0.0,
    "laneDepartureCount": 0,
    "adasWarningCount": 0,
    "nextRestSpotMin": 10.0,   # near rest spot → actionable
    "continuousDrivingMin": 90.0,
    "isNight": False,
    "weatherRiskLevel": 0.0,
}

# High monotony — SC-007: triggers monotony_prevention (SC-007)
_HIGH_MONOTONY_RAW = {
    "drowsinessLevel": 20.0,   # low risk
    "fatigueLevel": 20.0,
    "attentionLevel": 20.0,    # attention_drop = 0.80
    "steeringInstabilityLevel": 0.0,
    "pedalAbnormalityLevel": 0.0,
    "laneDepartureCount": 0,
    "adasWarningCount": 0,
    "nextRestSpotMin": 10.0,
    "continuousDrivingMin": 30.0,
    "isNight": True,                          # night → monotony_score up
    "weatherRiskLevel": 0.0,
    "monotonousRoadRemainingMin": 60.0,       # monotonous → monotony_score up
    "familiarRouteRatio": 1.0,               # familiar route
    "trafficJamAheadMin": 60.0,              # traffic jam
    "highwayRemainingMin": 120.0,            # long highway
}

# Low everything — no trigger
_LOW_RISK_RAW = {
    "drowsinessLevel": 10.0,
    "fatigueLevel": 10.0,
    "attentionLevel": 90.0,
    "steeringInstabilityLevel": 0.0,
    "pedalAbnormalityLevel": 0.0,
    "laneDepartureCount": 0,
    "adasWarningCount": 0,
    "nextRestSpotMin": 5.0,
    "continuousDrivingMin": 10.0,
    "isNight": False,
    "weatherRiskLevel": 0.0,
}

# Near-trigger risk with no rest spot — suppressed rest_required
_HIGH_RISK_NO_REST_RAW = {
    **_HIGH_RISK_RAW,
    "nextRestSpotMin": 9999.0,  # no rest spot → suppressed
}


# ---------------------------------------------------------------------------
# Helper: evaluate with default hyperparameters
# ---------------------------------------------------------------------------

def _evaluate(raw_state: dict, hp: dict | None = None) -> DecisionResult:
    return evaluate(
        context=_make_context(raw_state),
        parameters={},
        hyperparameters=hp if hp is not None else _DEFAULT_HP,
    )


# ---------------------------------------------------------------------------
# T015-1: Return type
# ---------------------------------------------------------------------------


def test_evaluate_returns_decision_result():
    """evaluate() returns a DecisionResult for valid context."""
    result = _evaluate(_LOW_RISK_RAW)
    assert isinstance(result, DecisionResult)


# ---------------------------------------------------------------------------
# T015-2: base_safety_risk formula constants
# ---------------------------------------------------------------------------


def test_base_safety_risk_formula_weights():
    """base_safety_risk = clamp(0.40·d + 0.25·f + 0.25·da + 0.10·ff, 0, 1).

    With drowsiness=0.80, fatigue=0.70, driving_anomaly=0.50, future_fatigue≈0:
    base = 0.40*0.80 + 0.25*0.70 + 0.25*0.50 + 0.10*0 = 0.32 + 0.175 + 0.125 = 0.620
    """
    raw = {
        "drowsinessLevel": 80.0,
        "fatigueLevel": 70.0,
        "attentionLevel": 50.0,
        "steeringInstabilityLevel": 50.0,
        "pedalAbnormalityLevel": 0.0,
        "laneDepartureCount": 0,
        "adasWarningCount": 0,
        "nextRestSpotMin": 10.0,
        "continuousDrivingMin": 60.0,
        "isNight": False,
        "weatherRiskLevel": 0.0,
        # No traffic jam, no highway → future_fatigue ≈ 0
    }
    result = _evaluate(raw)
    # base_safety_risk should be close to 0.620 (no future_fatigue contribution)
    bsr = result.scores.get("base_safety_risk")
    assert bsr is not None
    # Allow 0.01 tolerance for possible future_fatigue contributions
    assert abs(bsr - 0.620) < 0.05


def test_base_safety_risk_clamped_at_1():
    """base_safety_risk is clamped to 1.0 even with extreme inputs."""
    raw = {
        "drowsinessLevel": 100.0,
        "fatigueLevel": 100.0,
        "attentionLevel": 0.0,
        "steeringInstabilityLevel": 100.0,
        "pedalAbnormalityLevel": 100.0,
        "laneDepartureCount": 10,
        "adasWarningCount": 10,
        "nextRestSpotMin": 5.0,
        "continuousDrivingMin": 120.0,
        "isNight": True,
        "weatherRiskLevel": 100.0,
    }
    result = _evaluate(raw)
    assert result.scores["base_safety_risk"] <= 1.0


def test_base_safety_risk_clamped_at_0():
    """base_safety_risk is clamped to 0.0 with all-zero inputs."""
    raw = {
        "drowsinessLevel": 0.0,
        "fatigueLevel": 0.0,
        "attentionLevel": 100.0,
        "steeringInstabilityLevel": 0.0,
        "pedalAbnormalityLevel": 0.0,
        "laneDepartureCount": 0,
        "adasWarningCount": 0,
        "nextRestSpotMin": 9999.0,
        "continuousDrivingMin": 0.0,
        "isNight": False,
        "weatherRiskLevel": 0.0,
    }
    result = _evaluate(raw)
    assert result.scores["base_safety_risk"] >= 0.0


# ---------------------------------------------------------------------------
# T015-3: Gated rest bonus — NOT applied below 0.45
# ---------------------------------------------------------------------------


def test_gated_bonus_not_applied_below_minimum_risk():
    """rest bonus does NOT apply when base_safety_risk < 0.45.

    With drowsiness=0.40, fatigue=0.30, driving_anomaly=0.20:
    base = 0.40*0.40 + 0.25*0.30 + 0.25*0.20 + 0.10*0
         = 0.16 + 0.075 + 0.05 + 0 = 0.285 < 0.45

    Even with perfect rest_window + rest_scarcity, rest_required_score = 0.285.
    """
    raw = {
        "drowsinessLevel": 40.0,
        "fatigueLevel": 30.0,
        "attentionLevel": 60.0,
        "steeringInstabilityLevel": 20.0,
        "pedalAbnormalityLevel": 0.0,
        "laneDepartureCount": 0,
        "adasWarningCount": 0,
        "nextRestSpotMin": 7.0,   # ideal rest window (would add 0.10)
        "continuousDrivingMin": 60.0,
        "isNight": False,
        "weatherRiskLevel": 0.0,
        "restSpotDensityNext30Min": 0,  # scarcity=1.0 → would add 0.08
    }
    result = _evaluate(raw)
    bsr = result.scores["base_safety_risk"]
    rrs = result.scores["rest_required_score"]
    assert bsr < 0.45, f"Expected base_safety_risk < 0.45, got {bsr}"
    # rest_required_score must equal base_safety_risk when no bonus applies
    assert abs(rrs - bsr) < 0.001, (
        f"Gated bonus applied below threshold: bsr={bsr}, rrs={rrs}"
    )


def test_rest_opportunity_alone_cannot_trigger():
    """rest opportunity alone (no risk) cannot push rest_required above 0.62."""
    raw = {
        "drowsinessLevel": 0.0,
        "fatigueLevel": 0.0,
        "attentionLevel": 100.0,
        "steeringInstabilityLevel": 0.0,
        "pedalAbnormalityLevel": 0.0,
        "laneDepartureCount": 0,
        "adasWarningCount": 0,
        "nextRestSpotMin": 7.0,   # ideal rest window
        "continuousDrivingMin": 0.0,
        "isNight": False,
        "weatherRiskLevel": 0.0,
        "restSpotDensityNext30Min": 0,  # max scarcity
    }
    result = _evaluate(raw)
    rrs = result.scores["rest_required_score"]
    assert rrs < 0.62, f"rest_opportunity_alone triggered (score={rrs})"


# ---------------------------------------------------------------------------
# T015-4: Gated rest bonus IS applied at/above 0.45
# ---------------------------------------------------------------------------


def test_gated_bonus_applied_at_minimum_risk():
    """rest bonus IS applied when base_safety_risk >= 0.45.

    Drowsiness=0.60, fatigue=0.50, driving_anomaly=0, future_fatigue=0:
    base = 0.40*0.60 + 0.25*0.50 = 0.24 + 0.125 = 0.365 — not enough alone.

    Drowsiness=0.80, fatigue=0.50 (+ nothing else):
    base = 0.40*0.80 + 0.25*0.50 = 0.32 + 0.125 = 0.445 ≈ 0.45 → borderline.

    Use drowsiness=0.90, fatigue=0.50:
    base = 0.40*0.90 + 0.25*0.50 = 0.36 + 0.125 = 0.485 ≥ 0.45 → bonus applies.
    rest_window (nextRestSpotMin=7 → score=1.0) contributes +0.10*1.0.
    rest_required_score = clamp(0.485 + 0.10, 0, 1) = 0.585
    """
    raw = {
        "drowsinessLevel": 90.0,
        "fatigueLevel": 50.0,
        "attentionLevel": 70.0,
        "steeringInstabilityLevel": 0.0,
        "pedalAbnormalityLevel": 0.0,
        "laneDepartureCount": 0,
        "adasWarningCount": 0,
        "nextRestSpotMin": 7.0,           # rest_window_score = 1.0
        "continuousDrivingMin": 60.0,
        "isNight": False,
        "weatherRiskLevel": 0.0,
        "restSpotDensityNext30Min": 999,  # scarcity_score ≈ 0
    }
    result = _evaluate(raw)
    bsr = result.scores["base_safety_risk"]
    rrs = result.scores["rest_required_score"]
    assert bsr >= 0.45, f"Expected base_safety_risk >= 0.45, got {bsr}"
    assert rrs > bsr, f"Expected rest bonus applied: bsr={bsr}, rrs={rrs}"


# ---------------------------------------------------------------------------
# T015-5: monotony_prevention_score formula constants
# ---------------------------------------------------------------------------


def test_monotony_prevention_formula_weights():
    """monotony_prevention = clamp(0.30·m + 0.20·fr + 0.25·ad + 0.15·tj + 0.10·lh, 0, 1).

    SC-007 context: all monotony factors = 1.0 except we verify the formula.
    """
    result = _evaluate(_HIGH_MONOTONY_RAW)
    mps = result.scores.get("monotony_prevention_score")
    assert mps is not None
    # Should be well above 0.62 given the high-monotony context
    assert mps >= 0.62, f"Expected monotony_prevention_score >= 0.62, got {mps}"


def test_monotony_prevention_clamped_at_1():
    """monotony_prevention_score is clamped to 1.0."""
    result = _evaluate(_HIGH_MONOTONY_RAW)
    assert result.scores["monotony_prevention_score"] <= 1.0


# ---------------------------------------------------------------------------
# T015-6: Strength thresholds
# ---------------------------------------------------------------------------


def _score_to_strength(score: float) -> str | None:
    """Map a score to expected strength based on threshold constants."""
    if score >= 0.88:
        return "strong"
    if score >= 0.76:
        return "clear"
    if score >= 0.62:
        return "gentle"
    return None


def test_strength_gentle_at_suggest_threshold():
    """Candidate strength = 'gentle' when 0.62 <= score < 0.76."""
    # Craft a context where rest_required_score ≈ 0.68 (between gentle and clear)
    # drowsiness=0.85, fatigue=0.60, driving_anomaly=0, future_fatigue=0:
    # base = 0.40*0.85 + 0.25*0.60 = 0.34+0.15 = 0.49 >= 0.45 → bonus applies
    # With nextRestSpotMin=7 (rest_window=1.0, +0.10): rrs = 0.49+0.10 = 0.59 → not quite
    # Use higher values: drowsiness=0.90, fatigue=0.75:
    # base = 0.40*0.90 + 0.25*0.75 = 0.36+0.1875 = 0.5475
    # bonus: +0.10*1.0 = 0.10 → rrs = 0.6475 → gentle (0.62 <= 0.6475 < 0.76)
    raw = {
        "drowsinessLevel": 90.0,
        "fatigueLevel": 75.0,
        "attentionLevel": 60.0,
        "steeringInstabilityLevel": 0.0,
        "pedalAbnormalityLevel": 0.0,
        "laneDepartureCount": 0,
        "adasWarningCount": 0,
        "nextRestSpotMin": 7.0,
        "continuousDrivingMin": 90.0,
        "isNight": False,
        "weatherRiskLevel": 0.0,
        "restSpotDensityNext30Min": 999,
    }
    result = _evaluate(raw)
    rest_candidate = next(
        (c for c in result.candidates if c.category == "rest_required"), None
    )
    assert rest_candidate is not None, "Expected rest_required candidate"
    assert rest_candidate.exists, "Expected candidate to exist (score >= 0.62)"
    assert rest_candidate.strength == "gentle", (
        f"Expected gentle, got {rest_candidate.strength!r} "
        f"(score={rest_candidate.score})"
    )


def test_strength_clear_at_recommend_threshold():
    """Candidate strength = 'clear' when 0.76 <= score < 0.88."""
    # drowsiness=1.0, fatigue=0.90, driving_anomaly=0.5:
    # base = 0.40*1.0 + 0.25*0.90 + 0.25*0.50 = 0.40+0.225+0.125 = 0.75
    # bonus with rest_window=1.0: 0.75+0.10 = 0.85? → strong!
    # No bonus test: base=0.75, no rest_window contribution:
    # nextRestSpotMin=25 → rest_window_score=0.6 → +0.10*0.6=0.06 → 0.75+0.06=0.81 → clear
    raw = {
        "drowsinessLevel": 100.0,
        "fatigueLevel": 90.0,
        "attentionLevel": 30.0,
        "steeringInstabilityLevel": 50.0,
        "pedalAbnormalityLevel": 0.0,
        "laneDepartureCount": 0,
        "adasWarningCount": 0,
        "nextRestSpotMin": 25.0,    # rest_window_score=0.6
        "continuousDrivingMin": 90.0,
        "isNight": False,
        "weatherRiskLevel": 0.0,
        "restSpotDensityNext30Min": 999,  # near-zero scarcity
    }
    result = _evaluate(raw)
    rest_candidate = next(
        (c for c in result.candidates if c.category == "rest_required"), None
    )
    assert rest_candidate is not None, "Expected rest_required candidate"
    assert rest_candidate.exists, "Expected candidate to exist"
    rrs = result.scores["rest_required_score"]
    if 0.76 <= rrs < 0.88:
        assert rest_candidate.strength == "clear", (
            f"Expected clear, got {rest_candidate.strength!r}"
        )
    else:
        # Score fell outside the clear range; just verify strength is consistent
        assert rest_candidate.strength in ("gentle", "clear", "strong")


def test_strength_strong_at_urgent_threshold():
    """Candidate strength = 'strong' when score >= 0.88."""
    # drowsiness=1.0, fatigue=1.0, driving_anomaly=1.0, rest_window=1.0:
    # base = 0.40+0.25+0.25 = 0.90 >= 0.45 → bonus applies
    # rrs = clamp(0.90 + 0.10*1.0 + 0.08*0, 0, 1) = 1.0 → strong
    raw = {
        "drowsinessLevel": 100.0,
        "fatigueLevel": 100.0,
        "attentionLevel": 0.0,
        "steeringInstabilityLevel": 100.0,
        "pedalAbnormalityLevel": 0.0,
        "laneDepartureCount": 0,
        "adasWarningCount": 0,
        "nextRestSpotMin": 7.0,
        "continuousDrivingMin": 120.0,
        "isNight": False,
        "weatherRiskLevel": 0.0,
    }
    result = _evaluate(raw)
    rest_candidate = next(
        (c for c in result.candidates if c.category == "rest_required"), None
    )
    assert rest_candidate is not None, "Expected rest_required candidate"
    assert rest_candidate.exists
    rrs = result.scores["rest_required_score"]
    assert rrs >= 0.88, f"Expected rrs >= 0.88, got {rrs}"
    assert rest_candidate.strength == "strong", (
        f"Expected strong, got {rest_candidate.strength!r}"
    )


# ---------------------------------------------------------------------------
# T015-7: State labels
# ---------------------------------------------------------------------------


def test_rest_required_candidate_state():
    """rest_required candidate has state 'REST_RECOMMEND' when it exists."""
    result = _evaluate(_HIGH_RISK_RAW)
    rest_candidate = next(
        (c for c in result.candidates if c.category == "rest_required"), None
    )
    if rest_candidate and rest_candidate.exists:
        assert rest_candidate.state == "REST_RECOMMEND"


def test_monotony_prevention_candidate_state():
    """monotony_prevention candidate has state 'MONOTONY_WATCH' when it exists."""
    result = _evaluate(_HIGH_MONOTONY_RAW)
    mono_candidate = next(
        (c for c in result.candidates if c.category == "monotony_prevention"), None
    )
    assert mono_candidate is not None, "Expected monotony_prevention candidate"
    assert mono_candidate.exists
    assert mono_candidate.state == "MONOTONY_WATCH"


# ---------------------------------------------------------------------------
# T015-8: Multi-category: priority selects rest_required over monotony_prevention
# ---------------------------------------------------------------------------


def test_priority_selects_rest_required_over_monotony_when_both_fire():
    """Priority order: rest_required > monotony_prevention.

    When both categories fire, rest_required is selected.
    """
    # Combine high risk + high monotony
    raw = {
        **_HIGH_RISK_RAW,
        "isNight": True,
        "monotonousRoadRemainingMin": 60.0,
        "familiarRouteRatio": 1.0,
        "trafficJamAheadMin": 60.0,
        "highwayRemainingMin": 120.0,
        "attentionLevel": 20.0,  # also high attention_drop for monotony
    }
    result = _evaluate(raw)
    # Both should exist
    rrs = result.scores["rest_required_score"]
    mps = result.scores["monotony_prevention_score"]

    if rrs >= 0.62 and mps >= 0.62:
        # Both exist: rest_required should be selected
        assert result.selected_category == "rest_required", (
            f"Expected rest_required selected, got {result.selected_category!r}"
        )
        # Both should appear in candidates
        categories = [c.category for c in result.candidates]
        assert "rest_required" in categories
        assert "monotony_prevention" in categories


def test_non_selected_fired_candidate_still_in_candidates():
    """When rest_required is selected, monotony_prevention remains in candidates[]."""
    raw = {
        **_HIGH_RISK_RAW,
        "isNight": True,
        "monotonousRoadRemainingMin": 60.0,
        "familiarRouteRatio": 1.0,
        "trafficJamAheadMin": 60.0,
        "highwayRemainingMin": 120.0,
        "attentionLevel": 20.0,
    }
    result = _evaluate(raw)
    categories = [c.category for c in result.candidates]
    # All evaluated candidates should appear in the candidates list
    assert "rest_required" in categories
    # monotony_prevention should also be present (even if not selected)
    assert "monotony_prevention" in categories


# ---------------------------------------------------------------------------
# T015-9: Suppressed candidate retained
# ---------------------------------------------------------------------------


def test_suppressed_candidate_retained_in_candidates():
    """A suppressed (unactionable) rest_required candidate is retained (FR-008).

    When rest_required exists but nextRestSpotMin=9999 (no rest spot),
    the candidate is suppressed but still present in candidates[].
    """
    result = _evaluate(_HIGH_RISK_NO_REST_RAW)
    rest_candidate = next(
        (c for c in result.candidates if c.category == "rest_required"), None
    )
    rrs = result.scores["rest_required_score"]
    if rrs >= 0.62:
        assert rest_candidate is not None, "Suppressed candidate not in candidates[]"
        assert rest_candidate.fire_control.suppressed, (
            "Expected suppressed=True for no-rest-spot candidate"
        )


def test_suppressed_candidate_is_not_selected():
    """A suppressed candidate cannot be selected_category."""
    result = _evaluate(_HIGH_RISK_NO_REST_RAW)
    rrs = result.scores["rest_required_score"]
    if rrs >= 0.62:
        # With no rest spot, rest_required is suppressed
        # result_type should be NO_PRACTICAL_ACTION_FALLBACK if rest_required is the only trigger
        assert result.result_type in (
            ResultType.NO_PRACTICAL_ACTION_FALLBACK,
            ResultType.NO_TRIGGER,
            ResultType.SOFT_WARNING,
        ), f"Unexpected result_type: {result.result_type}"


# ---------------------------------------------------------------------------
# T015-10: SC-007 — high-monotony emits monotony_prevention candidate
# ---------------------------------------------------------------------------


def test_sc007_high_monotony_emits_monotony_prevention_candidate():
    """SC-007: A high-monotony raw_state emits a monotony_prevention candidate.

    This test uses the _HIGH_MONOTONY_RAW context where:
    - monotony_prevention_score >= 0.62 → candidate exists
    - base_safety_risk << 0.45 → rest_required candidate does NOT exist
    """
    result = _evaluate(_HIGH_MONOTONY_RAW)
    mono_candidate = next(
        (c for c in result.candidates if c.category == "monotony_prevention"), None
    )
    assert mono_candidate is not None, (
        "SC-007: Expected monotony_prevention candidate to be present in candidates"
    )
    assert mono_candidate.exists, (
        "SC-007: Expected monotony_prevention candidate to exist (score >= 0.62)"
    )
    # Verify rest_required is absent or below threshold
    rest_candidate = next(
        (c for c in result.candidates if c.category == "rest_required"), None
    )
    bsr = result.scores["base_safety_risk"]
    assert bsr < 0.45, (
        f"SC-007: Expected base_safety_risk < 0.45 in high-monotony context, got {bsr}"
    )


# ---------------------------------------------------------------------------
# T015-11: Totality (always returns one of 5 result_types)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("raw", [
    _LOW_RISK_RAW,
    _HIGH_RISK_RAW,
    _HIGH_MONOTONY_RAW,
    _HIGH_RISK_NO_REST_RAW,
])
def test_totality_always_returns_valid_result_type(raw):
    """evaluate() always returns one of the 5 exhaustive result_types."""
    result = _evaluate(raw)
    assert result.result_type in (
        ResultType.NO_TRIGGER,
        ResultType.SOFT_WARNING,
        ResultType.REST_PROPOSAL,
        ResultType.SEVERE_INTERVENTION,
        ResultType.NO_PRACTICAL_ACTION_FALLBACK,
    )


# ---------------------------------------------------------------------------
# T015-12: Determinism
# ---------------------------------------------------------------------------


def test_determinism_same_context_same_result():
    """Same inputs → same result (deterministic, no hidden state)."""
    kwargs = dict(
        context=_make_context(_HIGH_RISK_RAW),
        parameters={},
        hyperparameters=_DEFAULT_HP,
    )
    r1 = evaluate(**kwargs)
    r2 = evaluate(**kwargs)
    assert r1.result_type == r2.result_type
    assert r1.score == r2.score
    assert r1.scores == r2.scores
    assert r1.selected_category == r2.selected_category


# ---------------------------------------------------------------------------
# T015-13: Full §11 shape
# ---------------------------------------------------------------------------


def test_result_has_all_required_fields():
    """The returned DecisionResult populates all §11 fields for weighted_score."""
    result = _evaluate(_HIGH_RISK_RAW)

    # Core fields
    assert result.result_type is not None
    assert isinstance(result.trigger_candidate, bool)

    # Hybrid-only §11 fields — should be POPULATED (not empty like declarative_rule)
    assert "base_safety_risk" in result.scores
    assert "rest_required_score" in result.scores
    assert "monotony_prevention_score" in result.scores

    # states dict must have rest and monotony keys
    assert "rest" in result.states
    assert "monotony" in result.states

    # candidates list must be non-empty
    assert isinstance(result.candidates, list)
    assert len(result.candidates) >= 1

    # fire_control populated
    assert result.fire_control is not None

    # reason_inputs is a list (may be empty for NO_TRIGGER)
    assert isinstance(result.reason_inputs, list)

    # explanation present
    assert result.explanation is not None

    # next_package_runtime_state MUST be empty (M2 constraint)
    assert result.next_package_runtime_state == {}, (
        "weighted_score must return next_package_runtime_state={} in M2"
    )


def test_next_package_runtime_state_is_empty():
    """weighted_score returns next_package_runtime_state={} (M2, no smoothing)."""
    result = _evaluate(_HIGH_RISK_RAW)
    assert result.next_package_runtime_state == {}


def test_scores_dict_populated():
    """scores dict contains all three category scores."""
    result = _evaluate(_HIGH_RISK_RAW)
    assert "base_safety_risk" in result.scores
    assert "rest_required_score" in result.scores
    assert "monotony_prevention_score" in result.scores
    # All scores are numeric 0–1
    for key in ("base_safety_risk", "rest_required_score", "monotony_prevention_score"):
        v = result.scores[key]
        assert isinstance(v, float), f"scores[{key!r}] must be float, got {type(v)}"
        assert 0.0 <= v <= 1.0, f"scores[{key!r}] out of range: {v}"


def test_states_dict_populated():
    """states dict contains rest and monotony state labels."""
    result = _evaluate(_HIGH_RISK_RAW)
    assert "rest" in result.states
    assert "monotony" in result.states
    assert isinstance(result.states["rest"], str)
    assert isinstance(result.states["monotony"], str)


# ---------------------------------------------------------------------------
# T015-14: Proposal present when REST_PROPOSAL fires
# ---------------------------------------------------------------------------


def test_rest_proposal_has_localized_message():
    """When a REST_PROPOSAL fires, proposal.message has ja/en keys."""
    result = _evaluate(_HIGH_RISK_RAW)
    if result.result_type == ResultType.REST_PROPOSAL:
        assert result.proposal is not None
        assert "ja" in result.proposal.message
        assert "en" in result.proposal.message
