"""weighted_score algorithm (T015) — multi-category weighted scoring.

Same adapter contract as declarative_rule:
  evaluate(context, parameters, hyperparameters) → DecisionResult

Implements the §11 normalized DecisionResult shape with:
  - scores{base_safety_risk, rest_required_score, monotony_prevention_score}
  - states{rest, monotony}
  - candidates[] (all, including suppressed/non-selected)
  - selected_category (highest priority fired candidate)

M2 constraints:
  - No smoothing, no persistence (those are M3).
  - next_package_runtime_state always returned as {}.
  - Pure and deterministic: same inputs → same outputs.

Feature extraction (from research R4 + proposal §§7,8,9,10,13,15):
  - Consumes context.raw_state (camelCase numerics) and
    context.feature_groups.normalized (0–1 scores).
  - Intermediate numeric calculations are allowed (qualitative binning is
    for the EXTERNAL trigger discipline; internal scores are fine).
"""

from __future__ import annotations

from aica_api.models.decision import (
    Candidate,
    DecisionResult,
    FireControl,
    Proposal,
    ResultType,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _clamp(value: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, value))


# ---------------------------------------------------------------------------
# Feature extraction — from raw_state
# ---------------------------------------------------------------------------


def _rest_window_score(next_rest_min: float) -> float:
    """How actionable is the next rest stop timing? (proposal §8.1)"""
    if next_rest_min >= 9999.0:
        return 0.0
    if next_rest_min <= 3.0:
        return 0.6
    if next_rest_min <= 10.0:
        return 1.0
    if next_rest_min <= 20.0:
        return 0.6
    return 0.2


def _rest_scarcity_score(density: int) -> float:
    """How scarce are upcoming rest spots? (proposal §8.2)"""
    if density <= 0:
        return 1.0
    if density == 1:
        return 0.7
    if density == 2:
        return 0.4
    return 0.1


def _traffic_jam_score(ahead_min: float, low_speed_min: float) -> float:
    """Traffic jam forward pressure (proposal §7.4)."""
    if ahead_min <= 0.0:
        jam = 0.0
    elif ahead_min < 10.0:
        jam = 0.3
    elif ahead_min < 30.0:
        jam = 0.6
    else:
        jam = 1.0
    low = _clamp(low_speed_min / 20.0)
    return max(jam, low)


def _long_highway_score(highway_min: float) -> float:
    """Monotony contribution from long highway (proposal §7.5)."""
    if highway_min < 10.0:
        return 0.0
    if highway_min < 30.0:
        return 0.3
    if highway_min < 60.0:
        return 0.6
    return 1.0


def _weather_risk_score(weather_level: float) -> float:
    return _clamp(weather_level / 100.0)


def _future_fatigue_score(tj: float, lh: float, wr: float) -> float:
    """Expected future fatigue from route conditions (proposal §7.7)."""
    return _clamp(0.45 * tj + 0.35 * lh + 0.20 * wr)


def _monotony_score(
    monotonous_road_min: float,
    tunnel_min: float,
    is_night: bool,
    low_speed_min: float,
) -> float:
    """Monotony quality of the current road (proposal §9.5)."""
    monotonous_road = _clamp(monotonous_road_min / 30.0)
    tunnel = _clamp(tunnel_min / 15.0)
    night = 1.0 if is_night else 0.0
    low_speed = _clamp(low_speed_min / 20.0)
    return _clamp(
        0.35 * monotonous_road
        + 0.25 * tunnel
        + 0.20 * night
        + 0.20 * low_speed
    )


def _attention_drop_score(attention_normalized: float) -> float:
    """attention_drop = 1 − attention_score (proposal §9.7)."""
    return _clamp(1.0 - attention_normalized)


def _familiar_route_score(ratio: float) -> float:
    return _clamp(ratio)


# ---------------------------------------------------------------------------
# Score computation
# ---------------------------------------------------------------------------


