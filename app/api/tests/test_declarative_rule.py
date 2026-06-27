"""TDD declarative_rule tests (T013) — written BEFORE implementation; confirm RED, GREEN.

Tests port the functional skeleton's evaluateTrigger coverage to verify the Python
re-implementation is behaviourally identical.

Formula quick-reference:
  blend  = drowsiness×(0.5+0.25×wD) + fatigue×(0.2×wF) + drive×0.4
  damped = max(0, blend − shortfall + persistenceLift)
    shortfall       = max(0, (req+1) − dur)
    persistenceLift = max(0, dur−1) × 0.6
  reactionPoint = 1.8 − ord(trigger_sensitivity) × 0.4
  proposalCut   = 2.0 + ord(proposal_threshold)  × 1.0
  severeCut     = 3.0 + ord(severe_threshold)    × 1.0

Default hyperparameters (medium / medium / medium / medium / true / medium):
  reactionPoint=1.4, proposalCut=3.0, severeCut=4.0, req=1, wD=1, wF=1
"""

import pytest

from aica_api.algorithms.declarative_rule import evaluate
from aica_api.models.decision import ResultType


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

_DEFAULT_HP = {
    "trigger_sensitivity": "medium",
    "proposal_threshold": "medium",
    "severe_threshold": "medium",
    "persistence_requirement": "medium",
    "require_actionable": True,
    "rest_spot_sensitivity": "medium",
}


def _eval(context: dict, hyperparameters: dict | None = None):
    hp = hyperparameters if hyperparameters is not None else dict(_DEFAULT_HP)
    return evaluate(context=context, parameters={}, hyperparameters=hp)


# ---------------------------------------------------------------------------
# R1 — SEVERE_INTERVENTION
# ---------------------------------------------------------------------------


def test_r1_severe_drowsiness_always_intervenes():
    """R1 fires immediately on drowsiness=severe regardless of other inputs."""
    ctx = {
        "drowsiness_level": "severe",
        "fatigue_level": "low",
        "signal_duration": "transient",
        "continuous_driving_time": "short",
        "rest_spot_eta": "none",
    }
    result = _eval(ctx)
    assert result.result_type == ResultType.SEVERE_INTERVENTION
    assert "drowsiness_level" in result.reason_inputs


def test_r1_damped_reaches_severe_cut():
    """R1 fires when damped blend ≥ severeCut (4.0 at medium severe_threshold).

    strong(3)×0.75 + high(2)×0.2 + long(2)×0.4 = 3.45; persistent(3):
    persistenceLift=(3-1)×0.6=1.2; damped=4.65 ≥ 4.0.
    """
    ctx = {
        "drowsiness_level": "strong",
        "fatigue_level": "high",
        "signal_duration": "persistent",
        "continuous_driving_time": "long",
        "rest_spot_eta": "near",
    }
    result = _eval(ctx)
    assert result.result_type == ResultType.SEVERE_INTERVENTION


def test_r1_score_populated():
    """R1 result carries a non-null ordinal blend score."""
    ctx = {
        "drowsiness_level": "strong",
        "fatigue_level": "high",
        "signal_duration": "persistent",
        "continuous_driving_time": "long",
        "rest_spot_eta": "near",
    }
    result = _eval(ctx)
    assert result.score is not None
    assert result.score > 0


# ---------------------------------------------------------------------------
# R3 — REST_PROPOSAL (full conjunction and each broken conjunct)
# ---------------------------------------------------------------------------

# R3 full-conjunction baseline: moderate+sustained+long-drive+near
# blend=moderate(2)×0.75 + medium(1)×0.2 + long(2)×0.4 = 2.5
# damped=2.5+0.6=3.1 ≥ proposalCut(3.0) ✓  < severeCut(4.0) ✓
# rest reachable (near, require_actionable=True, sensitivity=medium) ✓
_R3_CTX = {
    "drowsiness_level": "moderate",
    "fatigue_level": "medium",
    "signal_duration": "sustained",
    "continuous_driving_time": "long",
    "rest_spot_eta": "near",
}


def test_r3_full_conjunction_fires():
    """R3 fires with moderate+sustained+long+near (the UC-01 trigger tick)."""
    result = _eval(_R3_CTX)
    assert result.result_type == ResultType.REST_PROPOSAL


