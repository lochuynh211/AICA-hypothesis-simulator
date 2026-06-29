"""aica_transparent_hybrid_trigger_v1 — the faithful, STATEFUL transparent hybrid trigger.

The headline M3 deliverable.  A driving-fatigue trigger whose full decision basis is
reviewable and whose runtime state (smoothed features, smoothed category scores, persistence
counters, and state-machine labels) evolves tick-to-tick.

Pipeline (per tick, from `context` — see specs/.../contracts/transparent-hybrid.md):
  1. Feature extraction from raw_state (+ feature_groups.normalized); clamp 0-1;
     optional/absent inputs -> 0.  Same formulas as the built-in weighted_score.
  2. Smoothing:  smoothed_f[t] = alpha*f[t] + (1-alpha)*smoothed_f[t-1]   (alpha=0.35),
     prev from package_runtime_state.smoothed_features (empty on tick 0 -> prev 0).
  3. Category scores from the SMOOTHED features (base_safety_risk; rest_required_score =
     base + gated bonus iff base >= 0.45; monotony_prevention_score) — same weights as
     weighted_score.
  4. Velocity = score - prev smoothed score; persistence counters (rest 2, monotony 3
     consecutive over-threshold ticks; skip-if score>0.88 OR velocity>0.08 bypasses).
  5. State machines: REST_NORMAL->WATCH(0.45)->SUGGEST(0.62)->RECOMMEND(0.76)->URGENT(0.88)
     (->RECOVERY on an observed accept); MONOTONY_NORMAL->WATCH(0.40)->CONTENT_SUGGEST(0.58).
  6. Fire-control, in order: no-candidate -> emergency override -> cooldown (category-specific,
     using proposal_history.lastProposalTimeSec vs simulation_time_sec) -> 30-min count limit
     (proposal_history.proposalCountLast30Min) -> pass.
  7. Strength gentle/clear/strong; priority [rest_required, monotony_prevention] then score.
  8. Localized proposal {ja,en} + explanation {ja,en} reason lines + reason_inputs.

Returned dict: the normalized §11 DecisionResult shape PLUS next_package_runtime_state.
result_type is one of REST_PROPOSAL / MONOTONY_PROPOSAL / SUPPRESSED / NO_PROPOSAL (verbatim).
Non-fired / suppressed candidates are RETAINED in `candidates`.

Pure & deterministic: no backend imports, no clocks, no randomness — all time comes from
context["simulation_time_sec"].
"""

from __future__ import annotations


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _clamp(value: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, value))


# ---------------------------------------------------------------------------
# Feature-level scoring (identical formulas to the built-in weighted_score)
# ---------------------------------------------------------------------------


def _rest_window_score(next_rest_min: float) -> float:
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
    if density <= 0:
        return 1.0
    if density == 1:
        return 0.7
    if density == 2:
        return 0.4
    return 0.1


def _traffic_jam_score(ahead_min: float, low_speed_min: float) -> float:
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
    return _clamp(0.45 * tj + 0.35 * lh + 0.20 * wr)


def _monotony_quality_score(
    monotonous_road_min: float,
    tunnel_min: float,
    is_night: bool,
    low_speed_min: float,
) -> float:
    monotonous_road = _clamp(monotonous_road_min / 30.0)
    tunnel = _clamp(tunnel_min / 15.0)
    night = 1.0 if is_night else 0.0
    low_speed = _clamp(low_speed_min / 20.0)
    return _clamp(0.35 * monotonous_road + 0.25 * tunnel + 0.20 * night + 0.20 * low_speed)


def _attention_drop_score(attention_normalized: float) -> float:
    return _clamp(1.0 - attention_normalized)


# ---------------------------------------------------------------------------
# Feature extraction — pre-smoothing raw feature vector (0-1 each)
# ---------------------------------------------------------------------------

# The 11 features that feed the category scores.  All are clamped to [0, 1].
FEATURE_KEYS = (
    "drowsiness",
    "fatigue",
    "driving_anomaly",
    "future_fatigue",
    "rest_window",
    "rest_scarcity",
    "monotony",
    "familiar_route",
    "attention_drop",
    "traffic_jam",
    "long_highway",
)