def _compute_scores(raw: dict, norm: dict, hp: dict) -> dict[str, float]:
    """Compute all feature-level and category scores.

    Args:
        raw:  raw_state dict (camelCase numerics).
        norm: feature_groups.normalized dict (snake_case 0–1 scores).
        hp:   hyperparameters dict.

    Returns:
        Dict with all computed scores (feature and category level).
    """
    # ── normalized features (from binning) ───────────────────────────────────
    drowsiness = float(norm.get("drowsiness_score", 0.0))
    fatigue = float(norm.get("fatigue_score", 0.0))
    driving_anomaly = float(norm.get("driving_anomaly_score", 0.0))
    attention_norm = float(norm.get("attention_score", 1.0))

    # ── raw_state derived features ────────────────────────────────────────────
    next_rest_min = float(raw.get("nextRestSpotMin", 9999.0))
    is_night = bool(raw.get("isNight", False))
    weather_level = float(raw.get("weatherRiskLevel", 0.0))

    ahead_min = float(raw.get("trafficJamAheadMin", 0.0))
    low_speed_min = float(raw.get("lowSpeedDurationMin", 0.0))
    highway_min = float(raw.get("highwayRemainingMin", 0.0))
    monotonous_road_min = float(raw.get("monotonousRoadRemainingMin", 0.0))
    tunnel_min = float(raw.get("tunnelRemainingMin", 0.0))
    familiar_ratio = float(raw.get("familiarRouteRatio", 0.0))
    rest_density = int(raw.get("restSpotDensityNext30Min", 999))

    # ── intermediate feature scores ───────────────────────────────────────────
    tj = _traffic_jam_score(ahead_min, low_speed_min)
    lh = _long_highway_score(highway_min)
    wr = _weather_risk_score(weather_level)
    ff = _future_fatigue_score(tj, lh, wr)
    rw = _rest_window_score(next_rest_min)
    rs = _rest_scarcity_score(rest_density)
    mono = _monotony_score(monotonous_road_min, tunnel_min, is_night, low_speed_min)
    fr = _familiar_route_score(familiar_ratio)
    ad = _attention_drop_score(attention_norm)

    # ── base_safety_risk ──────────────────────────────────────────────────────
    w_d = float(hp.get("w_drowsiness", 0.40))
    w_f = float(hp.get("w_fatigue", 0.25))
    w_da = float(hp.get("w_driving_anomaly", 0.25))
    w_ff = float(hp.get("w_future_fatigue", 0.10))
    base_safety_risk = _clamp(
        w_d * drowsiness + w_f * fatigue + w_da * driving_anomaly + w_ff * ff
    )

    # ── rest_required_score (gated bonus) ─────────────────────────────────────
    min_risk = float(hp.get("minimum_risk_for_rest_bonus", 0.45))
    w_rw = float(hp.get("w_rest_window", 0.10))
    w_rs = float(hp.get("w_rest_scarcity", 0.08))
    if base_safety_risk >= min_risk:
        rest_bonus = w_rw * rw + w_rs * rs
    else:
        rest_bonus = 0.0
    rest_required_score = _clamp(base_safety_risk + rest_bonus)

    # ── monotony_prevention_score ─────────────────────────────────────────────
    w_mono = float(hp.get("w_monotony", 0.30))
    w_fr = float(hp.get("w_familiar_route", 0.20))
    w_ad = float(hp.get("w_attention_drop", 0.25))
    w_tj = float(hp.get("w_traffic_jam", 0.15))
    w_lh = float(hp.get("w_long_highway", 0.10))
    monotony_prevention_score = _clamp(
        w_mono * mono
        + w_fr * fr
        + w_ad * ad
        + w_tj * tj
        + w_lh * lh
    )

    return {
        "base_safety_risk": base_safety_risk,
        "rest_required_score": rest_required_score,
        "monotony_prevention_score": monotony_prevention_score,
        # Internal: used for fire-control and states
        "_next_rest_min": next_rest_min,
    }


# ---------------------------------------------------------------------------
# Candidate helpers
# ---------------------------------------------------------------------------