def test_r3_trigger_candidate_true():
    """R3 result has trigger_candidate=True."""
    result = _eval(_R3_CTX)
    assert result.trigger_candidate is True


def test_r3_selected_category_rest_required():
    """R3 result has selected_category='rest_required'."""
    result = _eval(_R3_CTX)
    assert result.selected_category == "rest_required"


def test_r3_proposal_rest_guidance():
    """R3 result carries the rest_guidance proposal."""
    result = _eval(_R3_CTX)
    assert result.proposal is not None
    assert result.proposal.id == "rest_guidance"
    assert "accept_rest" in result.proposal.options
    assert "postpone" in result.proposal.options


def test_r3_score_populated():
    """R3 result carries a non-null ordinal blend (damped) score."""
    result = _eval(_R3_CTX)
    assert result.score is not None
    assert result.score >= 3.0


def test_r3_criteria_populated():
    """R3 result carries the cut-points in criteria dict."""
    result = _eval(_R3_CTX)
    assert "reaction_point" in result.criteria
    assert "proposal_cut" in result.criteria
    assert "severe_cut" in result.criteria
    # Default medium cuts
    assert abs(result.criteria["reaction_point"] - 1.4) < 1e-9
    assert abs(result.criteria["proposal_cut"] - 3.0) < 1e-9
    assert abs(result.criteria["severe_cut"] - 4.0) < 1e-9


def test_r3_candidate_fired_true():
    """R3 candidate has fire_control.fired=True, suppressed=False."""
    result = _eval(_R3_CTX)
    assert len(result.candidates) >= 1
    cand = result.candidates[0]
    assert cand.category == "rest_required"
    assert cand.fire_control.fired is True
    assert cand.fire_control.suppressed is False


def test_r3_candidate_score_populated():
    """The R3 firing candidate carries the ordinal blend score."""
    result = _eval(_R3_CTX)
    cand = result.candidates[0]
    assert cand.score is not None
    assert cand.score >= 3.0


def test_r3_features_populated():
    """R3 result features dict contains the key inputs."""
    result = _eval(_R3_CTX)
    assert "drowsiness_level" in result.features
    assert result.features["drowsiness_level"] == "moderate"


# --- Broken conjuncts (each individually drops out of R3) ---


def test_r3_broken_drowsiness_weak_not_r3():
    """drowsiness=weak → damped=2.35 < proposalCut(3.0) → not R3.

    blend=1×0.75+1×0.2+2×0.4=1.75; damped=1.75+0.6=2.35
    """
    ctx = {**_R3_CTX, "drowsiness_level": "weak"}
    result = _eval(ctx)
    assert result.result_type != ResultType.REST_PROPOSAL
    assert result.result_type != ResultType.NO_PRACTICAL_ACTION_FALLBACK


def test_r3_broken_signal_transient_not_r3():
    """signal=transient → heavy damping → damped=0.5 < reactionPoint → R5.

    shortfall=max(0,(1+1)-0)=2; damped=max(0,2.5-2)=0.5
    """
    ctx = {**_R3_CTX, "signal_duration": "transient"}
    result = _eval(ctx)
    assert result.result_type == ResultType.NO_TRIGGER


def test_r3_broken_rest_unreachable_gives_r2():
    """rest=none with require_actionable=True → R2 (suppressed R3 candidate)."""
    ctx = {**_R3_CTX, "rest_spot_eta": "none"}
    result = _eval(ctx)
    assert result.result_type == ResultType.NO_PRACTICAL_ACTION_FALLBACK


# ---------------------------------------------------------------------------
# R2 — NO_PRACTICAL_ACTION_FALLBACK + suppressed candidate
# ---------------------------------------------------------------------------


def test_r2_suppressed_candidate_preserved():
    """R2 must keep the rest_required candidate in candidates with suppressed=True (FR-008)."""
    ctx = {**_R3_CTX, "rest_spot_eta": "none"}
    result = _eval(ctx)
    assert result.result_type == ResultType.NO_PRACTICAL_ACTION_FALLBACK
    # Suppressed candidate must be present
    suppressed = [c for c in result.candidates if c.fire_control.suppressed]
    assert len(suppressed) >= 1
    assert suppressed[0].category == "rest_required"


def test_r2_no_proposal():
    """R2 does not surface a proposal (no actionable rest)."""
    ctx = {**_R3_CTX, "rest_spot_eta": "none"}
    result = _eval(ctx)
    assert result.proposal is None