def extract_features(raw_state: dict, normalized: dict) -> dict:
    """Extract the pre-smoothing 0-1 feature vector from a tick's raw_state.

    Args:
        raw_state:  camelCase numeric sensor dict (optional keys default to 0).
        normalized: feature_groups.normalized (snake_case 0-1 scores from binning).

    Returns:
        Dict keyed by FEATURE_KEYS with clamped 0-1 floats.
    """
    drowsiness = _clamp(float(normalized.get("drowsiness_score", 0.0)))
    fatigue = _clamp(float(normalized.get("fatigue_score", 0.0)))
    driving_anomaly = _clamp(float(normalized.get("driving_anomaly_score", 0.0)))
    attention_norm = _clamp(float(normalized.get("attention_score", 1.0)))

    next_rest_min = float(raw_state.get("nextRestSpotMin", 9999.0))
    is_night = bool(raw_state.get("isNight", False))
    weather_level = float(raw_state.get("weatherRiskLevel", 0.0))
    ahead_min = float(raw_state.get("trafficJamAheadMin", 0.0))
    low_speed_min = float(raw_state.get("lowSpeedDurationMin", 0.0))
    highway_min = float(raw_state.get("highwayRemainingMin", 0.0))
    monotonous_road_min = float(raw_state.get("monotonousRoadRemainingMin", 0.0))
    tunnel_min = float(raw_state.get("tunnelRemainingMin", 0.0))
    familiar_ratio = float(raw_state.get("familiarRouteRatio", 0.0))
    rest_density = int(raw_state.get("restSpotDensityNext30Min", 999))

    tj = _traffic_jam_score(ahead_min, low_speed_min)
    lh = _long_highway_score(highway_min)
    wr = _weather_risk_score(weather_level)

    return {
        "drowsiness": drowsiness,
        "fatigue": fatigue,
        "driving_anomaly": driving_anomaly,
        "future_fatigue": _future_fatigue_score(tj, lh, wr),
        "rest_window": _rest_window_score(next_rest_min),
        "rest_scarcity": _rest_scarcity_score(rest_density),
        "monotony": _monotony_quality_score(
            monotonous_road_min, tunnel_min, is_night, low_speed_min
        ),
        "familiar_route": _clamp(familiar_ratio),
        "attention_drop": _attention_drop_score(attention_norm),
        "traffic_jam": tj,
        "long_highway": lh,
    }


def smooth_features(raw_features: dict, prev_smoothed: dict, alpha: float) -> dict:
    """Exponentially smooth each feature: alpha*raw + (1-alpha)*prev (prev 0 if absent)."""
    one_minus = 1.0 - alpha
    return {
        key: alpha * raw_features[key] + one_minus * float(prev_smoothed.get(key, 0.0))
        for key in FEATURE_KEYS
    }


# ---------------------------------------------------------------------------
# Category scores — computed from the SMOOTHED features
# ---------------------------------------------------------------------------


def category_scores(features: dict, hp: dict) -> dict:
    """Compute base_safety_risk, rest_required_score and monotony_prevention_score.

    `features` may be the raw or the smoothed feature vector — same formula.
    """
    w_d = float(hp.get("w_drowsiness", 0.40))
    w_f = float(hp.get("w_fatigue", 0.25))
    w_da = float(hp.get("w_driving_anomaly", 0.25))
    w_ff = float(hp.get("w_future_fatigue", 0.10))
    base_safety_risk = _clamp(
        w_d * features["drowsiness"]
        + w_f * features["fatigue"]
        + w_da * features["driving_anomaly"]
        + w_ff * features["future_fatigue"]
    )

    min_risk = float(hp.get("minimum_risk_for_rest_bonus", 0.45))
    w_rw = float(hp.get("w_rest_window", 0.10))
    w_rs = float(hp.get("w_rest_scarcity", 0.08))
    if base_safety_risk >= min_risk:
        rest_bonus = w_rw * features["rest_window"] + w_rs * features["rest_scarcity"]
    else:
        rest_bonus = 0.0
    rest_required_score = _clamp(base_safety_risk + rest_bonus)

    w_mono = float(hp.get("w_monotony", 0.30))
    w_fr = float(hp.get("w_familiar_route", 0.20))
    w_ad = float(hp.get("w_attention_drop", 0.25))
    w_tj = float(hp.get("w_traffic_jam", 0.15))
    w_lh = float(hp.get("w_long_highway", 0.10))
    monotony_prevention_score = _clamp(
        w_mono * features["monotony"]
        + w_fr * features["familiar_route"]
        + w_ad * features["attention_drop"]
        + w_tj * features["traffic_jam"]
        + w_lh * features["long_highway"]
    )

    return {
        "base_safety_risk": base_safety_risk,
        "rest_required_score": rest_required_score,
        "monotony_prevention_score": monotony_prevention_score,
    }


