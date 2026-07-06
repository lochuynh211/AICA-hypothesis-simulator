"""TDD tests for `nri_fatigue_score_v1` on the tiered-signal contract (feature 009, Unit E).

NRI's scoring math is UNCHANGED:

    S_total = S_base + S_env + S_realtime
    S_base    = child_offset + T_drive * W_base * M_night * M_familiar
    S_env     = T_jam * W_jam + T_hw * W_highway + T_mono * W_monotonous
    S_realtime = max(0, V_sleep - theta_sleep) * W_sleep + max(0, V_fatigue - theta_fatigue) * W_fatigue

Only the input SOURCE changes: flat `raw_state` -> tiered `context["signals"]`
(`specs/009-signal-tier-redesign/contracts/tiered-context.md`). The key behavior change
under test: `S_realtime` is now genuinely live because Tier-3a `drowsiness`/`fatigue`
signals exist (they were always 0 before 009).

Authoritative math: `others/aica_trigger_algorithms_math_comparison.md` Part 1 Section 1.2
and `specs/009-signal-tier-redesign/data-model.md` Section 6 (NRI unchanged).

This test must not read any removed flat key (`drowsinessLevel`, `isTrafficJam` bare,
`fatigueLevel`, etc.) — everything goes through the tiered `signals` dict.
"""

from __future__ import annotations

import importlib.util
import json
import pathlib

import pytest

_REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
_PKG_DIR = _REPO_ROOT / "packages" / "nri_fatigue_score_v1"
_PKG_ALG = _PKG_DIR / "algorithm.py"
_PKG_JSON = _PKG_DIR / "package.json"


# ---------------------------------------------------------------------------
# Load the package algorithm module directly (white-box unit driving evaluate)
# ---------------------------------------------------------------------------


def _load_module():
    spec = importlib.util.spec_from_file_location("nri_alg_under_test_009", _PKG_ALG)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)  # type: ignore[union-attr]
    return module


mod = _load_module()


def _default_hp() -> dict:
    """Read declared hyperparameter defaults from the package manifest (single source)."""
    data = json.loads(_PKG_JSON.read_text(encoding="utf-8"))
    return {hp["key"]: hp["default"] for hp in data["hyperparameters"]}


HP = _default_hp()

_EMPTY_PH = {
    "lastProposalTimeSec": None,
    "lastProposalCategory": None,
    "lastProposalResult": None,
    "proposalCountLast30Min": 0,
    "acceptanceRateRecent": 0.0,
}


# ---------------------------------------------------------------------------
# Tiered-signal context builder
# ---------------------------------------------------------------------------


def _signals(
    *,
    drowsiness=0.0,
    fatigue=0.0,
    anomaly_rate=0.0,
    is_night=False,
    familiar_route=False,
    child_passenger=False,
    weather_risk_level=0.0,
    segment_type="normal_road",
    motion_state="MOVING",
    is_traffic_jam=False,
    next_rest_spot_min=9999.0,
    recovery_phase=None,
    continuous_driving_min=0.0,
    speed_kph=80.0,
    route_fraction=0.0,
) -> dict:
    return {
        "fixed": {
            "isNight": is_night,
            "familiarRoute": familiar_route,
            "childPassenger": child_passenger,
            "weatherRiskLevel": weather_risk_level,
        },
        "dynamic": {
            "segmentType": segment_type,
            "motionState": motion_state,
            "continuousDrivingMin": continuous_driving_min,
            "speedKph": speed_kph,
            "routeFraction": route_fraction,
            "nextRestSpotMin": next_rest_spot_min,
            "isTrafficJam": is_traffic_jam,
            "recoveryPhase": recovery_phase,
        },
        "simulated": {
            "drowsiness": drowsiness,
            "fatigue": fatigue,
            "anomaly_rate": anomaly_rate,
        },
    }


def _ctx(
    signals,
    prev_state=None,
    proposal_history=None,
    sim_time=60.0,
    hp=None,
    recovery_active=False,
):
    return {
        "simulation_time_sec": sim_time,
        "signals": signals,
        "feature_groups": {"normalized": {}, "ordinal": {"signal_duration": "transient"}},
        "hyperparameters": hp if hp is not None else HP,
        "parameters": {},
        "proposal_history": proposal_history or dict(_EMPTY_PH),
        "user_action_history": [],
        "package_runtime_state": prev_state or {},
        "recovery_active": recovery_active,
    }