def test_r2_actionability_far_low_sensitivity_suppressed():
    """rest=far + require_actionable=True + rest_spot_sensitivity=low → R2 (not reachable).

    restReachable: rest=far and sensitivity=low(ord=0) → not reachable → R2.
    """
    hp = {**_DEFAULT_HP, "rest_spot_sensitivity": "low"}
    ctx = {**_R3_CTX, "rest_spot_eta": "far"}
    result = _eval(ctx, hp)
    assert result.result_type == ResultType.NO_PRACTICAL_ACTION_FALLBACK


def test_r2_actionability_far_medium_sensitivity_reachable():
    """rest=far + rest_spot_sensitivity=medium → reachable → R3 (not R2)."""
    ctx = {**_R3_CTX, "rest_spot_eta": "far"}
    result = _eval(ctx)
    assert result.result_type == ResultType.REST_PROPOSAL


def test_r2_require_actionable_false_bypasses_guard():
    """require_actionable=False: rest=none is treated as reachable → R3 if damped ≥ cut."""
    hp = {**_DEFAULT_HP, "require_actionable": False}
    ctx = {**_R3_CTX, "rest_spot_eta": "none"}
    result = _eval(ctx, hp)
    assert result.result_type == ResultType.REST_PROPOSAL


# ---------------------------------------------------------------------------
# R4 — SOFT_WARNING
# ---------------------------------------------------------------------------

# moderate(2)×0.75 + medium(1)×0.2 + long(2)×0.4 = 2.5
# signal=brief(1), req=medium(1): shortfall=max(0,2-1)=1, lift=0
# damped=max(0,2.5-1)=1.5 ≥ reactionPoint(1.4) ✓  < proposalCut(3.0) ✓


def test_r4_soft_warning_fires():
    """R4 fires when damped is in [reactionPoint, proposalCut).

    blend=2.5; signal=brief → shortfall=1 → damped=1.5 ∈ [1.4, 3.0)
    """
    ctx = {
        "drowsiness_level": "moderate",
        "fatigue_level": "medium",
        "signal_duration": "brief",
        "continuous_driving_time": "long",
        "rest_spot_eta": "near",
    }
    result = _eval(ctx)
    assert result.result_type == ResultType.SOFT_WARNING


def test_r4_no_proposal():
    """R4 does not surface a proposal."""
    ctx = {
        "drowsiness_level": "moderate",
        "fatigue_level": "medium",
        "signal_duration": "brief",
        "continuous_driving_time": "long",
        "rest_spot_eta": "near",
    }
    result = _eval(ctx)
    assert result.proposal is None


# ---------------------------------------------------------------------------
# R5 — NO_TRIGGER
# ---------------------------------------------------------------------------


def test_r5_no_trigger_fires():
    """R5 fires when damped < reactionPoint (catch-all)."""
    ctx = {
        "drowsiness_level": "none",
        "fatigue_level": "low",
        "signal_duration": "transient",
        "continuous_driving_time": "short",
        "rest_spot_eta": "none",
    }
    result = _eval(ctx)
    assert result.result_type == ResultType.NO_TRIGGER


def test_r5_trigger_candidate_false():
    """R5: trigger_candidate=False, no proposal."""
    ctx = {
        "drowsiness_level": "none",
        "fatigue_level": "low",
        "signal_duration": "transient",
        "continuous_driving_time": "short",
        "rest_spot_eta": "none",
    }
    result = _eval(ctx)
    assert result.trigger_candidate is False
    assert result.proposal is None


# ---------------------------------------------------------------------------
# Totality — all five result types are reachable
# ---------------------------------------------------------------------------


def test_totality_all_five_result_types():
    """Each of the five result types is reachable from some valid input."""
    seen = set()

    # R5 — NO_TRIGGER
    r = _eval({"drowsiness_level": "none", "fatigue_level": "low",
                "signal_duration": "transient", "continuous_driving_time": "short",
                "rest_spot_eta": "none"})
    seen.add(r.result_type)

    # R4 — SOFT_WARNING
    r = _eval({"drowsiness_level": "moderate", "fatigue_level": "medium",
                "signal_duration": "brief", "continuous_driving_time": "long",
                "rest_spot_eta": "near"})
    seen.add(r.result_type)

    # R3 — REST_PROPOSAL
    r = _eval(_R3_CTX)
    seen.add(r.result_type)

    # R2 — NO_PRACTICAL_ACTION_FALLBACK
    r = _eval({**_R3_CTX, "rest_spot_eta": "none"})
    seen.add(r.result_type)

    # R1 — SEVERE_INTERVENTION
    r = _eval({"drowsiness_level": "severe", "fatigue_level": "low",
                "signal_duration": "transient", "continuous_driving_time": "short",
                "rest_spot_eta": "none"})
    seen.add(r.result_type)

    assert seen == set(ResultType)


