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

Recovery-semantics refactor (2026-08-08): the served-monotony-proposal relief
hack ("relieve cumulative_monotonous_min when its own proposal is ANSWERED")
is RETIRED. Relief on the monotony channel is now the same mechanism the tick
engine and aica_transparent_hybrid_trigger_v1 use: `cumulative_monotonous_min`
additionally stops accruing on any tick the engine reports
`signals.dynamic.stimulusFrozen`, and is drained by
`signals.dynamic.stimulusReliefMin` (the same accumulator-minutes the engine
drained from its own `monotony_accrued_min` that tick, floored at 0). This
makes NRI and Hybrid react identically to the same driver/content event
instead of coincidentally similarly — see design §7. `cumulative_jam_min`,
`cumulative_highway_min` and `driving_min_since_rest` are never drained;
content does not un-drive a highway, clear a jam, or stop the clock.

The four cumulative accumulators (`cumulative_jam_min`, `cumulative_highway_min`,
`cumulative_monotonous_min`, `driving_min_since_rest`) FREEZE — held at their
pre-accept value, neither growing nor zeroing — but ONLY while the vehicle is
actually STOPPED (`motionState != "MOVING"`), not for the whole
`recovery_active` window. The driver is still driving, and still accumulating
real exposure, during the MOVING approach to the rest spot (design §6 case 2)
— only the STOPPED dwell freezes exposure.

They reset to 0 at the END of the rest — the one `recoveryPhase == "resuming"`
tick, where every stage is done and the engine still holds the car AT the rest
spot (fixbug-0806). That tick also accrues nothing, because the car is parked
even though the engine reports `motionState == "MOVING"` on it. Previously the
reset was keyed on recovery going inactive, which is the FIRST TICK OF THE
RESUMED DRIVE: on the route-fraction axis the whole drop was then drawn past
the rest spot, preceded by an upward kick from that parked tick's phantom
driving minute.

Feature 009 (signal-tier redesign) — reads from the tiered `context["signals"]`
contract (`specs/009-signal-tier-redesign/contracts/tiered-context.md`) instead of a
flat `raw_state`. The math is UNCHANGED (see `others/aica_trigger_algorithms_math_comparison.md`
Part 1 §1.2 and `specs/009-signal-tier-redesign/data-model.md` §6); only the input SOURCE
changed, and `S_realtime` is now genuinely live because Tier-3a `drowsiness`/`fatigue`
signals exist (they were always 0 before 009).

  - Tier 1 (fixed, scenario constants): `isNight`, `familiarRoute`, `childPassenger`.
  - Tier 2 (dynamic): `isTrafficJam`, `segmentType`, `motionState`, `nextRestSpotMin`,
    `recoveryPhase`, `stimulusFrozen`, `stimulusReliefMin`.
  - Tier 3a (simulated, latent): `drowsiness`, `fatigue` — feed `S_realtime`.

State carried across ticks (via package_runtime_state):
  - cumulative_jam_min: minutes spent in traffic jam (frozen while STOPPED,
    reset to 0 at the recovery_just_completed resume edge)
  - cumulative_highway_min: minutes spent on highway (same freeze/reset)
  - cumulative_monotonous_min: minutes spent on monotonous road; additionally
    frozen and drained by `stimulusReliefMin` while `stimulusFrozen` is True
    (same freeze/reset otherwise)
  - driving_min_since_rest: minutes driven since the last rest (frozen while
    STOPPED, then reset to 0 at the recovery_just_completed resume edge)
  - was_in_recovery: whether the previous tick was a recovery tick (reset edge)

Every hyperparameter is read via direct `hp[key]` indexing — NO `hp.get(key, <hardcoded
default>)` fallback. `context["hyperparameters"]` is guaranteed fully resolved (manifest
defaults ⊕ overrides, every declared key present) by the adapter/run_manager (FR-009); a
missing key here is a real configuration bug and MUST surface as a KeyError ->
algorithm_error, never a silently-wrong default.