# ---------------------------------------------------------------------------
# State machines
# ---------------------------------------------------------------------------


def rest_state_label(score: float, accepted: bool, hp: dict) -> str:
    """REST_NORMAL->WATCH->SUGGEST->RECOMMEND->URGENT (->RECOVERY on an accept)."""
    if accepted:
        return "REST_RECOVERY"
    watch = float(hp.get("rest_watch_threshold", 0.45))
    suggest = float(hp.get("threshold_suggest", 0.62))
    recommend = float(hp.get("threshold_recommend", 0.76))
    urgent = float(hp.get("threshold_urgent", 0.88))
    if score >= urgent:
        return "REST_URGENT"
    if score >= recommend:
        return "REST_RECOMMEND"
    if score >= suggest:
        return "REST_SUGGEST"
    if score >= watch:
        return "REST_WATCH"
    return "REST_NORMAL"


def monotony_state_label(score: float, hp: dict) -> str:
    """MONOTONY_NORMAL->WATCH->CONTENT_SUGGEST."""
    watch = float(hp.get("monotony_watch_threshold", 0.40))
    suggest = float(hp.get("monotony_suggest_threshold", 0.58))
    if score >= suggest:
        return "MONOTONY_CONTENT_SUGGEST"
    if score >= watch:
        return "MONOTONY_WATCH"
    return "MONOTONY_NORMAL"


# ---------------------------------------------------------------------------
# Strength
# ---------------------------------------------------------------------------


def _strength(score: float, suggest: float, recommend: float, urgent: float):
    if score >= urgent:
        return "strong"
    if score >= recommend:
        return "clear"
    if score >= suggest:
        return "gentle"
    return None


# ---------------------------------------------------------------------------
# Per-category candidate evaluation (persistence + fire-control)
# ---------------------------------------------------------------------------


def _evaluate_candidate(
    *,
    category: str,
    score: float,
    velocity: float,
    prev_counter: int,
    suggest: float,
    recommend: float,
    urgent: float,
    persistence_required: int,
    skip_if_score: float,
    skip_if_velocity: float,
    cooldown_sec: float,
    emergency_threshold: float,
    state: str,
    sim_time: float,
    proposal_history: dict,
    max_per_30min: int,
    recovered: bool,
) -> tuple[dict, int]:
    """Evaluate one trigger category; return (candidate_dict, new_persistence_counter).

    Fire-control order: no-candidate -> emergency override -> cooldown -> 30-min count -> pass.
    """
    exists = score >= suggest
    strength = _strength(score, suggest, recommend, urgent) if exists else None

    # Persistence counter (consecutive over-threshold ticks).
    new_counter = (prev_counter + 1) if exists else 0

    def _cand(fired, suppressed, override, reason):
        return {
            "category": category,
            "exists": exists,
            "score": score,
            "state": state,
            "strength": strength,
            "fire_control": {
                "fired": fired,
                "suppressed": suppressed,
                "override": override,
                "reason": reason,
            },
        }

    # 1) no candidate at all.
    if not exists:
        return _cand(False, False, False, "below_suggest_threshold"), new_counter

    # Recovery: an accept was observed for this category — do not re-propose.
    if recovered:
        return _cand(False, True, False, "recovery_after_accept"), new_counter

    # Persistence gate (skip-if bypass).
    skip_if = (score > skip_if_score) or (velocity > skip_if_velocity)
    persistence_ok = (new_counter >= persistence_required) or skip_if
    if not persistence_ok:
        return _cand(False, True, False, "persistence_gate"), new_counter

    # 2) emergency override — fires regardless of cooldown / count limit.
    if score >= emergency_threshold:
        return _cand(True, False, True, "emergency_override"), new_counter

    # 3) cooldown (category-specific).
    last_time = proposal_history.get("lastProposalTimeSec")
    last_cat = proposal_history.get("lastProposalCategory")
    if (
        last_time is not None
        and last_cat == category
        and (sim_time - float(last_time)) < cooldown_sec
    ):
        return _cand(False, True, False, "cooldown_active"), new_counter

    # 4) 30-minute count limit.
    count_30 = int(proposal_history.get("proposalCountLast30Min", 0))
    if count_30 >= max_per_30min:
        return _cand(False, True, False, "rate_limit_30min"), new_counter

    # 5) pass — fires.
    return _cand(True, False, False, "threshold_passed_persisted"), new_counter