def _strength(score: float, hp: dict) -> str | None:
    """Map score to strength label (gentle/clear/strong) or None."""
    suggest = float(hp.get("threshold_suggest", 0.62))
    recommend = float(hp.get("threshold_recommend", 0.76))
    urgent = float(hp.get("threshold_urgent", 0.88))
    if score >= urgent:
        return "strong"
    if score >= recommend:
        return "clear"
    if score >= suggest:
        return "gentle"
    return None


def _make_fire_control(
    fired: bool,
    suppressed: bool,
    override: bool = False,
    reason: str | None = None,
) -> FireControl:
    return FireControl(
        fired=fired,
        suppressed=suppressed,
        override=override,
        reason=reason,
    )


def _build_rest_candidate(
    score: float, hp: dict, next_rest_min: float
) -> Candidate:
    """Build a rest_required Candidate with fire-control applied."""
    suggest = float(hp.get("threshold_suggest", 0.62))
    exists = score >= suggest
    strn = _strength(score, hp) if exists else None

    require_actionable = bool(hp.get("require_rest_actionable", True))
    max_rest_min = float(hp.get("rest_actionable_max_min", 30.0))
    actionable = next_rest_min <= max_rest_min

    if not exists:
        fc = _make_fire_control(fired=False, suppressed=False, reason="below_suggest_threshold")
    elif require_actionable and not actionable:
        fc = _make_fire_control(
            fired=False, suppressed=True,
            reason="actionability_guard_rest_not_reachable",
        )
    else:
        fc = _make_fire_control(fired=True, suppressed=False, reason="threshold_passed")

    return Candidate(
        category="rest_required",
        exists=exists,
        score=score,
        state="REST_RECOMMEND" if exists else None,
        strength=strn,
        fire_control=fc,
    )


def _build_monotony_candidate(score: float, hp: dict) -> Candidate:
    """Build a monotony_prevention Candidate with fire-control applied."""
    suggest = float(hp.get("threshold_suggest", 0.62))
    exists = score >= suggest
    strn = _strength(score, hp) if exists else None

    if not exists:
        fc = _make_fire_control(fired=False, suppressed=False, reason="below_suggest_threshold")
    else:
        fc = _make_fire_control(fired=True, suppressed=False, reason="threshold_passed")

    return Candidate(
        category="monotony_prevention",
        exists=exists,
        score=score,
        state="MONOTONY_WATCH" if exists else None,
        strength=strn,
        fire_control=fc,
    )


# ---------------------------------------------------------------------------
# Priority resolution
# ---------------------------------------------------------------------------

# Priority order: rest_required (1) > monotony_prevention (2)
_PRIORITY = {"rest_required": 1, "monotony_prevention": 2}


def _select_candidate(candidates: list[Candidate]) -> Candidate | None:
    """Select the highest-priority fired candidate (priority then score desc)."""
    fired = [c for c in candidates if c.fire_control.fired]
    if not fired:
        return None
    fired.sort(key=lambda c: (_PRIORITY.get(c.category, 99), -c.score))
    return fired[0]


# ---------------------------------------------------------------------------
# Result type mapping
# ---------------------------------------------------------------------------