# ---------------------------------------------------------------------------
# S_base — child offset, night / familiar multipliers (helper-level, verbatim math)
# ---------------------------------------------------------------------------


def test_compute_base_score_child_offset_and_multipliers():
    # Baseline: no child, no night, not familiar -> pure T_drive * W_base.
    base = mod._compute_base_score(100.0, False, False, False, HP)
    assert base == pytest.approx(100.0 * 0.5)

    # Child passenger adds a flat W_child offset.
    with_child = mod._compute_base_score(100.0, True, False, False, HP)
    assert with_child == pytest.approx(base + 20.0)

    # Night multiplies the time-damage term by M_night (1.2), not the offset.
    with_night = mod._compute_base_score(100.0, False, True, False, HP)
    assert with_night == pytest.approx(100.0 * 0.5 * 1.2)

    # Familiar route multiplies by M_familiar (1.2).
    with_familiar = mod._compute_base_score(100.0, False, False, True, HP)
    assert with_familiar == pytest.approx(100.0 * 0.5 * 1.2)

    # Combined: multipliers compound, child offset stays additive (unmultiplied).
    combined = mod._compute_base_score(100.0, True, True, True, HP)
    assert combined == pytest.approx(20.0 + 100.0 * 0.5 * 1.2 * 1.2)


# ---------------------------------------------------------------------------
# S_env — cumulative jam / highway / monotonous weights (helper-level)
# ---------------------------------------------------------------------------


def test_compute_env_score_weights():
    env = mod._compute_env_score(10.0, 20.0, 30.0, HP)
    assert env == pytest.approx(10.0 * 0.8 + 20.0 * 0.2 + 30.0 * 0.3)


# ---------------------------------------------------------------------------
# S_realtime — ReLU dead-band on drowsiness/fatigue (the key 009 behavior change:
# these signals are now genuinely live, not always 0).
# ---------------------------------------------------------------------------


def test_compute_realtime_score_zero_below_dead_band():
    # Both signals below theta (60) -> S_realtime stays exactly 0 (dead-band).
    assert mod._compute_realtime_score(0.0, 0.0, HP) == 0.0
    assert mod._compute_realtime_score(59.9, 59.9, HP) == 0.0
    assert mod._compute_realtime_score(60.0, 60.0, HP) == 0.0  # boundary: not > theta


def test_compute_realtime_score_nonzero_above_dead_band_now_live():
    # This is the headline 009 change: drowsiness/fatigue now exist as live Tier-3a
    # signals, so S_realtime can be genuinely non-zero (it was always 0 pre-009).
    realtime = mod._compute_realtime_score(70.0, 0.0, HP)
    assert realtime == pytest.approx((70.0 - 60.0) * 1.5)
    assert realtime > 0.0

    both = mod._compute_realtime_score(80.0, 90.0, HP)
    assert both == pytest.approx((80.0 - 60.0) * 1.5 + (90.0 - 60.0) * 1.5)


# ---------------------------------------------------------------------------
# evaluate() — reads tiered signals; S_realtime now live end-to-end
# ---------------------------------------------------------------------------


def test_evaluate_reads_tiered_signals_and_s_realtime_is_live():
    signals = _signals(drowsiness=90.0, fatigue=90.0)
    ctx = _ctx(signals, sim_time=60.0)
    result = mod.evaluate(ctx)

    # S_realtime must reflect the live drowsiness/fatigue signals.
    expected_realtime = (90.0 - 60.0) * 1.5 * 2
    assert result["scores"]["s_realtime"] == pytest.approx(expected_realtime)
    assert result["scores"]["s_realtime"] > 0.0


def test_evaluate_s_realtime_zero_when_signals_below_dead_band():
    signals = _signals(drowsiness=10.0, fatigue=10.0)
    ctx = _ctx(signals, sim_time=60.0)
    result = mod.evaluate(ctx)
    assert result["scores"]["s_realtime"] == 0.0


