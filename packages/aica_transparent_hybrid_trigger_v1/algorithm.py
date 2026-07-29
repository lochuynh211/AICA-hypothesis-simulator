"""aica_transparent_hybrid_trigger_v1 — the faithful, STATEFUL transparent hybrid trigger.

The headline M3/009 deliverable.  A driving-fatigue trigger whose full decision basis is
reviewable and whose runtime state (smoothed features, smoothed category scores, persistence
counters, state-machine labels, and env/monotony accumulators) evolves tick-to-tick.

Feature 009 (signal-tier redesign) — compact 9-feature form on the tiered signal contract
(the 8-feature form plus `driving_time`, a banded time-on-task risk input derived from
`continuousDrivingMin` and reset on rest; `childPassenger` adds a fixed rest-score bonus).
See `specs/009-signal-tier-redesign/data-model.md` §5 and
`others/aica_trigger_algorithms_math_comparison.md` Part 2 §2.3 for the authoritative math.

Pipeline (per tick, from `context` — see `specs/009-signal-tier-redesign/contracts/tiered-context.md`):
  1. Accumulate `jam_min` / `hw_min` / `mono_min` (runtime state) while
     `signals.dynamic.motionState == "MOVING"`, using the elapsed minutes since the
     previous tick (`simulation_time_sec` delta; 0 on the very first tick).
     These are then measured SINCE THE LAST INTERVENTION via `accum_baseline`: an
     accepted rest rebaselines all three, and a SERVED monotony proposal rebaselines
     `mono_min` (once per proposal — see `mono_intervention_handled_sec`).
  2. Feature extraction from `context["signals"]` (fixed/dynamic/simulated tiers) using the
     accumulators above; clamp 0-1.  9 features (no route look-ahead; 1 stochastic
     signal `anomaly_rate`; `driving_time` = banded time-on-task since last rest).
     `monotony` is PURE exposure time — `clamp(mono_min / monotony_saturation_min)`;
     `isNight` is NOT part of it (see `_monotony_score`).
  3. Smoothing:  smoothed_f[t] = alpha*f[t] + (1-alpha)*smoothed_f[t-1]   (alpha=smoothing_alpha),
     prev from package_runtime_state.smoothed_features (empty on tick 0 -> prev 0).
  4. Category scores from the SMOOTHED features (base_safety_risk; rest_required_score =
     base + gated bonus iff base >= minimum_risk_for_rest_bonus; monotony_prevention_score),
     plus two raw unsmoothed flag terms: `childPassenger` (w_child_bonus, rest only) and
     `isNight` (w_night, monotony only).
  5. Velocity = score - prev smoothed score; persistence counters (rest/monotony consecutive
     over-threshold ticks; skip-if score/velocity bypasses persistence).
  6. State machines: REST_NORMAL->WATCH->SUGGEST->RECOMMEND->URGENT (->RECOVERY on an observed
     accept, scoped to `recovery_active`); MONOTONY_NORMAL->WATCH->CONTENT_SUGGEST.
  7. Fire-control, in order: no-candidate -> emergency override -> cooldown (category-specific,
     using proposal_history.lastProposalTimeSec vs simulation_time_sec) -> 30-min count limit
     (proposal_history.proposalCountLast30Min) -> pass.
  8. Strength gentle/clear/strong; priority [rest_required, monotony_prevention] then score.
  9. Localized proposal {ja,en} + explanation {ja,en} reason lines + reason_inputs.

Returned dict: the normalized §11 DecisionResult shape PLUS next_package_runtime_state.
result_type is one of REST_PROPOSAL / MONOTONY_PROPOSAL / SUPPRESSED / NO_PROPOSAL (verbatim).
Non-fired / suppressed candidates are RETAINED in `candidates`.

Every hyperparameter is read via direct `hp[key]` indexing — NO `hp.get(key, <hardcoded
default>)` fallback.  `context["hyperparameters"]` is guaranteed fully resolved (manifest
defaults ⊕ overrides, every declared key present) by the adapter/run_manager (FR-009); a
missing key here is a real configuration bug and MUST surface as a KeyError -> algorithm_error,
never a silently-wrong default.

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
# Feature-level scoring helpers
# ---------------------------------------------------------------------------


def _rest_window_score(next_rest_min: float) -> float:
    """Banded rest-window urgency (Principle IV — boundary-binned, not raw minutes)."""
    if next_rest_min >= 9999.0:
        return 0.0
    if next_rest_min <= 3.0:
        return 0.6
    if next_rest_min <= 10.0:
        return 1.0
    if next_rest_min <= 20.0:
        return 0.6
    return 0.2


def _rest_scarcity_score(next_rest_min: float) -> float:
    """clamp((nextRestSpotMin - 10) / 50) — data-model §5."""
    return _clamp((next_rest_min - 10.0) / 50.0)


def _driving_time_score(drive_min_since_rest: float) -> float:
    """Banded time-on-task urgency (Principle IV — boundary-binned, not raw minutes).

    Input is minutes driven SINCE the last rest (the Hybrid rebaselines the
    monotonic `continuousDrivingMin` signal on recovery; see `evaluate`).
    """
    if drive_min_since_rest < 60.0:
        return 0.0
    if drive_min_since_rest < 120.0:
        return 0.4
    if drive_min_since_rest < 180.0:
        return 0.7
    return 1.0


def _env_load_score(
    is_traffic_jam: bool, jam_min: float, hw_min: float, weather_level: float
) -> float:
    """clamp(0.5*(isTrafficJam?1:clamp(jam_min/20)) + 0.3*clamp(hw_min/60) + 0.2*(weather/100))."""
    jam_term = 1.0 if is_traffic_jam else _clamp(jam_min / 20.0)
    hw_term = _clamp(hw_min / 60.0)
    weather_term = _clamp(weather_level / 100.0)
    return _clamp(0.5 * jam_term + 0.3 * hw_term + 0.2 * weather_term)


def _monotony_score(mono_min: float, saturation_min: float) -> float:
    """clamp(mono_min / monotony_saturation_min) — PURE monotonous-exposure time.

    This feature used to be `clamp(0.6*clamp(mono_min/30) + 0.4*isNight)`, which
    broke the monotony channel in both directions:

      * `isNight` owned 40% of a feature named "monotony", so in DAYLIGHT the
        feature was hard-capped at 0.600.  The monotony score's daytime ceiling
        was then 0.4(0.600) + 0.3(env_load) + 0.2(familiar_route) = 0.575 with
        env_load at its no-jam ceiling — arithmetically below the 0.70 suggest
        threshold, so a daytime monotonous-highway drive could NEVER fire, on a
        route of any length (combined case C-03).
      * `mono_min/30` saturated after half an hour, so five hours of featureless
        highway read exactly the same as thirty minutes.

    `isNight` is now its own weighted term on the monotony SCORE (`w_night` —
    see `category_scores`), where a reviewer sees it as a separate row instead
    of it hiding inside a feature it does not belong to.
    """
    return _clamp(mono_min / saturation_min)


# ---------------------------------------------------------------------------
# Runtime-state accumulators — jam_min / hw_min / mono_min (advance while MOVING)
# ---------------------------------------------------------------------------

# Segment types treated as "monotonous" for the accumulator — mirrors the sibling
# NRI package's convention over the same simulator segment vocabulary.
_MONOTONOUS_SEGMENT_TYPES = ("highway", "normal_road")


def advance_accumulators(dynamic: dict, prev_state: dict, sim_time: float) -> dict:
    """Advance jam_min/hw_min/mono_min while `motionState == MOVING`.

    Elapsed minutes since the previous tick are derived from the delta between this
    tick's `simulation_time_sec` and the previous tick's (stored in runtime state as
    `prev_sim_time_sec`).  On the very first tick (no prior state) the delta is 0 —
    there is no elapsed exposure to attribute yet.

    Returns a dict with keys `jam_min`, `hw_min`, `mono_min` (the NEW accumulated
    totals, ready to thread into `next_package_runtime_state`).
    """
    prev_accumulators = prev_state.get("accumulators", {}) or {}
    prev_jam_min = float(prev_accumulators.get("jam_min", 0.0))
    prev_hw_min = float(prev_accumulators.get("hw_min", 0.0))
    prev_mono_min = float(prev_accumulators.get("mono_min", 0.0))

    prev_sim_time_sec = prev_state.get("prev_sim_time_sec")
    if prev_sim_time_sec is None:
        tick_duration_min = 0.0
    else:
        tick_duration_min = max(0.0, sim_time - float(prev_sim_time_sec)) / 60.0

    is_moving = dynamic.get("motionState") == "MOVING"
    is_traffic_jam = bool(dynamic.get("isTrafficJam", False))
    segment_type = dynamic.get("segmentType", "normal_road")
    is_highway = segment_type == "highway"
    is_monotonous = segment_type in _MONOTONOUS_SEGMENT_TYPES

    advance = tick_duration_min if is_moving else 0.0
    return {
        "jam_min": prev_jam_min + (advance if is_traffic_jam else 0.0),
        "hw_min": prev_hw_min + (advance if is_highway else 0.0),
        "mono_min": prev_mono_min + (advance if is_monotonous else 0.0),
    }


# ---------------------------------------------------------------------------
# Feature extraction — pre-smoothing raw feature vector (0-1 each)
# ---------------------------------------------------------------------------

# The 8 compact features that feed the category scores (data-model §5).  All are
# clamped to [0, 1].  No route look-ahead; only 1 stochastic signal (anomaly_rate).
FEATURE_KEYS = (
    "drowsiness",
    "fatigue",
    "driving_anomaly",
    "driving_time",
    "env_load",
    "monotony",
    "rest_window",
    "rest_scarcity",
    "familiar_route",
)


def extract_features(signals: dict, accumulators: dict, hp: dict) -> dict:
    """Extract the pre-smoothing 0-1 feature vector from a tick's tiered signals.

    Args:
        signals: `context["signals"]` — `{fixed, dynamic, simulated}`.
        accumulators: this tick's advanced `{jam_min, hw_min, mono_min}` (see
            `advance_accumulators`), plus `drive_min_since_rest` (minutes driven
            since the last rest, computed in `evaluate`).  `drive_min_since_rest`
            defaults to 0 when absent, so callers that pass only the three
            MOVING-gated accumulators get `driving_time == 0`.
        hp: fully-resolved hyperparameters (`K` divides `anomaly_rate`).

    Returns:
        Dict keyed by FEATURE_KEYS with clamped 0-1 floats.
    """
    fixed = signals.get("fixed", {}) or {}
    dynamic = signals.get("dynamic", {}) or {}
    simulated = signals.get("simulated", {}) or {}

    drowsiness = _clamp(float(simulated.get("drowsiness", 0.0)) / 100.0)
    fatigue = _clamp(float(simulated.get("fatigue", 0.0)) / 100.0)
    anomaly_rate = float(simulated.get("anomaly_rate", 0.0))
    driving_anomaly = _clamp(anomaly_rate / float(hp["K"]))
    driving_time = _driving_time_score(
        float(accumulators.get("drive_min_since_rest", 0.0))
    )

    familiar_route = bool(fixed.get("familiarRoute", False))
    weather_level = float(fixed.get("weatherRiskLevel", 0.0))

    is_traffic_jam = bool(dynamic.get("isTrafficJam", False))
    next_rest_min = float(dynamic.get("nextRestSpotMin", 9999.0))

    env_load = _env_load_score(
        is_traffic_jam,
        float(accumulators.get("jam_min", 0.0)),
        float(accumulators.get("hw_min", 0.0)),
        weather_level,
    )
    monotony = _monotony_score(
        float(accumulators.get("mono_min", 0.0)), float(hp["monotony_saturation_min"])
    )

    return {
        "drowsiness": drowsiness,
        "fatigue": fatigue,
        "driving_anomaly": driving_anomaly,
        "driving_time": driving_time,
        "env_load": env_load,
        "monotony": monotony,
        "rest_window": _rest_window_score(next_rest_min),
        "rest_scarcity": _rest_scarcity_score(next_rest_min),
        "familiar_route": 1.0 if familiar_route else 0.0,
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


def category_scores(
    features: dict,
    hp: dict,
    child_passenger: bool = False,
    is_night: bool = False,
) -> dict:
    """Compute base_safety_risk, rest_required_score and monotony_prevention_score.

    `features` may be the raw or the smoothed feature vector — same formula.

    `child_passenger` is the raw (unsmoothed) `fixed.childPassenger` flag; when
    True it adds a fixed `w_child_bonus` to `rest_required_score` (only) — a
    conservatism dial that makes AICA propose a rest sooner with a child aboard.
    It is added AFTER the rest-spot bonus gate so it can never unlock that gate on
    its own, and it is deliberately kept out of `base_safety_risk` and monotony.

    `is_night` is the raw (unsmoothed) `fixed.isNight` flag, carried the same way
    for the same reason.  It adds `w_night` to `monotony_prevention_score` ONLY —
    driving at night makes a monotonous stretch harder to stay engaged with, but
    it is not itself evidence of fatigue, so it stays out of `base_safety_risk`
    and `rest_required_score`.  It used to be folded into the `monotony` FEATURE
    instead, which capped that feature at 0.6 in daylight; see `_monotony_score`.
    """
    def _row(feature_id: str, value: float, weight: float) -> dict:
        return {
            "feature_id": feature_id,
            "value": value,
            "band": None,          # filled in by evaluate() from features_ordinal
            "weight": weight,
            "contribution": weight * value,
        }

    base_terms = [
        _row("drowsiness", features["drowsiness"], hp["w_drowsiness"]),
        _row("fatigue", features["fatigue"], hp["w_fatigue"]),
        _row("driving_anomaly", features["driving_anomaly"], hp["w_driving_anomaly"]),
        _row("driving_time", features["driving_time"], hp["w_driving_time"]),
        _row("env_load", features["env_load"], hp["w_env"]),
    ]
    # NOTE: deliberately NOT `sum(...)` — CPython 3.12+ built-in `sum()` uses
    # Neumaier-compensated summation for floats, which can differ from a plain
    # left-to-right `+` chain in the last bit. The pre-existing formula here
    # was `a + b + c + d + e`; a manual accumulator reproduces that exactly so
    # `base_safety_risk` stays numerically identical to before this change.
    base_unclamped = 0.0
    for t in base_terms:
        base_unclamped += t["contribution"]
    base_safety_risk = _clamp(base_unclamped)

    gate_passed = base_safety_risk >= hp["minimum_risk_for_rest_bonus"]
    rest_bonus_terms = [
        _row("rest_window", features["rest_window"], hp["w_rest_window"]),
        _row("rest_scarcity", features["rest_scarcity"], hp["w_rest_scarcity"]),
    ]
    if gate_passed:
        # Direct `+` (not `sum()` — see the base_unclamped note above) to match
        # the original `w_rest_window*rest_window + w_rest_scarcity*rest_scarcity`.
        rest_bonus = rest_bonus_terms[0]["contribution"] + rest_bonus_terms[1]["contribution"]
    else:
        # Keep the rows VISIBLE with their declared weight so a reviewer can see
        # they were gated out rather than simply absent; zero only the effect.
        rest_bonus = 0.0
        for term in rest_bonus_terms:
            term["contribution"] = 0.0

    child_term = _row("child_passenger", 1.0 if child_passenger else 0.0, hp["w_child_bonus"])
    child_bonus = child_term["contribution"]

    rest_unclamped = base_safety_risk + rest_bonus + child_bonus
    rest_required_score = _clamp(rest_unclamped)

    mono_terms = [
        _row("monotony", features["monotony"], hp["w_monotony"]),
        _row("env_load", features["env_load"], hp["w_env_mono"]),
        _row("familiar_route", features["familiar_route"], hp["w_familiar"]),
        # Night as a VISIBLE pseudo-feature row (like child_passenger on rest),
        # not hidden inside the monotony feature — see this function's docstring.
        _row("night", 1.0 if is_night else 0.0, hp["w_night"]),
    ]
    # Manual accumulator (not `sum()` — see the base_unclamped note above) to
    # match the original `w_monotony*monotony + w_env_mono*env_load + w_familiar*familiar_route`.
    mono_unclamped = 0.0
    for t in mono_terms:
        mono_unclamped += t["contribution"]
    monotony_prevention_score = _clamp(mono_unclamped)

    rest_rows = base_terms + rest_bonus_terms + [child_term]

    return {
        "base_safety_risk": base_safety_risk,
        "rest_required_score": rest_required_score,
        "monotony_prevention_score": monotony_prevention_score,
        "feature_contributions": {
            "rest_required": {
                "score": rest_required_score,
                # `clamp` means Σcontributions can exceed the reported score, so
                # realized shares stop reconciling. The panel must be able to SAY so.
                "clamped": sum(r["contribution"] for r in rest_rows) > rest_required_score,
                "rows": rest_rows,
                "gates": [{
                    "gate_id": "minimum_risk_for_rest_bonus",
                    "evaluated_inputs": {"base_safety_risk": base_safety_risk},
                    "threshold": hp["minimum_risk_for_rest_bonus"],
                    "passed": gate_passed,
                    "effect": "allow" if gate_passed else "exclude",
                }],
            },
            "monotony_prevention": {
                "score": monotony_prevention_score,
                "clamped": mono_unclamped > monotony_prevention_score,
                "rows": mono_terms,
                "gates": [],
            },
        },
    }


# ---------------------------------------------------------------------------
# State machines
# ---------------------------------------------------------------------------


def rest_state_label(score: float, accepted: bool, hp: dict) -> str:
    """REST_NORMAL->WATCH->SUGGEST->RECOMMEND->URGENT (->RECOVERY on an accept)."""
    if accepted:
        return "REST_RECOVERY"
    watch = hp["rest_watch_threshold"]
    suggest = hp["threshold_suggest"]
    recommend = hp["threshold_recommend"]
    urgent = hp["threshold_urgent"]
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
    watch = hp["monotony_watch_threshold"]
    suggest = hp["monotony_suggest_threshold"]
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
            "drowsiness", "fatigue", "driving_anomaly", "env_load",
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
            "monotony", "env_load", "familiar_route", "monotony_prevention_score",
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
    hp = context["hyperparameters"]
    signals = context.get("signals", {}) or {}
    dynamic = signals.get("dynamic", {}) or {}
    feature_groups = context.get("feature_groups", {}) or {}
    ordinal = feature_groups.get("ordinal", {}) or {}
    prev_state = context.get("package_runtime_state", {}) or {}
    proposal_history = context.get("proposal_history", {}) or {}
    sim_time = float(context.get("simulation_time_sec", 0.0))

    alpha = hp["smoothing_alpha"]
    suggest = hp["threshold_suggest"]
    recommend = hp["threshold_recommend"]
    urgent = hp["threshold_urgent"]
    mono_suggest = hp["monotony_suggest_threshold"]
    mono_recommend = hp["monotony_recommend_threshold"]
    mono_urgent = hp["monotony_urgent_threshold"]
    rest_persistence = int(hp["rest_persistence_ticks"])
    mono_persistence = int(hp["monotony_persistence_ticks"])
    skip_if_score = hp["skip_if_score"]
    skip_if_velocity = hp["skip_if_velocity"]
    rest_cooldown = hp["rest_cooldown_sec"]
    mono_cooldown = hp["monotony_cooldown_sec"]
    emergency_threshold = hp["emergency_override_threshold"]
    max_per_30min = int(hp["max_proposals_per_30min"])

    recovery_active = bool(context.get("recovery_active", False))
    child_passenger = bool(signals.get("fixed", {}).get("childPassenger", False))
    # Raw (unsmoothed) night flag — a weighted term on the monotony score only.
    is_night = bool(signals.get("fixed", {}).get("isNight", False))

    # ── 1. advance the env/monotony accumulators (MOVING-gated) ────────────
    accumulators = advance_accumulators(dynamic, prev_state, sim_time)

    # ── 1b. time-on-task since the last rest ───────────────────────────────
    # `continuousDrivingMin` is monotonic (the engine never resets it), so the
    # Hybrid keeps its own baseline: while the driver is resting we rebaseline it
    # to the current value, making `drive_min_since_rest` drop to ~0 right after a
    # rest.  Threaded forward as `drive_min_baseline`.
    continuous_driving_min = float(dynamic.get("continuousDrivingMin", 0.0))
    if recovery_active:
        drive_min_baseline = continuous_driving_min
    else:
        drive_min_baseline = float(prev_state.get("drive_min_baseline", 0.0))
    drive_min_since_rest = max(0.0, continuous_driving_min - drive_min_baseline)
    accumulators["drive_min_since_rest"] = drive_min_since_rest

    # ── 1c. rebaseline env/monotony exposure on rest ───────────────────────
    # The jam/highway/monotony accumulators (feeding env_load + monotony) are
    # measured SINCE THE LAST REST, exactly like drive_min_since_rest: while the
    # driver is resting we rebaseline them to the current cumulative totals, so a
    # rest drops env_load AND monotony to ~0 and they rebuild afterwards (a rest
    # relieves monotony; without this monotony saturates and never falls). The
    # cumulative `accumulators` are still threaded forward unchanged so
    # advance_accumulators keeps the running totals — `accum_baseline` is separate.
    #
    # ── 1d. rebaseline MONOTONY exposure on a served MONOTONY proposal ──────
    # A rest is not the only intervention that relieves monotony — the whole
    # point of the monotony channel is that refreshing content does too.  Until
    # this existed, `accum_baseline` moved only while `recovery_active`, so
    # acknowledging or declining a monotony proposal changed nothing: once
    # mono_min saturated, `monotony_prevention_score` stayed pinned above its
    # threshold for the rest of the run and re-fired at every cooldown expiry
    # (combined case C-05 — three monotony proposals before the driver had even
    # reached the first rest spot).  Serving a monotony proposal now rebaselines
    # mono_min, so the score falls and rebuilds — a real duty cycle.
    #
    # Only mono_min is rebaselined here (content does not clear a traffic jam or
    # un-drive the highway), and only ONCE per intervention: the sim-time of the
    # proposal we already rebaselined against is remembered in
    # `mono_intervention_handled_sec`.  Without that guard `lastProposal*` stays
    # pointing at the same served proposal for many ticks, mono_min would be
    # re-zeroed every tick, and monotony could never rebuild to fire again.
    last_proposal_result = proposal_history.get("lastProposalResult")
    last_proposal_category = proposal_history.get("lastProposalCategory")
    mono_intervention_sec = (
        proposal_history.get("lastProposalTimeSec")
        if last_proposal_category == "monotony_prevention" and last_proposal_result is not None
        else None
    )
    prev_handled_sec = prev_state.get("mono_intervention_handled_sec")

    if recovery_active:
        accum_baseline = {
            "jam_min": accumulators["jam_min"],
            "hw_min": accumulators["hw_min"],
            "mono_min": accumulators["mono_min"],
        }
        mono_intervention_handled_sec = prev_handled_sec
    elif mono_intervention_sec is not None and mono_intervention_sec != prev_handled_sec:
        accum_baseline = dict(prev_state.get("accum_baseline", {}) or {})
        accum_baseline["mono_min"] = accumulators["mono_min"]
        mono_intervention_handled_sec = mono_intervention_sec
    else:
        accum_baseline = prev_state.get("accum_baseline", {}) or {}
        mono_intervention_handled_sec = prev_handled_sec
    since_rest_accumulators = {
        "jam_min": max(0.0, accumulators["jam_min"] - float(accum_baseline.get("jam_min", 0.0))),
        "hw_min": max(0.0, accumulators["hw_min"] - float(accum_baseline.get("hw_min", 0.0))),
        "mono_min": max(0.0, accumulators["mono_min"] - float(accum_baseline.get("mono_min", 0.0))),
        "drive_min_since_rest": drive_min_since_rest,
    }

    # ── 2-3. extract + smooth features (from the since-rest exposures) ──────
    raw_features = extract_features(signals, since_rest_accumulators, hp)
    prev_smoothed_features = prev_state.get("smoothed_features", {}) or {}
    smoothed_features = smooth_features(raw_features, prev_smoothed_features, alpha)

    # ── 4. category scores from the smoothed features ──────────────────────
    scores = category_scores(
        smoothed_features, hp, child_passenger=child_passenger, is_night=is_night
    )
    rest_score = scores["rest_required_score"]
    mono_score = scores["monotony_prevention_score"]

    # ── 5. velocity vs prev smoothed scores ────────────────────────────────
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
    rest_recovered = (
        recovery_active
        and (last_proposal_result == "accept_rest")
        and (last_proposal_category in (None, "rest_required"))
    )

    # ── 6. state-machine labels (recorded output) ───────────────────────────
    states = {
        "rest": rest_state_label(rest_score, rest_recovered, hp),
        "monotony": monotony_state_label(mono_score, hp),
    }

    # ── 7. candidates with persistence + fire-control ───────────────────────
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
        "accumulators": accumulators,
        "drive_min_baseline": drive_min_baseline,
        "accum_baseline": accum_baseline,
        "mono_intervention_handled_sec": mono_intervention_handled_sec,
        "prev_sim_time_sec": sim_time,
    }

    # features field is dict[str, str]: the transparent ordinal view of the tick.
    features_ordinal = {k: str(v) for k, v in ordinal.items()}

    # Attach the ordinal band word each row's raw value falls in, so the review
    # panel can lead with the value a reviewer already understands. `ordinal` is
    # keyed independently of FEATURE_KEYS, so a miss stays None rather than guessing.
    feature_contributions = scores["feature_contributions"]
    for block in feature_contributions.values():
        for row in block["rows"]:
            row["band"] = features_ordinal.get(row["feature_id"])

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
        "feature_contributions": feature_contributions,
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
