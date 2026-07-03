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
    # and was_in_recovery flips to True. Recovery suppression (recovery_after_accept)
    # only applies when a candidate `exists` (score >= threshold_suggest), so drive the
    # live realtime term high enough to clear that bar.
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
# Fire condition + persistence gate
# ---------------------------------------------------------------------------


def _primed_state(
    *,
    driving_min_since_rest=110.0,
    jam_min=5.0,
    hw_min=5.0,
    mono_min=5.0,
    persistence_counter=0,
    last_score=0.0,
) -> dict:
    """Craft a package_runtime_state as if the driver has already accumulated substantial
    exposure, so a single subsequent tick lands S_total in the [threshold_fire,
    emergency_override_threshold) band deterministically (no need to tick-simulate for
    tens of minutes). `last_sim_time=0.0` forces the algorithm's documented default
    1-minute tick duration (see evaluate(): tick_duration_min falls back to 1.0 whenever
    prev_sim_time is not > 0), independent of whatever simulation_time_sec is passed.
    """
    return {
        "cumulative_jam_min": jam_min,
        "cumulative_highway_min": hw_min,
        "cumulative_monotonous_min": mono_min,
        "driving_min_since_rest": driving_min_since_rest,
        "persistence_counter": persistence_counter,
        "last_score": last_score,
        "last_sim_time": 0.0,
        "was_in_recovery": False,
    }


# Signals that, combined with `_primed_state()`, land S_total in [threshold_fire=80,
# emergency_override_threshold=100) for exactly one 1-minute tick: S_base = 20 (child) +
# 111*0.5 = 75.5; S_env = 6*(0.8+0.2+0.3) = 7.8; S_realtime = 0. Total = 83.3.
_FIRE_BAND_SIGNALS = _signals(
    drowsiness=0.0, fatigue=0.0, child_passenger=True,
    is_traffic_jam=True, segment_type="highway",
)


def test_fire_condition_requires_persistence_ticks():
    # Tick 1: first tick above threshold_fire (80) but below emergency (100); the
    # persistence_counter only reaches 1 (< persistence_ticks=2) -> persistence_gate.
    r1 = mod.evaluate(_ctx(_FIRE_BAND_SIGNALS, prev_state=_primed_state(), sim_time=60.0))
    assert HP["threshold_fire"] <= r1["scores"]["s_total"] < HP["emergency_override_threshold"]
    assert r1["next_package_runtime_state"]["persistence_counter"] == 1
    assert r1["fire_control"]["suppressed"] is True
    assert r1["fire_control"]["reason"] == "persistence_gate"
    assert r1["fire_control"]["fired"] is False

    # Tick 2: persistence_counter reaches 2 -> passes the gate. Rest spot is close
    # (default sentinel 9999 -> "no spot ahead" also passes the ETA filter) -> fires.
    r2 = mod.evaluate(
        _ctx(_FIRE_BAND_SIGNALS, prev_state=r1["next_package_runtime_state"], sim_time=120.0)
    )
    assert r2["next_package_runtime_state"]["persistence_counter"] == 2
    assert r2["fire_control"]["fired"] is True
    assert r2["fire_control"]["reason"] == "threshold_passed_persisted"
    assert r2["result_type"] == "REST_PROPOSAL"
    assert r2["proposal"] is not None


def test_below_suggest_threshold_no_candidate():
    signals = _signals(drowsiness=0.0, fatigue=0.0)
    result = mod.evaluate(_ctx(signals, sim_time=60.0))
    assert result["candidates"][0]["exists"] is False
    assert result["fire_control"]["fired"] is False
    assert result["fire_control"]["reason"] == "below_suggest_threshold"
    assert result["result_type"] == "NO_PROPOSAL"


def test_between_suggest_and_fire_is_below_fire_threshold():
    # S_total between threshold_suggest (60) and threshold_fire (80): exists but
    # not fired, reason below_fire_threshold. First tick (T_drive=1): S_base=0.5,
    # S_env=0, S_realtime=(100-60)*1.5=60 -> total=60.5.
    signals = _signals(drowsiness=100.0, fatigue=0.0)
    result = mod.evaluate(_ctx(signals, sim_time=60.0))
    assert 60.0 <= result["scores"]["s_total"] < 80.0
    assert result["candidates"][0]["exists"] is True
    assert result["fire_control"]["fired"] is False
    assert result["fire_control"]["reason"] == "below_fire_threshold"


# ---------------------------------------------------------------------------
# Post-fire ETA filter
# ---------------------------------------------------------------------------


def _fired_eligible_state():
    """A prev_state one tick away from clearing persistence (counter=1 -> 2), reused by
    the ETA/cooldown/rate-limit tests below (all check the checks that run AFTER the
    persistence gate clears)."""
    r1 = mod.evaluate(_ctx(_FIRE_BAND_SIGNALS, prev_state=_primed_state(), sim_time=60.0))
    assert r1["fire_control"]["reason"] == "persistence_gate"  # sanity: still gated
    return r1["next_package_runtime_state"]