def test_criteria_exposes_normalized_threshold_matching_rest_required_score_scale():
    """The timeline plots the NORMALIZED rest_required_score (0-1); criteria must
    carry the threshold on the SAME scale (rest_required_threshold), else the UI's
    y-domain stretches to the raw threshold_fire (~80) and flattens the curve.
    """
    ctx = _ctx(_signals(drowsiness=90.0, fatigue=90.0), sim_time=60.0)
    result = mod.evaluate(ctx)
    crit = result["criteria"]
    threshold_fire = HP["threshold_fire"]

    # Raw threshold is still exposed (truthful, for the "fire ⇔ s_total ≥ 80" rule).
    assert crit["threshold_fire"] == threshold_fire
    # Normalized threshold is present, on the 0-1 rest_required_score scale.
    norm = crit["rest_required_threshold"]
    assert 0.0 <= norm <= 1.0
    # It equals threshold_fire normalized by the same divisor the score uses.
    max_display = max(threshold_fire * 1.5, 150.0)
    assert norm == pytest.approx(threshold_fire / max_display)
    # And it is genuinely on the score's scale (both ≤ 1), unlike threshold_fire.
    assert result["scores"]["rest_required_score"] <= 1.0
    assert crit["threshold_fire"] > 1.0  # the raw one would flatten a 0-1 curve


def test_evaluate_uses_fixed_tier_for_child_night_familiar():
    signals_plain = _signals()
    signals_loaded = _signals(is_night=True, familiar_route=True, child_passenger=True)

    result_plain = mod.evaluate(_ctx(signals_plain, sim_time=60.0))
    result_loaded = mod.evaluate(_ctx(signals_loaded, sim_time=60.0))

    # Same 1-minute tick duration, but child/night/familiar all raise S_base.
    assert result_loaded["scores"]["s_base"] > result_plain["scores"]["s_base"]


# ---------------------------------------------------------------------------
# Accumulators — advance only while MOVING; threaded via package_runtime_state
# ---------------------------------------------------------------------------


def test_accumulators_advance_only_while_moving_across_ticks():
    signals_moving_jam = _signals(is_traffic_jam=True, segment_type="highway", motion_state="MOVING")

    # Tick 1 (sim_time=60, no prior state -> 1.0 min tick duration per algorithm quirk).
    r1 = mod.evaluate(_ctx(signals_moving_jam, sim_time=60.0))
    state1 = r1["next_package_runtime_state"]
    assert state1["cumulative_jam_min"] == pytest.approx(1.0)
    assert state1["cumulative_highway_min"] == pytest.approx(1.0)
    assert state1["cumulative_monotonous_min"] == pytest.approx(1.0)  # highway counts as monotonous

    # Tick 2 (sim_time=120, prior state threaded -> another 1.0 min).
    r2 = mod.evaluate(_ctx(signals_moving_jam, prev_state=state1, sim_time=120.0))
    state2 = r2["next_package_runtime_state"]
    assert state2["cumulative_jam_min"] == pytest.approx(2.0)
    assert state2["cumulative_highway_min"] == pytest.approx(2.0)
    assert state2["cumulative_monotonous_min"] == pytest.approx(2.0)


def test_accumulators_do_not_advance_when_stopped():
    signals_stopped = _signals(is_traffic_jam=True, segment_type="highway", motion_state="STOPPED")
    r1 = mod.evaluate(_ctx(signals_stopped, sim_time=60.0))
    state1 = r1["next_package_runtime_state"]
    assert state1["cumulative_jam_min"] == 0.0
    assert state1["cumulative_highway_min"] == 0.0
    assert state1["cumulative_monotonous_min"] == 0.0
    assert state1["driving_min_since_rest"] == 0.0


