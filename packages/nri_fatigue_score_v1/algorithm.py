"""nri_fatigue_score_v1 — NRI cumulative fatigue accumulation score algorithm.

Implements the NRI proposal (20260630) for rest-break trigger firing based on
a cumulative fatigue score model:

  S_total(t) = S_base(t) + S_env(t) + S_realtime(t)

Where:
  S_base    = child_offset + T_drive * W_base * M_night * M_familiar
  S_env     = T_jam * W_jam + T_hw * W_highway + T_mono * W_monotonous
  S_realtime = max(0, V_sleep - θ_sleep) * W_sleep + max(0, V_fatigue - θ_fatigue) * W_fatigue

Fire condition: S_total >= threshold_fire
Post-fire filter: next rest spot ETA <= rest_spot_eta_filter_min

State carried across ticks (via package_runtime_state):
  - cumulative_jam_min: minutes spent in traffic jam
  - cumulative_highway_min: minutes spent on highway
  - cumulative_monotonous_min: minutes spent on monotonous road
  - persistence_counter: consecutive ticks above threshold
  - last_score: previous tick's total score (for velocity)

Pure & deterministic: no backend imports, no clocks, no randomness.
"""

from __future__ import annotations


# ---------------------------------------------------------------------------
# Score computation
# ---------------------------------------------------------------------------


def _compute_base_score(
    continuous_driving_min: float,
    child_passenger: bool,
    is_night: bool,
    familiar_route: bool,
    hp: dict,
) -> float:
    w_base = float(hp.get("w_base", 0.5))
    w_child = float(hp.get("w_child", 20.0))
    m_night = float(hp.get("m_night", 1.2)) if is_night else 1.0
    m_familiar = float(hp.get("m_familiar", 1.2)) if familiar_route else 1.0

    child_offset = w_child if child_passenger else 0.0
    time_damage = continuous_driving_min * w_base * m_night * m_familiar

    return child_offset + time_damage


def _compute_env_score(
    cumulative_jam_min: float,
    cumulative_highway_min: float,
    cumulative_monotonous_min: float,
    hp: dict,
) -> float:
    w_jam = float(hp.get("w_jam", 0.8))
    w_highway = float(hp.get("w_highway", 0.2))
    w_monotonous = float(hp.get("w_monotonous", 0.3))

    return (
        cumulative_jam_min * w_jam
        + cumulative_highway_min * w_highway
        + cumulative_monotonous_min * w_monotonous
    )


def _compute_realtime_score(
    drowsiness_level: float,
    fatigue_level: float,
    hp: dict,
) -> float:
    theta_sleep = float(hp.get("theta_sleep", 60.0))
    w_sleep = float(hp.get("w_sleep", 1.5))
    theta_fatigue = float(hp.get("theta_fatigue", 60.0))
    w_fatigue = float(hp.get("w_fatigue", 1.5))

    sleep_penalty = max(0.0, drowsiness_level - theta_sleep) * w_sleep
    fatigue_penalty = max(0.0, fatigue_level - theta_fatigue) * w_fatigue

    return sleep_penalty + fatigue_penalty


# ---------------------------------------------------------------------------
# Strength mapping
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
# State label
# ---------------------------------------------------------------------------


def _state_label(score: float, recovered: bool, hp: dict) -> str:
    if recovered:
        return "REST_RECOVERY"
    suggest = float(hp.get("threshold_suggest", 60.0))
    recommend = float(hp.get("threshold_recommend", 80.0))
    urgent = float(hp.get("threshold_urgent", 100.0))
    if score >= urgent:
        return "REST_URGENT"
    if score >= recommend:
        return "REST_RECOMMEND"
    if score >= suggest:
        return "REST_SUGGEST"
    if score >= suggest * 0.7:
        return "REST_WATCH"
    return "REST_NORMAL"


# ---------------------------------------------------------------------------
# Localized proposals
# ---------------------------------------------------------------------------