# ---------------------------------------------------------------------------
# Priority
# ---------------------------------------------------------------------------

_PRIORITY = {"rest_required": 1, "monotony_prevention": 2}


def _select(candidates: list) -> dict | None:
    fired = [c for c in candidates if c["fire_control"]["fired"]]
    if not fired:
        return None
    fired.sort(key=lambda c: (_PRIORITY.get(c["category"], 99), -c["score"]))
    return fired[0]


# ---------------------------------------------------------------------------
# Localized proposals + explanations
# ---------------------------------------------------------------------------

_REST_PROPOSALS = {
    "gentle": {
        "ja": "長時間の運転が続いています。近くの休憩施設でのご休憩をお勧めします。",
        "en": "You have been driving for a while. We suggest resting at a nearby facility.",
    },
    "clear": {
        "ja": "疲労のサインが続いています。早めの休憩をお勧めします。",
        "en": "Sustained fatigue signals detected. We recommend resting soon.",
    },
    "strong": {
        "ja": "安全のため、直ちに休憩を取ってください。",
        "en": "For your safety, please take a rest immediately.",
    },
}

_MONOTONY_PROPOSALS = {
    "gentle": {
        "ja": "単調な走行が続いています。気分転換をお勧めします。",
        "en": "Monotonous driving detected. Consider a short break or refreshing content.",
    },
    "clear": {
        "ja": "注意力の低下が続いています。安全運転にご注意ください。",
        "en": "Sustained attention drop detected. Please drive with extra caution.",
    },
    "strong": {
        "ja": "注意力が著しく低下しています。休憩をお勧めします。",
        "en": "Significant attention drop. A rest is strongly recommended.",
    },
}


def _build_proposal(selected: dict) -> dict:
    strength = selected["strength"] or "gentle"
    if selected["category"] == "rest_required":
        message = _REST_PROPOSALS.get(strength, _REST_PROPOSALS["gentle"])
        options = ["accept_rest", "postpone", "decline"]
    else:
        message = _MONOTONY_PROPOSALS.get(strength, _MONOTONY_PROPOSALS["gentle"])
        options = ["acknowledge", "decline"]
    return {
        "id": f"{selected['category']}_proposal",
        "message": message,
        "options": options,
    }


def _build_explanation(selected, scores: dict, states: dict) -> tuple[list, list]:
    base = scores["base_safety_risk"]
    rest = scores["rest_required_score"]
    mono = scores["monotony_prevention_score"]
    if selected is None:
        reason_inputs = ["base_safety_risk", "rest_required_score", "monotony_prevention_score"]
        explanation = [
            {
                "ja": (
                    f"提案なし: 平滑化済み 安全リスク={base:.3f}, 休憩必要度={rest:.3f}, "
                    f"単調性={mono:.3f}。"
                ),
                "en": (
                    f"No proposal: smoothed base_safety_risk={base:.3f}, "
                    f"rest_required={rest:.3f}, monotony={mono:.3f}."
                ),
            }
        ]
        return reason_inputs, explanation

    if selected["category"] == "rest_required":
        reason_inputs = [
            "drowsiness", "fatigue", "driving_anomaly", "future_fatigue",
            "base_safety_risk", "rest_window", "rest_scarcity", "rest_required_score",
        ]
        explanation = [
            {
                "ja": (
                    f"休憩必要度(平滑化)={rest:.3f}（基礎リスク={base:.3f}）が閾値を超え、"
                    f"持続条件を満たしました。状態={states['rest']}、強度={selected['strength']}。"
                ),
                "en": (
                    f"Smoothed rest_required={rest:.3f} (base={base:.3f}) crossed the "
                    f"threshold and persisted. state={states['rest']}, "
                    f"strength={selected['strength']}."
                ),
            }
        ]
    else:
        reason_inputs = [
            "monotony", "familiar_route", "attention_drop", "traffic_jam",
            "long_highway", "monotony_prevention_score",
        ]
        explanation = [
            {
                "ja": (
                    f"単調性抑止(平滑化)={mono:.3f} が閾値を超え、持続条件を満たしました。"
                    f"状態={states['monotony']}、強度={selected['strength']}。"
                ),
                "en": (
                    f"Smoothed monotony_prevention={mono:.3f} crossed the threshold and "
                    f"persisted. state={states['monotony']}, strength={selected['strength']}."
                ),
            }
        ]
    return reason_inputs, explanation