def _result_type_from(selected: Candidate | None, rest_candidate: Candidate) -> ResultType:
    """Map candidate selection to one of the 5 result types."""
    if selected is None:
        # Check if rest_required exists but was suppressed
        if rest_candidate.exists and rest_candidate.fire_control.suppressed:
            return ResultType.NO_PRACTICAL_ACTION_FALLBACK
        return ResultType.NO_TRIGGER

    if selected.category == "rest_required":
        if selected.strength == "strong":
            return ResultType.SEVERE_INTERVENTION
        return ResultType.REST_PROPOSAL

    # monotony_prevention (or any other category)
    return ResultType.SOFT_WARNING


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def evaluate(
    context: dict,
    parameters: dict,  # noqa: ARG001 — setup-time, not consumed by weighted_score
    hyperparameters: dict,
) -> DecisionResult:
    """Evaluate the weighted_score algorithm and return a full §11 DecisionResult.

    Args:
        context:         Tick context with ``raw_state`` and
                         ``feature_groups.normalized`` sub-dicts.
        parameters:      Setup-time parameters (not consumed in M2).
        hyperparameters: Numeric weight/threshold hyperparameters.

    Returns:
        A fully-populated DecisionResult. Hybrid fields (scores, states)
        are populated; next_package_runtime_state is always {} (M2).

    Raises:
        KeyError / TypeError: Propagated from bad context shapes — the
            adapter converts these to AlgorithmAdapterError.
    """
    raw = context.get("raw_state", {})
    norm = context.get("feature_groups", {}).get("normalized", {})

    # ── Compute all scores ────────────────────────────────────────────────────
    sc = _compute_scores(raw, norm, hyperparameters)
    base_safety_risk = sc["base_safety_risk"]
    rest_required_score = sc["rest_required_score"]
    monotony_prevention_score = sc["monotony_prevention_score"]
    next_rest_min = sc["_next_rest_min"]

    scores = {
        "base_safety_risk": base_safety_risk,
        "rest_required_score": rest_required_score,
        "monotony_prevention_score": monotony_prevention_score,
    }

    # ── State labels ──────────────────────────────────────────────────────────
    states = {
        "rest": _rest_state_label(rest_required_score, hyperparameters),
        "monotony": _monotony_state_label(monotony_prevention_score, hyperparameters),
    }

    # ── Build candidates ──────────────────────────────────────────────────────
    rest_cand = _build_rest_candidate(rest_required_score, hyperparameters, next_rest_min)
    mono_cand = _build_monotony_candidate(monotony_prevention_score, hyperparameters)
    candidates = [rest_cand, mono_cand]

    # ── Priority resolution ───────────────────────────────────────────────────
    selected = _select_candidate(candidates)

    # ── Result type ───────────────────────────────────────────────────────────
    result_type = _result_type_from(selected, rest_cand)
    trigger_candidate = selected is not None

    # ── Overall fire_control (mirrors selected candidate's fire_control) ───────
    if selected is not None:
        overall_fc = _make_fire_control(
            fired=True,
            suppressed=False,
            reason=selected.fire_control.reason,
        )
    elif rest_cand.fire_control.suppressed:
        overall_fc = _make_fire_control(
            fired=False,
            suppressed=True,
            reason=rest_cand.fire_control.reason,
        )
    else:
        overall_fc = _make_fire_control(
            fired=False,
            suppressed=False,
            reason="no_candidate_above_threshold",
        )

    # ── Proposal ──────────────────────────────────────────────────────────────
    proposal = _build_proposal(selected) if selected is not None else None

    # ── Explanation + reason_inputs ───────────────────────────────────────────
    reason_inputs, explanation = _build_explanation(
        selected, base_safety_risk, rest_required_score, monotony_prevention_score
    )

    return DecisionResult(
        result_type=result_type,
        trigger_candidate=trigger_candidate,
        selected_category=selected.category if selected is not None else None,
        score=selected.score if selected is not None else None,
        features={},          # weighted_score uses numeric scores, not ordinal features
        scores=scores,
        states=states,
        criteria={
            "threshold_suggest": float(hyperparameters.get("threshold_suggest", 0.62)),
            "threshold_recommend": float(hyperparameters.get("threshold_recommend", 0.76)),
            "threshold_urgent": float(hyperparameters.get("threshold_urgent", 0.88)),
        },
        candidates=candidates,
        fire_control=overall_fc,
        proposal=proposal,
        reason_inputs=reason_inputs,
        explanation=explanation,
        next_package_runtime_state={},
    )


# ---------------------------------------------------------------------------
# State label helpers
# ---------------------------------------------------------------------------


