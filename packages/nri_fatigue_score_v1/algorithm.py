"""nri_fatigue_score_v1 — NRI cumulative fatigue accumulation score algorithm.

Implements the NRI proposal (20260630) for rest-break trigger firing based on
a cumulative fatigue score model:

  S_total(t) = S_base(t) + S_env(t) + S_realtime(t)

Where:
  S_base    = child_offset + T_drive * W_base * M_night * M_familiar
  S_env     = T_jam * W_jam + T_hw * W_highway + T_mono * W_monotonous
  S_realtime = max(0, V_sleep - θ_sleep) * W_sleep + max(0, V_fatigue - θ_fatigue) * W_fatigue

Fire condition — TWO thresholds banding the ONE score:

    S_total >= threshold_fire                       -> rest_required
    threshold_monotony <= S_total < threshold_fire  -> monotony_prevention
    S_total <  threshold_monotony                   -> nothing

`threshold_monotony` is the LOWER of the pair, so a run reaches the monotony band
before the rest band and escalates into it. Only ONE score exists, so the package
publishes a monotony THRESHOLD but no `monotony_prevention_score` — a second curve
would be an exact duplicate of the first. Setting `threshold_monotony` at or above
`threshold_fire` empties the band (no S_total satisfies `monotony <= s < fire`),
degrading safely to the original rest-only behavior rather than inverting the bands.

Post-fire filter: next rest spot ETA <= rest_spot_eta_filter_min (or no spot ahead)
— applied to the REST band ONLY, since refreshing content needs no place to stop.
Recovery suppresses both bands. There is still NO suggest/recommend/urgent ladder,
persistence gate, cooldown, 30-min cap, or emergency override — this adds a band,
not a ladder (others/20260630_発火ロジック検討用資料.md line 217;
others/aica_trigger_algorithms_math_comparison.md §1.2).

NOTE: with no cooldown, a proposal that is declined while the score stays inside
its band re-fires on the very next tick. That is pre-existing NRI behavior (its
rest band has always done this), now reachable in the monotony band too.

Bugfix (2026-08-04): cumulative_monotonous_min is now RELIEVED (reset to 0) when
its own monotony_prevention proposal is ANSWERED — acknowledge OR decline, any
non-null `lastProposalResult` — mirroring aica_transparent_hybrid_trigger_v1's
`mono_min` rebaseline. Before this fix the monotony accumulator never fell once
it entered the band, so the score stayed pinned above `threshold_monotony` and
could re-fire every tick for the rest of the run. Only the monotony accumulator
is relieved; jam/highway/driving accumulators are untouched. See
`mono_intervention_handled_sec` below for the once-per-intervention guard.

Bugfix (2026-08-04): the four cumulative accumulators (`cumulative_jam_min`,
`cumulative_highway_min`, `cumulative_monotonous_min`, `driving_min_since_rest`)
are now FROZEN — held at their pre-accept value, neither growing nor zeroing —
for the ENTIRE `recovery_active` window (accept tick, drive-to-spot, dwell),
then reset to 0 only at the `recovery_just_completed` (resume) edge. Before
this fix `motionState` is still "MOVING" during the drive-to-spot, so the
accumulators kept growing and S_total kept rising throughout the approach.

This deliberately does NOT mirror aica_transparent_hybrid_trigger_v1's
continuous rebaseline. Hybrid's rest/safety score is CLAMPED to [0,1] and
dominated by drowsiness/fatigue/anomaly (weight 0.75, vs 0.25 for exposure),
so zeroing its exposure accumulator every tick barely moves the (already
saturated) clamped score — it stays flat-high through the whole recovery
window. NRI's `s_total` is UNBOUNDED and dominated by the accumulated-exposure
terms `s_base`/`s_env` (S_realtime/drowsiness/fatigue is the minority term),
so zeroing the accumulators at accept-time would collapse the score to
near-zero immediately — the wrong behavior. Freezing (not zeroing) keeps
S_total flat-high through the whole recovery window, matching Hybrid's
observable OUTCOME (flat-high until resume) via a different mechanism suited
to NRI's unclamped, exposure-dominated shape. The score only drops at resume,
when the accumulators reset to 0 and start re-accumulating from scratch.

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
  - driving_min_since_rest: minutes driven since the last rest (FROZEN — not
    accrued — for the entire recovery_active window, then reset to 0 at the
    recovery_just_completed resume edge)
  - was_in_recovery: whether the previous tick was a recovery tick (reset edge)
  - mono_intervention_handled_sec: sim_time of the last monotony_prevention
    proposal whose ANSWER (acknowledge OR decline) already relieved
    cumulative_monotonous_min, so the same served proposal does not re-zero it
    every tick (mirrors aica_transparent_hybrid_trigger_v1's mono_min rebaseline)

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
# Feature contributions — EXACT additive decomposition of s_total
# ---------------------------------------------------------------------------
#
# NRI is a pure additive sum (S_total = S_base + S_env + S_realtime, each of
# those itself a sum of terms — see the module docstring), so unlike the
# Hybrid's clamped/smoothed score this decomposition is not an approximation:
# the rows below sum to s_total exactly (mod float summation order). Shape
# mirrors `aica_transparent_hybrid_trigger_v1.category_scores()`'s
# `feature_contributions` block so the review panel's `triggerOptions()`
# (app/frontend/src/lib/review/chains.ts) can render either package.


def _build_feature_contributions(
    *,
    driving_min_since_rest: float,
    is_night: bool,
    familiar_route: bool,
    child_passenger: bool,
    cumulative_jam_min: float,
    cumulative_highway_min: float,
    cumulative_monotonous_min: float,
    drowsiness_level: float,
    fatigue_level: float,
    s_total: float,
    recovered: bool,
    next_rest_min: float,
    rest_eta_filter: float,
    threshold_fire: float,
    hp: dict,
) -> dict:
    """Build the `feature_contributions` block for both trigger categories.

    The S_base time-damage term `T * w_base * m_night * m_familiar` (T =
    driving_min_since_rest) is split into THREE additive rows instead of one
    opaque "driving time" row, so a reviewer can see the night/familiar-route
    AMPLIFICATION separately from the raw accumulated minutes:

        continuous_driving_min        = T * w_base
        night_amplification           = T * w_base * (m_night - 1)
        familiar_route_amplification  = T * w_base * m_night * (m_familiar - 1)

    These three reconstruct the original product by direct algebraic expansion:

        T*w_base + T*w_base*(m_night-1) + T*w_base*m_night*(m_familiar-1)
      = T*w_base*[1 + (m_night-1) + m_night*(m_familiar-1)]
      = T*w_base*[m_night + m_night*m_familiar - m_night]
      = T*w_base*m_night*m_familiar

    Each amplification row reports the MULTIPLIER as its `value` (1.0 when the
    corresponding flag is off), so `contribution` is exactly 0.0 — not merely
    small — whenever that amplifier is inactive.

    `rest_required` and `monotony_prevention` get the SAME rows and the SAME
    score: NRI publishes one score banded by two thresholds (see the module
    docstring), so a second, differently-weighted decomposition would
    misrepresent the model as having two independent curves. The two blocks
    hold independent row-dict objects (not shared references) purely so a
    caller mutating one (e.g. filling in `band`) can never accidentally alter
    the other.
    """
    w_base = float(hp["w_base"])
    w_child = float(hp["w_child"])
    w_jam = float(hp["w_jam"])
    w_highway = float(hp["w_highway"])
    w_monotonous = float(hp["w_monotonous"])
    w_sleep = float(hp["w_sleep"])
    w_fatigue = float(hp["w_fatigue"])
    theta_sleep = float(hp["theta_sleep"])
    theta_fatigue = float(hp["theta_fatigue"])

    m_night = float(hp["m_night"]) if is_night else 1.0
    m_familiar = float(hp["m_familiar"]) if familiar_route else 1.0
    t_drive = driving_min_since_rest

    def _row(feature_id: str, value: float, weight: float, contribution: float) -> dict:
        return {
            "feature_id": feature_id,
            "value": value,
            "band": None,  # filled in by evaluate() from features_ordinal
            "weight": weight,
            "contribution": contribution,
        }

    def _rows() -> list[dict]:
        return [
            _row("continuous_driving_min", t_drive, w_base, t_drive * w_base),
            _row(
                "night_amplification", m_night, w_base,
                t_drive * w_base * (m_night - 1.0),
            ),
            _row(
                "familiar_route_amplification", m_familiar, w_base,
                t_drive * w_base * m_night * (m_familiar - 1.0),
            ),
            _row(
                "child_passenger", 1.0 if child_passenger else 0.0, w_child,
                w_child if child_passenger else 0.0,
            ),
            _row("traffic_jam", cumulative_jam_min, w_jam, cumulative_jam_min * w_jam),
            _row(
                "long_highway", cumulative_highway_min, w_highway,
                cumulative_highway_min * w_highway,
            ),
            _row(
                "monotony", cumulative_monotonous_min, w_monotonous,
                cumulative_monotonous_min * w_monotonous,
            ),
            _row(
                "drowsiness", drowsiness_level, w_sleep,
                max(0.0, drowsiness_level - theta_sleep) * w_sleep,
            ),
            _row(
                "fatigue", fatigue_level, w_fatigue,
                max(0.0, fatigue_level - theta_fatigue) * w_fatigue,
            ),
        ]

    gate_recovery = {
        "gate_id": "recovery_suppression",
        "evaluated_inputs": {},
        "threshold": 0.0,
        "passed": not recovered,
        "effect": "allow" if not recovered else "suppress",
    }

    eta_passed = next_rest_min <= rest_eta_filter or next_rest_min >= 9999.0
    gate_eta = {
        "gate_id": "rest_spot_eta_filter_min",
        "evaluated_inputs": {"nextRestSpotMin": next_rest_min},
        "threshold": rest_eta_filter,
        "passed": eta_passed,
        "effect": "allow" if eta_passed else "suppress",
    }

    below_fire = s_total < threshold_fire
    gate_superseded = {
        "gate_id": "superseded_by_rest_required",
        "evaluated_inputs": {"s_total": s_total},
        "threshold": threshold_fire,
        "passed": below_fire,
        "effect": "allow" if below_fire else "suppress",
    }

    return {
        "rest_required": {
            "score": s_total,
            "clamped": False,  # NRI never clamps; rows sum exactly to s_total
            "rows": _rows(),
            "gates": [gate_recovery, gate_eta],
        },
        "monotony_prevention": {
            "score": s_total,
            "clamped": False,
            "rows": _rows(),
            "gates": [gate_recovery, gate_superseded],
        },
    }


# ---------------------------------------------------------------------------
# State labels — two thresholds banding ONE score (no suggest/recommend/urgent
# ladder). REST_RECOVERY while resting, REST_FIRE at/above threshold_fire, else
# REST_NORMAL; MONOTONY_FIRE only INSIDE the band, so the two labels never both
# read "fire" on the same tick.
# ---------------------------------------------------------------------------


def _state_label(score: float, recovered: bool, threshold_fire: float) -> str:
    if recovered:
        return "REST_RECOVERY"
    if score >= threshold_fire:
        return "REST_FIRE"
    return "REST_NORMAL"


def _monotony_state_label(
    score: float, recovered: bool, threshold_monotony: float, threshold_fire: float
) -> str:
    if recovered:
        return "MONOTONY_RECOVERY"
    if threshold_monotony <= score < threshold_fire:
        return "MONOTONY_FIRE"
    return "MONOTONY_NORMAL"


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


_MONOTONY_PROPOSAL = {
    "ja": "単調な走行が続いています。気分転換をお勧めします。",
    "en": "Monotonous driving detected. Consider a short break or refreshing content.",
}


def _build_proposal(strength_label: str) -> dict:
    message = _PROPOSALS.get(strength_label, _PROPOSALS["gentle"])
    return {
        "id": "rest_required_proposal",
        "message": message,
        "options": ["accept_rest", "postpone", "decline"],
    }


def _build_monotony_proposal() -> dict:
    """The monotony-band proposal.

    Deliberately NOT offering `accept_rest`: this band sits BELOW the rest
    threshold, so it is a nudge toward refreshing content, not an instruction to
    go and stop somewhere. Its options mirror the Hybrid's monotony proposal so
    both algorithms are actionable under the same `scenario.allowed_actions`.
    """
    return {
        "id": "monotony_prevention_proposal",
        "message": _MONOTONY_PROPOSAL,
        "options": ["acknowledge", "decline"],
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

    # ── Hyperparameters — TWO thresholds banding one score + the ETA filter ──
    # `threshold_monotony` is the LOWER of the pair: one S_total, banded into a
    # rest band (>= threshold_fire) and a monotony band ([monotony, fire)).
    threshold_fire = float(hp["threshold_fire"])
    threshold_monotony = float(hp["threshold_monotony"])
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

    # ── Relieve monotony exposure when its OWN proposal is answered ───────
    # A rest is not the only intervention that relieves monotony — content
    # (acknowledge OR decline) does too, mirroring
    # aica_transparent_hybrid_trigger_v1's `mono_min` rebaseline. Without this,
    # once cumulative_monotonous_min saturated the monotony band it never fell,
    # and answering the monotony proposal changed nothing: the score stayed
    # pinned above threshold_monotony and could re-fire every tick (NRI has no
    # cooldown). DESIGN DECISION: ANY non-null lastProposalResult relieves, not
    # acknowledge-only — declining still counts as "answered".
    #
    # The guard mirrors Hybrid's `mono_intervention_handled_sec`: without it,
    # `lastProposalTimeSec` stays pointing at the same served proposal for many
    # ticks, so the accumulator would be re-zeroed every tick and monotony
    # could never rebuild to fire again. Only fires once per intervention
    # (until a NEW monotony proposal's sim_time appears).
    last_proposal_category = proposal_history.get("lastProposalCategory")
    last_proposal_result = proposal_history.get("lastProposalResult")
    mono_intervention_sec = (
        proposal_history.get("lastProposalTimeSec")
        if last_proposal_category == "monotony_prevention" and last_proposal_result is not None
        else None
    )
    prev_mono_handled_sec = prev_state.get("mono_intervention_handled_sec")
    mono_intervention_relieved_this_tick = (
        mono_intervention_sec is not None and mono_intervention_sec != prev_mono_handled_sec
    )
    mono_intervention_handled_sec = (
        mono_intervention_sec if mono_intervention_relieved_this_tick else prev_mono_handled_sec
    )

    # ── Retrieve cumulative state from previous tick ──────────────────────
    prev_jam_min = float(prev_state.get("cumulative_jam_min", 0.0))
    prev_highway_min = float(prev_state.get("cumulative_highway_min", 0.0))
    prev_mono_min = float(prev_state.get("cumulative_monotonous_min", 0.0))
    prev_driving_min = float(prev_state.get("driving_min_since_rest", 0.0))

    # ── Reset accumulators after recovery completes ───────────────────────
    # LOAD-BEARING: the accumulation step below FREEZES the four accumulators
    # (via `accrue = is_moving and not recovery_active`) for the entire
    # recovery_active window rather than zeroing them, so `prev_state` on the
    # resume tick (recovery_just_completed=True) still holds the pre-accept
    # accumulated total. This is the ONLY place that resets it to 0 — drop
    # this block and the score would never fall after a completed recovery.
    if recovery_just_completed:
        prev_jam_min = 0.0
        prev_highway_min = 0.0
        prev_mono_min = 0.0
        prev_driving_min = 0.0

    # Relieve monotony exposure when its own proposal is answered (mirrors
    # Hybrid's mono_min rebaseline) — monotony ONLY; content does not clear a
    # traffic jam or un-drive the highway, so jam/highway/driving are untouched.
    if mono_intervention_relieved_this_tick:
        prev_mono_min = 0.0

    # ── Determine tick duration from simulation time ──────────────────────
    prev_sim_time = float(prev_state.get("last_sim_time", 0.0))
    tick_duration_min = (sim_time - prev_sim_time) / 60.0 if prev_sim_time > 0 else 1.0
    if tick_duration_min <= 0:
        tick_duration_min = 1.0

    # ── Only accumulate time when MOVING, and FREEZE during recovery ──────
    # `accrue` gates all four accumulators: they grow only while actually
    # driving (`is_moving`) AND not in a recovery window (`not
    # recovery_active`). This freezes them at their pre-accept value for the
    # WHOLE recovery window: during the MOVING drive-to-spot, `recovery_active`
    # is True so accrue is False (frozen, not growing); during the STOPPED
    # dwell, `is_moving` is already False (frozen for the same reason it
    # always was). Freezing — rather than zeroing — is deliberate: see the
    # module docstring's 2026-08-04 bugfix note for why NRI must not mirror
    # Hybrid's continuous rebaseline. The frozen values reset to 0 only at the
    # `recovery_just_completed` resume edge, via `prev_*` above.
    is_moving = motion_state == "MOVING"
    accrue = is_moving and not recovery_active

    cumulative_jam_min = prev_jam_min + (
        tick_duration_min if (is_traffic_jam and accrue) else 0.0
    )
    cumulative_highway_min = prev_highway_min + (
        tick_duration_min if (segment_type == "highway" and accrue) else 0.0
    )
    is_monotonous = segment_type in ("highway", "normal_road")
    cumulative_monotonous_min = prev_mono_min + (
        tick_duration_min if (is_monotonous and accrue) else 0.0
    )
    driving_min_since_rest = prev_driving_min + (
        tick_duration_min if accrue else 0.0
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

    # ── Feature contributions (exact decomposition of s_total) ────────────
    # Built here — after s_total but before the fire-control gates below reuse
    # the same recovered/next_rest_min/rest_eta_filter/threshold_fire inputs
    # to describe the SAME gates the fire-control block evaluates, so the
    # review panel's gate list matches what actually decided the tick.
    feature_contributions = _build_feature_contributions(
        driving_min_since_rest=driving_min_since_rest,
        is_night=is_night,
        familiar_route=familiar_route,
        child_passenger=child_passenger,
        cumulative_jam_min=cumulative_jam_min,
        cumulative_highway_min=cumulative_highway_min,
        cumulative_monotonous_min=cumulative_monotonous_min,
        drowsiness_level=drowsiness_level,
        fatigue_level=fatigue_level,
        s_total=s_total,
        recovered=recovered,
        next_rest_min=next_rest_min,
        rest_eta_filter=rest_eta_filter,
        threshold_fire=threshold_fire,
        hp=hp,
    )

    # ── State labels ──────────────────────────────────────────────────────
    state_label = _state_label(s_total, recovered, threshold_fire)
    monotony_state_label = _monotony_state_label(
        s_total, recovered, threshold_monotony, threshold_fire
    )

    # ── Fire-control — TWO thresholds banding ONE score, then the post-fire
    # ETA filter on the REST band only.
    #
    #     S_total >= threshold_fire                       -> rest_required
    #     threshold_monotony <= S_total < threshold_fire  -> monotony_prevention
    #     S_total <  threshold_monotony                   -> nothing
    #
    # Order within the rest band is unchanged: recovery suppression (never
    # propose while resting) → below fire threshold (no candidate) → ETA filter →
    # fire. Still no persistence gate, cooldown, 30-min cap, or emergency
    # override — this adds a band, not a ladder.
    #
    # A `threshold_monotony` set at or above `threshold_fire` makes the band
    # empty (no S_total can satisfy `monotony <= s < fire`), which degrades to the
    # previous rest-only behavior rather than inverting the two bands.
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

    # ── Monotony band ─────────────────────────────────────────────────────
    # No ETA filter here: refreshing content needs no place to stop, so the
    # thing that suppresses a rest proposal must not suppress this one.
    mono_exists = s_total >= threshold_monotony
    mono_in_band = mono_exists and s_total < threshold_fire
    mono_fired = False
    mono_suppressed = False

    if recovered:
        mono_suppressed = True
        mono_reason = "recovery_after_accept"
    elif not mono_exists:
        mono_reason = "below_monotony_threshold"
    elif not mono_in_band:
        # The score cleared this threshold too, but the higher-priority rest band
        # owns the tick. Say so, rather than reporting it as below threshold.
        mono_suppressed = True
        mono_reason = "superseded_by_rest_required"
    else:
        mono_fired = True
        mono_reason = "monotony_threshold_passed"

    # ── Build candidates (both RETAINED, fired or not — §11) ──────────────
    candidates = [
        {
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
        },
        {
            "category": "monotony_prevention",
            "exists": mono_exists,
            "score": s_total,
            "state": monotony_state_label,
            "strength": "gentle" if mono_in_band else None,
            "fire_control": {
                "fired": mono_fired,
                "suppressed": mono_suppressed,
                "override": False,
                "reason": mono_reason,
            },
        },
    ]

    # ── Result type + the overall fire_control mirror ─────────────────────
    # Rest outranks monotony (trigger_categories priority 1 vs 2), and the bands
    # are disjoint anyway, so at most one of them ever fires.
    if fired:
        result_type = "REST_PROPOSAL"
        selected_category = "rest_required"
        overall_fc = {"fired": True, "suppressed": False, "override": override, "reason": reason}
    elif mono_fired:
        result_type = "MONOTONY_PROPOSAL"
        selected_category = "monotony_prevention"
        overall_fc = {"fired": True, "suppressed": False, "override": False, "reason": mono_reason}
    elif suppressed or mono_suppressed:
        result_type = "SUPPRESSED"
        selected_category = None
        # Report the REST suppression when there is one — it is the higher-priority
        # category and the more consequential thing to have withheld.
        overall_fc = (
            {"fired": False, "suppressed": True, "override": False, "reason": reason}
            if suppressed
            else {"fired": False, "suppressed": True, "override": False, "reason": mono_reason}
        )
    else:
        result_type = "NO_PROPOSAL"
        selected_category = None
        overall_fc = {"fired": False, "suppressed": False, "override": False, "reason": reason}

    # ── Proposal + explanation ────────────────────────────────────────────
    proposal = None
    if fired and strength_label:
        proposal = _build_proposal(strength_label)
    elif mono_fired:
        proposal = _build_monotony_proposal()

    reason_inputs = [
        "continuous_driving_min", "drowsiness", "fatigue",
        "traffic_jam", "highway", "monotonous_road",
    ]

    # Name WHICH band the score landed in — with two thresholds on one score,
    # "fired / not fired" alone no longer says what happened.
    if fired:
        band_ja = f"休憩しきい値({threshold_fire:.0f})超で発火"
        band_en = f"fired: at/above the rest threshold ({threshold_fire:.0f})"
    elif mono_fired:
        band_ja = f"単調性帯({threshold_monotony:.0f}〜{threshold_fire:.0f})で発火"
        band_en = (
            f"fired: inside the monotony band "
            f"({threshold_monotony:.0f}–{threshold_fire:.0f})"
        )
    else:
        band_ja = "未発火"
        band_en = "not fired"

    explanation = [
        {
            "ja": (
                f"総合疲労スコア={s_total:.1f}点 "
                f"(基礎={s_base:.1f} + 環境={s_env:.1f} + リアルタイム={s_realtime:.1f})。"
                f"{band_ja}、状態={state_label}／{monotony_state_label}。"
            ),
            "en": (
                f"Total fatigue score={s_total:.1f}pts "
                f"(base={s_base:.1f} + env={s_env:.1f} + realtime={s_realtime:.1f}). "
                f"{band_en}, state={state_label} / {monotony_state_label}."
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
        "mono_intervention_handled_sec": mono_intervention_handled_sec,
    }

    # ── Features ordinal (for trace display) ──────────────────────────────
    features_ordinal = {k: str(v) for k, v in ordinal.items()}

    # Attach the ordinal band word each row's raw value falls in, so the
    # review panel can lead with the value a reviewer already understands.
    # `ordinal` is keyed independently of the row feature_ids above (e.g. the
    # split-out `night_amplification` / `familiar_route_amplification` rows
    # have no ordinal entry of their own) — a miss stays None rather than
    # guessing (mirrors aica_transparent_hybrid_trigger_v1.evaluate()).
    for block in feature_contributions.values():
        for row in block["rows"]:
            row["band"] = features_ordinal.get(row["feature_id"])

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
    # Same divisor for the monotony rule — otherwise the timeline would draw it at
    # its RAW value (~55) on a 0-1 axis. Note there is deliberately no
    # `monotony_prevention_score`: NRI has ONE score, so a second curve would just
    # be a duplicate of the first drawn on top of it. Two thresholds, one score.
    normalized_monotony_threshold = (
        min(1.0, threshold_monotony / max_display) if max_display > 0 else 0.0
    )

    return {
        "result_type": result_type,
        "trigger_candidate": fired or mono_fired,
        "selected_category": selected_category,
        "score": normalized_score,
        "features": features_ordinal,
        "scores": {
            "s_total": s_total,
            "s_base": s_base,
            "s_env": s_env,
            "s_realtime": s_realtime,
            "rest_required_score": normalized_score,
        },
        "feature_contributions": feature_contributions,
        "states": {
            "rest": state_label,
            "monotony": monotony_state_label,
        },
        "criteria": {
            "threshold_fire": threshold_fire,
            "threshold_monotony": threshold_monotony,
            # thresholds on the SAME 0-1 scale as rest_required_score (for the
            # timeline threshold lines); the two above stay raw (s_total scale).
            "rest_required_threshold": normalized_threshold,
            "monotony_suggest_threshold": normalized_monotony_threshold,
            "rest_spot_eta_filter_min": rest_eta_filter,
        },
        "candidates": candidates,
        "fire_control": overall_fc,
        "proposal": proposal,
        "reason_inputs": reason_inputs,
        "explanation": explanation,
        "next_package_runtime_state": next_runtime_state,
    }
