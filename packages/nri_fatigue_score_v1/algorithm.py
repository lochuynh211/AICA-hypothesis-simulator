"""nri_fatigue_score_v1 — NRI cumulative fatigue accumulation score algorithm.

Implements the NRI proposal (20260630) for rest-break trigger firing based on
a cumulative fatigue score model:

  S_total(t) = S_base(t) + S_env(t) + S_realtime(t)

Where:
  S_base    = child_offset + T_drive * W_base * M_night * M_familiar
  S_env     = T_jam * W_jam + T_hw * W_highway + T_mono * W_monotonous
  S_realtime = max(0, V_sleep - θ_sleep) * W_sleep + max(0, V_fatigue - θ_fatigue) * W_fatigue

Fire condition (design-aligned — a SINGLE threshold): fire ⇔ S_total >= threshold_fire.
Post-fire filter: next rest spot ETA <= rest_spot_eta_filter_min (or no spot ahead).
Recovery suppresses firing. There is NO suggest/recommend/urgent ladder, persistence
gate, cooldown, 30-min cap, or emergency override — those were Hybrid carry-overs and
are removed to match the NRI spec (others/20260630_発火ロジック検討用資料.md line 217;
others/aica_trigger_algorithms_math_comparison.md §1.2).

Feature 009 (signal-tier redesign) — reads from the tiered `context["signals"]`
contract (`specs/009-signal-tier-redesign/contracts/tiered-context.md`) instead of a
flat `raw_state`. The math is UNCHANGED (see `others/aica_trigger_algorithms_math_comparison.md`
Part 1 §1.2 and `specs/009-signal-tier-redesign/data-model.md` §6); only the input SOURCE
changed, and `S_realtime` is now genuinely live because Tier-3a `drowsiness`/`fatigue`
signals exist (they were always 0 before 009).

  - Tier 1 (fixed, scenario constants): `isNight`, `familiarRoute`, `childPassenger`.
  - Tier 2 (dynamic): `isTrafficJam`, `segmentType`, `motionState`, `nextRestSpotMin`,
    `recoveryPhase`.
  - Tier 3a (simulated, latent): `drowsiness`, `fatigue` — feed `S_realtime`.

State carried across ticks (via package_runtime_state):
  - cumulative_jam_min: minutes spent in traffic jam
  - cumulative_highway_min: minutes spent on highway
  - cumulative_monotonous_min: minutes spent on monotonous road
  - driving_min_since_rest: minutes driven since the last rest (reset on recovery)
  - was_in_recovery: whether the previous tick was a recovery tick (reset edge)

Every hyperparameter is read via direct `hp[key]` indexing — NO `hp.get(key, <hardcoded
default>)` fallback. `context["hyperparameters"]` is guaranteed fully resolved (manifest
defaults ⊕ overrides, every declared key present) by the adapter/run_manager (FR-009); a
missing key here is a real configuration bug and MUST surface as a KeyError ->
algorithm_error, never a silently-wrong default.

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
    w_base = float(hp["w_base"])
    w_child = float(hp["w_child"])
    m_night = float(hp["m_night"]) if is_night else 1.0
    m_familiar = float(hp["m_familiar"]) if familiar_route else 1.0

    child_offset = w_child if child_passenger else 0.0
    time_damage = continuous_driving_min * w_base * m_night * m_familiar

    return child_offset + time_damage


def _compute_env_score(
    cumulative_jam_min: float,
    cumulative_highway_min: float,
    cumulative_monotonous_min: float,
    hp: dict,
) -> float:
    w_jam = float(hp["w_jam"])
    w_highway = float(hp["w_highway"])
    w_monotonous = float(hp["w_monotonous"])

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
    theta_sleep = float(hp["theta_sleep"])
    w_sleep = float(hp["w_sleep"])
    theta_fatigue = float(hp["theta_fatigue"])
    w_fatigue = float(hp["w_fatigue"])

    sleep_penalty = max(0.0, drowsiness_level - theta_sleep) * w_sleep
    fatigue_penalty = max(0.0, fatigue_level - theta_fatigue) * w_fatigue

    return sleep_penalty + fatigue_penalty


# ---------------------------------------------------------------------------
# State label — a single fire threshold (design-aligned; no suggest/recommend/
# urgent ladder). REST_RECOVERY while resting, REST_FIRE at/above threshold_fire,
# else REST_NORMAL.
# ---------------------------------------------------------------------------


def _state_label(score: float, recovered: bool, threshold_fire: float) -> str:
    if recovered:
        return "REST_RECOVERY"
    if score >= threshold_fire:
        return "REST_FIRE"
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
    hp = context["hyperparameters"]
    signals = context.get("signals", {}) or {}
    fixed = signals.get("fixed", {}) or {}
    dynamic = signals.get("dynamic", {}) or {}
    simulated = signals.get("simulated", {}) or {}
    feature_groups = context.get("feature_groups", {}) or {}
    ordinal = feature_groups.get("ordinal", {}) or {}
    prev_state = context.get("package_runtime_state", {}) or {}
    proposal_history = context.get("proposal_history", {}) or {}
    sim_time = float(context.get("simulation_time_sec", 0.0))

    # ── Extract Tier-1 fixed signals (scenario constants) ─────────────────
    child_passenger = bool(fixed.get("childPassenger", False))
    familiar_route = bool(fixed.get("familiarRoute", False))
    is_night = bool(fixed.get("isNight", False))

    # ── Extract Tier-2 dynamic signals ─────────────────────────────────────
    is_traffic_jam = bool(dynamic.get("isTrafficJam", False))
    segment_type = dynamic.get("segmentType", "normal_road")
    next_rest_min = float(dynamic.get("nextRestSpotMin", 9999.0))
    motion_state = dynamic.get("motionState", "MOVING")

    # ── Extract Tier-3a simulated signals (now live — feed S_realtime) ─────
    drowsiness_level = float(simulated.get("drowsiness", 0.0))
    fatigue_level = float(simulated.get("fatigue", 0.0))

    # ── Hyperparameters — a single fire threshold + post-fire ETA filter ──
    threshold_fire = float(hp["threshold_fire"])
    rest_eta_filter = float(hp["rest_spot_eta_filter_min"])

    # ── Recovery detection (early — needed before accumulation) ───────────
    # Detect recovery from dynamic.recoveryPhase (set by tick engine when
    # a recovery sequence is active). No framework-level flag needed.
    recovery_phase = dynamic.get("recoveryPhase")
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

    # ── Reset accumulators after recovery completes ───────────────────────
    if recovery_just_completed:
        prev_jam_min = 0.0
        prev_highway_min = 0.0
        prev_mono_min = 0.0
        prev_driving_min = 0.0

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

    # ── State label ───────────────────────────────────────────────────────
    state_label = _state_label(s_total, recovered, threshold_fire)

    # ── Fire-control — a SINGLE fire threshold, then the post-fire ETA filter.
    # Order: recovery suppression (never propose while resting) → below fire
    # threshold (no candidate) → ETA filter → fire. No persistence gate, cooldown,
    # 30-min cap, or emergency override (design: fire ⇔ S_total ≥ threshold_fire).
    exists = s_total >= threshold_fire
    # Manifested-risk (drowsiness/fatigue past their θ dead-band) → a stronger
    # message; otherwise the accumulated-fatigue message. Uses only the existing
    # θ thresholds — no extra fire-control hyperparameter.
    strength_label = ("strong" if s_realtime > 0.0 else "clear") if exists else None

    fired = False
    suppressed = False
    override = False

    if recovered:
        suppressed = True
        reason = "recovery_after_accept"
    elif not exists:
        reason = "below_fire_threshold"
    elif next_rest_min <= rest_eta_filter or next_rest_min >= 9999.0:
        fired = True
        reason = "fire_threshold_passed"
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
        "last_sim_time": sim_time,
        "was_in_recovery": recovery_active,
    }

    # ── Features ordinal (for trace display) ──────────────────────────────
    features_ordinal = {k: str(v) for k, v in ordinal.items()}

    # ── Normalized score (0-1 range for UI compatibility) ─────────────────
    max_display = max(threshold_fire * 1.5, 150.0)
    normalized_score = min(1.0, s_total / max_display) if max_display > 0 else 0.0
    # The §11 `score`/`rest_required_score` is NORMALIZED to 0-1; the timeline plots
    # that curve and its threshold line on the same axis.  `threshold_fire` is on the
    # RAW s_total scale (e.g. 80), so we also expose it normalized by the same
    # divisor — otherwise the UI's y-domain stretches to ~80 and the 0-1 curve
    # collapses to a flat line at the bottom (mirrors the hybrid's already-0-1
    # `threshold_suggest`).
    normalized_threshold = min(1.0, threshold_fire / max_display) if max_display > 0 else 0.0

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
            "rest_required_score": normalized_score,
        },
        "states": {
            "rest": state_label,
        },
        "criteria": {
            "threshold_fire": threshold_fire,
            # threshold on the SAME 0-1 scale as rest_required_score (for the
            # timeline threshold line); threshold_fire above stays raw (s_total scale).
            "rest_required_threshold": normalized_threshold,
            "rest_spot_eta_filter_min": rest_eta_filter,
        },
        "candidates": candidates,
        "fire_control": overall_fc,
        "proposal": proposal,
        "reason_inputs": reason_inputs,
        "explanation": explanation,
        "next_package_runtime_state": next_runtime_state,
    }