def test_accumulators_reset_after_recovery_completes():
    signals_moving_jam = _signals(is_traffic_jam=True, segment_type="highway")
    r1 = mod.evaluate(_ctx(signals_moving_jam, sim_time=60.0))
    state1 = r1["next_package_runtime_state"]
    assert state1["cumulative_jam_min"] > 0.0
    assert state1["was_in_recovery"] is False

    # Enter recovery (recoveryPhase set) — no accumulation happens while resting,
    # and was_in_recovery flips to True. Recovery suppression is unconditional (we
    # never propose a rest while the driver is already resting), regardless of score.
    signals_recovering = _signals(
        drowsiness=100.0, fatigue=0.0, recovery_phase="resting", motion_state="STOPPED"
    )
    r2 = mod.evaluate(_ctx(signals_recovering, prev_state=state1, sim_time=120.0))
    state2 = r2["next_package_runtime_state"]
    assert state2["was_in_recovery"] is True
    # Suppressed while recovery is active regardless of score.
    assert r2["fire_control"]["suppressed"] is True
    assert r2["fire_control"]["reason"] == "recovery_after_accept"

    # Recovery completes (recoveryPhase None again) — accumulators reset to 0 before
    # this tick's own contribution is added. Use a non-jam, non-monotonous segment so
    # every accumulator's post-reset value is exactly 0 (no same-tick re-accumulation
    # muddies the assertion).
    signals_resumed = _signals(is_traffic_jam=False, segment_type="mountain_road")
    r3 = mod.evaluate(_ctx(signals_resumed, prev_state=state2, sim_time=180.0))
    state3 = r3["next_package_runtime_state"]
    assert state3["cumulative_jam_min"] == 0.0
    assert state3["cumulative_highway_min"] == 0.0
    assert state3["cumulative_monotonous_min"] == 0.0
    # driving_min_since_rest DOES advance this tick (MOVING), starting fresh from the
    # post-recovery reset (0.0 + this tick's 1.0), confirming the reset actually happened
    # rather than merely coinciding with a low number.
    assert state3["driving_min_since_rest"] == 1.0


# ---------------------------------------------------------------------------
# Fire condition — SINGLE fire threshold + post-fire ETA filter (design-aligned).
#
# NRI's documented fire logic is one threshold: fire ⇔ S_total ≥ threshold_fire,
# with the next-rest-spot ETA as a post-fire filter only. There is NO
# suggest/recommend/urgent ladder, persistence gate, cooldown, 30-min cap, or
# emergency override — those were carried over from the Hybrid and are removed to
# match the spec (others/20260630_発火ロジック検討用資料.md line 217-218; math
# comparison §1.2 "fire ⇔ S_total ≥ threshold_fire (80); post-fire filter").
# ---------------------------------------------------------------------------


def _primed_state(*, driving_min_since_rest=160.0, jam_min=0.0, hw_min=0.0, mono_min=0.0) -> dict:
    """Runtime state as if the driver has accumulated enough exposure that one more
    1-minute tick lands S_total ≥ threshold_fire. `last_sim_time=0.0` forces the
    algorithm's documented default 1-minute tick duration."""
    return {
        "cumulative_jam_min": jam_min,
        "cumulative_highway_min": hw_min,
        "cumulative_monotonous_min": mono_min,
        "driving_min_since_rest": driving_min_since_rest,
        "last_sim_time": 0.0,
        "was_in_recovery": False,
    }


def test_fires_on_first_tick_at_or_above_threshold_fire_no_persistence():
    # S_base = 161 * 0.5 = 80.5 ≥ threshold_fire (80) on the FIRST over-threshold
    # tick — fires immediately, no persistence gate. Sentinel rest spot passes ETA.
    signals = _signals(next_rest_spot_min=9999.0)
    r = mod.evaluate(_ctx(signals, prev_state=_primed_state(), sim_time=60.0))
    assert r["scores"]["s_total"] >= HP["threshold_fire"]
    assert r["candidates"][0]["exists"] is True
    assert r["fire_control"]["fired"] is True
    assert r["fire_control"]["reason"] == "fire_threshold_passed"
    assert r["result_type"] == "REST_PROPOSAL"
    assert r["proposal"] is not None
    assert r["states"]["rest"] == "REST_FIRE"


def test_below_fire_threshold_is_no_proposal():
    signals = _signals(drowsiness=0.0, fatigue=0.0)  # tiny S_total
    result = mod.evaluate(_ctx(signals, sim_time=60.0))
    assert result["scores"]["s_total"] < HP["threshold_fire"]
    assert result["candidates"][0]["exists"] is False
    assert result["fire_control"]["fired"] is False
    assert result["fire_control"]["reason"] == "below_fire_threshold"
    assert result["result_type"] == "NO_PROPOSAL"


# ---------------------------------------------------------------------------
# Post-fire ETA filter (the only gate after the fire threshold)
# ---------------------------------------------------------------------------