_PROPOSALS = {
    "gentle": {
        "ja": "疲労スコアが基準値を超えました。近くの休憩施設でのご休憩をお勧めします。",
        "en": "Fatigue score has exceeded the threshold. We suggest resting at a nearby facility.",
    },
    "clear": {
        "ja": "疲労が蓄積しています。早めの休憩をお勧めします。",
        "en": "Fatigue is accumulating. We recommend resting soon.",
    },
    "strong": {
        "ja": "安全のため、直ちに休憩を取ってください。",
        "en": "For your safety, please take a rest immediately.",
    },
}


def _build_proposal(strength_label: str) -> dict:
    message = _PROPOSALS.get(strength_label, _PROPOSALS["gentle"])
    return {
        "id": "rest_required_proposal",
        "message": message,
        "options": ["accept_rest", "postpone", "decline"],
    }


# ---------------------------------------------------------------------------
# Public API — python_module contract
# ---------------------------------------------------------------------------


def evaluate(context: dict) -> dict:
    """Evaluate the NRI fatigue accumulation score; return a DecisionResult dict + state."""
    hp = context.get("hyperparameters", {}) or {}
    params = context.get("parameters", {}) or {}
    raw = context.get("raw_state", {}) or {}
    feature_groups = context.get("feature_groups", {}) or {}
    ordinal = feature_groups.get("ordinal", {}) or {}
    prev_state = context.get("package_runtime_state", {}) or {}
    proposal_history = context.get("proposal_history", {}) or {}
    sim_time = float(context.get("simulation_time_sec", 0.0))

    # ── Extract parameters (setup-time, with raw_state fallback) ─────────
    child_passenger = bool(params.get("child_passenger", raw.get("childPassenger", False)))
    familiar_route = bool(params.get("familiar_route", raw.get("familiarRoute", False)))

    # ── Extract raw_state values ──────────────────────────────────────────
    is_night = bool(raw.get("isNight", False))
    is_traffic_jam = bool(raw.get("isTrafficJam", False))
    segment_type = raw.get("segmentType", "normal_road")
    drowsiness_level = float(raw.get("drowsinessLevel", 0.0))
    fatigue_level = float(raw.get("fatigueLevel", 0.0))
    next_rest_min = float(raw.get("nextRestSpotMin", 9999.0))
    motion_state = raw.get("motionState", "MOVING")

    # ── Hyperparameters ───────────────────────────────────────────────────
    threshold_fire = float(hp.get("threshold_fire", 80.0))
    threshold_suggest = float(hp.get("threshold_suggest", 60.0))
    threshold_recommend = float(hp.get("threshold_recommend", 80.0))
    threshold_urgent = float(hp.get("threshold_urgent", 100.0))
    rest_eta_filter = float(hp.get("rest_spot_eta_filter_min", 15.0))
    rest_cooldown = float(hp.get("rest_cooldown_sec", 600.0))
    max_per_30min = int(hp.get("max_proposals_per_30min", 3))
    emergency_threshold = float(hp.get("emergency_override_threshold", 100.0))
    persistence_required = int(hp.get("persistence_ticks", 2))

    # ── Recovery detection (early — needed before accumulation) ───────────
    # Detect recovery from raw_state.recoveryPhase (set by tick engine when
    # a recovery sequence is active). No framework-level flag needed.
    recovery_phase = raw.get("recoveryPhase")
    recovery_active = recovery_phase is not None
    was_in_recovery = bool(prev_state.get("was_in_recovery", False))

    # Recovery just completed: driver was resting, now resumed driving
    recovery_just_completed = was_in_recovery and not recovery_active

    # Suppress all firing while recovery is active (unconditional — the score
    # stays high due to cumulative accumulators, so we cannot rely on
    # lastProposalResult which gets overwritten if a new proposal fires)
    recovered = recovery_active

    # ── Retrieve cumulative state from previous tick ──────────────────────
    prev_jam_min = float(prev_state.get("cumulative_jam_min", 0.0))
    prev_highway_min = float(prev_state.get("cumulative_highway_min", 0.0))
    prev_mono_min = float(prev_state.get("cumulative_monotonous_min", 0.0))
    prev_driving_min = float(prev_state.get("driving_min_since_rest", 0.0))
    prev_counter = int(prev_state.get("persistence_counter", 0))
    prev_score = float(prev_state.get("last_score", 0.0))

    # ── Reset accumulators after recovery completes ───────────────────────
    if recovery_just_completed:
        prev_jam_min = 0.0
        prev_highway_min = 0.0
        prev_mono_min = 0.0
        prev_driving_min = 0.0
        prev_counter = 0
        prev_score = 0.0

    # ── Determine tick duration from simulation time ──────────────────────
    prev_sim_time = float(prev_state.get("last_sim_time", 0.0))
    tick_duration_min = (sim_time - prev_sim_time) / 60.0 if prev_sim_time > 0 else 1.0
    if tick_duration_min <= 0:
        tick_duration_min = 1.0

    # ── Only accumulate time when MOVING (not during rest stops) ──────────
    is_moving = motion_state == "MOVING"

    cumulative_jam_min = prev_jam_min + (
        tick_duration_min if (is_traffic_jam and is_moving) else 0.0
    )
    cumulative_highway_min = prev_highway_min + (
        tick_duration_min if (segment_type == "highway" and is_moving) else 0.0
    )
    is_monotonous = segment_type in ("highway", "normal_road")
    cumulative_monotonous_min = prev_mono_min + (
        tick_duration_min if (is_monotonous and is_moving) else 0.0
    )
    driving_min_since_rest = prev_driving_min + (
        tick_duration_min if is_moving else 0.0
    )

    # ── Compute scores ────────────────────────────────────────────────────
    s_base = _compute_base_score(
        driving_min_since_rest, child_passenger, is_night, familiar_route, hp
    )
    s_env = _compute_env_score(
        cumulative_jam_min, cumulative_highway_min, cumulative_monotonous_min, hp
    )
    s_realtime = _compute_realtime_score(drowsiness_level, fatigue_level, hp)
    s_total = s_base + s_env + s_realtime

    # ── Velocity ──────────────────────────────────────────────────────────
    velocity = s_total - prev_score

    # ── State label ───────────────────────────────────────────────────────
    state_label = _state_label(s_total, recovered, hp)

    # ── Candidate evaluation ──────────────────────────────────────────────
    exists = s_total >= threshold_suggest
    strength_label = _strength(s_total, threshold_suggest, threshold_recommend, threshold_urgent)
    new_counter = (prev_counter + 1) if (s_total >= threshold_fire) else 0

    # Fire-control logic
    fired = False
    suppressed = False
    override = False
    reason = "below_fire_threshold"

    if not exists:
        reason = "below_suggest_threshold"
    elif recovered:
        suppressed = True
        reason = "recovery_after_accept"
    elif s_total < threshold_fire:
        reason = "below_fire_threshold"
    elif new_counter < persistence_required and s_total < emergency_threshold:
        suppressed = True
        reason = "persistence_gate"
    elif s_total >= emergency_threshold:
        fired = True
        override = True
        reason = "emergency_override"
    else:
        # Check cooldown
        last_time = proposal_history.get("lastProposalTimeSec")
        last_prop_cat = proposal_history.get("lastProposalCategory")
        if (
            last_time is not None
            and last_prop_cat == "rest_required"
            and (sim_time - float(last_time)) < rest_cooldown
        ):
            suppressed = True
            reason = "cooldown_active"
        else:
            # Check 30-min rate limit
            count_30 = int(proposal_history.get("proposalCountLast30Min", 0))
            if count_30 >= max_per_30min:
                suppressed = True
                reason = "rate_limit_30min"
            else:
                # Post-fire filter: rest spot ETA
                if next_rest_min <= rest_eta_filter or next_rest_min >= 9999.0:
                    fired = True
                    reason = "threshold_passed_persisted"
                else:
                    suppressed = True
                    reason = "rest_spot_too_far"

    # ── Build candidate ───────────────────────────────────────────────────
    candidate = {
        "category": "rest_required",
        "exists": exists,
        "score": s_total,
        "state": state_label,
        "strength": strength_label,
        "fire_control": {
            "fired": fired,
            "suppressed": suppressed,
            "override": override,
            "reason": reason,
        },
    }
    candidates = [candidate]

    # ── Result type ───────────────────────────────────────────────────────
    if fired:
        result_type = "REST_PROPOSAL"
    elif suppressed:
        result_type = "SUPPRESSED"
    else:
        result_type = "NO_PROPOSAL"

    # ── Overall fire_control ──────────────────────────────────────────────
    overall_fc = {
        "fired": fired,
        "suppressed": suppressed,
        "override": override,
        "reason": reason,
    }

    # ── Proposal + explanation ────────────────────────────────────────────
    proposal = None
    if fired and strength_label:
        proposal = _build_proposal(strength_label)

    reason_inputs = [
        "continuous_driving_min", "drowsiness", "fatigue",
        "traffic_jam", "highway", "monotonous_road",
    ]

    explanation = [
        {
            "ja": (
                f"総合疲労スコア={s_total:.1f}点 "
                f"(基礎={s_base:.1f} + 環境={s_env:.1f} + リアルタイム={s_realtime:.1f})。"
                f"{'発火' if fired else '未発火'}、状態={state_label}。"
            ),
            "en": (
                f"Total fatigue score={s_total:.1f}pts "
                f"(base={s_base:.1f} + env={s_env:.1f} + realtime={s_realtime:.1f}). "
                f"{'Fired' if fired else 'Not fired'}, state={state_label}."
            ),
        }
    ]

    # ── Next runtime state ────────────────────────────────────────────────
    next_runtime_state = {
        "cumulative_jam_min": cumulative_jam_min,
        "cumulative_highway_min": cumulative_highway_min,
        "cumulative_monotonous_min": cumulative_monotonous_min,
        "driving_min_since_rest": driving_min_since_rest,
        "persistence_counter": new_counter,
        "last_score": s_total,
        "last_sim_time": sim_time,
        "was_in_recovery": recovery_active,
    }

    # ── Features ordinal (for trace display) ──────────────────────────────
    features_ordinal = {k: str(v) for k, v in ordinal.items()}

    # ── Normalized score (0-1 range for UI compatibility) ─────────────────
    max_display = max(threshold_urgent * 1.5, 150.0)
    normalized_score = min(1.0, s_total / max_display) if max_display > 0 else 0.0

    return {
        "result_type": result_type,
        "trigger_candidate": fired,
        "selected_category": "rest_required" if fired else None,
        "score": normalized_score,
        "features": features_ordinal,
        "scores": {
            "s_total": s_total,
            "s_base": s_base,
            "s_env": s_env,
            "s_realtime": s_realtime,
            "velocity": velocity,
            "rest_required_score": normalized_score,
        },
        "states": {
            "rest": state_label,
        },
        "criteria": {
            "threshold_fire": threshold_fire,
            "threshold_suggest": threshold_suggest,
            "threshold_recommend": threshold_recommend,
            "threshold_urgent": threshold_urgent,
            "rest_spot_eta_filter_min": rest_eta_filter,
            "persistence_ticks": persistence_required,
        },
        "candidates": candidates,
        "fire_control": overall_fc,
        "proposal": proposal,
        "reason_inputs": reason_inputs,
        "explanation": explanation,
        "next_package_runtime_state": next_runtime_state,
    }