# ---------------------------------------------------------------------------
# Public API — python_module contract
# ---------------------------------------------------------------------------


def evaluate(context: dict) -> dict:
    """Evaluate the transparent hybrid trigger; return a §11 DecisionResult dict + state.

    See the module docstring for the full pipeline.  Pure & deterministic.
    """
    hp = context.get("hyperparameters", {}) or {}
    raw = context.get("raw_state", {}) or {}
    feature_groups = context.get("feature_groups", {}) or {}
    norm = feature_groups.get("normalized", {}) or {}
    ordinal = feature_groups.get("ordinal", {}) or {}
    prev_state = context.get("package_runtime_state", {}) or {}
    proposal_history = context.get("proposal_history", {}) or {}
    sim_time = float(context.get("simulation_time_sec", 0.0))

    alpha = float(hp.get("smoothing_alpha", 0.35))
    suggest = float(hp.get("threshold_suggest", 0.62))
    recommend = float(hp.get("threshold_recommend", 0.76))
    urgent = float(hp.get("threshold_urgent", 0.88))
    mono_suggest = float(hp.get("monotony_suggest_threshold", 0.58))
    mono_recommend = float(hp.get("monotony_recommend_threshold", 0.72))
    mono_urgent = float(hp.get("monotony_urgent_threshold", 0.85))
    rest_persistence = int(hp.get("rest_persistence_ticks", 2))
    mono_persistence = int(hp.get("monotony_persistence_ticks", 3))
    skip_if_score = float(hp.get("skip_if_score", 0.88))
    skip_if_velocity = float(hp.get("skip_if_velocity", 0.08))
    rest_cooldown = float(hp.get("rest_cooldown_sec", 600.0))
    mono_cooldown = float(hp.get("monotony_cooldown_sec", 900.0))
    emergency_threshold = float(hp.get("emergency_override_threshold", 0.88))
    max_per_30min = int(hp.get("max_proposals_per_30min", 3))

    # ── 1-2. extract + smooth features ─────────────────────────────────────
    raw_features = extract_features(raw, norm)
    prev_smoothed_features = prev_state.get("smoothed_features", {}) or {}
    smoothed_features = smooth_features(raw_features, prev_smoothed_features, alpha)

    # ── 3. category scores from the smoothed features ──────────────────────
    scores = category_scores(smoothed_features, hp)
    rest_score = scores["rest_required_score"]
    mono_score = scores["monotony_prevention_score"]

    # ── 4. velocity vs prev smoothed scores ────────────────────────────────
    prev_scores = prev_state.get("smoothed_scores", {}) or {}
    rest_velocity = rest_score - float(prev_scores.get("rest_required_score", 0.0))
    mono_velocity = mono_score - float(prev_scores.get("monotony_prevention_score", 0.0))

    prev_counters = prev_state.get("persistence_counters", {}) or {}
    prev_rest_counter = int(prev_counters.get("rest_required", 0))
    prev_mono_counter = int(prev_counters.get("monotony_prevention", 0))

    # Recovery: an accept seen for this category (only rest is acceptable here).
    # Scoped to the active rest sequence: recovery_active is True only while the
    # driver is currently resting (the adapter sets it from run_state.recovery).
    # Once the driver resumes, recovery_active is False and we leave REST_RECOVERY
    # so a fresh proposal can fire when drowsiness rebuilds — without this gate
    # rest_recovered would latch forever (lastProposalResult stays "accept_rest"
    # because no later rest proposal is ever allowed to fire).
    last_result = proposal_history.get("lastProposalResult")
    last_cat = proposal_history.get("lastProposalCategory")
    recovery_active = bool(context.get("recovery_active", False))
    rest_recovered = (
        recovery_active
        and (last_result == "accept_rest")
        and (last_cat in (None, "rest_required"))
    )

    # ── 5. state-machine labels (recorded output) ──────────────────────────
    states = {
        "rest": rest_state_label(rest_score, rest_recovered, hp),
        "monotony": monotony_state_label(mono_score, hp),
    }

    # ── 6-7. candidates with persistence + fire-control ────────────────────
    rest_cand, new_rest_counter = _evaluate_candidate(
        category="rest_required",
        score=rest_score,
        velocity=rest_velocity,
        prev_counter=prev_rest_counter,
        suggest=suggest,
        recommend=recommend,
        urgent=urgent,
        persistence_required=rest_persistence,
        skip_if_score=skip_if_score,
        skip_if_velocity=skip_if_velocity,
        cooldown_sec=rest_cooldown,
        emergency_threshold=emergency_threshold,
        state=states["rest"],
        sim_time=sim_time,
        proposal_history=proposal_history,
        max_per_30min=max_per_30min,
        recovered=rest_recovered,
    )
    mono_cand, new_mono_counter = _evaluate_candidate(
        category="monotony_prevention",
        score=mono_score,
        velocity=mono_velocity,
        prev_counter=prev_mono_counter,
        suggest=mono_suggest,
        recommend=mono_recommend,
        urgent=mono_urgent,
        persistence_required=mono_persistence,
        skip_if_score=skip_if_score,
        skip_if_velocity=skip_if_velocity,
        cooldown_sec=mono_cooldown,
        emergency_threshold=emergency_threshold,
        state=states["monotony"],
        sim_time=sim_time,
        proposal_history=proposal_history,
        max_per_30min=max_per_30min,
        recovered=False,
    )
    candidates = [rest_cand, mono_cand]

    # ── priority selection ────────────────────────────────────────────────
    selected = _select(candidates)

    # ── result_type (verbatim hybrid categories) ──────────────────────────
    if selected is not None:
        if selected["category"] == "rest_required":
            result_type = "REST_PROPOSAL"
        else:
            result_type = "MONOTONY_PROPOSAL"
    elif any(c["fire_control"]["suppressed"] for c in candidates):
        result_type = "SUPPRESSED"
    else:
        result_type = "NO_PROPOSAL"

    # ── overall fire_control mirrors the selected / first-suppressed candidate ─
    if selected is not None:
        overall_fc = {
            "fired": True,
            "suppressed": False,
            "override": selected["fire_control"]["override"],
            "reason": selected["fire_control"]["reason"],
        }
    else:
        suppressed = next(
            (c for c in candidates if c["fire_control"]["suppressed"]), None
        )
        if suppressed is not None:
            overall_fc = {
                "fired": False,
                "suppressed": True,
                "override": False,
                "reason": suppressed["fire_control"]["reason"],
            }
        else:
            overall_fc = {
                "fired": False,
                "suppressed": False,
                "override": False,
                "reason": "no_candidate_above_threshold",
            }

    # ── 8. proposal + explanation ──────────────────────────────────────────
    proposal = _build_proposal(selected) if selected is not None else None
    reason_inputs, explanation = _build_explanation(selected, scores, states)

    # ── next runtime state (the recorded, threaded-forward output) ─────────
    next_runtime_state = {
        "smoothed_features": smoothed_features,
        "smoothed_scores": {
            "rest_required_score": rest_score,
            "monotony_prevention_score": mono_score,
        },
        "persistence_counters": {
            "rest_required": new_rest_counter,
            "monotony_prevention": new_mono_counter,
        },
        "states": {
            "rest_state": states["rest"],
            "monotony_state": states["monotony"],
        },
    }

    # features field is dict[str, str]: the transparent ordinal view of the tick.
    features_ordinal = {k: str(v) for k, v in ordinal.items()}

    return {
        "result_type": result_type,
        "trigger_candidate": selected is not None,
        "selected_category": selected["category"] if selected is not None else None,
        "score": selected["score"] if selected is not None else None,
        "features": features_ordinal,
        "scores": {
            "base_safety_risk": scores["base_safety_risk"],
            "rest_required_score": rest_score,
            "monotony_prevention_score": mono_score,
            "rest_velocity": rest_velocity,
            "monotony_velocity": mono_velocity,
        },
        "states": states,
        "criteria": {
            "smoothing_alpha": alpha,
            "threshold_suggest": suggest,
            "threshold_recommend": recommend,
            "threshold_urgent": urgent,
            "rest_persistence_ticks": rest_persistence,
            "monotony_persistence_ticks": mono_persistence,
            "monotony_suggest_threshold": mono_suggest,
        },
        "candidates": candidates,
        "fire_control": overall_fc,
        "proposal": proposal,
        "reason_inputs": reason_inputs,
        "explanation": explanation,
        "next_package_runtime_state": next_runtime_state,
    }