def test_post_fire_eta_filter_suppresses_when_rest_spot_too_far():
    signals = _signals(next_rest_spot_min=30.0)  # > rest_spot_eta_filter_min (15)
    result = mod.evaluate(_ctx(signals, prev_state=_primed_state(), sim_time=60.0))
    assert result["scores"]["s_total"] >= HP["threshold_fire"]
    assert result["fire_control"]["suppressed"] is True
    assert result["fire_control"]["reason"] == "rest_spot_too_far"
    assert result["fire_control"]["fired"] is False


def test_post_fire_eta_filter_fires_when_spot_within_filter():
    signals = _signals(next_rest_spot_min=10.0)  # <= 15
    result = mod.evaluate(_ctx(signals, prev_state=_primed_state(), sim_time=60.0))
    assert result["fire_control"]["fired"] is True
    assert result["fire_control"]["reason"] == "fire_threshold_passed"


def test_post_fire_eta_filter_fires_when_no_rest_spot_ahead_sentinel():
    signals = _signals(next_rest_spot_min=9999.0)  # no spot ahead -> filter passes
    result = mod.evaluate(_ctx(signals, prev_state=_primed_state(), sim_time=60.0))
    assert result["fire_control"]["fired"] is True
    assert result["fire_control"]["reason"] == "fire_threshold_passed"


def test_hybrid_style_fire_control_hyperparameters_are_removed():
    """Design-aligned NRI has one fire threshold — the Hybrid-style knobs must be
    gone from the manifest (they are undocumented for NRI)."""
    removed = {
        "threshold_suggest", "threshold_recommend", "threshold_urgent",
        "persistence_ticks", "rest_cooldown_sec", "max_proposals_per_30min",
        "emergency_override_threshold",
    }
    assert removed.isdisjoint(set(HP)), f"stale fire-control hp still declared: {removed & set(HP)}"


# ---------------------------------------------------------------------------
# Recovery suppression
# ---------------------------------------------------------------------------


def test_recovery_active_suppresses_firing_regardless_of_score():
    signals = _signals(
        drowsiness=100.0, fatigue=100.0, child_passenger=True,
        is_traffic_jam=True, segment_type="highway", next_rest_spot_min=5.0,
        recovery_phase="resting", motion_state="STOPPED",
    )
    result = mod.evaluate(_ctx(signals, sim_time=60.0))
    assert result["fire_control"]["suppressed"] is True
    assert result["fire_control"]["reason"] == "recovery_after_accept"
    assert result["states"]["rest"] == "REST_RECOVERY"


# ---------------------------------------------------------------------------
# Determinism
# ---------------------------------------------------------------------------


def test_determinism_same_context_yields_same_result():
    signals = _signals(drowsiness=65.0, fatigue=50.0, is_night=True, is_traffic_jam=True)
    ctx = _ctx(signals, sim_time=60.0)
    r1 = mod.evaluate(dict(ctx))
    r2 = mod.evaluate(dict(ctx))
    assert r1["scores"] == r2["scores"]
    assert r1["fire_control"] == r2["fire_control"]
    assert r1["next_package_runtime_state"] == r2["next_package_runtime_state"]


# ---------------------------------------------------------------------------
# Manifest single-source defaults — no hardcoded hp.get(key, default) fallback
# ---------------------------------------------------------------------------


def test_missing_hyperparameter_key_raises_keyerror_not_silent_default():
    # The adapter guarantees a fully-resolved hyperparameters dict; a missing key
    # here is a real configuration bug and must surface as KeyError, never a
    # silently-wrong hardcoded default.
    incomplete_hp = dict(HP)
    del incomplete_hp["threshold_fire"]
    signals = _signals(drowsiness=90.0, fatigue=90.0)
    with pytest.raises(KeyError):
        mod.evaluate(_ctx(signals, sim_time=60.0, hp=incomplete_hp))


def test_every_hyperparameter_the_algorithm_reads_has_a_manifest_default():
    required_keys = {
        "w_base", "w_child", "m_night", "m_familiar",
        "w_jam", "w_highway", "w_monotonous",
        "theta_sleep", "w_sleep", "theta_fatigue", "w_fatigue",
        "threshold_fire", "rest_spot_eta_filter_min",
    }
    assert required_keys <= set(HP)