def _rest_state_label(score: float, hp: dict) -> str:
    """Map rest_required_score to a REST_* state label."""
    suggest = float(hp.get("threshold_suggest", 0.62))
    recommend = float(hp.get("threshold_recommend", 0.76))
    urgent = float(hp.get("threshold_urgent", 0.88))
    watch = 0.45  # watch threshold (not a proposal yet)
    if score >= urgent:
        return "REST_URGENT"
    if score >= recommend:
        return "REST_RECOMMEND"
    if score >= suggest:
        return "REST_RECOMMEND"
    if score >= watch:
        return "REST_WATCH"
    return "REST_NORMAL"


def _monotony_state_label(score: float, hp: dict) -> str:
    """Map monotony_prevention_score to a MONOTONY_* state label."""
    suggest = float(hp.get("threshold_suggest", 0.62))
    if score >= suggest:
        return "MONOTONY_WATCH"
    return "MONOTONY_NORMAL"


# ---------------------------------------------------------------------------
# Proposal builder
# ---------------------------------------------------------------------------

_REST_PROPOSALS: dict[str, dict[str, str]] = {
    "gentle": {
        "ja": "長時間の運転が続いています。近くの休憩施設でご休憩をお勧めします。",
        "en": "You have been driving for a long time. "
              "We recommend resting at the nearby facility.",
    },
    "clear": {
        "ja": "疲労サインが検出されました。早めの休憩をお勧めします。",
        "en": "Fatigue signals detected. We recommend resting soon.",
    },
    "strong": {
        "ja": "安全のため、直ちに休憩を取ってください。",
        "en": "For safety, please rest immediately.",
    },
}

_MONOTONY_PROPOSALS: dict[str, dict[str, str]] = {
    "gentle": {
        "ja": "単調な走行が続いています。気分転換をお勧めします。",
        "en": "Monotonous driving detected. Consider a short break or content.",
    },
    "clear": {
        "ja": "注意力の低下が検出されました。安全運転に注意してください。",
        "en": "Attention drop detected. Please drive with caution.",
    },
    "strong": {
        "ja": "注意力が著しく低下しています。休憩をお勧めします。",
        "en": "Significant attention drop. Rest is recommended.",
    },
}


def _build_proposal(selected: Candidate) -> Proposal:
    if selected.category == "rest_required":
        message = _REST_PROPOSALS.get(selected.strength or "gentle", _REST_PROPOSALS["gentle"])
        options = ["accept_rest", "postpone", "decline"]
    else:
        message = _MONOTONY_PROPOSALS.get(selected.strength or "gentle", _MONOTONY_PROPOSALS["gentle"])
        options = ["acknowledge", "decline"]

    return Proposal(
        id=f"{selected.category}_proposal",
        message=message,
        options=options,
    )


# ---------------------------------------------------------------------------
# Explanation + reason_inputs
# ---------------------------------------------------------------------------


def _build_explanation(
    selected: Candidate | None,
    base_safety_risk: float,
    rest_required_score: float,
    monotony_prevention_score: float,
) -> tuple[list[str], str]:
    if selected is None:
        return (
            ["base_safety_risk", "monotony_prevention_score"],
            f"No trigger: base_safety_risk={base_safety_risk:.3f}, "
            f"monotony_prevention={monotony_prevention_score:.3f}.",
        )

    if selected.category == "rest_required":
        reason_inputs = [
            "drowsiness_score", "fatigue_score", "driving_anomaly_score",
            "future_fatigue_score", "base_safety_risk", "rest_window_score",
            "rest_scarcity_score", "rest_required_score",
        ]
        explanation = (
            f"rest_required_score={rest_required_score:.3f} "
            f"(base={base_safety_risk:.3f}) ≥ threshold; "
            f"strength={selected.strength!r}."
        )
    else:
        reason_inputs = [
            "monotony_score", "familiar_route_score", "attention_drop_score",
            "traffic_jam_score", "long_highway_score", "monotony_prevention_score",
        ]
        explanation = (
            f"monotony_prevention_score={monotony_prevention_score:.3f} ≥ threshold; "
            f"strength={selected.strength!r}."
        )

    return reason_inputs, explanation