# ---------------------------------------------------------------------------
# Determinism
# ---------------------------------------------------------------------------


def test_determinism_same_inputs_same_result():
    """Same inputs always produce the same DecisionResult (pure function)."""
    r1 = _eval(_R3_CTX)
    r2 = _eval(_R3_CTX)
    assert r1.result_type == r2.result_type
    assert r1.score == r2.score
    assert r1.criteria == r2.criteria


def test_determinism_r5():
    ctx = {
        "drowsiness_level": "none", "fatigue_level": "low",
        "signal_duration": "transient", "continuous_driving_time": "short",
        "rest_spot_eta": "none",
    }
    assert _eval(ctx).result_type == _eval(ctx).result_type


# ---------------------------------------------------------------------------
# Hyperparameter tuning moves the cut-points
# ---------------------------------------------------------------------------


def test_low_proposal_threshold_lowers_cut():
    """proposal_threshold=low → proposalCut=2.0; weak signal that was R4 becomes R3."""
    # With medium threshold: damped=2.35 → R4 (below 3.0)
    # With low threshold:    proposalCut=2.0 → 2.35 >= 2.0 → R3
    hp = {**_DEFAULT_HP, "proposal_threshold": "low"}
    ctx = {
        "drowsiness_level": "weak",
        "fatigue_level": "medium",
        "signal_duration": "sustained",
        "continuous_driving_time": "long",
        "rest_spot_eta": "near",
    }
    result_medium = _eval(ctx)
    result_low = _eval(ctx, hp)
    assert result_medium.result_type != ResultType.REST_PROPOSAL
    assert result_low.result_type == ResultType.REST_PROPOSAL


def test_high_trigger_sensitivity_lowers_reaction_point():
    """trigger_sensitivity=high → reactionPoint=1.0; previously R5 input becomes R4."""
    # With medium sensitivity: reactionPoint=1.4
    # damped for: drowsiness=weak(1)×0.75 + low(0)×0.2 + short(0)×0.4 = 0.75
    #   signal=sustained(2), req=medium(1): shortfall=0, lift=0.6 → damped=1.35 < 1.4 → R5
    # With high sensitivity: reactionPoint=1.0 → 1.35 >= 1.0 → R4
    ctx_weak = {
        "drowsiness_level": "weak",
        "fatigue_level": "low",
        "signal_duration": "sustained",
        "continuous_driving_time": "short",
        "rest_spot_eta": "none",
    }
    hp_high = {**_DEFAULT_HP, "trigger_sensitivity": "high"}
    result_medium = _eval(ctx_weak)
    result_high = _eval(ctx_weak, hp_high)
    assert result_medium.result_type == ResultType.NO_TRIGGER
    assert result_high.result_type == ResultType.SOFT_WARNING


# ---------------------------------------------------------------------------
# Blend score formula precision
# ---------------------------------------------------------------------------


def test_blend_score_r3_value():
    """R3 baseline score: blend=2.5, damped=3.1 (with medium weights/persistence)."""
    result = _eval(_R3_CTX)
    assert result.score is not None
    assert abs(result.score - 3.1) < 1e-9


def test_blend_score_populated_on_candidate():
    """The firing candidate's score equals the result score."""
    result = _eval(_R3_CTX)
    assert result.candidates[0].score == result.score


# ---------------------------------------------------------------------------
# next_package_runtime_state empty for declarative_rule
# ---------------------------------------------------------------------------


def test_next_package_runtime_state_empty():
    """declarative_rule is stateless; next_package_runtime_state must be {}."""
    result = _eval(_R3_CTX)
    assert result.next_package_runtime_state == {}


def test_hybrid_fields_empty_for_rule():
    """scores and states dicts are empty for a rule-only algorithm."""
    result = _eval(_R3_CTX)
    assert result.scores == {}
    assert result.states == {}