Pure & deterministic: no backend imports, no clocks, no randomness.
"""

from __future__ import annotations


# The "no rest spot ahead" sentinel published by `dynamic.nextRestSpotMin`.
# Historically this VALUE PASSED the rest-ETA gate (>= 9999.0 was folded into
# the "allow" branch alongside "<= filter"), so having no spot ahead FIRED a
# rest proposal — exactly backwards. It now correctly FAILS actionability
# (see the shared actionability computation in `evaluate`).
_NO_REST_SENTINEL = 9999.0


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
    spot_actionable: bool,
    spot_reason: str | None,
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

    gate_eta = {
        "gate_id": "rest_spot_eta_filter_min",
        "evaluated_inputs": {"nextRestSpotMin": next_rest_min, "reason": spot_reason},
        "threshold": rest_eta_filter,
        "passed": spot_actionable,
        "effect": "allow" if spot_actionable else "suppress",
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
# Forecast-based early-rest gate list (Task 5; spec §14.2) — REPLACES
# `feature_contributions["rest_required"]["gates"]` (the plain
# `[gate_recovery, gate_eta]` pair above) whenever the orchestration supplied
# an evaluated `nri_forecast` block, so a reviewer inspecting evidence sees
# every input the forecast path actually consulted, not just the two-gate
# summary that describes the ordinary path alone. The 11-gate ORDER below is
# the spec's — do not reorder.
# ---------------------------------------------------------------------------


def _gate(gid, passed, inputs, effect_allow="allow", effect_suppress="suppress"):
    return {
        "gate_id": gid,
        "evaluated_inputs": inputs,
        "passed": passed,
        "effect": effect_allow if passed else effect_suppress,
    }


def _forecast_rest_gates(
    *, order_valid, s_total, t_forecast, t_fire, ff, frs, crs, fs, recovered, eta_filter
):
    return [
        _gate("forecast_threshold_order", order_valid, {"t_forecast": t_forecast}),
        _gate("forecast_current_score", t_forecast < s_total < t_fire, {"s_total": s_total}),
        _gate("forecast_future_fire", bool(ff.get("found")), {"s_total": ff.get("s_total")}),
        _gate(
            "forecast_committed_intervention", True,
            {"content_active": fs.get("content_active"), "service_id": fs.get("service_id")},
        ),
        _gate(
            "forecast_future_rest_spot", bool(frs.get("exists")),
            {"position_km": frs.get("position_km")},
        ),
        _gate(
            "forecast_future_rest_spot_eta",
            frs.get("eta_from_fire_min") is not None and frs.get("eta_from_fire_min") <= eta_filter,
            {"eta_from_fire_min": frs.get("eta_from_fire_min"), "limit": eta_filter},
        ),
        _gate(
            "forecast_destination_edge",
            frs.get("eta_to_destination_min") is not None and frs.get("eta_to_destination_min") >= 10.0,
            {"eta_to_destination_min": frs.get("eta_to_destination_min")},
        ),
        _gate(
            "forecast_current_rest_spot",
            bool(crs.get("exists")) and crs.get("eta_from_current_min") is not None,
            {"nextRestSpotMin": crs.get("eta_from_current_min")},
        ),
        _gate(
            "forecast_current_rest_spot_eta",
            crs.get("eta_from_current_min") is not None and crs.get("eta_from_current_min") <= eta_filter,
            {"eta_from_current_min": crs.get("eta_from_current_min"), "limit": eta_filter},
        ),
        _gate(
            "forecast_current_rest_spot_destination_edge",
            crs.get("eta_to_destination_min") is not None and crs.get("eta_to_destination_min") >= 10.0,
            {"eta_to_destination_min": crs.get("eta_to_destination_min")},
        ),
        _gate("recovery_suppression", not recovered, {}),
    ]


# ---------------------------------------------------------------------------
# State labels — two thresholds banding ONE score (no suggest/recommend/urgent
# ladder). REST_RECOVERY while resting, REST_FIRE at/above threshold_fire, else
# REST_NORMAL; MONOTONY_FIRE only INSIDE the band, so the two labels never both
# read "fire" on the same tick.
# ---------------------------------------------------------------------------


def _state_label(
    score: float, recovered: bool, threshold_fire: float, early_fire: bool = False
) -> str:
    if recovered:
        return "REST_RECOVERY"
    if early_fire:
        return "REST_FORECAST_FIRE"
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


_FORECAST_REST_PROPOSAL = {
    "ja": (
        "このまま走ると、休憩が必要になる時に近くの休憩場所を使えない見込みです。"
        "前方の休憩場所で早めに休むことをおすすめします。"
    ),
    "en": (
        "At the current trend, no nearby rest facility is expected to be actionable "
        "when a rest becomes necessary. We suggest resting at the available facility "
        "ahead before continuing."
    ),
}


def _build_forecast_proposal() -> dict:
    """The forecast-based early-rest proposal (Task 5; manifest
    `forecast_rest_required_proposal`, added by Task 1).

    Mirrors `_build_proposal`'s structure and source: this module never reads
    `package.json` at runtime (see `_PROPOSALS`/`_MONOTONY_PROPOSAL` above) —
    the copy here is the manifest's declared JA/EN text, kept verbatim so the
    two never drift. It deliberately keeps `accept_rest` among the options
    (this IS a rest proposal, just an early one — unlike the monotony
    proposal's options, which omit it) and its copy must NOT claim the
    fire threshold (100) was already crossed, only that the CURRENT spot is
    the one being offered (§12.1).
    """
    return {
        "id": "forecast_rest_required_proposal",
        "message": _FORECAST_REST_PROPOSAL,
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

    # ── Current rest-spot actionability (shared rule; design §10, §11.2, §18) ──
    # Prefer the orchestration-computed forecast block (it knows the spot's
    # ETA-to-destination); fall back to the native nextRestSpotMin gate when no
    # block is present at all. The old ">= 9999 means fire" exception is GONE
    # in both. Read `current_rest_spot` whenever the block is present — the
    # scaffold (evaluated=False), the full pass-2 block, and run_forecast's own
    # error block all populate it with the real, destination-edge-aware value.
    _forecast = context.get("nri_forecast") or {}
    _crs = _forecast.get("current_rest_spot")
    if _crs is not None:
        spot_actionable = bool(_crs.get("actionable"))
        spot_reason = _crs.get("unactionable_reason")
    else:
        spot_actionable = (
            next_rest_min != _NO_REST_SENTINEL and next_rest_min <= rest_eta_filter
        )
        spot_reason = None if spot_actionable else (
            "no_spot_ahead" if next_rest_min >= _NO_REST_SENTINEL
            else "rest_spot_eta_over_limit"
        )

    # ── Forecast-based early-rest eligibility, precursors (Task 5; §7, §11) ─
    # `hp["threshold_forecast_rest"]` (Task 1) bands the ordinary rest
    # threshold: strictly between it and `threshold_fire` is the "early" zone.
    # `order_valid` combines the STATIC hp ordering with the forecast
    # service's own `threshold_order_valid` verdict (Task 4) — either one
    # being wrong disables the forecast path without touching the ordinary
    # rest/monotony bands. The forecast-block sub-dicts are pulled once here
    # (independent of s_total/recovered) and reused below for both the
    # `early_fire` decision and the §14.1/§14.2 evidence. The full `early_fire`
    # boolean additionally needs `s_total` and `recovered`, neither computed
    # yet — finalized right after `s_total` exists, further below.
    threshold_forecast = float(hp["threshold_forecast_rest"])
    _fc = _forecast  # alias from Task 3
    forecast_evaluated = bool(_fc.get("evaluated"))
    order_valid = (
        threshold_monotony < threshold_forecast < threshold_fire
        and bool(_fc.get("threshold_order_valid", True))
    )
    _ff = _fc.get("future_fire") or {}
    _frs = _fc.get("forecast_rest_spot") or {}
    _crs2 = _fc.get("current_rest_spot") or {}
    _fs = _fc.get("forecast_start") or {}
    future_fire_found = bool(_ff.get("found"))
    future_unactionable = bool(_fc.get("forecast_future_rest_unactionable"))

    # ── Recovery detection (early — needed before accumulation) ───────────
    # Detect recovery from dynamic.recoveryPhase (set by tick engine when
    # a recovery sequence is active). No framework-level flag needed.
    recovery_phase = dynamic.get("recoveryPhase")
    recovery_active = recovery_phase is not None
    was_in_recovery = bool(prev_state.get("was_in_recovery", False))

    # The rest ENDS on the "resuming" tick, AT the rest spot (fixbug-0806).
    #
    # `services/recovery.py` gives every finished recovery exactly one
    # `phase == "resuming"` tick: all stages are done, the engine still HOLDS
    # the car at the spot (`tick_engine.py`, the `stage is None` branch), and
    # `advance_recovery` deactivates recovery on the following tick — the first
    # tick of the resumed drive, at a route position PAST the spot.
    #
    # Keying the reset on `not recovery_active` therefore zeroed the
    # accumulators one tick late, and since the chart's x-axis is route
    # fraction, NRI's whole post-rest drop was drawn on the road AFTER the rest
    # spot instead of at it: the reviewer saw the score sag slightly at the spot
    # (only S_realtime, as drowsiness/fatigue recover) and then fall off a cliff
    # while the driver was already driving away. Worse, that in-between tick
    # ACCRUED a fresh driving minute while the car was parked, so the score
    # ticked UP at the spot first.
    #
    # `resuming` is the honest edge: the driver has rested, and has not moved.
    # `was_resuming` keeps it a ONE-TICK event — without it the old condition
    # would fire again on the next tick and zero the first real minute of the
    # resumed drive. The `was_in_recovery and not recovery_active` clause is
    # kept as a fallback for a recovery that ends without a resuming tick
    # (e.g. a run that completes mid-recovery).
    resuming = recovery_phase == "resuming"
    was_resuming = bool(prev_state.get("was_resuming", False))
    recovery_just_completed = resuming or (
        was_in_recovery and not recovery_active and not was_resuming
    )

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
    # LOAD-BEARING: the accumulation step below FREEZES the four accumulators
    # while the vehicle is actually STOPPED (not for the whole recovery_active
    # window — see below) rather than zeroing them, so `prev_state` on the
    # resume tick (recovery_just_completed=True) still holds the pre-accept
    # accumulated total. This is the ONLY place that resets it to 0 — drop
    # this block and the score would never fall after a completed recovery.
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

    # ── Only accumulate time while actually MOVING ─────────────────────────
    # Recovery-semantics refactor. Two corrections to the accrual gate:
    #
    #   1. Only the STOPPED dwell freezes exposure. The MOVING approach to the
    #      rest spot used to freeze too (via the old `accrue = is_moving and
    #      not recovery_active`), so the score sat flat while the driver was
    #      genuinely still driving and still accumulating risk (design §6
    #      case 2). The driver is driving until the wheels stop — `accrue` is
    #      now gated on `is_moving` alone; during the STOPPED dwell
    #      `is_moving` is already False, which is what freezes it (the same
    #      reason it always did).
    #   2. `cumulative_monotonous_min` additionally stops accruing, and is
    #      drained, on any tick the engine reports `stimulusFrozen` —
    #      mirroring the engine exactly, which is what makes NRI and Hybrid
    #      structurally identical here (design §7, P5) instead of
    #      coincidentally similar. `stimulusReliefMin` is the SAME
    #      accumulator-minutes the engine drained from its own
    #      `monotony_accrued_min` this tick (0.0 when nothing is playing);
    #      NRI applies the identical number rather than re-deriving its own
    #      drain rate. `cumulative_jam_min`/`cumulative_highway_min` are
    #      never drained — content does not un-drive a highway or clear a jam.
    #   3. The "resuming" tick accrues NOTHING (fixbug-0806). The engine reports
    #      `motionState == "MOVING"` on it while holding the car at the rest
    #      spot, so the plain `is_moving` gate charged the driver a full tick of
    #      driving exposure for a minute they spent parked — a visible upward
    #      kick in the score at the very spot the rest was taken.
    is_moving = motion_state == "MOVING"
    stimulus_frozen = bool(dynamic.get("stimulusFrozen", False))
    stimulus_relief_min = float(dynamic.get("stimulusReliefMin", 0.0))
    accrue = is_moving and not resuming
    accrue_monotonous = accrue and not stimulus_frozen

    cumulative_jam_min = prev_jam_min + (
        tick_duration_min if (is_traffic_jam and accrue) else 0.0
    )
    cumulative_highway_min = prev_highway_min + (
        tick_duration_min if (segment_type == "highway" and accrue) else 0.0
    )
    is_monotonous = segment_type in ("highway", "normal_road")
    cumulative_monotonous_min = prev_mono_min + (
        tick_duration_min if (is_monotonous and accrue_monotonous) else 0.0
    )
    cumulative_monotonous_min = max(0.0, cumulative_monotonous_min - stimulus_relief_min)
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

    # ── Finalize the forecast early-fire decision (needs s_total + recovered,
    # both now available) ──────────────────────────────────────────────────
    # Strict on BOTH sides (§7): the current score must be above the early
    # threshold and still below the safety threshold. At/above threshold_fire
    # the ordinary rest path (below) already fires on its own — this path
    # exists for the band strictly BELOW threshold_fire, and its copy must
    # never claim that threshold was already crossed (§12.1).
    early_fire = (
        order_valid
        and forecast_evaluated
        and (threshold_forecast < s_total < threshold_fire)
        and not recovered
        and future_fire_found
        and future_unactionable
        and spot_actionable  # current spot actionable (Task 3)
    )

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
        spot_actionable=spot_actionable,
        spot_reason=spot_reason,
        hp=hp,
    )

    # When the orchestration supplied an evaluated forecast block, the
    # rest_required gate list is REPLACED by the full §14.2 11-gate forecast
    # list — evidence should show every input the forecast path consulted,
    # not just the two-gate ordinary summary. Preserves gate ORDER exactly.
    if forecast_evaluated:
        feature_contributions["rest_required"]["gates"] = _forecast_rest_gates(
            order_valid=order_valid, s_total=s_total, t_forecast=threshold_forecast,
            t_fire=threshold_fire, ff=_ff, frs=_frs, crs=_crs2, fs=_fs,
            recovered=recovered, eta_filter=rest_eta_filter,
        )

    # ── State labels ──────────────────────────────────────────────────────
    state_label = _state_label(s_total, recovered, threshold_fire, early_fire=early_fire)
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
    exists = (s_total >= threshold_fire) or early_fire
    # Manifested-risk (drowsiness/fatigue past their θ dead-band) → a stronger
    # message; otherwise the accumulated-fatigue message. Uses only the existing
    # θ thresholds — no extra fire-control hyperparameter. The early-fire
    # strength is FIXED at "clear" (§12.3) — it is a proactive nudge, not a
    # manifested-risk escalation, regardless of s_realtime.
    if early_fire:
        strength_label = "clear"
    elif exists:
        strength_label = "strong" if s_realtime > 0.0 else "clear"
    else:
        strength_label = None

    fired = False
    suppressed = False
    override = False

    if recovered:
        suppressed = True
        reason = "recovery_after_accept"
    elif early_fire:
        fired = True
        reason = "forecast_rest_opportunity_passed"
    elif not exists:
        reason = "below_fire_threshold"
    elif spot_actionable:
        fired = True
        reason = "fire_threshold_passed"
    else:
        suppressed = True
        reason = spot_reason  # no_spot_ahead | rest_spot_eta_over_limit | inside_destination_edge

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
    elif early_fire:
        # The forecast early-rest proposal owns the tick — say so rather than
        # letting monotony fire alongside/instead of it.
        mono_suppressed = True
        mono_reason = "superseded_by_forecast_rest"
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
    if early_fire:
        proposal = _build_forecast_proposal()
    elif fired and strength_label:
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

    if early_fire:
        # Early-rest specific copy (§14.3). It must NOT claim the safety
        # threshold was already crossed (§12.1) — the score sits strictly
        # BELOW it — so the fire threshold's numeric value is deliberately
        # omitted here (it would read as "100" and misstate the situation);
        # we name it qualitatively ("the safety threshold") instead.
        reason_word = _fc.get("forecast_rest_unactionable_reason")
        explanation = [
            {
                "ja": (
                    f"総合疲労スコア={s_total:.1f}点 "
                    f"(基礎={s_base:.1f}+環境={s_env:.1f}+実時間={s_realtime:.1f})。"
                    f"早期閾値{threshold_forecast:.0f}超・安全閾値未満。"
                    f"予測: 約{_ff.get('elapsed_min')}分/{_ff.get('distance_km')}kmで安全閾値に到達見込み、"
                    f"その時の休憩地は利用困難({reason_word})。"
                    f"現在の休憩地までETA={_crs2.get('eta_from_current_min')}分、"
                    f"到着後の目的地までETA={_crs2.get('eta_to_destination_min')}分。前方で早めの休憩を提案。"
                ),
                "en": (
                    f"Total fatigue score={s_total:.1f} "
                    f"(base={s_base:.1f}+env={s_env:.1f}+realtime={s_realtime:.1f}). "
                    f"Above early threshold {threshold_forecast:.0f}, below the safety threshold. "
                    f"Forecast: safety threshold reached in ~{_ff.get('elapsed_min')} min / "
                    f"{_ff.get('distance_km')} km, where the rest spot would be unusable ({reason_word}). "
                    f"Current rest spot ETA={_crs2.get('eta_from_current_min')} min, "
                    f"destination ETA after it={_crs2.get('eta_to_destination_min')} min. "
                    f"Proposing an early rest ahead."
                ),
            }
        ]
    else:
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
        # Keeps the reset a one-tick event (see `recovery_just_completed`).
        "was_resuming": resuming,
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
            # ── Forecast early-rest evidence (Task 5; spec §14.1) ──────────
            # Mirrors every input the forecast path consulted so the review
            # panel can audit the early-fire decision. All values are pulled
            # from the orchestration-supplied `nri_forecast` block (Task 4);
            # when no forecast block was supplied these are the empty-dict
            # `.get()` defaults (None / order-check on hp alone).
            "threshold_forecast_rest": threshold_forecast,
            "forecast_threshold_order_valid": order_valid,
            "forecast_mode": _fc.get("forecast_mode"),
            "forecast_start_content_active": _fs.get("content_active"),
            "forecast_start_service_id": _fs.get("service_id"),
            "forecast_start_content_remaining_min": _fs.get("content_remaining_min"),
            "forecast_fire_found": future_fire_found,
            "forecast_fire_s_total": _ff.get("s_total"),
            "forecast_fire_eta_from_now_min": (
                None if _ff.get("elapsed_min") is None
                else _ff["elapsed_min"] - sim_time / 60.0
            ),
            "forecast_fire_distance_km": _ff.get("distance_km"),
            "forecast_rest_spot_exists": _frs.get("exists"),
            "forecast_rest_spot_eta_from_fire_min": _frs.get("eta_from_fire_min"),
            "forecast_rest_spot_eta_to_destination_min": _frs.get("eta_to_destination_min"),
            "forecast_rest_spot_actionable": _frs.get("actionable"),
            "forecast_future_rest_unactionable": future_unactionable,
            "forecast_rest_unactionable_reason": _fc.get("forecast_rest_unactionable_reason"),
            "current_rest_spot_exists": _crs2.get("exists"),
            "current_rest_spot_eta_min": _crs2.get("eta_from_current_min"),
            "current_rest_spot_eta_to_destination_min": _crs2.get("eta_to_destination_min"),
            "current_rest_spot_actionable": _crs2.get("actionable"),
            "current_rest_spot_unactionable_reason": _crs2.get("unactionable_reason"),
        },
        "candidates": candidates,
        "fire_control": overall_fc,
        "proposal": proposal,
        "reason_inputs": reason_inputs,
        "explanation": explanation,
        "next_package_runtime_state": next_runtime_state,
    }