def test_post_fire_eta_filter_suppresses_when_rest_spot_too_far():
    signals = _signals(
        drowsiness=0.0, fatigue=0.0, child_passenger=True,
        is_traffic_jam=True, segment_type="highway",
        next_rest_spot_min=30.0,  # > rest_spot_eta_filter_min (15)
    )
    result = mod.evaluate(_ctx(signals, prev_state=_fired_eligible_state(), sim_time=120.0))
    assert HP["threshold_fire"] <= result["scores"]["s_total"] < HP["emergency_override_threshold"]
    assert result["fire_control"]["suppressed"] is True
    assert result["fire_control"]["reason"] == "rest_spot_too_far"
    assert result["fire_control"]["fired"] is False


def test_post_fire_eta_filter_fires_when_no_rest_spot_ahead_sentinel():
    signals = _signals(
        drowsiness=0.0, fatigue=0.0, child_passenger=True,
        is_traffic_jam=True, segment_type="highway",
        next_rest_spot_min=9999.0,  # sentinel: no rest spot ahead -> filter passes
    )
    result = mod.evaluate(_ctx(signals, prev_state=_fired_eligible_state(), sim_time=120.0))
    assert result["fire_control"]["fired"] is True
    assert result["fire_control"]["reason"] == "threshold_passed_persisted"


# ---------------------------------------------------------------------------
# Cooldown + 30-min rate limit
# ---------------------------------------------------------------------------


def test_cooldown_suppresses_repeat_proposal():
    signals = _signals(
        drowsiness=0.0, fatigue=0.0, child_passenger=True,
        is_traffic_jam=True, segment_type="highway", next_rest_spot_min=5.0,
    )
    proposal_history = {
        "lastProposalTimeSec": 100.0,
        "lastProposalCategory": "rest_required",
        "lastProposalResult": None,
        "proposalCountLast30Min": 1,
        "acceptanceRateRecent": 0.0,
    }
    result = mod.evaluate(
        _ctx(signals, prev_state=_fired_eligible_state(), sim_time=120.0, proposal_history=proposal_history)
    )
    # sim_time=120.0, well within rest_cooldown_sec (600) of lastProposalTimeSec=100.0.
    assert result["fire_control"]["suppressed"] is True
    assert result["fire_control"]["reason"] == "cooldown_active"


def test_rate_limit_30min_suppresses_when_count_at_max():
    signals = _signals(
        drowsiness=0.0, fatigue=0.0, child_passenger=True,
        is_traffic_jam=True, segment_type="highway", next_rest_spot_min=5.0,
    )
    proposal_history = {
        "lastProposalTimeSec": None,
        "lastProposalCategory": None,
        "lastProposalResult": None,
        "proposalCountLast30Min": HP["max_proposals_per_30min"],
        "acceptanceRateRecent": 0.0,
    }
    result = mod.evaluate(
        _ctx(signals, prev_state=_fired_eligible_state(), sim_time=120.0, proposal_history=proposal_history)
    )
    assert result["fire_control"]["suppressed"] is True
    assert result["fire_control"]["reason"] == "rate_limit_30min"


def test_emergency_override_bypasses_persistence_cooldown_and_rate_limit():
    # Push S_total well above emergency_override_threshold (100) on the very first tick
    # (persistence_counter starts at 0 — override must fire despite that).
    signals = _signals(
        drowsiness=0.0, fatigue=0.0, child_passenger=True,
        is_traffic_jam=False, segment_type="normal_road", next_rest_spot_min=30.0,
    )
    prev_state = _primed_state(driving_min_since_rest=200.0, jam_min=0.0, hw_min=0.0, mono_min=0.0)
    proposal_history = {
        "lastProposalTimeSec": 55.0,
        "lastProposalCategory": "rest_required",
        "lastProposalResult": None,
        "proposalCountLast30Min": HP["max_proposals_per_30min"],
        "acceptanceRateRecent": 0.0,
    }
    result = mod.evaluate(
        _ctx(signals, prev_state=prev_state, sim_time=60.0, proposal_history=proposal_history)
    )
    assert result["scores"]["s_total"] >= HP["emergency_override_threshold"]
    assert result["fire_control"]["fired"] is True
    assert result["fire_control"]["override"] is True
    assert result["fire_control"]["reason"] == "emergency_override"


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
        "threshold_fire", "threshold_suggest", "threshold_recommend", "threshold_urgent",
        "rest_spot_eta_filter_min", "rest_cooldown_sec", "max_proposals_per_30min",
        "emergency_override_threshold", "persistence_ticks",
    }
    assert required_keys <= set(HP)
